import Foundation
import Observation

enum OxSteedAPIError: Error, LocalizedError {
    case invalidURL(String)
    case invalidResponse
    case unauthorized
    case server(statusCode: Int, body: String)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let path):
            "Invalid API path: \(path)"
        case .invalidResponse:
            "The server returned a response the app could not understand."
        case .unauthorized:
            "Please sign in again to continue."
        case .server(let statusCode, let body):
            "Server error \(statusCode): \(body)"
        }
    }
}

struct EmptyResponse: Decodable {}

struct AuthenticatedUser: Codable, Equatable {
    let id: Int
    let email: String
    let role: String?
    let defaultMode: String?
    let name: String?
}

struct AuthResponse: Codable {
    let token: String?
    let refreshToken: String?
    let user: AuthenticatedUser?
    let requiresTwoFactor: Bool?
}

struct LoginRequest: Encodable {
    let email: String
    let password: String
    let twoFactorCode: String?
}

@Observable
final class OxSteedAPIClient {
    var baseURL: URL
    var authToken: String?
    var refreshToken: String?

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(
        baseURL: URL = URL(string: "https://oxsteed.com/api")!,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }

    func get<Response: Decodable>(_ path: String) async throws -> Response {
        try await request(path, method: "GET", body: Optional<Data>.none)
    }

    func post<Request: Encodable, Response: Decodable>(_ path: String, body: Request) async throws -> Response {
        let payload = try encoder.encode(body)
        return try await request(path, method: "POST", body: payload)
    }

    func post<Response: Decodable>(_ path: String) async throws -> Response {
        try await request(path, method: "POST", body: Optional<Data>.none)
    }

    func request<Response: Decodable>(_ path: String, method: String, body: Data?) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw OxSteedAPIError.invalidURL(path)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let authToken {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw OxSteedAPIError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200..<300:
            if data.isEmpty, Response.self == EmptyResponse.self {
                return EmptyResponse() as! Response
            }
            return try decoder.decode(Response.self, from: data)
        case 401:
            throw OxSteedAPIError.unauthorized
        default:
            let body = String(data: data, encoding: .utf8) ?? "No response body"
            throw OxSteedAPIError.server(statusCode: httpResponse.statusCode, body: body)
        }
    }
}
