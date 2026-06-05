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

    @discardableResult
    func switchPersona(_ persona: Persona) async -> Bool {
        let mode = serverMode(for: persona)
        do {
            let response = try await AuthService.switchRole(mode)
            if let access = response.accessToken, let refresh = response.refreshToken {
                persistTokens(accessToken: access, refreshToken: refresh, expiresIn: 900)
            }
            self.user = response.user
            return true
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
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
            return appStoreLocalized("auth.error.too_many_attempts")
        case .unauthorized:
            return isTwoFactor ? appStoreLocalized("auth.error.invalid_code") : appStoreLocalized("auth.error.invalid_credentials")
        case .validation(let message, _):
            let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
            if isRegister && m.lowercased().contains("exists") {
                return appStoreLocalized("auth.error.email_exists")
            }
            return m.isEmpty ? (api.errorDescription ?? appStoreLocalized("api.error.request_failed")) : m
        default:
            return api.errorDescription ?? appStoreLocalized("api.error.unknown")
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

private func appStoreLocalized(_ key: String) -> String {
    let rawLanguage = UserDefaults.standard.string(forKey: LocalizationManager.storageKey)
    let language = rawLanguage == AppLanguage.system.rawValue
        ? AppLanguage.fromStoredCode(Locale.preferredLanguages.first) ?? .en
        : AppLanguage.fromStoredCode(rawLanguage) ?? .en

    if let path = Bundle.main.path(forResource: language.rawValue, ofType: "lproj"),
       let bundle = Bundle(path: path) {
        let localized = bundle.localizedString(forKey: key, value: key, table: nil)
        if localized != key { return localized }
    }

    if let path = Bundle.main.path(forResource: AppLanguage.en.rawValue, ofType: "lproj"),
       let bundle = Bundle(path: path) {
        return bundle.localizedString(forKey: key, value: key, table: nil)
    }

    return Bundle.main.localizedString(forKey: key, value: key, table: nil)
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
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
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
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }
}

// MARK: - MessagesStore

@MainActor
final class MessagesStore: ObservableObject {
    @Published var conversations: [APIConversation] = []
    @Published var archivedConversations: [APIConversation] = []
    @Published var messagesByConversation: [String: [APIMessage]] = [:]
    @Published var isLoading = false
    @Published var lastError: String?
    private let pageSize = 50
    private var offsetsByConversation: [String: Int] = [:]
    private var hasMoreByConversation: [String: Bool] = [:]

    func loadConversations() async {
        isLoading = true; defer { isLoading = false }
        do {
            conversations = try await MessagesService.conversations()
            lastError = nil
        }
        catch { lastError = (error as? APIError)?.errorDescription }
    }

    func loadArchivedConversations() async {
        isLoading = true; defer { isLoading = false }
        do {
            archivedConversations = try await MessagesService.archived()
            lastError = nil
        } catch {
            lastError = (error as? APIError)?.errorDescription
        }
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

    func archive(_ conversation: APIConversation) async {
        do {
            try await MessagesService.archive(conversation.id)
            conversations.removeAll { $0.id == conversation.id }
            if archivedConversations.contains(where: { $0.id == conversation.id }) == false {
                archivedConversations.insert(conversation, at: 0)
            }
            lastError = nil
        } catch {
            lastError = (error as? APIError)?.errorDescription
        }
    }

    func restore(_ conversation: APIConversation) async {
        do {
            try await MessagesService.restore(conversation.id)
            archivedConversations.removeAll { $0.id == conversation.id }
            if conversations.contains(where: { $0.id == conversation.id }) == false {
                conversations.insert(conversation, at: 0)
            }
            lastError = nil
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
        do {
            appointments = try await CalendarService.appointments()
            lastError = nil
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func loadBookings(asHelper: Bool) async {
        do {
            if asHelper { bookingsIncoming = try await BookingsService.incoming() }
            else { bookingsMine = try await BookingsService.mine() }
            lastError = nil
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func loadCalendarHome() async {
        isLoading = true
        defer { isLoading = false }
        async let appts = CalendarService.appointments()
        async let incoming = BookingsService.incoming()
        async let mine = BookingsService.mine()
        do {
            appointments = try await appts
            bookingsIncoming = try await incoming
            bookingsMine = try await mine
            lastError = nil
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    @discardableResult
    func acceptBooking(_ booking: APIBooking) async -> Bool {
        do {
            let updated = try await BookingsService.accept(booking.id)
            if let index = bookingsIncoming.firstIndex(where: { $0.id == booking.id }) {
                bookingsIncoming[index] = updated
            }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func declineBooking(_ booking: APIBooking, reason: String? = nil) async -> Bool {
        do {
            try await BookingsService.decline(booking.id, reason: reason)
            bookingsIncoming.removeAll { $0.id == booking.id }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func cancelBooking(_ booking: APIBooking) async -> Bool {
        do {
            try await BookingsService.cancel(booking.id)
            bookingsMine.removeAll { $0.id == booking.id }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }
}

// MARK: - NotificationsStore

@MainActor
final class NotificationsStore: ObservableObject {
    @Published var items: [APINotification] = []
    @Published var preferences: NotificationPreferences?
    @Published var unreadCount: Int = 0
    @Published var lastError: String?

    func load() async {
        do {
            let resp = try await NotificationsService.list()
            items = resp.notifications
            if let serverUnread = resp.unread_count {
                unreadCount = serverUnread
            } else {
                unreadCount = items.filter { !($0.is_read ?? false) }.count
            }
            lastError = nil
        }
        catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            OXLog.error("notifications load failed: \(String(describing: error))", category: "notifs")
        }
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
                                         action_url: n.action_url,
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
        do {
            async let payerList = PaymentsService.myPayments(status: nil, role: "payer")
            async let payeeList = PaymentsService.myPayments(status: nil, role: "payee")
            let (payer, payee) = try await (payerList, payeeList)
            let merged = payer.payments + payee.payments
            var seen = Set<String>()
            payments = merged
                .filter { seen.insert($0.id).inserted }
                .sorted { ($0.created_at ?? "") > ($1.created_at ?? "") }
        } catch {
            OXLog.error("payments load failed: \(String(describing: error))", category: "payments")
        }
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
            lastError = nil
            myTools = try await ToolRentalsService.myTools()
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    @discardableResult
    func createTool(_ request: ToolRentalsService.ToolRentalSaveRequest) async -> Bool {
        isLoading = true
        defer { isLoading = false }
        do {
            lastError = nil
            let tool = try await ToolRentalsService.create(request)
            myTools.insert(tool, at: 0)
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func setToolAvailable(_ tool: APIToolRental, isAvailable: Bool) async -> Bool {
        do {
            lastError = nil
            let request = ToolRentalsService.ToolRentalSaveRequest(
                name: nil,
                category: nil,
                description: nil,
                daily_rate: nil,
                hourly_rate: nil,
                deposit_amount: nil,
                condition: nil,
                brand: nil,
                model: nil,
                is_available: isAvailable,
                requires_deposit: nil,
                delivery_available: nil,
                pickup_only: nil,
                location_city: nil,
                location_state: nil,
                owner_rules: nil,
                replacement_value: nil,
                owner_attestation_accepted: nil
            )
            let updated = try await ToolRentalsService.update(id: tool.id, request)
            if let index = myTools.firstIndex(where: { $0.id == updated.id }) {
                myTools[index] = updated
            } else {
                myTools.insert(updated, at: 0)
            }
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func deleteTool(_ tool: APIToolRental) async -> Bool {
        do {
            lastError = nil
            try await ToolRentalsService.delete(id: tool.id)
            myTools.removeAll { $0.id == tool.id }
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
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
    @Published var sinkingFunds: [APILifeSinkingFund] = []
    @Published var vehicles: [APILifeVehicle] = []
    @Published var habits: [APILifeHabit] = []
    @Published var savedHelpers: [APILifeSavedHelper] = []
    @Published var isLoading = false
    @Published var lastError: String?

    /// True when the user has no data in any pillar — used to show the Life
    /// welcome / explainer card on first visit.
    var isFirstRun: Bool {
        guard !isLoading else { return false }
        return expenses.isEmpty
            && goals.isEmpty
            && homeTasks.isEmpty
            && vehicles.isEmpty
            && habits.isEmpty
            && sinkingFunds.isEmpty
            && pulse == nil
    }

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
                sinkingFunds = []
                vehicles = []
                habits = []
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
            async let sf: APILifeSinkingFundsResponse = LifeService.sinkingFunds()
            async let v: APILifeVehiclesResponse = LifeService.vehicles()
            async let h: APILifeHabitsResponse = LifeService.habits()
            async let sh: APILifeSavedHelpersResponse = LifeService.savedHelpers()
            let nextPulse = try await p
            let nextSummary = try await s
            let er = try await e
            let nextBudgets = try await b.budgets
            let nextGoals = try await g.goals
            let nextChecklist = try await c.items
            let nextHomeTasks = try await t.home_tasks
            let nextSinkingFunds = try await sf.sinking_funds
            let nextVehicles = try await v.vehicles
            let nextHabits = try await h.habits
            let nextSavedHelpers = try await sh.saved_helpers

            pulse = nextPulse
            summary = nextSummary
            expenses = er.expenses
            expenseSummary = er.summary
            budgets = nextBudgets
            goals = nextGoals
            checklist = nextChecklist
            homeTasks = nextHomeTasks
            sinkingFunds = nextSinkingFunds
            vehicles = nextVehicles
            habits = nextHabits
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

    @discardableResult
    func createExpense(source: String,
                       amount: Double,
                       type: String,
                       occurredAt: String) async -> Bool {
        do {
            let safeType = type == "income" ? "income" : "expense"
            let expense = try await LifeService.createExpense(
                type: safeType,
                amount: amount,
                category: safeType == "income" ? "Life Income" : "Life Expense",
                description: source,
                occurredAt: occurredAt
            )
            expenses.insert(expense, at: 0)
            expenseSummary = APILifeExpenseSummary(
                total_income: expenses.filter { $0.type == "income" }.compactMap(\.amount).reduce(0, +),
                total_expenses: expenses.filter { $0.type == "expense" }.compactMap(\.amount).reduce(0, +),
                net: expenses.reduce(0) { sum, item in
                    let amount = item.amount ?? 0
                    return sum + (item.type == "income" ? amount : -amount)
                },
                month: expenseSummary?.month,
                year: expenseSummary?.year
            )
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func createHomeTask(title: String,
                        category: String,
                        dueDate: String,
                        isRecurring: Bool) async -> Bool {
        do {
            let section = normalizedLifeSection(category)
            let task = try await LifeService.createHomeTask(
                title: title,
                description: category.isEmpty ? nil : category,
                dueDate: dueDate.isEmpty ? nil : dueDate,
                urgency: "medium",
                section: section,
                isRecurring: isRecurring,
                frequency: isRecurring ? "monthly" : nil
            )
            if section == "home" {
                homeTasks.insert(task, at: 0)
            }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func createGoal(title: String, tier: String) async -> Bool {
        do {
            let goal = try await LifeService.createGoal(
                title: title,
                goalType: tier,
                icon: "target"
            )
            goals.insert(goal, at: 0)
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    func toggleGoal(_ goal: APILifeGoal) async {
        let current = goal.is_completed ?? false
        do {
            let updated = try await LifeService.updateGoalCompleted(id: goal.id, isCompleted: !current)
            if let idx = goals.firstIndex(where: { $0.id == goal.id }) {
                goals[idx] = updated
            }
            lastError = nil
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func savedHelper(for helperId: String) -> APILifeSavedHelper? {
        savedHelpers.first { $0.helper_id == helperId }
    }

    @discardableResult
    func saveHelper(helperId: String) async -> Bool {
        do {
            let saved = try await LifeService.saveHelper(helperId: helperId)
            if !savedHelpers.contains(where: { $0.id == saved.id }) {
                savedHelpers.insert(saved, at: 0)
            }
            if let response = try? await LifeService.savedHelpers() {
                savedHelpers = response.saved_helpers
            }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func removeSavedHelper(_ saved: APILifeSavedHelper) async -> Bool {
        do {
            try await LifeService.removeSavedHelper(id: saved.id)
            savedHelpers.removeAll { $0.id == saved.id }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func createVehicle(clientId: String = UUID().uuidString,
                       vin: String,
                       year: String,
                       make: String,
                       model: String,
                       mileage: Int,
                       lastOilChangeMile: Int,
                       lastServiceDate: String,
                       notes: String = "") async -> APILifeVehicle? {
        do {
            let vehicle = try await LifeService.createVehicle(
                clientId: clientId,
                vin: vin,
                year: year,
                make: make,
                model: model,
                mileage: mileage,
                lastOilChangeMile: lastOilChangeMile,
                lastServiceDate: lastServiceDate,
                notes: notes
            )
            vehicles.insert(vehicle, at: 0)
            lastError = nil
            return vehicle
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }

    @discardableResult
    func updateVehicleMileage(_ vehicle: APILifeVehicle,
                              mileage: Int,
                              markOilChanged: Bool = false) async -> Bool {
        do {
            let updated = try await LifeService.updateVehicleMileage(
                id: vehicle.id,
                mileage: mileage,
                lastOilChangeMile: markOilChanged ? mileage : nil,
                lastServiceDate: markOilChanged ? Self.todayString() : nil
            )
            if let idx = vehicles.firstIndex(where: { $0.id == vehicle.id }) {
                vehicles[idx] = updated
            }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func deleteVehicle(_ vehicle: APILifeVehicle) async -> Bool {
        do {
            try await LifeService.deleteVehicle(id: vehicle.id)
            vehicles.removeAll { $0.id == vehicle.id }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func ensureHabitBacked(_ habit: Habit) async -> APILifeHabit? {
        if let match = habits.first(where: { $0.client_id == habit.id.uuidString || $0.name.caseInsensitiveCompare(habit.name) == .orderedSame }) {
            return match
        }
        do {
            let created = try await LifeService.createHabit(
                clientId: habit.id.uuidString,
                name: habit.name,
                icon: habit.icon,
                streak: habit.streak,
                completedToday: habit.completedToday,
                targetDaysPerWeek: habit.target
            )
            habits.insert(created, at: 0)
            lastError = nil
            return created
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }

    @discardableResult
    func toggleHabit(_ habit: APILifeHabit) async -> APILifeHabit? {
        let nextCompleted = !(habit.completed_today ?? false)
        let nextStreak = max(0, (habit.streak ?? 0) + (nextCompleted ? 1 : -1))
        return await setHabitState(habit, completedToday: nextCompleted, streak: nextStreak)
    }

    @discardableResult
    func setHabitState(_ habit: APILifeHabit,
                       completedToday: Bool,
                       streak: Int) async -> APILifeHabit? {
        do {
            let updated = try await LifeService.updateHabit(id: habit.id, completedToday: completedToday, streak: streak)
            if let idx = habits.firstIndex(where: { $0.id == habit.id }) {
                habits[idx] = updated
            }
            lastError = nil
            return updated
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }

    @discardableResult
    func createSinkingFund(name: String,
                           targetAmount: Double,
                           savedAmount: Double,
                           targetDate: String,
                           paycheckInterval: String) async -> Bool {
        do {
            let fund = try await LifeService.createSinkingFund(
                clientId: UUID().uuidString,
                name: name,
                targetAmount: targetAmount,
                savedAmount: savedAmount,
                targetDate: targetDate,
                paycheckInterval: paycheckInterval
            )
            sinkingFunds.insert(fund, at: 0)
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func depositToSinkingFund(_ fund: APILifeSinkingFund, amount: Double) async -> Bool {
        guard amount > 0 else { return false }
        do {
            let nextSaved = min(fund.target_amount ?? Double.greatestFiniteMagnitude,
                                (fund.saved_amount ?? 0) + amount)
            let updated = try await LifeService.updateSinkingFundSavedAmount(id: fund.id, savedAmount: nextSaved)
            if let idx = sinkingFunds.firstIndex(where: { $0.id == fund.id }) {
                sinkingFunds[idx] = updated
            }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func deleteSinkingFund(_ fund: APILifeSinkingFund) async -> Bool {
        do {
            try await LifeService.deleteSinkingFund(id: fund.id)
            sinkingFunds.removeAll { $0.id == fund.id }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    @discardableResult
    func deleteGoal(_ goal: APILifeGoal) async -> Bool {
        do {
            try await LifeService.deleteGoal(id: goal.id)
            goals.removeAll { $0.id == goal.id }
            lastError = nil
            return true
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    private func normalizedLifeSection(_ category: String) -> String {
        let value = category.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch value {
        case "personal", "personal care", "habit", "habits":
            return "personal_care"
        case "car", "vehicle", "car care", "auto":
            return "car_care"
        default:
            return "home"
        }
    }

    private static func todayString() -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }
}

// MARK: - LearnStore

@MainActor
final class LearnStore: ObservableObject {
    @Published var guides: [LearnGuide] = LearnGuideCatalog.all
    @Published var stats: APILearnStatsResponse?
    @Published var completions: Set<String> = []
    @Published var badges: [APILearnBadge] = []
    @Published var submissions: [APILearnSubmission] = []
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
                submissions = []
                return
            }

            async let c = LearnService.completions()
            async let b = LearnService.badges()
            async let s = LearnService.mySubmissions()
            let comp = try await c
            completions = Set(comp.completions.map(\.guide_id))
            badges = try await b.badges
            submissions = try await s.submissions
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

    func refreshSubmissions() async {
        guard KeychainManager.shared.getAccessToken() != nil else {
            submissions = []
            return
        }
        do {
            submissions = try await LearnService.mySubmissions().submissions
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
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
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
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
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
