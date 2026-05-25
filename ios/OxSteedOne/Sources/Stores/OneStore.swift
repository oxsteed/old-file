import Foundation
import Observation
#if canImport(LocalAuthentication)
import LocalAuthentication
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

    var homeReloadToken = UUID()
    var showPersonaSheet = false
    var showBusinessPicker = false
    var selectedPulsePillarID: String = "money"
    var universalSearchQuery = ""

    var authEmail = ""
    var authPassword = ""
    var authStatusMessage: String?

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

    var growthProgressStep = "Skill"
    var voiceInputEnabled = true
    var appPreferences: AppPreferences = OneSessionVault.loadAppPreferences()
    var accountDeletionRequested = false

    private let api = OxSteedOneAPIClient()

    var activePersona: AppPersona {
        personaContext.activePersona
    }

    var showOnboarding: Bool {
        !onboardingState.didComplete
    }

    var activeLocale: Locale {
        Locale(identifier: appLanguage.localeIdentifier)
    }

    var activePersonaLabel: String {
        if activePersona == .businessOwner {
            let business = personaContext.selectedBusinessName ?? "No business"
            return "\(activePersona.label) · \(personaContext.businessSubRole.label) · \(business)"
        }
        return activePersona.label
    }

    var homeSections: [HomeSection] {
        switch activePersona {
        case .customer:
            return [
                section("Customer Workflow", cards: [
                    card("jobs", "Jobs Posted", "4", "1 open · 1 matched · 2 in-progress", "hammer.fill"),
                    card("messages", "Messages with Helpers", "6 unread", "Unified inbox threads", "bubble.left.and.bubble.right.fill"),
                    card("quotes", "Quotes & Payment", "3 pending", "2 awaiting deposit", "creditcard.fill"),
                    card("bookings", "Upcoming Bookings", "2", "HVAC check tomorrow", "calendar.badge.clock")
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
            return businessOwnerSections(for: personaContext.businessSubRole)
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
        let items = [
            UrgencyItem(id: "u1", pillar: "Money", title: "Projected shortfall", dueText: "June 3", urgency: "critical"),
            UrgencyItem(id: "u2", pillar: "Home Care", title: "Replace HVAC filter", dueText: "In 5 days", urgency: "high"),
            UrgencyItem(id: "u5", pillar: "Goals", title: "Link tire savings goal", dueText: "In 7 days", urgency: "high"),
            UrgencyItem(id: "u3", pillar: "Car Care", title: "Schedule oil change", dueText: "In 12 days", urgency: "medium"),
            UrgencyItem(id: "u4", pillar: "Personal Care", title: "Dental checkup booking", dueText: "In 14 days", urgency: "medium"),
            UrgencyItem(id: "u6", pillar: "Planned Needs", title: "Fund holiday gifts", dueText: "Weekly", urgency: "medium")
        ]
        let urgencyRank = ["critical": 0, "high": 1, "medium": 2, "low": 3]
        return items.sorted { lhs, rhs in
            let left = urgencyRank[lhs.urgency, default: 9]
            let right = urgencyRank[rhs.urgency, default: 9]
            if left != right { return left < right }
            return lhs.title < rhs.title
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

    func restoreSession() {
        if let saved = OneSessionVault.loadSession() {
            api.token = saved.token
        }
        if unifiedInboxThreads.isEmpty {
            unifiedInboxThreads = seededThreads()
        }
        if autoTranslateEnabled {
            Task { await refreshTranslatedPreviews() }
        }
        Task { await runForceUpdateCheck() }
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
        }

        OneSessionVault.savePersonaContext(personaContext)
        refreshHomeOnly()
    }

    func setBusinessSubRole(_ role: BusinessSubRole) {
        personaContext.businessSubRole = role
        OneSessionVault.savePersonaContext(personaContext)
        refreshHomeOnly()
    }

    func selectBusiness(_ business: BusinessRef) {
        personaContext.selectedBusinessID = business.id
        personaContext.selectedBusinessName = business.name
        showBusinessPicker = false
        OneSessionVault.savePersonaContext(personaContext)
        refreshHomeOnly()
    }

    func setLanguage(_ language: AppLanguage) {
        appLanguage = language
        OneSessionVault.saveLanguage(language)
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
        if enabled {
            isLocked = true
        }
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
        lifeLogEntries.insert(LifeLogEntry(pillarID: pillarID, title: title, detail: detail), at: 0)
        OneSessionVault.saveLifeLogEntries(lifeLogEntries)
    }

    func addSinkingFund(title: String, targetAmount: Double, currentAmount: Double, targetDate: Date) {
        guard !title.isEmpty, targetAmount > 0 else { return }
        sinkingFunds.append(SinkingFund(title: title, targetAmount: targetAmount, currentAmount: currentAmount, targetDate: targetDate))
        OneSessionVault.saveSinkingFunds(sinkingFunds)
    }

    func addToSinkingFund(_ fundID: UUID, amount: Double) {
        guard amount > 0, let idx = sinkingFunds.firstIndex(where: { $0.id == fundID }) else { return }
        sinkingFunds[idx].currentAmount += amount
        OneSessionVault.saveSinkingFunds(sinkingFunds)
    }

    func addCreatorUpload(title: String) {
        guard !title.isEmpty else { return }
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

    func refreshMapPointsForActivePersona() {
        mapPoints = OneSessionVault.loadMapPoints().map { point in
            var next = point
            next.title = "[\(activePersona.label)] \(point.title)"
            return next
        }
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

    func signIn() async {
        authStatusMessage = nil
        guard !authEmail.isEmpty, !authPassword.isEmpty else {
            authStatusMessage = "Enter email and password."
            return
        }

        do {
            let response: OneAuthResponse = try await api.post("/auth/login", body: OneLoginRequest(email: authEmail, password: authPassword))
            guard let token = response.token else {
                authStatusMessage = "No session token returned by OxSteed."
                return
            }
            api.token = token
            OneSessionVault.saveSession(OneSavedSession(token: token, user: response.user))
            authStatusMessage = "Signed in to app.oxsteed.com"
            unifiedInboxThreads = seededThreads()
            OneSessionVault.saveUnifiedThreads(unifiedInboxThreads)
        } catch {
            authStatusMessage = error.localizedDescription
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

    private func businessOwnerSections(for role: BusinessSubRole) -> [HomeSection] {
        let businessName = personaContext.selectedBusinessName ?? "Choose business"
        switch role {
        case .owner:
            return [
                section("\(businessName) · Owner View", cards: [
                    card("revenue", "Revenue", "$12,460", "This week snapshot", "chart.line.uptrend.xyaxis.circle.fill"),
                    card("team", "Team Status", "17 online", "Roster + availability", "person.3.fill"),
                    card("jobs", "Active Jobs", "12", "3 in-progress · 1 completed today", "list.bullet.clipboard.fill"),
                    card("invoices", "Invoices", "3 pending", "1 paid today", "doc.richtext.fill"),
                    card("payroll", "Payroll Preview", "$6,240", "Next payout run this Friday", "dollarsign.square.fill"),
                    card("cashapp", "Cash App QR Payouts", "Enabled", "Quick field payouts available", "qrcode")
                ])
            ]
        case .manager:
            return [
                section("\(businessName) · Manager View", cards: [
                    card("roster", "Team Roster", "24", "Assign and approve time off", "person.3.sequence.fill"),
                    card("dispatch", "Dispatch Board", "12", "Reassign and close jobs", "point.topleft.down.curvedto.point.bottomright.up.fill"),
                    card("performance", "Team Performance", "92%", "Completion rate this month", "gauge.with.needle.fill"),
                    card("permissions", "Restricted Access", "No pricing/billing", "Financial settings hidden by role", "lock.shield.fill")
                ])
            ]
        case .representative:
            return [
                section("\(businessName) · Representative View", cards: [
                    card("leads", "Lead Queue", "14", "Customer estimate requests", "person.crop.rectangle.badge.plus"),
                    card("quotes", "Sent Quotes", "9", "4 awaiting response", "doc.text.fill"),
                    card("jobs", "Jobs Created", "5", "Ready for dispatch handoff", "square.and.pencil"),
                    card("permissions", "Restricted Access", "No payroll/dispatch", "Team finances and dispatch board hidden", "lock.shield.fill")
                ])
            ]
        case .chatSupportAgent:
            return [
                section("\(businessName) · Support View", cards: [
                    card("threads", "Assigned Threads", "21", "Customer updates and handoffs", "bubble.left.and.text.bubble.right.fill"),
                    card("sla", "Response SLA", "18 min", "Average first response", "timer"),
                    card("tickets", "Unresolved Tickets", "6", "Escalate blocked cases", "exclamationmark.bubble.fill"),
                    card("permissions", "Restricted Access", "No quotes/financials", "Conversation-only scope by assignment", "lock.shield.fill")
                ])
            ]
        case .employee:
            return [
                section("\(businessName) · Employee View", cards: [
                    card("myjobs", "My Jobs Today", "3", "Only assigned jobs", "figure.run"),
                    card("time", "Time Tracking", "5h 10m", "Check-in / check-out", "clock.fill"),
                    card("mileage", "Mileage", "22.4 mi", "Job-linked travel log", "car.fill"),
                    card("permissions", "Restricted Access", "No team or payroll data", "Business finances hidden", "lock.shield.fill")
                ])
            ]
        }
    }
}
