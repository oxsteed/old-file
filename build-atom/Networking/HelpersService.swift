import Foundation

enum HelpersService {
    static func browse(query: String? = nil,
                       lat: Double? = nil, lng: Double? = nil, radius: Double? = nil,
                       minRating: Double? = nil,
                       sort: String? = nil, page: Int = 1, limit: Int = 25) async throws -> [APIHelper] {
        var q: [String: Any] = ["page": page, "limit": limit]
        if let query { q["query"] = query }
        if let lat { q["lat"] = lat }
        if let lng { q["lng"] = lng }
        if let radius { q["radius"] = radius }
        if let minRating { q["minRating"] = minRating }
        if let sort { q["sort"] = sort }
        return try await APIClient.shared.request("/api/helpers", query: q, requiresAuth: false)
    }

    /// Generic profile object (server returns lots of optional fields).
    static func profile(_ helperId: String) async throws -> [String: AnyDecodable] {
        try await APIClient.shared.request("/api/helpers/\(helperId)/profile", requiresAuth: false)
    }
}

/// Helper: decode arbitrary JSON values.
struct AnyDecodable: Decodable {
    let value: Any?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(String.self) { value = v }
        else if let v = try? c.decode(Int.self) { value = v }
        else if let v = try? c.decode(Double.self) { value = v }
        else if let v = try? c.decode(Bool.self) { value = v }
        else if c.decodeNil() { value = nil }
        else { value = nil }
    }
}
