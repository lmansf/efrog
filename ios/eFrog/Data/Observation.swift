import Foundation

/// Shared model for a frog-call observation. Covers the full Supabase `Version_1.observations`
/// schema (supabase_observations.sql) plus local-only fields used by ObservationStore.
struct Observation: Identifiable, Codable, Equatable {
    // MARK: - Supabase columns

    let id: String
    let userId: String?
    let contactId: String?
    let username: String?
    /// Stored as an ISO 8601 string in Supabase (column type TEXT, not timestamptz).
    let timestamp: Date
    let type: String?
    let name: String?
    let duration: Double?
    let species: String
    let confidence: Double
    /// Per-class sigmoid probabilities, keyed by species label.
    let probabilities: [String: Double]?
    let isHolo: Bool
    /// Base64 float32 mel spectrogram; only populated when sending to Supabase for training.
    let melSpectrogram: String?
    var includedFeedback: Bool
    /// `true` = agreed (model correct), `false` = disputed, `nil` = no verdict.
    var feedback: Bool?
    /// User-confirmed / corrected species label (training target for disputes).
    var speciesName: String?

    // MARK: - Local-only fields (not written to Supabase)

    /// Filesystem path to the recorded audio file on this device.
    var audioPath: String?
    /// Whether this observation has been successfully upserted to Supabase.
    var synced: Bool

    // MARK: - Init

    init(
        id: String = UUID().uuidString,
        userId: String? = nil,
        contactId: String? = nil,
        username: String? = nil,
        timestamp: Date = Date(),
        type: String? = nil,
        name: String? = nil,
        duration: Double? = nil,
        species: String,
        confidence: Double,
        probabilities: [String: Double]? = nil,
        isHolo: Bool = false,
        melSpectrogram: String? = nil,
        includedFeedback: Bool = false,
        feedback: Bool? = nil,
        speciesName: String? = nil,
        audioPath: String? = nil,
        synced: Bool = false
    ) {
        self.id = id
        self.userId = userId
        self.contactId = contactId
        self.username = username
        self.timestamp = timestamp
        self.type = type
        self.name = name
        self.duration = duration
        self.species = species
        self.confidence = confidence
        self.probabilities = probabilities
        self.isHolo = isHolo
        self.melSpectrogram = melSpectrogram
        self.includedFeedback = includedFeedback
        self.feedback = feedback
        self.speciesName = speciesName
        self.audioPath = audioPath
        self.synced = synced
    }

    // MARK: - Codable

    enum CodingKeys: String, CodingKey {
        case id
        case userId         = "user_id"
        case contactId      = "contact_id"
        case username
        case timestamp      = "created_at"
        case type
        case name
        case duration
        case species
        case confidence
        case probabilities
        case isHolo         = "is_holo"
        case melSpectrogram = "mel_spectrogram"
        case includedFeedback = "included_feedback"
        case feedback
        case speciesName    = "species_name"
        // Local-only — excluded from network encoding via custom encode(to:)
        case audioPath
        case synced
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id              = try c.decode(String.self, forKey: .id)
        userId          = try c.decodeIfPresent(String.self, forKey: .userId)
        contactId       = try c.decodeIfPresent(String.self, forKey: .contactId)
        username        = try c.decodeIfPresent(String.self, forKey: .username)
        type            = try c.decodeIfPresent(String.self, forKey: .type)
        name            = try c.decodeIfPresent(String.self, forKey: .name)
        duration        = try c.decodeIfPresent(Double.self, forKey: .duration)
        species         = try c.decode(String.self, forKey: .species)
        confidence      = try c.decode(Double.self, forKey: .confidence)
        isHolo          = (try? c.decodeIfPresent(Bool.self, forKey: .isHolo)) ?? false
        melSpectrogram  = try c.decodeIfPresent(String.self, forKey: .melSpectrogram)
        includedFeedback = (try? c.decodeIfPresent(Bool.self, forKey: .includedFeedback)) ?? false
        feedback        = try c.decodeIfPresent(Bool.self, forKey: .feedback)
        speciesName     = try c.decodeIfPresent(String.self, forKey: .speciesName)
        audioPath       = try c.decodeIfPresent(String.self, forKey: .audioPath)
        synced          = (try? c.decodeIfPresent(Bool.self, forKey: .synced)) ?? false

        // Supabase stores created_at as an ISO 8601 text string.
        if let raw = try c.decodeIfPresent(String.self, forKey: .timestamp) {
            timestamp = ISO8601DateFormatter().date(from: raw) ?? Date()
        } else {
            timestamp = Date()
        }

        // probabilities is stored as a JSON string in Supabase (TEXT column).
        if let jsonString = try? c.decodeIfPresent(String.self, forKey: .probabilities),
           let data = jsonString.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([String: Double].self, from: data) {
            probabilities = decoded
        } else {
            probabilities = try c.decodeIfPresent([String: Double].self, forKey: .probabilities)
        }
    }
}
