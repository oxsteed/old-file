import Foundation

// MARK: - Models

struct Recommendation: Decodable, Identifiable {
    let id: String
    let type: String
    let priority: Int
    let title: String
    let subtitle: String
    let action_url: String
    let action_label: String
    let reason: String
    let category: String?
    let icon_hint: String
    let badge: String?
}

private struct RecommendationsEnvelope: Decodable {
    let recommendations: [Recommendation]
    let generated_at: String
}

// MARK: - Service

enum RecommendationsService {
    static func fetch() async throws -> [Recommendation] {
        let envelope: RecommendationsEnvelope = try await APIClient.shared.request(
            "/api/recommendations"
        )
        return envelope.recommendations
    }

    static func dismiss(id: String, days: Int = 14) async throws {
        struct Req: Encodable { let days: Int }
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        try await APIClient.shared.requestVoid(
            "/api/recommendations/\(encoded)/dismiss",
            method: .POST,
            body: Req(days: days)
        )
    }
}

// MARK: - Store

@MainActor
final class RecommendationsStore: ObservableObject {
    static let shared = RecommendationsStore()

    @Published private(set) var recommendations: [Recommendation] = []
    @Published private(set) var isLoading = false
    @Published private(set) var error: String? = nil

    private var lastFetchedAt: Date? = nil
    private let cacheTTL: TimeInterval = 5 * 60  // 5 minutes

    private init() {}

    var hasRecommendations: Bool { !recommendations.isEmpty }

    /// Fetch if cache is stale or forced.
    func load(force: Bool = false) async {
        if !force, let last = lastFetchedAt, Date().timeIntervalSince(last) < cacheTTL {
            return
        }
        isLoading = true
        error = nil
        do {
            recommendations = try await RecommendationsService.fetch()
            lastFetchedAt = Date()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    /// Call after completing a guide or posting a job to bust the cache.
    func invalidate() {
        lastFetchedAt = nil
    }

    func dismiss(_ id: String) {
        let previous = recommendations
        recommendations.removeAll { $0.id == id }
        Task {
            do {
                try await RecommendationsService.dismiss(id: id)
            } catch {
                await MainActor.run {
                    recommendations = previous
                    self.error = error.localizedDescription
                }
            }
        }
    }
}
