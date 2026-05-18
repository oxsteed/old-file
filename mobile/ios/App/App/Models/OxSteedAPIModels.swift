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
    let id: String
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
        OxSteedRoute(id: "helper-\(id)", path: profileUrl ?? "/helpers/\(id)")
    }
}

struct JobsResponse: Decodable {
    let jobs: [NativeJob]
}

struct NativeJob: Decodable, Identifiable {
    let id: String
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
        OxSteedRoute(id: "job-\(id)", path: "/jobs/\(id)")
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

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
