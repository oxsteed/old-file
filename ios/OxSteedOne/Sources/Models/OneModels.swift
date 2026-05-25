import Foundation

enum AppTab: String, CaseIterable, Identifiable {
    case home
    case life
    case growth
    case learn

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .life: return "Life"
        case .growth: return "Growth"
        case .learn: return "Learn"
        }
    }

    var symbolName: String {
        switch self {
        case .home: return "house.fill"
        case .life: return "heart.text.square.fill"
        case .growth: return "chart.line.uptrend.xyaxis"
        case .learn: return "graduationcap.fill"
        }
    }
}

enum AppLanguage: String, CaseIterable, Identifiable, Codable {
    case english = "en"
    case spanish = "es"
    case french = "fr"
    case haitianCreole = "ht"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .english: return "English"
        case .spanish: return "Español"
        case .french: return "Français"
        case .haitianCreole: return "Kreyòl Ayisyen"
        }
    }

    var localeIdentifier: String {
        switch self {
        case .english: return "en_US"
        case .spanish: return "es_US"
        case .french: return "fr_FR"
        case .haitianCreole: return "ht_HT"
        }
    }
}

enum AppPersona: String, CaseIterable, Identifiable, Codable {
    case customer
    case helper
    case businessOwner = "business_owner"
    case consultant
    case toolOwner = "tool_owner"
    case franchiseOwner = "franchise_owner"
    case investor

    var id: String { rawValue }

    var label: String {
        switch self {
        case .customer: return "Customer"
        case .helper: return "Helper"
        case .businessOwner: return "Business Owner"
        case .consultant: return "Consultant"
        case .toolOwner: return "Tool Owner"
        case .franchiseOwner: return "Franchise Owner"
        case .investor: return "Investor"
        }
    }
}

enum BusinessSubRole: String, CaseIterable, Identifiable, Codable {
    case owner
    case manager
    case representative
    case chatSupportAgent = "chat_support_agent"
    case employee

    var id: String { rawValue }

    var label: String {
        switch self {
        case .owner: return "Owner"
        case .manager: return "Manager"
        case .representative: return "Representative"
        case .chatSupportAgent: return "Chat Support"
        case .employee: return "Employee"
        }
    }
}

struct BusinessRef: Identifiable, Codable, Hashable {
    let id: String
    let name: String
}

struct PersonaContext: Codable, Hashable {
    var activePersona: AppPersona = .customer
    var selectedBusinessID: String?
    var selectedBusinessName: String?
    var businessSubRole: BusinessSubRole = .owner
}

struct HomeCard: Identifiable, Hashable {
    let id: String
    let title: String
    let value: String
    let detail: String
    let symbolName: String
}

struct HomeSection: Identifiable, Hashable {
    let id: String
    let title: String
    let cards: [HomeCard]
}

struct PulsePillar: Identifiable, Hashable {
    let id: String
    let title: String
    let weight: Int
    let score: Int
    let summary: String
    let tintHex: String
}

struct UrgencyItem: Identifiable, Hashable {
    let id: String
    let pillar: String
    let title: String
    let dueText: String
    let urgency: String
}

struct LifeLogEntry: Identifiable, Codable, Hashable {
    let id: UUID
    let pillarID: String
    let title: String
    let detail: String
    let createdAt: Date

    init(pillarID: String, title: String, detail: String) {
        self.id = UUID()
        self.pillarID = pillarID
        self.title = title
        self.detail = detail
        self.createdAt = Date()
    }
}

struct SinkingFund: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var targetAmount: Double
    var currentAmount: Double
    var targetDate: Date

    init(title: String, targetAmount: Double, currentAmount: Double, targetDate: Date) {
        self.id = UUID()
        self.title = title
        self.targetAmount = targetAmount
        self.currentAmount = currentAmount
        self.targetDate = targetDate
    }
}

struct UnifiedThread: Identifiable, Codable, Hashable {
    let id: Int
    let title: String
    let lastMessage: String
    let personaSource: String
    let unreadCount: Int
}

struct PersonaNotificationPreference: Identifiable, Codable, Hashable {
    let id: UUID
    let persona: AppPersona
    var radiusMiles: Int
    var quietHoursStart: Int
    var quietHoursEnd: Int
    var enabled: Bool

    init(persona: AppPersona, radiusMiles: Int, quietHoursStart: Int, quietHoursEnd: Int, enabled: Bool) {
        self.id = UUID()
        self.persona = persona
        self.radiusMiles = radiusMiles
        self.quietHoursStart = quietHoursStart
        self.quietHoursEnd = quietHoursEnd
        self.enabled = enabled
    }
}

struct TaxDocumentSummary: Identifiable, Codable, Hashable {
    let id: UUID
    var year: Int
    var grossIncome: Double
    var deductibleExpenses: Double

    init(year: Int, grossIncome: Double, deductibleExpenses: Double) {
        self.id = UUID()
        self.year = year
        self.grossIncome = grossIncome
        self.deductibleExpenses = deductibleExpenses
    }
}

enum ModerationStatus: String, Codable {
    case pending
    case approved
    case rejected
}

struct CreatorUploadItem: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var language: AppLanguage
    var status: ModerationStatus

    init(title: String, language: AppLanguage, status: ModerationStatus) {
        self.id = UUID()
        self.title = title
        self.language = language
        self.status = status
    }
}

struct OnboardingState: Codable, Hashable {
    var didComplete = false
    var selectedPrimaryPersona: AppPersona = .customer
    var hasMoney = true
    var hasHomeCare = true
    var hasCarCare = true
    var hasPersonalCare = true
    var hasGoals = true
    var hasPlannedNeeds = true
}
