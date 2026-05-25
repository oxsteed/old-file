import Foundation

struct OneAuthUser: Codable {
    let id: Int?
    let email: String?
    let defaultMode: String?
}

struct OneSavedSession: Codable {
    let token: String
    let user: OneAuthUser?
}

struct OneLoginRequest: Encodable {
    let email: String
    let password: String
    let termsAgreed: Bool
    let agreementName: String
}

struct OneAuthResponse: Decodable {
    let accessToken: String?
    let refreshToken: String?
    let token: String?
    let user: OneAuthUser?

    private enum CodingKeys: String, CodingKey {
        case accessToken
        case refreshToken
        case token
        case user
        case access_token
        case refresh_token
        case data
        case result
    }

    private struct AuthPayload: Decodable {
        let accessToken: String?
        let refreshToken: String?
        let token: String?
        let user: OneAuthUser?
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Some auth endpoints return tokens directly; others wrap them in data/result.
        let directAccess = try container.decodeIfPresent(String.self, forKey: .accessToken)
            ?? container.decodeIfPresent(String.self, forKey: .access_token)
        let directRefresh = try container.decodeIfPresent(String.self, forKey: .refreshToken)
            ?? container.decodeIfPresent(String.self, forKey: .refresh_token)
        let directToken = try container.decodeIfPresent(String.self, forKey: .token)
        let directUser = try container.decodeIfPresent(OneAuthUser.self, forKey: .user)

        let wrappedData = try container.decodeIfPresent(AuthPayload.self, forKey: .data)
        let wrappedResult = try container.decodeIfPresent(AuthPayload.self, forKey: .result)

        accessToken = directAccess ?? wrappedData?.accessToken ?? wrappedResult?.accessToken
        refreshToken = directRefresh ?? wrappedData?.refreshToken ?? wrappedResult?.refreshToken
        token = directToken ?? wrappedData?.token ?? wrappedResult?.token
        user = directUser ?? wrappedData?.user ?? wrappedResult?.user
    }
}

struct OneRegisterRequest: Encodable {
    let email: String
    let password: String
    let firstName: String
    let lastName: String
    let role: String
}

struct OneRefreshRequest: Encodable {
    let refreshToken: String
}

struct OneLogoutRequest: Encodable {
    let refreshToken: String
}

struct OneDataEnvelope<T: Decodable>: Decodable {
    let data: T
}

struct OneTranslateRequest: Encodable {
    let text: String
    let targetLang: String
}

struct OneTranslateResponse: Decodable {
    let translatedText: String?
    let translation: String?
}

struct OneWalletResponse: Decodable {
    let availableBalance: Double?
    let pendingEscrow: Double?
    let payoutMethod: String?
}

struct OneToolInventoryEnvelope: Decodable {
    let data: [OneToolInventoryDTO]?
    let tools: [OneToolInventoryDTO]?
}

struct OneToolInventoryDTO: Decodable {
    let id: String?
    let title: String?
    let availableUnits: Int?
    let pendingReturns: Int?
    let condition: String?
}

struct OneConsultantProfileResponse: Decodable {
    let id: String?
    let displayName: String?
    let servicePackages: [String]?
    let appointmentCount: Int?
    let notesCount: Int?
}

struct OneVersionPolicyResponse: Decodable {
    let minimumVersion: String?
    let minVersion: String?
    let required: Bool?
}

struct OneJobListEnvelope: Decodable {
    let jobs: [OneJobDTO]?
    let data: [OneJobDTO]?
}

struct OneJobDTO: Decodable {
    let id: String?
    let title: String?
    let description: String?
    let category: String?
    let status: String?
    let locationCity: String?
    let locationState: String?
    let locationStreet: String?
    let locationZip: String?
}

struct OneJobStatusResponse: Decodable {
    let id: String?
    let status: String?
}

struct OneBidListEnvelope: Decodable {
    let bids: [OneBidDTO]?
    let data: [OneBidDTO]?
}

struct OneBidDTO: Decodable {
    let id: String?
    let jobId: String?
    let helperName: String?
    let amountCents: Int?
    let message: String?
    let availabilityStart: String?
}

struct OneHelperListEnvelope: Decodable {
    let helpers: [OneHelperDTO]?
    let data: [OneHelperDTO]?
}

struct OneHelperDTO: Decodable {
    let id: String?
    let name: String?
    let category: String?
    let city: String?
    let avgRating: Double?
    let hourlyRateCents: Int?
}

struct OneAppointmentListEnvelope: Decodable {
    let appointments: [OneAppointmentDTO]?
    let data: [OneAppointmentDTO]?
}

struct OneAppointmentDTO: Decodable {
    let id: String?
    let helperName: String?
    let serviceType: String?
    let scheduledStartAt: String?
    let status: String?
}

struct OneRentalListEnvelope: Decodable {
    let rentals: [OneRentalDTO]?
    let data: [OneRentalDTO]?
}

struct OneRentalDTO: Decodable {
    let id: String?
    let toolId: String?
    let ownerId: String?
    let toolTitle: String?
    let ownerName: String?
    let status: String?
    let rentalStartDate: String?
    let rentalEndDate: String?
}

struct OneCreateJobRequest: Encodable {
    let title: String
    let description: String
    let categoryName: String
    let locationCity: String
    let locationState: String
    let locationAddress: String
    let locationZip: String
    let locationCountry: String
    let urgency: String
    let budgetType: String
    let budgetMin: Int?
    let budgetMax: Int?
    let mediaUrls: [String]
}

struct OneAssignBidRequest: Encodable {
    let bidID: String
    let paymentMethod: String
}

struct OneCreateBookingRequest: Encodable {
    let helperID: String
    let serviceName: String
    let requestedDate: String
    let requestedStartTime: String
    let requestedEndTime: String
    let serviceLocation: String
    let description: String
}

struct OneCancelBookingResponse: Decodable {
    let success: Bool?
    let data: OneBookingCreateResult?
}

struct OneCreateToolReservationRequest: Encodable {
    let toolID: String
    let startDate: String
    let endDate: String
    let renterAgreementAccepted: Bool
}

struct OneGenericSuccessResponse: Decodable {
    let id: String?
    let success: Bool?
}

struct OneBookingCreateResponse: Decodable {
    let success: Bool?
    let data: OneBookingCreateResult?
}

struct OneBookingCreateResult: Decodable {
    let id: String?
}

struct OneBookingListResponse: Decodable {
    let success: Bool?
    let data: [OneBookingListItem]?
}

struct OneBookingListItem: Decodable {
    let id: String?
    let helperId: String?
    let serviceName: String?
    let requestedDate: String?
    let requestedStartTime: String?
    let status: String?
    let paymentStatus: String?
    let paymentAmountCents: Int?
}

struct OneBookingPaymentIntentRequest: Encodable {
    let amountCents: Int
    let paymentRequirement: String
}

struct OneBookingPaymentIntentResponse: Decodable {
    let success: Bool?
    let data: OneBookingPaymentIntentData?
}

struct OneBookingPaymentIntentData: Decodable {
    let bookingId: String?
    let clientSecret: String?
    let paymentIntentId: String?
    let amountCents: Int?
    let paymentRequirement: String?
    let publishableKey: String?
}

struct OneBookingConfirmPaymentRequest: Encodable {
    let paymentIntentId: String
}

struct OneBookingConfirmPaymentResponse: Decodable {
    let success: Bool?
    let data: OneBookingConfirmPaymentData?
}

struct OneBookingConfirmPaymentData: Decodable {
    let booking: OneBookingListItem?
    let paymentIntentId: String?
    let status: String?
}

struct OneToolBookingResponse: Decodable {
    let id: String?
    let toolId: String?
    let ownerId: String?
    let customerId: String?
    let status: String?
    let startDate: String?
    let endDate: String?
}

struct OneToolBookingStatusUpdateRequest: Encodable {
    let status: String
}

struct OneToolReportRequest: Encodable {
    let reportedUserID: String
    let bookingID: String
    let reportType: String
    let description: String
}

struct OneToolReportResponse: Decodable {
    let reportId: String?
    let status: String?
    let message: String?
}

struct OneConversationDTO: Decodable {
    let id: Int?
}

struct OneCreateConversationRequest: Encodable {
    let helperID: String
}

struct OneSendMessageRequest: Encodable {
    let content: String
}

// MARK: - Phase 1: Data Fetching DTOs

// User profile
struct OneUserProfile: Decodable {
    let id: String?
    let email: String?
    let firstName: String?
    let lastName: String?
    let role: String?
    let defaultMode: String?
    let businesses: [BusinessRef]?

    enum CodingKeys: String, CodingKey {
        case id
        case email
        case firstName = "first_name"
        case lastName = "last_name"
        case role
        case defaultMode = "default_mode"
        case businesses
    }
}

// Job list (public feed + my-jobs)
struct OneJobListResponse: Decodable {
    let jobs: [OneJobDTO]?
    let data: [OneJobDTO]?
    let total: Int?
    let hasMore: Bool?

    enum CodingKeys: String, CodingKey {
        case jobs
        case data
        case total
        case hasMore = "has_more"
    }
}

// Bid list for a specific job
struct OneBidListResponse: Decodable {
    let bids: [OneBidDTO]?
    let data: [OneBidDTO]?
    let total: Int?
}

// Tool browse (public listings, not my-rentals)
struct OneToolBrowseResponse: Decodable {
    let tools: [OneToolBrowseDTO]?
    let data: [OneToolBrowseDTO]?
    let total: Int?
}

struct OneToolBrowseDTO: Decodable {
    let id: String?
    let title: String?
    let ownerName: String?
    let city: String?
    let dailyRateCents: Int?
    let depositCents: Int?
    let terms: String?
    let availableSlots: [String]?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case ownerName = "owner_name"
        case city
        case dailyRateCents = "daily_rate_cents"
        case depositCents = "deposit_cents"
        case terms
        case availableSlots = "available_slots"
    }
}

// Life log history
struct OneLifeLogListResponse: Decodable {
    let entries: [OneLifeLogEntryDTO]?
    let data: [OneLifeLogEntryDTO]?
}

struct OneLifeLogEntryDTO: Decodable {
    let id: String?
    let pillarId: String?
    let title: String?
    let detail: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case pillarId = "pillar_id"
        case title
        case detail
        case createdAt = "created_at"
    }
}

// Sinking funds list
struct OneSinkingFundListResponse: Decodable {
    let funds: [OneSinkingFundDTO]?
    let data: [OneSinkingFundDTO]?
}

struct OneSinkingFundDTO: Decodable {
    let id: String?
    let title: String?
    let targetAmountCents: Int?
    let currentAmountCents: Int?
    let targetDate: String?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case targetAmountCents = "target_amount_cents"
        case currentAmountCents = "current_amount_cents"
        case targetDate = "target_date"
    }
}

// Unified inbox threads
struct OneInboxListResponse: Decodable {
    let conversations: [OneInboxThreadDTO]?
    let data: [OneInboxThreadDTO]?
}

struct OneInboxThreadDTO: Decodable {
    let id: Int?
    let participantName: String?
    let lastMessage: String?
    let personaSource: String?
    let unreadCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case participantName = "participant_name"
        case lastMessage = "last_message"
        case personaSource = "persona_source"
        case unreadCount = "unread_count"
    }
}

// MARK: - Phase 2: Form Submission Request/Response Models

struct OneJoinWholesaleRequest: Encodable {
    let groupId: String
    let persona: String

    enum CodingKeys: String, CodingKey {
        case groupId = "group_id"
        case persona
    }
}

struct OneGrantApplicationRequest: Encodable {
    let grantId: String
    let persona: String

    enum CodingKeys: String, CodingKey {
        case grantId = "grant_id"
        case persona
    }
}

struct OneCreatorUploadRequest: Encodable {
    let title: String
    let language: String
}

struct OneSubmitReviewRequest: Encodable {
    let targetUserId: String
    let rating: Int
    let comment: String
    let fromRole: String
    let toRole: String

    enum CodingKeys: String, CodingKey {
        case targetUserId = "target_user_id"
        case rating
        case comment
        case fromRole = "from_role"
        case toRole = "to_role"
    }
}

// MARK: - Phase 3: Image / Media Upload

struct OnePresignedURLRequest: Encodable {
    let fileName: String
    let contentType: String

    enum CodingKeys: String, CodingKey {
        case fileName = "file_name"
        case contentType = "content_type"
    }
}

struct OnePresignedURLResponse: Decodable {
    let presignedUrl: String
    let publicUrl: String

    enum CodingKeys: String, CodingKey {
        case presignedUrl = "presigned_url"
        case publicUrl = "public_url"
    }
}

// MARK: - Phase 4: Messaging

struct OneMessage: Decodable, Identifiable, Hashable {
    let id: String
    let threadID: Int
    let senderID: String
    let senderName: String
    let content: String
    let personaSource: String
    let createdAt: String
    let isRead: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case threadID = "thread_id"
        case senderID = "sender_id"
        case senderName = "sender_name"
        case content
        case personaSource = "persona_source"
        case createdAt = "created_at"
        case isRead = "is_read"
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: OneMessage, rhs: OneMessage) -> Bool {
        lhs.id == rhs.id
    }
}

struct OneMessageListResponse: Decodable {
    let messages: [OneMessage]
    let total: Int?
    let hasMore: Bool?

    enum CodingKeys: String, CodingKey {
        case messages
        case total
        case hasMore = "has_more"
    }
}

struct OneDeviceTokenRequest: Encodable {
    let deviceToken: String
    let platform: String

    enum CodingKeys: String, CodingKey {
        case deviceToken = "device_token"
        case platform
    }
}

struct OneMobilePushTokenRequest: Encodable {
    let token: String
    let provider: String
    let platform: String
}
