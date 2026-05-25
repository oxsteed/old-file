import Foundation
import Security

enum OneSessionVault {
    private static let sessionKey = "oxsteed.one.saved.session"
    private static let contextKey = "oxsteed.one.persona.context"
    private static let languageKey = "oxsteed.one.language"
    private static let autoTranslateKey = "oxsteed.one.autoTranslate"
    private static let biometricKey = "oxsteed.one.biometric"
    private static let onboardingKey = "oxsteed.one.onboarding"
    private static let lifeLogsKey = "oxsteed.one.lifeLogs"
    private static let sinkingFundsKey = "oxsteed.one.sinkingFunds"
    private static let unifiedThreadsKey = "oxsteed.one.threads"
    private static let notificationPrefsKey = "oxsteed.one.notificationPrefs"
    private static let taxDocsKey = "oxsteed.one.taxDocs"
    private static let creatorUploadsKey = "oxsteed.one.creatorUploads"
    private static let availabilityBlocksKey = "oxsteed.one.availabilityBlocks"
    private static let quoteDraftsKey = "oxsteed.one.quoteDrafts"
    private static let recurringPlansKey = "oxsteed.one.recurringPlans"
    private static let walletKey = "oxsteed.one.wallet"
    private static let badgesKey = "oxsteed.one.badges"
    private static let savedAlertsKey = "oxsteed.one.savedAlerts"
    private static let mapPointsKey = "oxsteed.one.mapPoints"
    private static let appPreferencesKey = "oxsteed.one.appPreferences"
    private static let reviewsKey = "oxsteed.one.reviews"
    private static let bookingDraftsKey = "oxsteed.one.bookingDrafts"
    private static let dispatchBufferKey = "oxsteed.one.dispatchBuffer"
    private static let walletTransactionsKey = "oxsteed.one.walletTransactions"
    private static let ascensionKey = "oxsteed.one.ascension"
    private static let wholesaleGroupsKey = "oxsteed.one.wholesaleGroups"
    private static let financingPrequalKey = "oxsteed.one.financingPrequal"
    private static let grantsKey = "oxsteed.one.grants"
    private static let academyLessonsKey = "oxsteed.one.academyLessons"
    private static let toolkitBundlesKey = "oxsteed.one.toolkits"
    private static let trendingSkillsKey = "oxsteed.one.trendingSkills"
    private static let customerJobsKey = "oxsteed.one.customerJobs"
    private static let jobBidsKey = "oxsteed.one.jobBids"
    private static let serviceHelpersKey = "oxsteed.one.serviceHelpers"
    private static let customerBookingsKey = "oxsteed.one.customerBookings"
    private static let rentalToolsKey = "oxsteed.one.rentalTools"
    private static let rentalReservationsKey = "oxsteed.one.rentalReservations"
    private static let pendingSyncChangesKey = "oxsteed.one.pendingSyncChanges"
    private static let apiBaseURLKey = "oxsteed.one.apiBaseURL"
    private static let deviceTokenKey = "oxsteed.one.deviceToken"
    private static let accessTokenKey = "oxsteed_access_token"
    private static let refreshTokenKey = "oxsteed_refresh_token"

    static func saveToken(_ token: String?) {
        saveSecureValue(token, for: accessTokenKey)
    }

    static func loadToken() -> String? {
        loadSecureValue(for: accessTokenKey)
    }

    static func saveRefreshToken(_ token: String?) {
        saveSecureValue(token, for: refreshTokenKey)
    }

    static func loadRefreshToken() -> String? {
        loadSecureValue(for: refreshTokenKey)
    }

    static func saveAPIBaseURL(_ value: String) {
        UserDefaults.standard.set(value, forKey: apiBaseURLKey)
    }

    static func loadAPIBaseURL() -> String? {
        UserDefaults.standard.string(forKey: apiBaseURLKey)
    }

    static func saveDeviceToken(_ token: String?) {
        if let token, !token.isEmpty {
            UserDefaults.standard.set(token, forKey: deviceTokenKey)
        } else {
            UserDefaults.standard.removeObject(forKey: deviceTokenKey)
        }
    }

    static func loadDeviceToken() -> String? {
        UserDefaults.standard.string(forKey: deviceTokenKey)
    }

    static func savePendingSyncChanges(_ changes: [PendingSyncChange]) {
        guard let data = try? JSONEncoder().encode(changes) else { return }
        UserDefaults.standard.set(data, forKey: pendingSyncChangesKey)
    }

    static func loadPendingSyncChanges() -> [PendingSyncChange] {
        guard let data = UserDefaults.standard.data(forKey: pendingSyncChangesKey),
              let changes = try? JSONDecoder().decode([PendingSyncChange].self, from: data) else {
            return []
        }
        return changes
    }

    static func saveSession(_ session: OneSavedSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        UserDefaults.standard.set(data, forKey: sessionKey)
    }

    static func loadSession() -> OneSavedSession? {
        guard let data = UserDefaults.standard.data(forKey: sessionKey) else { return nil }
        return try? JSONDecoder().decode(OneSavedSession.self, from: data)
    }

    static func clearSession() {
        UserDefaults.standard.removeObject(forKey: sessionKey)
        saveToken(nil)
        saveRefreshToken(nil)
    }

    private static func keychainQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "app.oxsteed.one",
            kSecAttrAccount as String: key
        ]
    }

    private static func saveSecureValue(_ value: String?, for key: String) {
        var query = keychainQuery(for: key)
        SecItemDelete(query as CFDictionary)

        guard let value, let data = value.data(using: .utf8) else { return }
        query[kSecValueData as String] = data
        SecItemAdd(query as CFDictionary, nil)
    }

    private static func loadSecureValue(for key: String) -> String? {
        var query = keychainQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }
        return value
    }

    static func savePersonaContext(_ context: PersonaContext) {
        guard let data = try? JSONEncoder().encode(context) else { return }
        UserDefaults.standard.set(data, forKey: contextKey)
    }

    static func loadPersonaContext() -> PersonaContext? {
        guard let data = UserDefaults.standard.data(forKey: contextKey) else { return nil }
        return try? JSONDecoder().decode(PersonaContext.self, from: data)
    }

    static func saveLanguage(_ language: AppLanguage) {
        UserDefaults.standard.set(language.rawValue, forKey: languageKey)
    }

    static func loadLanguage() -> AppLanguage {
        let raw = UserDefaults.standard.string(forKey: languageKey) ?? AppLanguage.english.rawValue
        return AppLanguage(rawValue: raw) ?? .english
    }

    static func saveAutoTranslateEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: autoTranslateKey)
    }

    static func loadAutoTranslateEnabled() -> Bool {
        if UserDefaults.standard.object(forKey: autoTranslateKey) == nil {
            return true
        }
        return UserDefaults.standard.bool(forKey: autoTranslateKey)
    }

    static func saveBiometricEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: biometricKey)
    }

    static func loadBiometricEnabled() -> Bool {
        UserDefaults.standard.bool(forKey: biometricKey)
    }

    static func saveOnboardingState(_ state: OnboardingState) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        UserDefaults.standard.set(data, forKey: onboardingKey)
    }

    static func loadOnboardingState() -> OnboardingState {
        guard let data = UserDefaults.standard.data(forKey: onboardingKey),
              let state = try? JSONDecoder().decode(OnboardingState.self, from: data) else {
            return OnboardingState()
        }
        return state
    }

    static func saveLifeLogEntries(_ entries: [LifeLogEntry]) {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        UserDefaults.standard.set(data, forKey: lifeLogsKey)
    }

    static func loadLifeLogEntries() -> [LifeLogEntry] {
        guard let data = UserDefaults.standard.data(forKey: lifeLogsKey),
              let entries = try? JSONDecoder().decode([LifeLogEntry].self, from: data) else {
            return []
        }
        return entries
    }

    static func saveSinkingFunds(_ funds: [SinkingFund]) {
        guard let data = try? JSONEncoder().encode(funds) else { return }
        UserDefaults.standard.set(data, forKey: sinkingFundsKey)
    }

    static func loadSinkingFunds() -> [SinkingFund] {
        guard let data = UserDefaults.standard.data(forKey: sinkingFundsKey),
              let funds = try? JSONDecoder().decode([SinkingFund].self, from: data) else {
            return [
                SinkingFund(title: "Water Heater Replacement", targetAmount: 1200, currentAmount: 380, targetDate: Calendar.current.date(byAdding: .year, value: 2, to: Date()) ?? Date()),
                SinkingFund(title: "Christmas Gifts", targetAmount: 600, currentAmount: 120, targetDate: Calendar.current.date(byAdding: .month, value: 7, to: Date()) ?? Date())
            ]
        }
        return funds
    }

    static func saveUnifiedThreads(_ threads: [UnifiedThread]) {
        guard let data = try? JSONEncoder().encode(threads) else { return }
        UserDefaults.standard.set(data, forKey: unifiedThreadsKey)
    }

    static func loadUnifiedThreads() -> [UnifiedThread] {
        guard let data = UserDefaults.standard.data(forKey: unifiedThreadsKey),
              let threads = try? JSONDecoder().decode([UnifiedThread].self, from: data) else {
            return []
        }
        return threads
    }

    static func saveNotificationPreferences(_ preferences: [PersonaNotificationPreference]) {
        guard let data = try? JSONEncoder().encode(preferences) else { return }
        UserDefaults.standard.set(data, forKey: notificationPrefsKey)
    }

    static func loadNotificationPreferences() -> [PersonaNotificationPreference] {
        guard let data = UserDefaults.standard.data(forKey: notificationPrefsKey),
              let preferences = try? JSONDecoder().decode([PersonaNotificationPreference].self, from: data) else {
            return [
                PersonaNotificationPreference(persona: .customer, radiusMiles: 10, quietHoursStart: 22, quietHoursEnd: 7, enabled: true),
                PersonaNotificationPreference(persona: .helper, radiusMiles: 5, quietHoursStart: 23, quietHoursEnd: 6, enabled: true),
                PersonaNotificationPreference(persona: .businessOwner, radiusMiles: 25, quietHoursStart: 20, quietHoursEnd: 7, enabled: true)
            ]
        }
        return preferences
    }

    static func saveTaxDocuments(_ documents: [TaxDocumentSummary]) {
        guard let data = try? JSONEncoder().encode(documents) else { return }
        UserDefaults.standard.set(data, forKey: taxDocsKey)
    }

    static func loadTaxDocuments() -> [TaxDocumentSummary] {
        guard let data = UserDefaults.standard.data(forKey: taxDocsKey),
              let docs = try? JSONDecoder().decode([TaxDocumentSummary].self, from: data) else {
            let year = Calendar.current.component(.year, from: Date())
            return [
                TaxDocumentSummary(year: year, grossIncome: 28400, deductibleExpenses: 6130),
                TaxDocumentSummary(year: year - 1, grossIncome: 22100, deductibleExpenses: 4880)
            ]
        }
        return docs
    }

    static func saveCreatorUploads(_ uploads: [CreatorUploadItem]) {
        guard let data = try? JSONEncoder().encode(uploads) else { return }
        UserDefaults.standard.set(data, forKey: creatorUploadsKey)
    }

    static func loadCreatorUploads() -> [CreatorUploadItem] {
        guard let data = UserDefaults.standard.data(forKey: creatorUploadsKey),
              let uploads = try? JSONDecoder().decode([CreatorUploadItem].self, from: data) else {
            return [
                CreatorUploadItem(title: "Basic sink unclog flow", language: .english, status: .approved),
                CreatorUploadItem(title: "Starter bookkeeping in 10 min", language: .spanish, status: .pending)
            ]
        }
        return uploads
    }

    static func saveAvailabilityBlocks(_ blocks: [AvailabilityBlock]) {
        guard let data = try? JSONEncoder().encode(blocks) else { return }
        UserDefaults.standard.set(data, forKey: availabilityBlocksKey)
    }

    static func loadAvailabilityBlocks() -> [AvailabilityBlock] {
        guard let data = UserDefaults.standard.data(forKey: availabilityBlocksKey),
              let blocks = try? JSONDecoder().decode([AvailabilityBlock].self, from: data) else {
            return [
                AvailabilityBlock(id: UUID(), label: "Weekday Evenings", days: "Mon-Fri", startHour: 18, endHour: 21, enabled: true),
                AvailabilityBlock(id: UUID(), label: "Saturday Morning", days: "Sat", startHour: 9, endHour: 13, enabled: true)
            ]
        }
        return blocks
    }

    static func saveQuoteDrafts(_ drafts: [QuoteDraft]) {
        guard let data = try? JSONEncoder().encode(drafts) else { return }
        UserDefaults.standard.set(data, forKey: quoteDraftsKey)
    }

    static func loadQuoteDrafts() -> [QuoteDraft] {
        guard let data = UserDefaults.standard.data(forKey: quoteDraftsKey),
              let drafts = try? JSONDecoder().decode([QuoteDraft].self, from: data) else {
            return []
        }
        return drafts
    }

    static func saveRecurringPlans(_ plans: [RecurringServicePlan]) {
        guard let data = try? JSONEncoder().encode(plans) else { return }
        UserDefaults.standard.set(data, forKey: recurringPlansKey)
    }

    static func loadRecurringPlans() -> [RecurringServicePlan] {
        guard let data = UserDefaults.standard.data(forKey: recurringPlansKey),
              let plans = try? JSONDecoder().decode([RecurringServicePlan].self, from: data) else {
            return [
                RecurringServicePlan(id: UUID(), title: "Weekly Lawn Care", frequency: "Weekly", nextDate: Calendar.current.date(byAdding: .day, value: 6, to: Date()) ?? Date(), active: true)
            ]
        }
        return plans
    }

    static func saveWallet(_ wallet: WalletSnapshot) {
        guard let data = try? JSONEncoder().encode(wallet) else { return }
        UserDefaults.standard.set(data, forKey: walletKey)
    }

    static func loadWallet() -> WalletSnapshot {
        guard let data = UserDefaults.standard.data(forKey: walletKey),
              let wallet = try? JSONDecoder().decode(WalletSnapshot.self, from: data) else {
            return WalletSnapshot(availableBalance: 1840, pendingEscrow: 620, payoutMethod: "Cash App")
        }
        return wallet
    }

    static func saveVerificationBadges(_ badges: [VerificationBadge]) {
        guard let data = try? JSONEncoder().encode(badges) else { return }
        UserDefaults.standard.set(data, forKey: badgesKey)
    }

    static func loadVerificationBadges() -> [VerificationBadge] {
        guard let data = UserDefaults.standard.data(forKey: badgesKey),
              let badges = try? JSONDecoder().decode([VerificationBadge].self, from: data) else {
            return [
                VerificationBadge(id: UUID(), title: "ID Verified", verified: true),
                VerificationBadge(id: UUID(), title: "License Verified", verified: true),
                VerificationBadge(id: UUID(), title: "Insurance Verified", verified: false)
            ]
        }
        return badges
    }

    static func saveSavedAlerts(_ alerts: [SavedSearchAlert]) {
        guard let data = try? JSONEncoder().encode(alerts) else { return }
        UserDefaults.standard.set(data, forKey: savedAlertsKey)
    }

    static func loadSavedAlerts() -> [SavedSearchAlert] {
        guard let data = UserDefaults.standard.data(forKey: savedAlertsKey),
              let alerts = try? JSONDecoder().decode([SavedSearchAlert].self, from: data) else {
            return [
                SavedSearchAlert(id: UUID(), query: "Plumber under $150 in Springfield", persona: .customer, enabled: true),
                SavedSearchAlert(id: UUID(), query: "Drywall jobs within 5 miles", persona: .helper, enabled: true)
            ]
        }
        return alerts
    }

    static func saveMapPoints(_ points: [MapPoint]) {
        guard let data = try? JSONEncoder().encode(points) else { return }
        UserDefaults.standard.set(data, forKey: mapPointsKey)
    }

    static func loadMapPoints() -> [MapPoint] {
        guard let data = UserDefaults.standard.data(forKey: mapPointsKey),
              let points = try? JSONDecoder().decode([MapPoint].self, from: data) else {
            return [
                MapPoint(id: UUID(), title: "Job: Sink repair", latitude: 42.1015, longitude: -72.5898),
                MapPoint(id: UUID(), title: "Helper: Carter Plumbing", latitude: 42.1091, longitude: -72.5759),
                MapPoint(id: UUID(), title: "Tool pickup: North Depot", latitude: 42.0896, longitude: -72.6012)
            ]
        }
        return points
    }

    static func saveAppPreferences(_ preferences: AppPreferences) {
        guard let data = try? JSONEncoder().encode(preferences) else { return }
        UserDefaults.standard.set(data, forKey: appPreferencesKey)
    }

    static func loadAppPreferences() -> AppPreferences {
        guard let data = UserDefaults.standard.data(forKey: appPreferencesKey),
              let preferences = try? JSONDecoder().decode(AppPreferences.self, from: data) else {
            return AppPreferences()
        }
        return preferences
    }

    static func saveReviews(_ reviews: [TwoWayReview]) {
        guard let data = try? JSONEncoder().encode(reviews) else { return }
        UserDefaults.standard.set(data, forKey: reviewsKey)
    }

    static func loadReviews() -> [TwoWayReview] {
        guard let data = UserDefaults.standard.data(forKey: reviewsKey),
              let reviews = try? JSONDecoder().decode([TwoWayReview].self, from: data) else {
            return [
                TwoWayReview(id: UUID(), fromRole: "Helper", toRole: "Customer", rating: 5, comment: "Great communication and clear scope.", createdAt: Date()),
                TwoWayReview(id: UUID(), fromRole: "Customer", toRole: "Helper", rating: 4, comment: "Arrived on time and fixed quickly.", createdAt: Date())
            ]
        }
        return reviews
    }

    static func saveBookingDrafts(_ drafts: [BookingRequestDraft]) {
        guard let data = try? JSONEncoder().encode(drafts) else { return }
        UserDefaults.standard.set(data, forKey: bookingDraftsKey)
    }

    static func loadBookingDrafts() -> [BookingRequestDraft] {
        guard let data = UserDefaults.standard.data(forKey: bookingDraftsKey),
              let drafts = try? JSONDecoder().decode([BookingRequestDraft].self, from: data) else {
            return []
        }
        return drafts
    }

    static func saveDispatchBuffer(_ settings: DispatchBufferSettings) {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        UserDefaults.standard.set(data, forKey: dispatchBufferKey)
    }

    static func loadDispatchBuffer() -> DispatchBufferSettings {
        guard let data = UserDefaults.standard.data(forKey: dispatchBufferKey),
              let settings = try? JSONDecoder().decode(DispatchBufferSettings.self, from: data) else {
            return DispatchBufferSettings(enabled: true, minutesBetweenJobs: 30)
        }
        return settings
    }

    static func saveWalletTransactions(_ transactions: [WalletTransaction]) {
        guard let data = try? JSONEncoder().encode(transactions) else { return }
        UserDefaults.standard.set(data, forKey: walletTransactionsKey)
    }

    static func loadWalletTransactions() -> [WalletTransaction] {
        guard let data = UserDefaults.standard.data(forKey: walletTransactionsKey),
              let transactions = try? JSONDecoder().decode([WalletTransaction].self, from: data) else {
            return [
                WalletTransaction(id: UUID(), title: "Completed repair payout", amount: 240, timestamp: Date(), isCredit: true),
                WalletTransaction(id: UUID(), title: "Escrow release to helper", amount: 120, timestamp: Date().addingTimeInterval(-86_400), isCredit: false)
            ]
        }
        return transactions
    }

    static func saveAscensionApplication(_ application: AscensionApplication) {
        guard let data = try? JSONEncoder().encode(application) else { return }
        UserDefaults.standard.set(data, forKey: ascensionKey)
    }

    static func loadAscensionApplication() -> AscensionApplication {
        guard let data = UserDefaults.standard.data(forKey: ascensionKey),
              let application = try? JSONDecoder().decode(AscensionApplication.self, from: data) else {
            return AscensionApplication(
                fullName: "",
                currentSkill: "General Home Services",
                targetLicense: "HVAC Contractor",
                status: "Not Started",
                submittedAt: nil
            )
        }
        return application
    }

    static func saveWholesaleGroups(_ groups: [WholesaleGroup]) {
        guard let data = try? JSONEncoder().encode(groups) else { return }
        UserDefaults.standard.set(data, forKey: wholesaleGroupsKey)
    }

    static func loadWholesaleGroups() -> [WholesaleGroup] {
        guard let data = UserDefaults.standard.data(forKey: wholesaleGroupsKey),
              let groups = try? JSONDecoder().decode([WholesaleGroup].self, from: data) else {
            return [
                WholesaleGroup(id: UUID(), name: "Springfield Tool Co-op", city: "Springfield", category: "Tools", memberCount: 32, joined: false),
                WholesaleGroup(id: UUID(), name: "River North Materials Pool", city: "River North", category: "Materials", memberCount: 21, joined: false)
            ]
        }
        return groups
    }

    static func saveFinancingPrequal(_ prequal: FinancingPrequalForm) {
        guard let data = try? JSONEncoder().encode(prequal) else { return }
        UserDefaults.standard.set(data, forKey: financingPrequalKey)
    }

    static func loadFinancingPrequal() -> FinancingPrequalForm {
        guard let data = UserDefaults.standard.data(forKey: financingPrequalKey),
              let prequal = try? JSONDecoder().decode(FinancingPrequalForm.self, from: data) else {
            return FinancingPrequalForm(
                requestedAmount: 5000,
                purpose: "Equipment",
                monthlyRevenue: 2800,
                creditBand: "Fair",
                status: "Not Started"
            )
        }
        return prequal
    }

    static func saveGrantOpportunities(_ opportunities: [GrantOpportunity]) {
        guard let data = try? JSONEncoder().encode(opportunities) else { return }
        UserDefaults.standard.set(data, forKey: grantsKey)
    }

    static func loadGrantOpportunities() -> [GrantOpportunity] {
        guard let data = UserDefaults.standard.data(forKey: grantsKey),
              let grants = try? JSONDecoder().decode([GrantOpportunity].self, from: data) else {
            return [
                GrantOpportunity(id: UUID(), title: "Small Trade Equipment Grant", region: "Massachusetts", dueText: "Due in 19 days"),
                GrantOpportunity(id: UUID(), title: "Local Workforce Upskill Subsidy", region: "Springfield Metro", dueText: "Due in 12 days")
            ]
        }
        return grants
    }

    static func saveAcademyLessons(_ lessons: [AcademyLesson]) {
        guard let data = try? JSONEncoder().encode(lessons) else { return }
        UserDefaults.standard.set(data, forKey: academyLessonsKey)
    }

    static func loadAcademyLessons() -> [AcademyLesson] {
        guard let data = UserDefaults.standard.data(forKey: academyLessonsKey),
              let lessons = try? JSONDecoder().decode([AcademyLesson].self, from: data) else {
            let drainBundle = UUID()
            let washBundle = UUID()
            return [
                AcademyLesson(id: UUID(), title: "Unclog a Drain in 10 Minutes", durationMinutes: 10, category: "Plumbing", toolkitBundleID: drainBundle),
                AcademyLesson(id: UUID(), title: "Basic Bookkeeping for Service Pros", durationMinutes: 12, category: "Business", toolkitBundleID: nil),
                AcademyLesson(id: UUID(), title: "Pressure-Washing Starter Workflow", durationMinutes: 9, category: "Exterior Care", toolkitBundleID: washBundle)
            ]
        }
        return lessons
    }

    static func saveToolkitBundles(_ bundles: [ToolkitBundle]) {
        guard let data = try? JSONEncoder().encode(bundles) else { return }
        UserDefaults.standard.set(data, forKey: toolkitBundlesKey)
    }

    static func loadToolkitBundles() -> [ToolkitBundle] {
        guard let data = UserDefaults.standard.data(forKey: toolkitBundlesKey),
              let bundles = try? JSONDecoder().decode([ToolkitBundle].self, from: data) else {
            return [
                ToolkitBundle(id: UUID(), title: "Drain-Clean Starter Kit", lessonTitle: "Unclog a Drain in 10 Minutes", affiliateURL: "https://www.amazon.com", estimatedCost: 89),
                ToolkitBundle(id: UUID(), title: "Pressure-Washing Starter Kit", lessonTitle: "Pressure-Washing Starter Workflow", affiliateURL: "https://www.amazon.com", estimatedCost: 420)
            ]
        }
        return bundles
    }

    static func saveTrendingSkills(_ skills: [TrendingSkill]) {
        guard let data = try? JSONEncoder().encode(skills) else { return }
        UserDefaults.standard.set(data, forKey: trendingSkillsKey)
    }

    static func loadTrendingSkills() -> [TrendingSkill] {
        guard let data = UserDefaults.standard.data(forKey: trendingSkillsKey),
              let skills = try? JSONDecoder().decode([TrendingSkill].self, from: data) else {
            return [
                TrendingSkill(id: UUID(), name: "Drain Snaking", city: "Springfield", learnerCount: 46),
                TrendingSkill(id: UUID(), name: "QuickBooks Setup", city: "Springfield", learnerCount: 28),
                TrendingSkill(id: UUID(), name: "Drywall Patch Repair", city: "River North", learnerCount: 35)
            ]
        }
        return skills
    }

    static func saveCustomerJobs(_ jobs: [CustomerJobPost]) {
        guard let data = try? JSONEncoder().encode(jobs) else { return }
        UserDefaults.standard.set(data, forKey: customerJobsKey)
    }

    static func loadCustomerJobs() -> [CustomerJobPost] {
        guard let data = UserDefaults.standard.data(forKey: customerJobsKey),
              let jobs = try? JSONDecoder().decode([CustomerJobPost].self, from: data) else {
            return [
                CustomerJobPost(id: UUID(), remoteJobID: nil, title: "Fix kitchen sink leak", category: "Plumbing", locationQuery: "Springfield", address: "123 Oak St, Springfield", details: "Slow drip under sink", photos: [], status: .published, createdAt: Date())
            ]
        }
        return jobs
    }

    static func saveJobBids(_ bids: [JobBid]) {
        guard let data = try? JSONEncoder().encode(bids) else { return }
        UserDefaults.standard.set(data, forKey: jobBidsKey)
    }

    static func loadJobBids() -> [JobBid] {
        guard let data = UserDefaults.standard.data(forKey: jobBidsKey),
              let bids = try? JSONDecoder().decode([JobBid].self, from: data) else {
            return []
        }
        return bids
    }

    static func saveServiceHelpers(_ helpers: [ServiceHelperProfile]) {
        guard let data = try? JSONEncoder().encode(helpers) else { return }
        UserDefaults.standard.set(data, forKey: serviceHelpersKey)
    }

    static func loadServiceHelpers() -> [ServiceHelperProfile] {
        guard let data = UserDefaults.standard.data(forKey: serviceHelpersKey),
              let helpers = try? JSONDecoder().decode([ServiceHelperProfile].self, from: data) else {
            return [
                ServiceHelperProfile(id: UUID(), name: "Carter Plumbing", specialty: "Plumbing", city: "Springfield", rating: 4.8, hourlyRate: 95, availableSlots: ["Tue 2:00 PM", "Wed 10:00 AM"]),
                ServiceHelperProfile(id: UUID(), name: "Nova Electric", specialty: "Electrical", city: "Springfield", rating: 4.7, hourlyRate: 110, availableSlots: ["Thu 9:00 AM", "Fri 1:00 PM"])
            ]
        }
        return helpers
    }

    static func saveCustomerServiceBookings(_ bookings: [CustomerServiceBooking]) {
        guard let data = try? JSONEncoder().encode(bookings) else { return }
        UserDefaults.standard.set(data, forKey: customerBookingsKey)
    }

    static func loadCustomerServiceBookings() -> [CustomerServiceBooking] {
        guard let data = UserDefaults.standard.data(forKey: customerBookingsKey),
              let bookings = try? JSONDecoder().decode([CustomerServiceBooking].self, from: data) else {
            return []
        }
        return bookings
    }

    static func saveRentalTools(_ tools: [RentalTool]) {
        guard let data = try? JSONEncoder().encode(tools) else { return }
        UserDefaults.standard.set(data, forKey: rentalToolsKey)
    }

    static func loadRentalTools() -> [RentalTool] {
        guard let data = UserDefaults.standard.data(forKey: rentalToolsKey),
              let tools = try? JSONDecoder().decode([RentalTool].self, from: data) else {
            return [
                RentalTool(id: UUID(), title: "Pressure Washer 3200 PSI", ownerName: "M. Reyes", city: "Springfield", dailyRate: 45, deposit: 120, terms: "Fuel full on return.", availableSlots: ["Sat Morning", "Sun Afternoon"]),
                RentalTool(id: UUID(), title: "Tile Saw", ownerName: "ToolHub North", city: "River North", dailyRate: 38, deposit: 100, terms: "Blade wear billed if damaged.", availableSlots: ["Mon Evening", "Tue Evening"])
            ]
        }
        return tools
    }

    static func saveToolRentalReservations(_ reservations: [ToolRentalReservation]) {
        guard let data = try? JSONEncoder().encode(reservations) else { return }
        UserDefaults.standard.set(data, forKey: rentalReservationsKey)
    }

    static func loadToolRentalReservations() -> [ToolRentalReservation] {
        guard let data = UserDefaults.standard.data(forKey: rentalReservationsKey),
              let reservations = try? JSONDecoder().decode([ToolRentalReservation].self, from: data) else {
            return []
        }
        return reservations
    }
}
