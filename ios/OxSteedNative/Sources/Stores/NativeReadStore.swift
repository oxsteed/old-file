import Foundation
import Observation

@Observable
final class NativeReadStore {
    var mobileFeed: ResourceState<MobileFeed> = .idle
    var marketplaceProducts: ResourceState<[MarketplaceProduct]> = .idle
    var conversations: ResourceState<[NativeConversation]> = .idle
    var logisticsRequests: ResourceState<[LogisticsRequestSummary]> = .idle

    @MainActor
    func loadMobileFeed(using apiClient: OxSteedAPIClient) async {
        mobileFeed = .loading
        do {
            let envelope: APIDataEnvelope<MobileFeed> = try await apiClient.get("/mobile/feed")
            mobileFeed = .loaded(envelope.data)
        } catch {
            mobileFeed = .failed(error.localizedDescription)
        }
    }

    @MainActor
    func loadMarketplaceProducts(query: MarketplaceSearchQuery, using apiClient: OxSteedAPIClient) async {
        marketplaceProducts = .loading
        do {
            let trimmed = query.query.trimmingCharacters(in: .whitespacesAndNewlines)
            let path: String
            if trimmed.count >= 2 {
                let queryString = Self.queryString([
                    "q": trimmed,
                    "category": query.category,
                    "sortBy": query.sort,
                    "skillIds": query.skillId
                ])
                path = "/marketplace/products/search?\(queryString)"
            } else {
                let queryString = Self.queryString([
                    "category": query.category,
                    "sortBy": query.sort,
                    "skillIds": query.skillId,
                    "limit": "20"
                ])
                path = "/marketplace/products/browse?\(queryString)"
            }
            let envelope: APIPaginatedEnvelope<[MarketplaceProduct]> = try await apiClient.get(path)
            marketplaceProducts = .loaded(envelope.data)
        } catch {
            marketplaceProducts = .failed(error.localizedDescription)
        }
    }

    @MainActor
    func loadConversations(using apiClient: OxSteedAPIClient) async {
        conversations = .loading
        do {
            let rows: [NativeConversation] = try await apiClient.get("/messages/conversations")
            conversations = .loaded(rows)
        } catch {
            conversations = .failed(error.localizedDescription)
        }
    }

    @MainActor
    func loadLogisticsRequests(using apiClient: OxSteedAPIClient) async {
        logisticsRequests = .loading
        do {
            let envelope: APIDataEnvelope<[LogisticsRequestSummary]> = try await apiClient.get("/logistics/requests")
            logisticsRequests = .loaded(envelope.data)
        } catch {
            logisticsRequests = .failed(error.localizedDescription)
        }
    }

    private static func queryString(_ values: [String: String?]) -> String {
        values.compactMap { key, value in
            guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return nil
            }
            let encoded = value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
            return "\(key)=\(encoded)"
        }
        .sorted()
        .joined(separator: "&")
    }
}
