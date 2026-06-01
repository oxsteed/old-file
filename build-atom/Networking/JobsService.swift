import Foundation

enum JobsService {
    private struct JobsPage: Decodable {
        let jobs: [APIJob]
    }

    private struct JobEnvelope: Decodable {
        let job: APIJob
    }

    static func browse(category: String? = nil,
                       categoryId: String? = nil,
                       skills: [String]? = nil,
                       lat: Double? = nil, lng: Double? = nil, radius: Double? = nil,
                       sort: String? = nil,
                       budgetMin: Int? = nil,
                       budgetMax: Int? = nil,
                       status: String? = nil,
                       locationCountry: String? = nil,
                       page: Int = 1, limit: Int = 25) async throws -> [APIJob] {
        var q: [String: Any] = ["page": page, "limit": limit]
        if let category { q["category"] = category }
        if let categoryId { q["category_id"] = categoryId }
        if let skills, !skills.isEmpty { q["skills"] = skills.joined(separator: ",") }
        if let lat { q["lat"] = lat }
        if let lng { q["lng"] = lng }
        if let radius { q["radius"] = radius }
        if let sort {
            q["sort"] = (sort == "closest") ? "nearest" : sort
        }
        if let budgetMin { q["budget_min"] = budgetMin }
        if let budgetMax { q["budget_max"] = budgetMax }
        if let status { q["status"] = status }
        if let locationCountry { q["location_country"] = locationCountry }
        do {
            let page: JobsPage = try await APIClient.shared.request("/api/jobs", query: q, requiresAuth: false)
            return page.jobs
        } catch {
            return try await APIClient.shared.request("/api/jobs", query: q, requiresAuth: false)
        }
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
        do {
            let envelope: JobEnvelope = try await APIClient.shared.request("/api/jobs/\(jobId)/start", method: .POST)
            return envelope.job
        } catch {
            if let decodeError = error as? DecodingError {
                _ = decodeError
                return try await APIClient.shared.request("/api/jobs/\(jobId)/start", method: .POST)
            }
            throw error
        }
    }

    static func complete(_ jobId: String, notes: String? = nil, mediaUrls: [String] = []) async throws -> APIJob {
        struct Req: Encodable { let notes: String?; let media_urls: [String] }
        let body = Req(notes: notes, media_urls: mediaUrls)
        do {
            let envelope: JobEnvelope = try await APIClient.shared.request(
                "/api/jobs/\(jobId)/complete",
                method: .POST,
                body: body
            )
            return envelope.job
        } catch {
            if let decodeError = error as? DecodingError {
                _ = decodeError
                return try await APIClient.shared.request(
                    "/api/jobs/\(jobId)/complete",
                    method: .POST,
                    body: body
                )
            }
            throw error
        }
    }
}
