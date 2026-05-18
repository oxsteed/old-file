import Foundation

struct DiscoverResponse: Decodable {
    let results: [DiscoverItem]
}

struct DiscoverItem: Decodable, Identifiable {
    let type: String
    let id: String
    let title: String
    let subtitle: String?
    let url: String?
    let rating: Double?
    let reviewCount: Int?
    let distanceMiles: Double?
    let primaryAction: String?

    var route: OxSteedRoute {
        OxSteedRoute(id: "discover-\(type)-\(id)", path: url ?? "/discover")
    }
}

struct HelpersResponse: Decodable {
    let helpers: [NativeHelper]
    let businesses: [NativeHelper]?
}

struct NativeHelper: Decodable, Identifiable {
    let id: FlexibleString
    let businessName: String?
    let ownerName: String?
    let tagline: String?
    let bio: String?
    let rating: Double?
    let reviewCount: Int?
    let jobsCompleted: Int?
    let city: String?
    let state: String?
    let verified: Bool?
    let backgroundChecked: Bool?
    let profileUrl: String?

    var displayName: String {
        businessName?.nilIfBlank ?? ownerName?.nilIfBlank ?? "OxSteed helper"
    }

    var summary: String {
        tagline?.nilIfBlank ?? bio?.nilIfBlank ?? "Available for local services through OxSteed."
    }

    var route: OxSteedRoute {
        OxSteedRoute(id: "helper-\(id.value)", path: profileUrl ?? "/helpers/\(id.value)")
    }
}

struct JobsResponse: Decodable {
    let jobs: [NativeJob]
}

struct NativeJob: Decodable, Identifiable {
    let id: FlexibleString
    let title: String
    let description: String?
    let categoryName: String?
    let status: String?
    let budgetType: String?
    let budgetMin: FlexibleDouble?
    let budgetMax: FlexibleDouble?
    let isUrgent: Bool?
    let locationCity: String?
    let locationState: String?
    let bidCount: Int?
    let distanceMiles: FlexibleDouble?
    let createdAt: String?

    var route: OxSteedRoute {
        OxSteedRoute(id: "job-\(id.value)", path: "/jobs/\(id.value)")
    }

    enum CodingKeys: String, CodingKey {
        case id, title, description, status
        case categoryName = "category_name"
        case budgetType = "budget_type"
        case budgetMin = "budget_min"
        case budgetMax = "budget_max"
        case isUrgent = "is_urgent"
        case locationCity = "location_city"
        case locationState = "location_state"
        case bidCount = "bid_count"
        case distanceMiles = "distance_miles"
        case createdAt = "created_at"
    }
}

struct FlexibleDouble: Decodable, Hashable {
    let value: Double

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let number = try? container.decode(Double.self) {
            value = number
            return
        }
        if let string = try? container.decode(String.self), let number = Double(string) {
            value = number
            return
        }
        value = 0
    }
}

struct ProductBrowseResponse: Decodable {
    let data: [NativeProduct]
}

struct APIDataResponse<T: Decodable>: Decodable {
    let data: T
}

struct NativeProduct: Decodable, Identifiable {
    let id: FlexibleString
    let name: String
    let description: String?
    let category: String?
    let priceCents: Int?
    let productImageURL: String?
    let avgRating: FlexibleDouble?
    let ratingCount: Int?

    var route: OxSteedRoute {
        OxSteedRoute(id: "product-\(id.value)", path: "/products?product=\(id.value)")
    }

    enum CodingKeys: String, CodingKey {
        case id, name, description, category
        case priceCents = "price_cents"
        case productImageURL = "product_image_url"
        case avgRating = "avg_rating"
        case ratingCount = "rating_count"
    }
}

struct HelperProfileResponse: Decodable {
    let helper: HelperProfile
    let services: [HelperService]
    let gallery: [HelperGalleryItem]?
    let hours: [HelperHour]?
    let policies: [HelperPolicy]?
    let reviews: [HelperReview]?
    let faqs: [HelperFAQ]?
}

struct HelperProfile: Decodable, Identifiable {
    let id: FlexibleString
    let businessName: String?
    let ownerName: String?
    let tagline: String?
    let bio: String?
    let rating: FlexibleDouble?
    let reviewCount: Int?
    let jobsCompleted: Int?
    let verified: Bool?
    let responseTime: String?
    let responseRate: Int?
    let badges: [HelperBadge]?
    let categories: [String]?
    let city: String?
    let state: String?
    let hasLicense: Bool?
    let hasInsurance: Bool?
    let yearsInBusiness: Int?
    let isAvailableNow: Bool?
    let allowBooking: Bool?
    let allowLiveChat: Bool?
}

struct HelperBadge: Decodable, Identifiable {
    let id: String
    let label: String
}

struct HelperService: Decodable, Identifiable {
    let id: FlexibleString
    let name: String
    let description: String?
    let price: FlexibleDouble?
    let priceUnit: String?
    let duration: String?
    let popular: Bool?
    let category: String?
}

struct HelperGalleryItem: Decodable, Identifiable {
    let id: FlexibleString
    let url: String?
    let caption: String?
}

struct HelperHour: Decodable, Identifiable {
    var id: String { day }
    let day: String
    let open: String?
    let close: String?
    let closed: Bool?
}

struct HelperPolicy: Decodable, Identifiable {
    let id: FlexibleString
    let title: String
    let content: String?
}

struct HelperReview: Decodable, Identifiable {
    let id: FlexibleString
    let authorName: String?
    let rating: FlexibleDouble?
    let content: String?
    let verified: Bool?
}

struct HelperFAQ: Decodable, Identifiable {
    let id: FlexibleString
    let question: String
    let answer: String?
}

struct NativeJobDetail: Decodable, Identifiable {
    let id: FlexibleString
    let clientId: FlexibleString?
    let title: String
    let description: String?
    let categoryName: String?
    let budgetType: String?
    let budgetMin: FlexibleDouble?
    let budgetMax: FlexibleDouble?
    let urgency: String?
    let isUrgent: Bool?
    let status: String?
    let jobTypeLabel: String?
    let locationCity: String?
    let locationState: String?
    let locationCountry: String?
    let scheduledDate: String?
    let scheduledTime: String?
    let requirements: [String]?
    let bidCount: Int?
    let clientName: String?
    let helperName: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description, urgency, status, requirements
        case clientId = "client_id"
        case categoryName = "category_name"
        case budgetType = "budget_type"
        case budgetMin = "budget_min"
        case budgetMax = "budget_max"
        case isUrgent = "is_urgent"
        case jobTypeLabel = "job_type_label"
        case locationCity = "location_city"
        case locationState = "location_state"
        case locationCountry = "location_country"
        case scheduledDate = "scheduled_date"
        case scheduledTime = "scheduled_time"
        case bidCount = "bid_count"
        case clientName = "client_name"
        case helperName = "helper_name"
        case createdAt = "created_at"
    }
}

struct NativeProductDetail: Decodable, Identifiable {
    let id: FlexibleString
    let name: String
    let description: String?
    let category: String?
    let sku: String?
    let priceCents: Int?
    let currency: String?
    let affiliateURL: String?
    let productImageURL: String?
    let isAvailable: Bool?
    let source: String?
    let avgRating: FlexibleDouble?
    let ratingCount: Int?
    let inCartsCount: Int?
    let helperReviewCount: Int?
    let skills: [ProductSkill]?

    enum CodingKeys: String, CodingKey {
        case id, name, description, category, sku, currency, source, skills
        case priceCents = "price_cents"
        case affiliateURL = "affiliate_url"
        case productImageURL = "product_image_url"
        case isAvailable = "is_available"
        case avgRating = "avg_rating"
        case ratingCount = "rating_count"
        case inCartsCount = "in_carts_count"
        case helperReviewCount = "helper_review_count"
    }
}

struct ProductSkill: Decodable, Identifiable {
    let id: FlexibleString
    let name: String
}

struct FlexibleString: Decodable, Hashable {
    let value: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            value = string
            return
        }
        if let int = try? container.decode(Int.self) {
            value = String(int)
            return
        }
        value = ""
    }
}

struct LoginResponse: Decodable {
    let success: Bool?
    let message: String?
    let accessToken: String?
    let refreshToken: String?
    let requiresTwoFactor: Bool?
}

struct ConversationItem: Decodable, Identifiable {
    let id: FlexibleString
    let otherUserName: String?
    let jobTitle: String?
    let lastMessage: String?
    let unreadCount: Int?
    let lastMessageAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case otherUserName = "other_user_name"
        case jobTitle = "job_title"
        case lastMessage = "last_message"
        case unreadCount = "unread_count"
        case lastMessageAt = "last_message_at"
    }
}

struct MessageItem: Decodable, Identifiable {
    let id: FlexibleString
    let conversationId: FlexibleString?
    let senderId: FlexibleString?
    let senderName: String?
    let content: String
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, content
        case conversationId = "conversation_id"
        case senderId = "sender_id"
        case senderName = "sender_name"
        case createdAt = "created_at"
    }
}

struct MessageSendResponse: Decodable {
    let id: FlexibleString?
    let content: String?
}

struct AppointmentsResponse: Decodable {
    let appointments: [AppointmentItem]
}

struct AppointmentItem: Decodable, Identifiable {
    let id: FlexibleString
    let customerName: String?
    let helperName: String?
    let jobTitle: String?
    let status: String?
    let scheduledStartTime: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case customerName = "customer_name"
        case helperName = "helper_name"
        case jobTitle = "job_title"
        case scheduledStartTime = "scheduled_start_time"
    }
}

struct ConsultingSubmission: Encodable {
    let email: String
    let first_name: String
    let last_name: String
    let business_name: String?
    let current_phase: Int
    let service_tier: String
    let areas_of_help: [String]
    let description: String
    let preferred_time_slot: String
}

struct ConsultingResponse: Decodable {
    let id: FlexibleString?
    let message: String?
}

struct JobSubmission: Encodable {
    let title: String
    let description: String
    let category_name: String
    let budget_type: String
    let budget_min: Int?
    let budget_max: Int?
    let urgency: String
    let location_city: String
    let location_state: String?
    let location_country: String
}

struct JobSubmissionResponse: Decodable {
    let id: FlexibleString?
    let title: String?
}

struct BusinessListResponse: Decodable {
    let businesses: [NativeBusiness]
}

struct NativeBusiness: Decodable, Identifiable {
    let id: FlexibleString
    let businessName: String
    let businessType: String?
    let description: String?
    let website: String?
    let phone: String?
    let addressCity: String?
    let addressState: String?
    let addressCountry: String?
    let isPrimary: Bool?
    let isActive: Bool?
    let activeTemplate: String?
    let role: String?

    enum CodingKeys: String, CodingKey {
        case id, description, website, phone, role
        case businessName = "business_name"
        case businessType = "business_type"
        case addressCity = "address_city"
        case addressState = "address_state"
        case addressCountry = "address_country"
        case isPrimary = "is_primary"
        case isActive = "is_active"
        case activeTemplate = "active_template"
    }
}

struct CartCreateResponse: Decodable {
    let id: FlexibleString
    let name: String?
}

struct CartItemResponse: Decodable {
    let id: FlexibleString?
    let productId: FlexibleString?
    let quantity: Int?

    enum CodingKeys: String, CodingKey {
        case id, quantity
        case productId = "product_id"
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
