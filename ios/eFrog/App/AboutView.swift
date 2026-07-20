import SwiftUI

// About + account. Sign-in mirrors js/auth.js: Auth0 PKCE web auth, then the
// login event + contact enrichment land in Supabase so observations from this
// device count toward the leaderboard.
struct AboutView: View {

    @ObservedObject private var auth = AuthManager.shared
    @State private var authBusy = false
    @State private var authError: String?

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    if let profile = auth.userProfile {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(profile.name).font(.headline)
                            if let email = profile.email {
                                Text(email).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Button("Sign out", role: .destructive) { signOut() }
                            .disabled(authBusy)
                    } else {
                        Text("Sign in to save your observations to your account and appear on the leaderboard.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        Button(authBusy ? "Signing in…" : "Sign in") { signIn() }
                            .disabled(authBusy)
                    }
                    if let authError {
                        Text(authError).font(.caption).foregroundStyle(.red)
                    }
                }

                Section("About eFrog") {
                    Text("Record 5 seconds of frog calls and eFrog identifies the species with an on-device machine-learning model — your audio never leaves your iPhone; only the analysis result is saved.")
                        .font(.callout)
                    LabeledContent("Analysis", value: "On-device (ONNX)")
                    LabeledContent("Version", value: Bundle.main.shortVersion)
                }

                Section {
                    Link("eFrog on the web", destination: URL(string: "https://efrog-seven.vercel.app")!)
                }
            }
            .navigationTitle("About")
        }
    }

    private func signIn() {
        authBusy = true
        authError = nil
        Task {
            defer { authBusy = false }
            do {
                try await auth.login()
                if let profile = auth.userProfile {
                    // Best-effort, mirrors the web post-login writes (js/auth.js).
                    try? await SupabaseManager.shared.sendLoginEvent(
                        userId: profile.userId, username: profile.name)
                    try? await SupabaseManager.shared.upsertContact(
                        id: SupabaseManager.contactId,
                        email: profile.email,
                        username: profile.name,
                        userId: profile.userId)
                }
            } catch {
                authError = error.localizedDescription
            }
        }
    }

    private func signOut() {
        authBusy = true
        authError = nil
        Task {
            defer { authBusy = false }
            do { try await auth.logout() }
            catch { authError = error.localizedDescription }
        }
    }
}

private extension Bundle {
    var shortVersion: String {
        let v = infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }
}
