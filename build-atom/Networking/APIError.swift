import Foundation

/// Unified error type for all networking calls.
enum APIError: LocalizedError, Equatable {
    case invalidURL
    case notAuthenticated
    case unauthorized                       // 401 — try refresh
    case forbidden(String?)                 // 403
    case notFound
    case validation(message: String, fields: [String: String])
    case rateLimited(retryAfter: TimeInterval?)
    case server(code: Int, message: String?)
    case decoding(String)
    case network(String)
    case offline
    case unknown

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Bad URL."
        case .notAuthenticated: return "Please sign in."
        case .unauthorized: return "Session expired. Please sign in again."
        case .forbidden(let m): return m ?? "You don't have access."
        case .notFound: return "Not found."
        case .validation(let m, _): return m
        case .rateLimited(let retry):
            if let retry { return "Too many requests. Try again in \(Int(retry))s." }
            return "Too many requests. Try again shortly."
        case .server(_, let m): return m ?? "Server error. Please try again."
        case .decoding(let m): return "Decode error: \(m)"
        case .network(let m): return m
        case .offline: return "You're offline."
        case .unknown: return "Something went wrong."
        }
    }
}

/// Server error payload shape.
struct ServerErrorPayload: Decodable {
    let success: Bool?
    let error: String?
    let code: Int?
    let fields: [String: String]?
    let message: String?
}
