import Foundation

/// Unified error type for all networking calls.
enum APIError: LocalizedError, Equatable {
    case invalidURL
    case notAuthenticated
    case unauthorized                       // 401 — try refresh
    case forbidden(String?)                 // 403
    case notFound
    case validation(message: String, fields: [String: String])
    case rateLimited(retryAfter: TimeInterval?)
    case server(code: Int, message: String?)
    case decoding(String)
    case network(String)
    case offline
    case unknown

    var errorDescription: String? {
        switch self {
        case .invalidURL: return apiErrorLocalized("api.error.invalid_url")
        case .notAuthenticated: return apiErrorLocalized("api.error.not_authenticated")
        case .unauthorized: return apiErrorLocalized("api.error.unauthorized")
        case .forbidden(let m): return m ?? apiErrorLocalized("api.error.forbidden")
        case .notFound: return apiErrorLocalized("api.error.not_found")
        case .validation(let m, _): return m
        case .rateLimited(let retry):
            if let retry { return String(format: apiErrorLocalized("api.error.rate_limited_seconds"), Int(retry)) }
            return apiErrorLocalized("api.error.rate_limited")
        case .server(_, let m): return m ?? apiErrorLocalized("api.error.server")
        case .decoding(let m): return String(format: apiErrorLocalized("api.error.decoding"), m)
        case .network(let m): return m
        case .offline: return apiErrorLocalized("api.error.offline")
        case .unknown: return apiErrorLocalized("api.error.unknown")
        }
    }
}

private func apiErrorLocalized(_ key: String) -> String {
    let rawLanguage = UserDefaults.standard.string(forKey: LocalizationManager.storageKey)
    let language = rawLanguage == AppLanguage.system.rawValue
        ? AppLanguage.fromStoredCode(Locale.preferredLanguages.first) ?? .en
        : AppLanguage.fromStoredCode(rawLanguage) ?? .en

    if let path = Bundle.main.path(forResource: language.rawValue, ofType: "lproj"),
       let bundle = Bundle(path: path) {
        let localized = bundle.localizedString(forKey: key, value: key, table: nil)
        if localized != key { return localized }
    }

    if let path = Bundle.main.path(forResource: AppLanguage.en.rawValue, ofType: "lproj"),
       let bundle = Bundle(path: path) {
        return bundle.localizedString(forKey: key, value: key, table: nil)
    }

    return Bundle.main.localizedString(forKey: key, value: key, table: nil)
}

/// Server error payload shape.
struct ServerErrorPayload: Decodable {
    let success: Bool?
    let error: String?
    let code: Int?
    let fields: [String: String]?
    let message: String?
}
