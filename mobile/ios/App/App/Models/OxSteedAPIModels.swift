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

    init(value: Double) {
        self.value = value
    }

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

struct RegistrationSubmission: Encodable {
    let email: String
    let password: String
    let first_name: String
    let last_name: String
    let phone: String?
    let role: String
    let language: String
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

struct BookingRequestSubmission: Encodable {
    let helperId: String?
    let businessId: String?
    let serviceName: String
    let requestedDate: String
    let requestedStartTime: String
    let requestedEndTime: String
    let serviceLocation: String
    let description: String
    let confirmationHours: Int
}

struct BookingRequestResponse: Decodable {
    let success: Bool?
    let bookingId: FlexibleString?
    let data: BookingRequestItem?
    let message: String?
}

struct BookingRequestItem: Decodable, Identifiable {
    let id: FlexibleString
    let helperId: FlexibleString?
    let serviceName: String?
    let requestedDate: String?
    let requestedStartTime: String?
    let requestedEndTime: String?
    let serviceLocation: String?
    let description: String?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case id, description, status
        case helperId = "helper_id"
        case serviceName = "service_name"
        case requestedDate = "requested_date"
        case requestedStartTime = "requested_start_time"
        case requestedEndTime = "requested_end_time"
        case serviceLocation = "service_location"
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

struct BidSubmission: Encodable {
    let job_id: String
    let amount: Double
    let message: String
    let eta_hours: Double?
}

struct BidResponse: Decodable, Identifiable {
    let id: FlexibleString
    let jobId: FlexibleString?
    let helperId: FlexibleString?
    let amount: FlexibleDouble?
    let message: String?
    let status: String?
    let etaHours: FlexibleDouble?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, amount, message, status
        case jobId = "job_id"
        case helperId = "helper_id"
        case etaHours = "eta_hours"
        case createdAt = "created_at"
    }
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

struct BusinessProfileEditResponse: Decodable {
    let business: BusinessProfileEdit
}

struct BusinessProfileEdit: Decodable, Identifiable {
    let id: FlexibleString
    let businessName: String
    let businessType: String?
    let description: String?
    let website: String?
    let phone: String?
    let addressStreet: String?
    let addressCity: String?
    let addressState: String?
    let addressZip: String?
    let addressCountry: String?
    let profileHeadline: String?
    let serviceRadiusMiles: FlexibleDouble?
    let aiKnowledge: String?

    enum CodingKeys: String, CodingKey {
        case id, description, website, phone
        case businessName = "business_name"
        case businessType = "business_type"
        case addressStreet = "address_street"
        case addressCity = "address_city"
        case addressState = "address_state"
        case addressZip = "address_zip"
        case addressCountry = "address_country"
        case profileHeadline = "profile_headline"
        case serviceRadiusMiles = "service_radius_miles"
        case aiKnowledge = "ai_knowledge"
    }
}

struct BusinessMutationResponse: Decodable {
    let business: NativeBusiness
}

struct BusinessProfileUpdate: Encodable {
    let business_name: String
    let business_type: String?
    let description: String?
    let website: String?
    let phone: String?
    let address_street: String?
    let address_city: String?
    let address_state: String?
    let address_zip: String?
    let address_country: String?
    let profile_headline: String?
    let service_radius_miles: Double?
    let ai_knowledge: String?
}

struct BusinessServiceSubmission: Encodable {
    let name: String
    let description: String?
    let price: Double
    let price_unit: String
    let duration: String?
    let popular: Bool
    let category: String
}

struct BusinessInvoiceListResponse: Decodable {
    let invoices: [BusinessInvoiceItem]
    let summary: BusinessInvoiceSummary?
}

struct BusinessInvoiceSummary: Decodable {
    let draft: FlexibleString?
    let sent: FlexibleString?
    let paid: FlexibleString?
    let overdue: FlexibleString?
    let outstandingTotal: FlexibleDouble?

    enum CodingKeys: String, CodingKey {
        case draft, sent, paid, overdue
        case outstandingTotal = "outstanding_total"
    }
}

struct BusinessInvoiceItem: Decodable, Identifiable {
    let id: FlexibleString
    let invoiceNumber: String?
    let clientName: String?
    let clientEmail: String?
    let status: String?
    let dueDate: String?
    let total: FlexibleDouble?
    let amountPaid: FlexibleDouble?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, status, total
        case invoiceNumber = "invoice_number"
        case clientName = "client_name"
        case clientEmail = "client_email"
        case dueDate = "due_date"
        case amountPaid = "amount_paid"
        case createdAt = "created_at"
    }
}

struct BusinessInvoiceLineItem: Encodable {
    let description: String
    let quantity: Double
    let unit_price: Double
}

struct BusinessInvoiceSubmission: Encodable {
    let client_name: String
    let client_email: String?
    let client_company: String?
    let due_date: String?
    let line_items: [BusinessInvoiceLineItem]
    let invoice_tax_rate: Double
    let notes: String?
    let status: String
}

struct BusinessInvoiceMutationResponse: Decodable {
    let invoice: BusinessInvoiceItem
}

struct BusinessClientsResponse: Decodable {
    let clients: [BusinessClientItem]
    let total: Int?
}

struct BusinessClientItem: Decodable, Identifiable {
    let id: FlexibleString
    let displayName: String
    let email: String?
    let phone: String?
    let city: String?
    let state: String?
    let status: String?
    let preferredContact: String?
    let lifetimeValueCents: Int?
    let totalJobs: Int?

    enum CodingKeys: String, CodingKey {
        case id, email, phone, city, state, status
        case displayName = "display_name"
        case preferredContact = "preferred_contact"
        case lifetimeValueCents = "lifetime_value_cents"
        case totalJobs = "total_jobs"
    }
}

struct BusinessClientSubmission: Encodable {
    let display_name: String
    let email: String?
    let phone: String?
    let city: String?
    let state: String?
    let status: String
    let preferred_contact: String?
    let internal_notes: String?
    let tags: [String]
}

struct BusinessClientMutationResponse: Decodable {
    let client: BusinessClientItem
}

struct BusinessMembersResponse: Decodable {
    let members: [BusinessMemberItem]
}

struct BusinessMemberItem: Decodable, Identifiable {
    let id: FlexibleString
    let role: String?
    let status: String?
    let inviteEmail: String?
    let memberEmail: String?
    let firstName: String?
    let lastName: String?

    enum CodingKeys: String, CodingKey {
        case id, role, status
        case inviteEmail = "invite_email"
        case memberEmail = "member_email"
        case firstName = "first_name"
        case lastName = "last_name"
    }
}

struct BusinessMemberInviteSubmission: Encodable {
    let email: String
    let role: String
}

struct BusinessMemberInviteResponse: Decodable {
    let member: BusinessMemberItem
    let userFound: Bool?

    enum CodingKeys: String, CodingKey {
        case member
        case userFound = "user_found"
    }
}

struct BusinessProductListResponse: Decodable {
    let success: Bool?
    let data: [BusinessProductItem]
    let total: Int?
}

struct BusinessProductItem: Decodable, Identifiable {
    let id: FlexibleString
    let name: String
    let category: String?
    let price: FlexibleDouble?
    let sku: String?
    let totalStock: Int?
    let isActive: Bool?

    enum CodingKeys: String, CodingKey {
        case id, name, category, price, sku
        case priceCents = "price_cents"
        case totalStock = "totalStock"
        case totalStockSnake = "total_stock"
        case isActive = "isActive"
        case isActiveSnake = "is_active"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(FlexibleString.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        category = try container.decodeIfPresent(String.self, forKey: .category)
        sku = try container.decodeIfPresent(String.self, forKey: .sku)
        totalStock = try container.decodeIfPresent(Int.self, forKey: .totalStock)
            ?? container.decodeIfPresent(Int.self, forKey: .totalStockSnake)
        isActive = try container.decodeIfPresent(Bool.self, forKey: .isActive)
            ?? container.decodeIfPresent(Bool.self, forKey: .isActiveSnake)

        if let decodedPrice = try container.decodeIfPresent(FlexibleDouble.self, forKey: .price) {
            price = decodedPrice
        } else if let cents = try container.decodeIfPresent(FlexibleDouble.self, forKey: .priceCents) {
            price = FlexibleDouble(value: cents.value / 100)
        } else {
            price = nil
        }
    }
}

struct BusinessProductSubmission: Encodable {
    let name: String
    let description: String?
    let category: String
    let price: Double
    let cost: Double?
    let sku: String
    let isActive: Bool
}

struct BusinessProductMutationResponse: Decodable {
    let success: Bool?
    let data: BusinessProductItem
}

struct BusinessProductDetailResponse: Decodable {
    let success: Bool?
    let data: BusinessProductDetail
}

struct BusinessProductDetail: Decodable, Identifiable {
    let id: FlexibleString
    let name: String
    let description: String?
    let category: String?
    let price: FlexibleDouble?
    let sku: String?
    let isActive: Bool?
    let variants: [BusinessProductVariant]

    enum CodingKeys: String, CodingKey {
        case id, name, description, category, price, sku, variants
        case priceCents = "price_cents"
        case isActive = "isActive"
        case isActiveSnake = "is_active"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(FlexibleString.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        category = try container.decodeIfPresent(String.self, forKey: .category)
        sku = try container.decodeIfPresent(String.self, forKey: .sku)
        isActive = try container.decodeIfPresent(Bool.self, forKey: .isActive)
            ?? container.decodeIfPresent(Bool.self, forKey: .isActiveSnake)
        variants = (try? container.decodeIfPresent([BusinessProductVariant].self, forKey: .variants)) ?? []
        if let decodedPrice = try container.decodeIfPresent(FlexibleDouble.self, forKey: .price) {
            price = decodedPrice
        } else if let cents = try container.decodeIfPresent(FlexibleDouble.self, forKey: .priceCents) {
            price = FlexibleDouble(value: cents.value / 100)
        } else {
            price = nil
        }
    }
}

struct BusinessProductVariant: Decodable, Identifiable {
    let id: FlexibleString
    let name: String?
    let sku: String?
    let priceAdjustment: FlexibleDouble?
    let stock: Int?
    let reorderLevel: Int?

    enum CodingKeys: String, CodingKey {
        case id, name, sku, stock
        case variantName = "variant_name"
        case priceAdjustment = "priceAdjustment"
        case priceAdjustmentCents = "price_adjustment_cents"
        case reorderLevel = "reorderLevel"
        case reorderLevelSnake = "reorder_level"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(FlexibleString.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name)
            ?? container.decodeIfPresent(String.self, forKey: .variantName)
        sku = try container.decodeIfPresent(String.self, forKey: .sku)
        stock = try container.decodeIfPresent(Int.self, forKey: .stock)
        reorderLevel = try container.decodeIfPresent(Int.self, forKey: .reorderLevel)
            ?? container.decodeIfPresent(Int.self, forKey: .reorderLevelSnake)
        if let adjustment = try container.decodeIfPresent(FlexibleDouble.self, forKey: .priceAdjustment) {
            priceAdjustment = adjustment
        } else if let cents = try container.decodeIfPresent(FlexibleDouble.self, forKey: .priceAdjustmentCents) {
            priceAdjustment = FlexibleDouble(value: cents.value / 100)
        } else {
            priceAdjustment = nil
        }
    }
}

struct BusinessProductVariantSubmission: Encodable {
    let variantName: String
    let sku: String
    let priceAdjustment: Double
    let stock: Int
    let reorderLevel: Int
}

struct BusinessProductVariantMutationResponse: Decodable {
    let success: Bool?
    let data: BusinessProductVariant
}

struct BusinessInventoryAdjustmentSubmission: Encodable {
    let quantityChange: Int
    let reason: String
}

struct BusinessInventoryAdjustmentResponse: Decodable {
    let success: Bool?
    let data: BusinessInventoryAdjustmentResult
}

struct BusinessInventoryAdjustmentResult: Decodable {
    let stock: Int?
    let lastUpdated: String?
}

struct BusinessLowStockResponse: Decodable {
    let success: Bool?
    let data: [BusinessLowStockItem]
    let alertCount: Int?
}

struct BusinessLowStockItem: Decodable, Identifiable {
    let productId: FlexibleString
    let productName: String
    let category: String?
    let variantId: FlexibleString
    let sku: String?
    let variantName: String?
    let currentStock: Int
    let reorderLevel: Int

    var id: String { variantId.value }
}

struct BusinessServicePackage: Decodable, Identifiable {
    let id: FlexibleString
    let name: String
    let description: String?
    let totalSessions: Int?
    let priceCents: Int?
    let validityDays: Int?
    let sortOrder: Int?
    let isActive: Bool?

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case totalSessions = "total_sessions"
        case priceCents = "price_cents"
        case validityDays = "validity_days"
        case sortOrder = "sort_order"
        case isActive = "is_active"
    }
}

struct BusinessServicePackageSubmission: Encodable {
    let name: String
    let description: String?
    let services: [String]
    let total_sessions: Int
    let price_cents: Int
    let validity_days: Int?
    let sort_order: Int
}

struct BusinessProductPricingRulesResponse: Decodable {
    let success: Bool?
    let data: [BusinessProductPricingRule]
    let total: Int?
}

struct BusinessProductPricingRule: Decodable, Identifiable {
    let id: FlexibleString
    let name: String
    let type: String?
    let description: String?
    let priority: Int?
    let isActive: Bool?
    let appliesToType: String?

    enum CodingKeys: String, CodingKey {
        case id, name, type, description, priority
        case ruleName = "rule_name"
        case ruleType = "rule_type"
        case isActive = "isActive"
        case isActiveSnake = "is_active"
        case appliesToType = "appliesToType"
        case appliesToSnake = "applies_to"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(FlexibleString.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name)
            ?? container.decodeIfPresent(String.self, forKey: .ruleName)
            ?? "Pricing rule"
        type = try container.decodeIfPresent(String.self, forKey: .type)
            ?? container.decodeIfPresent(String.self, forKey: .ruleType)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        priority = try container.decodeIfPresent(Int.self, forKey: .priority)
        isActive = try container.decodeIfPresent(Bool.self, forKey: .isActive)
            ?? container.decodeIfPresent(Bool.self, forKey: .isActiveSnake)
        appliesToType = try container.decodeIfPresent(String.self, forKey: .appliesToType)
            ?? container.decodeIfPresent(String.self, forKey: .appliesToSnake)
    }
}

struct BusinessProductPricingRuleSubmission: Encodable {
    let name: String
    let type: String
    let description: String?
    let priority: Int
    let appliesToType: String
    let appliesTo: String?
    let conditions: ProductPricingConditions
    let adjustment: ProductPricingAdjustment
}

struct ProductPricingConditions: Encodable {
    let minQuantity: Int?
}

struct ProductPricingAdjustment: Encodable {
    let type: String
    let value: Double
}

struct BusinessProductPricingRuleMutationResponse: Decodable {
    let success: Bool?
    let data: BusinessProductPricingRule
}

struct NativeBusinessService: Decodable, Identifiable {
    let id: FlexibleString
    let name: String
    let description: String?
    let price: FlexibleDouble?
    let priceUnit: String?
    let duration: String?
    let popular: Bool?
    let category: String?
    let isActive: Bool?

    enum CodingKeys: String, CodingKey {
        case id, name, description, price, duration, popular, category
        case priceUnit = "price_unit"
        case isActive = "is_active"
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

struct ToolBrowseResponse: Decodable {
    let tools: [NativeToolRental]
}

struct ToolDetailResponse: Decodable {
    let tool: NativeToolRental
}

struct NativeToolRental: Decodable, Identifiable {
    let id: FlexibleString
    let ownerId: FlexibleString?
    let name: String
    let category: String?
    let description: String?
    let dailyRate: FlexibleDouble?
    let hourlyRate: FlexibleDouble?
    let depositAmount: FlexibleDouble?
    let condition: String?
    let brand: String?
    let model: String?
    let isAvailable: Bool?
    let requiresDeposit: Bool?
    let deliveryAvailable: Bool?
    let pickupOnly: Bool?
    let locationCity: String?
    let locationState: String?
    let ownerRules: String?
    let ownerName: String?
    let avgRating: FlexibleDouble?
    let reviewCount: Int?
    let imageURL: String?

    enum CodingKeys: String, CodingKey {
        case id, name, category, description, condition, brand, model
        case ownerId = "owner_id"
        case dailyRate = "daily_rate"
        case hourlyRate = "hourly_rate"
        case depositAmount = "deposit_amount"
        case isAvailable = "is_available"
        case requiresDeposit = "requires_deposit"
        case deliveryAvailable = "delivery_available"
        case pickupOnly = "pickup_only"
        case locationCity = "location_city"
        case locationState = "location_state"
        case ownerRules = "owner_rules"
        case ownerName = "owner_name"
        case avgRating = "avg_rating"
        case reviewCount = "review_count"
        case imageURL = "image_url"
    }
}

struct ToolBookingSubmission: Encodable {
    let toolId: String
    let startDate: String
    let endDate: String
    let renterAgreementAccepted: Bool
}

struct ToolBookingResponse: Decodable {
    let id: FlexibleString
    let toolId: FlexibleString?
    let customerId: FlexibleString?
    let ownerId: FlexibleString?
    let startDate: String?
    let endDate: String?
    let totalPrice: FlexibleDouble?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case toolId = "tool_id"
        case customerId = "customer_id"
        case ownerId = "owner_id"
        case startDate = "start_date"
        case endDate = "end_date"
        case totalPrice = "total_price"
    }
}

struct BusinessAppointmentsResponse: Decodable {
    let appointments: [BusinessAppointmentItem]
}

struct BusinessAppointmentItem: Decodable, Identifiable {
    let id: FlexibleString
    let serviceName: String?
    let customerName: String?
    let startTime: String?
    let endTime: String?
    let status: String?
    let paymentStatus: String?
    let finalPriceCents: Int?

    enum CodingKeys: String, CodingKey {
        case id, status
        case serviceName = "service_name"
        case customerName = "customer_name"
        case startTime = "start_time"
        case endTime = "end_time"
        case paymentStatus = "payment_status"
        case finalPriceCents = "final_price_cents"
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
