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
