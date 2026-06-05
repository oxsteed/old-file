import Foundation

// MARK: - Models

struct ConsultantProfile: Decodable {
    let id: Int
    let first_name: String?
    let last_name: String?
    let email: String?
    let headline: String?
    let bio: String?
    let specialties: [String]
    let years_experience: Int?
    let active_referral_limit: Int?
    let accepts_new_referrals: Bool?
    let is_active: Bool?
}

struct ConsultantSummary: Decodable {
    let active_referrals: String?
    let completed_referrals: String?
    let won_referrals: String?
    let lost_referrals: String?
    let consultant_pipeline_cents: String?
    let oxsteed_generated_cents: String?

    var activeCount: Int { Int(active_referrals ?? "0") ?? 0 }
    var completedCount: Int { Int(completed_referrals ?? "0") ?? 0 }
    var wonCount: Int { Int(won_referrals ?? "0") ?? 0 }
    var lostCount: Int { Int(lost_referrals ?? "0") ?? 0 }
    var pipelineCents: Int { Int(consultant_pipeline_cents ?? "0") ?? 0 }
    var generatedCents: Int { Int(oxsteed_generated_cents ?? "0") ?? 0 }
}

struct ConsultingReferral: Decodable, Identifiable {
    let id: Int
    let first_name: String?
    let last_name: String?
    let email: String?
    let business_name: String?
    let skill_description: String?
    let target_market: String?
    let package_selected: String?
    let package_price: String?
    let urgency: String?
    let status: String?
    let consultant_assignment_status: String?
    let consultant_status_notes: String?
    let consultant_follow_up_at: String?
    let consultant_last_contacted_at: String?
    let estimated_total_price_cents: Int?
    let estimated_consultant_share_cents: Int?
    let updated_at: String?

    var displayName: String {
        let parts = [first_name, last_name].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? (business_name ?? "Unnamed client") : parts.joined(separator: " ")
    }

    var assignmentStatus: String { consultant_assignment_status ?? "assigned" }
}

struct ReferralActivityItem: Decodable, Identifiable {
    let id: Int
    let request_id: Int?
    let event_type: String?
    let note_text: String?
    let created_at: String?
}

struct ConsultantDashboardResponse: Decodable {
    let profile: ConsultantProfile
    let summary: ConsultantSummary
    let referrals: [ConsultingReferral]
    let activity: [ReferralActivityItem]
    let referralStatuses: [String]?
}

// MARK: - Update payload

struct ReferralUpdatePayload: Encodable {
    let consultant_assignment_status: String
    let consultant_status_notes: String?
    let consultant_follow_up_at: String?
    let mark_contacted: Bool?
}

// MARK: - Service

enum ConsultingService {
    /// Contractor dashboard — referrals, summary, profile, activity
    static func contractorDashboard() async throws -> ConsultantDashboardResponse {
        return try await APIClient.shared.request("/api/consulting/contractor/dashboard")
    }

    /// Update a single referral's status / notes / follow-up date
    static func updateReferral(
        id: Int,
        status: String,
        notes: String? = nil,
        followUpAt: String? = nil,
        markContacted: Bool? = nil
    ) async throws -> ConsultingReferral {
        struct Envelope: Decodable { let referral: ConsultingReferral }
        let body = ReferralUpdatePayload(
            consultant_assignment_status: status,
            consultant_status_notes: notes,
            consultant_follow_up_at: followUpAt,
            mark_contacted: markContacted
        )
        let env: Envelope = try await APIClient.shared.request(
            "/api/consulting/contractor/referrals/\(id)",
            method: .PATCH,
            body: body
        )
        return env.referral
    }
}

// MARK: - Store

@MainActor
final class ConsultingStore: ObservableObject {
    static let shared = ConsultingStore()

    @Published private(set) var profile: ConsultantProfile? = nil
    @Published private(set) var summary: ConsultantSummary? = nil
    @Published private(set) var referrals: [ConsultingReferral] = []
    @Published private(set) var activity: [ReferralActivityItem] = []
    @Published private(set) var validStatuses: [String] = []
    @Published private(set) var isLoading = false
    @Published private(set) var error: String? = nil

    private var lastFetchedAt: Date? = nil
    private let cacheTTL: TimeInterval = 3 * 60

    private init() {}

    func load(force: Bool = false) async {
        if !force, let last = lastFetchedAt, Date().timeIntervalSince(last) < cacheTTL { return }
        isLoading = true
        error = nil
        do {
            let dash = try await ConsultingService.contractorDashboard()
            profile = dash.profile
            summary = dash.summary
            referrals = dash.referrals
            activity = dash.activity
            validStatuses = dash.referralStatuses ?? []
            lastFetchedAt = Date()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func updateReferral(id: Int, status: String, notes: String? = nil, followUpAt: String? = nil) async {
        do {
            let updated = try await ConsultingService.updateReferral(
                id: id, status: status, notes: notes, followUpAt: followUpAt, markContacted: true
            )
            referrals = referrals.map { $0.id == updated.id ? updated : $0 }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func invalidate() { lastFetchedAt = nil }
}
