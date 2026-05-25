import Foundation

enum OneAPIError: Error, LocalizedError {
    case invalidURL(String)
    case invalidResponse
    case unauthorized
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let path): return "Invalid API path: \(path)"
        case .invalidResponse: return "OxSteed returned an unreadable response."
        case .unauthorized: return "Your session expired. Please sign in again."
        case .server(let status, let body): return "Server \(status): \(body)"
        }
    }
}

final class OxSteedOneAPIClient {
    var baseURL = URL(string: "https://app.oxsteed.com/api")!
    var token: String?
    var tokenProvider: (() -> String?)?
    var refreshTokenHandler: (() async -> Bool)?
    var onUnauthorized: (() -> Void)?

    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(session: URLSession = .shared) {
        self.session = session
        encoder.keyEncodingStrategy = .convertToSnakeCase
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    func get<Response: Decodable>(_ path: String) async throws -> Response {
        try await request(path, method: "GET", body: Optional<Data>.none)
    }

    func post<Body: Encodable, Response: Decodable>(_ path: String, body: Body) async throws -> Response {
        try await request(path, method: "POST", body: encoder.encode(body))
    }

    func put<Body: Encodable, Response: Decodable>(_ path: String, body: Body) async throws -> Response {
        try await request(path, method: "PUT", body: encoder.encode(body))
    }

    func postRaw<Response: Decodable>(_ path: String, bodyData: Data) async throws -> Response {
        try await request(path, method: "POST", body: bodyData)
    }

    func putRaw<Response: Decodable>(_ path: String, bodyData: Data) async throws -> Response {
        try await request(path, method: "PUT", body: bodyData)
    }

    func sendRaw(path: String, method: String, bodyData: Data) async throws {
        _ = try await sendRawWithRetry(path: path, method: method, body: bodyData, didRetry: false)
    }

    private func request<Response: Decodable>(_ path: String, method: String, body: Data?) async throws -> Response {
        try await performRequest(path, method: method, body: body, didRetry: false)
    }

    private func performRequest<Response: Decodable>(
        _ path: String,
        method: String,
        body: Data?,
        didRetry: Bool
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw OneAPIError.invalidURL(path)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        if let resolvedToken = tokenProvider?() ?? token {
            request.setValue("Bearer \(resolvedToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw OneAPIError.invalidResponse
        }

        if http.statusCode == 401 {
            if didRetry {
                onUnauthorized?()
                throw OneAPIError.unauthorized
            }

            if let refreshTokenHandler, await refreshTokenHandler() {
                return try await performRequest(path, method: method, body: body, didRetry: true)
            }

            onUnauthorized?()
            throw OneAPIError.unauthorized
        }

        guard (200..<300).contains(http.statusCode) else {
            throw OneAPIError.server(http.statusCode, String(data: data, encoding: .utf8) ?? "No body")
        }

        return try decoder.decode(Response.self, from: data)
    }

    private func sendRawWithRetry(
        path: String,
        method: String,
        body: Data?,
        didRetry: Bool
    ) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw OneAPIError.invalidURL(path)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let resolvedToken = tokenProvider?() ?? token {
            request.setValue("Bearer \(resolvedToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw OneAPIError.invalidResponse
        }

        if http.statusCode == 401 {
            if didRetry {
                onUnauthorized?()
                throw OneAPIError.unauthorized
            }
            if let refreshTokenHandler, await refreshTokenHandler() {
                return try await sendRawWithRetry(path: path, method: method, body: body, didRetry: true)
            }
            onUnauthorized?()
            throw OneAPIError.unauthorized
        }

        guard (200..<300).contains(http.statusCode) else {
            throw OneAPIError.server(http.statusCode, String(data: data, encoding: .utf8) ?? "No body")
        }

        return data
    }
}
