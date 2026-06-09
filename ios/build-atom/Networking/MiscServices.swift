import Foundation

// MARK: - Notifications

enum NotificationsService {
    struct ListResponse: Decodable {
        let notifications: [APINotification]
        let unread_count: Int?
        let page: Int?
        let limit: Int?
    }

    static func list(limit: Int = 50, offset: Int = 0, unreadOnly: Bool = false) async throws -> ListResponse {
        // Production backend uses page/limit (1-indexed), not offset/limit.
        let page = max(1, (offset / max(1, limit)) + 1)
        var q: [String: Any] = ["limit": limit, "page": page]
        if unreadOnly { q["unread_only"] = "true" }
        return try await APIClient.shared.request("/api/notifications", query: q)
    }
    static func markRead(_ id: String) async throws {
        struct Req: Encodable { let ids: [Int64] }
        guard let nid = Int64(id) else {
            throw APIError.validation(message: "Invalid notification id", fields: ["id": "Invalid notification id"])
        }
        try await APIClient.shared.requestVoid("/api/notifications/mark-read", method: .POST, body: Req(ids: [nid]))
    }
    static func preferences() async throws -> NotificationPreferences {
        struct Resp: Decodable {
            struct Data: Decodable {
                let frequency: String?
                let emailNotifications: Bool?
                let smsNotifications: Bool?
                let pushNotifications: Bool?
            }
            let success: Bool?
            let data: Data
        }
        let r: Resp = try await APIClient.shared.request("/api/notifications/email")
        var p = NotificationPreferences()
        p.frequency = uiFrequency(fromBackend: r.data.frequency)
        p.email_enabled = r.data.emailNotifications
        p.sms_enabled = r.data.smsNotifications
        p.push_enabled = r.data.pushNotifications
        return p
    }
    static func updatePreferences(_ p: NotificationPreferences) async throws -> NotificationPreferences {
        struct Req: Encodable {
            let frequency: String?
            let emailNotifications: Bool?
            let marketingEmails: Bool?
            let smsNotifications: Bool?
            let pushNotifications: Bool?
        }
        struct Resp: Decodable {
            struct Data: Decodable {
                let frequency: String?
                let emailNotifications: Bool?
                let smsNotifications: Bool?
                let pushNotifications: Bool?
            }
            let success: Bool?
            let data: Data
        }

        let req = Req(frequency: backendFrequency(fromUI: p.frequency),
                      emailNotifications: p.email_enabled,
                      // Keep marketing aligned with the master email toggle for now.
                      // (The app UI doesn't expose a separate marketing toggle yet.)
                      marketingEmails: p.email_enabled,
                      smsNotifications: p.sms_enabled,
                      pushNotifications: p.push_enabled)
        let r: Resp = try await APIClient.shared.request("/api/notifications/email", method: .PUT, body: req)

        var out = NotificationPreferences()
        out.frequency = uiFrequency(fromBackend: r.data.frequency)
        out.email_enabled = r.data.emailNotifications
        out.sms_enabled = r.data.smsNotifications
        out.push_enabled = r.data.pushNotifications
        return out
    }

    private static func backendFrequency(fromUI value: String?) -> String? {
        switch value {
        case "real_time": return "real-time"
        default: return value
        }
    }

    private static func uiFrequency(fromBackend value: String?) -> String? {
        switch value {
        case "real-time": return "real_time"
        default: return value
        }
    }
    static func registerPushToken(_ token: String, deviceId: String) async throws {
        struct Req: Encodable {
            let token: String
            let provider: String
            let platform: String
            let device_id: String
            let app_version: String
        }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        try await APIClient.shared.requestVoid(
            "/api/mobile/push-token",
            method: .POST,
            body: Req(token: token, provider: "apns", platform: "ios", device_id: deviceId, app_version: version)
        )
    }
}

// MARK: - Settings

enum SettingsService {
    struct PrivacyCategory: Decodable, Identifiable, Equatable {
        let category: String
        let examples: String
        let purpose: String

        var id: String { category }
    }

    struct ThirdPartyDisclosure: Decodable, Identifiable, Equatable {
        let name: String
        let purpose: String
        let dataShared: String

        var id: String { name }
    }

    struct PrivacyDisclosures: Decodable, Equatable {
        let categories: [PrivacyCategory]
        let thirdParties: [ThirdPartyDisclosure]
    }

    struct PrivacySettingsPatch: Encodable {
        let allow_guest_contact: Bool?
        let allow_booking: Bool?
        let allow_scheduling: Bool?
        let allow_live_chat: Bool?
    }

    struct PrivacySettingsResponse: Decodable, Equatable {
        let allow_guest_contact: Bool?
        let allow_booking: Bool?
        let allow_scheduling: Bool?
        let allow_live_chat: Bool?
    }

    struct SupportTicketResponse: Decodable, Equatable {
        let ticket_id: String?
        let ticket_number: String?
        let message: String?
    }

    static func privacyDisclosures() async throws -> PrivacyDisclosures {
        try await APIClient.shared.request("/api/privacy/data-categories", requiresAuth: false)
    }

    static func updatePrivacySettings(_ patch: PrivacySettingsPatch) async throws -> PrivacySettingsResponse {
        try await APIClient.shared.request("/api/settings/privacy", method: .PATCH, body: patch)
    }

    static func exportAccountData() async throws -> Data {
        try await APIClient.shared.rawData("/api/privacy/export")
    }

    static func submitAppReport(details: String, contactEmail: String?) async throws -> SupportTicketResponse {
        struct Req: Encodable {
            let details: String
            let contact_email: String?
            let app_version: String
            let build_number: String
            let git_sha: String?
            let platform: String
        }

        let info = Bundle.main.infoDictionary
        let req = Req(
            details: details,
            contact_email: contactEmail,
            app_version: info?["CFBundleShortVersionString"] as? String ?? "unknown",
            build_number: info?["CFBundleVersion"] as? String ?? "unknown",
            git_sha: info?["OX_GIT_SHA"] as? String,
            platform: "ios"
        )
        return try await APIClient.shared.request("/api/settings/app-report", method: .POST, body: req)
    }
}

// MARK: - Learn

enum LearnService {
    struct GuidesResponse: Decodable, Equatable {
        let guides: [LearnGuide]
    }

    static func guides() async throws -> GuidesResponse {
        try await APIClient.shared.request("/api/learn/guides", requiresAuth: false)
    }

    static func stats() async throws -> APILearnStatsResponse {
        try await APIClient.shared.request("/api/learn/stats", requiresAuth: false)
    }

    static func recordView(guideId: String) async {
        struct Req: Encodable { let guide_id: String }
        // Backend always returns 200 and ignores unknown guide_ids; treat as fire-and-forget.
        try? await APIClient.shared.requestVoid("/api/learn/views", method: .POST, body: Req(guide_id: guideId), requiresAuth: false)
    }

    static func completions() async throws -> APILearnCompletionsResponse {
        try await APIClient.shared.request("/api/learn/completions")
    }

    static func recordCompletion(guideId: String, difficulty: String) async throws -> APILearnRecordCompletionResponse {
        struct Req: Encodable { let guide_id: String; let difficulty: String }
        return try await APIClient.shared.request("/api/learn/completions", method: .POST, body: Req(guide_id: guideId, difficulty: difficulty))
    }

    static func badges() async throws -> APILearnBadgesResponse {
        try await APIClient.shared.request("/api/learn/badges")
    }

    static func mySubmissions() async throws -> APILearnSubmissionsResponse {
        try await APIClient.shared.request("/api/learn/submissions/mine")
    }

    // MARK: Admin-managed product link overrides

    struct ProductLinksResponse: Decodable {
        let products: [LearnProductLink]
    }

    /// Fetches admin-managed product link overrides.
    /// These override the hardcoded `LearnGuideCatalog` buy/rent URLs without requiring
    /// an app update. When OxSteed has its own inventory, admin sets `link_type = "own_inventory"`.
    /// - Returns: nil silently when the endpoint isn't yet deployed (graceful degradation).
    static func productLinks() async -> ProductLinksResponse? {
        try? await APIClient.shared.request("/api/learn/product-links", requiresAuth: false)
    }
}

// MARK: - Life

enum LifeService {
    static func pulse(window: String = "1m") async throws -> APILifePulse {
        try await APIClient.shared.request("/api/life/pulse", query: ["window": window])
    }

    static func pulseInsight() async throws -> PulseSummaryResult {
        try await APIClient.shared.request("/api/life/pulse/insight")
    }

    static func summary() async throws -> APILifeDashboardSummary {
        try await APIClient.shared.request("/api/life/summary")
    }

    static func expenses(limit: Int = 50, offset: Int = 0, month: Int? = nil, year: Int? = nil, type: String? = nil) async throws -> APILifeExpensesResponse {
        var q: [String: Any] = ["limit": limit, "offset": offset]
        if let month { q["month"] = month }
        if let year { q["year"] = year }
        if let type { q["type"] = type }
        return try await APIClient.shared.request("/api/life/expenses", query: q)
    }

    static func createExpense(type: String,
                              amount: Double,
                              category: String,
                              description: String?,
                              occurredAt: String,
                              frequency: String = "one_time",
                              isRecurring: Bool = false) async throws -> APILifeExpense {
        struct Req: Encodable {
            let type: String
            let amount: Double
            let category: String
            let description: String?
            let occurred_at: String
            let frequency: String
            let is_recurring: Bool
        }
        return try await APIClient.shared.request(
            "/api/life/expenses",
            method: .POST,
            body: Req(
                type: type,
                amount: amount,
                category: category,
                description: description,
                occurred_at: occurredAt,
                frequency: frequency,
                is_recurring: isRecurring
            )
        )
    }

    static func budgets(month: Int? = nil, year: Int? = nil) async throws -> APILifeBudgetsResponse {
        var q: [String: Any] = [:]
        if let month { q["month"] = month }
        if let year { q["year"] = year }
        return try await APIClient.shared.request("/api/life/budgets", query: q)
    }

    static func goals(completed: Bool? = nil) async throws -> APILifeGoalsResponse {
        var q: [String: Any] = [:]
        if let completed { q["completed"] = completed ? "true" : "false" }
        return try await APIClient.shared.request("/api/life/goals", query: q)
    }

    static func createGoal(title: String,
                           goalType: String = "life",
                           targetValue: Double? = nil,
                           currentValue: Double? = nil,
                           dueDate: String? = nil,
                           icon: String? = nil) async throws -> APILifeGoal {
        struct Req: Encodable {
            let title: String
            let goal_type: String
            let target_value: Double?
            let current_value: Double?
            let due_date: String?
            let icon: String?
        }
        return try await APIClient.shared.request(
            "/api/life/goals",
            method: .POST,
            body: Req(
                title: title,
                goal_type: goalType,
                target_value: targetValue,
                current_value: currentValue,
                due_date: dueDate,
                icon: icon
            )
        )
    }

    static func updateGoalCompleted(id: String, isCompleted: Bool) async throws -> APILifeGoal {
        struct Req: Encodable { let is_completed: Bool }
        return try await APIClient.shared.request(
            "/api/life/goals/\(id)",
            method: .PUT,
            body: Req(is_completed: isCompleted)
        )
    }

    static func deleteGoal(id: String) async throws {
        try await APIClient.shared.requestVoid("/api/life/goals/\(id)", method: .DELETE)
    }

    static func checklist() async throws -> APILifeChecklistResponse {
        try await APIClient.shared.request("/api/life/checklist")
    }

    static func updateChecklistItem(id: String, isCompleted: Bool) async throws -> APILifeChecklistItem {
        struct Req: Encodable { let is_completed: Bool }
        return try await APIClient.shared.request("/api/life/checklist/\(id)", method: .PUT, body: Req(is_completed: isCompleted))
    }

    static func homeTasks(section: String = "home", completed: Bool? = false) async throws -> APILifeHomeTasksResponse {
        var q: [String: Any] = ["section": section]
        if let completed { q["completed"] = completed ? "true" : "false" }
        return try await APIClient.shared.request("/api/life/home-tasks", query: q)
    }

    static func createHomeTask(title: String,
                               description: String? = nil,
                               dueDate: String? = nil,
                               urgency: String = "medium",
                               section: String = "home",
                               isRecurring: Bool = false,
                               frequency: String? = nil) async throws -> APILifeHomeTask {
        struct Req: Encodable {
            let title: String
            let description: String?
            let due_date: String?
            let urgency: String
            let section: String
            let is_recurring: Bool
            let frequency: String?
        }
        return try await APIClient.shared.request(
            "/api/life/home-tasks",
            method: .POST,
            body: Req(
                title: title,
                description: description,
                due_date: dueDate,
                urgency: urgency,
                section: section,
                is_recurring: isRecurring,
                frequency: frequency
            )
        )
    }

    static func updateHomeTaskCompleted(id: String, isCompleted: Bool) async throws -> APILifeHomeTask {
        struct Req: Encodable { let is_completed: Bool }
        return try await APIClient.shared.request("/api/life/home-tasks/\(id)", method: .PUT, body: Req(is_completed: isCompleted))
    }

    static func deleteHomeTask(id: String) async throws {
        try await APIClient.shared.requestVoid("/api/life/home-tasks/\(id)", method: .DELETE)
    }

    static func savedHelpers() async throws -> APILifeSavedHelpersResponse {
        try await APIClient.shared.request("/api/life/saved-helpers")
    }

    static func saveHelper(helperId: String, note: String? = nil) async throws -> APILifeSavedHelper {
        struct Req: Encodable {
            let helper_id: String
            let note: String?
        }
        return try await APIClient.shared.request(
            "/api/life/saved-helpers",
            method: .POST,
            body: Req(helper_id: helperId, note: note)
        )
    }

    static func removeSavedHelper(id: String) async throws {
        try await APIClient.shared.requestVoid("/api/life/saved-helpers/\(id)", method: .DELETE)
    }

    static func sinkingFunds() async throws -> APILifeSinkingFundsResponse {
        try await APIClient.shared.request("/api/life/sinking-funds")
    }

    static func createSinkingFund(clientId: String,
                                  name: String,
                                  targetAmount: Double,
                                  savedAmount: Double,
                                  targetDate: String,
                                  paycheckInterval: String,
                                  icon: String = "banknote.fill",
                                  color: String = "pillarSinking") async throws -> APILifeSinkingFund {
        struct Req: Encodable {
            let client_id: String
            let name: String
            let target_amount: Double
            let saved_amount: Double
            let target_date: String
            let paycheck_interval: String
            let icon: String
            let color: String
        }
        return try await APIClient.shared.request(
            "/api/life/sinking-funds",
            method: .POST,
            body: Req(
                client_id: clientId,
                name: name,
                target_amount: targetAmount,
                saved_amount: savedAmount,
                target_date: targetDate,
                paycheck_interval: paycheckInterval,
                icon: icon,
                color: color
            )
        )
    }

    static func updateSinkingFundSavedAmount(id: String, savedAmount: Double) async throws -> APILifeSinkingFund {
        struct Req: Encodable { let saved_amount: Double }
        return try await APIClient.shared.request(
            "/api/life/sinking-funds/\(id)",
            method: .PUT,
            body: Req(saved_amount: savedAmount)
        )
    }

    static func deleteSinkingFund(id: String) async throws {
        try await APIClient.shared.requestVoid("/api/life/sinking-funds/\(id)", method: .DELETE)
    }

    static func vehicles() async throws -> APILifeVehiclesResponse {
        try await APIClient.shared.request("/api/life/vehicles")
    }

    static func createVehicle(clientId: String,
                              vin: String,
                              year: String,
                              make: String,
                              model: String,
                              mileage: Int,
                              lastOilChangeMile: Int,
                              lastServiceDate: String,
                              notes: String = "") async throws -> APILifeVehicle {
        struct Req: Encodable {
            let client_id: String
            let vin: String
            let year: String
            let make: String
            let model: String
            let mileage: Int
            let last_oil_change_mile: Int
            let last_service_date: String
            let notes: String
        }
        return try await APIClient.shared.request(
            "/api/life/vehicles",
            method: .POST,
            body: Req(
                client_id: clientId,
                vin: vin,
                year: year,
                make: make,
                model: model,
                mileage: mileage,
                last_oil_change_mile: lastOilChangeMile,
                last_service_date: lastServiceDate == "—" ? "" : lastServiceDate,
                notes: notes
            )
        )
    }

    static func updateVehicleMileage(id: String,
                                     mileage: Int,
                                     lastOilChangeMile: Int? = nil,
                                     lastServiceDate: String? = nil) async throws -> APILifeVehicle {
        struct Req: Encodable {
            let mileage: Int
            let last_oil_change_mile: Int?
            let last_service_date: String?
        }
        return try await APIClient.shared.request(
            "/api/life/vehicles/\(id)",
            method: .PUT,
            body: Req(mileage: mileage, last_oil_change_mile: lastOilChangeMile, last_service_date: lastServiceDate)
        )
    }

    static func deleteVehicle(id: String) async throws {
        try await APIClient.shared.requestVoid("/api/life/vehicles/\(id)", method: .DELETE)
    }

    static func habits() async throws -> APILifeHabitsResponse {
        try await APIClient.shared.request("/api/life/habits")
    }

    static func createHabit(clientId: String,
                            name: String,
                            icon: String,
                            streak: Int,
                            completedToday: Bool,
                            targetDaysPerWeek: Int) async throws -> APILifeHabit {
        struct Req: Encodable {
            let client_id: String
            let name: String
            let icon: String
            let streak: Int
            let completed_today: Bool
            let target_days_per_week: Int
        }
        return try await APIClient.shared.request(
            "/api/life/habits",
            method: .POST,
            body: Req(
                client_id: clientId,
                name: name,
                icon: icon,
                streak: streak,
                completed_today: completedToday,
                target_days_per_week: targetDaysPerWeek
            )
        )
    }

    static func updateHabit(id: String,
                            completedToday: Bool,
                            streak: Int) async throws -> APILifeHabit {
        struct Req: Encodable {
            let completed_today: Bool
            let streak: Int
        }
        return try await APIClient.shared.request(
            "/api/life/habits/\(id)",
            method: .PUT,
            body: Req(completed_today: completedToday, streak: streak)
        )
    }

    static func deleteHabit(id: String) async throws {
        try await APIClient.shared.requestVoid("/api/life/habits/\(id)", method: .DELETE)
    }
}

// MARK: - Discover

enum DiscoverService {
    static func search(_ query: String,
                       lat: Double? = nil,
                       lng: Double? = nil,
                       radiusMiles: Int? = nil,
                       limit: Int = 20,
                       offset: Int = 0) async throws -> APIDiscoverSearchResponse {
        var q: [String: Any] = [
            "q": query,
            "limit": limit,
            "offset": offset,
        ]
        if let lat { q["lat"] = lat }
        if let lng { q["lng"] = lng }
        if let radiusMiles { q["radius"] = radiusMiles }
        return try await AuthAPIClient.shared.request("/api/discover", query: q, requiresAuth: false)
    }

    static func popular(lat: Double? = nil, lng: Double? = nil, radiusMiles: Int? = nil) async throws -> APIDiscoverPopularResponse {
        var q: [String: Any] = [:]
        if let lat { q["lat"] = lat }
        if let lng { q["lng"] = lng }
        if let radiusMiles { q["radius"] = radiusMiles }
        // `discover` endpoints live on the website backend (`https://oxsteed.com`), not `api.oxsteed.com`.
        return try await AuthAPIClient.shared.request("/api/discover/popular", query: q, requiresAuth: false)
    }
}

// MARK: - Growth

enum GrowthService {
    static func programs(persona: String? = nil) async throws -> [APIGrowthProgram] {
        var q: [String: Any] = [:]
        if let persona { q["persona"] = persona }
        // `growth` endpoints live on the website backend (`https://oxsteed.com`), not `api.oxsteed.com`.
        let resp: APIGrowthProgramsResponse = try await AuthAPIClient.shared.request("/api/growth/programs", query: q, requiresAuth: false)
        return resp.programs
    }

    static func wholesale(limit: Int = 20) async throws -> [APIWholesaleListing] {
        let q: [String: Any] = ["limit": limit]
        let resp: APIWholesaleResponse = try await AuthAPIClient.shared.request("/api/growth/wholesale", query: q, requiresAuth: false)
        return resp.listings
    }

    static func joinWholesale(listingId: Int) async throws {
        struct Res: Decodable { let listing: [String: AnyDecodable]? }
        _ = try await AuthAPIClient.shared.request("/api/growth/wholesale/\(listingId)/join", method: .POST) as Res
    }

    static func submitFinancingPreQual(_ request: APIGrowthFinancingPreQualRequest) async throws -> APIGrowthFinancingApplication? {
        let response: APIGrowthFinancingPreQualResponse = try await AuthAPIClient.shared.request(
            "/api/growth/financing/pre-qual",
            method: .POST,
            body: request
        )
        return response.application
    }
}

// MARK: - Payments

enum PaymentsService {
    static func createIntent(jobId: String, amount: Int, currency: String = "USD") async throws -> APIPaymentIntent {
        struct Req: Encodable { let job_id: String; let amount: Int; let currency: String }
        return try await APIClient.shared.request("/api/payments/intent", method: .POST,
                                                  body: Req(job_id: jobId, amount: amount, currency: currency))
    }
    static func capture(jobId: String, paymentIntentId: String) async throws {
        struct Req: Encodable { let job_id: String; let payment_intent_id: String }
        try await APIClient.shared.requestVoid("/api/payments/capture", method: .POST,
                                               body: Req(job_id: jobId, payment_intent_id: paymentIntentId))
    }
    static func myPayments(limit: Int = 25, offset: Int = 0) async throws -> PaymentsList {
        try await myPayments(limit: limit, offset: offset, status: nil)
    }

    static func myPayments(limit: Int = 25, offset: Int = 0, status: String?, role: String? = nil) async throws -> PaymentsList {
        var q: [String: Any] = ["limit": limit, "offset": offset]
        if let status { q["status"] = status }
        if let role { q["role"] = role }
        return try await APIClient.shared.request("/api/payments/me", query: q)
    }
    static func connectStatus() async throws -> StripeConnectStatus {
        try await APIClient.shared.request("/api/payments/connect/status")
    }
    static func startConnect(country: String = "US", type: String = "individual") async throws -> [String: AnyDecodable] {
        struct Req: Encodable { let country: String; let type: String }
        return try await APIClient.shared.request("/api/payments/connect", method: .POST, body: Req(country: country, type: type))
    }

    static func jobPaymentDetails(_ jobId: String) async throws -> PaymentJobDetails {
        try await APIClient.shared.request("/api/payments/job/\(jobId)")
    }
}

// MARK: - Tool Rentals

enum ToolRentalsService {
    struct ToolRentalSaveRequest: Encodable {
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
        let owner_rules: String?
        let replacement_value: Double?
        let owner_attestation_accepted: Bool?
    }

    static func browse(limit: Int = 50, offset: Int = 0) async throws -> [APIToolRental] {
        struct Response: Decodable { let tools: [APIToolRental] }
        let response: Response = try await APIClient.shared.request(
            "/api/tool-rentals/browse",
            query: ["limit": limit, "offset": offset],
            requiresAuth: false
        )
        return response.tools
    }

    static func myTools() async throws -> [APIToolRental] {
        struct Response: Decodable { let tools: [APIToolRental] }
        let r: Response = try await APIClient.shared.request("/api/tool-rentals/me")
        return r.tools
    }

    static func create(_ req: ToolRentalSaveRequest) async throws -> APIToolRental {
        struct Response: Decodable { let tool: APIToolRental }
        let response: Response = try await APIClient.shared.request("/api/tool-rentals", method: .POST, body: req)
        return response.tool
    }

    static func update(id: String, _ req: ToolRentalSaveRequest) async throws -> APIToolRental {
        struct Response: Decodable { let tool: APIToolRental }
        let response: Response = try await APIClient.shared.request("/api/tool-rentals/\(id)", method: .PUT, body: req)
        return response.tool
    }

    static func delete(id: String) async throws {
        try await APIClient.shared.requestVoid("/api/tool-rentals/\(id)", method: .DELETE)
    }
}

// MARK: - Business workspace

enum BusinessWorkspaceService {
    static func myBusinesses() async throws -> WorkspaceBusinessesResponse {
        struct Response: Decodable { let data: WorkspaceBusinessesResponse }
        let response: Response = try await APIClient.shared.request("/api/me/businesses")
        return response.data
    }

    static func setWorkspaceContext(businessId: Int) async throws {
        struct Req: Encodable { let business_id: Int }
        try await APIClient.shared.requestVoid("/api/me/workspace-context", method: .POST, body: Req(business_id: businessId))
    }

    static func analytics(_ businessId: Int, period: String = "6m") async throws -> BusinessAnalyticsSummary {
        try await APIClient.shared.request("/api/businesses/\(businessId)/analytics", query: ["period": period])
    }

    static func products(_ businessId: Int, page: Int = 0, limit: Int = 20) async throws -> [BusinessProductSummary] {
        struct Response: Decodable {
            let data: [BusinessProductSummary]
        }
        let response: Response = try await APIClient.shared.request("/api/businesses/\(businessId)/products", query: ["page": page, "limit": limit])
        return response.data
    }

    static func leads(_ businessId: Int, limit: Int = 10) async throws -> [BusinessLeadSummary] {
        struct Response: Decodable {
            let leads: [BusinessLeadSummary]
        }
        do {
            let response: Response = try await APIClient.shared.request("/api/businesses/\(businessId)/leads", query: ["limit": limit])
            return response.leads
        } catch {
            // Backward compatibility with older backend deployments.
            let response: Response = try await APIClient.shared.request("/api/businesses/\(businessId)/lead-pipeline", query: ["limit": limit])
            return response.leads
        }
    }

    static func createLead(businessId: Int,
                           name: String,
                           email: String? = nil,
                           phone: String? = nil,
                           serviceInterest: String? = nil,
                           budgetCents: Int? = nil,
                           notes: String? = nil,
                           source: String = "manual") async throws -> BusinessLeadSummary {
        struct Req: Encodable {
            let name: String
            let email: String?
            let phone: String?
            let service_interest: String?
            let budget_cents: Int?
            let notes: String?
            let source: String
        }
        return try await APIClient.shared.request(
            "/api/businesses/\(businessId)/leads",
            method: .POST,
            body: Req(name: name, email: email, phone: phone, service_interest: serviceInterest, budget_cents: budgetCents, notes: notes, source: source)
        )
    }

    static func updateLead(businessId: Int,
                           leadId: String,
                           name: String?,
                           email: String?,
                           phone: String?,
                           serviceInterest: String?,
                           budgetCents: Int?,
                           notes: String?,
                           status: String?) async throws -> BusinessLeadSummary {
        struct Req: Encodable {
            let name: String?
            let email: String?
            let phone: String?
            let service_interest: String?
            let budget_cents: Int?
            let notes: String?
            let status: String?
        }
        return try await APIClient.shared.request(
            "/api/businesses/\(businessId)/leads/\(leadId)",
            method: .PUT,
            body: Req(
                name: name,
                email: email,
                phone: phone,
                service_interest: serviceInterest,
                budget_cents: budgetCents,
                notes: notes,
                status: status
            )
        )
    }

    static func createProduct(businessId: Int,
                              name: String,
                              description: String? = nil,
                              category: String,
                              price: Double,
                              cost: Double? = nil,
                              sku: String,
                              isActive: Bool = true) async throws {
        struct Req: Encodable {
            let name: String
            let description: String?
            let category: String
            let price: Double
            let cost: Double?
            let sku: String
            let isActive: Bool
        }
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/products",
            method: .POST,
            body: Req(
                name: name,
                description: description,
                category: category,
                price: price,
                cost: cost,
                sku: sku,
                isActive: isActive
            )
        )
    }

    static func updateProduct(businessId: Int,
                              productId: String,
                              name: String? = nil,
                              description: String? = nil,
                              category: String? = nil,
                              price: Double? = nil,
                              cost: Double? = nil,
                              isActive: Bool? = nil) async throws {
        struct Req: Encodable {
            let name: String?
            let description: String?
            let category: String?
            let price: Double?
            let cost: Double?
            let isActive: Bool?
        }
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/products/\(productId)",
            method: .PUT,
            body: Req(
                name: name,
                description: description,
                category: category,
                price: price,
                cost: cost,
                isActive: isActive
            )
        )
    }

    static func healthAlerts(_ businessId: Int) async throws -> [BusinessHealthAlert] {
        struct Response: Decodable {
            let alerts: [BusinessHealthAlert]

            private enum CodingKeys: String, CodingKey {
                case alerts
            }

            init(from decoder: Decoder) throws {
                let container = try? decoder.singleValueContainer()
                if let alerts = try? container?.decode([BusinessHealthAlert].self) {
                    self.alerts = alerts
                    return
                }

                let keyed = try decoder.container(keyedBy: CodingKeys.self)
                alerts = try keyed.decode([BusinessHealthAlert].self, forKey: .alerts)
            }
        }
        let response: Response = try await APIClient.shared.request("/api/businesses/\(businessId)/health-alerts")
        return response.alerts
    }

    static func calendarSummary(_ businessId: Int) async throws -> BusinessCalendarSummary {
        try await APIClient.shared.request("/api/businesses/\(businessId)/calendar/summary")
    }
}

// MARK: - Chat (support / profile)

enum ChatService {
    /// Sends a message to the AI support chat.
    /// IMPORTANT: callers must check `AIChatConsent.isGranted` before calling this
    /// and show `AIChatConsentView` if consent has not been granted yet.
    /// Use the `.aiChatConsentGated` view modifier to handle this automatically.
    static func sendSupport(_ content: String, pageContext: String? = nil) async throws -> [String: AnyDecodable] {
        guard AIChatConsent.isGranted else {
            // Fail loudly in debug so developers don't bypass consent accidentally.
            assertionFailure("ChatService.sendSupport called without AI consent. Show AIChatConsentView first.")
            throw APIError.server(code: 403, message: "AI chat consent required.")
        }
        struct Req: Encodable { let content: String; let page_context: String? }
        return try await APIClient.shared.request("/api/chat/message", method: .POST,
                                                  body: Req(content: content, page_context: pageContext),
                                                  requiresAuth: false)
    }
    static func sendToProfile(helperId: String?, businessId: String?, message: String, guestEmail: String? = nil) async throws -> [String: AnyDecodable] {
        struct Req: Encodable { let helper_id: String?; let business_id: String?; let message: String; let guest_email: String? }
        return try await APIClient.shared.request("/api/chat/profile-message", method: .POST,
                                                  body: Req(helper_id: helperId, business_id: businessId, message: message, guest_email: guestEmail),
                                                  requiresAuth: false)
    }

    static func createGuestSession(helperId: String,
                                   guestName: String,
                                   guestEmail: String,
                                   message: String,
                                   messageType: String = "inquiry") async throws -> GuestChatSessionResponse {
        struct Req: Encodable {
            let helper_id: String
            let guest_name: String
            let guest_email: String
            let message: String
            let message_type: String
        }
        return try await APIClient.shared.request(
            "/api/chat/sessions/guest",
            method: .POST,
            body: Req(helper_id: helperId,
                      guest_name: guestName,
                      guest_email: guestEmail,
                      message: message,
                      message_type: messageType),
            requiresAuth: false
        )
    }

    static func profileContext(type: String, id: String) async throws -> ChatProfileContext {
        try await APIClient.shared.request("/api/chat/profile-context/\(type)/\(id)")
    }

    static func transcribeAudio(_ data: Data, filename: String, mimeType: String) async throws -> TranscriptionResponse {
        try await UploadService.uploadMultipartDecodable(
            path: "/api/chat/transcribe",
            field: "audio",
            data: data,
            filename: filename,
            mimeType: mimeType,
            requiresAuth: true,
            extraFields: nil,
            as: TranscriptionResponse.self
        )
    }
}

// MARK: - Reviews

enum ReviewsService {
    struct EligibilityResponse: Decodable {
        let eligible: Bool
    }

    /// Check whether the current user can review a completed job.
    static func isEligible(jobId: String) async throws -> Bool {
        let r: EligibilityResponse = try await APIClient.shared.request(
            "/api/reviews/jobs/\(jobId)/eligibility"
        )
        return r.eligible
    }

    /// Submit a rating (1–5) and optional comment for a job.
    /// Backend infers reviewer role from the authenticated user.
    static func submit(jobId: String, rating: Int, comment: String?) async throws {
        struct Req: Encodable { let rating: Int; let body: String? }
        _ = try await APIClient.shared.request(
            "/api/reviews/jobs/\(jobId)",
            method: .POST,
            body: Req(rating: rating, body: comment),
            as: OkResponse.self
        )
    }

    struct ReviewsListResponse: Decodable {
        let reviews: [APIReview]
    }

    /// Fetch public reviews for a user.
    static func forUser(userId: String) async throws -> [APIReview] {
        let r: ReviewsListResponse = try await APIClient.shared.request(
            "/api/reviews/users/\(userId)"
        )
        return r.reviews
    }
}

// MARK: - Helper Quotes

enum QuotesService {

    struct CreateRequest: Encodable {
        let job_id: String
        let line_items: [QuoteLineItem]
        let tax_rate: Double
        let notes: String?
        let valid_days: Int
    }

    struct QuotesListResponse: Decodable {
        let quotes: [APIHelperQuote]
    }

    struct QuoteJobResponse: Decodable {
        let quotes: [APIHelperQuote]
    }

    struct StatusRequest: Encodable {
        let status: String
    }

    /// Send a new quote for a job.
    static func send(_ req: CreateRequest) async throws -> APIHelperQuote {
        try await APIClient.shared.request(
            "/api/helper-quotes",
            method: .POST,
            body: req,
            as: APIHelperQuote.self
        )
    }

    /// Quotes the authenticated helper has sent.
    static func sent(limit: Int = 50, offset: Int = 0) async throws -> [APIHelperQuote] {
        let r: QuotesListResponse = try await APIClient.shared.request(
            "/api/helper-quotes/sent",
            query: ["limit": limit, "offset": offset]
        )
        return r.quotes
    }

    /// Quotes received for a specific job (client view).
    static func forJob(_ jobId: String) async throws -> [APIHelperQuote] {
        let r: QuoteJobResponse = try await APIClient.shared.request(
            "/api/helper-quotes/job/\(jobId)"
        )
        return r.quotes
    }

    /// Client accepts or declines a quote.
    static func updateStatus(quoteId: String, status: String) async throws -> APIHelperQuote {
        try await APIClient.shared.request(
            "/api/helper-quotes/\(quoteId)/status",
            method: .PATCH,
            body: StatusRequest(status: status),
            as: APIHelperQuote.self
        )
    }

    /// Helper withdraws a quote.
    static func withdraw(quoteId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/helper-quotes/\(quoteId)", method: .DELETE
        )
    }
}

// MARK: - Saved Searches

enum SavedSearchesService {

    struct SearchesResponse: Decodable {
        let searches: [APISavedSearch]
    }

    struct CreateRequest: Encodable {
        let name: String
        let keyword: String?
        let category: String?
        let city: String?
        let state: String?
        let radius_miles: Int?
        let min_budget: Int?
        let max_budget: Int?
        let notify: Bool
    }

    struct UpdateRequest: Encodable {
        let name: String?
        let keyword: String?
        let category: String?
        let city: String?
        let state: String?
        let radius_miles: Int?
        let min_budget: Int?
        let max_budget: Int?
        let notify: Bool?
    }

    static func list() async throws -> [APISavedSearch] {
        let r: SearchesResponse = try await APIClient.shared.request("/api/saved-searches")
        return r.searches
    }

    static func create(_ req: CreateRequest) async throws -> APISavedSearch {
        try await APIClient.shared.request(
            "/api/saved-searches",
            method: .POST,
            body: req,
            as: APISavedSearch.self
        )
    }

    static func update(_ id: String, req: UpdateRequest) async throws -> APISavedSearch {
        try await APIClient.shared.request(
            "/api/saved-searches/\(id)", method: .PUT, body: req, as: APISavedSearch.self
        )
    }

    static func delete(_ id: String) async throws {
        try await APIClient.shared.requestVoid("/api/saved-searches/\(id)", method: .DELETE)
    }
}

// MARK: - Uploads (multipart)

enum UploadService {
    /// Uploads raw bytes as multipart/form-data.
    static func uploadImage(_ data: Data, filename: String = "image.jpg",
                            mimeType: String = "image/jpeg", purpose: String? = nil) async throws -> UploadResponse {
        try await uploadMultipart(path: "/api/upload/image", field: "image", data: data,
                                  filename: filename, mimeType: mimeType, purpose: purpose)
    }

    static func uploadDocument(_ data: Data, filename: String, mimeType: String = "application/pdf",
                               purpose: String? = nil) async throws -> UploadResponse {
        try await uploadMultipart(path: "/api/upload/document", field: "document", data: data,
                                  filename: filename, mimeType: mimeType, purpose: purpose)
    }

    static func uploadConversationAttachment(conversationId: String,
                                            data: Data,
                                            filename: String,
                                            mimeType: String) async throws -> APIAttachmentUpload {
        try await uploadMultipartDecodable(
            path: "/api/messages/conversations/\(conversationId)/attachments",
            field: "file",
            data: data,
            filename: filename,
            mimeType: mimeType,
            requiresAuth: true,
            extraFields: nil,
            as: APIAttachmentUpload.self
        )
    }

    private static func uploadMultipart(path: String, field: String, data: Data,
                                        filename: String, mimeType: String, purpose: String?) async throws -> UploadResponse {
        try await uploadMultipartDecodable(
            path: path,
            field: field,
            data: data,
            filename: filename,
            mimeType: mimeType,
            requiresAuth: true,
            extraFields: purpose.map { ["purpose": $0] },
            as: UploadResponse.self
        )
    }

    static func uploadMultipartDecodable<T: Decodable>(
        path: String,
        field: String,
        data: Data,
        filename: String,
        mimeType: String,
        requiresAuth: Bool,
        extraFields: [String: String]?,
        as type: T.Type = T.self
    ) async throws -> T {
        var token: String?
        if requiresAuth {
            token = KeychainManager.shared.getAccessToken()
            if token == nil { throw APIError.notAuthenticated }
        }

        let boundary = "ox-\(UUID().uuidString)"
        guard let resolved = URL(string: path, relativeTo: APIConfig.baseURL)?.absoluteURL else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: resolved, timeoutInterval: APIConfig.uploadTimeout)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        var body = Data()
        let nl = "\r\n"
        func append(_ s: String) { body.append(s.data(using: .utf8)!) }

        if let extraFields {
            for (k, v) in extraFields {
                append("--\(boundary)\(nl)")
                append("Content-Disposition: form-data; name=\"\(k)\"\(nl)\(nl)\(v)\(nl)")
            }
        }
        append("--\(boundary)\(nl)")
        append("Content-Disposition: form-data; name=\"\(field)\"; filename=\"\(filename)\"\(nl)")
        append("Content-Type: \(mimeType)\(nl)\(nl)")
        body.append(data)
        append("\(nl)--\(boundary)--\(nl)")
        req.httpBody = body

        let (respData, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw APIError.server(code: (resp as? HTTPURLResponse)?.statusCode ?? 0,
                                  message: String(data: respData, encoding: .utf8))
        }
        return try JSONDecoder().decode(T.self, from: respData)
    }
}

// MARK: - Helper Profile Management

enum HelperProfileService {
    // MARK: - Read

    static func me() async throws -> [String: AnyDecodable] {
        try await APIClient.shared.request("/api/helper-profile/me")
    }

    // MARK: - Core updates

    struct CoreUpdateRequest: Encodable {
        let profile_headline: String?
        let bio_long: String?
        let bio_short: String?
        let hourly_rate_min: Int?
        let hourly_rate_max: Int?
        let rate_preference: String?
        let service_city: String?
        let service_state: String?
        let service_zip: String?
        let service_radius_miles: Int?
        let is_available_now: Bool?
        let ai_knowledge: String?
        let booking_buffer_minutes: Int?
    }

    static func updateCore(_ req: CoreUpdateRequest) async throws {
        try await APIClient.shared.requestVoid("/api/helper-profile/core", method: .PUT, body: req)
    }

    struct PhotoUpdateRequest: Encodable {
        let profile_photo_url: String?
        let cover_photo_url: String?
    }

    static func updatePhoto(_ req: PhotoUpdateRequest) async throws {
        try await APIClient.shared.requestVoid("/api/helper-profile/photo", method: .PUT, body: req)
    }

    // MARK: - Services

    struct ServiceCreateRequest: Encodable {
        let name: String
        let description: String?
        let price: Int?
        let price_unit: String?
        let duration: String?
        let popular: Bool?
        let category: String?
        let sort_order: Int?
    }

    static func addService(_ req: ServiceCreateRequest) async throws -> [String: AnyDecodable] {
        try await APIClient.shared.request("/api/helper-profile/services", method: .POST, body: req)
    }

    static func updateService(_ serviceId: String, req: ServiceCreateRequest) async throws -> [String: AnyDecodable] {
        try await APIClient.shared.request("/api/helper-profile/services/\(serviceId)", method: .PUT, body: req)
    }

    static func deleteService(_ serviceId: String) async throws {
        try await APIClient.shared.requestVoid("/api/helper-profile/services/\(serviceId)", method: .DELETE)
    }

    // MARK: - FAQs

    struct FAQCreateRequest: Encodable {
        let question: String
        let answer: String
        let sort_order: Int?
    }

    static func addFAQ(_ req: FAQCreateRequest) async throws -> [String: AnyDecodable] {
        try await APIClient.shared.request("/api/helper-profile/faqs", method: .POST, body: req)
    }

    static func deleteFAQ(_ faqId: String) async throws {
        try await APIClient.shared.requestVoid("/api/helper-profile/faqs/\(faqId)", method: .DELETE)
    }

    // MARK: - Policies

    struct PolicyCreateRequest: Encodable {
        let title: String
        let content: String
        let icon: String?
        let sort_order: Int?
    }

    static func addPolicy(_ req: PolicyCreateRequest) async throws -> [String: AnyDecodable] {
        try await APIClient.shared.request("/api/helper-profile/policies", method: .POST, body: req)
    }

    static func deletePolicy(_ policyId: String) async throws {
        try await APIClient.shared.requestVoid("/api/helper-profile/policies/\(policyId)", method: .DELETE)
    }
}

// MARK: - Recurring Bookings (customer-side subscriptions)

struct APIRecurringBooking: Decodable, Identifiable {
    let id: String
    let helper_id: String?
    let service_name: String?
    let frequency: String?         // "weekly" | "biweekly" | "monthly"
    let preferred_day: String?     // "Monday", "Tuesday", etc.
    let preferred_time: String?    // "09:00"
    let status: String?            // "active" | "paused" | "cancelled"
    let next_date: String?
    let created_at: String?
    let helper_name: String?
    let helper_avatar_url: String?
}

enum RecurringBookingsService {

    struct ListResponse: Decodable {
        let subscriptions: [APIRecurringBooking]
    }

    struct CreateRequest: Encodable {
        let helper_id: String
        let service_name: String
        let frequency: String
        let preferred_day: String?
        let preferred_time: String?
        let notes: String?
    }

    struct CreateResponse: Decodable {
        let subscription: APIRecurringBooking?
        let message: String?
    }

    static func list() async throws -> [APIRecurringBooking] {
        let resp: ListResponse = try await APIClient.shared.request("/api/bookings/recurring")
        return resp.subscriptions
    }

    static func create(_ req: CreateRequest) async throws -> APIRecurringBooking {
        let resp: CreateResponse = try await APIClient.shared.request(
            "/api/bookings/recurring",
            method: .POST,
            body: req
        )
        guard let sub = resp.subscription else {
            throw APIError.server(code: 0, message: resp.message ?? "Could not create subscription.")
        }
        return sub
    }

    static func cancel(id: String) async throws {
        struct Resp: Decodable { let message: String? }
        let _: Resp = try await APIClient.shared.request(
            "/api/bookings/recurring/\(id)/cancel",
            method: .POST,
            body: EmptyEncodable()
        )
    }

    static func pause(id: String) async throws {
        struct Resp: Decodable { let message: String? }
        let _: Resp = try await APIClient.shared.request(
            "/api/bookings/recurring/\(id)/pause",
            method: .POST,
            body: EmptyEncodable()
        )
    }

    static func resume(id: String) async throws {
        struct Resp: Decodable { let message: String? }
        let _: Resp = try await APIClient.shared.request(
            "/api/bookings/recurring/\(id)/resume",
            method: .POST,
            body: EmptyEncodable()
        )
    }

    private struct EmptyEncodable: Encodable {}
}

// MARK: - FranchiseService

enum FranchiseService {
    struct Application: Decodable, Identifiable {
        let id: String
        let status: String?
        let agreement_status: String?
        let training_status: String?
        let launch_readiness_status: String?
        let desired_brand_name: String?
        let desired_region: String?
        let desired_city: String?
        let desired_country: String?
        let linked_business_name: String?
        let checklist_completed: Int?
        let checklist_total: Int?
        let submitted_at: String?
        let updated_at: String?
    }

    struct ListResponse: Decodable { let applications: [Application] }

    static func myApplications() async throws -> [Application] {
        let resp = try await APIClient.shared.request(
            "/api/franchise/my-applications",
            method: .GET,
            body: nil as String?,
            as: ListResponse.self
        )
        return resp.applications
    }

    // MARK: Territory stats

    struct TerritoryApplication: Decodable {
        let id: String
        let status: String?
        let agreement_status: String?
        let training_status: String?
        let launch_readiness_status: String?
        let linked_business_id: String?
        let brand_name: String?
        let country: String?
        let region: String?
        let city: String?
        let checklist_done: Int?
        let checklist_all: Int?
        let compliance_pct: Int?
    }

    struct TerritoryKpis: Decodable {
        let helpers_total: Int?
        let helpers_verified: Int?
        let avg_rating: Double?
        let jobs_posted_30d: Int?
        let jobs_active: Int?
        let jobs_completed: Int?
        let completion_rate: Int?
        let revenue_30d_cents: Int?
        let revenue_total_cents: Int?
    }

    struct TerritoryStatsResponse: Decodable {
        let has_territory: Bool
        let application: TerritoryApplication?
        let territory_kpis: TerritoryKpis?
    }

    static func territoryStats() async throws -> TerritoryStatsResponse {
        return try await APIClient.shared.request(
            "/api/franchise/territory-stats",
            method: .GET,
            body: nil as String?,
            as: TerritoryStatsResponse.self
        )
    }
}

// MARK: - InvestorService

enum InvestorService {
    // Legacy stub model — kept for source-compat; not used by InvestorHome anymore.
    struct PortfolioSummary: Decodable {
        let total_invested_cents: Int?
        let helpers_funded: Int?
        let revenue_share_cents: Int?
        let active_opportunities: Int?
    }

    static func portfolioSummary() async throws -> PortfolioSummary {
        return try await APIClient.shared.request(
            "/api/payments/investor-summary",
            method: .GET,
            body: nil as String?,
            as: PortfolioSummary.self
        )
    }

    // MARK: Real platform KPIs

    struct PlatformKpis: Decodable {
        // Users
        let total_users: Int?
        let total_customers: Int?
        let total_helpers: Int?
        let new_users_cur: Int?
        let new_users_prev: Int?
        let verified_users: Int?
        let verified_helpers: Int?
        let avg_helper_rating: Double?
        // Jobs
        let open_jobs: Int?
        let active_jobs: Int?
        let completed_jobs: Int?
        let new_jobs_cur: Int?
        let new_jobs_prev: Int?
        let avg_bids_per_job: Double?
        let completion_rate: Int?
        // Revenue (cents)
        let revenue_total_cents: Int?
        let revenue_cur_cents: Int?
        let revenue_prev_cents: Int?
        let revenue_mtd_cents: Int?
        let revenue_delta_cents: Int?
        let sub_revenue_cur_cents: Int?
        let refunds_cur_cents: Int?
        // Subs & payouts
        let active_subscriptions: Int?
        let pending_payouts_cents: Int?
    }

    struct KpisResponse: Decodable {
        let period: String
        let kpis: PlatformKpis
    }

    struct ChartRow: Decodable, Identifiable {
        var id: String { period ?? UUID().uuidString }
        let period: String?
        let job_fee_cents: Int?
        let subscription_cents: Int?
        let refunds_cents: Int?
    }

    struct ChartResponse: Decodable {
        let chart: [ChartRow]
        let period: String
    }

    struct FranchiseStage: Decodable, Identifiable {
        var id: String { status }
        let status: String
        let count: Int?
    }

    struct FranchisePipelineResponse: Decodable {
        let pipeline: [FranchiseStage]
        let total: Int
    }

    static func kpis(period: String = "30d") async throws -> KpisResponse {
        return try await APIClient.shared.request(
            "/api/investor/kpis",
            method: .GET,
            query: ["period": period],
            body: nil as String?,
            as: KpisResponse.self
        )
    }

    static func revenueChart(period: String = "30d") async throws -> ChartResponse {
        return try await APIClient.shared.request(
            "/api/investor/revenue-chart",
            method: .GET,
            query: ["period": period],
            body: nil as String?,
            as: ChartResponse.self
        )
    }

    static func franchisePipeline() async throws -> FranchisePipelineResponse {
        return try await APIClient.shared.request(
            "/api/investor/franchise",
            method: .GET,
            body: nil as String?,
            as: FranchisePipelineResponse.self
        )
    }
}
