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

    var unifiedInboxThreads: [UnifiedThread] = OneSessionVault.loadUnifiedThreads()
    var translatedThreadPreview: [Int: String] = [:]
    var notificationPreferences: [PersonaNotificationPreference] = OneSessionVault.loadNotificationPreferences()
    var taxDocuments: [TaxDocumentSummary] = OneSessionVault.loadTaxDocuments()
    var creatorUploads: [CreatorUploadItem] = OneSessionVault.loadCreatorUploads()
    var availabilityBlocks: [AvailabilityBlock] = OneSessionVault.loadAvailabilityBlocks()
    var quoteDrafts: [QuoteDraft] = OneSessionVault.loadQuoteDrafts()
    var recurringPlans: [RecurringServicePlan] = OneSessionVault.loadRecurringPlans()
    var walletSnapshot: WalletSnapshot = OneSessionVault.loadWallet()
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
    var isSubmittingCustomerJob = false
    var bidAcceptanceInFlight: Set<UUID> = []
    var customerJobFlowMessage: String?
    var isPostingJob = false
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
    var pushAuthorizationStatus: String = "unknown"
    var jobPage = 1
    var jobPageSize = 20
    var hasMoreJobs = true
    var isLoadingMoreJobs = false

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
        api.token = token
        api.tokenProvider = { [weak self] in self?.token }
        api.refreshTokenHandler = { [weak self] in
            guard let self else { return false }
            return await self.tryRefreshAccessToken()
        }
        api.onUnauthorized = { [weak self] in
            Task { @MainActor [weak self] in
                self?.logout(clearMessage: false)
                self?.authStatusMessage = "Session expired. Please sign in again."
            }
        }
        setupConnectivityMonitoring()
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
                await refreshCustomerTransactionData()
                await syncPendingChanges()
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

    func addCreatorUpload(title: String) {
        guard canUploadCreatorContent, !title.isEmpty else { return }
        let status = moderationStatus(for: title)
        creatorUploads.insert(CreatorUploadItem(title: title, language: appLanguage, status: status), at: 0)
        OneSessionVault.saveCreatorUploads(creatorUploads)
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
    func postCustomerJobServerFirst(title: String, category: String, locationQuery: String, address: String, details: String, photos: [String]) async {
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
            let created: OneJobDTO = try await api.post("/jobs", body: request)
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
            lastJobError = error.localizedDescription
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
            lastJobError = error.localizedDescription
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
            lastJobError = error.localizedDescription
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
            lastJobError = error.localizedDescription
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
            lastBidError = error.localizedDescription
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
            helperID: UUID(),
            helperName: accepted.helperName,
            serviceType: customerJobs.first(where: { $0.id == jobID })?.category ?? "Service",
            scheduledDate: Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date(),
            scheduledSlot: accepted.etaText,
            paymentAuthorized: true,
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
            lastBidError = error.localizedDescription
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
            customerServiceBookings.insert(
                CustomerServiceBooking(
                    id: UUID(),
                    remoteBookingID: response.data?.id,
                    helperID: helperID,
                    helperName: helper.name,
                    serviceType: serviceType,
                    scheduledDate: scheduledDate,
                    scheduledSlot: slot,
                    paymentAuthorized: paymentAuthorized,
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
        } catch {
            createServiceBooking(helperID: helperID, serviceType: serviceType, scheduledDate: scheduledDate, slot: slot, paymentAuthorized: paymentAuthorized, preMessage: preMessage)
            authStatusMessage = "Booking saved locally (API unavailable/auth required)."
            lastBookingError = error.localizedDescription
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
            lastBookingError = error.localizedDescription
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
            lastBookingError = error.localizedDescription
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
            lastToolError = error.localizedDescription
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
            lastToolError = error.localizedDescription
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
            lastToolError = error.localizedDescription
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

    func submitAscensionApplication(fullName: String, skill: String, targetLicense: String) {
        ascensionApplication.fullName = fullName
        ascensionApplication.currentSkill = skill
        ascensionApplication.targetLicense = targetLicense
        ascensionApplication.status = "Submitted"
        ascensionApplication.submittedAt = Date()
        growthProgressStep = "Side Income"
        OneSessionVault.saveAscensionApplication(ascensionApplication)
    }

    func toggleWholesaleGroupJoin(_ id: UUID) {
        guard let idx = wholesaleGroups.firstIndex(where: { $0.id == id }) else { return }
        wholesaleGroups[idx].joined.toggle()
        wholesaleGroups[idx].memberCount += wholesaleGroups[idx].joined ? 1 : -1
        OneSessionVault.saveWholesaleGroups(wholesaleGroups)
    }

    func submitFinancingPrequal(requestedAmount: Double, purpose: String, monthlyRevenue: Double, creditBand: String) {
        financingPrequal.requestedAmount = requestedAmount
        financingPrequal.purpose = purpose
        financingPrequal.monthlyRevenue = monthlyRevenue
        financingPrequal.creditBand = creditBand
        financingPrequal.status = "Submitted"
        growthProgressStep = "Licensed Business"
        OneSessionVault.saveFinancingPrequal(financingPrequal)
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
    }

    @MainActor
    func refreshTranslatedPreviews() async {
        guard autoTranslateEnabled else { return }
        translatedThreadPreview = [:]
        for thread in unifiedInboxThreads {
            do {
                let response: OneTranslateResponse = try await api.post(
                    "/translate",
                    body: OneTranslateRequest(text: thread.lastMessage, targetLang: appLanguage.rawValue)
                )
                if let text = response.translatedText ?? response.translation {
                    translatedThreadPreview[thread.id] = text
                }
            } catch {
                translatedThreadPreview[thread.id] = thread.lastMessage
            }
        }
    }

    @MainActor
    func login(email: String, password: String, agreementName: String, acceptedTerms: Bool) async {
        authStatusMessage = nil
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
            let response: OneAuthResponse = try await api.post(
                "/auth/login",
                body: OneLoginRequest(
                    email: normalizedEmail,
                    password: password,
                    termsAgreed: acceptedTerms,
                    agreementName: cleanAgreementName
                )
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
            if biometricEnabled {
                isLocked = true
            }
        } catch {
            authStatusMessage = error.localizedDescription
        }
    }

    @MainActor
    func register(email: String, password: String, firstName: String, lastName: String, primaryPersona: AppPersona) async {
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
            let response: OneAuthResponse = try await api.post(
                "/auth/register",
                body: OneRegisterRequest(
                    email: normalizedEmail,
                    password: password,
                    firstName: cleanFirst,
                    lastName: cleanLast,
                    role: primaryPersona.apiRole
                )
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
        } catch {
            authStatusMessage = error.localizedDescription
        }
    }

    @MainActor
    func logout(clearMessage: Bool = true) {
        if let refreshToken, !refreshToken.isEmpty {
            Task {
                let _: OneGenericSuccessResponse? = try? await api.post("/auth/logout", body: OneLogoutRequest(refreshToken: refreshToken))
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
            let response: OneAuthResponse = try await api.post("/auth/refresh", body: OneRefreshRequest(refreshToken: currentRefreshToken))
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

            customerJobs = mappedJobs
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
            lastJobError = error.localizedDescription
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
            let response: OneBookingListResponse = try await api.get("/bookings")
            let rows = response.data ?? []
            guard !rows.isEmpty else { return }
            customerServiceBookings = rows.map { dto in
                CustomerServiceBooking(
                    id: uuidFromString(dto.id) ?? UUID(),
                    remoteBookingID: dto.id,
                    helperID: uuidFromString(dto.helperId) ?? UUID(),
                    helperName: "Helper",
                    serviceType: dto.serviceName ?? "Service",
                    scheduledDate: Date(),
                    scheduledSlot: dto.requestedStartTime ?? "TBD",
                    paymentAuthorized: true,
                    preMessage: "",
                    postMessage: "",
                    reminderEnabled: true,
                    status: dto.status ?? "Scheduled",
                    reviewRating: nil,
                    reviewComment: nil
                )
            }
            OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
        } catch {
            // Keep local fallback.
        }
    }

    @MainActor
    private func refreshRentalsFromAPI() async {
        do {
            let response: OneRentalListEnvelope = try await api.get("/tool-rentals/my-rentals")
            let rows = response.rentals ?? response.data ?? []
            guard !rows.isEmpty else { return }
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
                    pickupConfirmed: active || returned,
                    returnConfirmed: returned,
                    damageNotes: "",
                    depositStatus: returned ? "Refunded" : "Held",
                    disputeStatus: "None"
                )
            }
            OneSessionVault.saveToolRentalReservations(toolRentalReservations)
        } catch {
            // Keep local fallback.
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
