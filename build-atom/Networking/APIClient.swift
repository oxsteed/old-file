import Foundation

/// Thin URLSession-based client that:
///   • attaches Bearer access token to every request
///   • automatically refreshes the token on 401 and retries once
///   • surfaces server validation errors via `APIError.validation`
///   • obeys `Retry-After` for 429 responses
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private var refreshTask: Task<Void, Error>?
    private var csrfToken: String?

    init(session: URLSession = .shared) {
        self.session = session
        self.csrfToken = UserDefaults.standard.string(forKey: "ox.csrf.token")

        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        // Many backends use snake_case
        dec.keyDecodingStrategy = .useDefaultKeys
        self.decoder = dec

        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.keyEncodingStrategy = .useDefaultKeys
        self.encoder = enc
    }

    // MARK: - Public request

    /// Perform a request and decode the response body.
    func request<T: Decodable>(
        _ path: String,
        method: HTTPMethod = .GET,
        query: [String: Any]? = nil,
        body: Encodable? = nil,
        requiresAuth: Bool = true,
        as type: T.Type = T.self
    ) async throws -> T {
        let data = try await rawRequest(path, method: method, query: query, body: body, requiresAuth: requiresAuth)
        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            let preview = String(data: data.prefix(400), encoding: .utf8) ?? ""
            OXLog.error("decode failed for \(path): \(String(describing: error)) | body: \(preview)", category: "api")
            throw APIError.decoding(String(describing: error))
        }
    }

    /// Perform a request and discard the body.
    func requestVoid(
        _ path: String,
        method: HTTPMethod = .GET,
        query: [String: Any]? = nil,
        body: Encodable? = nil,
        requiresAuth: Bool = true
    ) async throws {
        _ = try await rawRequest(path, method: method, query: query, body: body, requiresAuth: requiresAuth)
    }

    /// Raw bytes (used by file uploads / iCal export).
    func rawData(
        _ path: String,
        method: HTTPMethod = .GET,
        query: [String: Any]? = nil,
        body: Encodable? = nil,
        requiresAuth: Bool = true
    ) async throws -> Data {
        try await rawRequest(path, method: method, query: query, body: body, requiresAuth: requiresAuth)
    }

    // MARK: - Core

    private func rawRequest(
        _ path: String,
        method: HTTPMethod,
        query: [String: Any]?,
        body: Encodable?,
        requiresAuth: Bool,
        isRetry: Bool = false
    ) async throws -> Data {
        var req = try buildRequest(path: path, method: method, query: query, body: body)
        if requiresAuth {
            // Wait for any in-flight refresh
            if let task = refreshTask { _ = try? await task.value }
            guard let token = KeychainManager.shared.getAccessToken() else {
                throw APIError.notAuthenticated
            }
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            if method != .GET, let csrfToken {
                req.setValue(csrfToken, forHTTPHeaderField: "X-CSRF-Token")
            }
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch let urlErr as URLError {
            if urlErr.code == .notConnectedToInternet || urlErr.code == .networkConnectionLost {
                throw APIError.offline
            }
            throw APIError.network(urlErr.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.unknown }
        updateCsrfToken(from: http)

        switch http.statusCode {
        case 200...299:
            return data

        case 401:
            // Try to refresh once
            if requiresAuth && !isRetry {
                do {
                    try await refreshAccessToken()
                    return try await rawRequest(path, method: method, query: query, body: body, requiresAuth: requiresAuth, isRetry: true)
                } catch {
                    NotificationCenter.default.post(name: .oxAuthExpired, object: nil)
                    throw APIError.unauthorized
                }
            }
            throw APIError.unauthorized

        case 403:
            let payload = parseError(data)
            if requiresAuth,
               !isRetry,
               ((payload.error ?? "").lowercased().contains("csrf") || (payload.message ?? "").lowercased().contains("csrf")) {
                return try await rawRequest(path, method: method, query: query, body: body, requiresAuth: requiresAuth, isRetry: true)
            }
            throw APIError.forbidden(payload.error)

        case 404:
            throw APIError.notFound

        case 400, 422:
            let payload = parseError(data)
            throw APIError.validation(message: payload.error ?? payload.message ?? "Validation failed",
                                      fields: payload.fields ?? [:])

        case 429:
            let retryAfter = http.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init)
                ?? http.value(forHTTPHeaderField: "X-RateLimit-Reset").flatMap {
                    guard let ts = TimeInterval($0) else { return nil }
                    return max(0, ts - Date().timeIntervalSince1970)
                }
            throw APIError.rateLimited(retryAfter: retryAfter)

        case 500...599:
            throw APIError.server(code: http.statusCode, message: parseError(data).error)

        default:
            throw APIError.server(code: http.statusCode, message: parseError(data).error)
        }
    }

    // MARK: - Request building

    private func buildRequest(
        path: String,
        method: HTTPMethod,
        query: [String: Any]?,
        body: Encodable?
    ) throws -> URLRequest {
        // `URL.appendingPathComponent` treats a leading "/" as a literal path component, producing
        // percent-encoded URLs like `https://api.oxsteed.com/%2Fapi%2F...`.
        // The integration guide paths are written with a leading slash, so resolve as a relative URL.
        guard let resolved = URL(string: path, relativeTo: APIConfig.baseURL)?.absoluteURL,
              var comps = URLComponents(url: resolved, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        if let query, !query.isEmpty {
            comps.queryItems = query.flatMap { key, value -> [URLQueryItem] in
                if let arr = value as? [Any] {
                    return arr.map { URLQueryItem(name: key, value: String(describing: $0)) }
                }
                return [URLQueryItem(name: key, value: "\(value)")]
            }
        }
        guard let url = comps.url else { throw APIError.invalidURL }

        var req = URLRequest(url: url, timeoutInterval: APIConfig.defaultTimeout)
        req.httpMethod = method.rawValue
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(AnyEncodable(body))
        }
        return req
    }

    private func parseError(_ data: Data) -> ServerErrorPayload {
        (try? JSONDecoder().decode(ServerErrorPayload.self, from: data))
            ?? ServerErrorPayload(success: false, error: nil, code: nil, fields: nil, message: nil)
    }

    private func updateCsrfToken(from response: HTTPURLResponse) {
        guard let token = response.value(forHTTPHeaderField: "X-CSRF-Token"),
              !token.isEmpty else { return }
        csrfToken = token
        UserDefaults.standard.set(token, forKey: "ox.csrf.token")
    }

    // MARK: - Token refresh

    /// Refreshes the access token using the refresh token.
    /// Coalesces concurrent callers so only one refresh fires.
    func refreshAccessToken() async throws {
        if let existing = refreshTask {
            _ = try await existing.value
            return
        }
        let task = Task<Void, Error> { [weak self] in
            guard let self else { return }
            try await self.performRefresh()
        }
        refreshTask = task
        defer { refreshTask = nil }
        _ = try await task.value
    }

    private func performRefresh() async throws {
        guard let refreshToken = KeychainManager.shared.getRefreshToken() else {
            throw APIError.unauthorized
        }
        // Prefer the web-domain auth backend (`https://oxsteed.com/api/auth/refresh`) as per the Auth brief.
        do {
            let refreshed = try await AuthService.refresh(refreshToken: refreshToken)
            KeychainManager.shared.saveAccessToken(refreshed.accessToken)
            KeychainManager.shared.saveRefreshToken(refreshed.refreshToken)
            // Server doesn't return expiresIn here; access token TTL is 15 minutes.
            KeychainManager.shared.saveExpiry(900)
            return
        } catch {
            // Fallback: legacy refresh endpoint on the API host (used by older backend deployments).
            struct Req: Encodable { let refreshToken: String }
            struct Resp: Decodable {
                let accessToken: String
                let refreshToken: String
                let expiresIn: Int
            }
            var req = try buildRequest(path: "/api/auth/refresh", method: .POST, query: nil, body: Req(refreshToken: refreshToken))
            req.setValue(nil, forHTTPHeaderField: "Authorization")

            let (data, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                throw APIError.unauthorized
            }
            let resp = try decoder.decode(Resp.self, from: data)
            KeychainManager.shared.saveAccessToken(resp.accessToken)
            KeychainManager.shared.saveRefreshToken(resp.refreshToken)
            KeychainManager.shared.saveExpiry(resp.expiresIn)
        }
    }
}

// MARK: - Helpers

struct EmptyResponse: Decodable {}

/// Erases a concrete `Encodable` so we can keep `body: Encodable?` ergonomic.
private struct AnyEncodable: Encodable {
    let value: Encodable
    init(_ value: Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

extension Notification.Name {
    static let oxAuthExpired = Notification.Name("ox.auth.expired")
    static let oxSocketMessage = Notification.Name("ox.socket.message")
}

// MARK: - Web-domain Auth API client

/// Separate client for OxSteed's web-domain auth backend (`https://oxsteed.com/api/...`).
/// Keeps the main API client pointed at `https://api.oxsteed.com` for other services.
actor AuthAPIClient {
    static let shared = AuthAPIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private var refreshTask: Task<Void, Error>?
    private var csrfToken: String?

    init(session: URLSession = .shared) {
        self.session = session
        self.csrfToken = UserDefaults.standard.string(forKey: "ox.csrf.token")

        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        dec.keyDecodingStrategy = .useDefaultKeys
        self.decoder = dec

        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.keyEncodingStrategy = .useDefaultKeys
        self.encoder = enc
    }

    func request<T: Decodable>(
        _ path: String,
        method: HTTPMethod = .GET,
        query: [String: Any]? = nil,
        body: Encodable? = nil,
        requiresAuth: Bool = true,
        as type: T.Type = T.self
    ) async throws -> T {
        let data = try await rawRequest(path, method: method, query: query, body: body, requiresAuth: requiresAuth)
        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            let preview = String(data: data.prefix(400), encoding: .utf8) ?? ""
            OXLog.error("auth decode failed for \(path): \(String(describing: error)) | body: \(preview)", category: "auth")
            throw APIError.decoding(String(describing: error))
        }
    }

    func requestVoid(
        _ path: String,
        method: HTTPMethod = .GET,
        query: [String: Any]? = nil,
        body: Encodable? = nil,
        requiresAuth: Bool = true
    ) async throws {
        _ = try await rawRequest(path, method: method, query: query, body: body, requiresAuth: requiresAuth)
    }

    private func rawRequest(
        _ path: String,
        method: HTTPMethod,
        query: [String: Any]?,
        body: Encodable?,
        requiresAuth: Bool,
        isRetry: Bool = false
    ) async throws -> Data {
        var req = try buildRequest(path: path, method: method, query: query, body: body)
        if requiresAuth {
            if let task = refreshTask { _ = try? await task.value }
            guard let token = KeychainManager.shared.getAccessToken() else { throw APIError.notAuthenticated }
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            if method != .GET, let csrfToken {
                req.setValue(csrfToken, forHTTPHeaderField: "X-CSRF-Token")
            }
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch let urlErr as URLError {
            if urlErr.code == .notConnectedToInternet || urlErr.code == .networkConnectionLost {
                throw APIError.offline
            }
            throw APIError.network(urlErr.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.unknown }
        updateCsrfToken(from: http)

        switch http.statusCode {
        case 200...299:
            return data
        case 401:
            if requiresAuth && !isRetry {
                do {
                    try await refreshAccessToken()
                    return try await rawRequest(path, method: method, query: query, body: body, requiresAuth: requiresAuth, isRetry: true)
                } catch {
                    NotificationCenter.default.post(name: .oxAuthExpired, object: nil)
                    throw APIError.unauthorized
                }
            }
            throw APIError.unauthorized
        case 403:
            let payload = parseError(data)
            if requiresAuth,
               !isRetry,
               ((payload.error ?? "").lowercased().contains("csrf") || (payload.message ?? "").lowercased().contains("csrf")) {
                return try await rawRequest(path, method: method, query: query, body: body, requiresAuth: requiresAuth, isRetry: true)
            }
            throw APIError.forbidden(payload.error)
        case 404:
            throw APIError.notFound
        case 400, 409, 422:
            let payload = parseError(data)
            throw APIError.validation(message: payload.error ?? payload.message ?? "Request failed",
                                      fields: payload.fields ?? [:])
        case 429:
            let retryAfter = http.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init)
            throw APIError.rateLimited(retryAfter: retryAfter)
        case 500...599:
            throw APIError.server(code: http.statusCode, message: parseError(data).error)
        default:
            throw APIError.server(code: http.statusCode, message: parseError(data).error)
        }
    }

    private func buildRequest(
        path: String,
        method: HTTPMethod,
        query: [String: Any]?,
        body: Encodable?
    ) throws -> URLRequest {
        guard let resolved = URL(string: path, relativeTo: AuthAPIConfig.baseURL)?.absoluteURL,
              var comps = URLComponents(url: resolved, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        if let query, !query.isEmpty {
            comps.queryItems = query.flatMap { key, value -> [URLQueryItem] in
                if let arr = value as? [Any] {
                    return arr.map { URLQueryItem(name: key, value: String(describing: $0)) }
                }
                return [URLQueryItem(name: key, value: "\(value)")]
            }
        }
        guard let url = comps.url else { throw APIError.invalidURL }

        var req = URLRequest(url: url, timeoutInterval: AuthAPIConfig.defaultTimeout)
        req.httpMethod = method.rawValue
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(AnyEncodable(body))
        }
        return req
    }

    private func parseError(_ data: Data) -> ServerErrorPayload {
        (try? JSONDecoder().decode(ServerErrorPayload.self, from: data))
            ?? ServerErrorPayload(success: false, error: nil, code: nil, fields: nil, message: nil)
    }

    private func updateCsrfToken(from response: HTTPURLResponse) {
        guard let token = response.value(forHTTPHeaderField: "X-CSRF-Token"),
              !token.isEmpty else { return }
        csrfToken = token
        UserDefaults.standard.set(token, forKey: "ox.csrf.token")
    }

    // MARK: - Token refresh

    func refreshAccessToken() async throws {
        if let existing = refreshTask {
            _ = try await existing.value
            return
        }
        let task = Task<Void, Error> { [weak self] in
            guard let self else { return }
            try await self.performRefresh()
        }
        refreshTask = task
        defer { refreshTask = nil }
        _ = try await task.value
    }

    private func performRefresh() async throws {
        guard let refreshToken = KeychainManager.shared.getRefreshToken() else {
            throw APIError.unauthorized
        }
        struct Req: Encodable { let refreshToken: String }
        struct Resp: Decodable { let accessToken: String; let refreshToken: String }
        let resp: Resp = try await request("/api/auth/refresh", method: .POST,
                                           body: Req(refreshToken: refreshToken),
                                           requiresAuth: false)
        KeychainManager.shared.saveAccessToken(resp.accessToken)
        KeychainManager.shared.saveRefreshToken(resp.refreshToken)
    }
}
