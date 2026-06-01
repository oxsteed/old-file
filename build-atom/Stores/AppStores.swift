import SwiftUI
import Combine

// MARK: - AuthStore

/// Central authentication + session manager.
/// Replaces the local-only PersonaStore by binding persona to the server-side `mode`.
@MainActor
final class AuthStore: ObservableObject {
    @Published var user: APIUser?
    @Published var isLoading = false
    @Published var lastError: String?
    @Published var pendingMfaToken: String?

    /// Whether we have a valid session (tokens + user loaded).
    var isAuthenticated: Bool { user != nil }

    init() {
        // Listen for token-expired notifications and force re-login
        NotificationCenter.default.addObserver(forName: .oxAuthExpired, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.handleSessionExpired() }
        }
    }

    /// Called from App startup — restores session if a refresh token is in Keychain.
    func bootstrap() async {
        guard KeychainManager.shared.getAccessToken() != nil else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            self.user = try await AuthService.me()
        } catch {
            // Tokens may be stale; wipe and prompt for re-auth
            KeychainManager.shared.deleteAll()
            self.user = nil
        }
    }

    func login(email: String, password: String) async {
        isLoading = false
        pendingMfaToken = nil
        // Legacy callsite support only. Real login requires terms + signature fields.
        lastError = "Please update the login form (terms + signature)."
    }

    func login(email: String,
               password: String,
               agreementName: String,
               rememberMe: Bool) async {
        isLoading = true; lastError = nil; pendingMfaToken = nil
        defer { isLoading = false }
        do {
            let resp = try await AuthService.login(email: email,
                                                  password: password,
                                                  agreementName: agreementName,
                                                  rememberMe: rememberMe)
            if resp.requiresTwoFactor == true, let token = resp.mfaToken {
                pendingMfaToken = token
                return
            }
            guard let access = resp.accessToken, let refresh = resp.refreshToken, let u = resp.user else {
                throw APIError.server(code: 0, message: resp.error ?? "Login failed.")
            }
            persistTokens(accessToken: access, refreshToken: refresh, expiresIn: 900)
            // Fetch /auth/me to ensure user object is complete (server can return partial on login)
            self.user = (try? await AuthService.me()) ?? u
        } catch {
            self.lastError = AuthStore.userFacingAuthError(error)
        }
    }

    func submitTwoFactor(code: String) async {
        guard let token = pendingMfaToken else { return }
        isLoading = true; lastError = nil
        defer { isLoading = false }
        do {
            let resp = try await AuthService.login2FA(mfaToken: token, code: code)
            guard let access = resp.accessToken, let refresh = resp.refreshToken, let u = resp.user else {
                throw APIError.server(code: 0, message: resp.error ?? "2FA failed.")
            }
            persistTokens(accessToken: access, refreshToken: refresh, expiresIn: 900)
            pendingMfaToken = nil
            self.user = (try? await AuthService.me()) ?? u
        } catch {
            self.lastError = AuthStore.userFacingAuthError(error, isTwoFactor: true)
        }
    }

    func cancelTwoFactor() {
        pendingMfaToken = nil
        lastError = nil
    }

    func register(email: String, password: String, firstName: String, lastName: String, phone: String?) async {
        isLoading = true; lastError = nil
        defer { isLoading = false }
        do {
            // Default to customer unless caller supplies a role.
            let resp = try await AuthService.register(email: email, password: password,
                                                      firstName: firstName, lastName: lastName,
                                                      phone: phone, language: nil,
                                                      role: "customer", ref: nil)
            persistTokens(accessToken: resp.accessToken, refreshToken: resp.refreshToken, expiresIn: resp.expiresIn ?? 900)
            self.user = resp.user
        } catch {
            self.lastError = AuthStore.userFacingAuthError(error, isRegister: true)
        }
    }

    func register(email: String,
                  password: String,
                  firstName: String,
                  lastName: String,
                  phone: String?,
                  role: String,
                  ref: String?) async {
        isLoading = true; lastError = nil
        defer { isLoading = false }
        do {
            let resp = try await AuthService.register(email: email, password: password,
                                                      firstName: firstName, lastName: lastName,
                                                      phone: phone, language: nil,
                                                      role: role, ref: ref)
            persistTokens(accessToken: resp.accessToken, refreshToken: resp.refreshToken, expiresIn: resp.expiresIn ?? 900)
            self.user = resp.user
        } catch {
            self.lastError = AuthStore.userFacingAuthError(error, isRegister: true)
        }
    }

    func logout() async {
        await AuthService.logout()
        KeychainManager.shared.deleteAll()
        self.user = nil
    }

    func requestPasswordReset(email: String) async -> Bool {
        isLoading = true; lastError = nil
        defer { isLoading = false }
        do {
            try await AuthService.forgotPassword(email: email)
            return true
        } catch {
            lastError = AuthStore.userFacingAuthError(error)
            return false
        }
    }

    func resetPassword(token: String, newPassword: String) async -> Bool {
        isLoading = true; lastError = nil
        defer { isLoading = false }
        do {
            try await AuthService.resetPassword(token: token, newPassword: newPassword)
            return true
        } catch {
            lastError = AuthStore.userFacingAuthError(error)
            return false
        }
    }

    func switchPersona(_ persona: Persona) async {
        let mode = serverMode(for: persona)
        do {
            let response = try await AuthService.switchRole(mode)
            if let access = response.accessToken, let refresh = response.refreshToken {
                persistTokens(accessToken: access, refreshToken: refresh, expiresIn: 900)
            }
            self.user = response.user
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    var activePersona: Persona { user?.preferredPersona ?? .customer }

    // MARK: - Internal

    private func persistTokens(accessToken: String, refreshToken: String, expiresIn: Int) {
        KeychainManager.shared.saveAccessToken(accessToken)
        KeychainManager.shared.saveRefreshToken(refreshToken)
        KeychainManager.shared.saveExpiry(expiresIn)
    }

    private static func userFacingAuthError(_ error: Error,
                                           isRegister: Bool = false,
                                           isTwoFactor: Bool = false) -> String {
        guard let api = error as? APIError else { return error.localizedDescription }
        switch api {
        case .rateLimited:
            return "Too many attempts. Please wait a few minutes and try again."
        case .unauthorized:
            return isTwoFactor ? "Invalid verification code." : "Incorrect email or password."
        case .validation(let message, _):
            let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
            if isRegister && m.lowercased().contains("exists") {
                return "An account with this email already exists."
            }
            return m.isEmpty ? (api.errorDescription ?? "Request failed.") : m
        default:
            return api.errorDescription ?? "Something went wrong."
        }
    }

    private func handleSessionExpired() {
        KeychainManager.shared.deleteAll()
        self.user = nil
    }

    private func serverMode(for p: Persona) -> String {
        switch p {
        case .customer:   return "customer"
        case .helper:     return "helper"
        case .business:   return "business_owner"
        case .consultant: return "consultant"
        case .toolOwner:  return "tool_owner"
        case .franchise:  return "franchise_applicant"
        case .investor:   return "investor"
        }
    }
}

// MARK: - JobsStore

@MainActor
final class JobsStore: ObservableObject {
    @Published var myJobs: [APIJob] = []
    @Published var availableJobs: [APIJob] = []
    @Published var isLoading = false
    @Published var lastError: String?

    func loadMyJobs() async {
        isLoading = true; defer { isLoading = false }
        do { myJobs = try await JobsService.myJobs() }
        catch { lastError = (error as? APIError)?.errorDescription }
    }

    func loadAvailable() async {
        isLoading = true; defer { isLoading = false }
        do {
            let lat = UserDefaults.standard.object(forKey: "ox.location.lat") as? Double
            let lng = UserDefaults.standard.object(forKey: "ox.location.lng") as? Double
            let timestamp = UserDefaults.standard.object(forKey: "ox.location.updated_at") as? Date
            let isFresh = timestamp.map { Date().timeIntervalSince($0) <= 900 } ?? false
            if let lat, let lng, isFresh {
                availableJobs = try await JobsService.browse(lat: lat, lng: lng, radius: 20, sort: "closest")
            } else {
                availableJobs = try await JobsService.browse(sort: "newest")
            }
        }
        catch { lastError = (error as? APIError)?.errorDescription }
    }

    func create(_ req: JobCreateRequest) async -> Bool {
        do {
            let job = try await JobsService.create(req)
            myJobs.insert(job, at: 0)
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription
            return false
        }
    }
}

// MARK: - BidsStore

@MainActor
final class BidsStore: ObservableObject {
    @Published var myBids: [APIBid] = []
    @Published var isLoading = false
    @Published var lastError: String?

    func loadMine() async {
        isLoading = true; defer { isLoading = false }
        do { myBids = try await BidsService.myBids() }
        catch { lastError = (error as? APIError)?.errorDescription }
    }

    func place(jobId: String, amountCents: Int, message: String?, hours: Double?) async -> Bool {
        do {
            let bid = try await BidsService.place(BidCreateRequest(
                job_id: jobId, amount: amountCents,
                message: message, estimated_hours: hours))
            myBids.insert(bid, at: 0)
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription
            return false
        }
    }
}

// MARK: - MessagesStore

@MainActor
final class MessagesStore: ObservableObject {
    @Published var conversations: [APIConversation] = []
    @Published var messagesByConversation: [String: [APIMessage]] = [:]
    @Published var isLoading = false
    @Published var lastError: String?
    private let pageSize = 50
    private var offsetsByConversation: [String: Int] = [:]
    private var hasMoreByConversation: [String: Bool] = [:]

    func loadConversations() async {
        isLoading = true; defer { isLoading = false }
        do { conversations = try await MessagesService.conversations() }
        catch { lastError = (error as? APIError)?.errorDescription }
    }

    func loadMessages(_ conversationId: String) async {
        do {
            let firstPage = try await MessagesService.messages(in: conversationId, limit: pageSize, offset: 0)
            messagesByConversation[conversationId] = firstPage
            offsetsByConversation[conversationId] = firstPage.count
            hasMoreByConversation[conversationId] = firstPage.count >= pageSize
        }
        catch { lastError = (error as? APIError)?.errorDescription }
    }

    func loadOlderMessages(_ conversationId: String) async {
        guard hasMoreByConversation[conversationId] != false else { return }
        let offset = offsetsByConversation[conversationId] ?? messagesByConversation[conversationId]?.count ?? 0
        do {
            let page = try await MessagesService.messages(in: conversationId, limit: pageSize, offset: offset)
            guard !page.isEmpty else {
                hasMoreByConversation[conversationId] = false
                return
            }
            messagesByConversation[conversationId] = (messagesByConversation[conversationId] ?? []) + page
            offsetsByConversation[conversationId] = offset + page.count
            hasMoreByConversation[conversationId] = page.count >= pageSize
        } catch {
            lastError = (error as? APIError)?.errorDescription
        }
    }

    func send(_ conversationId: String, content: String, attachments: [APIAttachment]? = nil) async {
        do {
            let msg = try await MessagesService.send(conversationId, content: content, attachments: attachments)
            messagesByConversation[conversationId, default: []].append(msg)
        } catch {
            lastError = (error as? APIError)?.errorDescription
        }
    }
}

// MARK: - CalendarStore

@MainActor
final class CalendarStore: ObservableObject {
    @Published var appointments: [APIAppointment] = []
    @Published var bookingsIncoming: [APIBooking] = []
    @Published var bookingsMine: [APIBooking] = []
    @Published var isLoading = false
    @Published var lastError: String?

    func loadAppointments() async {
        isLoading = true; defer { isLoading = false }
        do { appointments = try await CalendarService.appointments() }
        catch { lastError = (error as? APIError)?.errorDescription }
    }

    func loadBookings(asHelper: Bool) async {
        do {
            if asHelper { bookingsIncoming = try await BookingsService.incoming() }
            else { bookingsMine = try await BookingsService.mine() }
        } catch { lastError = (error as? APIError)?.errorDescription }
    }
}

// MARK: - NotificationsStore

@MainActor
final class NotificationsStore: ObservableObject {
    @Published var items: [APINotification] = []
    @Published var preferences: NotificationPreferences?
    @Published var unreadCount: Int = 0

    func load() async {
        do {
            let resp = try await NotificationsService.list()
            items = resp.notifications
            if let serverUnread = resp.unread_count {
                unreadCount = serverUnread
            } else {
                unreadCount = items.filter { !($0.is_read ?? false) }.count
            }
        }
        catch { OXLog.error("notifications load failed: \(String(describing: error))", category: "notifs") }
    }

    func loadPreferences() async {
        do { preferences = try await NotificationsService.preferences() }
        catch { OXLog.error("preferences load failed: \(String(describing: error))", category: "notifs") }
    }

    func markRead(_ id: String) async {
        try? await NotificationsService.markRead(id)
        if let idx = items.firstIndex(where: { $0.id == id }) {
            let n = items[idx]
            let wasUnread = (n.is_read != true)
            items[idx] = APINotification(id: n.id, type: n.type, title: n.title, message: n.message,
                                         data: n.data,
                                         is_read: true, created_at: n.created_at)
            if wasUnread { unreadCount = max(0, unreadCount - 1) }
        }
    }
}

// MARK: - PaymentsStore

@MainActor
final class PaymentsStore: ObservableObject {
    @Published var payments: [APIPayment] = []
    @Published var connectStatus: StripeConnectStatus?

    func loadPayments() async {
        do { payments = (try await PaymentsService.myPayments()).payments }
        catch { OXLog.error("payments load failed: \(String(describing: error))", category: "payments") }
    }

    func loadConnectStatus() async {
        do { connectStatus = try await PaymentsService.connectStatus() }
        catch { /* not yet connected is fine */ }
    }
}

// MARK: - ToolRentalsStore

@MainActor
final class ToolRentalsStore: ObservableObject {
    @Published var myTools: [APIToolRental] = []
    @Published var isLoading = false
    @Published var lastError: String?

    func loadMyTools() async {
        isLoading = true
        defer { isLoading = false }
        do {
            myTools = try await ToolRentalsService.myTools()
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - LifeStore

@MainActor
final class LifeStore: ObservableObject {
    @Published var pulse: APILifePulse?
    @Published var summary: APILifeDashboardSummary?
    @Published var expenses: [APILifeExpense] = []
    @Published var expenseSummary: APILifeExpenseSummary?
    @Published var budgets: [APILifeBudget] = []
    @Published var goals: [APILifeGoal] = []
    @Published var checklist: [APILifeChecklistItem] = []
    @Published var homeTasks: [APILifeHomeTask] = []
    @Published var savedHelpers: [APILifeSavedHelper] = []
    @Published var isLoading = false
    @Published var lastError: String?

    func refresh(window: String = "1m",
                 section: String = "home") async {
        isLoading = true
        defer { isLoading = false }
        do {
            // Life endpoints require auth; in guest mode just clear content.
            guard KeychainManager.shared.getAccessToken() != nil else {
                pulse = nil
                summary = nil
                expenses = []
                expenseSummary = nil
                budgets = []
                goals = []
                checklist = []
                homeTasks = []
                savedHelpers = []
                lastError = nil
                return
            }
            async let p: APILifePulse = LifeService.pulse(window: window)
            async let s: APILifeDashboardSummary = LifeService.summary()
            async let e: APILifeExpensesResponse = LifeService.expenses(limit: 30, offset: 0)
            async let b: APILifeBudgetsResponse = LifeService.budgets()
            async let g: APILifeGoalsResponse = LifeService.goals(completed: false)
            async let c: APILifeChecklistResponse = LifeService.checklist()
            async let t: APILifeHomeTasksResponse = LifeService.homeTasks(section: section, completed: false)
            async let sh: APILifeSavedHelpersResponse = LifeService.savedHelpers()
            let nextPulse = try await p
            let nextSummary = try await s
            let er = try await e
            let nextBudgets = try await b.budgets
            let nextGoals = try await g.goals
            let nextChecklist = try await c.items
            let nextHomeTasks = try await t.home_tasks
            let nextSavedHelpers = try await sh.saved_helpers

            pulse = nextPulse
            summary = nextSummary
            expenses = er.expenses
            expenseSummary = er.summary
            budgets = nextBudgets
            goals = nextGoals
            checklist = nextChecklist
            homeTasks = nextHomeTasks
            savedHelpers = nextSavedHelpers
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func toggleChecklist(_ item: APILifeChecklistItem) async {
        guard let current = item.is_completed else { return }
        do {
            let updated = try await LifeService.updateChecklistItem(id: item.id, isCompleted: !current)
            if let idx = checklist.firstIndex(where: { $0.id == item.id }) {
                checklist[idx] = updated
            }
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func toggleHomeTask(_ task: APILifeHomeTask) async {
        guard let current = task.is_completed else { return }
        do {
            let updated = try await LifeService.updateHomeTaskCompleted(id: task.id, isCompleted: !current)
            if let idx = homeTasks.firstIndex(where: { $0.id == task.id }) {
                homeTasks[idx] = updated
            }
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - LearnStore

@MainActor
final class LearnStore: ObservableObject {
    @Published var guides: [LearnGuide] = LearnGuideCatalog.all
    @Published var stats: APILearnStatsResponse?
    @Published var completions: Set<String> = []
    @Published var badges: [APILearnBadge] = []
    @Published var isLoading = false
    @Published var lastError: String?

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            // Guides + stats are public. Completions/badges require auth and should be skipped for guests.
            if let remote = try? await LearnService.guides() {
                if !remote.guides.isEmpty { guides = remote.guides }
            }

            // Apply admin-managed product link overrides (no-op when endpoint not yet deployed).
            // This is how OxSteed swaps affiliate links and eventually adds own-inventory
            // links without shipping a new app version.
            if let overrideResp = await LearnService.productLinks(), !overrideResp.products.isEmpty {
                guides = Self.applyProductOverrides(overrideResp.products, to: guides)
            }

            stats = try await LearnService.stats()

            guard KeychainManager.shared.getAccessToken() != nil else {
                completions = []
                badges = []
                return
            }

            async let c = LearnService.completions()
            async let b = LearnService.badges()
            let comp = try await c
            completions = Set(comp.completions.map(\.guide_id))
            badges = try await b.badges
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Merges admin product-link overrides into the guide catalog.
    /// - Guide-scoped overrides (non-nil `guideId`) take priority over global overrides.
    /// - Only active overrides are applied.
    private static func applyProductOverrides(
        _ overrides: [LearnProductLink],
        to guides: [LearnGuide]
    ) -> [LearnGuide] {
        guard !overrides.isEmpty else { return guides }
        let active = overrides.filter(\.isActive)
        guard !active.isEmpty else { return guides }

        return guides.map { guide in
            let updatedTools = guide.tools.map { tool in
                // Prefer a guide-specific override; fall back to a global override.
                let toolNameLower = tool.name.lowercased()
                let match = active.first(where: {
                    $0.toolName.lowercased() == toolNameLower && $0.guideId == guide.id
                }) ?? active.first(where: {
                    $0.toolName.lowercased() == toolNameLower && $0.guideId == nil
                })
                return match.map { tool.applying(override: $0) } ?? tool
            }
            // Return a new guide only when something actually changed.
            guard updatedTools != guide.tools else { return guide }
            return LearnGuide(
                id: guide.id, title: guide.title, category: guide.category,
                difficulty: guide.difficulty, minutes: guide.minutes, featured: guide.featured,
                intro: guide.intro, steps: guide.steps, skills: guide.skills,
                tools: updatedTools, xp: guide.xp, videoURL: guide.videoURL
            )
        }
    }

    func isCompleted(_ guideId: String) -> Bool {
        completions.contains(guideId)
    }

    func markCompleted(guideId: String, difficulty: String) async {
        do {
            _ = try await LearnService.recordCompletion(guideId: guideId, difficulty: difficulty)
            // Refresh badges + completions in case XP or badge got awarded.
            let comp = try await LearnService.completions()
            completions = Set(comp.completions.map(\.guide_id))
            badges = try await LearnService.badges().badges
            // Bust recommendation cache so the feed reflects the new completion.
            RecommendationsStore.shared.invalidate()
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - BusinessWorkspaceStore

@MainActor
final class BusinessWorkspaceStore: ObservableObject {
    @Published var workspace: WorkspaceBusinessesResponse?
    @Published var selectedBusinessId: Int?
    @Published var analytics: BusinessAnalyticsSummary?
    @Published var products: [BusinessProductSummary] = []
    @Published var leads: [BusinessLeadSummary] = []
    @Published var healthAlerts: [BusinessHealthAlert] = []
    @Published var calendarSummary: BusinessCalendarSummary?
    @Published var isLoading = false
    @Published var lastError: String?

    private let selectedBusinessKey = "ox.workspace.selectedBusinessId"

    init() {
        selectedBusinessId = UserDefaults.standard.object(forKey: selectedBusinessKey) as? Int
    }

    var selectedBusiness: WorkspaceBusinessItem? {
        guard let workspace else { return nil }
        if let selectedBusinessId, let match = workspace.items.first(where: { $0.business_id == selectedBusinessId }) {
            return match
        }
        return workspace.last_selected ?? workspace.items.first
    }

    func loadWorkspace() async {
        isLoading = true
        defer { isLoading = false }
        do {
            workspace = try await BusinessWorkspaceService.myBusinesses()
            let targetId = selectedBusinessId ?? workspace?.last_selected?.business_id ?? workspace?.items.first?.business_id
            if let targetId {
                await selectBusiness(targetId)
            }
        } catch {
            lastError = (error as? APIError)?.errorDescription
        }
    }

    func selectBusiness(_ businessId: Int) async {
        selectedBusinessId = businessId
        UserDefaults.standard.set(businessId, forKey: selectedBusinessKey)
        do {
            try await BusinessWorkspaceService.setWorkspaceContext(businessId: businessId)
        } catch {
            lastError = (error as? APIError)?.errorDescription
        }
        await loadBusinessData(businessId)
    }

    func refreshSelectedBusiness() async {
        guard let id = selectedBusiness?.business_id ?? selectedBusinessId else { return }
        await loadBusinessData(id)
    }

    func createLead(name: String,
                    email: String? = nil,
                    phone: String? = nil,
                    serviceInterest: String? = nil,
                    budgetCents: Int? = nil,
                    notes: String? = nil) async -> Bool {
        guard let businessId = selectedBusiness?.business_id ?? selectedBusinessId else { return false }
        do {
            let lead = try await BusinessWorkspaceService.createLead(
                businessId: businessId,
                name: name,
                email: email,
                phone: phone,
                serviceInterest: serviceInterest,
                budgetCents: budgetCents,
                notes: notes
            )
            leads.insert(lead, at: 0)
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription
            return false
        }
    }

    func updateLeadStatus(leadId: String, status: String) async -> Bool {
        guard let businessId = selectedBusiness?.business_id ?? selectedBusinessId,
              let existing = leads.first(where: { $0.id == leadId }) else { return false }
        do {
            let updated = try await BusinessWorkspaceService.updateLead(
                businessId: businessId,
                leadId: leadId,
                name: existing.name,
                email: existing.email,
                phone: existing.phone,
                serviceInterest: existing.service_interest,
                budgetCents: existing.budget_cents,
                notes: existing.notes,
                status: status
            )
            if let idx = leads.firstIndex(where: { $0.id == leadId }) {
                leads[idx] = updated
            } else {
                leads.insert(updated, at: 0)
            }
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription
            return false
        }
    }

    func createProduct(name: String,
                       description: String? = nil,
                       category: String,
                       price: Double,
                       cost: Double? = nil,
                       sku: String) async -> Bool {
        guard let businessId = selectedBusiness?.business_id ?? selectedBusinessId else { return false }
        do {
            try await BusinessWorkspaceService.createProduct(
                businessId: businessId,
                name: name,
                description: description,
                category: category,
                price: price,
                cost: cost,
                sku: sku,
                isActive: true
            )
            await refreshSelectedBusiness()
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription
            return false
        }
    }

    func setProductActive(productId: String, isActive: Bool) async -> Bool {
        guard let businessId = selectedBusiness?.business_id ?? selectedBusinessId else { return false }
        do {
            try await BusinessWorkspaceService.updateProduct(
                businessId: businessId,
                productId: productId,
                isActive: isActive
            )
            if let idx = products.firstIndex(where: { $0.id == productId }) {
                let existing = products[idx]
                products[idx] = BusinessProductSummary(
                    id: existing.id,
                    name: existing.name,
                    category: existing.category,
                    price: existing.price,
                    sku: existing.sku,
                    thumbnailUrl: existing.thumbnailUrl,
                    variantCount: existing.variantCount,
                    totalStock: existing.totalStock,
                    avgRating: existing.avgRating,
                    reviewCount: existing.reviewCount,
                    isActive: isActive,
                    createdAt: existing.createdAt
                )
            }
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription
            return false
        }
    }

    private func loadBusinessData(_ businessId: Int) async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let analyticsTask = BusinessWorkspaceService.analytics(businessId)
            async let productsTask = BusinessWorkspaceService.products(businessId)
            async let leadsTask = BusinessWorkspaceService.leads(businessId)
            async let alertsTask = BusinessWorkspaceService.healthAlerts(businessId)
            async let calendarTask = BusinessWorkspaceService.calendarSummary(businessId)

            analytics = try await analyticsTask
            products = try await productsTask
            leads = try await leadsTask
            healthAlerts = try await alertsTask
            calendarSummary = try await calendarTask
        } catch {
            lastError = (error as? APIError)?.errorDescription
        }
    }
}
