// ORT Mobile inference wrapper for the eFrog frog-call classifier.
//
// Model: frog_classifier.onnx
//   Input:  "input"  — Float32 tensor [1, 1, 64, T]  (batch, channel, mel-bins, frames)
//   Output: "output" — Float32 tensor [1, N_CLASSES]  raw logits (sigmoid applied here)
//
// The model was trained on 5-second clips → T = 157 frames
// (5 s × 16 000 Hz / 512 hop = 156.25 → padded to 157).
//
// NOTE: The SPM product is "OrtSwift" (microsoft/onnxruntime ≥ 1.20.0).
// If Xcode resolves the module under a different name, update this import.
import OnnxRuntime
import Foundation

enum ClassifierError: Error, LocalizedError {
    case modelNotFound
    case labelsNotFound
    case invalidInput(String)
    case inferenceFailure(String)

    var errorDescription: String? {
        switch self {
        case .modelNotFound:
            return "frog_classifier.onnx not found in app bundle — copy it from the repo root into ios/eFrog/Resources/"
        case .labelsNotFound:
            return "labels.json not found in app bundle — copy it from the repo root into ios/eFrog/Resources/"
        case .invalidInput(let msg):
            return "Invalid classifier input: \(msg)"
        case .inferenceFailure(let msg):
            return "ORT inference error: \(msg)"
        }
    }
}

final class FrogClassifier {
    private let env: ORTEnv
    private let session: ORTSession
    private let labels: [String]

    // Synchronous init; call from a background task to avoid blocking the main thread.
    init() throws {
        guard let modelPath = Bundle.main.path(forResource: "frog_classifier", ofType: "onnx") else {
            throw ClassifierError.modelNotFound
        }
        guard let labelsURL = Bundle.main.url(forResource: "labels", withExtension: "json"),
              let labelsData = try? Data(contentsOf: labelsURL),
              let labelsArray = try? JSONDecoder().decode([String].self, from: labelsData) else {
            throw ClassifierError.labelsNotFound
        }

        env = try ORTEnv(loggingLevel: .warning)
        let options = try ORTSessionOptions()
        try options.setIntraOpNumThreads(1)
        session = try ORTSession(env: env, modelPath: modelPath, sessionOptions: options)
        labels = labelsArray
    }

    /// Classify a mel spectrogram.
    ///
    /// - Parameter melSpectrogram: 64 × T Float array (mel-bins × time-frames), row-major.
    ///   Produced by the audio pipeline; expected shape matches the model's training input.
    /// - Returns: All species results sorted by confidence descending (rank 1 = best match).
    func classify(melSpectrogram: [[Float]]) async throws -> [ClassifierResult] {
        guard melSpectrogram.count == 64 else {
            throw ClassifierError.invalidInput("Expected 64 mel bins, got \(melSpectrogram.count)")
        }
        guard let nFrames = melSpectrogram.first?.count, nFrames > 0 else {
            throw ClassifierError.invalidInput("Mel spectrogram has zero time frames")
        }

        // Flatten rows to contiguous [1, 1, 64, T] tensor data.
        let flat = melSpectrogram.flatMap { $0 }
        let byteCount = flat.count * MemoryLayout<Float>.stride
        let tensorData = NSMutableData(bytes: flat, length: byteCount)
        let shape: [NSNumber] = [1, 1, 64, NSNumber(value: nFrames)]

        let inputTensor = try ORTValue(tensorData: tensorData, elementType: .float, shape: shape)

        let inputName = (try session.inputNames()).first ?? "input"
        let outputName = (try session.outputNames()).first ?? "output"

        let outputs = try session.run(
            withInputs: [inputName: inputTensor],
            outputNames: Set([outputName]),
            runOptions: nil
        )

        guard let outputValue = outputs[outputName] else {
            throw ClassifierError.inferenceFailure("Output '\(outputName)' missing from model results")
        }

        let rawData = try outputValue.tensorData() as Data
        let logits = rawData.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }

        let count = min(logits.count, labels.count)
        var results: [ClassifierResult] = (0..<count).map { i in
            // Per-class sigmoid — matches server.py and classifier.js
            let confidence = 1.0 / (1.0 + exp(-logits[i]))
            return ClassifierResult(species: labels[i], confidence: confidence, rank: 0)
        }

        results.sort { $0.confidence > $1.confidence }

        return results.enumerated().map { rank, result in
            ClassifierResult(species: result.species, confidence: result.confidence, rank: rank + 1)
        }
    }
}
