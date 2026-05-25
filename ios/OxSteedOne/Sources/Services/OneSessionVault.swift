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
}
