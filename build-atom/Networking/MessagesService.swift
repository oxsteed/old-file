import Foundation

enum MessagesService {
    private struct SearchResponse: Decodable {
        let results: [APIMessage]
    }

    private struct ArchivedResponse: Decodable {
        let archived: [APIConversation]
    }

    static func conversations(businessId: String? = nil, includeArchived: Bool = false) async throws -> [APIConversation] {
        var q: [String: Any] = ["include_archived": includeArchived ? "true" : "false"]
        if let businessId { q["business_id"] = businessId }
        return try await APIClient.shared.request("/api/messages/conversations", query: q)
    }

    static func openOrCreate(helperId: String?, customerId: String?, jobId: String?) async throws -> APIConversation {
        struct Req: Encodable { let helperId: String?; let jobId: String? }
        return try await APIClient.shared.request(
            "/api/messages/conversations",
            method: .POST,
            body: Req(helperId: helperId, jobId: jobId)
        )
    }

    static func conversationMeta(_ conversationId: String) async throws -> APIConversation {
        try await APIClient.shared.request("/api/messages/conversations/\(conversationId)/meta")
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

    static func restore(_ conversationId: String) async throws {
        try await APIClient.shared.requestVoid("/api/messages/conversations/\(conversationId)/restore", method: .POST)
    }

    static func archived() async throws -> [APIConversation] {
        do {
            let response: ArchivedResponse = try await APIClient.shared.request("/api/messages/archived")
            return response.archived
        } catch {
            return try await APIClient.shared.request("/api/messages/archived")
        }
    }

    static func deleteMessage(_ conversationId: String, messageId: String) async throws {
        try await APIClient.shared.requestVoid("/api/messages/conversations/\(conversationId)/\(messageId)", method: .DELETE)
    }

    static func editMessage(_ conversationId: String, messageId: String, content: String) async throws -> APIMessage {
        struct Req: Encodable { let content: String }
        return try await APIClient.shared.request(
            "/api/messages/conversations/\(conversationId)/\(messageId)",
            method: .PUT,
            body: Req(content: content)
        )
    }

    static func search(_ conversationId: String, query: String, limit: Int = 50, offset: Int = 0) async throws -> [APIMessage] {
        let q: [String: Any] = ["q": query, "limit": limit, "offset": offset]
        do {
            let response: SearchResponse = try await APIClient.shared.request("/api/messages/conversations/\(conversationId)/search", query: q)
            return response.results
        } catch {
            return try await APIClient.shared.request("/api/messages/conversations/\(conversationId)/search", query: q)
        }
    }

    static func addReaction(_ conversationId: String, messageId: String, emoji: String) async throws -> [String: AnyDecodable] {
        struct Req: Encodable { let emoji: String }
        return try await APIClient.shared.request(
            "/api/messages/conversations/\(conversationId)/\(messageId)/reactions",
            method: .POST,
            body: Req(emoji: emoji)
        )
    }

    static func removeReaction(_ conversationId: String, messageId: String, emoji: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/messages/conversations/\(conversationId)/\(messageId)/reactions",
            method: .DELETE,
            query: ["emoji": emoji]
        )
    }

    static func uploadAttachment(_ conversationId: String,
                                 data: Data,
                                 filename: String,
                                 mimeType: String) async throws -> APIAttachmentUpload {
        try await UploadService.uploadConversationAttachment(conversationId: conversationId,
                                                            data: data,
                                                            filename: filename,
                                                            mimeType: mimeType)
    }

    // MARK: - Block / Report (Apple Guideline 1.2)

    /// Block a user by their numeric ID.
    static func blockUser(_ userId: Int) async throws {
        struct Req: Encodable {}
        try await APIClient.shared.requestVoid(
            "/api/messages/users/\(userId)/block",
            method: .POST,
            body: Req()
        )
    }

    /// Unblock a previously blocked user.
    static func unblockUser(_ userId: Int) async throws {
        try await APIClient.shared.requestVoid(
            "/api/messages/users/\(userId)/block",
            method: .DELETE
        )
    }

    /// Submit a content or user report.
    static func reportContent(
        reportedUserId: String?,
        contentType: String,
        contentId: String?,
        reason: String,
        description: String?
    ) async throws {
        struct Req: Encodable {
            let reportedUserId: String?
            let contentType: String
            let contentId: String?
            let reason: String
            let description: String?
        }
        try await APIClient.shared.requestVoid(
            "/api/messages/report",
            method: .POST,
            body: Req(reportedUserId: reportedUserId,
                      contentType: contentType,
                      contentId: contentId,
                      reason: reason,
                      description: description)
        )
    }
}
