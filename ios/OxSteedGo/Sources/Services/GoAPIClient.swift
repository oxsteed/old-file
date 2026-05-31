import Foundation

enum GoAPIError: Error, LocalizedError {
    case invalidURL(String)
    case invalidResponse
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let path):
            "Invalid API path: \(path)"
        case .invalidResponse:
            "OxSteed returned an unreadable response."
        case .server(let status, let body):
            "Server \(status): \(body)"
        }
    }
}

final class GoAPIClient {
    var baseURL = URL(string: "https://oxsteed.com/api")!
    var token: String?

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

    func patch<Body: Encodable, Response: Decodable>(_ path: String, body: Body) async throws -> Response {
        try await request(path, method: "PATCH", body: encoder.encode(body))
    }

    private func request<Response: Decodable>(_ path: String, method: String, body: Data?) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw GoAPIError.invalidURL(path)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GoAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw GoAPIError.server(http.statusCode, String(data: data, encoding: .utf8) ?? "No body")
        }
        return try decoder.decode(Response.self, from: data)
    }
}
