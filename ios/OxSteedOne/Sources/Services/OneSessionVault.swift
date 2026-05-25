import Foundation

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
}
