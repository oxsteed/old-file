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
        isLoading = true; lastError = nil
        defer { isLoading = false }
        do {
            let resp = try await AuthService.login(email: email, password: password)
            persistTokens(resp)
            self.user = resp.user
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func register(email: String, password: String, firstName: String, lastName: String, phone: String?) async {
        isLoading = true; lastError = nil
        defer { isLoading = false }
        do {
            let resp = try await AuthService.register(email: email, password: password,
                                                      firstName: firstName, lastName: lastName,
                                                      phone: phone, language: nil)
            persistTokens(resp)
            self.user = resp.user
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func logout() async {
        await AuthService.logout()
        KeychainManager.shared.deleteAll()
        self.user = nil
    }

    func switchPersona(_ persona: Persona) async {
        let mode = serverMode(for: persona)
        do {
            self.user = try await AuthService.switchRole(mode)
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    var activePersona: Persona { user?.preferredPersona ?? .customer }

    // MARK: - Internal

    private func persistTokens(_ resp: AuthResponse) {
        KeychainManager.shared.saveAccessToken(resp.accessToken)
        KeychainManager.shared.saveRefreshToken(resp.refreshToken)
        KeychainManager.shared.saveExpiry(resp.expiresIn)
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
        do { availableJobs = try await JobsService.browse(sort: "newest") }
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

    func loadConversations() async {
        isLoading = true; defer { isLoading = false }
        do { conversations = try await MessagesService.conversations() }
        catch { lastError = (error as? APIError)?.errorDescription }
    }

    func loadMessages(_ conversationId: String) async {
        do { messagesByConversation[conversationId] = try await MessagesService.messages(in: conversationId) }
        catch { lastError = (error as? APIError)?.errorDescription }
    }

    func send(_ conversationId: String, content: String) async {
        do {
            let msg = try await MessagesService.send(conversationId, content: content)
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

    var unreadCount: Int { items.filter { !($0.is_read ?? false) }.count }

    func load() async {
        do { items = try await NotificationsService.list() }
        catch { NSLog("Notifications load failed: \(error)") }
    }

    func loadPreferences() async {
        do { preferences = try await NotificationsService.preferences() }
        catch { NSLog("Prefs load failed: \(error)") }
    }

    func markRead(_ id: String) async {
        try? await NotificationsService.markRead(id)
        if let idx = items.firstIndex(where: { $0.id == id }) {
            let n = items[idx]
            items[idx] = APINotification(id: n.id, type: n.type, title: n.title, message: n.message,
                                         is_read: true, created_at: n.created_at)
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
        catch { NSLog("Payments load failed: \(error)") }
    }

    func loadConnectStatus() async {
        do { connectStatus = try await PaymentsService.connectStatus() }
        catch { /* not yet connected is fine */ }
    }
}
