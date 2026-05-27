import Foundation

// MARK: - Errors

enum OneAPIError: Error, LocalizedError {
    case invalidURL(String)
    case invalidResponse
    case unauthorized
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let path):  return "Invalid API path: \(path)"
        case .invalidResponse:       return "OxSteed returned an unreadable response."
        case .unauthorized:          return "Your session expired. Please sign in again."
        case .server(let s, let b):  return "Server \(s): \(b)"
        }
    }
}

// MARK: - Multipart helper

struct OneMultipartFile {
    let fieldName: String
    let fileName: String
    let mimeType: String
    let data: Data
}

// MARK: - Client

final class OxSteedOneAPIClient {
    var baseURL = URL(string: "https://app.oxsteed.com/api")!
    var token: String?
    var tokenProvider: (() -> String?)?
    var refreshTokenHandler: (() async -> Bool)?
    var onUnauthorized: (() -> Void)?
    var onRequestBuilt: ((_ path: String, _ hasAuth: Bool) -> Void)?

    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(session: URLSession = .shared) {
        self.session = session
        encoder.keyEncodingStrategy = .convertToSnakeCase
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    func get<R: Decodable>(_ path: String) async throws -> R {
        try await perform(path, method: "GET", body: nil, didRetry: false)
    }

    func post<B: Encodable, R: Decodable>(_ path: String, body: B) async throws -> R {
        try await perform(path, method: "POST", body: encoder.encode(body), didRetry: false)
    }

    func put<B: Encodable, R: Decodable>(_ path: String, body: B) async throws -> R {
        try await perform(path, method: "PUT", body: encoder.encode(body), didRetry: false)
    }

    func postRaw<R: Decodable>(_ path: String, bodyData: Data) async throws -> R {
        try await perform(path, method: "POST", body: bodyData, didRetry: false)
    }

    func sendRaw(path: String, method: String, bodyData: Data) async throws {
        _ = try await sendRawRetry(path: path, method: method, body: bodyData, didRetry: false)
    }

    // MARK: - Core

    private func perform<R: Decodable>(
        _ path: String, method: String, body: Data?, didRetry: Bool
    ) async throws -> R {
        guard let url = resolve(path) else { throw OneAPIError.invalidURL(path) }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        attachToken(&req)
        onRequestBuilt?(path, req.value(forHTTPHeaderField: "Authorization") != nil)

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw OneAPIError.invalidResponse }

        if http.statusCode == 401 {
            if didRetry { onUnauthorized?(); throw OneAPIError.unauthorized }
            if let handler = refreshTokenHandler, await handler() {
                return try await perform(path, method: method, body: body, didRetry: true)
            }
            onUnauthorized?()
            throw OneAPIError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else {
            throw OneAPIError.server(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }
        return try decoder.decode(R.self, from: data)
    }

    private func sendRawRetry(path: String, method: String, body: Data?, didRetry: Bool) async throws -> Data {
        guard let url = resolve(path) else { throw OneAPIError.invalidURL(path) }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        attachToken(&req)

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw OneAPIError.invalidResponse }

        if http.statusCode == 401 {
            if didRetry { onUnauthorized?(); throw OneAPIError.unauthorized }
            if let handler = refreshTokenHandler, await handler() {
                return try await sendRawRetry(path: path, method: method, body: body, didRetry: true)
            }
            onUnauthorized?()
            throw OneAPIError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else {
            throw OneAPIError.server(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }

    // MARK: - Helpers

    private func attachToken(_ req: inout URLRequest) {
        if let t = tokenProvider?() ?? token {
            req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
        }
    }

    private func resolve(_ path: String) -> URL? {
        if let abs = URL(string: path), abs.scheme != nil { return abs }
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        var base = baseURL
        if !base.absoluteString.hasSuffix("/") { base = base.appendingPathComponent("") }
        let rel = trimmed.hasPrefix("/") ? String(trimmed.dropFirst()) : trimmed
        return URL(string: rel, relativeTo: base)
    }
}

// MARK: - Error mapper

enum OneErrorMapper {
    static func userMessage(for error: Error, fallback: String) -> String {
        guard let api = error as? OneAPIError else { return fallback }
        switch api {
        case .unauthorized:
            return "Your session expired. Please sign in again."
        case .invalidURL:
            return "App configuration error. Please update OxSteed One."
        case .invalidResponse:
            return "OxSteed returned an unreadable response. Try again."
        case .server(let status, let body):
            if let msg = backendMessage(body), (400...499).contains(status) { return msg }
            if status == 429 { return "Too many requests. Please wait a moment." }
            if (500...599).contains(status) { return "OxSteed server is temporarily unavailable." }
            return fallback
        }
    }

    private static func backendMessage(_ body: String) -> String? {
        guard let data = body.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if let m = obj["error"] as? String, !m.isEmpty { return m }
        if let m = obj["message"] as? String, !m.isEmpty { return m }
        return nil
    }
}
