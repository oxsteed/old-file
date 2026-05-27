import SwiftUI

/// Tiny helper namespace for localized keys. Lets us write `L10n.tab(.home)`
/// instead of remembering raw key strings, with compile-time safety.
///
/// All values return `LocalizedStringKey` so SwiftUI looks them up via the
/// environment's `\.locale`, which we override from `LocalizationManager`.
enum L10n {

    // MARK: - Tabs

    enum TabKey: String {
        case home, life, growth, learn
        var key: LocalizedStringKey { LocalizedStringKey("tab.\(rawValue)") }
    }

    static func tab(_ t: TabKey) -> LocalizedStringKey { t.key }

    // MARK: - App

    static let appName: LocalizedStringKey = "app.name"

    static var greeting: LocalizedStringKey {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12:  return "app.greeting.morning"
        case 12..<18: return "app.greeting.afternoon"
        default:      return "app.greeting.evening"
        }
    }

    // MARK: - Persona

    enum PersonaKey {
        static let actingAs: LocalizedStringKey = "persona.acting_as"
        static let switchAction: LocalizedStringKey = "persona.switch"
        static let title: LocalizedStringKey = "persona.title"
        static let subtitle: LocalizedStringKey = "persona.subtitle"

        static func name(for persona: Persona) -> LocalizedStringKey {
            switch persona {
            case .customer:   return "persona.customer"
            case .helper:     return "persona.helper"
            case .business:   return "persona.business"
            case .consultant: return "persona.consultant"
            case .toolOwner:  return "persona.tool_owner"
            case .franchise:  return "persona.franchise"
            case .investor:   return "persona.investor"
            }
        }
    }

    // MARK: - Settings

    enum SettingsKey {
        static let title: LocalizedStringKey = "settings.title"
        static let language: LocalizedStringKey = "settings.language"
        static let languageSubtitle: LocalizedStringKey = "settings.language.subtitle"
        static let done: LocalizedStringKey = "settings.done"
        static let appearance: LocalizedStringKey = "settings.appearance"
        static let notifications: LocalizedStringKey = "settings.notifications"
        static let privacy: LocalizedStringKey = "settings.privacy"
    }

    // MARK: - Common

    enum CommonKey {
        static let cancel: LocalizedStringKey = "common.cancel"
        static let save: LocalizedStringKey = "common.save"
        static let seeAll: LocalizedStringKey = "common.see_all"
        static let search: LocalizedStringKey = "common.search"
    }
}
