import Foundation

enum JobsService {
    static func browse(category: String? = nil,
                       lat: Double? = nil, lng: Double? = nil, radius: Double? = nil,
                       sort: String? = nil, page: Int = 1, limit: Int = 25) async throws -> [APIJob] {
        var q: [String: Any] = ["page": page, "limit": limit]
        if let category { q["category"] = category }
        if let lat { q["lat"] = lat }
        if let lng { q["lng"] = lng }
        if let radius { q["radius"] = radius }
        if let sort { q["sort"] = sort }
        return try await APIClient.shared.request("/api/jobs", query: q, requiresAuth: false)
    }

    static func myJobs(status: String? = nil, limit: Int = 50, offset: Int = 0) async throws -> [APIJob] {
        var q: [String: Any] = ["limit": limit, "offset": offset]
        if let status { q["status"] = status }
        return try await APIClient.shared.request("/api/jobs/me/list", query: q)
    }

    static func detail(_ jobId: String) async throws -> APIJob {
        try await APIClient.shared.request("/api/jobs/\(jobId)", requiresAuth: false)
    }

    static func create(_ req: JobCreateRequest) async throws -> APIJob {
        try await APIClient.shared.request("/api/jobs", method: .POST, body: req)
    }

    static func update(_ jobId: String, _ req: JobCreateRequest) async throws -> APIJob {
        try await APIClient.shared.request("/api/jobs/\(jobId)", method: .PUT, body: req)
    }

    static func cancel(_ jobId: String, reason: String) async throws {
        struct Req: Encodable { let cancellation_reason: String }
        try await APIClient.shared.requestVoid(
            "/api/jobs/\(jobId)/cancel",
            method: .POST,
            body: Req(cancellation_reason: reason)
        )
    }

    static func start(_ jobId: String) async throws -> APIJob {
        try await APIClient.shared.request("/api/jobs/\(jobId)/start", method: .POST)
    }

    static func complete(_ jobId: String, notes: String? = nil, mediaUrls: [String] = []) async throws -> APIJob {
        struct Req: Encodable { let notes: String?; let media_urls: [String] }
        return try await APIClient.shared.request(
            "/api/jobs/\(jobId)/complete",
            method: .POST,
            body: Req(notes: notes, media_urls: mediaUrls)
        )
    }
}
