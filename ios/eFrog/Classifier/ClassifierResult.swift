import Foundation

struct ClassifierResult: Identifiable {
    let id = UUID()
    let species: String
    let confidence: Float   // 0.0–1.0 after sigmoid
    let rank: Int
}
