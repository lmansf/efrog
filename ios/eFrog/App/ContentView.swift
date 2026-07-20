import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            AnalyzeView()
                .tabItem { Label("Analyze", systemImage: "waveform.circle") }

            CollectionView()
                .tabItem { Label("Collection", systemImage: "square.stack.3d.up") }

            LeaderboardView()
                .tabItem { Label("Leaderboard", systemImage: "trophy") }

            AboutView()
                .tabItem { Label("About", systemImage: "info.circle") }
        }
    }
}

#Preview {
    ContentView()
}
