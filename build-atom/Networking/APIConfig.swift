import Foundation

enum APIConfig {
    fileprivate static func infoPlistURL(_ key: String) -> URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // If the build didn't substitute `$(VAR)` you'll see "$("…; ignore it.
        guard s.hasPrefix("http://") || s.hasPrefix("https://") else { return nil }
        return URL(string: s)
    }

    /// Main API backend base URL.
    static var baseURL: URL {
        return infoPlistURL("OX_API_BASE_URL") ?? URL(string: "https://api.oxsteed.com")!
    }

    /// Socket base URL (usually same host as the main API).
    static var socketURL: URL { baseURL }
    static let defaultTimeout: TimeInterval = 30
    static let uploadTimeout: TimeInterval = 60
}

enum HTTPMethod: String {
    case GET, POST, PUT, PATCH, DELETE
}

/// Auth backend base URL (OxSteed web domain).
/// The Auth brief specifies full URLs like `https://oxsteed.com/api/auth/login`.
enum AuthAPIConfig {
    /// Auth backend base URL (OxSteed web domain).
    static var baseURL: URL {
        return APIConfig.infoPlistURL("OX_AUTH_BASE_URL") ?? URL(string: "https://oxsteed.com")!
    }
    static let defaultTimeout: TimeInterval = 30
}
