import Foundation

// MARK: - Notifications

enum NotificationsService {
    static func list(limit: Int = 50, offset: Int = 0, unreadOnly: Bool = false) async throws -> [APINotification] {
        var q: [String: Any] = ["limit": limit, "offset": offset]
        if unreadOnly { q["unread_only"] = "true" }
        return try await APIClient.shared.request("/api/notifications", query: q)
    }
    static func markRead(_ id: String) async throws {
        struct Req: Encodable { let notification_id: String }
        try await APIClient.shared.requestVoid("/api/notifications/mark-read", method: .POST, body: Req(notification_id: id))
    }
    static func preferences() async throws -> NotificationPreferences {
        try await APIClient.shared.request("/api/notifications/preferences")
    }
    static func updatePreferences(_ p: NotificationPreferences) async throws -> NotificationPreferences {
        try await APIClient.shared.request("/api/notifications/preferences", method: .PUT, body: p)
    }
    static func registerPushToken(_ token: String, deviceId: String) async throws {
        struct Req: Encodable { let token: String; let device_type: String; let device_id: String }
        try await APIClient.shared.requestVoid("/api/notifications/push-token", method: .POST,
                                               body: Req(token: token, device_type: "ios", device_id: deviceId))
    }
}

// MARK: - Payments

enum PaymentsService {
    static func createIntent(jobId: String, amount: Int, currency: String = "USD") async throws -> APIPaymentIntent {
        struct Req: Encodable { let job_id: String; let amount: Int; let currency: String }
        return try await APIClient.shared.request("/api/payments/intent", method: .POST,
                                                  body: Req(job_id: jobId, amount: amount, currency: currency))
    }
    static func capture(jobId: String, paymentIntentId: String) async throws {
        struct Req: Encodable { let job_id: String; let payment_intent_id: String }
        try await APIClient.shared.requestVoid("/api/payments/capture", method: .POST,
                                               body: Req(job_id: jobId, payment_intent_id: paymentIntentId))
    }
    static func myPayments(limit: Int = 25, offset: Int = 0) async throws -> PaymentsList {
        try await APIClient.shared.request("/api/payments/me", query: ["limit": limit, "offset": offset])
    }
    static func connectStatus() async throws -> StripeConnectStatus {
        try await APIClient.shared.request("/api/payments/connect/status")
    }
    static func startConnect(country: String = "US", type: String = "individual") async throws -> [String: AnyDecodable] {
        struct Req: Encodable { let country: String; let type: String }
        return try await APIClient.shared.request("/api/payments/connect", method: .POST, body: Req(country: country, type: type))
    }
}

// MARK: - Chat (support / profile)

enum ChatService {
    static func sendSupport(_ content: String, pageContext: String? = nil) async throws -> [String: AnyDecodable] {
        struct Req: Encodable { let content: String; let page_context: String? }
        return try await APIClient.shared.request("/api/chat/message", method: .POST,
                                                  body: Req(content: content, page_context: pageContext),
                                                  requiresAuth: false)
    }
    static func sendToProfile(helperId: String?, businessId: String?, message: String) async throws -> [String: AnyDecodable] {
        struct Req: Encodable { let helper_id: String?; let business_id: String?; let message: String }
        return try await APIClient.shared.request("/api/chat/profile-message", method: .POST,
                                                  body: Req(helper_id: helperId, business_id: businessId, message: message),
                                                  requiresAuth: false)
    }
}

// MARK: - Uploads (multipart)

enum UploadService {
    /// Uploads raw bytes as multipart/form-data.
    static func uploadImage(_ data: Data, filename: String = "image.jpg",
                            mimeType: String = "image/jpeg", purpose: String? = nil) async throws -> UploadResponse {
        try await uploadMultipart(path: "/api/upload/image", field: "image", data: data,
                                  filename: filename, mimeType: mimeType, purpose: purpose)
    }

    static func uploadDocument(_ data: Data, filename: String, mimeType: String = "application/pdf",
                               purpose: String? = nil) async throws -> UploadResponse {
        try await uploadMultipart(path: "/api/upload/document", field: "document", data: data,
                                  filename: filename, mimeType: mimeType, purpose: purpose)
    }

    private static func uploadMultipart(path: String, field: String, data: Data,
                                        filename: String, mimeType: String, purpose: String?) async throws -> UploadResponse {
        guard let token = KeychainManager.shared.getAccessToken() else { throw APIError.notAuthenticated }
        let boundary = "ox-\(UUID().uuidString)"
        var req = URLRequest(url: APIConfig.baseURL.appendingPathComponent(path),
                             timeoutInterval: APIConfig.uploadTimeout)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        var body = Data()
        let nl = "\r\n"
        func append(_ s: String) { body.append(s.data(using: .utf8)!) }
        if let purpose {
            append("--\(boundary)\(nl)")
            append("Content-Disposition: form-data; name=\"purpose\"\(nl)\(nl)\(purpose)\(nl)")
        }
        append("--\(boundary)\(nl)")
        append("Content-Disposition: form-data; name=\"\(field)\"; filename=\"\(filename)\"\(nl)")
        append("Content-Type: \(mimeType)\(nl)\(nl)")
        body.append(data)
        append("\(nl)--\(boundary)--\(nl)")
        req.httpBody = body

        let (respData, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw APIError.server(code: (resp as? HTTPURLResponse)?.statusCode ?? 0,
                                  message: String(data: respData, encoding: .utf8))
        }
        return try JSONDecoder().decode(UploadResponse.self, from: respData)
    }
}
