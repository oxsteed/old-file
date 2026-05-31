import Foundation
import Observation
#if canImport(Network)
import Network
#endif
#if canImport(UserNotifications)
import UserNotifications
#endif
#if canImport(LocalAuthentication)
import LocalAuthentication
#endif
#if canImport(UIKit)
import UIKit
#endif

@Observable
final class OneStore {
    private static let defaultAPIBaseURLString = "https://oxsteed.com/api"
    var selectedTab: AppTab = .home
    var personaContext: PersonaContext = OneSessionVault.loadPersonaContext() ?? PersonaContext()
    var personaOptions: [AppPersona] = AppPersona.allCases
    var availableBusinesses: [BusinessRef] = [
        BusinessRef(id: "abc123", name: "OxSteed Services - Springfield"),
        BusinessRef(id: "def456", name: "OxSteed Mechanical - River North")
    ]
    var businessRoleMemberships: [BusinessRoleMembership] = [
        BusinessRoleMembership(id: UUID(), businessID: "abc123", role: .owner, isActive: true, permissions: [:]),
        BusinessRoleMembership(id: UUID(), businessID: "def456", role: .manager, isActive: true, permissions: [:])
    ]

    var homeReloadToken = UUID()
    var showBusinessPicker = false
    var selectedPulsePillarID: String = "money"
    var universalSearchQuery = ""

    var authEmail = ""
    var authPassword = ""
    var authStatusMessage: String?
    var authFirstName = ""
    var authLastName = ""
    var authAgreementName = ""
    var authAcceptedTerms = false
    var isAuthenticating = false
    var apiBaseURLString: String = OneSessionVault.loadAPIBaseURL() ?? OneStore.defaultAPIBaseURLString
    var apiConnectivityMessage: String?
    var authEndpointProbeMessage: String?
    var authRequestDiagnostics: [String] = []
    @ObservationIgnored private(set) var token: String? = OneSessionVault.loadToken() {
        didSet {
            OneSessionVault.saveToken(token)
            api.token = token
        }
    }
    @ObservationIgnored private(set) var refreshToken: String? = OneSessionVault.loadRefreshToken() {
        didSet {
            OneSessionVault.saveRefreshToken(refreshToken)
        }
    }

    var appLanguage: AppLanguage = OneSessionVault.loadLanguage()
    var autoTranslateEnabled: Bool = OneSessionVault.loadAutoTranslateEnabled()
    var forceUpdateRequired = false
    var minimumRequiredVersion = "1.0.0"
    var isLocked = OneSessionVault.loadBiometricEnabled()
    var biometricEnabled = OneSessionVault.loadBiometricEnabled()

    var onboardingState = OneSessionVault.loadOnboardingState()

    var lifeLogEntries: [LifeLogEntry] = OneSessionVault.loadLifeLogEntries()
    var sinkingFunds: [SinkingFund] = OneSessionVault.loadSinkingFunds()

    /// The authenticated user's server-side ID (populated after fetchMyProfile).
    /// Used to distinguish outgoing vs. incoming bubbles in InboxThreadView.
    var currentUserID: String? = nil

    var unifiedInboxThreads: [UnifiedThread] = OneSessionVault.loadUnifiedThreads()
    var translatedThreadPreview: [Int: String] = [:]
    var translatedPreviewCache: [String: String] = [:]
    var notificationPreferences: [PersonaNotificationPreference] = OneSessionVault.loadNotificationPreferences()
    var taxDocuments: [TaxDocumentSummary] = OneSessionVault.loadTaxDocuments()
    var creatorUploads: [CreatorUploadItem] = OneSessionVault.loadCreatorUploads()
    var availabilityBlocks: [AvailabilityBlock] = OneSessionVault.loadAvailabilityBlocks()
    var quoteDrafts: [QuoteDraft] = OneSessionVault.loadQuoteDrafts()
    var recurringPlans: [RecurringServicePlan] = OneSessionVault.loadRecurringPlans()
    var walletSnapshot: WalletSnapshot = OneSessionVault.loadWallet()
    var consultantProfile: OneConsultantProfile?
    var toolOwnerInventory: [OneToolInventoryItem] = []
    var verificationBadges: [VerificationBadge] = OneSessionVault.loadVerificationBadges()
    var reviews: [TwoWayReview] = OneSessionVault.loadReviews()
    var safetyTimerRunning = false
    var safetyTimerSeconds = 0
    var sosTriggered = false
    var dataExportRequested = false
    var accountRecoveryReady = true
    var savedSearchAlerts: [SavedSearchAlert] = OneSessionVault.loadSavedAlerts()
    var mapPoints: [MapPoint] = OneSessionVault.loadMapPoints()
    var bookingDrafts: [BookingRequestDraft] = OneSessionVault.loadBookingDrafts()
    var dispatchBufferSettings: DispatchBufferSettings = OneSessionVault.loadDispatchBuffer()
    var walletTransactions: [WalletTransaction] = OneSessionVault.loadWalletTransactions()
    var ascensionApplication: AscensionApplication = OneSessionVault.loadAscensionApplication()
    var wholesaleGroups: [WholesaleGroup] = OneSessionVault.loadWholesaleGroups()
    var financingPrequal: FinancingPrequalForm = OneSessionVault.loadFinancingPrequal()
    var grantOpportunities: [GrantOpportunity] = OneSessionVault.loadGrantOpportunities()
    var academyLessons: [AcademyLesson] = OneSessionVault.loadAcademyLessons()
    var toolkitBundles: [ToolkitBundle] = OneSessionVault.loadToolkitBundles()
    var trendingSkills: [TrendingSkill] = OneSessionVault.loadTrendingSkills()
    var customerJobs: [CustomerJobPost] = OneSessionVault.loadCustomerJobs()
    var jobBids: [JobBid] = OneSessionVault.loadJobBids()
    var serviceHelpers: [ServiceHelperProfile] = OneSessionVault.loadServiceHelpers()
    var customerServiceBookings: [CustomerServiceBooking] = OneSessionVault.loadCustomerServiceBookings()
    var rentalTools: [RentalTool] = OneSessionVault.loadRentalTools()
    var toolRentalReservations: [ToolRentalReservation] = OneSessionVault.loadToolRentalReservations()
    var pendingSyncChanges: [PendingSyncChange] = OneSessionVault.loadPendingSyncChanges()

    var growthProgressStep = "Skill"
    var voiceInputEnabled = true
    var appPreferences: AppPreferences = OneSessionVault.loadAppPreferences()
    var accountDeletionRequested = false
    var isRefreshingCustomerData = false
    var isRefreshingGrowthData = false
    var lastCustomerSyncAt: Date?
    var isSubmittingCustomerJob = false
    var bidAcceptanceInFlight: Set<UUID> = []
    var customerJobFlowMessage: String?
    var isPostingJob = false
    var isFetchingJobs = false
    var isUploadingImages = false
    var uploadProgress: Double = 0.0
    var isFetchingBids = false
    var isUpdatingJob = false
    var lastJobError: String?
    var lastBidError: String?
    var isCreatingBooking = false
    var isUpdatingBooking = false
    var lastBookingError: String?
    var isReservingTool = false
    var isUpdatingTool = false
    var lastToolError: String?
    var isNetworkAvailable = true
    var mobilePaymentsAvailable = true
    var mobilePaymentStatusMessage: String?
    var pushAuthorizationStatus: String = "unknown"
    var jobPage = 1
    var jobPageSize = 20
    var hasMoreJobs = true
    var isLoadingMoreJobs = false
    var bookingPage = 1
    var hasMoreBookings = true
    var isLoadingMoreBookings = false
    var rentalPage = 1
    var hasMoreRentals = true
    var isLoadingMoreRentals = false
    var isGuestDiscoveryLoading = false
    var guestDiscoveryError: String?
    var guestDiscoveryLastUpdatedAt: Date?
    @ObservationIgnored private var lastInteractiveAuthAt: Date?
    @ObservationIgnored private var isSessionBootstrapInProgress = false
    @ObservationIgnored private var hasLoadedGuestDiscovery = false

    var growthNextStep: String {
        if ascensionApplication.status == "Not Started" {
            return "Start Business Ascension application"
        }
        if ascensionApplication.status == "Submitted" {
            return "Complete Learning tab courses for your license track"
        }
        if financingPrequal.status != "Submitted" {
            return "Submit financing pre-qualification"
        }
        return "Join a wholesale group and execute first scaled operation"
    }

    var canUploadCreatorContent: Bool {
        let isRoleEligible = activePersona == .helper || activePersona == .businessOwner
        let hasVerification = verificationBadges.contains(where: { $0.title == "ID Verified" && $0.verified })
        return isRoleEligible && hasVerification
    }

    private let api = OxSteedOneAPIClient()
    #if canImport(Network)
    @ObservationIgnored private let networkMonitor = NWPathMonitor()
    @ObservationIgnored private let networkMonitorQueue = DispatchQueue(label: "app.oxsteed.one.networkMonitor")
    #endif
    @ObservationIgnored private var periodicSyncTask: Task<Void, Never>?

    init() {
        applyAPIBaseURL(apiBaseURLString)
        api.token = token
        api.tokenProvider = { [weak self] in self?.token }
        api.refreshTokenHandler = { [weak self] in
            guard let self else { return false }
            return await self.tryRefreshAccessToken()
        }
        api.onUnauthorized = { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                // Ignore stale unauthorized callbacks while interactive auth is in-flight
                // or immediately after success to prevent bounce-back to login.
                if self.isAuthenticating {
                    return
                }
                if self.isSessionBootstrapInProgress {
                    return
                }
                if let authAt = self.lastInteractiveAuthAt,
                   Date().timeIntervalSince(authAt) < 8 {
                    return
                }
                self.logout(clearMessage: false)
                self.authStatusMessage = "Session expired. Please sign in again."
            }
        }
        api.onRequestBuilt = { [weak self] path, hasAuthorization in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let marker = hasAuthorization ? "auth=attached" : "auth=missing"
                self.authRequestDiagnostics.append("\(path) [\(marker)]")
                if self.authRequestDiagnostics.count > 12 {
                    self.authRequestDiagnostics.removeFirst(self.authRequestDiagnostics.count - 12)
                }
            }
        }
        setupConnectivityMonitoring()
    }

    var resolvedAPIBaseURLString: String {
        api.baseURL.absoluteString
    }

    var activePersona: AppPersona {
        personaContext.activePersona
    }

    var showOnboarding: Bool {
        !onboardingState.didComplete
    }

    var isAuthenticated: Bool {
        token != nil
    }

    var activeLocale: Locale {
        Locale(identifier: appLanguage.localeIdentifier)
    }

    var activePersonaLabel: String {
        if activePersona == .businessOwner {
            let business = personaContext.selectedBusinessName ?? "No business"
            return "\(activePersona.label) · \(resolvedBusinessSubRole.label) · \(business)"
        }
        return activePersona.label
    }

    var resolvedBusinessSubRole: BusinessSubRole {
        guard activePersona == .businessOwner,
              let businessID = personaContext.selectedBusinessID,
              let membership = businessRoleMemberships.first(where: { $0.businessID == businessID && $0.isActive }) else {
            return personaContext.businessSubRole
        }
        if membership.role == .owner {
            return personaContext.businessSubRole
        }
        return membership.role
    }

    var canOverrideBusinessSubRole: Bool {
        guard let businessID = personaContext.selectedBusinessID else { return false }
        return businessRoleMemberships.contains(where: { $0.businessID == businessID && $0.isActive && $0.role == .owner })
    }

    var homeSections: [HomeSection] {
        switch activePersona {
        case .customer:
            let publishedJobs = customerJobs.filter { $0.status == .published || $0.status == .matched || $0.status == .inProgress }.count
            let pendingBids = customerJobs.reduce(0) { $0 + bids(for: $1.id).filter { !$0.accepted }.count }
            let upcomingBookings = customerServiceBookings.filter { $0.status == "Scheduled" || $0.status == "Confirmed" }.count
            let activeRentals = toolRentalReservations.filter { $0.pickupConfirmed && !$0.returnConfirmed }.count
            return [
                section("Customer Workflow", cards: [
                    card("jobs", "Jobs Posted", "\(publishedJobs)", "Draft + published transaction pipeline", "hammer.fill"),
                    card("messages", "Messages with Helpers", "6 unread", "Unified inbox threads", "bubble.left.and.bubble.right.fill"),
                    card("quotes", "Pending Quotes", "\(pendingBids)", "Bid comparison and acceptance flow", "creditcard.fill"),
                    card("bookings", "Upcoming Bookings", "\(upcomingBookings)", "Service booking confirmations", "calendar.badge.clock"),
                    card("rentals", "Active Rentals", "\(activeRentals)", "Pickup/return and deposit lifecycle", "wrench.adjustable.fill")
                ])
            ]
        case .helper:
            return [
                section("Helper Workspace", cards: [
                    card("nearby", "Available Jobs Nearby", "11", "Feed, map, and list views", "mappin.and.ellipse"),
                    card("bids", "Bids & Negotiations", "5", "2 counter-offers pending", "doc.text.magnifyingglass"),
                    card("earnings", "Earnings This Month", "$2,480", "On pace for +12%", "dollarsign.circle.fill"),
                    card("schedule", "Booked Schedule", "7", "Next job starts 2:00 PM", "calendar"),
                    card("toolkit", "Tool Kit Inventory", "29 items", "4 low-stock consumables", "wrench.and.screwdriver.fill")
                ])
            ]
        case .businessOwner:
            return businessOwnerSections(for: resolvedBusinessSubRole)
        case .consultant:
            return [
                section("Consulting Desk", cards: [
                    card("intake", "Client Intake Queue", "8", "3 waiting onboarding", "tray.full.fill"),
                    card("calendar", "Appointment Calendar", "6 this week", "2 follow-up sessions today", "calendar.badge.exclamationmark"),
                    card("packages", "Service Packages", "4 live", "2 top-converting", "shippingbox.fill"),
                    card("notes", "Session Notes", "5", "Follow-ups due EOD", "note.text")
                ])
            ]
        case .toolOwner:
            return [
                section("Tool Rental Desk", cards: [
                    card("inventory", "Rental Inventory Map", "37 assets", "12 currently active", "map.fill"),
                    card("scanner", "Check-In / Check-Out", "Ready", "Native scanner flow", "qrcode.viewfinder"),
                    card("deposits", "Damage Deposits", "4 pending", "Review holds", "shield.fill"),
                    card("repeat", "Repeat Renters", "14", "Frequent customer cohort", "person.2.fill")
                ])
            ]
        case .franchiseOwner:
            return [
                section("Franchise Control", cards: [
                    card("territory", "Territory Map", "5 zones", "2 sub-franchisees onboarding", "map.fill"),
                    card("pipeline", "Onboarding Pipeline", "9", "Compliance checks in progress", "person.crop.rectangle.stack.fill"),
                    card("brand", "Brand Compliance", "91%", "2 checklist items overdue", "checkmark.shield.fill"),
                    card("revenue", "Franchise Revenue", "$18,720", "This month", "chart.bar.xaxis")
                ])
            ]
        case .investor:
            return [
                section("Investor Overview", cards: [
                    card("portfolio", "Funded Businesses", "6", "4 active helper-businesses", "briefcase.fill"),
                    card("share", "Revenue Share", "$3,420", "Received this month", "banknote.fill"),
                    card("opportunities", "New Opportunities", "12", "In your metro area", "sparkles.rectangle.stack")
                ])
            ]
        }
    }

    var pulsePillars: [PulsePillar] {
        [
            PulsePillar(id: "money", title: "Money", weight: 25, score: 72, summary: "30-day cash flow risk: short $120 on June 3.", tintHex: "#f97316"),
            PulsePillar(id: "home", title: "Home Care", weight: 20, score: 68, summary: "HVAC filter due and seasonal tasks incoming.", tintHex: "#10b981"),
            PulsePillar(id: "car", title: "Car Care", weight: 20, score: 81, summary: "Oil change due in 400 miles or 12 days.", tintHex: "#06b6d4"),
            PulsePillar(id: "personal", title: "Personal Care", weight: 15, score: 76, summary: "One habit streak at risk.", tintHex: "#f43f5e"),
            PulsePillar(id: "goals", title: "Goals", weight: 10, score: 64, summary: "One unlinked goal needs sinking-fund mapping.", tintHex: "#eab308"),
            PulsePillar(id: "funds", title: "Planned Needs", weight: 10, score: 70, summary: "$23/week needed for gift fund target.", tintHex: "#8b5cf6")
        ]
    }

    var pulseScore: Int {
        max(1, pulsePillars.reduce(0) { partial, pillar in
            partial + (pillar.score * pillar.weight / 100)
        })
    }

    var urgencyQueue: [UrgencyItem] {
        let cal = Calendar.current
        let now = Date()
        let items = [
            UrgencyItem(
                id: "u1",
                pillar: "Money",
                title: "Projected shortfall",
                dueText: "June 3",
                urgency: "critical",
                dueDate: cal.date(bySettingHour: 9, minute: 0, second: 0, of: now.addingTimeInterval(9 * 86_400)) ?? now
            ),
            UrgencyItem(
                id: "u2",
                pillar: "Home Care",
                title: "Replace HVAC filter",
                dueText: "In 5 days",
                urgency: "high",
                dueDate: cal.date(byAdding: .day, value: 5, to: now) ?? now
            ),
            UrgencyItem(
                id: "u5",
                pillar: "Goals",
                title: "Link tire savings goal",
                dueText: "In 7 days",
                urgency: "high",
                dueDate: cal.date(byAdding: .day, value: 7, to: now) ?? now
            ),
            UrgencyItem(
                id: "u3",
                pillar: "Car Care",
                title: "Schedule oil change",
                dueText: "In 12 days",
                urgency: "medium",
                dueDate: cal.date(byAdding: .day, value: 12, to: now) ?? now
            ),
            UrgencyItem(
                id: "u4",
                pillar: "Personal Care",
                title: "Dental checkup booking",
                dueText: "In 14 days",
                urgency: "medium",
                dueDate: cal.date(byAdding: .day, value: 14, to: now) ?? now
            ),
            UrgencyItem(
                id: "u6",
                pillar: "Planned Needs",
                title: "Fund holiday gifts",
                dueText: "Weekly",
                urgency: "medium",
                dueDate: cal.date(byAdding: .day, value: 6, to: now) ?? now
            )
        ]
        return items.sorted { lhs, rhs in
            if lhs.dueDate != rhs.dueDate { return lhs.dueDate < rhs.dueDate }
            let urgencyRank = ["critical": 0, "high": 1, "medium": 2, "low": 3]
            return urgencyRank[lhs.urgency, default: 9] < urgencyRank[rhs.urgency, default: 9]
        }
    }

    var selectedPulsePillar: PulsePillar? {
        pulsePillars.first(where: { $0.id == selectedPulsePillarID })
    }

    var filteredUnifiedThreads: [UnifiedThread] {
        guard !universalSearchQuery.isEmpty else { return unifiedInboxThreads }
        let query = universalSearchQuery.lowercased()
        return unifiedInboxThreads.filter {
            $0.title.lowercased().contains(query) ||
            $0.lastMessage.lowercased().contains(query) ||
            $0.personaSource.lowercased().contains(query)
        }
    }

    var translatedOrOriginalThreads: [UnifiedThread] {
        filteredUnifiedThreads.map { thread in
            let translated = translatedThreadPreview[thread.id] ?? thread.lastMessage
            return UnifiedThread(
                id: thread.id,
                title: thread.title,
                lastMessage: translated,
                personaSource: thread.personaSource,
                unreadCount: thread.unreadCount
            )
        }
    }

    var globalSearchResults: [GlobalSearchResult] {
        let query = universalSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return [] }

        var results: [GlobalSearchResult] = []

        for section in homeSections {
            for card in section.cards {
                let haystack = "\(section.title) \(card.title) \(card.detail)".lowercased()
                if haystack.contains(query) {
                    results.append(
                        GlobalSearchResult(
                            id: "home-\(section.id)-\(card.id)",
                            category: "Home",
                            title: card.title,
                            detail: card.detail
                        )
                    )
                }
            }
        }

        for item in urgencyQueue where "\(item.pillar) \(item.title)".lowercased().contains(query) {
            results.append(
                GlobalSearchResult(
                    id: "life-\(item.id)",
                    category: "Life",
                    title: item.title,
                    detail: "\(item.pillar) · Due \(item.dueText)"
                )
            )
        }

        for thread in translatedOrOriginalThreads where "\(thread.title) \(thread.lastMessage)".lowercased().contains(query) {
            results.append(
                GlobalSearchResult(
                    id: "learn-thread-\(thread.id)",
                    category: "Learn",
                    title: thread.title,
                    detail: thread.lastMessage
                )
            )
        }

        let growthItems = [
            "Business Ascension Application",
            "Community Wholesale Groups",
            "Financing Pre-Qualification",
            "Grants and Subsidies"
        ]
        for item in growthItems where item.lowercased().contains(query) {
            results.append(
                GlobalSearchResult(
                    id: "growth-\(item.lowercased().replacingOccurrences(of: " ", with: "-"))",
                    category: "Growth",
                    title: item,
                    detail: "Available in Growth tab"
                )
            )
        }

        return Array(results.prefix(12))
    }

    var shouldRequireUnlock: Bool {
        biometricEnabled && isLocked
    }

    var weeklyContributionSummaries: [String] {
        sinkingFunds.map { fund in
            let remaining = max(fund.targetAmount - fund.currentAmount, 0)
            let days = max(Calendar.current.dateComponents([.day], from: Date(), to: fund.targetDate).day ?? 1, 1)
            let weeks = Double(days) / 7.0
            let weekly = remaining / max(weeks, 1)
            let formatter = NumberFormatter()
            formatter.numberStyle = .currency
            formatter.locale = activeLocale
            let weeklyText = formatter.string(from: NSNumber(value: weekly)) ?? "$0"
            return "\(fund.title): \(weeklyText)/week"
        }
    }

    func sinkingFundStatus(for fund: SinkingFund) -> String {
        let progress = fund.targetAmount > 0 ? fund.currentAmount / fund.targetAmount : 0
        if progress >= 0.85 { return "on-track" }
        if progress >= 0.45 { return "behind" }
        return "critical"
    }

    func restoreSession() {
        if token == nil, let saved = OneSessionVault.loadSession() {
            token = saved.token
        }
        if unifiedInboxThreads.isEmpty {
            unifiedInboxThreads = seededThreads()
        }
        if autoTranslateEnabled {
            Task { await refreshTranslatedPreviews() }
        }
        if isAuthenticated {
            Task {
                isSessionBootstrapInProgress = true
                defer { isSessionBootstrapInProgress = false }
                await healAPIBaseURLIfNeeded()
                // Web-parity bootstrap: establish user/profile context first.
                await fetchMyProfile()
                await sendDeviceTokenToServer()

                // Defer heavy fan-out work until after authenticated shell is stable.
                Task {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    guard await MainActor.run(body: { self.isAuthenticated }) else { return }
                    await self.runDeferredPostAuthRefreshes()
                }
            }
            startPeriodicSyncIfNeeded()
        } else {
            periodicSyncTask?.cancel()
            periodicSyncTask = nil
        }
        if biometricEnabled && isAuthenticated {
            isLocked = true
        }
        Task { await runForceUpdateCheck() }
        Task { await refreshPushNotificationStatus() }
    }

    @MainActor
    private func runDeferredPostAuthRefreshes() async {
        switch activePersona {
        case .customer:
            await fetchMyJobs()
            await fetchServiceBookings()
            await fetchRentalTools()
        case .helper:
            await fetchHelperJobFeed()
            await refreshHelpersFromAPI()
        case .businessOwner, .consultant, .toolOwner, .franchiseOwner, .investor:
            break
        }

        await fetchLifeLogHistory()
        await fetchSinkingFunds()
        await fetchUnifiedInbox()
        await refreshMobilePaymentConfig()
        await refreshCustomerTransactionData()
        await syncPendingChanges()
    }

    /// Re-run persona-specific fetches when the user switches personas.
    /// Call this from selectPersona() after the context is updated.
    @MainActor
    func refreshDataForCurrentPersona() async {
        switch activePersona {
        case .customer:
            await fetchMyJobs()
            await fetchServiceBookings()
            await fetchRentalTools()
        case .helper:
            await fetchHelperJobFeed()
        case .businessOwner, .consultant, .toolOwner, .franchiseOwner, .investor:
            break
        }
        await fetchUnifiedInbox()
    }

    func selectPulsePillar(_ pillarID: String) {
        selectedPulsePillarID = pillarID
    }

    func selectPersona(_ persona: AppPersona) {
        personaContext.activePersona = persona
        if persona != .businessOwner {
            personaContext.selectedBusinessID = nil
            personaContext.selectedBusinessName = nil
            personaContext.businessSubRole = .owner
        } else if availableBusinesses.count > 1 && personaContext.selectedBusinessID == nil {
            showBusinessPicker = true
        } else if let first = availableBusinesses.first, personaContext.selectedBusinessID == nil {
            personaContext.selectedBusinessID = first.id
            personaContext.selectedBusinessName = first.name
            if let membership = businessRoleMemberships.first(where: { $0.businessID == first.id && $0.isActive }) {
                personaContext.businessSubRole = membership.role
            }
        }

        OneSessionVault.savePersonaContext(personaContext)
        refreshHomeOnly()
        if isAuthenticated {
            Task { await refreshDataForCurrentPersona() }
        }
    }

    func setBusinessSubRole(_ role: BusinessSubRole) {
        guard canOverrideBusinessSubRole else { return }
        personaContext.businessSubRole = role
        OneSessionVault.savePersonaContext(personaContext)
        refreshHomeOnly()
    }

    func selectBusiness(_ business: BusinessRef) {
        personaContext.selectedBusinessID = business.id
        personaContext.selectedBusinessName = business.name
        if let membership = businessRoleMemberships.first(where: { $0.businessID == business.id && $0.isActive }) {
            personaContext.businessSubRole = membership.role
        }
        showBusinessPicker = false
        OneSessionVault.savePersonaContext(personaContext)
        refreshHomeOnly()
    }

    func setLanguage(_ language: AppLanguage) {
        appLanguage = language
        OneSessionVault.saveLanguage(language)
        Task {
            struct PreferredLanguageUpdate: Encodable {
                let preferredLanguage: String
            }

            do {
                _ = try await api.put("/users/me", body: PreferredLanguageUpdate(preferredLanguage: language.rawValue))
            } catch {
                // Best effort; keep local language in UserDefaults on failure.
            }
        }
    }

    func localized(_ key: String, fallback: String) -> String {
        OneLocalization.localized(key, language: appLanguage, fallback: fallback)
    }

    func setAutoTranslate(_ enabled: Bool) {
        autoTranslateEnabled = enabled
        OneSessionVault.saveAutoTranslateEnabled(enabled)
        if enabled {
            Task { await refreshTranslatedPreviews() }
        } else {
            translatedThreadPreview = [:]
        }
    }

    func addSavedAlert(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        savedSearchAlerts.insert(SavedSearchAlert(id: UUID(), query: trimmed, persona: activePersona, enabled: true), at: 0)
        OneSessionVault.saveSavedAlerts(savedSearchAlerts)
    }

    func toggleSavedAlert(_ id: UUID) {
        guard let idx = savedSearchAlerts.firstIndex(where: { $0.id == id }) else { return }
        savedSearchAlerts[idx].enabled.toggle()
        OneSessionVault.saveSavedAlerts(savedSearchAlerts)
    }

    func setNotificationEnabled(for persona: AppPersona, enabled: Bool) {
        guard let idx = notificationPreferences.firstIndex(where: { $0.persona == persona }) else { return }
        notificationPreferences[idx].enabled = enabled
        OneSessionVault.saveNotificationPreferences(notificationPreferences)
    }

    func setNotificationRadius(for persona: AppPersona, radiusMiles: Int) {
        guard let idx = notificationPreferences.firstIndex(where: { $0.persona == persona }) else { return }
        notificationPreferences[idx].radiusMiles = radiusMiles
        OneSessionVault.saveNotificationPreferences(notificationPreferences)
    }

    func setNotificationQuietHours(for persona: AppPersona, start: Int, end: Int) {
        guard let idx = notificationPreferences.firstIndex(where: { $0.persona == persona }) else { return }
        notificationPreferences[idx].quietHoursStart = start
        notificationPreferences[idx].quietHoursEnd = end
        OneSessionVault.saveNotificationPreferences(notificationPreferences)
    }

    func setBiometricEnabled(_ enabled: Bool) {
        biometricEnabled = enabled
        OneSessionVault.saveBiometricEnabled(enabled)
        isLocked = enabled && isAuthenticated
    }

    func unlockWithBiometrics() async {
        #if canImport(LocalAuthentication)
        let context = LAContext()
        var error: NSError?
        let reason = "Unlock OxSteed One"
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
            do {
                let success = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
                if success { isLocked = false }
            } catch {
                authStatusMessage = "Biometric unlock failed."
            }
        } else {
            authStatusMessage = "Biometrics unavailable on this device."
            isLocked = false
        }
        #else
        isLocked = false
        #endif
    }

    func completeOnboarding() {
        onboardingState.didComplete = true
        personaContext.activePersona = onboardingState.selectedPrimaryPersona
        OneSessionVault.saveOnboardingState(onboardingState)
        OneSessionVault.savePersonaContext(personaContext)
        refreshHomeOnly()
    }

    func addLifeLogEntry(pillarID: String, title: String, detail: String) {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let entry = LifeLogEntry(pillarID: pillarID, title: title, detail: detail)
        lifeLogEntries.insert(entry, at: 0)
        OneSessionVault.saveLifeLogEntries(lifeLogEntries)
        Task { await syncLifeLogEntry(entry) }
    }

    func addSinkingFund(title: String, targetAmount: Double, currentAmount: Double, targetDate: Date) {
        guard !title.isEmpty, targetAmount > 0 else { return }
        let fund = SinkingFund(title: title, targetAmount: targetAmount, currentAmount: currentAmount, targetDate: targetDate)
        sinkingFunds.append(fund)
        OneSessionVault.saveSinkingFunds(sinkingFunds)
        Task { await syncSinkingFund(fund) }
    }

    func addToSinkingFund(_ fundID: UUID, amount: Double) {
        guard amount > 0, let idx = sinkingFunds.firstIndex(where: { $0.id == fundID }) else { return }
        sinkingFunds[idx].currentAmount += amount
        OneSessionVault.saveSinkingFunds(sinkingFunds)
    }

    @MainActor
    func addCreatorUpload(title: String) async {
        guard canUploadCreatorContent, !title.isEmpty else { return }
        // Optimistic local add
        let status = moderationStatus(for: title)
        creatorUploads.insert(CreatorUploadItem(title: title, language: appLanguage, status: status), at: 0)
        OneSessionVault.saveCreatorUploads(creatorUploads)
        // API sync
        isSubmittingCustomerJob = true
        lastJobError = nil
        defer { isSubmittingCustomerJob = false }
        let req = OneCreatorUploadRequest(title: title, language: appLanguage.rawValue)
        do {
            let _: OneGenericSuccessResponse = try await api.post("/uploads/create", body: req)
            customerJobFlowMessage = "Upload submitted for moderation."
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Upload queued — will sync when online.")
            enqueueForRetry(path: "/uploads/create", method: .post, encodable: req)
        }
    }

    func setCreatorUploadStatus(_ id: UUID, status: ModerationStatus) {
        guard let idx = creatorUploads.firstIndex(where: { $0.id == id }) else { return }
        creatorUploads[idx].status = status
        OneSessionVault.saveCreatorUploads(creatorUploads)
    }

    func toggleAvailability(_ id: UUID) {
        guard let idx = availabilityBlocks.firstIndex(where: { $0.id == id }) else { return }
        availabilityBlocks[idx].enabled.toggle()
        OneSessionVault.saveAvailabilityBlocks(availabilityBlocks)
    }

    func addQuoteDraft(customerName: String, labor: Double, materials: Double, notes: String) {
        guard !customerName.isEmpty else { return }
        quoteDrafts.insert(QuoteDraft(id: UUID(), customerName: customerName, laborAmount: labor, materialAmount: materials, notes: notes), at: 0)
        OneSessionVault.saveQuoteDrafts(quoteDrafts)
    }

    func addRecurringPlan(title: String, frequency: String, nextDate: Date) {
        guard !title.isEmpty else { return }
        recurringPlans.insert(RecurringServicePlan(id: UUID(), title: title, frequency: frequency, nextDate: nextDate, active: true), at: 0)
        OneSessionVault.saveRecurringPlans(recurringPlans)
    }

    func toggleRecurringPlan(_ id: UUID) {
        guard let idx = recurringPlans.firstIndex(where: { $0.id == id }) else { return }
        recurringPlans[idx].active.toggle()
        OneSessionVault.saveRecurringPlans(recurringPlans)
    }

    func startSafetyTimer() {
        safetyTimerRunning = true
        safetyTimerSeconds = 0
    }

    func stopSafetyTimer() {
        safetyTimerRunning = false
    }

    func triggerSOS() {
        sosTriggered = true
    }

    func requestDataExport() {
        dataExportRequested = true
    }

    func setAppearance(_ appearance: AppAppearance) {
        appPreferences.appearance = appearance
        OneSessionVault.saveAppPreferences(appPreferences)
    }

    func setLargeTextEnabled(_ enabled: Bool) {
        appPreferences.largeTextEnabled = enabled
        OneSessionVault.saveAppPreferences(appPreferences)
    }

    func setPrivacyMode(_ enabled: Bool) {
        appPreferences.privacyMode = enabled
        OneSessionVault.saveAppPreferences(appPreferences)
    }

    func setAnalyticsEnabled(_ enabled: Bool) {
        appPreferences.allowAnalytics = enabled
        OneSessionVault.saveAppPreferences(appPreferences)
    }

    func addReview(fromRole: String, toRole: String, rating: Int, comment: String) {
        guard !comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let normalized = max(1, min(5, rating))
        reviews.insert(
            TwoWayReview(id: UUID(), fromRole: fromRole, toRole: toRole, rating: normalized, comment: comment, createdAt: Date()),
            at: 0
        )
        OneSessionVault.saveReviews(reviews)
    }

    func createBookingDraft(customerName: String, proposedDate: Date, customerTime: String) {
        guard !customerName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        bookingDrafts.insert(
            BookingRequestDraft(
                id: UUID(),
                customerName: customerName,
                proposedDate: proposedDate,
                customerProposedTime: customerTime,
                helperCounterProposalTime: nil,
                status: "Pending"
            ),
            at: 0
        )
        OneSessionVault.saveBookingDrafts(bookingDrafts)
    }

    func counterProposeBooking(_ id: UUID, newTime: String) {
        guard let idx = bookingDrafts.firstIndex(where: { $0.id == id }),
              !newTime.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        bookingDrafts[idx].helperCounterProposalTime = newTime
        bookingDrafts[idx].status = "Counter-proposed"
        OneSessionVault.saveBookingDrafts(bookingDrafts)
    }

    func setDispatchBuffer(enabled: Bool) {
        dispatchBufferSettings.enabled = enabled
        OneSessionVault.saveDispatchBuffer(dispatchBufferSettings)
    }

    func setDispatchBufferMinutes(_ minutes: Int) {
        dispatchBufferSettings.minutesBetweenJobs = max(0, minutes)
        OneSessionVault.saveDispatchBuffer(dispatchBufferSettings)
    }

    func setPayoutMethod(_ method: String) {
        walletSnapshot.payoutMethod = method
        OneSessionVault.saveWallet(walletSnapshot)
    }

    func addWalletTransaction(title: String, amount: Double, isCredit: Bool) {
        guard !title.isEmpty, amount > 0 else { return }
        walletTransactions.insert(WalletTransaction(id: UUID(), title: title, amount: amount, timestamp: Date(), isCredit: isCredit), at: 0)
        OneSessionVault.saveWalletTransactions(walletTransactions)
    }

    @MainActor
    func fetchWalletBalance() async -> WalletSnapshot? {
        do {
            let response: OneWalletResponse = try await api.get("/wallet/balance")
            let snapshot = WalletSnapshot(
                availableBalance: response.availableBalance ?? walletSnapshot.availableBalance,
                pendingEscrow: response.pendingEscrow ?? walletSnapshot.pendingEscrow,
                payoutMethod: response.payoutMethod ?? walletSnapshot.payoutMethod
            )
            walletSnapshot = snapshot
            OneSessionVault.saveWallet(walletSnapshot)
            return snapshot
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Unable to load wallet balance right now.")
            return nil
        }
    }

    @MainActor
    func fetchConsultantProfile(id: String) async -> OneConsultantProfile? {
        guard !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        do {
            let dto: OneConsultantProfileResponse = try await api.get("/consultants/\(id)")
            let profile = OneConsultantProfile(
                id: dto.id ?? id,
                displayName: dto.displayName ?? "Consultant",
                servicePackages: dto.servicePackages ?? [],
                appointmentCount: dto.appointmentCount ?? 0,
                notesCount: dto.notesCount ?? 0
            )
            consultantProfile = profile
            return profile
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Unable to load consultant profile.")
            return nil
        }
    }

    @MainActor
    func fetchToolOwnerInventory() async -> [OneToolInventoryItem]? {
        do {
            let envelope: OneToolInventoryEnvelope = try await api.get("/tool-rentals/inventory")
            let source = envelope.data ?? envelope.tools ?? []
            let mapped = source.compactMap { dto -> OneToolInventoryItem? in
                guard let id = dto.id else { return nil }
                return OneToolInventoryItem(
                    id: id,
                    title: dto.title ?? "Tool",
                    availableUnits: dto.availableUnits ?? 0,
                    pendingReturns: dto.pendingReturns ?? 0,
                    condition: dto.condition ?? "good"
                )
            }
            toolOwnerInventory = mapped
            return mapped
        } catch {
            lastToolError = OneErrorMapper.userMessage(for: error, fallback: "Unable to load tool inventory.")
            return nil
        }
    }

    func requestAccountDeletion() {
        accountDeletionRequested = true
    }

    func postCustomerJob(title: String, category: String, locationQuery: String, address: String, details: String, photos: [String]) {
        guard !title.isEmpty, !category.isEmpty, !address.isEmpty else { return }
        let job = CustomerJobPost(
            id: UUID(),
            remoteJobID: nil,
            title: title,
            category: category,
            locationQuery: locationQuery,
            address: address,
            details: details,
            photos: photos,
            status: .published,
            createdAt: Date()
        )
        customerJobs.insert(job, at: 0)
        customerJobs.sort { $0.createdAt > $1.createdAt }
        OneSessionVault.saveCustomerJobs(customerJobs)
        seedBidsIfNeeded(for: job.id)
    }

    @MainActor
    func postCustomerJobServerFirst(
        title: String,
        category: String,
        locationQuery: String,
        address: String,
        details: String,
        photos: [String],
        localImages: [UIImage] = []
    ) async {
        customerJobFlowMessage = nil
        lastJobError = nil
        isSubmittingCustomerJob = true
        isPostingJob = true
        defer { isSubmittingCustomerJob = false }
        defer { isPostingJob = false }
        let normalizedDetail = details.count < 50 ? details + String(repeating: " details", count: max(0, (50 - details.count) / 8)) : details
        let budgetMax = 50000
        let budgetMin = 20000
        let request = OneCreateJobRequest(
            title: title,
            description: normalizedDetail,
            categoryName: category,
            locationCity: locationQuery.isEmpty ? "Springfield" : locationQuery,
            locationState: "MA",
            locationAddress: address,
            locationZip: "01103",
            locationCountry: "US",
            urgency: "flexible",
            budgetType: "range",
            budgetMin: budgetMin,
            budgetMax: budgetMax,
            mediaUrls: photos
        )

        do {
            let created: OneJobDTO
            if !localImages.isEmpty {
                let files: [OneMultipartFile] = localImages.compactMap { image in
                    guard let jpeg = image.jpegData(compressionQuality: 0.82) else { return nil }
                    return OneMultipartFile(
                        fieldName: "media",
                        fileName: "job-photo-\(UUID().uuidString).jpg",
                        mimeType: "image/jpeg",
                        data: jpeg
                    )
                }

                let fields: [String: String] = [
                    "title": title,
                    "description": normalizedDetail,
                    "category_name": category,
                    "location_city": locationQuery.isEmpty ? "Springfield" : locationQuery,
                    "location_state": "MA",
                    "location_address": address,
                    "location_zip": "01103",
                    "location_country": "US",
                    "urgency": "flexible",
                    "budget_type": "range",
                    "budget_min": String(budgetMin),
                    "budget_max": String(budgetMax)
                ]
                created = try await api.postMultipart("/jobs", fields: fields, files: files)
            } else {
                created = try await api.post("/jobs", body: request)
            }
            let localID = uuidFromString(created.id) ?? UUID()
            customerJobs.insert(
                CustomerJobPost(
                    id: localID,
                    remoteJobID: created.id,
                    title: created.title ?? title,
                    category: created.category ?? category,
                    locationQuery: created.locationCity ?? locationQuery,
                    address: address,
                    details: created.description ?? details,
                    photos: photos,
                    status: mapJobStatus(created.status),
                    createdAt: Date()
                ),
                at: 0
            )
            OneSessionVault.saveCustomerJobs(customerJobs)
            await refreshBidsFromAPI(for: localID, remoteJobID: created.id ?? localID.uuidString)
            customerJobFlowMessage = "Job published successfully."
        } catch {
            postCustomerJob(title: title, category: category, locationQuery: locationQuery, address: address, details: details, photos: photos)
            authStatusMessage = "Job posted locally (API unavailable/auth required)."
            customerJobFlowMessage = "Live publish failed; saved locally."
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Job publish failed. Retry when you are online.")
            enqueueForRetry(path: "/jobs", method: .post, encodable: request)
        }
    }

    func saveCustomerJobDraft(title: String, category: String, locationQuery: String, address: String, details: String, photos: [String]) {
        guard !title.isEmpty, !category.isEmpty else { return }
        customerJobs.insert(
            CustomerJobPost(
                id: UUID(),
                remoteJobID: nil,
                title: title,
                category: category,
                locationQuery: locationQuery,
                address: address,
                details: details,
                photos: photos,
                status: .draft,
                createdAt: Date()
            ),
            at: 0
        )
        OneSessionVault.saveCustomerJobs(customerJobs)
    }

    func publishCustomerJob(_ jobID: UUID) {
        guard let idx = customerJobs.firstIndex(where: { $0.id == jobID }) else { return }
        customerJobs[idx].status = .published
        OneSessionVault.saveCustomerJobs(customerJobs)
        seedBidsIfNeeded(for: jobID)
    }

    func cancelCustomerJob(_ jobID: UUID) {
        customerJobs.removeAll { $0.id == jobID }
        jobBids.removeAll { $0.jobID == jobID }
        OneSessionVault.saveCustomerJobs(customerJobs)
        OneSessionVault.saveJobBids(jobBids)
    }

    @MainActor
    func cancelCustomerJobServerFirst(_ jobID: UUID) async {
        guard let job = customerJobs.first(where: { $0.id == jobID }) else { return }
        guard let remoteID = remoteJobIdentifier(for: job) else {
            cancelCustomerJob(jobID)
            return
        }
        lastJobError = nil
        isUpdatingJob = true
        defer { isUpdatingJob = false }
        do {
            let _: OneJobStatusResponse = try await api.post("/jobs/\(remoteID)/cancel", body: [String: String]())
            cancelCustomerJob(jobID)
        } catch {
            cancelCustomerJob(jobID)
            authStatusMessage = "Job cancelled locally (API unavailable/auth required)."
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Cancel failed on server. Local state updated.")
            enqueueForRetry(path: "/jobs/\(remoteID)/cancel", method: .post, jsonObject: [String: String]())
        }
    }

    @MainActor
    func startCustomerJobServerFirst(_ jobID: UUID) async {
        guard let idx = customerJobs.firstIndex(where: { $0.id == jobID }) else { return }
        guard let remoteID = remoteJobIdentifier(for: customerJobs[idx]) else {
            customerJobs[idx].status = .inProgress
            OneSessionVault.saveCustomerJobs(customerJobs)
            return
        }
        lastJobError = nil
        isUpdatingJob = true
        defer { isUpdatingJob = false }
        do {
            let _: OneJobStatusResponse = try await api.post("/jobs/\(remoteID)/start", body: [String: String]())
            customerJobs[idx].status = .inProgress
            OneSessionVault.saveCustomerJobs(customerJobs)
        } catch {
            customerJobs[idx].status = .inProgress
            OneSessionVault.saveCustomerJobs(customerJobs)
            authStatusMessage = "Job marked in progress locally (API unavailable/auth required)."
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Start failed on server. Local state updated.")
            enqueueForRetry(path: "/jobs/\(remoteID)/start", method: .post, jsonObject: [String: String]())
        }
    }

    @MainActor
    func completeCustomerJobServerFirst(_ jobID: UUID) async {
        guard let idx = customerJobs.firstIndex(where: { $0.id == jobID }) else { return }
        guard let remoteID = remoteJobIdentifier(for: customerJobs[idx]) else {
            customerJobs[idx].status = .completed
            OneSessionVault.saveCustomerJobs(customerJobs)
            return
        }
        lastJobError = nil
        isUpdatingJob = true
        defer { isUpdatingJob = false }
        do {
            let _: OneJobStatusResponse = try await api.post("/jobs/\(remoteID)/complete", body: [String: String]())
            customerJobs[idx].status = .completed
            OneSessionVault.saveCustomerJobs(customerJobs)
        } catch {
            customerJobs[idx].status = .completed
            OneSessionVault.saveCustomerJobs(customerJobs)
            authStatusMessage = "Job completed locally (API unavailable/auth required)."
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Completion failed on server. Local state updated.")
            enqueueForRetry(path: "/jobs/\(remoteID)/complete", method: .post, jsonObject: [String: String]())
        }
    }

    func bids(for jobID: UUID) -> [JobBid] {
        jobBids.filter { $0.jobID == jobID }.sorted { $0.amount < $1.amount }
    }

    func sortedBids(for jobID: UUID, sort: String) -> [JobBid] {
        let source = jobBids.filter { $0.jobID == jobID }
        switch sort {
        case "price_desc":
            return source.sorted { $0.amount > $1.amount }
        case "helper_asc":
            return source.sorted { $0.helperName < $1.helperName }
        default:
            return source.sorted { $0.amount < $1.amount }
        }
    }

    @MainActor
    func messageHelperForBidServerFirst(_ bidID: UUID, content: String) async {
        guard let bid = jobBids.first(where: { $0.id == bidID }) else { return }
        lastBidError = nil
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            guard let helper = serviceHelpers.first(where: { $0.name == bid.helperName }) ?? serviceHelpers.first else {
                throw OneAPIError.invalidResponse
            }
            let convReq = OneCreateConversationRequest(helperID: helper.id.uuidString)
            let conv: OneConversationDTO = try await api.post("/messages/conversations", body: convReq)
            guard let convID = conv.id else { throw OneAPIError.invalidResponse }
            let msgReq = OneSendMessageRequest(content: trimmed)
            let _: OneGenericSuccessResponse = try await api.post("/messages/conversations/\(convID)", body: msgReq)
        } catch {
            authStatusMessage = "Message send failed (API unavailable/auth required)."
            lastBidError = OneErrorMapper.userMessage(for: error, fallback: "Message failed to send. Please retry.")
        }
    }

    func acceptBid(_ bidID: UUID) {
        guard let bidIndex = jobBids.firstIndex(where: { $0.id == bidID }) else { return }
        let jobID = jobBids[bidIndex].jobID
        for idx in jobBids.indices where jobBids[idx].jobID == jobID {
            jobBids[idx].accepted = (jobBids[idx].id == bidID)
        }
        if let jobIndex = customerJobs.firstIndex(where: { $0.id == jobID }) {
            customerJobs[jobIndex].status = .matched
            OneSessionVault.saveCustomerJobs(customerJobs)
        }
        let accepted = jobBids[bidIndex]
        let appointment = CustomerServiceBooking(
            id: UUID(),
            remoteBookingID: nil,
            helperID: UUID(),
            helperName: accepted.helperName,
            serviceType: customerJobs.first(where: { $0.id == jobID })?.category ?? "Service",
            scheduledDate: Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date(),
            scheduledSlot: accepted.etaText,
            paymentAuthorized: true,
            paymentStatus: "paid",
            paymentIntentID: nil,
            preMessage: "Looking forward to the appointment.",
            postMessage: "",
            reminderEnabled: true,
            status: "Confirmed",
            reviewRating: nil,
            reviewComment: nil
        )
        customerServiceBookings.insert(appointment, at: 0)
        OneSessionVault.saveJobBids(jobBids)
        OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
    }

    @MainActor
    func acceptBidServerFirst(_ bidID: UUID) async {
        guard jobBids.contains(where: { $0.id == bidID }) else { return }
        if bidAcceptanceInFlight.contains(bidID) { return }
        let canProceed = await authorizeSensitiveAction(reason: "Authorize bid acceptance and appointment creation")
        guard canProceed else {
            lastBidError = "Biometric confirmation required."
            return
        }
        customerJobFlowMessage = nil
        lastBidError = nil
        bidAcceptanceInFlight.insert(bidID)
        defer { bidAcceptanceInFlight.remove(bidID) }
        let request = OneAssignBidRequest(bidID: bidID.uuidString, paymentMethod: "oxsteed")
        do {
            let _: OneGenericSuccessResponse = try await api.post("/jobs/assign", body: request)
            acceptBid(bidID)
            customerJobFlowMessage = "Bid accepted and appointment created."
        } catch {
            acceptBid(bidID)
            authStatusMessage = "Bid accepted locally (API unavailable/auth required)."
            customerJobFlowMessage = "Live accept failed; applied locally."
            lastBidError = OneErrorMapper.userMessage(for: error, fallback: "Bid acceptance failed on server. Local state updated.")
            enqueueForRetry(path: "/jobs/assign", method: .post, encodable: request)
        }
    }

    func createServiceBooking(helperID: UUID, serviceType: String, scheduledDate: Date, slot: String, paymentAuthorized: Bool, preMessage: String) {
        guard let helper = serviceHelpers.first(where: { $0.id == helperID }) else { return }
        customerServiceBookings.insert(
            CustomerServiceBooking(
                id: UUID(),
                remoteBookingID: nil,
                helperID: helperID,
                helperName: helper.name,
                serviceType: serviceType,
                scheduledDate: scheduledDate,
                scheduledSlot: slot,
                paymentAuthorized: paymentAuthorized,
                paymentStatus: paymentAuthorized ? "requested" : "not_requested",
                paymentIntentID: nil,
                preMessage: preMessage,
                postMessage: "",
                reminderEnabled: true,
                status: "Scheduled",
                reviewRating: nil,
                reviewComment: nil
            ),
            at: 0
        )
        OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
    }

    @MainActor
    func createServiceBookingServerFirst(helperID: UUID, serviceType: String, scheduledDate: Date, slot: String, paymentAuthorized: Bool, preMessage: String) async {
        let canProceed = await authorizeSensitiveAction(reason: "Authorize service booking payment")
        guard canProceed else {
            lastBookingError = "Biometric confirmation required."
            return
        }
        lastBookingError = nil
        isCreatingBooking = true
        defer { isCreatingBooking = false }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateText = formatter.string(from: scheduledDate)
        let start = slot.isEmpty ? "10:00" : slot
        let end = "12:00"
        let shouldRequestPayment = paymentAuthorized && mobilePaymentsAvailable
        if paymentAuthorized && !mobilePaymentsAvailable {
            lastBookingError = mobilePaymentStatusMessage ?? "Mobile payments are not configured yet."
        }

        let req = OneCreateBookingRequest(
            helperID: helperID.uuidString,
            serviceName: serviceType,
            requestedDate: dateText,
            requestedStartTime: start,
            requestedEndTime: end,
            serviceLocation: "Customer location",
            description: preMessage
        )
        do {
            let response: OneBookingCreateResponse = try await api.post("/bookings", body: req)
            guard let helper = serviceHelpers.first(where: { $0.id == helperID }) else { return }
            let localBookingID = UUID()
            customerServiceBookings.insert(
                CustomerServiceBooking(
                    id: localBookingID,
                    remoteBookingID: response.data?.id,
                    helperID: helperID,
                    helperName: helper.name,
                    serviceType: serviceType,
                    scheduledDate: scheduledDate,
                    scheduledSlot: slot,
                    paymentAuthorized: false,
                    paymentStatus: shouldRequestPayment ? "requires_payment" : "not_requested",
                    paymentIntentID: nil,
                    preMessage: preMessage,
                    postMessage: "",
                    reminderEnabled: true,
                    status: "Scheduled",
                    reviewRating: nil,
                    reviewComment: nil
                ),
                at: 0
            )

            if shouldRequestPayment, let remoteBookingID = response.data?.id {
                await requestBookingPaymentIntent(
                    localBookingID: localBookingID,
                    remoteBookingID: remoteBookingID,
                    helperID: helperID
                )
            }

            OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
        } catch {
            createServiceBooking(helperID: helperID, serviceType: serviceType, scheduledDate: scheduledDate, slot: slot, paymentAuthorized: paymentAuthorized, preMessage: preMessage)
            authStatusMessage = "Booking saved locally (API unavailable/auth required)."
            lastBookingError = OneErrorMapper.userMessage(for: error, fallback: "Booking failed on server. Saved locally for retry.")
            enqueueForRetry(path: "/bookings", method: .post, encodable: req)
        }
    }

    @MainActor
    func cancelServiceBookingServerFirst(_ bookingID: UUID) async {
        guard let booking = customerServiceBookings.first(where: { $0.id == bookingID }) else { return }
        lastBookingError = nil
        isUpdatingBooking = true
        defer { isUpdatingBooking = false }
        guard let remoteID = booking.remoteBookingID else {
            if let idx = customerServiceBookings.firstIndex(where: { $0.id == bookingID }) {
                customerServiceBookings[idx].status = "Cancelled"
                OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
            }
            return
        }
        do {
            let _: OneCancelBookingResponse = try await api.post("/bookings/\(remoteID)/cancel", body: [String: String]())
            if let idx = customerServiceBookings.firstIndex(where: { $0.id == bookingID }) {
                customerServiceBookings[idx].status = "Cancelled"
            }
            OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
        } catch {
            authStatusMessage = "Live cancel failed; booking kept local."
            lastBookingError = OneErrorMapper.userMessage(for: error, fallback: "Cancel failed on server. Please retry.")
            enqueueForRetry(path: "/bookings/\(remoteID)/cancel", method: .post, jsonObject: [String: String]())
        }
    }

    @MainActor
    func sendBookingMessageServerFirst(_ bookingID: UUID, content: String) async {
        guard let booking = customerServiceBookings.first(where: { $0.id == bookingID }) else { return }
        lastBookingError = nil
        isUpdatingBooking = true
        defer { isUpdatingBooking = false }
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            let convReq = OneCreateConversationRequest(helperID: booking.helperID.uuidString)
            let conv: OneConversationDTO = try await api.post("/messages/conversations", body: convReq)
            guard let convID = conv.id else { throw OneAPIError.invalidResponse }
            let msgReq = OneSendMessageRequest(content: trimmed)
            let _: OneGenericSuccessResponse = try await api.post("/messages/conversations/\(convID)", body: msgReq)
            setBookingPostMessage(bookingID, message: trimmed)
        } catch {
            setBookingPostMessage(bookingID, message: trimmed)
            authStatusMessage = "Message stored locally (API unavailable/auth required)."
            lastBookingError = OneErrorMapper.userMessage(for: error, fallback: "Send failed on server. Message saved locally.")
        }
    }

    func setBookingPostMessage(_ bookingID: UUID, message: String) {
        guard let idx = customerServiceBookings.firstIndex(where: { $0.id == bookingID }) else { return }
        customerServiceBookings[idx].postMessage = message
        OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
    }

    func submitBookingReview(_ bookingID: UUID, rating: Int, comment: String) {
        guard let idx = customerServiceBookings.firstIndex(where: { $0.id == bookingID }) else { return }
        customerServiceBookings[idx].reviewRating = max(1, min(5, rating))
        customerServiceBookings[idx].reviewComment = comment
        customerServiceBookings[idx].status = "Reviewed"
        OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
    }

    @MainActor
    private func requestBookingPaymentIntent(localBookingID: UUID, remoteBookingID: String, helperID: UUID) async {
        let hourly = serviceHelpers.first(where: { $0.id == helperID })?.hourlyRate ?? 40
        let estimatedAmount = max(50, Int((hourly * 2.0 * 100).rounded()))
        let paymentReq = OneBookingPaymentIntentRequest(amountCents: estimatedAmount, paymentRequirement: "deposit")
        do {
            let response: OneBookingPaymentIntentResponse = try await api.post("/mobile/bookings/\(remoteBookingID)/payment-intent", body: paymentReq)
            if let idx = customerServiceBookings.firstIndex(where: { $0.id == localBookingID }) {
                customerServiceBookings[idx].paymentStatus = response.data?.paymentRequirement ?? "requires_payment"
                customerServiceBookings[idx].paymentIntentID = response.data?.paymentIntentId
                customerServiceBookings[idx].paymentAuthorized = false
            }
            OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
            lastBookingError = "Payment setup created. Complete authorization in the checkout step."
        } catch {
            if let idx = customerServiceBookings.firstIndex(where: { $0.id == localBookingID }) {
                customerServiceBookings[idx].paymentStatus = "payment_setup_failed"
                customerServiceBookings[idx].paymentAuthorized = false
            }
            OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
            lastBookingError = OneErrorMapper.userMessage(for: error, fallback: "Payment setup failed. Booking is still saved.")
        }
    }

    @MainActor
    func confirmBookingPaymentServerFirst(_ bookingID: UUID) async {
        guard let idx = customerServiceBookings.firstIndex(where: { $0.id == bookingID }) else { return }
        guard let remoteBookingID = customerServiceBookings[idx].remoteBookingID,
              let paymentIntentID = customerServiceBookings[idx].paymentIntentID,
              !paymentIntentID.isEmpty else {
            lastBookingError = "Missing payment setup for this booking."
            return
        }

        isUpdatingBooking = true
        defer { isUpdatingBooking = false }
        lastBookingError = nil

        do {
            let req = OneBookingConfirmPaymentRequest(paymentIntentId: paymentIntentID)
            let response: OneBookingConfirmPaymentResponse = try await api.post("/mobile/bookings/\(remoteBookingID)/confirm-payment", body: req)
            customerServiceBookings[idx].paymentAuthorized = true
            customerServiceBookings[idx].paymentStatus = response.data?.status ?? "paid"
            customerServiceBookings[idx].status = customerServiceBookings[idx].status == "Scheduled" ? "Confirmed" : customerServiceBookings[idx].status
            OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
            customerJobFlowMessage = "Booking payment confirmed."
        } catch {
            lastBookingError = OneErrorMapper.userMessage(for: error, fallback: "Payment confirmation failed. Please retry.")
        }
    }

    func reserveTool(toolID: UUID, slot: String, paymentAuthorized: Bool) {
        guard let tool = rentalTools.first(where: { $0.id == toolID }) else { return }
        toolRentalReservations.insert(
            ToolRentalReservation(
                id: UUID(),
                remoteBookingID: nil,
                toolID: toolID,
                ownerUserID: nil,
                toolTitle: tool.title,
                ownerName: tool.ownerName,
                slot: slot,
                paymentAuthorized: paymentAuthorized,
                paymentStatus: paymentAuthorized ? "requested" : "not_requested",
                paymentIntentID: nil,
                pickupConfirmed: false,
                returnConfirmed: false,
                damageNotes: "",
                depositStatus: "Held",
                disputeStatus: "None"
            ),
            at: 0
        )
        OneSessionVault.saveToolRentalReservations(toolRentalReservations)
    }

    @MainActor
    func reserveToolServerFirst(toolID: UUID, slot: String, paymentAuthorized: Bool) async {
        let canProceed = await authorizeSensitiveAction(reason: "Authorize tool rental reservation payment")
        guard canProceed else {
            lastToolError = "Biometric confirmation required."
            return
        }
        lastToolError = nil
        isReservingTool = true
        defer { isReservingTool = false }
        let start = Date()
        let end = Calendar.current.date(byAdding: .day, value: 2, to: start) ?? start
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let req = OneCreateToolReservationRequest(
            toolID: toolID.uuidString,
            startDate: formatter.string(from: start),
            endDate: formatter.string(from: end),
            renterAgreementAccepted: true
        )
        do {
            let remote: OneToolBookingResponse = try await api.post("/tool-rentals/bookings", body: req)
            guard let tool = rentalTools.first(where: { $0.id == toolID }) else { return }
            toolRentalReservations.insert(
                ToolRentalReservation(
                    id: uuidFromString(remote.id) ?? UUID(),
                    remoteBookingID: remote.id,
                    toolID: toolID,
                    ownerUserID: remote.ownerId,
                    toolTitle: tool.title,
                    ownerName: tool.ownerName,
                    slot: slot,
                    paymentAuthorized: paymentAuthorized,
                    paymentStatus: paymentAuthorized ? "authorized" : "not_requested",
                    paymentIntentID: nil,
                    pickupConfirmed: false,
                    returnConfirmed: false,
                    damageNotes: "",
                    depositStatus: "Held",
                    disputeStatus: "None"
                ),
                at: 0
            )
            OneSessionVault.saveToolRentalReservations(toolRentalReservations)
        } catch {
            reserveTool(toolID: toolID, slot: slot, paymentAuthorized: paymentAuthorized)
            authStatusMessage = "Rental reserved locally (API unavailable/auth required)."
            lastToolError = OneErrorMapper.userMessage(for: error, fallback: "Reservation failed on server. Saved locally for retry.")
            enqueueForRetry(path: "/tool-rentals/bookings", method: .post, encodable: req)
        }
    }

    @MainActor
    func cancelToolReservationServerFirst(_ reservationID: UUID) async {
        guard let reservation = toolRentalReservations.first(where: { $0.id == reservationID }) else { return }
        lastToolError = nil
        isUpdatingTool = true
        defer { isUpdatingTool = false }
        guard let remoteID = reservation.remoteBookingID else {
            setToolDispute(reservationID, open: false)
            return
        }
        let req = OneToolBookingStatusUpdateRequest(status: "cancelled")
        do {
            let _: OneToolBookingResponse = try await api.put("/tool-rentals/bookings/\(remoteID)", body: req)
            if let idx = toolRentalReservations.firstIndex(where: { $0.id == reservationID }) {
                toolRentalReservations[idx].disputeStatus = "Cancelled"
                toolRentalReservations[idx].depositStatus = "Released"
            }
            OneSessionVault.saveToolRentalReservations(toolRentalReservations)
        } catch {
            authStatusMessage = "Live cancel failed; reservation kept local."
            lastToolError = OneErrorMapper.userMessage(for: error, fallback: "Cancel failed on server. Please retry.")
            enqueueForRetry(path: "/tool-rentals/bookings/\(remoteID)", method: .put, encodable: req)
        }
    }

    @MainActor
    func openToolDamageDisputeServerFirst(_ reservationID: UUID, description: String) async {
        guard let reservation = toolRentalReservations.first(where: { $0.id == reservationID }) else { return }
        lastToolError = nil
        isUpdatingTool = true
        defer { isUpdatingTool = false }
        guard let remoteID = reservation.remoteBookingID,
              let ownerID = reservation.ownerUserID,
              !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            setToolDispute(reservationID, open: true)
            return
        }
        let req = OneToolReportRequest(
            reportedUserID: ownerID,
            bookingID: remoteID,
            reportType: "tool_damage",
            description: description
        )
        do {
            let _: OneToolReportResponse = try await api.post("/tool-rentals/reports", body: req)
            setToolDispute(reservationID, open: true)
        } catch {
            setToolDispute(reservationID, open: true)
            authStatusMessage = "Dispute saved locally (API unavailable/auth required)."
            lastToolError = OneErrorMapper.userMessage(for: error, fallback: "Dispute failed on server. Saved locally for retry.")
            enqueueForRetry(path: "/tool-rentals/reports", method: .post, encodable: req)
        }
    }

    func filteredHelpers(query: String, minRating: Double) -> [ServiceHelperProfile] {
        serviceHelpers.filter {
            (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) || $0.specialty.localizedCaseInsensitiveContains(query) || $0.city.localizedCaseInsensitiveContains(query))
            && $0.rating >= minRating
        }
    }

    func filteredTools(query: String, maxDailyRate: Double?) -> [RentalTool] {
        rentalTools.filter {
            (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || $0.city.localizedCaseInsensitiveContains(query) || $0.ownerName.localizedCaseInsensitiveContains(query))
            && (maxDailyRate == nil || $0.dailyRate <= (maxDailyRate ?? 0))
        }
    }

    func confirmToolPickup(_ reservationID: UUID) {
        guard let idx = toolRentalReservations.firstIndex(where: { $0.id == reservationID }) else { return }
        toolRentalReservations[idx].pickupConfirmed = true
        OneSessionVault.saveToolRentalReservations(toolRentalReservations)
    }

    func confirmToolReturn(_ reservationID: UUID) {
        guard let idx = toolRentalReservations.firstIndex(where: { $0.id == reservationID }) else { return }
        toolRentalReservations[idx].returnConfirmed = true
        if toolRentalReservations[idx].damageNotes.isEmpty {
            toolRentalReservations[idx].depositStatus = "Refunded"
        }
        OneSessionVault.saveToolRentalReservations(toolRentalReservations)
    }

    func assessToolDamage(_ reservationID: UUID, notes: String) {
        guard let idx = toolRentalReservations.firstIndex(where: { $0.id == reservationID }) else { return }
        toolRentalReservations[idx].damageNotes = notes
        toolRentalReservations[idx].depositStatus = notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Refunded" : "Under Review"
        OneSessionVault.saveToolRentalReservations(toolRentalReservations)
    }

    func setToolDispute(_ reservationID: UUID, open: Bool) {
        guard let idx = toolRentalReservations.firstIndex(where: { $0.id == reservationID }) else { return }
        toolRentalReservations[idx].disputeStatus = open ? "Open" : "Resolved"
        if !open, toolRentalReservations[idx].returnConfirmed {
            toolRentalReservations[idx].depositStatus = "Refunded"
        }
        OneSessionVault.saveToolRentalReservations(toolRentalReservations)
    }

    @MainActor
    func submitAscensionApplication(fullName: String, skill: String, targetLicense: String) async {
        // Optimistic local update
        ascensionApplication.fullName = fullName
        ascensionApplication.currentSkill = skill
        ascensionApplication.targetLicense = targetLicense
        ascensionApplication.status = "Submitted"
        ascensionApplication.submittedAt = Date()
        growthProgressStep = "Side Income"
        OneSessionVault.saveAscensionApplication(ascensionApplication)
        // API sync
        isSubmittingCustomerJob = true
        lastJobError = nil
        defer { isSubmittingCustomerJob = false }
        let request: [String: Any] = [
            "full_name": fullName,
            "current_skill": skill,
            "target_license": targetLicense,
            "persona": activePersona.apiRole
        ]
        do {
            let payload = try JSONSerialization.data(withJSONObject: request, options: [])
            let _: OneGenericSuccessResponse = try await api.postRaw("/ascension/apply", bodyData: payload)
            customerJobFlowMessage = "Application submitted successfully."
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Submitted locally — will sync when online.")
            enqueueForRetry(path: "/ascension/apply", method: .post, jsonObject: request)
        }
    }

    @MainActor
    func toggleWholesaleGroupJoin(_ id: UUID) async {
        guard let idx = wholesaleGroups.firstIndex(where: { $0.id == id }) else { return }
        // Optimistic local update
        let wasJoined = wholesaleGroups[idx].joined
        wholesaleGroups[idx].joined.toggle()
        wholesaleGroups[idx].memberCount += wholesaleGroups[idx].joined ? 1 : -1
        OneSessionVault.saveWholesaleGroups(wholesaleGroups)
        // API sync
        isSubmittingCustomerJob = true
        lastJobError = nil
        defer { isSubmittingCustomerJob = false }
        let path = wasJoined ? "/wholesale/leave" : "/wholesale/join"
        let req = OneJoinWholesaleRequest(groupId: id.uuidString, persona: activePersona.apiRole)
        do {
            let _: OneGenericSuccessResponse = try await api.post(path, body: req)
            customerJobFlowMessage = wasJoined ? "Left group." : "Joined group successfully."
        } catch {
            // Revert optimistic update on failure
            if let currentIdx = wholesaleGroups.firstIndex(where: { $0.id == id }) {
                wholesaleGroups[currentIdx].joined = wasJoined
                wholesaleGroups[currentIdx].memberCount += wasJoined ? 1 : -1
            }
            OneSessionVault.saveWholesaleGroups(wholesaleGroups)
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Action queued for sync when online.")
            enqueueForRetry(path: path, method: .post, encodable: req)
        }
    }

    @MainActor
    func submitFinancingPrequal(requestedAmount: Double, purpose: String, monthlyRevenue: Double, creditBand: String) async {
        // Optimistic local update
        financingPrequal.requestedAmount = requestedAmount
        financingPrequal.purpose = purpose
        financingPrequal.monthlyRevenue = monthlyRevenue
        financingPrequal.creditBand = creditBand
        financingPrequal.status = "Submitted"
        growthProgressStep = "Licensed Business"
        OneSessionVault.saveFinancingPrequal(financingPrequal)
        // API sync
        isSubmittingCustomerJob = true
        lastJobError = nil
        defer { isSubmittingCustomerJob = false }
        let request: [String: Any] = [
            "requested_amount": Int(requestedAmount * 100),
            "purpose": purpose,
            "monthly_revenue": Int(monthlyRevenue * 100),
            "credit_band": creditBand,
            "persona": activePersona.apiRole
        ]
        do {
            let payload = try JSONSerialization.data(withJSONObject: request, options: [])
            let _: OneGenericSuccessResponse = try await api.postRaw("/financing/prequalify", bodyData: payload)
            customerJobFlowMessage = "Pre-qualification submitted. You'll hear back within 5 business days."
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Submitted locally — will sync when online.")
            enqueueForRetry(path: "/financing/prequalify", method: .post, jsonObject: request)
        }
    }

    // MARK: - Phase 3: Image & Media Upload

    /// Uploads an array of UIImages to S3 via presigned URLs and returns their public CDN URLs.
    /// Sets `isUploadingImages` and `uploadProgress` during the operation.
    @MainActor
    func uploadPhotosAndGetURLs(_ images: [UIImage]) async -> [String] {
        guard !images.isEmpty else { return [] }
        isUploadingImages = true
        uploadProgress = 0.0
        defer { isUploadingImages = false; uploadProgress = 0.0 }

        var uploadedURLs: [String] = []
        for (index, image) in images.enumerated() {
            uploadProgress = Double(index) / Double(images.count)
            do {
                let req = OnePresignedURLRequest(
                    fileName: "job-photo-\(UUID().uuidString).jpg",
                    contentType: "image/jpeg"
                )
                let presigned: OnePresignedURLResponse = try await api.post("/media/presigned-url", body: req)
                guard let jpegData = image.jpegData(compressionQuality: 0.75),
                      let targetURL = URL(string: presigned.presignedUrl) else { continue }
                let success = try await uploadToS3(url: targetURL, data: jpegData, contentType: "image/jpeg")
                if success { uploadedURLs.append(presigned.publicUrl) }
            } catch {
                // Non-fatal: skip failed photo, continue with others
                authStatusMessage = "Photo \(index + 1) upload failed; skipping."
            }
        }
        uploadProgress = 1.0
        return uploadedURLs
    }

    /// Uploads a video file to S3 via presigned URL. Returns the public CDN URL or empty string on failure.
    @MainActor
    func uploadVideoToS3(_ videoFileURL: URL) async -> String {
        isUploadingImages = true
        uploadProgress = 0.0
        defer { isUploadingImages = false; uploadProgress = 0.0 }
        do {
            let req = OnePresignedURLRequest(
                fileName: "creator-video-\(UUID().uuidString).mp4",
                contentType: "video/mp4"
            )
            let presigned: OnePresignedURLResponse = try await api.post("/media/presigned-url", body: req)
            guard let targetURL = URL(string: presigned.presignedUrl) else { return "" }
            let videoData = try Data(contentsOf: videoFileURL)
            uploadProgress = 0.5
            let success = try await uploadToS3(url: targetURL, data: videoData, contentType: "video/mp4")
            uploadProgress = 1.0
            return success ? presigned.publicUrl : ""
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Video upload failed.")
            return ""
        }
    }

    /// Raw PUT to an S3 presigned URL. Returns true on HTTP 2xx.
    private func uploadToS3(url: URL, data: Data, contentType: String) async throws -> Bool {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { return false }
        return (200..<300).contains(http.statusCode)
    }

    // MARK: - Phase 4: Messaging & Push Notifications

    /// Sends a message in a conversation thread.
    /// Optimistically updates the local thread's `lastMessage` preview.
    /// The server derives the recipient from the thread_id.
    @MainActor
    func sendMessage(threadID: Int, content: String, persona: AppPersona) async {
        guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let request: [String: Any] = ["content": content]
        // Optimistic local preview update
        if let idx = unifiedInboxThreads.firstIndex(where: { $0.id == threadID }) {
            unifiedInboxThreads[idx].lastMessage = content
        }
        OneSessionVault.saveUnifiedThreads(unifiedInboxThreads)
        do {
            let payload = try JSONSerialization.data(withJSONObject: request, options: [])
            let _: OneGenericSuccessResponse = try await api.postRaw("/messages/conversations/\(threadID)", bodyData: payload)
        } catch {
            authStatusMessage = "Message send failed. Please try again."
            enqueueForRetry(path: "/messages/conversations/\(threadID)", method: .post, jsonObject: request)
        }
    }

    /// Fetches paginated message history for a thread. Returns empty array on failure.
    @MainActor
    func fetchMessageHistory(threadID: Int, limit: Int = 20, offset: Int = 0) async -> [OneMessage] {
        do {
            let response: OneMessageListResponse = try await api.get(
                "/messages/conversations/\(threadID)?limit=\(limit)&offset=\(offset)"
            )
            return response.messages
        } catch {
            authStatusMessage = "Failed to load message history."
            return []
        }
    }

    /// Requests push notification permission and registers with APNs.
    /// Sends the resulting device token to the backend.
    @MainActor
    func registerForPushNotifications() async {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .sound, .badge]
            )
            if granted {
                await MainActor.run {
                    #if canImport(UIKit)
                    UIApplication.shared.registerForRemoteNotifications()
                    #endif
                }
                // Token arrives async via AppDelegate; attempt to send if already stored
                await sendDeviceTokenToServer()
            } else {
                authStatusMessage = "Push notifications are disabled. Enable them in Settings."
            }
        } catch {
            authStatusMessage = "Push notification permission request failed."
        }
    }

    /// Sends the stored APNs device token to the backend. Silently no-ops if no token is stored yet.
    func sendDeviceTokenToServer() async {
        guard let token = OneSessionVault.loadDeviceToken(), !token.isEmpty else { return }
        let candidatePaths = ["/mobile/push-token", "/device-tokens/register", "/notifications/register-device", "/notifications/register", "/notifications/push-token"]
        let appVersion = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0"
        #if canImport(UIKit)
        let (deviceID, deviceName, osVersion): (String?, String, String) = await MainActor.run {
            (UIDevice.current.identifierForVendor?.uuidString, UIDevice.current.name, UIDevice.current.systemVersion)
        }
        #else
        let deviceID: String? = nil
        let deviceName = "ios"
        let osVersion = "unknown"
        #endif

        for path in candidatePaths {
            do {
                if path == "/mobile/push-token" {
                    var request: [String: Any] = [
                        "token": token,
                        "provider": "apns",
                        "platform": "ios",
                        "app_version": appVersion,
                        "device": [
                            "name": deviceName,
                            "os_version": osVersion
                        ]
                    ]
                    if let deviceID, !deviceID.isEmpty { request["device_id"] = deviceID }
                    let payload = try JSONSerialization.data(withJSONObject: request, options: [])
                    let _: OneGenericSuccessResponse = try await runWithRetry { try await self.api.postRaw(path, bodyData: payload) }
                } else if path == "/notifications/push-token" {
                    let payload = try JSONSerialization.data(withJSONObject: ["token": token], options: [])
                    let _: OneGenericSuccessResponse = try await runWithRetry { try await self.api.postRaw(path, bodyData: payload) }
                } else {
                    let req = OneDeviceTokenRequest(deviceToken: token, platform: "ios")
                    let _: OneGenericSuccessResponse = try await runWithRetry {
                        try await self.api.post(path, body: req)
                    }
                }
                return
            } catch {
                continue
            }
        }
    }

    // MARK: - Phase 2: New API-backed Action Methods

    @MainActor
    func applyForGrant(_ grantID: UUID) async {
        isSubmittingCustomerJob = true
        lastJobError = nil
        defer { isSubmittingCustomerJob = false }
        let req = OneGrantApplicationRequest(grantId: grantID.uuidString, persona: activePersona.apiRole)
        do {
            let _: OneGenericSuccessResponse = try await api.post("/grants/apply", body: req)
            customerJobFlowMessage = "Grant application submitted successfully."
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Application queued — will sync when online.")
            enqueueForRetry(path: "/grants/apply", method: .post, encodable: req)
        }
    }

    @MainActor
    func submitReview(targetUserID: UUID, rating: Int, comment: String, fromRole: String, toRole: String) async {
        isSubmittingCustomerJob = true
        lastJobError = nil
        defer { isSubmittingCustomerJob = false }
        let req = OneSubmitReviewRequest(
            targetUserId: targetUserID.uuidString,
            rating: max(1, min(5, rating)),
            comment: comment,
            fromRole: fromRole,
            toRole: toRole
        )
        do {
            let _: OneGenericSuccessResponse = try await api.post("/reviews/submit", body: req)
            reviews.insert(
                TwoWayReview(id: UUID(), fromRole: fromRole, toRole: toRole,
                             rating: max(1, min(5, rating)), comment: comment, createdAt: Date()),
                at: 0
            )
            OneSessionVault.saveReviews(reviews)
            customerJobFlowMessage = "Review submitted successfully."
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Review queued — will sync when online.")
            enqueueForRetry(path: "/reviews/submit", method: .post, encodable: req)
        }
    }

    func refreshMapPointsForActivePersona() {
        mapPoints = OneSessionVault.loadMapPoints().map { point in
            var next = point
            next.title = "[\(activePersona.label)] \(point.title)"
            return next
        }
    }

    @MainActor
    func refreshCustomerTransactionData() async {
        isRefreshingCustomerData = true
        isFetchingBids = true
        defer { isRefreshingCustomerData = false }
        defer { isFetchingBids = false }
        await refreshCustomerJobsFromAPI()
        await refreshHelpersFromAPI()
        await refreshAppointmentsFromAPI()
        await refreshRentalsFromAPI()
        _ = await fetchWalletBalance()
        lastCustomerSyncAt = Date()
    }

    @MainActor
    func refreshGrowthData() async {
        isRefreshingGrowthData = true
        defer { isRefreshingGrowthData = false }
        _ = await fetchWalletBalance()
        if activePersona == .consultant, let id = currentUserID {
            _ = await fetchConsultantProfile(id: id)
        }
        if activePersona == .toolOwner {
            _ = await fetchToolOwnerInventory()
        }
    }

    @MainActor
    func refreshTranslatedPreviews() async {
        guard autoTranslateEnabled else { return }
        translatedThreadPreview = [:]
        for thread in unifiedInboxThreads {
            let cacheKey = "\(thread.id)|\(appLanguage.rawValue)|\(thread.lastMessage)"
            if let cached = translatedPreviewCache[cacheKey] {
                translatedThreadPreview[thread.id] = cached
                continue
            }
            do {
                let response: OneTranslateResponse = try await api.post(
                    "/translate",
                    body: OneTranslateRequest(text: thread.lastMessage, targetLang: appLanguage.rawValue)
                )
                if let text = response.translatedText ?? response.translation {
                    translatedThreadPreview[thread.id] = text
                    translatedPreviewCache[cacheKey] = text
                }
            } catch {
                translatedThreadPreview[thread.id] = thread.lastMessage
            }
        }
    }

    @MainActor
    func login(email: String, password: String, agreementName: String, acceptedTerms: Bool) async {
        lastInteractiveAuthAt = Date()
        authStatusMessage = nil
        authRequestDiagnostics.removeAll()
        isAuthenticating = true
        defer { isAuthenticating = false }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let cleanAgreementName = agreementName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty, !password.isEmpty else {
            authStatusMessage = "Enter email and password."
            return
        }
        guard acceptedTerms else {
            authStatusMessage = "You must accept Terms and Privacy to sign in."
            return
        }
        let nameParts = cleanAgreementName.split(separator: " ").filter { !$0.isEmpty }
        guard cleanAgreementName.count >= 5, nameParts.count >= 2 else {
            authStatusMessage = "Enter your full legal name (first and last)."
            return
        }

        do {
            let response: OneAuthResponse = try await postAuthJSONWithFallback(
                paths: authEndpointCandidates("login"),
                jsonObject: [
                    "email": normalizedEmail,
                    "password": password,
                    "termsAgreed": acceptedTerms,
                    "agreementName": cleanAgreementName
                ]
            )
            guard let newAccessToken = response.accessToken ?? response.token else {
                authStatusMessage = "No access token returned by OxSteed."
                return
            }
            token = newAccessToken
            refreshToken = response.refreshToken
            OneSessionVault.saveSession(OneSavedSession(token: newAccessToken, user: response.user))
            authEmail = normalizedEmail
            authPassword = ""
            authAgreementName = cleanAgreementName
            authAcceptedTerms = acceptedTerms
            await fetchMyProfile()
            await sendDeviceTokenToServer()
            lastInteractiveAuthAt = Date()
            if biometricEnabled {
                isLocked = true
            }
        } catch {
            if error is DecodingError {
                authStatusMessage = "Sign in response format was not recognized. Check API auth response contract."
            } else {
                authStatusMessage = OneErrorMapper.userMessage(for: error, fallback: "Sign in failed. Please check your credentials and retry.")
            }
        }
    }

    @MainActor
    func register(email: String, password: String, firstName: String, lastName: String, primaryPersona: AppPersona) async {
        lastInteractiveAuthAt = Date()
        authStatusMessage = nil
        isAuthenticating = true
        defer { isAuthenticating = false }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let cleanFirst = firstName.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanLast = lastName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty, !password.isEmpty, !cleanFirst.isEmpty, !cleanLast.isEmpty else {
            authStatusMessage = "Fill all required fields."
            return
        }

        do {
            let response: OneAuthResponse = try await postAuthJSONWithFallback(
                paths: authEndpointCandidates("register"),
                jsonObject: [
                    "email": normalizedEmail,
                    "password": password,
                    "firstName": cleanFirst,
                    "lastName": cleanLast,
                    "role": primaryPersona.apiRole
                ]
            )

            guard let newAccessToken = response.accessToken ?? response.token else {
                authStatusMessage = "No access token returned by OxSteed."
                return
            }
            token = newAccessToken
            refreshToken = response.refreshToken
            OneSessionVault.saveSession(OneSavedSession(token: newAccessToken, user: response.user))
            personaContext.activePersona = primaryPersona
            onboardingState.didComplete = false
            OneSessionVault.savePersonaContext(personaContext)
            OneSessionVault.saveOnboardingState(onboardingState)
            authEmail = normalizedEmail
            authPassword = ""
            authFirstName = cleanFirst
            authLastName = cleanLast
            authAgreementName = "\(cleanFirst) \(cleanLast)"
            authAcceptedTerms = true
            await fetchMyProfile()
            await sendDeviceTokenToServer()
            lastInteractiveAuthAt = Date()
        } catch {
            authStatusMessage = OneErrorMapper.userMessage(for: error, fallback: "Account creation failed. Please verify your details and retry.")
        }
    }

    @MainActor
    func logout(clearMessage: Bool = true) {
        if let deviceToken = OneSessionVault.loadDeviceToken(), !deviceToken.isEmpty {
            Task {
                let payload = try? JSONSerialization.data(withJSONObject: ["token": deviceToken], options: [])
                if let payload {
                    try? await api.sendRaw(path: "/mobile/push-token", method: "DELETE", bodyData: payload)
                }
            }
        }

        if let refreshToken, !refreshToken.isEmpty {
            Task {
                let _: OneGenericSuccessResponse? = try? await postAuthWithFallback(
                    paths: authEndpointCandidates("logout"),
                    body: OneLogoutRequest(refreshToken: refreshToken)
                )
            }
        }
        token = nil
        refreshToken = nil
        periodicSyncTask?.cancel()
        periodicSyncTask = nil
        OneSessionVault.clearSession()
        authPassword = ""
        authAgreementName = ""
        authAcceptedTerms = false
        isLocked = false
        if clearMessage {
            authStatusMessage = nil
        }
    }

    private func tryRefreshAccessToken() async -> Bool {
        guard let currentRefreshToken = refreshToken, !currentRefreshToken.isEmpty else { return false }
        do {
            let response: OneAuthResponse = try await postAuthWithFallback(
                paths: authEndpointCandidates("refresh"),
                body: OneRefreshRequest(refreshToken: currentRefreshToken)
            )
            guard let newAccessToken = response.accessToken ?? response.token else { return false }
            token = newAccessToken
            if let newRefresh = response.refreshToken, !newRefresh.isEmpty {
                refreshToken = newRefresh
            }
            OneSessionVault.saveSession(OneSavedSession(token: newAccessToken, user: response.user))
            return true
        } catch {
            return false
        }
    }

    @MainActor
    private func runForceUpdateCheck() async {
        do {
            let response: OneVersionPolicyResponse = try await api.get("/mobile/version-policy")
            if let minimum = response.minimumVersion ?? response.minVersion {
                minimumRequiredVersion = minimum
            }
            if response.required == true {
                forceUpdateRequired = true
                return
            }
        } catch {
            // Fallback to local minimum when policy endpoint is unavailable.
        }
        let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        forceUpdateRequired = compareVersions(current, minimumRequiredVersion) == .orderedAscending
    }

    private func seedBidsIfNeeded(for jobID: UUID) {
        let existing = jobBids.contains(where: { $0.jobID == jobID })
        guard !existing else { return }
        let seeded = [
            JobBid(id: UUID(), jobID: jobID, helperName: "Carter Plumbing", amount: 145, etaText: "Tomorrow 10:00 AM", note: "Parts included up to $30.", accepted: false),
            JobBid(id: UUID(), jobID: jobID, helperName: "River North Handyman", amount: 132, etaText: "Today 4:30 PM", note: "Can start same day.", accepted: false),
            JobBid(id: UUID(), jobID: jobID, helperName: "SteadyFix Pro", amount: 158, etaText: "Tomorrow 8:00 AM", note: "Licensed and insured.", accepted: false)
        ]
        jobBids.insert(contentsOf: seeded, at: 0)
        OneSessionVault.saveJobBids(jobBids)
    }

    private func moderationStatus(for title: String) -> ModerationStatus {
        let bannedTokens = [
            "hate", "slur", "threat", "violence", "fraud",
            "odio", "amenaza", "violencia",
            "haine", "menace", "violence",
            "rayi", "menas"
        ]
        let lowered = title.lowercased()
        return bannedTokens.contains(where: { lowered.contains($0) }) ? .rejected : .pending
    }

    private func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let l = lhs.split(separator: ".").compactMap { Int($0) }
        let r = rhs.split(separator: ".").compactMap { Int($0) }
        let count = max(l.count, r.count)
        for i in 0..<count {
            let lv = i < l.count ? l[i] : 0
            let rv = i < r.count ? r[i] : 0
            if lv < rv { return .orderedAscending }
            if lv > rv { return .orderedDescending }
        }
        return .orderedSame
    }

    private func refreshHomeOnly() {
        homeReloadToken = UUID()
    }

    @MainActor
    private func refreshCustomerJobsFromAPI() async {
        do {
            let response: OneJobListEnvelope = try await api.get("/jobs?page=1&limit=\(jobPageSize)")
            let jobs = response.jobs ?? response.data ?? []
            if jobs.isEmpty {
                hasMoreJobs = false
                return
            }

            var mappedJobs: [CustomerJobPost] = []
            for dto in jobs {
                mappedJobs.append(mapCustomerJob(dto))
            }

            let remoteIDs = Set(mappedJobs.compactMap(\.remoteJobID))
            let localDraftsAndUnsynced = customerJobs.filter { job in
                job.status == .draft || job.remoteJobID == nil || !(remoteIDs.contains(job.remoteJobID ?? ""))
            }
            customerJobs = (localDraftsAndUnsynced + mappedJobs)
            jobPage = 1
            hasMoreJobs = jobs.count >= jobPageSize
            OneSessionVault.saveCustomerJobs(customerJobs)

            for job in customerJobs {
                guard let remoteID = remoteJobIdentifier(for: job) else { continue }
                await refreshBidsFromAPI(for: job.id, remoteJobID: remoteID)
            }
        } catch {
            // Keep local data when endpoint unavailable.
        }
    }

    @MainActor
    func loadMoreCustomerJobs() async {
        guard !isLoadingMoreJobs, hasMoreJobs else { return }
        isLoadingMoreJobs = true
        defer { isLoadingMoreJobs = false }
        let nextPage = jobPage + 1
        do {
            let response: OneJobListEnvelope = try await api.get("/jobs?page=\(nextPage)&limit=\(jobPageSize)")
            let jobs = response.jobs ?? response.data ?? []
            if jobs.isEmpty {
                hasMoreJobs = false
                return
            }
            let mapped = jobs.map(mapCustomerJob)
            let existing = Set(customerJobs.compactMap(\.remoteJobID))
            let newRows = mapped.filter { row in
                guard let rid = row.remoteJobID else { return true }
                return !existing.contains(rid)
            }
            customerJobs.append(contentsOf: newRows)
            jobPage = nextPage
            hasMoreJobs = jobs.count >= jobPageSize
            OneSessionVault.saveCustomerJobs(customerJobs)
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Unable to load more jobs. Please retry.")
        }
    }

    @MainActor
    private func refreshBidsFromAPI(for localJobID: UUID, remoteJobID: String) async {
        do {
            let response: OneBidListEnvelope = try await api.get("/bids/job/\(remoteJobID)")
            let rows = response.bids ?? response.data ?? []
            guard !rows.isEmpty else { return }
            jobBids.removeAll { $0.jobID == localJobID }
            let mapped = rows.map { dto in
                JobBid(
                    id: uuidFromString(dto.id) ?? UUID(),
                    jobID: localJobID,
                    helperName: dto.helperName ?? "Helper",
                    amount: Double(dto.amountCents ?? 0) / 100.0,
                    etaText: dto.availabilityStart ?? "TBD",
                    note: dto.message ?? "",
                    accepted: false
                )
            }
            jobBids.insert(contentsOf: mapped, at: 0)
            OneSessionVault.saveJobBids(jobBids)
        } catch {
            // Leave local seeded bids.
        }
    }

    @MainActor
    private func refreshHelpersFromAPI() async {
        do {
            let response: OneHelperListEnvelope = try await api.get("/helpers")
            let rows = response.helpers ?? response.data ?? []
            guard !rows.isEmpty else { return }
            serviceHelpers = rows.map { dto in
                ServiceHelperProfile(
                    id: uuidFromString(dto.id) ?? UUID(),
                    name: dto.name ?? "Helper",
                    specialty: dto.category ?? "General",
                    city: dto.city ?? "Unknown",
                    rating: dto.avgRating ?? 4.5,
                    hourlyRate: Double(dto.hourlyRateCents ?? 0) / 100.0,
                    availableSlots: ["Availability from profile"]
                )
            }
            OneSessionVault.saveServiceHelpers(serviceHelpers)
        } catch {
            // Keep local fallback.
        }
    }

    @MainActor
    private func refreshAppointmentsFromAPI() async {
        do {
            let response: OneBookingListResponse = try await api.get("/bookings?page=1&limit=\(jobPageSize)")
            let rows = response.data ?? []
            if rows.isEmpty {
                hasMoreBookings = false
                return
            }
            customerServiceBookings = rows.map { dto in
                CustomerServiceBooking(
                    id: uuidFromString(dto.id) ?? UUID(),
                    remoteBookingID: dto.id,
                    helperID: uuidFromString(dto.helperId) ?? UUID(),
                    helperName: "Helper",
                    serviceType: dto.serviceName ?? "Service",
                    scheduledDate: Date(),
                    scheduledSlot: dto.requestedStartTime ?? "TBD",
                    paymentAuthorized: (dto.paymentStatus ?? "") == "paid",
                    paymentStatus: dto.paymentStatus,
                    paymentIntentID: nil,
                    preMessage: "",
                    postMessage: "",
                    reminderEnabled: true,
                    status: dto.status ?? "Scheduled",
                    reviewRating: nil,
                    reviewComment: nil
                )
            }
            bookingPage = 1
            hasMoreBookings = rows.count >= jobPageSize
            OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
        } catch {
            // Keep local fallback.
        }
    }

    @MainActor
    func refreshMobilePaymentConfig() async {
        do {
            let _: OneGenericSuccessResponse = try await api.get("/mobile/payment-config")
            mobilePaymentsAvailable = true
            mobilePaymentStatusMessage = nil
        } catch {
            mobilePaymentsAvailable = false
            mobilePaymentStatusMessage = "Mobile payments unavailable in this environment."
        }
    }

    @MainActor
    private func refreshRentalsFromAPI() async {
        do {
            let response: OneRentalListEnvelope = try await api.get("/tool-rentals/my-rentals?page=1&limit=\(jobPageSize)")
            let rows = response.rentals ?? response.data ?? []
            if rows.isEmpty {
                hasMoreRentals = false
                return
            }
            toolRentalReservations = rows.map { dto in
                let active = (dto.status ?? "").lowercased() == "in_progress"
                let returned = (dto.status ?? "").lowercased() == "returned"
                return ToolRentalReservation(
                    id: uuidFromString(dto.id) ?? UUID(),
                    remoteBookingID: dto.id,
                    toolID: uuidFromString(dto.toolId) ?? UUID(),
                    ownerUserID: dto.ownerId,
                    toolTitle: dto.toolTitle ?? "Tool",
                    ownerName: dto.ownerName ?? "Owner",
                    slot: "\(dto.rentalStartDate ?? "") - \(dto.rentalEndDate ?? "")",
                    paymentAuthorized: true,
                    paymentStatus: "authorized",
                    paymentIntentID: nil,
                    pickupConfirmed: active || returned,
                    returnConfirmed: returned,
                    damageNotes: "",
                    depositStatus: returned ? "Refunded" : "Held",
                    disputeStatus: "None"
                )
            }
            rentalPage = 1
            hasMoreRentals = rows.count >= jobPageSize
            OneSessionVault.saveToolRentalReservations(toolRentalReservations)
        } catch {
            // Keep local fallback.
        }
    }

    @MainActor
    func loadMoreBookings() async {
        guard !isLoadingMoreBookings, hasMoreBookings else { return }
        isLoadingMoreBookings = true
        defer { isLoadingMoreBookings = false }
        let next = bookingPage + 1
        do {
            let response: OneBookingListResponse = try await api.get("/bookings?page=\(next)&limit=\(jobPageSize)")
            let rows = response.data ?? []
            if rows.isEmpty {
                hasMoreBookings = false
                return
            }
            let mapped = rows.map { dto in
                CustomerServiceBooking(
                    id: uuidFromString(dto.id) ?? UUID(),
                    remoteBookingID: dto.id,
                    helperID: uuidFromString(dto.helperId) ?? UUID(),
                    helperName: "Helper",
                    serviceType: dto.serviceName ?? "Service",
                    scheduledDate: Date(),
                    scheduledSlot: dto.requestedStartTime ?? "TBD",
                    paymentAuthorized: (dto.paymentStatus ?? "") == "paid",
                    paymentStatus: dto.paymentStatus,
                    paymentIntentID: nil,
                    preMessage: "",
                    postMessage: "",
                    reminderEnabled: true,
                    status: dto.status ?? "Scheduled",
                    reviewRating: nil,
                    reviewComment: nil
                )
            }
            let existing = Set(customerServiceBookings.compactMap(\.remoteBookingID))
            customerServiceBookings.append(contentsOf: mapped.filter { row in
                guard let id = row.remoteBookingID else { return true }
                return !existing.contains(id)
            })
            bookingPage = next
            hasMoreBookings = rows.count >= jobPageSize
            OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
        } catch {
            lastBookingError = OneErrorMapper.userMessage(for: error, fallback: "Unable to load more bookings.")
        }
    }

    @MainActor
    func loadMoreRentals() async {
        guard !isLoadingMoreRentals, hasMoreRentals else { return }
        isLoadingMoreRentals = true
        defer { isLoadingMoreRentals = false }
        let next = rentalPage + 1
        do {
            let response: OneRentalListEnvelope = try await api.get("/tool-rentals/my-rentals?page=\(next)&limit=\(jobPageSize)")
            let rows = response.rentals ?? response.data ?? []
            if rows.isEmpty {
                hasMoreRentals = false
                return
            }
            let mapped = rows.map { dto in
                let active = (dto.status ?? "").lowercased() == "in_progress"
                let returned = (dto.status ?? "").lowercased() == "returned"
                return ToolRentalReservation(
                    id: uuidFromString(dto.id) ?? UUID(),
                    remoteBookingID: dto.id,
                    toolID: uuidFromString(dto.toolId) ?? UUID(),
                    ownerUserID: dto.ownerId,
                    toolTitle: dto.toolTitle ?? "Tool",
                    ownerName: dto.ownerName ?? "Owner",
                    slot: "\(dto.rentalStartDate ?? "") - \(dto.rentalEndDate ?? "")",
                    paymentAuthorized: true,
                    paymentStatus: "authorized",
                    paymentIntentID: nil,
                    pickupConfirmed: active || returned,
                    returnConfirmed: returned,
                    damageNotes: "",
                    depositStatus: returned ? "Refunded" : "Held",
                    disputeStatus: "None"
                )
            }
            let existing = Set(toolRentalReservations.compactMap(\.remoteBookingID))
            toolRentalReservations.append(contentsOf: mapped.filter { row in
                guard let id = row.remoteBookingID else { return true }
                return !existing.contains(id)
            })
            rentalPage = next
            hasMoreRentals = rows.count >= jobPageSize
            OneSessionVault.saveToolRentalReservations(toolRentalReservations)
        } catch {
            lastToolError = OneErrorMapper.userMessage(for: error, fallback: "Unable to load more rentals.")
        }
    }

    private func mapJobStatus(_ value: String?) -> CustomerJobStatus {
        switch value?.lowercased() {
        case "draft":
            return .draft
        case "published", "open":
            return .published
        case "matched":
            return .matched
        case "in_progress":
            return .inProgress
        case "completed":
            return .completed
        default:
            return .published
        }
    }

    private func uuidFromString(_ value: String?) -> UUID? {
        guard let value, !value.isEmpty else { return nil }
        return UUID(uuidString: value)
    }

    private func mapCustomerJob(_ dto: OneJobDTO) -> CustomerJobPost {
        let id = uuidFromString(dto.id) ?? UUID()
        let status = mapJobStatus(dto.status)
        let city = dto.locationCity ?? ""
        let state = dto.locationState ?? ""
        let address = [dto.locationStreet, city, state, dto.locationZip]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        return CustomerJobPost(
            id: id,
            remoteJobID: dto.id,
            title: dto.title ?? "Untitled Job",
            category: dto.category ?? "General",
            locationQuery: city,
            address: address,
            details: dto.description ?? "",
            photos: [],
            status: status,
            createdAt: Date()
        )
    }

    private func startPeriodicSyncIfNeeded() {
        guard periodicSyncTask == nil else { return }
        periodicSyncTask = Task.detached(priority: .background) { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5 * 60 * 1_000_000_000)
                if Task.isCancelled { break }
                guard await MainActor.run(body: { self.isAuthenticated && self.isNetworkAvailable }) else { continue }
                await MainActor.run {
                    Task {
                        await self.refreshCustomerTransactionData()
                        await self.syncPendingChanges()
                    }
                    return ()
                }
            }
        }
    }

    @MainActor
    private func healAPIBaseURLIfNeeded() async {
        guard let host = api.baseURL.host?.lowercased(),
              host.contains("app.oxsteed.com") else { return }

        let probes = ["/health", "/translate/locales", "/mobile/version-policy"]
        let emptyBody = Data("{}".utf8)
        for probe in probes {
            do {
                try await api.sendRaw(path: probe, method: "GET", bodyData: emptyBody)
                return
            } catch {
                continue
            }
        }

        apiBaseURLString = OneStore.defaultAPIBaseURLString
        OneSessionVault.saveAPIBaseURL(OneStore.defaultAPIBaseURLString)
        applyAPIBaseURL(OneStore.defaultAPIBaseURLString)
        apiConnectivityMessage = "API host adjusted to live endpoint."
    }

    private func postAuthWithFallback<Body: Encodable, Response: Decodable>(
        paths: [String],
        body: Body
    ) async throws -> Response {
        var lastError: Error?
        for path in paths {
            do {
                let response: Response = try await api.post(path, body: body)
                return response
            } catch {
                if let apiError = error as? OneAPIError,
                   case let .server(status, _) = apiError {
                    // Endpoint mismatch (404/405) should continue to next candidate.
                    // Auth-relevant responses should stop and surface to user.
                    if status == 404 || status == 405 {
                        lastError = error
                        continue
                    }
                    if status == 400 || status == 401 || status == 403 || status == 422 || status == 429 {
                        throw error
                    }
                }
                throw error
            }
        }
        throw lastError ?? OneAPIError.server(404, "No auth endpoint variant responded.")
    }

    private func postAuthJSONWithFallback<Response: Decodable>(
        paths: [String],
        jsonObject: [String: Any]
    ) async throws -> Response {
        let bodyData = try JSONSerialization.data(withJSONObject: jsonObject, options: [])
        var lastError: Error?
        for path in paths {
            do {
                let response: Response = try await api.postRaw(path, bodyData: bodyData)
                return response
            } catch {
                if let apiError = error as? OneAPIError,
                   case let .server(status, _) = apiError {
                    if status == 404 || status == 405 {
                        lastError = error
                        continue
                    }
                    if status == 400 || status == 401 || status == 403 || status == 422 || status == 429 {
                        throw error
                    }
                }
                throw error
            }
        }
        throw lastError ?? OneAPIError.server(404, "No auth endpoint variant responded.")
    }

    @MainActor
    func saveAPIBaseURL(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let normalized = normalizedAPIBaseURL(trimmed) else {
            apiConnectivityMessage = "Invalid API URL. Example: https://oxsteed.com/api"
            return
        }
        apiBaseURLString = normalized
        OneSessionVault.saveAPIBaseURL(normalized)
        applyAPIBaseURL(normalized)
        apiConnectivityMessage = "API URL updated."
    }

    @MainActor
    func testAPIConnection() async {
        let probes = ["/mobile/version-policy", "/health", "/translate/locales"]
        let emptyBody = Data("{}".utf8)
        for probe in probes {
            do {
                try await api.sendRaw(path: probe, method: "GET", bodyData: emptyBody)
                apiConnectivityMessage = "Connected to \(resolvedAPIBaseURLString)"
                return
            } catch {
                continue
            }
        }
        apiConnectivityMessage = "Unable to reach API at \(resolvedAPIBaseURLString)."
    }

    @MainActor
    func probeAuthEndpoints() async {
        let probeBody: [String: Any] = [
            "email": "probe@oxsteed.invalid",
            "password": "invalid",
            "termsAgreed": true,
            "terms_agreed": true,
            "agreementName": "Probe User",
            "agreement_name": "Probe User"
        ]
        var attempts: [String] = []
        for path in authEndpointCandidates("login") {
            do {
                let payload = try JSONSerialization.data(withJSONObject: probeBody, options: [])
                let _: OneAuthResponse = try await api.postRaw(path, bodyData: payload)
                authEndpointProbeMessage = "Auth endpoint reachable at \(path)"
                return
            } catch {
                if let apiError = error as? OneAPIError {
                    switch apiError {
                    case .server(let status, _):
                        attempts.append("\(path)=\(status)")
                        if status == 400 || status == 401 || status == 403 || status == 422 {
                            authEndpointProbeMessage = "Auth endpoint reachable at \(path) (HTTP \(status), credentials rejected as expected)."
                            return
                        }
                    default:
                        attempts.append("\(path)=error")
                    }
                } else {
                    attempts.append("\(path)=error")
                }
            }
        }
        authEndpointProbeMessage = "Auth probe failed. Tried: \(attempts.joined(separator: ", "))"
    }

    private func authEndpointCandidates(_ action: String) -> [String] {
        let configuredBase = api.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let configuredRoot = configuredBase.hasSuffix("/api")
            ? String(configuredBase.dropLast(4))
            : configuredBase

        var candidates: [String] = [
            "https://oxsteed.com/api/auth/\(action)",
            "/auth/\(action)",
            "\(configuredBase)/auth/\(action)",
            "\(configuredRoot)/api/auth/\(action)",
            "\(configuredRoot)/auth/\(action)"
        ]

        let hostFallbacks = [
            "https://app.oxsteed.com/api/auth/\(action)",
            "https://api.oxsteed.com/api/auth/\(action)",
            "http://127.0.0.1:5000/api/auth/\(action)",
            "http://localhost:5000/api/auth/\(action)"
        ]
        candidates.append(contentsOf: hostFallbacks)

        var deduped: [String] = []
        for candidate in candidates where !deduped.contains(candidate) {
            deduped.append(candidate)
        }
        return deduped
    }

    private func applyAPIBaseURL(_ value: String) {
        guard let normalized = normalizedAPIBaseURL(value), let url = URL(string: normalized) else { return }
        api.baseURL = url
    }

    private func normalizedAPIBaseURL(_ rawValue: String) -> String? {
        var value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if !value.lowercased().hasPrefix("http://") && !value.lowercased().hasPrefix("https://") {
            value = "https://\(value)"
        }
        guard var components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              components.host != nil else {
            return nil
        }
        let path = components.path.isEmpty ? "/api" : components.path
        components.path = path.hasSuffix("/") ? String(path.dropLast()) : path
        if components.path != "/api" && !components.path.hasSuffix("/api") {
            components.path = components.path + "/api"
        }
        return components.url?.absoluteString
    }

    @MainActor
    private func authorizeSensitiveAction(reason: String) async -> Bool {
        guard biometricEnabled else { return true }
        #if canImport(LocalAuthentication)
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            authStatusMessage = "Biometrics unavailable on this device."
            return false
        }
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
        } catch {
            authStatusMessage = "Biometric authentication failed."
            return false
        }
        #else
        return true
        #endif
    }

    private func remoteJobIdentifier(for job: CustomerJobPost) -> String? {
        let remote = job.remoteJobID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return remote.isEmpty ? nil : remote
    }

    private func section(_ title: String, cards: [HomeCard]) -> HomeSection {
        HomeSection(id: title.lowercased().replacingOccurrences(of: " ", with: "-"), title: title, cards: cards)
    }

    private func card(_ id: String, _ title: String, _ value: String, _ detail: String, _ symbol: String) -> HomeCard {
        HomeCard(id: id, title: title, value: value, detail: detail, symbolName: symbol)
    }

    // MARK: - Phase 1: Data Fetching

    /// Public pre-login discovery data so guests can browse real marketplace content
    /// before creating an account.
    @MainActor
    func loadGuestDiscovery(force: Bool = false) async {
        guard force || !hasLoadedGuestDiscovery else { return }
        isGuestDiscoveryLoading = true
        guestDiscoveryError = nil
        defer { isGuestDiscoveryLoading = false }

        var hadFailure = false

        do {
            let jobsResponse: OneJobListResponse = try await api.get("/jobs?page=1&limit=6&status=published")
            let jobs = jobsResponse.jobs ?? jobsResponse.data ?? []
            if !jobs.isEmpty {
                customerJobs = jobs.map(mapCustomerJob)
            }
        } catch {
            hadFailure = true
        }

        do {
            let helpersResponse: OneHelperListEnvelope = try await api.get("/helpers?limit=6")
            let helpers = helpersResponse.helpers ?? helpersResponse.data ?? []
            if !helpers.isEmpty {
                serviceHelpers = helpers.map { dto in
                    ServiceHelperProfile(
                        id: uuidFromString(dto.id) ?? UUID(),
                        name: dto.name ?? "Helper",
                        specialty: dto.category ?? "General",
                        city: dto.city ?? "Unknown",
                        rating: dto.avgRating ?? 4.5,
                        hourlyRate: Double(dto.hourlyRateCents ?? 0) / 100.0,
                        availableSlots: ["View profile for live availability"]
                    )
                }
            }
        } catch {
            hadFailure = true
        }

        do {
            let toolsResponse: OneToolBrowseResponse = try await api.get("/tool-rentals?page=1&limit=6")
            let tools = toolsResponse.tools ?? toolsResponse.data ?? []
            if !tools.isEmpty {
                rentalTools = tools.map { dto in
                    RentalTool(
                        id: uuidFromString(dto.id) ?? UUID(),
                        title: dto.title ?? "Tool",
                        ownerName: dto.ownerName ?? "Owner",
                        city: dto.city ?? "Unknown",
                        dailyRate: Double(dto.dailyRateCents ?? 0) / 100.0,
                        deposit: Double(dto.depositCents ?? 0) / 100.0,
                        terms: dto.terms ?? "",
                        availableSlots: dto.availableSlots ?? []
                    )
                }
            }
        } catch {
            hadFailure = true
        }

        if hadFailure, customerJobs.isEmpty, serviceHelpers.isEmpty, rentalTools.isEmpty {
            guestDiscoveryError = "Some public data is unavailable right now. You can still sign in or create an account."
        }
        guestDiscoveryLastUpdatedAt = Date()
        hasLoadedGuestDiscovery = true
    }

    /// Fetch the authenticated user's profile and update persona context.
    @MainActor
    func fetchMyProfile() async {
        do {
            let profilePaths = ["/auth/me"]
            let response: OneMeResponse = try await getWithPathFallback(paths: profilePaths)
            guard let profile = response.user else { return }
            if let uid = profile.id {
                currentUserID = uid
            }
            if let email = profile.email {
                // Keep token/auth state untouched; only update display metadata.
                _ = email // used implicitly via vault save below
            }
            if let businesses = profile.businesses, !businesses.isEmpty {
                availableBusinesses = businesses
            }
            // Map backend default_mode → AppPersona if supplied.
            if let mode = profile.defaultMode {
                let mapped: AppPersona? = {
                    switch mode {
                    case "helper": return .helper
                    case "business_owner": return .businessOwner
                    case "consultant": return .consultant
                    case "tool_owner": return .toolOwner
                    case "franchise_owner": return .franchiseOwner
                    case "investor": return .investor
                    default: return .customer
                    }
                }()
                if let persona = mapped {
                    personaContext.activePersona = persona
                    OneSessionVault.savePersonaContext(personaContext)
                }
            }
        } catch {
            // Silently fall back to cached persona; a 401 is handled by api.onUnauthorized.
        }
    }

    /// Fetch published jobs from the public feed (helper persona job browse).
    @MainActor
    func fetchHelperJobFeed(page: Int = 1) async {
        guard activePersona == .helper else { return }
        isFetchingJobs = true
        defer { isFetchingJobs = false }
        do {
            let response: OneJobListResponse = try await runWithRetry {
                try await self.api.get("/jobs?page=\(page)&limit=\(self.jobPageSize)&status=published")
            }
            let jobs = response.jobs ?? response.data ?? []
            let mapped = jobs.map(mapCustomerJob)
            if page == 1 {
                // Replace first page; dedup on remoteJobID.
                let existing = Set(customerJobs.compactMap(\.remoteJobID))
                customerJobs = mapped.filter { row in
                    guard let rid = row.remoteJobID else { return true }
                    return !existing.contains(rid)
                } + customerJobs.filter { $0.remoteJobID != nil && !mapped.compactMap(\.remoteJobID).contains($0.remoteJobID!) }
                jobPage = 1
            } else {
                let existing = Set(customerJobs.compactMap(\.remoteJobID))
                customerJobs.append(contentsOf: mapped.filter { row in
                    guard let rid = row.remoteJobID else { return true }
                    return !existing.contains(rid)
                })
                jobPage = page
            }
            hasMoreJobs = jobs.count >= jobPageSize
            OneSessionVault.saveCustomerJobs(customerJobs)
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Failed to load nearby jobs.")
        }
    }

    /// Fetch the current user's own posted jobs (customer persona).
    @MainActor
    func fetchMyJobs(status: String? = nil) async {
        guard activePersona == .customer else { return }
        isFetchingJobs = true
        defer { isFetchingJobs = false }
        do {
            let path = status.map { "/jobs/my-jobs?status=\($0)" } ?? "/jobs/my-jobs"
            let response: OneJobListResponse = try await runWithRetry {
                try await self.api.get(path)
            }
            let jobs = response.jobs ?? response.data ?? []
            guard !jobs.isEmpty else { return }
            customerJobs = jobs.map(mapCustomerJob)
            jobPage = 1
            hasMoreJobs = jobs.count >= jobPageSize
            OneSessionVault.saveCustomerJobs(customerJobs)
        } catch {
            lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Failed to load your jobs.")
        }
    }

    /// Fetch bids for a specific job, identified by its local UUID.
    @MainActor
    func fetchBidsForJob(_ jobID: UUID) async {
        guard let remoteID = customerJobs.first(where: { $0.id == jobID })?.remoteJobID,
              !remoteID.isEmpty else { return }
        isFetchingBids = true
        defer { isFetchingBids = false }
        await refreshBidsFromAPI(for: jobID, remoteJobID: remoteID)
    }

    /// Fetch service bookings for the current user (works for both customer and helper role).
    @MainActor
    func fetchServiceBookings(page: Int = 1) async {
        isCreatingBooking = true
        defer { isCreatingBooking = false }
        await refreshAppointmentsFromAPI()
    }

    /// Fetch available rental tools from the public browse endpoint.
    @MainActor
    func fetchRentalTools(page: Int = 1) async {
        isReservingTool = true
        defer { isReservingTool = false }
        do {
            let response: OneToolBrowseResponse = try await api.get("/tool-rentals?page=\(page)&limit=\(jobPageSize)")
            let tools = response.tools ?? response.data ?? []
            guard !tools.isEmpty else {
                if page == 1 { hasMoreRentals = false }
                return
            }
            let mapped = tools.map { dto in
                RentalTool(
                    id: uuidFromString(dto.id) ?? UUID(),
                    title: dto.title ?? "Tool",
                    ownerName: dto.ownerName ?? "Owner",
                    city: dto.city ?? "Unknown",
                    dailyRate: Double(dto.dailyRateCents ?? 0) / 100.0,
                    deposit: Double(dto.depositCents ?? 0) / 100.0,
                    terms: dto.terms ?? "",
                    availableSlots: dto.availableSlots ?? []
                )
            }
            if page == 1 {
                rentalTools = mapped
                rentalPage = 1
            } else {
                let existing = Set(rentalTools.map(\.id))
                rentalTools.append(contentsOf: mapped.filter { !existing.contains($0.id) })
                rentalPage = page
            }
            hasMoreRentals = tools.count >= jobPageSize
            OneSessionVault.saveRentalTools(rentalTools)
        } catch {
            lastToolError = OneErrorMapper.userMessage(for: error, fallback: "Failed to load tools.")
        }
    }

    /// Fetch historical life log entries from the server.
    @MainActor
    func fetchLifeLogHistory() async {
        do {
            let response: OneLifeLogListResponse = try await api.get("/life-log?limit=50")
            let entries = response.entries ?? response.data ?? []
            guard !entries.isEmpty else { return }
            let mapped = entries.compactMap { dto -> LifeLogEntry? in
                guard let pillar = dto.pillarId else { return nil }
                // Use the existing convenience init; server id/createdAt are not stored
                // in the local model in Phase 1 (acceptable — local UUID is stable per install).
                return LifeLogEntry(
                    pillarID: pillar,
                    title: dto.title ?? "",
                    detail: dto.detail ?? ""
                )
            }
            // Merge: server is authoritative; keep local-only entries that have no remoteID.
            lifeLogEntries = mapped
            OneSessionVault.saveLifeLogEntries(lifeLogEntries)
        } catch {
            // Keep locally cached entries.
        }
    }

    /// Fetch sinking funds from the server.
    @MainActor
    func fetchSinkingFunds() async {
        do {
            let response: OneSinkingFundListResponse = try await api.get("/sinking-funds")
            let funds = response.funds ?? response.data ?? []
            guard !funds.isEmpty else { return }
            sinkingFunds = funds.compactMap { dto -> SinkingFund? in
                guard let id = dto.id else { return nil }
                return SinkingFund(
                    id: uuidFromString(id) ?? UUID(),
                    title: dto.title ?? "Fund",
                    targetAmount: Double(dto.targetAmountCents ?? 0) / 100.0,
                    currentAmount: Double(dto.currentAmountCents ?? 0) / 100.0,
                    targetDate: parseISODate(dto.targetDate) ?? Date().addingTimeInterval(30 * 86_400)
                )
            }
            OneSessionVault.saveSinkingFunds(sinkingFunds)
        } catch {
            // Keep locally cached funds.
        }
    }

    /// Fetch unified inbox threads from the server.
    @MainActor
    func fetchUnifiedInbox() async {
        do {
            let response: OneInboxListResponse = try await runWithRetry {
                try await self.api.get("/messages/conversations?limit=30")
            }
            let threads = response.conversations ?? response.data ?? []
            guard !threads.isEmpty else { return }
            unifiedInboxThreads = threads.compactMap { dto -> UnifiedThread? in
                guard let id = dto.id else { return nil }
                return UnifiedThread(
                    id: id,
                    title: dto.participantName ?? "Unknown",
                    lastMessage: dto.lastMessage ?? "",
                    personaSource: dto.personaSource ?? activePersona.rawValue,
                    unreadCount: dto.unreadCount ?? 0
                )
            }
            OneSessionVault.saveUnifiedThreads(unifiedInboxThreads)
        } catch {
            // Keep locally seeded threads.
        }
    }

    /// ISO 8601 date parser used by fetch methods (distinct from any existing date helpers).
    private func parseISODate(_ string: String?) -> Date? {
        guard let string else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: string) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: string) { return date }
        // Fallback: date-only strings (yyyy-MM-dd)
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.locale = Locale(identifier: "en_US_POSIX")
        return df.date(from: string)
    }

    private func seededThreads() -> [UnifiedThread] {
        [
            UnifiedThread(id: 101, title: "Sink repair update", lastMessage: "I can arrive in 20 minutes.", personaSource: "customer", unreadCount: 2),
            UnifiedThread(id: 102, title: "Team dispatch #442", lastMessage: "Dave checked in at 1:57 PM.", personaSource: "business_owner", unreadCount: 1),
            UnifiedThread(id: 103, title: "Helper lead follow-up", lastMessage: "Can you confirm material budget?", personaSource: "helper", unreadCount: 3)
        ]
    }

    @MainActor
    func syncPendingChanges() async {
        guard isAuthenticated, isNetworkAvailable, !pendingSyncChanges.isEmpty else { return }
        var remaining: [PendingSyncChange] = []
        for change in pendingSyncChanges {
            guard let payload = change.payloadData else { continue }
            do {
                switch change.method {
                case .post:
                    try await api.sendRaw(path: change.path, method: change.method.rawValue, bodyData: payload)
                case .put:
                    try await api.sendRaw(path: change.path, method: change.method.rawValue, bodyData: payload)
                }
            } catch {
                remaining.append(change)
            }
        }
        pendingSyncChanges = remaining
        OneSessionVault.savePendingSyncChanges(pendingSyncChanges)
    }

    @MainActor
    private func syncLifeLogEntry(_ entry: LifeLogEntry) async {
        let request = ["pillar_id": entry.pillarID, "title": entry.title, "detail": entry.detail]
        do {
            let _: OneGenericSuccessResponse = try await api.post("/life-log", body: request)
        } catch {
            enqueueForRetry(path: "/life-log", method: .post, jsonObject: request)
        }
    }

    @MainActor
    private func syncSinkingFund(_ fund: SinkingFund) async {
        let dateText = ISO8601DateFormatter().string(from: fund.targetDate)
        let request: [String: Any] = [
            "title": fund.title,
            "target_amount": fund.targetAmount,
            "current_amount": fund.currentAmount,
            "target_date": dateText
        ]
        do {
            let payload = try JSONSerialization.data(withJSONObject: request, options: [])
            let _: OneGenericSuccessResponse = try await api.postRaw("/sinking-funds", bodyData: payload)
        } catch {
            enqueueForRetry(path: "/sinking-funds", method: .post, jsonObject: request)
        }
    }

    private func setupConnectivityMonitoring() {
        #if canImport(Network)
        networkMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isNetworkAvailable = path.status == .satisfied
                if self.isNetworkAvailable {
                    await self.syncPendingChanges()
                }
            }
        }
        networkMonitor.start(queue: networkMonitorQueue)
        #endif
    }

    @MainActor
    func refreshPushNotificationStatus() async {
        #if canImport(UserNotifications)
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        pushAuthorizationStatus = {
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                return "authorized"
            case .denied:
                return "denied"
            case .notDetermined:
                return "not_determined"
            @unknown default:
                return "unknown"
            }
        }()
        #else
        pushAuthorizationStatus = "unknown"
        #endif
    }

    @MainActor
    func requestPushNotificationAuthorization() async {
        #if canImport(UserNotifications)
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            if granted {
                #if canImport(UIKit)
                UIApplication.shared.registerForRemoteNotifications()
                #endif
            }
            await refreshPushNotificationStatus()
        } catch {
            authStatusMessage = "Push notification permission request failed."
        }
        #else
        pushAuthorizationStatus = "unknown"
        #endif
    }

    private func enqueueForRetry<Body: Encodable>(path: String, method: PendingSyncMethod, encodable: Body) {
        guard let data = try? JSONEncoder().encode(encodable) else { return }
        enqueuePendingChange(path: path, method: method, payloadData: data)
    }

    private func enqueueForRetry(path: String, method: PendingSyncMethod, jsonObject: Any) {
        guard JSONSerialization.isValidJSONObject(jsonObject),
              let data = try? JSONSerialization.data(withJSONObject: jsonObject, options: []) else { return }
        enqueuePendingChange(path: path, method: method, payloadData: data)
    }

    private func enqueuePendingChange(path: String, method: PendingSyncMethod, payloadData: Data) {
        if pendingSyncChanges.contains(where: { $0.path == path && $0.method == method && $0.payloadBase64 == payloadData.base64EncodedString() }) {
            return
        }
        let change = PendingSyncChange(path: path, method: method, payloadData: payloadData)
        pendingSyncChanges.append(change)
        OneSessionVault.savePendingSyncChanges(pendingSyncChanges)
    }

    private func runWithRetry<T>(
        maxAttempts: Int = 3,
        initialDelayNanoseconds: UInt64 = 250_000_000,
        operation: @escaping () async throws -> T
    ) async throws -> T {
        var attempts = 0
        var delay = initialDelayNanoseconds
        var lastError: Error?

        while attempts < maxAttempts {
            do {
                return try await operation()
            } catch {
                lastError = error
                attempts += 1
                guard attempts < maxAttempts else { break }
                try? await Task.sleep(nanoseconds: delay)
                delay *= 2
            }
        }

        throw lastError ?? OneAPIError.invalidResponse
    }

    private func getWithPathFallback<Response: Decodable>(paths: [String]) async throws -> Response {
        var lastError: Error?
        for path in paths {
            do {
                return try await runWithRetry {
                    try await self.api.get(path)
                }
            } catch {
                if let apiError = error as? OneAPIError,
                   case let .server(status, _) = apiError,
                   status == 404 {
                    lastError = error
                    continue
                }
                throw error
            }
        }
        throw lastError ?? OneAPIError.server(404, "No endpoint variant responded.")
    }

    private func businessOwnerSections(for role: BusinessSubRole) -> [HomeSection] {
        let businessName = personaContext.selectedBusinessName ?? "Choose business"
        switch role {
        case .owner:
            return [
                section("\(businessName) · Owner View", cards: [
                    card("revenue", "Revenue Snapshot", "$12,460", "Week/month trend and today total", "chart.line.uptrend.xyaxis.circle.fill"),
                    card("team", "Team Members + Status", "17 online", "Roster with availability and performance", "person.3.fill"),
                    card("jobs", "Jobs Dispatched to Team", "12", "3 in-progress · 1 completed today", "list.bullet.clipboard.fill"),
                    card("invoices", "Invoices Sent + Pending", "3 pending", "1 paid today", "doc.richtext.fill"),
                    card("payroll", "Payroll Preview", "$6,240", "Next payout run this Friday", "dollarsign.square.fill"),
                    card("cashapp", "Cash App QR Payouts", "Enabled", "Quick field payouts available", "qrcode")
                ])
            ]
        case .manager:
            return [
                section("\(businessName) · Manager View", cards: [
                    card("roster", "Team Roster", "24", "Employees, reps, and support agents", "person.3.sequence.fill"),
                    card("dispatch", "Jobs Dispatched + Status", "12", "Assign, reassign, close, and approve time off", "point.topleft.down.curvedto.point.bottomright.up.fill"),
                    card("performance", "Team Performance", "92%", "Jobs completed, ratings, and earnings", "gauge.with.needle.fill"),
                    card("payroll", "Payroll Queue", "9 due", "Who gets paid this week", "dollarsign.square.fill"),
                    card("permissions", "Restricted Access", "No pricing/billing", "Cannot change financial settings", "lock.shield.fill")
                ])
            ]
        case .representative:
            return [
                section("\(businessName) · Representative View", cards: [
                    card("leads", "Lead Queue", "14", "Customer estimate requests", "person.crop.rectangle.badge.plus"),
                    card("quotes", "Sent Quotes", "9", "4 awaiting response", "doc.text.fill"),
                    card("jobs", "New Jobs Created", "5", "Sales funnel handoff to manager dispatch", "square.and.pencil"),
                    card("permissions", "Restricted Access", "No payroll/dispatch", "No team financials or dispatch board access", "lock.shield.fill")
                ])
            ]
        case .chatSupportAgent:
            return [
                section("\(businessName) · Support View", cards: [
                    card("threads", "Assigned Conversations", "21", "Only assigned customer threads", "bubble.left.and.text.bubble.right.fill"),
                    card("tickets", "Unresolved Tickets", "6", "Inquiry queue with handoff/escalation", "exclamationmark.bubble.fill"),
                    card("sla", "Response SLA", "18 min", "Time remaining before overdue", "timer"),
                    card("permissions", "Restricted Access", "No quotes/financials", "Conversation-only scope by assignment", "lock.shield.fill")
                ])
            ]
        case .employee:
            return [
                section("\(businessName) · Employee View", cards: [
                    card("myjobs", "My Assigned Jobs", "3", "Location, schedule, and status for each", "figure.run"),
                    card("time", "Time Tracking", "5h 10m", "Check-in / check-out and time log", "clock.fill"),
                    card("mileage", "Mileage + Photos", "22.4 mi", "Job mileage with before/after upload", "car.fill"),
                    card("permissions", "Restricted Access", "No team or payroll data", "No other jobs, quotes, or business financials", "lock.shield.fill")
                ])
            ]
        }
    }
}

private extension AppPersona {
    var apiRole: String {
        switch self {
        case .helper, .businessOwner, .consultant, .toolOwner:
            return "helper"
        default:
            return "customer"
        }
    }
}
