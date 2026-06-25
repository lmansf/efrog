import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            Text("Analyze")
                .font(.largeTitle)
                .tabItem {
                    Label("Analyze", systemImage: "waveform.circle")
                }

            Text("Gem Room")
                .font(.largeTitle)
                .tabItem {
                    Label("Gem Room", systemImage: "trophy")
                }

            Text("About")
                .font(.largeTitle)
                .tabItem {
                    Label("About", systemImage: "info.circle")
                }
        }
    }
}

#Preview {
    ContentView()
}
