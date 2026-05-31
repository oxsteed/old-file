import Foundation
import SwiftUI

enum GoTab: String, CaseIterable, Identifiable {
    case today
    case hire
    case shop
    case inbox
    case profile

    var id: String { rawValue }

    var title: String {
        localizedTitle(.english)
    }

    func localizedTitle(_ language: GoLanguage) -> String {
        switch (self, language) {
        case (.today, .spanish): "Hoy"
        case (.today, .french): "Aujourd'hui"
        case (.today, .haitianCreole): "Jodi a"
        case (.today, .arabic): "الرئيسية"
        case (.hire, .spanish): "Aprender"
        case (.hire, .french): "Embaucher"
        case (.hire, .haitianCreole): "Anboche"
        case (.hire, .arabic): "تعلم"
        case (.shop, .spanish): "Comprar"
        case (.shop, .french): "Acheter"
        case (.shop, .haitianCreole): "Achte"
        case (.shop, .arabic): "الأدوات"
        case (.inbox, .spanish): "Mensajes"
        case (.inbox, .french): "Messages"
        case (.inbox, .haitianCreole): "Mesaj"
        case (.inbox, .arabic): "البريد الوارد"
        case (.profile, .spanish): "Yo"
        case (.profile, .french): "Moi"
        case (.profile, .haitianCreole): "Mwen"
        case (.profile, .arabic): "حسابي"
        default:
            switch self {
            case .today: "Today"
            case .hire: "Hire"
            case .shop: "Shop"
            case .inbox: "Inbox"
            case .profile: "Account"
            }
        }
    }

    var symbolName: String {
        switch self {
        case .today: "house.fill"
        case .hire: "graduationcap"
        case .shop: "wrench.and.screwdriver"
        case .inbox: "chart.line.uptrend.xyaxis"
        case .profile: "person.crop.circle"
        }
    }
}

enum GoMode: String, CaseIterable, Identifiable {
    case customer
    case helper
    case business
    case logistics

    var id: String { rawValue }

    var label: String {
        rawValue.capitalized
    }
}

enum GoLanguage: String, CaseIterable, Identifiable, Codable {
    case english = "en"
    case spanish = "es"
    case french = "fr"
    case haitianCreole = "ht"
    case arabic = "ar"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .english:
            "English"
        case .spanish:
            "Español"
        case .french:
            "Français"
        case .haitianCreole:
            "Kreyòl ayisyen"
        case .arabic:
            "العربية"
        }
    }

    var translatorLabel: String {
        switch self {
        case .english:
            "English"
        case .spanish:
            "Spanish"
        case .french:
            "French"
        case .haitianCreole:
            "Haitian Creole"
        case .arabic:
            "Arabic"
        }
    }
}

struct GoAction: Identifiable, Hashable {
    let id: String
    let title: String
    let detail: String
    let symbolName: String
    let tint: Color
    let route: String
}

struct GoMetric: Identifiable {
    let id = UUID()
    let label: String
    let value: String
    let symbolName: String
}

struct GoTask: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let subtitle: String
    let badge: String
}

struct GoDraftJob {
    var title = ""
    var details = ""
    var city = ""
    var state = ""
    var zip = ""
    var category = "Home repair"
    var urgency = "Flexible"
    var budgetType = "open"
    var budgetMin = ""
    var budgetMax = ""
    var requiredSkill = ""
    var scheduledDate = ""
    var photoNote = ""
    var preferredHelperId = ""
}

struct GoJobSubmitRequest: Encodable {
    let title: String
    let description: String
    let categoryName: String
    let budgetType: String
    let budgetMin: String?
    let budgetMax: String?
    let urgency: String
    let locationCity: String
    let locationState: String?
    let locationZip: String?
    let locationCountry: String
    let requiredSkills: [[String: String]]
    let scheduledDate: String?
    let preferredHelperId: String?
    let notes: String?
}

struct GoOfflineAction: Identifiable, Codable, Hashable {
    let id: UUID
    let type: String
    let title: String
    let createdAt: Date
    let payloadPreview: String

    init(type: String, title: String, payloadPreview: String) {
        self.id = UUID()
        self.type = type
        self.title = title
        self.createdAt = Date()
        self.payloadPreview = payloadPreview
    }
}

struct GoMessageDisplay: Identifiable, Hashable {
    let id: Int
    let title: String
    let originalMessage: String
    let translatedMessage: String?
    let unreadCount: Int

    var hasTranslation: Bool {
        translatedMessage != nil && translatedMessage != originalMessage
    }
}
