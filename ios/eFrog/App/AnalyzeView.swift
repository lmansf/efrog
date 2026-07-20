import SwiftUI
import AVFoundation
import UniformTypeIdentifiers

// The core screen — mirrors the web Record page (js/pages/record.js):
// record 5 s (or import a file) → mel spectrogram → on-device ONNX model →
// ranked results → agree/dispute/skip verdict. Every analysis is saved to the
// local CoreData store and upserted to Supabase (anonymous included).
struct AnalyzeView: View {

    @StateObject private var capture = AudioCapture()
    @ObservedObject private var auth = AuthManager.shared

    // Model lifecycle
    @State private var classifier: FrogClassifier?
    @State private var modelError: String?

    // Clip state
    @State private var samples: [Float]?
    @State private var clipLabel: String?
    @State private var clipSource = "recording"     // "recording" | "upload"
    @State private var secondsLeft = 5

    // Analysis state
    @State private var isAnalyzing = false
    @State private var results: [ClassifierResult] = []
    @State private var observationId: String?
    @State private var verdictMessage: String?

    @State private var showImporter = false
    @State private var errorMessage: String?

    private static let recordSeconds = 5

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    inputSection
                    if let clipLabel { clipSection(clipLabel) }
                    if isAnalyzing { analyzingSection }
                    if !results.isEmpty { resultsSection }
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.callout)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                }
                .padding()
            }
            .navigationTitle("Analyze Sound")
            .task { await loadModelIfNeeded() }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.audio]) { result in
                handleImport(result)
            }
        }
    }

    // MARK: - Sections

    private var inputSection: some View {
        VStack(spacing: 16) {
            if let modelError {
                Label(modelError, systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(.red)
            } else if classifier == nil {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Loading model…").foregroundStyle(.secondary)
                }
            }

            Button(action: toggleRecording) {
                VStack(spacing: 8) {
                    Image(systemName: capture.isRecording ? "stop.circle.fill" : "mic.circle.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(capture.isRecording ? .red : Color.accentColor)
                    Text(capture.isRecording ? "Recording… \(secondsLeft)s" : "Record \(Self.recordSeconds) seconds")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
                .background(RoundedRectangle(cornerRadius: 16).fill(Color(.secondarySystemBackground)))
            }
            .buttonStyle(.plain)
            .disabled(classifier == nil)

            Button {
                showImporter = true
            } label: {
                Label("Import audio file", systemImage: "square.and.arrow.down")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.bordered)
            .disabled(classifier == nil || capture.isRecording)
        }
    }

    private func clipSection(_ label: String) -> some View {
        HStack {
            Image(systemName: "waveform")
                .foregroundStyle(Color.accentColor)
            Text(label).lineLimit(1)
            Spacer()
            Button("Analyze", action: analyze)
                .buttonStyle(.borderedProminent)
                .disabled(isAnalyzing || samples == nil || classifier == nil)
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground)))
    }

    private var analyzingSection: some View {
        HStack(spacing: 8) {
            ProgressView()
            Text("Listening for frogs…").foregroundStyle(.secondary)
        }
        .padding()
    }

    private var resultsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Result").font(.title2.bold())

            if let top = results.first {
                VStack(alignment: .leading, spacing: 6) {
                    Text(top.species).font(.title3.bold())
                    ConfidenceBar(value: Double(top.confidence))
                    Text("\(Int((top.confidence * 100).rounded()))% confidence")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.accentColor.opacity(0.12)))
            }

            ForEach(results.dropFirst().prefix(5)) { r in
                HStack {
                    Text(r.species).font(.subheadline)
                    Spacer()
                    Text("\(Int((r.confidence * 100).rounded()))%")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            verdictSection
        }
    }

    // Agree / dispute / skip — writes the verdict onto the observation row,
    // the same training signal the web app collects.
    @ViewBuilder
    private var verdictSection: some View {
        if let verdictMessage {
            Label(verdictMessage, systemImage: "checkmark.circle")
                .font(.callout)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
        } else if observationId != nil, let predicted = results.first?.species {
            VStack(alignment: .leading, spacing: 10) {
                Text("Was this identification right?").font(.headline)
                HStack {
                    Button {
                        sendVerdict("agree", speciesName: predicted,
                                    message: "Thanks — glad we got it right!")
                    } label: { Label("Agree", systemImage: "hand.thumbsup") }
                        .buttonStyle(.borderedProminent)

                    Menu {
                        ForEach(results) { r in
                            Button(r.species) {
                                sendVerdict("dispute", speciesName: r.species,
                                            message: "Thanks — logged as \(r.species).")
                            }
                        }
                        Button("No frogs present") {
                            sendVerdict("dispute", speciesName: nil,
                                        message: "Thanks — logged as no frogs present.")
                        }
                    } label: { Label("Dispute", systemImage: "pencil") }
                        .buttonStyle(.bordered)

                    Button("Not now") {
                        verdictMessage = "No problem — maybe next time."
                    }
                    .buttonStyle(.borderless)
                }
            }
            .padding(.top, 8)
        }
    }

    // MARK: - Model

    private func loadModelIfNeeded() async {
        guard classifier == nil, modelError == nil else { return }
        do {
            classifier = try await Task.detached(priority: .userInitiated) {
                try FrogClassifier()
            }.value
        } catch {
            modelError = error.localizedDescription
        }
    }

    // MARK: - Recording

    private func toggleRecording() {
        if capture.isRecording {
            finishRecording(early: true)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async {
                    guard granted else {
                        errorMessage = "Microphone access is off — enable it in Settings → eFrog."
                        return
                    }
                    beginRecording()
                }
            }
        }
    }

    private func beginRecording() {
        errorMessage = nil
        results = []
        verdictMessage = nil
        observationId = nil
        do {
            try capture.startRecording()
        } catch {
            errorMessage = "Could not start recording: \(error.localizedDescription)"
            return
        }
        secondsLeft = Self.recordSeconds
        Task {
            for tick in stride(from: Self.recordSeconds - 1, through: 0, by: -1) {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard capture.isRecording else { return }
                secondsLeft = tick
            }
            if capture.isRecording { finishRecording(early: false) }
        }
    }

    private func finishRecording(early: Bool) {
        Task {
            let captured = await capture.stopRecording()
            samples = captured
            clipSource = "recording"
            clipLabel = early ? "Recording (padded to 5 s)" : "5-second recording"
        }
    }

    // MARK: - Import

    private func handleImport(_ result: Result<URL, Error>) {
        switch result {
        case .failure:
            errorMessage = "Could not open that file."
        case .success(let url):
            errorMessage = nil
            results = []
            verdictMessage = nil
            observationId = nil
            let secured = url.startAccessingSecurityScopedResource()
            defer { if secured { url.stopAccessingSecurityScopedResource() } }
            do {
                samples = try AudioFileLoader().load(url: url)
                clipSource = "upload"
                clipLabel = url.lastPathComponent
            } catch {
                errorMessage = "Could not read that audio file — try M4A, WAV or MP3."
            }
        }
    }

    // MARK: - Analysis

    private func analyze() {
        guard let clip = samples, let model = classifier else { return }
        isAnalyzing = true
        errorMessage = nil
        results = []
        verdictMessage = nil
        Task {
            do {
                let mel = await Task.detached(priority: .userInitiated) {
                    MelSpectrogram().compute(samples: clip)
                }.value
                let ranked = try await model.classify(melSpectrogram: mel)
                results = ranked
                isAnalyzing = false
                persist(ranked, mel: mel)
            } catch {
                isAnalyzing = false
                errorMessage = "Classification failed: \(error.localizedDescription)"
            }
        }
    }

    // Save locally + upsert to Supabase — mirrors record.js: works anonymously,
    // and a signed-in user's id makes it count on the leaderboard.
    private func persist(_ ranked: [ClassifierResult], mel: [[Float]]) {
        guard let top = ranked.first else { return }
        let probabilities = Dictionary(uniqueKeysWithValues: ranked.map { ($0.species, Double($0.confidence)) })
        let obs = Observation(
            userId: auth.userProfile?.userId,
            contactId: SupabaseManager.contactId,
            username: auth.userProfile?.name,
            type: clipSource,
            name: clipLabel,
            duration: Double(Self.recordSeconds),
            species: top.species,
            confidence: Double(top.confidence),
            probabilities: probabilities,
            melSpectrogram: Self.base64(mel)
        )
        observationId = obs.id
        try? ObservationStore.shared.save(obs)
        Task {
            do {
                try await SupabaseManager.shared.sendObservation(obs)
                try? ObservationStore.shared.markSynced(id: obs.id)
            } catch {
                // Offline is fine — the local copy keeps the history.
            }
        }
    }

    private func sendVerdict(_ verdict: String, speciesName: String?, message: String) {
        guard let id = observationId else { return }
        verdictMessage = message
        Task {
            try? await SupabaseManager.shared.updateFeedback(id: id, verdict: verdict, speciesName: speciesName)
        }
    }

    // Base64 little-endian float32, row-major [64][157] — the exact format the
    // web app ships (js/classifier.js _f32ToBase64) and the training pipeline
    // decodes with np.frombuffer(b64decode(s), '<f4').reshape(64, 157).
    private static func base64(_ mel: [[Float]]) -> String {
        let flat = mel.flatMap { $0 }
        return flat.withUnsafeBufferPointer { Data(buffer: $0) }.base64EncodedString()
    }
}

// Simple horizontal confidence meter.
struct ConfidenceBar: View {
    let value: Double   // 0…1

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(.systemFill))
                Capsule()
                    .fill(Color.accentColor)
                    .frame(width: max(6, geo.size.width * value))
            }
        }
        .frame(height: 8)
    }
}
