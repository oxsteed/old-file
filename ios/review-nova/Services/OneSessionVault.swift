import Foundation
import Security

// MARK: - Session Vault
// Mirrors OxSteedOne's OneSessionVault: tokens in Keychain, all other state in UserDefaults.

enum OneSessionVault {

    // MARK: - Keys
    private static let sessionKey        = "oxsteed.one.saved.session"
    private static let apiBaseURLKey     = "oxsteed.one.apiBaseURL"
    private static let deviceTokenKey    = "oxsteed.one.deviceToken"
    private static let accessTokenKey    = "oxsteed_access_token"
    private static let refreshTokenKey   = "oxsteed_refresh_token"
    private static let contextKey        = "oxsteed.one.persona.context"

    // MARK: - Tokens (Keychain)

    static func saveToken(_ token: String?) {
        saveSecure(token, for: accessTokenKey)
    }

    static func loadToken() -> String? {
        loadSecure(for: accessTokenKey)
    }

    static func saveRefreshToken(_ token: String?) {
        saveSecure(token, for: refreshTokenKey)
    }

    static func loadRefreshToken() -> String? {
        loadSecure(for: refreshTokenKey)
    }

    // MARK: - Session

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

    // MARK: - API Base URL

    static func saveAPIBaseURL(_ value: String) {
        UserDefaults.standard.set(value, forKey: apiBaseURLKey)
    }

    static func loadAPIBaseURL() -> String? {
        UserDefaults.standard.string(forKey: apiBaseURLKey)
    }

    // MARK: - Device Token

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

    // MARK: - Persona Context

    static func savePersonaContext(_ context: PersonaContext) {
        guard let data = try? JSONEncoder().encode(context) else { return }
        UserDefaults.standard.set(data, forKey: contextKey)
    }

    static func loadPersonaContext() -> PersonaContext? {
        guard let data = UserDefaults.standard.data(forKey: contextKey) else { return nil }
        return try? JSONDecoder().decode(PersonaContext.self, from: data)
    }

    // MARK: - Keychain internals

    private static func keychainQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: "app.oxsteed.one",
            kSecAttrAccount as String: key
        ]
    }

    private static func saveSecure(_ value: String?, for key: String) {
        var query = keychainQuery(for: key)
        SecItemDelete(query as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        query[kSecValueData as String] = data
        SecItemAdd(query as CFDictionary, nil)
    }

    private static func loadSecure(for key: String) -> String? {
        var query = keychainQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
