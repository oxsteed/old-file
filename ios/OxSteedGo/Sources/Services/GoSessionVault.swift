import Foundation

struct GoSavedSession: Codable {
    let token: String
    let refreshToken: String?
    let user: GoAuthUser?
}

enum GoSessionVault {
    private static let key = "com.oxsteed.app.saved-session"
    private static let languageKey = "com.oxsteed.app.language"
    private static let autoTranslateKey = "com.oxsteed.app.auto-translate"

    static func save(_ session: GoSavedSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    static func load() -> GoSavedSession? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(GoSavedSession.self, from: data)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    static func saveLanguage(_ language: GoLanguage) {
        UserDefaults.standard.set(language.rawValue, forKey: languageKey)
    }

    static func loadLanguage() -> GoLanguage {
        guard let rawValue = UserDefaults.standard.string(forKey: languageKey) else {
            return .english
        }
        return GoLanguage(rawValue: rawValue) ?? .english
    }

    static func saveAutoTranslate(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: autoTranslateKey)
    }

    static func loadAutoTranslate() -> Bool {
        guard UserDefaults.standard.object(forKey: autoTranslateKey) != nil else {
            return true
        }
        return UserDefaults.standard.bool(forKey: autoTranslateKey)
    }
}
