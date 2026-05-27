import SwiftUI

// MARK: - OneStore
// Wires OxSteedOne's real API into review-nova. Falls back to seed data when
// unauthenticated or when the network returns an error.

@MainActor
final class OneStore: ObservableObject {

    // MARK: - App state
    @Published var activePersona: AppPersona = .customer
    @Published var selectedTab: AppTab = .home
    @Published var isDarkMode: Bool = false
    @Published var greetingName: String = "Alex"
    @Published var pendingSyncCount: Int = 0

    // MARK: - Auth state
    @Published var isAuthenticated: Bool = false
    @Published var isAuthenticating: Bool = false
    @Published var authStatusMessage: String?
    @Published var authEmail: String = ""
    @Published var authPassword: String = ""
    @Published var authAgreementName: String = ""
    @Published var authAcceptedTerms: Bool = false

    // MARK: - Live data (nil = use seed data below)
    @Published var liveProfile: OneUserProfileResponse?

    // MARK: - API
    private let api = OxSteedOneAPIClient()

    // MARK: - Init

    init() {
        // Restore persisted token
        let savedToken = OneSessionVault.loadToken()
        api.token = savedToken
        isAuthenticated = savedToken != nil

        if let savedToken {
            greetingName = "…"
            api.token = savedToken
            api.tokenProvider = { [weak self] in self?.api.token }
            api.refreshTokenHandler = { [weak self] in
                await self?.tryRefreshToken() ?? false
            }
            api.onUnauthorized = { [weak self] in
                Task { @MainActor [weak self] in self?.handleSessionExpiry() }
            }
            Task { await fetchMyProfile() }
        }

        if let ctx = OneSessionVault.loadPersonaContext() {
            activePersona = ctx.activePersona
        }
    }

    // MARK: - Login

    func login(email: String, password: String, agreementName: String, acceptedTerms: Bool) async {
        authStatusMessage = nil
        isAuthenticating = true
        defer { isAuthenticating = false }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalizedEmail.isEmpty, !password.isEmpty else {
            authStatusMessage = "Enter email and password."
            return
        }
        guard acceptedTerms else {
            authStatusMessage = "You must accept Terms to sign in."
            return
        }
        let cleanName = agreementName.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = cleanName.split(separator: " ").filter { !$0.isEmpty }
        guard cleanName.count >= 5, parts.count >= 2 else {
            authStatusMessage = "Enter your full legal name (first and last)."
            return
        }

        do {
            let body = OneLoginRequest(
                email: normalizedEmail,
                password: password,
                termsAgreed: acceptedTerms,
                agreementName: cleanName
            )
            let response: OneAuthResponse = try await api.post("/auth/login", body: body)
            guard let newToken = response.accessToken ?? response.token else {
                authStatusMessage = "No access token returned."
                return
            }
            applyToken(newToken, refresh: response.refreshToken, user: response.user)
            authEmail = normalizedEmail
            authPassword = ""
            authAgreementName = cleanName
            authAcceptedTerms = acceptedTerms
            await fetchMyProfile()
        } catch {
            authStatusMessage = OneErrorMapper.userMessage(for: error, fallback: "Sign in failed. Check your credentials.")
        }
    }

    // MARK: - Register

    func register(email: String, password: String, firstName: String, lastName: String, persona: AppPersona) async {
        authStatusMessage = nil
        isAuthenticating = true
        defer { isAuthenticating = false }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let cleanFirst = firstName.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanLast  = lastName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty, !password.isEmpty, !cleanFirst.isEmpty, !cleanLast.isEmpty else {
            authStatusMessage = "Fill all required fields."
            return
        }

        do {
            let body = OneRegisterRequest(
                email: normalizedEmail,
                password: password,
                firstName: cleanFirst,
                lastName: cleanLast,
                role: persona.rawValue
            )
            let response: OneAuthResponse = try await api.post("/auth/register", body: body)
            guard let newToken = response.accessToken ?? response.token else {
                authStatusMessage = "No access token returned."
                return
            }
            applyToken(newToken, refresh: response.refreshToken, user: response.user)
            activePersona = persona
            savePersonaContext()
            authEmail = normalizedEmail
            authPassword = ""
            await fetchMyProfile()
        } catch {
            authStatusMessage = OneErrorMapper.userMessage(for: error, fallback: "Account creation failed.")
        }
    }

    // MARK: - Logout

    func logout() {
        api.token = nil
        isAuthenticated = false
        liveProfile = nil
        greetingName = "Alex"
        authPassword = ""
        authAgreementName = ""
        authAcceptedTerms = false
        authStatusMessage = nil
        OneSessionVault.clearSession()
    }

    // MARK: - Profile fetch

    func fetchMyProfile() async {
        do {
            let profile: OneUserProfileResponse = try await api.get("/users/me")
            liveProfile = profile
            if let name = profile.firstName ?? profile.displayName, !name.isEmpty {
                greetingName = name
            }
            if let mode = profile.defaultMode,
               let persona = AppPersona(rawValue: mode) {
                activePersona = persona
                savePersonaContext()
            }
            isAuthenticated = true
        } catch {
            // If token exists but profile fails (network), keep authenticated state
            if api.token != nil { isAuthenticated = true }
            NSLog("[review-nova] fetchMyProfile error: %@", error.localizedDescription)
        }
    }

    // MARK: - Persona

    func selectPersona(_ persona: AppPersona) {
        activePersona = persona
        savePersonaContext()
    }

    // MARK: - Internals

    private func applyToken(_ token: String, refresh: String?, user: OneAuthUser?) {
        api.token = token
        api.tokenProvider = { [weak self] in self?.api.token }
        api.refreshTokenHandler = { [weak self] in await self?.tryRefreshToken() ?? false }
        api.onUnauthorized = { [weak self] in
            Task { @MainActor [weak self] in self?.handleSessionExpiry() }
        }
        OneSessionVault.saveToken(token)
        if let refresh { OneSessionVault.saveRefreshToken(refresh) }
        if let user {
            OneSessionVault.saveSession(OneSavedSession(token: token, user: user))
        }
        isAuthenticated = true
    }

    private func tryRefreshToken() async -> Bool {
        guard let refreshToken = OneSessionVault.loadRefreshToken(), !refreshToken.isEmpty else { return false }
        do {
            let body = OneRefreshRequest(refreshToken: refreshToken)
            let response: OneAuthResponse = try await api.post("/auth/refresh", body: body)
            guard let newToken = response.accessToken ?? response.token else { return false }
            api.token = newToken
            OneSessionVault.saveToken(newToken)
            if let newRefresh = response.refreshToken { OneSessionVault.saveRefreshToken(newRefresh) }
            return true
        } catch {
            return false
        }
    }

    private func handleSessionExpiry() {
        logout()
        authStatusMessage = "Session expired. Please sign in again."
    }

    private func savePersonaContext() {
        let ctx = PersonaContext(activePersona: activePersona)
        OneSessionVault.savePersonaContext(ctx)
    }

    // MARK: - Seed data (used when not authenticated or as loading placeholders)

    var pulse: [PulsePillar] {
        [
            .init(name: "Health",   score: 78, icon: "heart.fill",             tint: OneTheme.danger),
            .init(name: "Wealth",   score: 64, icon: "dollarsign.circle.fill",  tint: OneTheme.success),
            .init(name: "Skills",   score: 82, icon: "sparkles",               tint: OneTheme.sky),
            .init(name: "Network",  score: 55, icon: "person.2.fill",          tint: OneTheme.plum),
            .init(name: "Family",   score: 71, icon: "house.fill",             tint: OneTheme.ember),
            .init(name: "Purpose",  score: 68, icon: "flag.fill",              tint: OneTheme.accent)
        ]
    }

    func stats(for persona: AppPersona) -> [DashboardStat] {
        switch persona {
        case .customer:
            return [
                .init(label: "Active jobs",  value: "3",     delta: "+1 today",   icon: "list.bullet.clipboard.fill", tint: OneTheme.accent),
                .init(label: "Bids in",      value: "12",    delta: "+4 new",     icon: "tray.full.fill",             tint: OneTheme.sky),
                .init(label: "Saved",        value: "$248",  delta: "vs last mo", icon: "leaf.fill",                  tint: OneTheme.success)
            ]
        case .helper:
            return [
                .init(label: "Earned (wk)",  value: "$842",  delta: "+18%",       icon: "dollarsign.circle.fill",     tint: OneTheme.success),
                .init(label: "Booked",       value: "5",     delta: "this week",  icon: "calendar",                   tint: OneTheme.accent),
                .init(label: "Rating",       value: "4.9",   delta: "★ 142",      icon: "star.fill",                  tint: OneTheme.warning)
            ]
        case .businessOwner:
            return [
                .init(label: "Revenue (mo)", value: "$24.6K", delta: "+12%",      icon: "chart.bar.fill",             tint: OneTheme.success),
                .init(label: "Open orders",  value: "18",     delta: "3 urgent",  icon: "shippingbox.fill",           tint: OneTheme.ember),
                .init(label: "Team",         value: "7",      delta: "all clear", icon: "person.3.fill",              tint: OneTheme.plum)
            ]
        case .consultant:
            return [
                .init(label: "Clients",      value: "9",      delta: "+2",        icon: "person.crop.circle.badge.checkmark", tint: OneTheme.sky),
                .init(label: "Hours (wk)",   value: "22",     delta: "of 30",     icon: "clock.fill",                 tint: OneTheme.accent),
                .init(label: "Pipeline",     value: "$14K",   delta: "warm",      icon: "flame.fill",                 tint: OneTheme.ember)
            ]
        case .toolOwner:
            return [
                .init(label: "Tools out",    value: "4",      delta: "of 11",     icon: "wrench.and.screwdriver.fill", tint: OneTheme.ember),
                .init(label: "Rental (mo)",  value: "$1.2K",  delta: "+9%",       icon: "dollarsign.circle.fill",      tint: OneTheme.success),
                .init(label: "Returns due",  value: "2",      delta: "tomorrow",  icon: "arrow.uturn.left.circle.fill", tint: OneTheme.warning)
            ]
        case .franchiseOwner:
            return [
                .init(label: "Locations",    value: "6",      delta: "+1 soon",   icon: "mappin.and.ellipse",          tint: OneTheme.plum),
                .init(label: "MRR",          value: "$58K",   delta: "+7%",       icon: "chart.line.uptrend.xyaxis",   tint: OneTheme.success),
                .init(label: "NPS",          value: "62",     delta: "↑ 4",       icon: "hand.thumbsup.fill",          tint: OneTheme.accent)
            ]
        case .investor:
            return [
                .init(label: "Portfolio",    value: "$182K",  delta: "+3.4%",     icon: "chart.pie.fill",             tint: OneTheme.success),
                .init(label: "Backed",       value: "14",     delta: "deals",     icon: "checkmark.seal.fill",        tint: OneTheme.sky),
                .init(label: "Dry powder",   value: "$22K",   delta: "available", icon: "banknote.fill",              tint: OneTheme.accent)
            ]
        }
    }

    func urgency(for persona: AppPersona) -> [UrgencyItem] {
        switch persona {
        case .customer:
            return [
                .init(title: "Bathroom retile — approve bid",   subtitle: "Marco G. · $480", due: "Today",     icon: "checkmark.seal.fill",        tint: OneTheme.accent),
                .init(title: "Confirm Saturday cleaning",       subtitle: "Sun Shine Co.",   due: "Tomorrow",  icon: "sparkles",                    tint: OneTheme.sky),
                .init(title: "Rate your handyman",              subtitle: "Job #2241",       due: "2 days",    icon: "star.fill",                   tint: OneTheme.warning)
            ]
        case .helper:
            return [
                .init(title: "Job request: Move couch",         subtitle: "0.8 mi · $90",    due: "Reply now", icon: "shippingbox.fill",            tint: OneTheme.ember),
                .init(title: "Confirm 3pm appointment",         subtitle: "Lila R.",         due: "Today",     icon: "calendar.badge.clock",        tint: OneTheme.accent),
                .init(title: "Upload license photo",            subtitle: "Trust & Safety",  due: "This week", icon: "checkmark.shield.fill",       tint: OneTheme.success)
            ]
        case .businessOwner:
            return [
                .init(title: "Approve weekly payroll",          subtitle: "$4,820 · 7 people", due: "Today",   icon: "dollarsign.circle.fill",      tint: OneTheme.success),
                .init(title: "Restock: SKU 442",                subtitle: "Below threshold",  due: "Tomorrow", icon: "shippingbox.fill",            tint: OneTheme.ember),
                .init(title: "Respond to 3 reviews",            subtitle: "Avg 4.6 ★",        due: "This week", icon: "bubble.left.and.bubble.right.fill", tint: OneTheme.sky)
            ]
        default:
            return [
                .init(title: "Update your availability",        subtitle: "Calendar sync",   due: "Today",     icon: "calendar",                    tint: OneTheme.accent),
                .init(title: "Review pending request",          subtitle: "1 new",           due: "Tomorrow",  icon: "tray.full.fill",              tint: OneTheme.sky),
                .init(title: "Complete profile",                subtitle: "85% done",        due: "This week", icon: "person.crop.circle.badge.checkmark", tint: OneTheme.success)
            ]
        }
    }

    func activity(for persona: AppPersona) -> [ActivityEvent] {
        [
            .init(title: "New bid received",   detail: "Marco G. bid $480 on Bathroom retile", time: "12m",  icon: "hand.raised.fill",      tint: OneTheme.accent),
            .init(title: "Payment cleared",    detail: "$120 → your wallet",                    time: "1h",   icon: "checkmark.circle.fill",  tint: OneTheme.success),
            .init(title: "Message",            detail: "Sun Shine Co.: \"On our way!\"",        time: "3h",   icon: "bubble.left.fill",       tint: OneTheme.sky),
            .init(title: "Milestone",          detail: "Skills pillar reached 82",              time: "Yest", icon: "sparkles",               tint: OneTheme.plum)
        ]
    }

    func opportunities(for persona: AppPersona) -> [OpportunityCard] {
        [
            .init(title: "Ascend to Licensed Pro", subtitle: "Stipend + exam fee covered",      badge: "Growth", icon: "graduationcap.fill",  tint: OneTheme.plum),
            .init(title: "Wholesale group: paint", subtitle: "Save up to 32% with 8 neighbors", badge: "Save",   icon: "shippingbox.fill",    tint: OneTheme.ember),
            .init(title: "Small business grant",   subtitle: "Apply in under 5 min",            badge: "New",    icon: "gift.fill",           tint: OneTheme.accent)
        ]
    }
}
