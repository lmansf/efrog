// AudioCapture.swift
//
// Records from the device microphone and delivers a 16 kHz mono Float32
// PCM buffer of exactly 80 000 samples (5 s × 16 kHz), ready for MelSpectrogram.

import AVFoundation
import Combine

final class AudioCapture: ObservableObject {

    @Published private(set) var isRecording = false

    // ── Private state ─────────────────────────────────────────────────────────

    private let engine      = AVAudioEngine()
    private var converter   : AVAudioConverter?
    private var targetFormat: AVAudioFormat?

    // Shared between the audio-tap thread and the caller thread; guarded by lock.
    private let lock     = NSLock()
    private var _samples = [Float]()

    // ── Constants ─────────────────────────────────────────────────────────────

    static let targetSampleRate: Double = 16_000
    static let targetSampleCount        = 80_000   // 5 s × 16 kHz

    // ── Recording control ─────────────────────────────────────────────────────

    /// Start capturing from the microphone.  Clears any previously recorded data.
    /// Tap callback runs on the audio thread.
    @MainActor
    func startRecording() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [])
        try session.setActive(true)

        lock.lock(); _samples = []; lock.unlock()

        let inputNode   = engine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        guard let tf = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Self.targetSampleRate,
            channels: 1,
            interleaved: false
        ) else { throw AudioCaptureError.badTargetFormat }

        guard let conv = AVAudioConverter(from: inputFormat, to: tf)
        else { throw AudioCaptureError.noConverter }

        targetFormat = tf
        converter    = conv

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buf, _ in
            self?.processTap(buf)
        }

        do {
            try engine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            throw error
        }
        isRecording = true
    }

    /// Stop recording and return the captured audio, padded/truncated to 80 000 samples.
    @MainActor
    func stopRecording() async -> [Float] {
        // Remove tap first so no more callbacks arrive, then stop the engine.
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()

        isRecording = false

        lock.lock()
        var result = _samples
        lock.unlock()

        return Self.padOrTruncate(result, to: Self.targetSampleCount)
    }

    // ── Tap callback (audio thread) ───────────────────────────────────────────

    private func processTap(_ buffer: AVAudioPCMBuffer) {
        guard let converter = converter, let targetFormat = targetFormat else { return }

        let ratio      = targetFormat.sampleRate / buffer.format.sampleRate
        let outCap     = AVAudioFrameCount(ceil(Double(buffer.frameLength) * ratio)) + 1
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outCap) else { return }

        var inputConsumed = false
        var convError: NSError?
        converter.convert(to: outBuf, error: &convError) { _, status in
            if inputConsumed {
                status.pointee = .noDataNow
                return nil
            }
            inputConsumed = true
            status.pointee = .haveData
            return buffer
        }

        guard convError == nil, let data = outBuf.floatChannelData?[0] else { return }
        let count   = Int(outBuf.frameLength)
        let samples = Array(UnsafeBufferPointer(start: data, count: count))

        lock.lock()
        _samples.append(contentsOf: samples)
        lock.unlock()
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static func padOrTruncate(_ samples: [Float], to target: Int) -> [Float] {
        if samples.count == target { return samples }
        if samples.count < target {
            return samples + [Float](repeating: 0, count: target - samples.count)
        }
        return Array(samples.prefix(target))
    }

    // ── Error type ────────────────────────────────────────────────────────────

    enum AudioCaptureError: Error {
        case badTargetFormat
        case noConverter
    }
}
