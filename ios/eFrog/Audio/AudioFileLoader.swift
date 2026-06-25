// AudioFileLoader.swift
//
// Loads any audio file (e.g. from a document picker URL) and returns
// a 16 kHz mono Float32 PCM buffer of exactly 80 000 samples (5 s),
// ready for MelSpectrogram.

import AVFoundation
import Foundation

struct AudioFileLoader {

    static let targetSampleRate: Double = 16_000
    static let targetSampleCount        = 80_000   // 5 s × 16 kHz

    /// Load `url`, convert to 16 kHz mono Float32, and return exactly 80 000 samples.
    ///
    /// The file is resampled via `AVAudioConverter`.  Output is zero-padded if shorter
    /// than 5 s and truncated if longer.
    func load(url: URL) throws -> [Float] {
        let file         = try AVAudioFile(forReading: url)
        let sourceFormat = file.processingFormat

        guard let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Self.targetSampleRate,
            channels: 1,
            interleaved: false
        ) else { throw AudioFileLoaderError.badTargetFormat }

        // Only read as many source frames as needed to produce 80 000 output samples,
        // avoiding full allocation for very long files.
        let neededSourceFrames = AVAudioFrameCount(
            ceil(Double(Self.targetSampleCount) * sourceFormat.sampleRate / Self.targetSampleRate)
        )
        let sourceCapacity = min(AVAudioFrameCount(file.length), neededSourceFrames)

        guard let sourceBuf = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: sourceCapacity)
        else { throw AudioFileLoaderError.bufferAlloc }
        try file.read(into: sourceBuf, frameCount: sourceCapacity)

        // AVAudioConverter returns nil when channel counts differ, so fold multi-channel
        // audio to mono manually before the resampling step.
        let monoBuf = sourceFormat.channelCount == 1 ? sourceBuf : try foldToMono(sourceBuf)

        // Output capacity: slightly over-allocate to absorb rounding in the resampler.
        let outCapacity = AVAudioFrameCount(
            ceil(Double(monoBuf.frameLength) * Self.targetSampleRate / monoBuf.format.sampleRate)
        ) + 1
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outCapacity)
        else { throw AudioFileLoaderError.bufferAlloc }

        guard let converter = AVAudioConverter(from: monoBuf.format, to: targetFormat)
        else { throw AudioFileLoaderError.noConverter }

        var inputConsumed = false
        var convError: NSError?
        converter.convert(to: outBuf, error: &convError) { _, status in
            if inputConsumed {
                status.pointee = .noDataNow
                return nil
            }
            inputConsumed = true
            status.pointee = .haveData
            return monoBuf
        }
        if let err = convError { throw err }

        guard let channelData = outBuf.floatChannelData?[0]
        else { throw AudioFileLoaderError.bufferAlloc }

        let frameCount = Int(outBuf.frameLength)
        let samples    = Array(UnsafeBufferPointer(start: channelData, count: frameCount))

        return Self.padOrTruncate(samples, to: Self.targetSampleCount)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private func foldToMono(_ sourceBuf: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer {
        let sourceFormat = sourceBuf.format
        let channelCount = Int(sourceFormat.channelCount)
        let frameCount   = Int(sourceBuf.frameLength)

        guard let monoFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sourceFormat.sampleRate,
            channels: 1,
            interleaved: false
        ) else { throw AudioFileLoaderError.badTargetFormat }

        guard let monoBuf  = AVAudioPCMBuffer(pcmFormat: monoFormat, frameCapacity: AVAudioFrameCount(frameCount)),
              let monoData  = monoBuf.floatChannelData?[0],
              let sourceData = sourceBuf.floatChannelData
        else { throw AudioFileLoaderError.bufferAlloc }

        monoBuf.frameLength = AVAudioFrameCount(frameCount)
        let scale = 1.0 / Float(channelCount)
        for i in 0..<frameCount {
            var sum: Float = 0
            for ch in 0..<channelCount { sum += sourceData[ch][i] }
            monoData[i] = sum * scale
        }
        return monoBuf
    }

    private static func padOrTruncate(_ samples: [Float], to target: Int) -> [Float] {
        if samples.count == target { return samples }
        if samples.count < target {
            return samples + [Float](repeating: 0, count: target - samples.count)
        }
        return Array(samples.prefix(target))
    }

    // ── Error type ────────────────────────────────────────────────────────────

    enum AudioFileLoaderError: Error {
        case badTargetFormat
        case noConverter
        case bufferAlloc
    }
}
