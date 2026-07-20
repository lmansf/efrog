import SwiftUI

// Gem-score leaderboard — same data as the web Gem Room, fetched straight from
// Supabase via the public.get_leaderboard() RPC (no Flask server, no cold start).
struct LeaderboardView: View {

    @State private var entries: [LeaderboardEntry] = []
    @State private var isLoading = true
    @State private var loadFailed = false

    private static let medals = ["🥇", "🥈", "🥉"]

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading leaderboard…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if loadFailed {
                    ContentUnavailableCompat(
                        icon: "leaf",
                        title: "Leaderboard unavailable",
                        message: "Could not load the leaderboard. Pull to try again."
                    )
                } else if entries.isEmpty {
                    ContentUnavailableCompat(
                        icon: "trophy",
                        title: "No gem scores yet",
                        message: "Identify frogs and sign in to appear on the leaderboard."
                    )
                } else {
                    List {
                        Section {
                            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                                LeaderboardRowView(rank: index + 1, entry: entry,
                                                   medal: index < Self.medals.count ? Self.medals[index] : nil)
                            }
                        } footer: {
                            Text("Gem score = unique species × total observations × 10")
                        }
                    }
                }
            }
            .navigationTitle("Leaderboard")
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func load() async {
        do {
            entries = try await SupabaseManager.shared.fetchLeaderboard()
            loadFailed = false
        } catch {
            loadFailed = entries.isEmpty
        }
        isLoading = false
    }
}

struct LeaderboardRowView: View {
    let rank: Int
    let entry: LeaderboardEntry
    let medal: String?

    var body: some View {
        HStack(spacing: 12) {
            Text(medal ?? "\(rank)")
                .font(medal != nil ? .title3 : .subheadline.monospacedDigit().bold())
                .frame(width: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.username ?? "Anonymous").font(.headline).lineLimit(1)
                Text("\(entry.uniqueSpecies) species · \(entry.totalObs) observations")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(entry.gemScore.formatted()) 💎")
                .font(.subheadline.monospacedDigit().bold())
        }
        .padding(.vertical, 2)
    }
}
