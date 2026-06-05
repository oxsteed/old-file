import Foundation
import SwiftUI

// MARK: - Auth

struct APIUser: Codable, Identifiable, Equatable {
    let id: String
    let first_name: String?
    let last_name: String?
    let email: String
    let phone: String?
    let role: String?
    let email_verified: Bool?
    let is_verified: Bool?
    let onboarding_step: String?
    let onboarding_completed: Bool?
    let membership_tier: String?
    let effective_tier: String?
    let is_trial_active: Bool?
    let trial_days_left: Int?
    let trial_ends_at: String?
    let id_verified: Bool?
    let background_check_passed: Bool?
    let didit_status: String?
    let display_name_preference: String?
    let business_name: String?
    let preferred_language: String?
    let allow_guest_contact: Bool?
    let allow_booking: Bool?
    let allow_scheduling: Bool?
    let allow_live_chat: Bool?
    let default_mode: String?
    let avatar_url: String?
    let created_at: String?
    let updated_at: String?

    var displayName: String {
        switch display_name_preference {
        case "business_name":
            if let business = business_name?.trimmingCharacters(in: .whitespacesAndNewlines),
               !business.isEmpty {
                return business
            }
        case "full_name":
            let full = [first_name, last_name]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            if !full.isEmpty {
                return full
            }
        default:
            break
        }

        if let firstName = first_name?.trimmingCharacters(in: .whitespacesAndNewlines),
           !firstName.isEmpty {
            return firstName
        }
        if let business = business_name?.trimmingCharacters(in: .whitespacesAndNewlines),
           !business.isEmpty {
            return business
        }
        return email
    }

    var greetingName: String {
        let display = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !display.isEmpty, !display.contains("@") {
            return display
        }
        return "app.greeting.fallback_name"
    }

    /// Map server role into local Persona enum.
    var preferredPersona: Persona {
        Persona(serverMode: default_mode ?? role)
    }
}

struct AuthResponse: Decodable {
    let user: APIUser
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
}

struct RefreshResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
}

// MARK: - Jobs

struct APIJob: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let description: String?
    let category: String?
    let category_id: String?
    let status: String?
    let budget_type: String?
    let budget_min: Int?
    let budget_max: Int?
    let currency: String?
    let urgency: String?
    let location_address: String?
    let location_city: String?
    let location_state: String?
    let location_zip: String?
    let location_country: String?
    let location_lat: Double?
    let location_lng: Double?
    let scheduled_date: String?
    let scheduled_time: String?
    let customer_id: String?
    let customer_name: String?
    let customer_rating: Double?
    let bid_count: Int?
    let accepted_bid_id: String?
    let assigned_helper_id: String?
    let assigned_helper_name: String?
    let preferred_helper_id: String?
    let required_skills: [String]?
    let media_urls: [String]?
    let created_at: String?
    let updated_at: String?
    let distance_miles: Double?
    /// True when the helper has already submitted a review for the customer on this job.
    /// Returned by the server once review data is joined; nil = unknown (treat as not yet reviewed).
    let helper_reviewed_customer: Bool?

    enum CodingKeys: String, CodingKey {
        case id, title, description, category, category_id, status
        case budget_type, budget_min, budget_max, currency, urgency
        case location_address, location_city, location_state, location_zip, location_country
        case location_lat, location_lng, scheduled_date, scheduled_time
        case customer_id, customer_name, customer_rating, bid_count, accepted_bid_id
        case assigned_helper_id, assigned_helper_name
        case preferred_helper_id, required_skills, media_urls, created_at, updated_at, distance_miles
        case category_name, client_id, client_name, location_approx_lat, location_approx_lng
        case helper_reviewed_customer
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        category = try c.decodeIfPresent(String.self, forKey: .category) ?? c.decodeIfPresent(String.self, forKey: .category_name)
        category_id = try c.decodeIfPresent(String.self, forKey: .category_id)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        budget_type = try c.decodeIfPresent(String.self, forKey: .budget_type)
        budget_min = try c.decodeFlexibleIntIfPresent(forKey: .budget_min)
        budget_max = try c.decodeFlexibleIntIfPresent(forKey: .budget_max)
        currency = try c.decodeIfPresent(String.self, forKey: .currency)
        urgency = try c.decodeIfPresent(String.self, forKey: .urgency)
        location_address = try c.decodeIfPresent(String.self, forKey: .location_address)
        location_city = try c.decodeIfPresent(String.self, forKey: .location_city)
        location_state = try c.decodeIfPresent(String.self, forKey: .location_state)
        location_zip = try c.decodeIfPresent(String.self, forKey: .location_zip)
        location_country = try c.decodeIfPresent(String.self, forKey: .location_country)
        location_lat = try c.decodeIfPresent(Double.self, forKey: .location_lat) ?? c.decodeIfPresent(Double.self, forKey: .location_approx_lat)
        location_lng = try c.decodeIfPresent(Double.self, forKey: .location_lng) ?? c.decodeIfPresent(Double.self, forKey: .location_approx_lng)
        scheduled_date = try c.decodeIfPresent(String.self, forKey: .scheduled_date)
        scheduled_time = try c.decodeIfPresent(String.self, forKey: .scheduled_time)
        customer_id = try c.decodeFlexibleStringIfPresent(forKey: .customer_id) ?? c.decodeFlexibleStringIfPresent(forKey: .client_id)
        customer_name = try c.decodeIfPresent(String.self, forKey: .customer_name) ?? c.decodeIfPresent(String.self, forKey: .client_name)
        customer_rating = try c.decodeIfPresent(Double.self, forKey: .customer_rating)
        bid_count = try c.decodeIfPresent(Int.self, forKey: .bid_count)
        accepted_bid_id = try c.decodeFlexibleStringIfPresent(forKey: .accepted_bid_id)
        assigned_helper_id = try c.decodeFlexibleStringIfPresent(forKey: .assigned_helper_id)
        assigned_helper_name = try c.decodeIfPresent(String.self, forKey: .assigned_helper_name)
        preferred_helper_id = try c.decodeFlexibleStringIfPresent(forKey: .preferred_helper_id)
        required_skills = try c.decodeStringArrayIfPresent(forKey: .required_skills)
        media_urls = try c.decodeIfPresent([String].self, forKey: .media_urls)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at)
        distance_miles = try c.decodeIfPresent(Double.self, forKey: .distance_miles)
        helper_reviewed_customer = try c.decodeIfPresent(Bool.self, forKey: .helper_reviewed_customer)
    }

    var budgetDisplay: String {
        guard let min = budget_min, let max = budget_max else {
            if let min = budget_min { return "$\(min)+" }
            return "—"
        }
        return "$\(min) – $\(max)"
    }

    var statusColor: Color {
        switch status {
        case "in_progress": return Theme.accent
        case "matched", "negotiating", "accepted": return Theme.pillarHome
        case "completed": return Theme.success
        case "cancelled": return Theme.danger
        default: return Theme.warning
        }
    }

    /// Returns a localization key (or fallback English) suitable for passing to localization.localized().
    var statusDisplay: String {
        guard let s = status?.lowercased() else { return "Open" }
        switch s {
        case "draft":        return "Draft"
        case "published":    return "Published"
        case "pending":      return "Pending"
        case "matched":      return "Matched"
        case "assigned":     return "Assigned"
        case "accepted":     return "Accepted"
        case "negotiating":  return "Negotiating"
        case "in_progress":  return "In Progress"
        case "started":      return "Started"
        case "completed":    return "Completed"
        case "cancelled":    return "Cancelled"
        case "closed":       return "Closed"
        default:
            // Capitalize for use as a .strings key; will display as-is if key missing
            return s.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    var locationDisplay: String {
        [location_city, location_state].compactMap { $0 }.joined(separator: ", ")
    }

    var scheduledDisplay: String {
        [scheduled_date, scheduled_time].compactMap { $0 }.joined(separator: " ")
    }
}

struct JobCreateRequest: Encodable {
    let title: String
    let description: String
    let category_name: String?
    let budget_type: String       // "fixed" | "hourly" | "open"
    let budget_min: Int?
    let budget_max: Int?
    let urgency: String           // asap|this_week|next_week|flexible
    let location_city: String
    let location_state: String?
    let location_country: String
    let location_zip: String?
    let scheduled_date: String?
    let scheduled_time: String?
    let required_skills: [String]?
    let media_urls: [String]?
    // Recurring / subscription service
    let is_recurring: Bool?
    let recurrence_interval: String?  // "weekly" | "biweekly" | "monthly"

    enum CodingKeys: String, CodingKey {
        case title, description, category_name, budget_type, budget_min, budget_max
        case urgency, location_city, location_state, location_country, location_zip
        case scheduled_date, scheduled_time, required_skills, media_urls, is_recurring
        case recurrence_interval = "recurrence"
    }
}

// MARK: - Bids

struct APIBid: Decodable, Identifiable, Equatable {
    let id: String
    let job_id: String
    let helper_id: String?
    let helper_name: String?
    let helper_rating: Double?
    let amount: Int           // cents
    let status: String?
    let message: String?
    let estimated_hours: Double?
    let created_at: String?
    let updated_at: String?

    enum CodingKeys: String, CodingKey {
        case id, job_id, helper_id, helper_name, helper_rating
        case amount, status, message, estimated_hours, eta_hours, created_at, updated_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        job_id = try c.decodeFlexibleString(forKey: .job_id)
        helper_id = try c.decodeIfPresent(String.self, forKey: .helper_id)
        helper_name = try c.decodeIfPresent(String.self, forKey: .helper_name)
        helper_rating = try c.decodeIfPresent(Double.self, forKey: .helper_rating)
        amount = try c.decode(Int.self, forKey: .amount)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        message = try c.decodeIfPresent(String.self, forKey: .message)
        estimated_hours = try c.decodeIfPresent(Double.self, forKey: .estimated_hours) ?? c.decodeIfPresent(Double.self, forKey: .eta_hours)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at)
    }

    var amountDisplay: String { "$\(amount / 100)" }
}

struct BidCreateRequest: Encodable {
    let job_id: String
    let amount: Int
    let message: String?
    let estimated_hours: Double?
}

// MARK: - Helpers Directory

struct APIHelper: Codable, Identifiable, Equatable {
    let id: String
    let profileUrl: String?
    let businessName: String?
    let ownerName: String?
    let avatar: String?
    let rating: Double?
    let reviewCount: Int?
    let jobsCompleted: Int?
    let memberSince: String?
    let verified: Bool?
    let backgroundChecked: Bool?
    let categories: [String]?
    let skills: [String]?
    let licenses: [String]?
    let insurance: [String]?
    let topServices: [String]?
    let startingPrice: Int?
    let startingPriceUnit: String?
    let responseTime: String?
    let responseMinutes: Int?
    let city: String?
    let state: String?
    let serviceRadius: Int?
    let availableToday: Bool?
    let shortBio: String?
    let location_lat: Double?
    let location_lng: Double?

    var displayName: String { ownerName ?? businessName ?? "Helper" }
    var startingPriceDisplay: String {
        guard let p = startingPrice else { return "—" }
        return "$\(p / 100)+"
    }
}

// MARK: - Messages

struct APIConversation: Decodable, Identifiable, Equatable {
    let id: String
    let job_id: String?
    let customer_id: String?
    let helper_id: String?
    let business_id: String?
    let status: String?
    let other_user_name: String?
    let other_user_id: String?
    let job_title: String?
    let last_message: String?
    let last_message_sender_id: String?
    let helper_business_name: String?
    let conversation_business_name: String?
    let unread_count: Int?
    let last_message_at: String?
    let created_at: String?
    let archived_at: String?

    enum CodingKeys: String, CodingKey {
        case id, job_id, customer_id, helper_id, business_id, status
        case other_user_name, other_user_id, job_title, last_message, last_message_sender_id
        case helper_business_name, conversation_business_name, unread_count, last_message_at
        case created_at, archived_at
        case jobId, customerId, helperId, businessId, otherUserName, otherUserId, jobTitle
        case lastMessage, lastMessageSenderId, helperBusinessName, conversationBusinessName
        case unreadCount, lastMessageAt, createdAt, archivedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        job_id = try c.decodeIfPresent(String.self, forKey: .job_id) ?? c.decodeIfPresent(String.self, forKey: .jobId)
        customer_id = try c.decodeIfPresent(String.self, forKey: .customer_id) ?? c.decodeIfPresent(String.self, forKey: .customerId)
        helper_id = try c.decodeIfPresent(String.self, forKey: .helper_id) ?? c.decodeIfPresent(String.self, forKey: .helperId)
        business_id = try c.decodeIfPresent(String.self, forKey: .business_id) ?? c.decodeIfPresent(String.self, forKey: .businessId)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        other_user_name = try c.decodeIfPresent(String.self, forKey: .other_user_name) ?? c.decodeIfPresent(String.self, forKey: .otherUserName)
        other_user_id = try c.decodeIfPresent(String.self, forKey: .other_user_id) ?? c.decodeIfPresent(String.self, forKey: .otherUserId)
        job_title = try c.decodeIfPresent(String.self, forKey: .job_title) ?? c.decodeIfPresent(String.self, forKey: .jobTitle)
        last_message = try c.decodeIfPresent(String.self, forKey: .last_message) ?? c.decodeIfPresent(String.self, forKey: .lastMessage)
        last_message_sender_id = try c.decodeIfPresent(String.self, forKey: .last_message_sender_id) ?? c.decodeIfPresent(String.self, forKey: .lastMessageSenderId)
        helper_business_name = try c.decodeIfPresent(String.self, forKey: .helper_business_name) ?? c.decodeIfPresent(String.self, forKey: .helperBusinessName)
        conversation_business_name = try c.decodeIfPresent(String.self, forKey: .conversation_business_name) ?? c.decodeIfPresent(String.self, forKey: .conversationBusinessName)
        unread_count = try c.decodeIfPresent(Int.self, forKey: .unread_count) ?? c.decodeIfPresent(Int.self, forKey: .unreadCount)
        last_message_at = try c.decodeIfPresent(String.self, forKey: .last_message_at) ?? c.decodeIfPresent(String.self, forKey: .lastMessageAt)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at) ?? c.decodeIfPresent(String.self, forKey: .createdAt)
        archived_at = try c.decodeIfPresent(String.self, forKey: .archived_at) ?? c.decodeIfPresent(String.self, forKey: .archivedAt)
    }
}

struct APIMessage: Decodable, Identifiable, Equatable {
    let id: String
    let conversation_id: String?
    let sender_id: String?
    let sender_name: String?
    let content: String
    let attachments: [APIAttachment]?
    let is_read: Bool?
    let created_at: String?
    let updated_at: String?

    enum CodingKeys: String, CodingKey {
        case id, conversation_id, sender_id, sender_name, content, attachments, is_read, created_at, updated_at
        case conversationId, senderId, senderName, isRead, createdAt, updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        conversation_id = try c.decodeIfPresent(String.self, forKey: .conversation_id) ?? c.decodeIfPresent(String.self, forKey: .conversationId)
        sender_id = try c.decodeIfPresent(String.self, forKey: .sender_id) ?? c.decodeIfPresent(String.self, forKey: .senderId)
        sender_name = try c.decodeIfPresent(String.self, forKey: .sender_name) ?? c.decodeIfPresent(String.self, forKey: .senderName)
        content = try c.decodeIfPresent(String.self, forKey: .content) ?? ""
        attachments = try c.decodeIfPresent([APIAttachment].self, forKey: .attachments)
        is_read = try c.decodeIfPresent(Bool.self, forKey: .is_read) ?? c.decodeIfPresent(Bool.self, forKey: .isRead)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at) ?? c.decodeIfPresent(String.self, forKey: .createdAt)
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at) ?? c.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

struct APIAttachment: Codable, Equatable {
    let url: String
    let type: String?
    let filename: String?
}

struct APIAttachmentUpload: Decodable, Equatable {
    let url: String
    let type: String?
    let filename: String?
    let size_bytes: Int?

    enum CodingKeys: String, CodingKey {
        case url, type, filename, size_bytes
        case name, size, mimeType
    }

    init(url: String, type: String?, filename: String?, size_bytes: Int?) {
        self.url = url
        self.type = type
        self.filename = filename
        self.size_bytes = size_bytes
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = try c.decode(String.self, forKey: .url)
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? c.decodeIfPresent(String.self, forKey: .mimeType)
        filename = try c.decodeIfPresent(String.self, forKey: .filename) ?? c.decodeIfPresent(String.self, forKey: .name)
        size_bytes = try c.decodeIfPresent(Int.self, forKey: .size_bytes) ?? c.decodeIfPresent(Int.self, forKey: .size)
    }
}

struct SendMessageRequest: Encodable {
    let content: String
    let attachments: [APIAttachment]?
}

// MARK: - Calendar / Appointments

struct APIAppointment: Codable, Identifiable, Equatable {
    let id: String
    let customer_id: String?
    let customer_name: String?
    let helper_id: String?
    let helper_name: String?
    let job_id: String?
    let job_title: String?
    let service_title: String?
    let scheduled_date: String?
    let scheduled_start_at: String?
    let scheduled_end_at: String?
    let location: String?
    let status: String?
    let notes: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id
        case customer_id, customer_name, helper_id, helper_name, job_id, job_title
        case service_title, service_description
        case scheduled_date, scheduled_start_at, scheduled_end_at
        case scheduled_start_time, scheduled_end_time
        case location, location_address
        case notes, customer_notes, created_at, status
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        customer_id = try c.decodeIfPresent(String.self, forKey: .customer_id)
        customer_name = try c.decodeIfPresent(String.self, forKey: .customer_name)
        helper_id = try c.decodeIfPresent(String.self, forKey: .helper_id)
        helper_name = try c.decodeIfPresent(String.self, forKey: .helper_name)
        job_id = try c.decodeIfPresent(String.self, forKey: .job_id)
        job_title = try c.decodeIfPresent(String.self, forKey: .job_title)
        service_title = try c.decodeIfPresent(String.self, forKey: .service_title)
            ?? c.decodeIfPresent(String.self, forKey: .service_description)
        let backendStart = try c.decodeIfPresent(String.self, forKey: .scheduled_start_time)
        let backendEnd = try c.decodeIfPresent(String.self, forKey: .scheduled_end_time)
        scheduled_start_at = try c.decodeIfPresent(String.self, forKey: .scheduled_start_at) ?? backendStart
        scheduled_end_at = try c.decodeIfPresent(String.self, forKey: .scheduled_end_at) ?? backendEnd
        scheduled_date = try c.decodeIfPresent(String.self, forKey: .scheduled_date)
            ?? backendStart.flatMap { String($0.prefix(10)) }
        location = try c.decodeIfPresent(String.self, forKey: .location)
            ?? c.decodeIfPresent(String.self, forKey: .location_address)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
            ?? c.decodeIfPresent(String.self, forKey: .customer_notes)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(customer_id, forKey: .customer_id)
        try c.encodeIfPresent(customer_name, forKey: .customer_name)
        try c.encodeIfPresent(helper_id, forKey: .helper_id)
        try c.encodeIfPresent(helper_name, forKey: .helper_name)
        try c.encodeIfPresent(job_id, forKey: .job_id)
        try c.encodeIfPresent(job_title, forKey: .job_title)
        try c.encodeIfPresent(service_title, forKey: .service_title)
        try c.encodeIfPresent(scheduled_date, forKey: .scheduled_date)
        try c.encodeIfPresent(scheduled_start_at, forKey: .scheduled_start_at)
        try c.encodeIfPresent(scheduled_end_at, forKey: .scheduled_end_at)
        try c.encodeIfPresent(location, forKey: .location)
        try c.encodeIfPresent(notes, forKey: .notes)
        try c.encodeIfPresent(status, forKey: .status)
        try c.encodeIfPresent(created_at, forKey: .created_at)
    }
}

struct AppointmentCreateRequest: Encodable {
    let helper_id: String?
    let customer_id: String?
    let job_id: String?
    let service_title: String
    let scheduled_date: String
    let scheduled_start_time: String
    let scheduled_end_time: String
    let location: String?
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case helper_id, job_id
        case service_description
        case scheduled_start_time, scheduled_end_time
        case location_address
        case customer_notes
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(helper_id, forKey: .helper_id)
        try c.encodeIfPresent(job_id, forKey: .job_id)
        try c.encode(service_title, forKey: .service_description)
        try c.encode(Self.isoDateTime(date: scheduled_date, time: scheduled_start_time), forKey: .scheduled_start_time)
        try c.encode(Self.isoDateTime(date: scheduled_date, time: scheduled_end_time), forKey: .scheduled_end_time)
        try c.encodeIfPresent(location, forKey: .location_address)
        try c.encodeIfPresent(notes, forKey: .customer_notes)
    }

    private static func isoDateTime(date: String, time: String) -> String {
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .iso8601)
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = .current
        parser.dateFormat = "yyyy-MM-dd HH:mm"

        let normalizedTime = time.count == 5 ? time : String(time.prefix(5))
        guard let value = parser.date(from: "\(date) \(normalizedTime)") else {
            return "\(date)T\(normalizedTime):00"
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = .current
        return formatter.string(from: value)
    }
}

// MARK: - Bookings

struct APIBooking: Decodable, Identifiable, Equatable {
    let id: String
    let status: String?
    let customer_id: String?
    let helper_id: String?
    let service_name: String?
    let service_location: String?
    let description: String?
    let customer_name: String?
    let customer_avatar: String?
    let requested_date: String?
    let requested_start_time: String?
    let requested_end_time: String?
    let expires_at: String?
    let created_at: String?
    // Counter-propose fields (set by helper when suggesting an alternative time)
    let counter_proposed_at: String?
    let counter_date: String?
    let counter_start_time: String?
    let counter_end_time: String?
    let counter_message: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case customer_id, helper_id, service_name, service_location, description, customer_name, customer_avatar
        case requested_date, requested_start_time, requested_end_time, expires_at, created_at
        case customerId, helperId, serviceName, serviceLocation, customerName, customerAvatar
        case requestedDate, requestedStartTime, requestedEndTime, expiresAt, createdAt
        case counter_proposed_at, counter_date, counter_start_time, counter_end_time, counter_message
        case counterProposedAt, counterDate, counterStartTime, counterEndTime, counterMessage
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        customer_id = try c.decodeIfPresent(String.self, forKey: .customer_id) ?? c.decodeIfPresent(String.self, forKey: .customerId)
        helper_id = try c.decodeIfPresent(String.self, forKey: .helper_id) ?? c.decodeIfPresent(String.self, forKey: .helperId)
        service_name = try c.decodeIfPresent(String.self, forKey: .service_name) ?? c.decodeIfPresent(String.self, forKey: .serviceName)
        service_location = try c.decodeIfPresent(String.self, forKey: .service_location) ?? c.decodeIfPresent(String.self, forKey: .serviceLocation)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        customer_name = try c.decodeIfPresent(String.self, forKey: .customer_name) ?? c.decodeIfPresent(String.self, forKey: .customerName)
        customer_avatar = try c.decodeIfPresent(String.self, forKey: .customer_avatar) ?? c.decodeIfPresent(String.self, forKey: .customerAvatar)
        requested_date = try c.decodeIfPresent(String.self, forKey: .requested_date) ?? c.decodeIfPresent(String.self, forKey: .requestedDate)
        requested_start_time = try c.decodeIfPresent(String.self, forKey: .requested_start_time) ?? c.decodeIfPresent(String.self, forKey: .requestedStartTime)
        requested_end_time = try c.decodeIfPresent(String.self, forKey: .requested_end_time) ?? c.decodeIfPresent(String.self, forKey: .requestedEndTime)
        expires_at = try c.decodeIfPresent(String.self, forKey: .expires_at) ?? c.decodeIfPresent(String.self, forKey: .expiresAt)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at) ?? c.decodeIfPresent(String.self, forKey: .createdAt)
        counter_proposed_at = try c.decodeIfPresent(String.self, forKey: .counter_proposed_at) ?? c.decodeIfPresent(String.self, forKey: .counterProposedAt)
        counter_date        = try c.decodeIfPresent(String.self, forKey: .counter_date) ?? c.decodeIfPresent(String.self, forKey: .counterDate)
        counter_start_time  = try c.decodeIfPresent(String.self, forKey: .counter_start_time) ?? c.decodeIfPresent(String.self, forKey: .counterStartTime)
        counter_end_time    = try c.decodeIfPresent(String.self, forKey: .counter_end_time) ?? c.decodeIfPresent(String.self, forKey: .counterEndTime)
        counter_message     = try c.decodeIfPresent(String.self, forKey: .counter_message) ?? c.decodeIfPresent(String.self, forKey: .counterMessage)
    }
}

struct AvailabilitySlot: Decodable, Equatable, Identifiable {
    var id: String { "\(date)-\(time)" }
    let date: String
    let time: String
    let available: Bool
    let duration_minutes: Int?

    enum CodingKeys: String, CodingKey {
        case date, time, available, duration_minutes
        case startTime, endTime
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        time = try c.decodeIfPresent(String.self, forKey: .time) ?? c.decodeIfPresent(String.self, forKey: .startTime) ?? ""
        available = try c.decodeIfPresent(Bool.self, forKey: .available) ?? false
        if let duration = try c.decodeIfPresent(Int.self, forKey: .duration_minutes) {
            duration_minutes = duration
        } else if let start = try c.decodeIfPresent(String.self, forKey: .startTime),
                  let end = try c.decodeIfPresent(String.self, forKey: .endTime) {
            duration_minutes = AvailabilitySlot.minutesBetween(start, end)
        } else {
            duration_minutes = nil
        }
    }

    private static func minutesBetween(_ start: String, _ end: String) -> Int? {
        func minutes(_ value: String) -> Int? {
            let parts = value.split(separator: ":").compactMap { Int($0) }
            guard parts.count >= 2 else { return nil }
            return parts[0] * 60 + parts[1]
        }
        guard let s = minutes(start), let e = minutes(end), e > s else { return nil }
        return e - s
    }
}

struct AvailabilitySlotsResponse: Decodable, Equatable {
    let slots: [AvailabilitySlot]
}

struct BookingCreateRequest: Encodable {
    let helperId: String?
    let businessId: String?
    let serviceName: String
    let requestedDate: String
    let requestedStartTime: String
    let requestedEndTime: String
    let serviceLocation: String?
    let description: String?
    let confirmationHours: Int?
}

// MARK: - Notifications

struct APINotification: Decodable, Identifiable {
    let id: String
    let type: String?
    let title: String?
    let message: String?
    let data: [String: AnyDecodable]?
    let action_url: String?
    let is_read: Bool?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, type, title, body, message, data, action_url, is_read, created_at
    }

    init(id: String,
         type: String?,
         title: String?,
         message: String?,
         data: [String: AnyDecodable]?,
         action_url: String? = nil,
         is_read: Bool?,
         created_at: String?) {
        self.id = id
        self.type = type
        self.title = title
        self.message = message
        self.data = data
        self.action_url = action_url
        self.is_read = is_read
        self.created_at = created_at
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        // Backend uses bigint IDs; the APIClient decodes JSON numbers as Double when asked for String.
        // Decode flexibly as either String or Int/Double and normalize to String.
        if let s = try c.decodeIfPresent(String.self, forKey: .id) {
            id = s
        } else if let i = try c.decodeIfPresent(Int64.self, forKey: .id) {
            id = String(i)
        } else if let d = try c.decodeIfPresent(Double.self, forKey: .id) {
            id = String(Int64(d))
        } else {
            throw DecodingError.keyNotFound(
                CodingKeys.id,
                .init(codingPath: decoder.codingPath, debugDescription: "Missing notification id")
            )
        }

        type = try c.decodeIfPresent(String.self, forKey: .type)
        title = try c.decodeIfPresent(String.self, forKey: .title)

        // Production backend uses `body`; older payloads used `message`.
        if let body = try c.decodeIfPresent(String.self, forKey: .body) {
            message = body
        } else {
            message = try c.decodeIfPresent(String.self, forKey: .message)
        }

        data = try c.decodeIfPresent([String: AnyDecodable].self, forKey: .data)
        action_url = try c.decodeIfPresent(String.self, forKey: .action_url)
        is_read = try c.decodeIfPresent(Bool.self, forKey: .is_read)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }
}

struct NotificationPreferences: Codable {
    var email_enabled: Bool?
    var push_enabled: Bool?
    var sms_enabled: Bool?
    var frequency: String?
    var do_not_disturb_start: String?
    var do_not_disturb_end: String?
}

// MARK: - Learn

struct APILearnCompletion: Decodable, Equatable, Identifiable {
    var id: String { guide_id }
    let guide_id: String
    let completed_at: String?
}

struct APILearnCompletionsResponse: Decodable, Equatable {
    let completions: [APILearnCompletion]
}

struct APILearnBadge: Decodable, Equatable, Identifiable {
    var id: String { category }
    let category: String
    let awarded_at: String?
}

struct APILearnBadgesResponse: Decodable, Equatable {
    let badges: [APILearnBadge]
}

struct APILearnSubmission: Decodable, Equatable, Identifiable {
    let id: String
    let title: String?
    let category: String?
    let difficulty: String?
    let status: String?
    let reviewer_note: String?
    let submitted_at: String?
    let updated_at: String?

    enum CodingKeys: String, CodingKey {
        case id, title, category, difficulty, status, reviewer_note, submitted_at, updated_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        difficulty = try c.decodeIfPresent(String.self, forKey: .difficulty)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        reviewer_note = try c.decodeIfPresent(String.self, forKey: .reviewer_note)
        submitted_at = try c.decodeIfPresent(String.self, forKey: .submitted_at)
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at)
    }
}

struct APILearnSubmissionsResponse: Decodable, Equatable {
    let submissions: [APILearnSubmission]
}

struct APILearnStatsResponse: Decodable, Equatable {
    struct Stat: Decodable, Equatable {
        let completions: Int
        let views: Int
    }
    let stats: [String: Stat]
}

struct APILearnRecordCompletionResponse: Decodable, Equatable {
    let success: Bool?
    let xp_awarded: Int?
    let already_completed: Bool?
    let badge_awarded: String?
}

// MARK: - Life (Pulse)

struct APILifePulse: Decodable, Equatable {
    let window: String?
    let window_days: Int?
    let no_data: Bool?
    let pulse_score: Int?

    struct ScoreBreakdown: Decodable, Equatable {
        let coverage: Int?
        let buffer: Int?
        let reliability: Int?
        let obligations: Int?
    }
    let score_breakdown: ScoreBreakdown?

    struct Trend: Decodable, Equatable {
        let projected_income_pct: Double?
        let projected_expenses_pct: Double?
        let net_available_pct: Double?
        let coverage_ratio_pct: Double?
    }
    let trend: Trend?
}

struct APILifeDashboardSummary: Decodable, Equatable {
    let pulse_score: Int?
    let pulse_breakdown: [String: Int]?

    struct Finances: Decodable, Equatable {
        let total_income: Double?
        let total_expenses: Double?
        let net: Double?
        let month: Int?
        let year: Int?
    }
    let finances: Finances?

    struct Goals: Decodable, Equatable {
        let active: Int?
        let completed: Int?
        let avg_progress: Int?
    }
    let goals: Goals?

    struct Home: Decodable, Equatable {
        let overdue: Int?
        let due_this_week: Int?
        let total_pending: Int?
    }
    let home: Home?

    struct Checklist: Decodable, Equatable {
        let total: Int?
        let completed: Int?
    }
    let checklist: Checklist?

    struct Activity: Decodable, Equatable {
        let active_jobs_posted: Int?
        let active_bids: Int?
        let jobs_completed: Int?
        let avg_rating: Double?
        let review_count: Int?
    }
    let activity: Activity?

    struct PlannedNeeds: Decodable, Equatable {
        let active_count: Int?
        let activating_soon_count: Int?
        let publishing_this_week: Int?
        let total_planned_cost: Double?
        let next_due_date: String?
    }
    let planned_needs: PlannedNeeds?
}

// MARK: - Life (Dashboard)

struct APILifeExpense: Decodable, Equatable, Identifiable {
    let id: String
    let type: String?              // income | expense
    let amount: Double?
    let category: String?
    let description: String?
    let occurred_at: String?
    let frequency: String?
    let is_recurring: Bool?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, type, amount, category, description, occurred_at, frequency, is_recurring, created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        amount = try c.decodeFlexibleDoubleIfPresent(forKey: .amount)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        occurred_at = try c.decodeIfPresent(String.self, forKey: .occurred_at)
        frequency = try c.decodeIfPresent(String.self, forKey: .frequency)
        is_recurring = try c.decodeFlexibleBoolIfPresent(forKey: .is_recurring)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }
}

struct APILifeExpenseSummary: Decodable, Equatable {
    let total_income: Double?
    let total_expenses: Double?
    let net: Double?
    let month: Int?
    let year: Int?
}

struct APILifeExpensesResponse: Decodable, Equatable {
    let expenses: [APILifeExpense]
    let summary: APILifeExpenseSummary?
}

struct APILifeBudget: Decodable, Equatable, Identifiable {
    let id: String
    let category: String
    let color: String?
    let monthly_limit: Double?
    let spent: Double?
    let created_at: String?
    let updated_at: String?

    enum CodingKeys: String, CodingKey { case id, category, color, monthly_limit, spent, created_at, updated_at }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        category = (try? c.decode(String.self, forKey: .category)) ?? ""
        color = try c.decodeIfPresent(String.self, forKey: .color)
        monthly_limit = try c.decodeFlexibleDoubleIfPresent(forKey: .monthly_limit)
        spent = try c.decodeFlexibleDoubleIfPresent(forKey: .spent)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at)
    }
}

struct APILifeBudgetsResponse: Decodable, Equatable {
    let budgets: [APILifeBudget]
}

struct APILifeGoal: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let goal_type: String?
    let target_value: Double?
    let current_value: Double?
    let due_date: String?
    let is_completed: Bool?
    let icon: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, title, goal_type, target_value, current_value, due_date, is_completed, icon, created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        goal_type = try c.decodeIfPresent(String.self, forKey: .goal_type)
        target_value = try c.decodeFlexibleDoubleIfPresent(forKey: .target_value)
        current_value = try c.decodeFlexibleDoubleIfPresent(forKey: .current_value)
        due_date = try c.decodeIfPresent(String.self, forKey: .due_date)
        is_completed = try c.decodeFlexibleBoolIfPresent(forKey: .is_completed)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }
}

struct APILifeGoalsResponse: Decodable, Equatable {
    let goals: [APILifeGoal]
}

struct APILifeChecklistItem: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let due_date: String?
    let is_completed: Bool?
    let completed_at: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey { case id, title, due_date, is_completed, completed_at, created_at }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        due_date = try c.decodeIfPresent(String.self, forKey: .due_date)
        is_completed = try c.decodeFlexibleBoolIfPresent(forKey: .is_completed)
        completed_at = try c.decodeIfPresent(String.self, forKey: .completed_at)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }
}

struct APILifeChecklistResponse: Decodable, Equatable {
    let items: [APILifeChecklistItem]
}

struct APILifeSavedHelper: Decodable, Equatable, Identifiable {
    let id: String
    let helper_id: String?
    let note: String?
    let created_at: String?
    let display_name: String?
    let avg_rating: Double?
    let completed_jobs: Int?
    let bio_short: String?

    enum CodingKeys: String, CodingKey {
        case id, helper_id, note, created_at, display_name, avg_rating, completed_jobs, bio_short
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        helper_id = try c.decodeFlexibleStringIfPresent(forKey: .helper_id)
        note = try c.decodeIfPresent(String.self, forKey: .note)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
        display_name = try c.decodeIfPresent(String.self, forKey: .display_name)
        avg_rating = try c.decodeFlexibleDoubleIfPresent(forKey: .avg_rating)
        if let n = try? c.decodeIfPresent(Int.self, forKey: .completed_jobs) {
            completed_jobs = n
        } else if let raw = try? c.decodeIfPresent(String.self, forKey: .completed_jobs), let n = Int(raw) {
            completed_jobs = n
        } else {
            completed_jobs = nil
        }
        bio_short = try c.decodeIfPresent(String.self, forKey: .bio_short)
    }
}

struct APILifeSavedHelpersResponse: Decodable, Equatable {
    let saved_helpers: [APILifeSavedHelper]
}

struct APILifeHomeTask: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let due_date: String?
    let urgency: String?
    let section: String?
    let is_completed: Bool?
    let estimated_cost: Double?
    let frequency: String?
    let vehicle_name: String?
    let home_name: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description, due_date, urgency, section, is_completed
        case estimated_cost, frequency, vehicle_name, home_name, created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        description = try c.decodeIfPresent(String.self, forKey: .description)
        due_date = try c.decodeIfPresent(String.self, forKey: .due_date)
        urgency = try c.decodeIfPresent(String.self, forKey: .urgency)
        section = try c.decodeIfPresent(String.self, forKey: .section)
        is_completed = try c.decodeFlexibleBoolIfPresent(forKey: .is_completed)
        estimated_cost = try c.decodeFlexibleDoubleIfPresent(forKey: .estimated_cost)
        frequency = try c.decodeIfPresent(String.self, forKey: .frequency)
        vehicle_name = try c.decodeIfPresent(String.self, forKey: .vehicle_name)
        home_name = try c.decodeIfPresent(String.self, forKey: .home_name)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }
}

struct APILifeHomeTasksResponse: Decodable, Equatable {
    let home_tasks: [APILifeHomeTask]
}

struct APILifeSinkingFund: Decodable, Equatable, Identifiable {
    let id: String
    let client_id: String?
    let name: String
    let target_amount: Double?
    let saved_amount: Double?
    let target_date: String?
    let paycheck_interval: String?
    let icon: String?
    let color: String?
    let created_at: String?
    let updated_at: String?

    enum CodingKeys: String, CodingKey {
        case id, client_id, name, target_amount, saved_amount, target_date
        case paycheck_interval, icon, color, created_at, updated_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        client_id = try c.decodeFlexibleStringIfPresent(forKey: .client_id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        target_amount = try c.decodeFlexibleDoubleIfPresent(forKey: .target_amount)
        saved_amount = try c.decodeFlexibleDoubleIfPresent(forKey: .saved_amount)
        target_date = try c.decodeIfPresent(String.self, forKey: .target_date)
        paycheck_interval = try c.decodeIfPresent(String.self, forKey: .paycheck_interval)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        color = try c.decodeIfPresent(String.self, forKey: .color)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at)
    }

    var progress: Double {
        guard let target = target_amount, target > 0 else { return 0 }
        return min((saved_amount ?? 0) / target, 1)
    }
}

struct APILifeSinkingFundsResponse: Decodable, Equatable {
    let sinking_funds: [APILifeSinkingFund]
}

struct APILifeVehicle: Decodable, Equatable, Identifiable {
    let id: String
    let client_id: String?
    let vin: String?
    let year: String?
    let make: String
    let model: String
    let mileage: Int?
    let last_oil_change_mile: Int?
    let last_service_date: String?
    let notes: String?
    let created_at: String?
    let updated_at: String?

    enum CodingKeys: String, CodingKey {
        case id, client_id, vin, year, make, model, mileage
        case last_oil_change_mile, last_service_date, notes, created_at, updated_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        client_id = try c.decodeFlexibleStringIfPresent(forKey: .client_id)
        vin = try c.decodeIfPresent(String.self, forKey: .vin)
        year = try c.decodeFlexibleStringIfPresent(forKey: .year)
        make = (try? c.decode(String.self, forKey: .make)) ?? ""
        model = (try? c.decode(String.self, forKey: .model)) ?? ""
        mileage = try c.decodeFlexibleIntIfPresent(forKey: .mileage)
        last_oil_change_mile = try c.decodeFlexibleIntIfPresent(forKey: .last_oil_change_mile)
        last_service_date = try c.decodeIfPresent(String.self, forKey: .last_service_date)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at)
    }
}

struct APILifeVehiclesResponse: Decodable, Equatable {
    let vehicles: [APILifeVehicle]
}

struct APILifeHabit: Decodable, Equatable, Identifiable {
    let id: String
    let client_id: String?
    let name: String
    let icon: String?
    let streak: Int?
    let completed_today: Bool?
    let target_days_per_week: Int?
    let created_at: String?
    let updated_at: String?

    enum CodingKeys: String, CodingKey {
        case id, client_id, name, icon, streak, completed_today
        case target_days_per_week, created_at, updated_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        client_id = try c.decodeFlexibleStringIfPresent(forKey: .client_id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        streak = try c.decodeFlexibleIntIfPresent(forKey: .streak)
        completed_today = try c.decodeFlexibleBoolIfPresent(forKey: .completed_today)
        target_days_per_week = try c.decodeFlexibleIntIfPresent(forKey: .target_days_per_week)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at)
    }
}

struct APILifeHabitsResponse: Decodable, Equatable {
    let habits: [APILifeHabit]
}

// MARK: - Growth

struct APIGrowthProgram: Decodable, Identifiable {
    let id: Int
    let title: String
    let subtitle: String?
    let iconName: String?
    let colorKey: String?
    let ctaLabel: String?
    let ctaUrl: String?
    let ctaType: String?       // "external" | "tab_learn" | "tab_life" | "tab_home" | "tab_growth"
    let personaFilter: [String]?
    let sortOrder: Int?

    enum CodingKeys: String, CodingKey {
        case id, title, subtitle
        case iconName     = "icon_name"
        case colorKey     = "color_key"
        case ctaLabel     = "cta_label"
        case ctaUrl       = "cta_url"
        case ctaType      = "cta_type"
        case personaFilter = "persona_filter"
        case sortOrder    = "sort_order"
    }
}

struct APIGrowthProgramsResponse: Decodable {
    let programs: [APIGrowthProgram]
}

struct APIWholesaleListing: Decodable, Identifiable {
    let id: Int
    let title: String
    let subtitle: String?
    let iconName: String?
    let savePercent: Double?
    let joinedCount: Int?
    let category: String?
    let externalUrl: String?
    let sortOrder: Int?

    enum CodingKeys: String, CodingKey {
        case id, title, subtitle, category
        case iconName    = "icon_name"
        case savePercent = "save_percent"
        case joinedCount = "joined_count"
        case externalUrl = "external_url"
        case sortOrder   = "sort_order"
    }
}

struct APIWholesaleResponse: Decodable {
    let listings: [APIWholesaleListing]
}

struct APIGrowthFinancingPreQualRequest: Encodable {
    let loan_type: String
    let amount_needed: Double
    let months_in_business: Int?
    let annual_revenue: Double?
    let credit_score_band: String
    let business_type: String
}

struct APIGrowthFinancingApplication: Decodable {
    let id: String
    let status: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, status, created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }
}

struct APIGrowthFinancingPreQualResponse: Decodable {
    let ok: Bool
    let application: APIGrowthFinancingApplication?
}

struct APIGrowthGrant: Decodable, Identifiable {
    let id: String
    let name: String
    let sponsor: String
    let amount: String
    let eligibility: String
    let deadline: String?
    let applyURL: String?
    let category: String

    enum CodingKeys: String, CodingKey {
        case id, name, sponsor, amount, eligibility, deadline, category
        case applyURL = "apply_url"
    }
}

struct APIGrowthGrantsResponse: Decodable {
    let grants: [APIGrowthGrant]
}

// MARK: - Discover

struct APIDiscoverItem: Decodable, Equatable, Identifiable {
    let type: String
    let id: String
    let title: String
    let subtitle: String?
    let url: String?
    let meta: String?
    let imageUrl: String?
    let priceHint: String?
    let distanceMiles: Double?
    let rating: Double?
    let reviewCount: Int?
    let verified: Bool?
    let backgroundChecked: Bool?
    let availableToday: Bool?
    let freshnessDays: Int?
    let freshnessKey: String?
    let matchReasons: [String]?
    let primaryAction: String?

    enum CodingKeys: String, CodingKey {
        case type, id, title, subtitle, url, meta
        case imageUrl, priceHint, distanceMiles, rating, reviewCount
        case verified, backgroundChecked, availableToday
        case freshnessDays, freshnessKey, matchReasons, primaryAction
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        id = try c.decodeFlexibleString(forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        subtitle = try c.decodeIfPresent(String.self, forKey: .subtitle)
        url = try c.decodeIfPresent(String.self, forKey: .url)
        meta = try c.decodeIfPresent(String.self, forKey: .meta)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        priceHint = try c.decodeIfPresent(String.self, forKey: .priceHint)
        distanceMiles = try c.decodeFlexibleDoubleIfPresent(forKey: .distanceMiles)
        rating = try c.decodeFlexibleDoubleIfPresent(forKey: .rating)
        reviewCount = try c.decodeIfPresent(Int.self, forKey: .reviewCount)
        verified = try c.decodeFlexibleBoolIfPresent(forKey: .verified)
        backgroundChecked = try c.decodeFlexibleBoolIfPresent(forKey: .backgroundChecked)
        availableToday = try c.decodeFlexibleBoolIfPresent(forKey: .availableToday)
        freshnessDays = try c.decodeIfPresent(Int.self, forKey: .freshnessDays)
        freshnessKey = try c.decodeIfPresent(String.self, forKey: .freshnessKey)
        matchReasons = try c.decodeIfPresent([String].self, forKey: .matchReasons)
        primaryAction = try c.decodeIfPresent(String.self, forKey: .primaryAction)
    }
}

struct APIDiscoverPopularResponse: Decodable, Equatable {
    let results: [APIDiscoverItem]
    let radiusMiles: Int?
}

struct APIDiscoverSearchResponse: Decodable, Equatable {
    let query: String
    let expandedTerms: [String]?
    let radiusMiles: Int?
    let results: [APIDiscoverItem]
    let contentSignature: String?
    let total: Int?
    let offset: Int?
    let limit: Int?
    let hasMore: Bool?
}

// MARK: - Payments

struct APIPaymentIntent: Decodable {
    let client_secret: String?
    let payment_intent_id: String?
    let amount: Int?
    let currency: String?
}

// MARK: - Business workspace

struct WorkspaceBusinessItem: Codable, Identifiable, Equatable {
    var id: String { String(business_id) }
    let business_id: Int
    let business_name: String
    let role: String
    let status: String?
    let is_primary: Bool?
    let is_owner: Bool?
    let membership_id: Int?
    let last_selected_at: String?
}

struct WorkspaceBusinessesResponse: Codable, Equatable {
    let items: [WorkspaceBusinessItem]
    let last_selected: WorkspaceBusinessItem?
    let owned_count: Int?
    let membership_count: Int?
    let pending_count: Int?
}

struct BusinessAnalyticsSummary: Codable, Equatable {
    struct MonthlyPoint: Codable, Equatable, Identifiable {
        var id: String { month }
        let month: String
        let revenue: Double
        let expenses: Double
        let profit: Double
    }

    struct KPI: Codable, Equatable {
        let revenue: Double?
        let expenses: Double?
        let profit: Double?
    }

    struct InvoiceStats: Codable, Equatable {
        let outstanding_total: Double?
        let overdue_total: Double?
        let sent: Int?
        let overdue_count: Int?
    }

    struct JobStats: Codable, Equatable {
        let completed_6m: Int?
        let avg_value: Double?
        let max_value: Double?
    }

    let monthly: [MonthlyPoint]
    let mtd: KPI?
    let last_month: KPI?
    let ytd: KPI?
    let invoices: InvoiceStats?
    let jobs: JobStats?
}

struct BusinessProductSummary: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let category: String?
    let price: Double?
    let sku: String?
    let thumbnailUrl: String?
    let variantCount: Int?
    let totalStock: Int?
    let avgRating: Double?
    let reviewCount: Int?
    let isActive: Bool?
    let createdAt: String?
}

struct BusinessLeadSummary: Codable, Identifiable, Equatable {
    let id: String
    let name: String?
    let email: String?
    let phone: String?
    let service_interest: String?
    let budget_cents: Int?
    let notes: String?
    let status: String?
    let source: String?
    let created_at: String?
    let updated_at: String?
}

struct BusinessHealthAlert: Codable, Identifiable, Equatable {
    let id: String
    let alert_type: String?
    let severity: String?
    let title: String?
    let message: String?
    let action_url: String?
    let is_dismissed: Bool?
    let created_at: String?
}

struct BusinessCalendarSummary: Codable, Equatable {
    let today_count: Int?
    let this_week_count: Int?
    let next_24h_count: Int?
    let next_event_at: String?
}

struct APIPayment: Codable, Identifiable, Equatable {
    let id: String
    let job_id: String?
    let amount: Int
    let currency: String?
    let status: String?
    let created_at: String?
}

struct PaymentsList: Decodable {
    let payments: [APIPayment]
    let total: Int?
    let limit: Int?
    let offset: Int?
}

// MARK: - Tool Rentals

struct APIToolRental: Decodable, Identifiable, Equatable {
    let id: String
    let user_id: String?
    let name: String?
    let category: String?
    let description: String?
    let daily_rate: Double?
    let hourly_rate: Double?
    let deposit_amount: Double?
    let condition: String?
    let brand: String?
    let model: String?
    let is_available: Bool?
    let requires_deposit: Bool?
    let delivery_available: Bool?
    let pickup_only: Bool?
    let location_city: String?
    let location_state: String?
    let location_lat: Double?
    let location_lng: Double?
    let owner_rules: String?
    let replacement_value: Double?
    let avg_rating: Double?
    let review_count: Int?
    let image_url: String?
    let created_at: String?
    let updated_at: String?

    var dailyRateDisplay: String {
        guard let r = daily_rate else { return "—" }
        return String(format: "$%.0f/day", r)
    }

    enum CodingKeys: String, CodingKey {
        case id, user_id, name, category, description
        case daily_rate, hourly_rate, deposit_amount
        case condition, brand, model
        case is_available, requires_deposit, delivery_available, pickup_only
        case location_city, location_state, location_lat, location_lng
        case owner_rules, replacement_value
        case avg_rating, review_count, image_url
        case created_at, updated_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        user_id = try? c.decodeFlexibleString(forKey: .user_id)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        daily_rate = try c.decodeIfPresent(Double.self, forKey: .daily_rate)
        hourly_rate = try c.decodeIfPresent(Double.self, forKey: .hourly_rate)
        deposit_amount = try c.decodeIfPresent(Double.self, forKey: .deposit_amount)
        condition = try c.decodeIfPresent(String.self, forKey: .condition)
        brand = try c.decodeIfPresent(String.self, forKey: .brand)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        is_available = try c.decodeIfPresent(Bool.self, forKey: .is_available)
        requires_deposit = try c.decodeIfPresent(Bool.self, forKey: .requires_deposit)
        delivery_available = try c.decodeIfPresent(Bool.self, forKey: .delivery_available)
        pickup_only = try c.decodeIfPresent(Bool.self, forKey: .pickup_only)
        location_city = try c.decodeIfPresent(String.self, forKey: .location_city)
        location_state = try c.decodeIfPresent(String.self, forKey: .location_state)
        location_lat = try c.decodeIfPresent(Double.self, forKey: .location_lat)
        location_lng = try c.decodeIfPresent(Double.self, forKey: .location_lng)
        owner_rules = try c.decodeIfPresent(String.self, forKey: .owner_rules)
        replacement_value = try c.decodeIfPresent(Double.self, forKey: .replacement_value)
        avg_rating = try c.decodeIfPresent(Double.self, forKey: .avg_rating)
        review_count = try c.decodeIfPresent(Int.self, forKey: .review_count)
        image_url = try c.decodeIfPresent(String.self, forKey: .image_url)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
        updated_at = try c.decodeIfPresent(String.self, forKey: .updated_at)
    }
}

struct StripeConnectStatus: Decodable {
    let connect_account_id: String?
    let charges_enabled: Bool?
    let payouts_enabled: Bool?
    let verification_status: String?

    enum CodingKeys: String, CodingKey {
        case connect_account_id, charges_enabled, payouts_enabled, verification_status
        case stripe_account_id, onboarding_complete, connected
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        connect_account_id = try c.decodeIfPresent(String.self, forKey: .connect_account_id)
            ?? c.decodeIfPresent(String.self, forKey: .stripe_account_id)
        charges_enabled = try c.decodeIfPresent(Bool.self, forKey: .charges_enabled)
        payouts_enabled = try c.decodeIfPresent(Bool.self, forKey: .payouts_enabled)
        let onboardingComplete = try c.decodeIfPresent(Bool.self, forKey: .onboarding_complete)
        let connected = try c.decodeIfPresent(Bool.self, forKey: .connected)
        verification_status = try c.decodeIfPresent(String.self, forKey: .verification_status)
            ?? (onboardingComplete == true ? "complete" : nil)
            ?? (connected == false ? "not_connected" : nil)
    }
}

// MARK: - Back-compat convenience

extension StripeConnectStatus {
    /// Some UI screens still reference the legacy JSON key name.
    var stripe_account_id: String? { connect_account_id }
}

extension APIPayment {
    /// Lightweight display label for UI lists.
    var description: String? {
        if let job_id, !job_id.isEmpty { return "Job \(job_id)" }
        return nil
    }
}

struct PaymentJobDetails: Decodable, Equatable {
    let job_id: String?
    let payment_intent_id: String?
    let amount: Int?
    let status: String?
    let escrow_released_at: String?

    enum CodingKeys: String, CodingKey {
        case job_id, payment_intent_id, amount, status, escrow_released_at
        case stripe_payment_intent_id
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        job_id = try c.decodeIfPresent(String.self, forKey: .job_id)
        payment_intent_id = try c.decodeIfPresent(String.self, forKey: .payment_intent_id)
            ?? c.decodeIfPresent(String.self, forKey: .stripe_payment_intent_id)
        amount = try c.decodeIfPresent(Int.self, forKey: .amount)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        escrow_released_at = try c.decodeIfPresent(String.self, forKey: .escrow_released_at)
    }
}

// MARK: - Reviews

struct APIReview: Decodable, Identifiable {
    let id: String
    let job_id: String?
    let reviewer_id: String
    let reviewee_id: String
    let rating: Int
    let comment: String?
    let created_at: String?
    let reviewer_name: String?
    let reviewee_name: String?
}

// MARK: - Helper Quotes

struct QuoteLineItem: Codable, Identifiable {
    var id: UUID = UUID()
    var description: String
    var type: String          // "labor" | "material" | "other"
    var quantity: Double
    var unit_price_cents: Int

    var subtotal_cents: Int { Int((Double(unit_price_cents) * quantity).rounded()) }

    // MARK: Codable (exclude generated id)
    enum CodingKeys: String, CodingKey {
        case description, type, quantity, unit_price_cents
    }
}

struct APIHelperQuote: Decodable, Identifiable {
    let id: String
    let job_id: String
    let helper_id: String?
    let line_items: [QuoteLineItem]
    let tax_rate: Double
    let subtotal_cents: Int
    let tax_cents: Int
    let total_cents: Int
    let notes: String?
    let status: String        // sent | accepted | declined | expired | withdrawn
    let valid_until: String?
    let created_at: String?
    // Joined fields
    let job_title: String?
    let helper_name: String?
    let client_name: String?
    let helper_photo: String?
    let average_rating: Double?

    var statusDisplay: String {
        switch status.lowercased() {
        case "sent":      return "Sent"
        case "accepted":  return "Accepted"
        case "declined":  return "Declined"
        case "expired":   return "Expired"
        case "withdrawn": return "Withdrawn"
        case "draft":     return "Draft"
        default:          return status.capitalized
        }
    }
    var statusColor: Color {
        switch status {
        case "accepted": return Theme.success
        case "declined", "withdrawn", "expired": return Theme.danger
        default: return Theme.warning
        }
    }
    var totalDisplay: String { String(format: "$%.2f", Double(total_cents) / 100.0) }
}

// MARK: - Saved Searches

struct APISavedSearch: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let keyword: String?
    let category: String?
    let city: String?
    let state: String?
    let radius_miles: Int?
    let min_budget: Int?
    let max_budget: Int?
    let notify: Bool
    let created_at: String?

    var summaryLine: String {
        var parts: [String] = []
        if let k = keyword, !k.isEmpty { parts.append(k) }
        if let c = category, !c.isEmpty { parts.append(c) }
        if let city = city { parts.append(city) }
        if let r = radius_miles { parts.append("\(r) mi") }
        return parts.isEmpty ? "All jobs" : parts.joined(separator: " · ")
    }
}

// MARK: - Misc

struct OkResponse: Decodable { let ok: Bool? }

struct UploadResponse: Decodable {
    let url: String
    let key: String?
    let content_type: String?
    let size_bytes: Int?
}

// MARK: - Calendar extras

struct RescheduleRequest: Codable, Identifiable, Equatable {
    let id: String
    let appointment_id: String?
    let status: String?
    let proposed_date: String?
    let proposed_start_time: String?
    let proposed_end_time: String?
    let reason: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, appointment_id, status
        case proposed_date, proposed_start_time, proposed_end_time
        case proposed_start, proposed_end
        case reason, message, created_at
    }

    init(id: String,
         appointment_id: String?,
         status: String?,
         proposed_date: String?,
         proposed_start_time: String?,
         proposed_end_time: String?,
         reason: String?,
         created_at: String?) {
        self.id = id
        self.appointment_id = appointment_id
        self.status = status
        self.proposed_date = proposed_date
        self.proposed_start_time = proposed_start_time
        self.proposed_end_time = proposed_end_time
        self.reason = reason
        self.created_at = created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        appointment_id = try c.decodeIfPresent(String.self, forKey: .appointment_id)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        let proposedStart = try c.decodeIfPresent(String.self, forKey: .proposed_start)
        let proposedEnd = try c.decodeIfPresent(String.self, forKey: .proposed_end)
        proposed_date = try c.decodeIfPresent(String.self, forKey: .proposed_date)
            ?? proposedStart.flatMap { String($0.prefix(10)) }
        proposed_start_time = try c.decodeIfPresent(String.self, forKey: .proposed_start_time)
            ?? proposedStart
        proposed_end_time = try c.decodeIfPresent(String.self, forKey: .proposed_end_time)
            ?? proposedEnd
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
            ?? c.decodeIfPresent(String.self, forKey: .message)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(appointment_id, forKey: .appointment_id)
        try c.encodeIfPresent(status, forKey: .status)
        try c.encodeIfPresent(proposed_date, forKey: .proposed_date)
        try c.encodeIfPresent(proposed_start_time, forKey: .proposed_start_time)
        try c.encodeIfPresent(proposed_end_time, forKey: .proposed_end_time)
        try c.encodeIfPresent(reason, forKey: .reason)
        try c.encodeIfPresent(created_at, forKey: .created_at)
    }
}

struct AvailabilityBlock: Codable, Identifiable, Equatable {
    let id: String
    let date: String?
    let start_time: String?
    let end_time: String?
    let is_available: Bool?
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case id, date, start_time, end_time, is_available, type, notes
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        start_time = try c.decodeIfPresent(String.self, forKey: .start_time)
        end_time = try c.decodeIfPresent(String.self, forKey: .end_time)
        date = try c.decodeIfPresent(String.self, forKey: .date)
            ?? start_time.flatMap { String($0.prefix(10)) }
        if let raw = try c.decodeIfPresent(String.self, forKey: .type) {
            is_available = raw == "available"
        } else {
            is_available = try c.decodeFlexibleBoolIfPresent(forKey: .is_available)
        }
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(date, forKey: .date)
        try c.encodeIfPresent(start_time, forKey: .start_time)
        try c.encodeIfPresent(end_time, forKey: .end_time)
        try c.encodeIfPresent(is_available, forKey: .is_available)
        try c.encodeIfPresent(notes, forKey: .notes)
    }
}

// MARK: - Chat extras

struct GuestChatSessionResponse: Codable, Equatable {
    let inquiry_id: String?
    let ok: Bool?
}

struct ChatProfileContext: Codable, Equatable {
    let systemPrompt: String?
    let knowledgeBase: String?
    let contextVersion: String?
}

struct TranscriptionResponse: Codable, Equatable {
    let text: String?
    let confidence: Double?
}

private extension KeyedDecodingContainer {
    func decodeFlexibleString(forKey key: Key) throws -> String {
        if let value = try? decode(String.self, forKey: key) { return value }
        if let value = try? decode(Int.self, forKey: key) { return String(value) }
        if let value = try? decode(Double.self, forKey: key) { return String(value) }
        throw DecodingError.typeMismatch(
            String.self,
            DecodingError.Context(codingPath: codingPath + [key], debugDescription: "Expected string-compatible value")
        )
    }

    func decodeFlexibleStringIfPresent(forKey key: Key) throws -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return String(value) }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return String(value) }
        return nil
    }

    func decodeFlexibleDoubleIfPresent(forKey key: Key) throws -> Double? {
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return Double(value) }
        if let raw = try? decodeIfPresent(String.self, forKey: key) {
            let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if s.isEmpty { return nil }
            return Double(s)
        }
        return nil
    }

    func decodeFlexibleIntIfPresent(forKey key: Key) throws -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return Int(value) }
        if let raw = try? decodeIfPresent(String.self, forKey: key) {
            let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if s.isEmpty { return nil }
            return Int(s)
        }
        return nil
    }

    func decodeFlexibleBoolIfPresent(forKey key: Key) throws -> Bool? {
        if let value = try? decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value != 0 }
        if let raw = try? decodeIfPresent(String.self, forKey: key) {
            let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if s.isEmpty { return nil }
            if ["true", "1", "yes", "y"].contains(s) { return true }
            if ["false", "0", "no", "n"].contains(s) { return false }
        }
        return nil
    }

    func decodeStringArrayIfPresent(forKey key: Key) throws -> [String]? {
        if let values = try? decode([String].self, forKey: key) { return values }
        guard let raw = try? decode(String.self, forKey: key),
              let data = raw.data(using: .utf8) else { return nil }
        if let values = try? JSONDecoder().decode([String].self, from: data) { return values }
        if let objects = try? JSONDecoder().decode([[String: AnyDecodable]].self, from: data) {
            return objects.compactMap { item in
                item["name"]?.value as? String ?? item["title"]?.value as? String
            }
        }
        return nil
    }
}
