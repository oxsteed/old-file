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

    static func normalizedCode(from rawCode: String?) -> String? {
        guard let rawCode else { return nil }
        let baseCode = rawCode
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split { $0 == "-" || $0 == "_" }
            .first?
            .lowercased()
        return baseCode
    }

    static func fromStoredCode(_ rawCode: String?) -> AppLanguage? {
        guard let code = normalizedCode(from: rawCode) else { return nil }
        return AppLanguage(rawValue: code)
    }

    var displayName: String {
        switch self {
            case .system: return "settings.language.system"
            case .en:     return "settings.language.english"
            case .es:     return "settings.language.spanish"
            case .fr:     return "settings.language.french"
            case .ht:     return "settings.language.haitian"
            case .ar:     return "settings.language.arabic"
        }
    }

    var autonym: String? {
        switch self {
        case .system: return nil
        case .en:     return "English"
        case .es:     return "Español"
        case .fr:     return "Français"
        case .ht:     return "Kreyòl ayisyen"
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

    /// BCP-47 language code for server features (translation, etc).
    var bcp47: String {
        switch self {
        case .system:
            // Prefer the first preferred language; fall back to English.
            let raw = Locale.preferredLanguages.first
            return AppLanguage.fromStoredCode(raw)?.rawValue ?? AppLanguage.en.rawValue
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
        self.language = stored == AppLanguage.system.rawValue
            ? .system
            : AppLanguage.fromStoredCode(stored) ?? .system
    }

    var locale: Locale { language.locale }
    var layoutDirection: LayoutDirection { language.layoutDirection }
    var bcp47: String { language.bcp47 }

    /// Bundle used for string lookup. This is intentionally based on the user's in-app
    /// selection (not the system language) so runtime language switching works for
    /// formatted strings and non-SwiftUI lookups.
    private var stringsBundle: Bundle {
        bundle(for: resolvedStringsLanguage)
    }

    private var resolvedStringsLanguage: AppLanguage {
        switch language {
        case .system:
            return AppLanguage.fromStoredCode(Locale.preferredLanguages.first) ?? .en
        default:
            return language
        }
    }

    private func bundle(for language: AppLanguage) -> Bundle {
        guard language != .system else { return .main }
        if let cached = Self.bundleCache[language.rawValue] { return cached }
        if let path = Bundle.main.path(forResource: language.rawValue, ofType: "lproj"),
           let bundle = Bundle(path: path) {
            Self.bundleCache[language.rawValue] = bundle
            return bundle
        }
        return .main
    }

    func localized(_ key: String) -> String {
        let localized = stringsBundle.localizedString(forKey: key, value: key, table: nil)
        if localized != key { return localized }

        let mainLocalized = Bundle.main.localizedString(forKey: key, value: key, table: nil)
        if mainLocalized != key { return mainLocalized }

        let englishLocalized = bundle(for: .en).localizedString(forKey: key, value: key, table: nil)
        return englishLocalized
    }

    func format(_ key: String, _ args: CVarArg...) -> String {
        String(format: localized(key), locale: locale, arguments: args)
    }

    func formatPlural(_ key: String, _ count: Int) -> String {
        let format = localized(key)
        return String.localizedStringWithFormat(format, count)
    }

    func formatCurrency(_ value: Double, currencyCode: String = "USD", fractionDigits: Int = 2) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode.uppercased()
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? "\(currencyCode.uppercased()) \(value)"
    }

    func currencySymbol(currencyCode: String = "USD") -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode.uppercased()
        return formatter.currencySymbol ?? currencyCode.uppercased()
    }

    func formatCents(_ cents: Int, currencyCode: String = "USD", fractionDigits: Int = 2) -> String {
        formatCurrency(Double(cents) / 100.0, currencyCode: currencyCode, fractionDigits: fractionDigits)
    }

    func formatNumber(_ value: Double, fractionDigits: Int = 0) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    func formatDate(_ date: Date, dateStyle: DateFormatter.Style = .medium, timeStyle: DateFormatter.Style = .none) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = dateStyle
        formatter.timeStyle = timeStyle
        return formatter.string(from: date)
    }

    func formatTime(_ date: Date, timeStyle: DateFormatter.Style = .short) -> String {
        formatDate(date, dateStyle: .none, timeStyle: timeStyle)
    }
}
