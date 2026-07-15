import Foundation

// MARK: - SupabaseManager
//
// Wraps the supabase-swift client for all network I/O against the Supabase backend.
// Mirrors the direct Supabase writes in js/db.js (sendObservation, updateObservationFeedback,
// sendLoginEvent) and the authenticated fetch from the /observations REST path.
//
// Swift Package dependency:
//   https://github.com/supabase/supabase-swift  (add via Xcode → File → Add Packages)
//
// Import: `import Supabase` in the files that use SupabaseManager.

// NOTE: This file imports Supabase. Add the supabase-swift package before building.
import Supabase

final class SupabaseManager {

    // MARK: - Singleton

    static let shared = SupabaseManager()

    // MARK: - Constants

    private enum Constants {
        static let supabaseURL  = "https://dhnzjpgrcuwbptzjlkec.supabase.co"
        static let anonKey      = "sb_publishable_3ZN4xcs9GDj6Hs980vUUOQ_xPeD2Oh5"
        static let schema       = "Version_1"
    }

    // MARK: - Client

    private let client: SupabaseClient

    private init() {
        client = SupabaseClient(
            supabaseURL: URL(string: Constants.supabaseURL)!,
            supabaseKey: Constants.anonKey
        )
    }

    // MARK: - Public API

    /// Upsert one observation to Supabase. Idempotent — safe to call on re-send.
    /// Mirrors js/db.js `sendObservation`: merged by `id` via the SECURITY DEFINER
    /// `upsert_observation` RPC (see `supabase_rebuild.sql`). The observations table
    /// itself is not directly writable (or readable) with the anon key.
    func sendObservation(_ obs: Observation) async throws {
        let params = UpsertObservationParams(from: obs)
        try await client
            .schema(Constants.schema)
            .rpc("upsert_observation", params: params)
            .execute()
    }

    /// Update the feedback verdict columns on an existing observation row.
    /// Mirrors js/db.js `updateObservationFeedback` (lines 268–286).
    ///
    /// - Parameters:
    ///   - id: The observation UUID.
    ///   - verdict: `"agree"` → feedback=true; `"dispute"` → feedback=false; anything else → feedback=nil.
    ///   - speciesName: User-confirmed species label; required for dispute-based training data.
    func updateFeedback(id: String, verdict: String, speciesName: String? = nil) async throws {
        let feedbackValue: Bool?
        switch verdict {
        case "agree":    feedbackValue = true
        case "dispute":  feedbackValue = false
        default:         feedbackValue = nil
        }

        let params = FeedbackUpdateParams(
            id: id,
            includedFeedback: true,
            feedback: feedbackValue,
            speciesName: speciesName
        )
        try await client
            .schema(Constants.schema)
            .rpc("upsert_observation", params: params)
            .execute()
    }

    /// Insert a login event into `user_logins`. Mirrors js/db.js `sendLoginEvent` (line 301–303).
    /// Records each Auth0 sign-in for analytics; no SELECT needed for this table.
    func sendLoginEvent(userId: String, username: String) async throws {
        let row = LoginEventRow(
            userId: userId,
            username: username,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
        try await client
            .schema(Constants.schema)
            .from("user_logins")
            .insert(row)
            .execute()
    }

    /// Fetch this user's observations directly from Supabase using their Auth0 JWT.
    /// Mirrors the Flask `/observations` endpoint behaviour (server.py) but calls Supabase
    /// REST directly with the user's access token as the Bearer credential.
    ///
    /// - Note: Requires a Supabase RLS SELECT policy that allows authenticated users to
    ///   read their own rows (e.g. `USING (user_id = auth.jwt()->>'sub')`).
    ///   supabase_rebuild.sql ships this policy commented out — enable it alongside
    ///   configuring Supabase to accept Auth0 JWTs (Settings → Auth → JWT Secret).
    ///
    /// - Parameters:
    ///   - userId: The Auth0 `sub` claim; used to filter `user_id = eq.{userId}`.
    ///   - accessToken: The raw Auth0 JWT access token obtained after sign-in.
    /// - Returns: Array of `Observation` sorted newest-first.
    func fetchObservations(userId: String, accessToken: String) async throws -> [Observation] {
        guard let url = buildObservationsURL(userId: userId) else {
            throw SupabaseError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(Constants.anonKey, forHTTPHeaderField: "apikey")
        // PostgREST schema header selects the Version_1 schema
        request.setValue(Constants.schema, forHTTPHeaderField: "Accept-Profile")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "(empty)"
            throw SupabaseError.requestFailed(body)
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode([Observation].self, from: data)
    }

    // MARK: - Private helpers

    private func buildObservationsURL(userId: String) -> URL? {
        var components = URLComponents(string: "\(Constants.supabaseURL)/rest/v1/observations")
        components?.queryItems = [
            URLQueryItem(name: "user_id", value: "eq.\(userId)"),
            URLQueryItem(name: "order", value: "created_at.desc"),
        ]
        return components?.url
    }

    // MARK: - RPC parameter types

    /// Arguments for the `upsert_observation` RPC (see supabase_rebuild.sql).
    /// Keys are the function's `_`-prefixed argument names; values mirror the
    /// fields sent in js/db.js `sendObservation`.
    private struct UpsertObservationParams: Encodable {
        let id: String
        let userId: String?
        let contactId: String?
        let username: String?
        let createdAt: String       // ISO 8601 text — stored as TEXT in Supabase
        let type: String?
        let name: String?
        let duration: Double?
        let species: String
        let confidence: Double
        let probabilities: String?  // JSON-encoded dict, stored as TEXT
        let isHolo: Bool
        let melSpectrogram: String?
        let includedFeedback: Bool
        let feedback: Bool?
        let speciesName: String?

        enum CodingKeys: String, CodingKey {
            case id               = "_id"
            case userId           = "_user_id"
            case contactId        = "_contact_id"
            case username         = "_username"
            case createdAt        = "_created_at"
            case type             = "_type"
            case name             = "_name"
            case duration         = "_duration"
            case species          = "_species"
            case confidence       = "_confidence"
            case probabilities    = "_probabilities"
            case isHolo           = "_is_holo"
            case melSpectrogram   = "_mel_spectrogram"
            case includedFeedback = "_included_feedback"
            case feedback         = "_feedback"
            case speciesName      = "_species_name"
        }

        init(from obs: Observation) {
            self.id               = obs.id
            self.userId           = obs.userId
            self.contactId        = obs.contactId
            self.username         = obs.username
            self.createdAt        = ISO8601DateFormatter().string(from: obs.timestamp)
            self.type             = obs.type
            self.name             = obs.name
            self.duration         = obs.duration
            self.species          = obs.species
            self.confidence       = obs.confidence
            self.isHolo           = obs.isHolo
            self.melSpectrogram   = obs.melSpectrogram
            self.includedFeedback = obs.includedFeedback
            self.feedback         = obs.feedback
            self.speciesName      = obs.speciesName

            // Encode probabilities dict → JSON string (TEXT column in Supabase)
            if let probs = obs.probabilities,
               let data = try? JSONEncoder().encode(probs),
               let str  = String(data: data, encoding: .utf8) {
                self.probabilities = str
            } else {
                self.probabilities = nil
            }
        }
    }

    /// Partial arguments for `upsert_observation` when only attaching a verdict —
    /// omitted arguments default to NULL, which leaves existing values untouched.
    /// Mirrors js/db.js updateObservationFeedback.
    private struct FeedbackUpdateParams: Encodable {
        let id: String
        let includedFeedback: Bool
        let feedback: Bool?
        let speciesName: String?

        enum CodingKeys: String, CodingKey {
            case id               = "_id"
            case includedFeedback = "_included_feedback"
            case feedback         = "_feedback"
            case speciesName      = "_species_name"
        }
    }

    /// Row for the `user_logins` table. Mirrors js/db.js sendLoginEvent (line 301).
    private struct LoginEventRow: Encodable {
        let userId: String
        let username: String
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case userId    = "user_id"
            case username
            case createdAt = "created_at"
        }
    }

    // MARK: - Error

    enum SupabaseError: LocalizedError {
        case invalidURL
        case requestFailed(String)

        var errorDescription: String? {
            switch self {
            case .invalidURL:            return "Could not construct Supabase request URL."
            case .requestFailed(let m):  return "Supabase request failed: \(m)"
            }
        }
    }
}
