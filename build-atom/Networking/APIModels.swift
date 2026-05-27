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
    let id_verified: Bool?
    let background_check_passed: Bool?
    let display_name_preference: String?
    let default_mode: String?
    let avatar_url: String?
    let created_at: String?
    let updated_at: String?

    var displayName: String {
        switch (first_name, last_name) {
        case (let f?, let l?) where !f.isEmpty && !l.isEmpty: return "\(f) \(l)"
        case (let f?, _) where !f.isEmpty: return f
        default: return email
        }
    }

    /// Map server role into local Persona enum.
    var preferredPersona: Persona {
        switch (default_mode ?? role)?.lowercased() {
        case "helper": return .helper
        case "business_owner", "business": return .business
        case "consultant": return .consultant
        case "tool_owner": return .toolOwner
        case "franchise_applicant", "franchise", "franchise_owner": return .franchise
        case "investor": return .investor
        default: return .customer
        }
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

struct APIJob: Codable, Identifiable, Equatable {
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
    let required_skills: [String]?
    let media_urls: [String]?
    let created_at: String?
    let updated_at: String?
    let distance_miles: Double?

    var budgetDisplay: String {
        guard let min = budget_min, let max = budget_max else {
            if let min = budget_min { return "$\(min / 100)+" }
            return "—"
        }
        return "$\(min / 100) – $\(max / 100)"
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

    var statusDisplay: String {
        guard let s = status else { return "Open" }
        return s.replacingOccurrences(of: "_", with: " ").capitalized
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
    let budget_type: String       // "range" | "fixed" | "hourly"
    let budget_min: Int?
    let budget_max: Int?
    let urgency: String           // low|medium|high
    let location_city: String
    let location_state: String?
    let location_country: String
    let location_zip: String?
    let scheduled_date: String?
    let scheduled_time: String?
    let required_skills: [String]?
}

// MARK: - Bids

struct APIBid: Codable, Identifiable, Equatable {
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
    let businessName: String?
    let ownerName: String?
    let avatar: String?
    let rating: Double?
    let reviewCount: Int?
    let jobsCompleted: Int?
    let verified: Bool?
    let backgroundChecked: Bool?
    let categories: [String]?
    let skills: [String]?
    let topServices: [String]?
    let startingPrice: Int?
    let responseTime: String?
    let city: String?
    let state: String?
    let serviceRadius: Int?
    let availableToday: Bool?
    let shortBio: String?

    var displayName: String { ownerName ?? businessName ?? "Helper" }
    var startingPriceDisplay: String {
        guard let p = startingPrice else { return "—" }
        return "$\(p / 100)+"
    }
}

// MARK: - Messages

struct APIConversation: Codable, Identifiable, Equatable {
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
    let unread_count: Int?
    let last_message_at: String?
    let created_at: String?
    let archived_at: String?
}

struct APIMessage: Codable, Identifiable, Equatable {
    let id: String
    let conversation_id: String?
    let sender_id: String?
    let sender_name: String?
    let content: String
    let attachments: [APIAttachment]?
    let is_read: Bool?
    let created_at: String?
}

struct APIAttachment: Codable, Equatable {
    let url: String
    let type: String?
    let filename: String?
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
}

// MARK: - Bookings

struct APIBooking: Codable, Identifiable, Equatable {
    let id: String
    let status: String?
    let customer_id: String?
    let helper_id: String?
    let service_name: String?
    let requested_date: String?
    let requested_start_time: String?
    let requested_end_time: String?
    let expires_at: String?
    let created_at: String?
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

struct APINotification: Codable, Identifiable, Equatable {
    let id: String
    let type: String?
    let title: String?
    let message: String?
    let is_read: Bool?
    let created_at: String?
}

struct NotificationPreferences: Codable {
    var email_enabled: Bool?
    var push_enabled: Bool?
    var sms_enabled: Bool?
    var frequency: String?
    var do_not_disturb_start: String?
    var do_not_disturb_end: String?
}

// MARK: - Payments

struct APIPaymentIntent: Decodable {
    let client_secret: String?
    let payment_intent_id: String?
    let amount: Int?
    let currency: String?
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

struct StripeConnectStatus: Decodable {
    let connect_account_id: String?
    let charges_enabled: Bool?
    let payouts_enabled: Bool?
    let verification_status: String?
}

// MARK: - Misc

struct OkResponse: Decodable { let ok: Bool? }

struct UploadResponse: Decodable {
    let url: String
    let key: String?
    let content_type: String?
    let size_bytes: Int?
}
