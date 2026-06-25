import Auth0
import Combine
import Foundation

/// Wraps Auth0.swift SDK. Mirrors the web flow in js/auth.js:
///   - login  → webAuth().start()  (ASWebAuthenticationSession, PKCE)
///   - logout → webAuth().clearSession()
///   - token  → CredentialsManager.credentials()  (silent refresh, equivalent to getTokenSilently())
///
/// Configuration is read from Auth0.plist (domain + clientId).
/// Audience is set per-call to match AUTH0_AUDIENCE in js/config.js.
@MainActor
final class AuthManager: ObservableObject {
    static let shared = AuthManager()

    @Published var isAuthenticated: Bool = false
    @Published var userProfile: UserProfile?

    private let credentialsManager: CredentialsManager
    private let audience = "https://efrog.onrender.com"

    private init() {
        credentialsManager = CredentialsManager(authentication: Auth0.authentication())
        Task { await refreshState() }
    }

    // MARK: - Public API

    func login() async throws {
        let credentials = try await withCheckedThrowingContinuation { continuation in
            Auth0
                .webAuth()
                .audience(audience)
                .scope("openid profile email")
                .start { result in
                    switch result {
                    case .success(let creds):
                        continuation.resume(returning: creds)
                    case .failure(let error):
                        continuation.resume(throwing: error)
                    }
                }
        }

        guard credentialsManager.store(credentials: credentials) else {
            throw AuthError.credentialStoreFailed
        }

        await refreshState()
    }

    func logout() async throws {
        defer {
            _ = credentialsManager.clear()
            isAuthenticated = false
            userProfile = nil
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            Auth0
                .webAuth()
                .clearSession { result in
                    switch result {
                    case .success:
                        continuation.resume()
                    case .failure(let error):
                        continuation.resume(throwing: error)
                    }
                }
        }
    }

    /// Silent token refresh — equivalent to auth.js getToken() / getTokenSilently().
    /// CredentialsManager returns a cached token if still valid, or silently renews via
    /// refresh token if it has expired.
    func getAccessToken() async throws -> String {
        let credentials = try await withCheckedThrowingContinuation { continuation in
            credentialsManager.credentials { result in
                switch result {
                case .success(let creds):
                    continuation.resume(returning: creds)
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
        return credentials.accessToken
    }

    // MARK: - Private helpers

    private func refreshState() async {
        guard credentialsManager.hasValid() else {
            isAuthenticated = false
            userProfile = nil
            return
        }

        do {
            let token = try await getAccessToken()
            let profile = try await fetchUserInfo(accessToken: token)
            isAuthenticated = true
            userProfile = profile
        } catch {
            // Expired or invalid stored credentials — treat as logged out.
            _ = credentialsManager.clear()
            isAuthenticated = false
            userProfile = nil
        }
    }

    private func fetchUserInfo(accessToken: String) async throws -> UserProfile {
        let info = try await withCheckedThrowingContinuation { continuation in
            Auth0
                .authentication()
                .userInfo(withAccessToken: accessToken)
                .start { result in
                    switch result {
                    case .success(let profile):
                        continuation.resume(returning: profile)
                    case .failure(let error):
                        continuation.resume(throwing: error)
                    }
                }
        }

        // Mirror auth.js: prefer name, fall back to email, then sub
        let displayName = info.name ?? info.email ?? info.sub
        return UserProfile(
            userId: info.sub,
            name: displayName,
            email: info.email
        )
    }
}

// MARK: -

enum AuthError: LocalizedError {
    case credentialStoreFailed

    var errorDescription: String? {
        switch self {
        case .credentialStoreFailed:
            return "Failed to store credentials in Keychain."
        }
    }
}
