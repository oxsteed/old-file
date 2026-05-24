import Foundation

enum ResourceState<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(String)
}

struct APIDataEnvelope<Value: Decodable>: Decodable {
    let success: Bool?
    let data: Value
}

struct APIPaginatedEnvelope<Value: Decodable>: Decodable {
    let success: Bool?
    let data: Value
    let pagination: Pagination?

    struct Pagination: Decodable {
        let page: Int?
        let limit: Int?
        let total: Int?
        let hasMore: Bool?
    }
}

struct MobileFeed: Decodable {
    let summary: MobileSummary?
    let jobs: MobileJobs?
    let bookings: MobileBookings?
    let appointments: [MobileAppointment]?
    let plannedNeeds: [MobilePlannedNeed]?
    let conversations: [NativeConversation]?
    let businesses: [MobileBusiness]?

    struct MobileSummary: Decodable {
        let openJobs: Int?
        let incomingBookingRequests: Int?
        let unreadMessages: Int?
        let unreadNotifications: Int?
        let totalOrders: Int?
        let totalSpentCents: Int?
        let ownedBusinesses: Int?
    }

    struct MobileJobs: Decodable {
        let mine: [NativeJob]?
        let available: [NativeJob]?
    }

    struct MobileBookings: Decodable {
        let sent: [MobileBooking]?
        let incoming: [MobileBooking]?
    }
}

struct NativeJob: Decodable, Identifiable {
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

struct MobileBooking: Decodable, Identifiable {
    let id: Int
    let serviceName: String?
    let status: String?
    let paymentStatus: String?
    let requestedDate: String?
    let serviceLocation: String?
    let customerName: String?
}

struct MobileAppointment: Decodable, Identifiable {
    let id: Int
    let title: String?
    let status: String?
    let scheduledStartTime: String?
    let scheduledEndTime: String?
}

struct MobilePlannedNeed: Decodable, Identifiable {
    let id: Int
    let title: String?
    let category: String?
    let status: String?
    let dueDate: String?
    let estimatedCost: Double?
}

struct MobileBusiness: Decodable, Identifiable {
    let id: Int
    let businessName: String?
    let businessType: String?
    let activeTemplate: String?
    let isPrimary: Bool?
}

struct MarketplaceProduct: Decodable, Identifiable {
    let id: Int
    let name: String?
    let description: String?
    let category: String?
    let priceCents: Int?
    let productImageUrl: String?
    let isAvailable: Bool?
    let avgRating: Double?
    let ratingCount: Int?
    let inCartsCount: Int?

    var priceText: String {
        guard let priceCents else { return "Price unavailable" }
        return priceCents.formatted(.currency(code: "USD").scale(0.01))
    }
}

struct NativeConversation: Decodable, Identifiable {
    let id: Int
    let jobId: Int?
    let status: String?
    let otherUserName: String?
    let jobTitle: String?
    let lastMessage: String?
    let lastMessageAt: String?
    let unreadCount: Int?
    let helperBusinessName: String?
    let conversationBusinessName: String?
}

struct LogisticsRequestSummary: Decodable, Identifiable {
    let id: Int
    let reference: String?
    let title: String?
    let status: String?
    let description: String?
    let destinationCity: String?
    let destinationCountry: String?
    let createdAt: String?
}
