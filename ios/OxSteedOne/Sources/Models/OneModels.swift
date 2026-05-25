import Foundation

enum AppTab: String, CaseIterable, Identifiable {
    case home
    case life
    case growth
    case learn
    case profile

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .life: return "Life"
        case .growth: return "Growth"
        case .learn: return "Learn"
        case .profile: return "Profile"
        }
    }

    var symbolName: String {
        switch self {
        case .home: return "house.fill"
        case .life: return "heart.text.square.fill"
        case .growth: return "chart.line.uptrend.xyaxis"
        case .learn: return "graduationcap.fill"
        case .profile: return "person.crop.circle.fill"
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

    var layoutDirection: Locale.LanguageDirection {
        Locale.Language(identifier: rawValue).characterDirection
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

struct BusinessRoleMembership: Identifiable, Codable, Hashable {
    let id: UUID
    let businessID: String
    let role: BusinessSubRole
    let isActive: Bool
    let permissions: [String: Bool]
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
    let dueDate: Date
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
    var lastMessage: String      // mutable for optimistic send preview
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

struct VerificationBadge: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var verified: Bool
}

struct AvailabilityBlock: Identifiable, Codable, Hashable {
    let id: UUID
    var label: String
    var days: String
    var startHour: Int
    var endHour: Int
    var enabled: Bool
}

struct QuoteDraft: Identifiable, Codable, Hashable {
    let id: UUID
    var customerName: String
    var laborAmount: Double
    var materialAmount: Double
    var notes: String
}

struct RecurringServicePlan: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var frequency: String
    var nextDate: Date
    var active: Bool
}

struct WalletSnapshot: Codable, Hashable {
    var availableBalance: Double
    var pendingEscrow: Double
    var payoutMethod: String
}

struct WalletTransaction: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var amount: Double
    var timestamp: Date
    var isCredit: Bool
}

struct TwoWayReview: Identifiable, Codable, Hashable {
    let id: UUID
    var fromRole: String
    var toRole: String
    var rating: Int
    var comment: String
    var createdAt: Date
}

struct BookingRequestDraft: Identifiable, Codable, Hashable {
    let id: UUID
    var customerName: String
    var proposedDate: Date
    var customerProposedTime: String
    var helperCounterProposalTime: String?
    var status: String
}

struct DispatchBufferSettings: Codable, Hashable {
    var enabled: Bool
    var minutesBetweenJobs: Int
}

struct AscensionApplication: Codable, Hashable {
    var fullName: String
    var currentSkill: String
    var targetLicense: String
    var status: String
    var submittedAt: Date?
}

struct WholesaleGroup: Identifiable, Codable, Hashable {
    let id: UUID
    var name: String
    var city: String
    var category: String
    var memberCount: Int
    var joined: Bool
}

struct FinancingPrequalForm: Codable, Hashable {
    var requestedAmount: Double
    var purpose: String
    var monthlyRevenue: Double
    var creditBand: String
    var status: String
}

struct GrantOpportunity: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var region: String
    var dueText: String
}

struct AcademyLesson: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var durationMinutes: Int
    var category: String
    var toolkitBundleID: UUID?
}

struct ToolkitBundle: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var lessonTitle: String
    var affiliateURL: String
    var estimatedCost: Double
}

struct TrendingSkill: Identifiable, Codable, Hashable {
    let id: UUID
    var name: String
    var city: String
    var learnerCount: Int
}

struct SavedSearchAlert: Identifiable, Codable, Hashable {
    let id: UUID
    var query: String
    var persona: AppPersona
    var enabled: Bool
}

struct MapPoint: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var latitude: Double
    var longitude: Double
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

enum AppAppearance: String, CaseIterable, Identifiable, Codable {
    case system
    case light
    case dark

    var id: String { rawValue }
}

struct AppPreferences: Codable, Hashable {
    var appearance: AppAppearance = .system
    var largeTextEnabled = false
    var privacyMode = false
    var allowAnalytics = true
}

struct GlobalSearchResult: Identifiable, Hashable {
    let id: String
    let category: String
    let title: String
    let detail: String
}

enum CustomerJobStatus: String, CaseIterable, Codable, Hashable {
    case draft
    case published
    case matched
    case inProgress = "in_progress"
    case completed
}

struct CustomerJobPost: Identifiable, Codable, Hashable {
    let id: UUID
    var remoteJobID: String?
    var title: String
    var category: String
    var locationQuery: String
    var address: String
    var details: String
    var photos: [String]
    var status: CustomerJobStatus
    var createdAt: Date
}

struct JobBid: Identifiable, Codable, Hashable {
    let id: UUID
    let jobID: UUID
    var helperName: String
    var amount: Double
    var etaText: String
    var note: String
    var accepted: Bool
}

struct ServiceHelperProfile: Identifiable, Codable, Hashable {
    let id: UUID
    var name: String
    var specialty: String
    var city: String
    var rating: Double
    var hourlyRate: Double
    var availableSlots: [String]
}

struct CustomerServiceBooking: Identifiable, Codable, Hashable {
    let id: UUID
    var remoteBookingID: String?
    let helperID: UUID
    var helperName: String
    var serviceType: String
    var scheduledDate: Date
    var scheduledSlot: String
    var paymentAuthorized: Bool
    var preMessage: String
    var postMessage: String
    var reminderEnabled: Bool
    var status: String
    var reviewRating: Int?
    var reviewComment: String?
}

struct RentalTool: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var ownerName: String
    var city: String
    var dailyRate: Double
    var deposit: Double
    var terms: String
    var availableSlots: [String]
}

struct ToolRentalReservation: Identifiable, Codable, Hashable {
    let id: UUID
    var remoteBookingID: String?
    let toolID: UUID
    var ownerUserID: String?
    var toolTitle: String
    var ownerName: String
    var slot: String
    var paymentAuthorized: Bool
    var pickupConfirmed: Bool
    var returnConfirmed: Bool
    var damageNotes: String
    var depositStatus: String
    var disputeStatus: String
}

enum PendingSyncMethod: String, Codable, Hashable {
    case post = "POST"
    case put = "PUT"
}

struct PendingSyncChange: Identifiable, Codable, Hashable {
    let id: UUID
    let path: String
    let method: PendingSyncMethod
    let payloadBase64: String
    let createdAt: Date

    init(path: String, method: PendingSyncMethod, payloadData: Data) {
        self.id = UUID()
        self.path = path
        self.method = method
        self.payloadBase64 = payloadData.base64EncodedString()
        self.createdAt = Date()
    }

    var payloadData: Data? {
        Data(base64Encoded: payloadBase64)
    }
}
