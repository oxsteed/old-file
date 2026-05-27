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
        case .system: return "System Default"
        case .en:     return "English"
        case .es:     return "Español"
        case .fr:     return "Français"
        case .ht:     return "Kreyòl Ayisyen"
        case .ar:     return "العربية"
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
}

/// Runtime language manager. Persists user's choice and exposes a `locale` +
/// `layoutDirection` that the root view injects into the environment so the
/// entire app re-renders in the chosen language instantly — no restart.
final class LocalizationManager: ObservableObject {
    static let storageKey = "oxsteed.appLanguage"

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
}
