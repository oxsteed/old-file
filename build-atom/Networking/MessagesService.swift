import Foundation

enum MessagesService {
    static func conversations(includeArchived: Bool = false) async throws -> [APIConversation] {
        let q: [String: Any] = ["include_archived": includeArchived ? "true" : "false"]
        return try await APIClient.shared.request("/api/messages/conversations", query: q)
    }

    static func openOrCreate(helperId: String?, customerId: String?, jobId: String?) async throws -> APIConversation {
        struct Req: Encodable { let helper_id: String?; let customer_id: String?; let job_id: String? }
        return try await APIClient.shared.request(
            "/api/messages/conversations",
            method: .POST,
            body: Req(helper_id: helperId, customer_id: customerId, job_id: jobId)
        )
    }

    static func messages(in conversationId: String, limit: Int = 50, offset: Int = 0) async throws -> [APIMessage] {
        let q: [String: Any] = ["limit": limit, "offset": offset]
        return try await APIClient.shared.request("/api/messages/conversations/\(conversationId)", query: q)
    }

    static func send(_ conversationId: String, content: String,
                     attachments: [APIAttachment]? = nil) async throws -> APIMessage {
        try await APIClient.shared.request(
            "/api/messages/conversations/\(conversationId)",
            method: .POST,
            body: SendMessageRequest(content: content, attachments: attachments)
        )
    }

    static func archive(_ conversationId: String) async throws {
        try await APIClient.shared.requestVoid("/api/messages/conversations/\(conversationId)/archive", method: .POST)
    }

    static func deleteMessage(_ conversationId: String, messageId: String) async throws {
        try await APIClient.shared.requestVoid("/api/messages/conversations/\(conversationId)/\(messageId)", method: .DELETE)
    }
}
