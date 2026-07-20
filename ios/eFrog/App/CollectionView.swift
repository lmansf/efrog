import SwiftUI

// Local observation history — mirrors the web Collection page, backed by the
// CoreData store (ObservationStore). Shows what this device has identified;
// rows are marked once they've synced to Supabase.
struct CollectionView: View {

    @State private var observations: [Observation] = []
    @State private var loadError: String?

    var body: some View {
        NavigationStack {
            Group {
                if let loadError {
                    ContentUnavailableCompat(
                        icon: "exclamationmark.triangle",
                        title: "Couldn't load history",
                        message: loadError
                    )
                } else if observations.isEmpty {
                    ContentUnavailableCompat(
                        icon: "square.stack.3d.up.slash",
                        title: "No observations yet",
                        message: "Identify a frog on the Analyze tab and it will appear here."
                    )
                } else {
                    List(observations) { obs in
                        ObservationRowView(observation: obs)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Collection")
            .task { load() }
            .refreshable { load() }
        }
    }

    private func load() {
        do {
            observations = try ObservationStore.shared.fetchAll()
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct ObservationRowView: View {
    let observation: Observation

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "waveform.circle.fill")
                .font(.title2)
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(observation.species).font(.headline)
                Text(observation.timestamp.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(Int((observation.confidence * 100).rounded()))%")
                    .font(.subheadline.monospacedDigit().bold())
                if observation.synced {
                    Image(systemName: "checkmark.icloud")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

// iOS 16-compatible stand-in for ContentUnavailableView (which is iOS 17+).
struct ContentUnavailableCompat: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
