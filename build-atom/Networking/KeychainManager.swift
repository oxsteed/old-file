import Foundation
import Security

/// Secure storage for OAuth tokens using iOS Keychain.
/// Tokens are encrypted at rest and inaccessible while device is locked.
final class KeychainManager {
    static let shared = KeychainManager()
    private let service = "com.oxsteed.app"

    private init() {}

    // MARK: - Public API

    func saveAccessToken(_ token: String) { save(token, for: "accessToken") }
    func getAccessToken() -> String? { retrieve(for: "accessToken") }

    func saveRefreshToken(_ token: String) { save(token, for: "refreshToken") }
    func getRefreshToken() -> String? { retrieve(for: "refreshToken") }

    func saveExpiry(_ expiresIn: Int) {
        let expiresAt = Date().addingTimeInterval(TimeInterval(expiresIn))
        UserDefaults.standard.set(expiresAt, forKey: "oxsteed.token.expiresAt")
    }

    func tokenExpiresAt() -> Date? {
        UserDefaults.standard.object(forKey: "oxsteed.token.expiresAt") as? Date
    }

    func deleteAll() {
        delete(for: "accessToken")
        delete(for: "refreshToken")
        UserDefaults.standard.removeObject(forKey: "oxsteed.token.expiresAt")
    }

    // MARK: - Internal

    private func save(_ value: String, for key: String) {
        guard let data = value.data(using: .utf8) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    private func retrieve(for key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func delete(for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
