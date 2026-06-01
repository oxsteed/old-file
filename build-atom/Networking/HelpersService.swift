import Foundation

enum HelpersService {
    static func browse(query: String? = nil,
                       categories: [String]? = nil,
                       skills: [String]? = nil,
                       verified: Bool? = nil,
                       backgroundChecked: Bool? = nil,
                       availableToday: Bool? = nil,
                       lat: Double? = nil, lng: Double? = nil, radius: Double? = nil,
                       minPrice: Int? = nil,
                       maxPrice: Int? = nil,
                       minRating: Double? = nil,
                       sort: String? = nil, page: Int = 1, limit: Int = 25) async throws -> [APIHelper] {
        var q: [String: Any] = ["page": page, "limit": limit]
        if let query { q["query"] = query }
        if let categories, !categories.isEmpty { q["categories"] = categories.joined(separator: ",") }
        if let skills, !skills.isEmpty { q["skills"] = skills.joined(separator: ",") }
        if let verified { q["verified"] = verified ? "true" : "false" }
        if let backgroundChecked { q["backgroundChecked"] = backgroundChecked ? "true" : "false" }
        if let availableToday { q["availableToday"] = availableToday ? "true" : "false" }
        if let lat { q["lat"] = lat }
        if let lng { q["lng"] = lng }
        if let radius { q["radius"] = radius }
        if let minPrice { q["minPrice"] = minPrice }
        if let maxPrice { q["maxPrice"] = maxPrice }
        if let minRating { q["minRating"] = minRating }
        if let sort { q["sort"] = sort }
        return try await APIClient.shared.request("/api/helpers", query: q, requiresAuth: false)
    }

    /// Generic profile object (server returns lots of optional fields).
    static func profile(_ helperId: String) async throws -> [String: AnyDecodable] {
        try await APIClient.shared.request("/api/helpers/\(helperId)/profile", requiresAuth: false)
    }

    /// Get helper's available booking slots for a date range.
    static func availability(_ helperId: String, fromDate: String, toDate: String) async throws -> AvailabilitySlotsResponse {
        let q: [String: Any] = ["from_date": fromDate, "to_date": toDate]
        return try await APIClient.shared.request("/api/helpers/\(helperId)/availability", query: q, requiresAuth: false)
    }
}

/// Helper: decode arbitrary JSON values.
struct AnyDecodable: Decodable {
    let value: Any?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(String.self) { value = v; return }
        if let v = try? c.decode(Int.self) { value = v; return }
        if let v = try? c.decode(Double.self) { value = v; return }
        if let v = try? c.decode(Bool.self) { value = v; return }
        if c.decodeNil() { value = nil; return }

        if let arr = try? c.decode([AnyDecodable].self) {
            value = arr.map { $0.value }
            return
        }
        if let dict = try? c.decode([String: AnyDecodable].self) {
            var out: [String: Any?] = [:]
            out.reserveCapacity(dict.count)
            for (k, v) in dict { out[k] = v.value }
            value = out
            return
        }
        value = nil
    }
}
