import Foundation

enum GoResourceState<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(String)
}

struct GoDataEnvelope<Value: Decodable>: Decodable {
    let success: Bool?
    let data: Value
}

struct GoAuthUser: Codable, Equatable {
    let id: Int?
    let email: String?
    let role: String?
    let defaultMode: String?
    let firstName: String?
    let lastName: String?
}

struct GoAuthResponse: Codable {
    let token: String?
    let refreshToken: String?
    let user: GoAuthUser?
    let requiresTwoFactor: Bool?
}

struct GoLoginRequest: Encodable {
    let email: String
    let password: String
    let twoFactorCode: String?
}

struct GoMobileFeed: Decodable {
    let summary: Summary?
    let jobs: Jobs?
    let bookings: Bookings?
    let appointments: [Appointment]?
    let plannedNeeds: [PlannedNeed]?
    let conversations: [Conversation]?
    let businesses: [Business]?

    struct Summary: Decodable {
        let openJobs: Int?
        let incomingBookingRequests: Int?
        let unreadMessages: Int?
        let unreadNotifications: Int?
        let totalOrders: Int?
        let totalSpentCents: Int?
        let ownedBusinesses: Int?
    }

    struct Jobs: Decodable {
        let mine: [Job]?
        let available: [Job]?
    }

    struct Bookings: Decodable {
        let sent: [Booking]?
        let incoming: [Booking]?
    }
}

struct Job: Decodable, Identifiable, Hashable {
    let id: Int
    let title: String?
    let status: String?
    let categoryName: String?
    let budgetMin: Double?
    let budgetMax: Double?
    let locationCity: String?
    let locationState: String?
    let createdAt: String?
}

struct Booking: Decodable, Identifiable, Hashable {
    let id: Int
    let serviceName: String?
    let status: String?
    let paymentStatus: String?
    let requestedDate: String?
    let serviceLocation: String?
}

struct Appointment: Decodable, Identifiable, Hashable {
    let id: Int
    let title: String?
    let status: String?
    let scheduledStartTime: String?
}

struct PlannedNeed: Decodable, Identifiable, Hashable {
    let id: Int
    let title: String?
    let category: String?
    let status: String?
    let dueDate: String?
}

struct Business: Decodable, Identifiable, Hashable {
    let id: Int
    let businessName: String?
    let businessType: String?
    let activeTemplate: String?
    let isPrimary: Bool?
}

struct Product: Decodable, Identifiable, Hashable {
    let id: Int
    let name: String?
    let description: String?
    let category: String?
    let priceCents: Int?
    let avgRating: Double?
    let ratingCount: Int?

    var priceText: String {
        guard let priceCents else { return "Price TBD" }
        return (Double(priceCents) / 100).formatted(.currency(code: "USD"))
    }
}

struct Conversation: Decodable, Identifiable, Hashable {
    let id: Int
    let otherUserName: String?
    let jobTitle: String?
    let lastMessage: String?
    let unreadCount: Int?
    let conversationBusinessName: String?
    let helperBusinessName: String?
}

struct HelperProfile: Decodable, Identifiable, Hashable {
    let id: Int
    let ownerName: String?
    let profileHeadline: String?
    let serviceCity: String?
    let serviceState: String?
    let avgRating: Double?
    let totalReviews: Int?
}

struct NearbyPayload: Decodable {
    let jobs: [Job]?
    let helpers: [HelperProfile]?
}

struct LogisticsRequest: Decodable, Identifiable, Hashable {
    let id: Int
    let reference: String?
    let title: String?
    let status: String?
    let description: String?
}

struct GenericResponse: Decodable {
    let success: Bool?
    let message: String?
    let id: Int?
}

struct TranslationRequest: Encodable {
    let text: String
    let sourceLocale: String?
    let targetLocale: String
}

struct TranslationPayload: Decodable {
    let translatedText: String?
    let text: String?
    let targetLocale: String?
    let sourceLocale: String?
}
