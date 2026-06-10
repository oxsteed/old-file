import Foundation

// MARK: - Business review management model

struct BusinessReview: Decodable, Identifiable, Equatable {
    let id: String
    let rating: Int?
    let testimonial: String?
    let response: String?        // business response (base schema)
    let owner_reply: String?     // business reply (review-management schema)
    let owner_reply_at: String?
    let reviewer_name: String?
    let reviewer_avatar: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, rating, testimonial, response, owner_reply, owner_reply_at
        case reviewer_name, reviewer_avatar, created_at
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        rating = try c.decodeFlexibleIntIfPresent(forKey: .rating)
        testimonial = try c.decodeIfPresent(String.self, forKey: .testimonial)
        response = try c.decodeIfPresent(String.self, forKey: .response)
        owner_reply = try c.decodeIfPresent(String.self, forKey: .owner_reply)
        owner_reply_at = try c.decodeIfPresent(String.self, forKey: .owner_reply_at)
        reviewer_name = try c.decodeIfPresent(String.self, forKey: .reviewer_name)
        reviewer_avatar = try c.decodeIfPresent(String.self, forKey: .reviewer_avatar)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }

    /// The business's reply, whichever column holds it.
    var replyText: String? {
        if let r = owner_reply, !r.trimmingCharacters(in: .whitespaces).isEmpty { return r }
        if let r = response, !r.trimmingCharacters(in: .whitespaces).isEmpty { return r }
        return nil
    }
}

extension BusinessHubService {
    static func reviews(businessId: Int) async throws -> (reviews: [BusinessReview], avgRating: Double, total: Int) {
        struct Resp: Decodable { let reviews: [BusinessReview]; let total: Int?; let avg_rating: Double? }
        let r: Resp = try await APIClient.shared.request("/api/businesses/\(businessId)/reviews-manage")
        return (r.reviews, r.avg_rating ?? 0, r.total ?? r.reviews.count)
    }

    static func replyToReview(businessId: Int, reviewId: String, reply: String) async throws {
        struct Req: Encodable { let reply: String }
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/reviews-manage/\(reviewId)/reply",
            method: .POST, body: Req(reply: reply))
    }

    static func deleteReviewReply(businessId: Int, reviewId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/reviews-manage/\(reviewId)/reply", method: .DELETE)
    }
}
