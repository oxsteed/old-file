import Foundation

enum BidsService {
    static func myBids(status: String? = nil, limit: Int = 50, offset: Int = 0) async throws -> [APIBid] {
        var q: [String: Any] = ["limit": limit, "offset": offset]
        if let status { q["status"] = status }
        return try await APIClient.shared.request("/api/bids/me", query: q)
    }

    static func bidsForJob(_ jobId: String) async throws -> [APIBid] {
        try await APIClient.shared.request("/api/bids/job/\(jobId)")
    }

    static func place(_ req: BidCreateRequest) async throws -> APIBid {
        try await APIClient.shared.request("/api/bids", method: .POST, body: req)
    }

    static func setStatus(_ bidId: String, status: String) async throws -> APIBid {
        struct Req: Encodable { let status: String }
        return try await APIClient.shared.request("/api/bids/\(bidId)", method: .PUT, body: Req(status: status))
    }

    static func withdraw(_ bidId: String) async throws {
        try await APIClient.shared.requestVoid("/api/bids/\(bidId)/withdraw", method: .POST)
    }
}
