// MelSpectrogram.swift
//
// Computes a log-mel spectrogram that numerically matches js/melspectrogram.js,
// which itself was validated against librosa.  Every parameter and formula is
// ported verbatim from the JS reference.
//
// Parameters:
//   n_fft=1024, hop_length=512, n_mels=64, fmin=0, fmax=8000
//   Slaney mel scale, Slaney L1 norm, center-padding (constant), top_db=80
//
// Output: [[Float]] shaped [64][T] in dB, values ≈ [-80, 0].

import Accelerate
import Foundation

final class MelSpectrogram {

    // ── Constants matching js/melspectrogram.js ──────────────────────────────

    static let sampleRate   = 16_000
    static let nFFT         = 1024
    static let hopLength    = 512
    static let nMels        = 64
    static let fMin: Double = 0
    static let fMax: Double = 8_000
    static let topDB: Float = 80
    static let amin: Float  = 1e-10

    // ── Sparse triangular filter representation ───────────────────────────────

    private struct Filter {
        let startBin: Int
        let values: [Float]
    }

    // ── Stored computed state ─────────────────────────────────────────────────

    private let fftSetup: FFTSetup
    private let hannWindow: [Float]   // periodic Hann, length nFFT
    private let filters: [Filter]     // length nMels

    // ── Init ──────────────────────────────────────────────────────────────────

    init() {
        fftSetup = vDSP_create_fftsetup(vDSP_Length(10), FFTRadix(kFFTRadix2))! // log2(1024)=10
        hannWindow = Self.makeHannWindow()
        filters = Self.buildMelFilterbank()
    }

    deinit {
        vDSP_destroy_fftsetup(fftSetup)
    }

    // ── Periodic Hann window ──────────────────────────────────────────────────
    //
    // Formula: w[n] = 0.5 - 0.5 * cos(2π*n / N)
    // Divisor is N (not N-1), matching scipy get_window('hann', N, fftbins=True)
    // and the loop at melspectrogram.js:22-24.
    //
    private static func makeHannWindow() -> [Float] {
        let N = Float(nFFT)
        return (0..<nFFT).map { n in
            0.5 - 0.5 * cos(2 * .pi * Float(n) / N)
        }
    }

    // ── Slaney mel scale ──────────────────────────────────────────────────────
    //
    // Direct port of hzToMel / melToHz from melspectrogram.js:27-47.
    // htk=False; linear below 1 kHz, log above.
    //
    private static func hzToMel(_ hz: Double) -> Double {
        let fSp      = 200.0 / 3.0
        let minLogHz = 1_000.0
        let minLogMel = minLogHz / fSp      // 15.0
        let logstep  = log(6.4) / 27.0
        if hz >= minLogHz {
            return minLogMel + log(hz / minLogHz) / logstep
        }
        return hz / fSp
    }

    private static func melToHz(_ mel: Double) -> Double {
        let fSp      = 200.0 / 3.0
        let minLogHz = 1_000.0
        let minLogMel = minLogHz / fSp      // 15.0
        let logstep  = log(6.4) / 27.0
        if mel >= minLogMel {
            return minLogHz * exp(logstep * (mel - minLogMel))
        }
        return fSp * mel
    }

    // ── Mel filterbank ────────────────────────────────────────────────────────
    //
    // Matches buildMelFilterbank() in melspectrogram.js:50-87.
    // Slaney normalization: enorm = 2 / (melPts[m+2] - melPts[m]).
    // Sparse: only non-zero weights are stored per filter.
    //
    private static func buildMelFilterbank() -> [Filter] {
        let nBins = 1 + nFFT / 2   // 513

        let fftFreqs = (0..<nBins).map { Double($0) * Double(sampleRate) / Double(nFFT) }

        let melMin = hzToMel(fMin)   // 0.0
        let melMax = hzToMel(fMax)
        let melPts = (0..<(nMels + 2)).map { i -> Double in
            melToHz(melMin + (melMax - melMin) * Double(i) / Double(nMels + 1))
        }

        var filters: [Filter] = []
        for m in 0..<nMels {
            let enorm    = 2.0 / (melPts[m + 2] - melPts[m])
            let fdiffLow = melPts[m + 1] - melPts[m]
            let fdiffHi  = melPts[m + 2] - melPts[m + 1]

            var startBin = -1
            var endBin   = -1
            var vals: [Float] = []

            for k in 0..<nBins {
                let f     = fftFreqs[k]
                let lower = -(melPts[m] - f) / fdiffLow
                let upper = (melPts[m + 2] - f) / fdiffHi
                let w     = max(0.0, min(lower, upper)) * enorm
                if w > 0 {
                    if startBin == -1 { startBin = k }
                    endBin = k
                    vals.append(Float(w))
                } else if startBin != -1 && k > endBin {
                    break   // past the triangular span, no more non-zero weights
                }
            }

            filters.append(Filter(startBin: max(0, startBin), values: vals))
        }
        return filters
    }

    // ── Public entry point ────────────────────────────────────────────────────

    /// Compute a log-mel spectrogram from a 16 kHz mono Float32 PCM buffer.
    ///
    /// - Parameter samples: raw PCM at 16 kHz, mono, Float32.
    /// - Returns: `[[Float]]` shaped `[nMels][nFrames]`, values in dB ≈ [-80, 0].
    func compute(samples: [Float]) -> [[Float]] {
        let nFFT      = Self.nFFT
        let hopLength = Self.hopLength
        let nMels     = Self.nMels
        let halfN     = nFFT / 2       // 512
        let nBins     = halfN + 1      // 513

        // Center padding: n_fft/2 zeros on each side (librosa center=True, pad_mode='constant')
        // melspectrogram.js:155 — padded.set(clip, pad)
        let pad = halfN
        var padded = [Float](repeating: 0, count: samples.count + nFFT)
        padded.replaceSubrange(pad..<(pad + samples.count), with: samples)

        let nFrames = 1 + samples.count / hopLength  // 157 for 80 000-sample clip

        // Per-frame scratch buffers: allocated once outside the hot loop.
        let windowedBuf = UnsafeMutablePointer<Float>.allocate(capacity: nFFT)
        let realBuf     = UnsafeMutablePointer<Float>.allocate(capacity: halfN)
        let imagBuf     = UnsafeMutablePointer<Float>.allocate(capacity: halfN)
        var powerBuf    = [Float](repeating: 0, count: nBins)
        defer {
            windowedBuf.deallocate()
            realBuf.deallocate()
            imagBuf.deallocate()
        }

        var split  = DSPSplitComplex(realp: realBuf, imagp: imagBuf)
        let log2N  = vDSP_Length(10)

        // Row-major mel accumulator: mel[m * nFrames + t]
        var mel    = [Float](repeating: 0, count: nMels * nFrames)
        var maxMel = -Float.infinity

        padded.withUnsafeBufferPointer { paddedPtr in
            hannWindow.withUnsafeBufferPointer { hannPtr in
                powerBuf.withUnsafeMutableBufferPointer { pwrPtr in
                    for t in 0..<nFrames {
                        let offset = t * hopLength

                        // Apply periodic Hann window
                        vDSP_vmul(
                            paddedPtr.baseAddress! + offset, 1,
                            hannPtr.baseAddress!, 1,
                            windowedBuf, 1,
                            vDSP_Length(nFFT)
                        )

                        // Pack N real samples as N/2 complex for vDSP real FFT:
                        //   realp[k] = windowed[2k], imagp[k] = windowed[2k+1]
                        windowedBuf.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { cPtr in
                            vDSP_ctoz(cPtr, 2, &split, 1, vDSP_Length(halfN))
                        }

                        // Forward real FFT (in-place).  Output packing:
                        //   realp[0] = DC,  imagp[0] = Nyquist
                        //   realp[k]+i*imagp[k] = DFT bin k  (k=1..halfN-1)
                        vDSP_fft_zrip(fftSetup, &split, 1, log2N,
                                      FFTDirection(kFFTDirection_Forward))

                        // Power spectrum: |X[k]|^2 for k = 0..nBins-1
                        // vDSP_zvmags gives realp[k]^2+imagp[k]^2 for k=0..halfN-1.
                        // Index 0 conflates DC+Nyquist so we fix DC and Nyquist separately.
                        vDSP_zvmags(&split, 1, pwrPtr.baseAddress!, 1, vDSP_Length(halfN))
                        pwrPtr[0]     = realBuf[0] * realBuf[0]   // DC power
                        pwrPtr[halfN] = imagBuf[0] * imagBuf[0]   // Nyquist power

                        // Apply mel filterbank (sparse dot products)
                        for m in 0..<nMels {
                            let f = filters[m]
                            guard !f.values.isEmpty else { continue }
                            var acc: Float = 0
                            f.values.withUnsafeBufferPointer { fPtr in
                                vDSP_dotpr(
                                    pwrPtr.baseAddress! + f.startBin, 1,
                                    fPtr.baseAddress!, 1,
                                    &acc,
                                    vDSP_Length(f.values.count)
                                )
                            }
                            mel[m * nFrames + t] = acc
                            if acc > maxMel { maxMel = acc }
                        }
                    }
                }
            }
        }

        // ── power_to_db(ref=np.max, top_db=80, amin=1e-10) ──────────────────
        //
        // Matches melspectrogram.js:182-188:
        //   refDb = 10*log10(max(amin, maxMel))
        //   db    = 10*log10(max(amin, mel[i])) - refDb
        //   clip to -80
        //
        let refDB    = 10 * log10(max(Self.amin, maxMel))
        var floorDB  = -Self.topDB

        // Clamp power values to amin before log
        let total    = mel.count
        for i in 0..<total where mel[i] < Self.amin { mel[i] = Self.amin }

        // Vectorised log10 via vForce (as specified)
        var logMel = [Float](repeating: 0, count: total)
        var n      = Int32(total)
        vvlog10f(&logMel, &mel, &n)

        // db[i] = 10 * log10(mel[i]) - refDB  →  vDSP_vsmsa: D = A*B + C
        var scale    = Float(10)
        var negRefDB = -refDB
        vDSP_vsmsa(logMel, 1, &scale, &negRefDB, &mel, 1, vDSP_Length(total))

        // Clamp to floor using vDSP_vthres (max(mel[i], floor))
        vDSP_vthrsc(mel, 1, &floorDB, &mel, 1, vDSP_Length(total))

        // Guard against any remaining NaN/inf (matches js nan_to_num)
        for i in 0..<total where !mel[i].isFinite { mel[i] = floorDB }

        // Reshape flat row-major buffer to [[Float]] shape [nMels][nFrames]
        return (0..<nMels).map { m in
            Array(mel[(m * nFrames)..<((m + 1) * nFrames)])
        }
    }
}
