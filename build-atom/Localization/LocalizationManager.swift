import SwiftUI

/// Supported app languages. The raw value is the BCP-47 / ISO code used by
/// `.lproj` folders and `Locale(identifier:)`.
enum AppLanguage: String, CaseIterable, Identifiable {
    case system = "system"
    case en = "en"
    case es = "es"
    case fr = "fr"
    case ht = "ht"
    case ar = "ar"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: return "language.system"
        case .en:     return "language.en"
        case .es:     return "language.es"
        case .fr:     return "language.fr"
        case .ht:     return "language.ht"
        case .ar:     return "language.ar"
        }
    }

    var flag: String {
        switch self {
        case .system: return "globe"
        case .en:     return "🇺🇸"
        case .es:     return "🇪🇸"
        case .fr:     return "🇫🇷"
        case .ht:     return "🇭🇹"
        case .ar:     return "🇸🇦"
        }
    }

    /// Locale to drive number/date formatting + SwiftUI string lookup.
    var locale: Locale {
        switch self {
        case .system: return Locale.autoupdatingCurrent
        default:      return Locale(identifier: rawValue)
        }
    }

    /// Layout direction — Arabic is right-to-left.
    var layoutDirection: LayoutDirection {
        switch self {
        case .ar: return .rightToLeft
        default:  return .leftToRight
        }
    }

    /// BCP-47 language code for server features (translation, etc).
    var bcp47: String {
        switch self {
        case .system:
            // Prefer the first preferred language; fall back to English.
            let raw = Locale.preferredLanguages.first ?? "en"
            return String(raw.prefix(2))
        default:
            return rawValue
        }
    }
}

/// Runtime language manager. Persists user's choice and exposes a `locale` +
/// `layoutDirection` that the root view injects into the environment so the
/// entire app re-renders in the chosen language instantly — no restart.
final class LocalizationManager: ObservableObject {
    static let storageKey = "oxsteed.appLanguage"
    private static var bundleCache: [String: Bundle] = [:]

    @Published var language: AppLanguage {
        didSet {
            UserDefaults.standard.set(language.rawValue, forKey: Self.storageKey)
        }
    }

    init() {
        let stored = UserDefaults.standard.string(forKey: Self.storageKey) ?? AppLanguage.system.rawValue
        self.language = AppLanguage(rawValue: stored) ?? .system
    }

    var locale: Locale { language.locale }
    var layoutDirection: LayoutDirection { language.layoutDirection }
    var bcp47: String { language.bcp47 }

    /// Bundle used for string lookup. This is intentionally based on the user's in-app
    /// selection (not the system language) so runtime language switching works for
    /// formatted strings and non-SwiftUI lookups.
    private var stringsBundle: Bundle {
        switch language {
        case .system:
            return .main
        default:
            if let cached = Self.bundleCache[language.rawValue] { return cached }
            if let path = Bundle.main.path(forResource: language.rawValue, ofType: "lproj"),
               let bundle = Bundle(path: path) {
                Self.bundleCache[language.rawValue] = bundle
                return bundle
            }
            return .main
        }
    }

    func localized(_ key: String) -> String {
        stringsBundle.localizedString(forKey: key, value: key, table: nil)
    }

    func format(_ key: String, _ args: CVarArg...) -> String {
        String(format: localized(key), locale: locale, arguments: args)
    }
}
