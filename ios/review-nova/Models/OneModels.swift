import SwiftUI

// MARK: - Tabs

enum AppTab: String, CaseIterable, Hashable {
    case home, life, growth, learn

    var title: String {
        switch self {
        case .home:   "Home"
        case .life:   "Life"
        case .growth: "Growth"
        case .learn:  "Learn"
        }
    }

    var icon: String {
        switch self {
        case .home:   "house.fill"
        case .life:   "heart.text.square.fill"
        case .growth: "chart.line.uptrend.xyaxis"
        case .learn:  "graduationcap.fill"
        }
    }
}

// MARK: - Personas

enum AppPersona: String, CaseIterable, Identifiable, Hashable, Codable {
    case customer
    case helper
    case businessOwner  = "business_owner"
    case consultant
    case toolOwner      = "tool_owner"
    case franchiseOwner = "franchise_owner"
    case investor

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .customer:       "Customer"
        case .helper:         "Helper"
        case .businessOwner:  "Business Owner"
        case .consultant:     "Consultant"
        case .toolOwner:      "Tool Owner"
        case .franchiseOwner: "Franchise Owner"
        case .investor:       "Investor"
        }
    }

    var tagline: String {
        switch self {
        case .customer:       "Get things done"
        case .helper:         "Earn on your terms"
        case .businessOwner:  "Run & grow your shop"
        case .consultant:     "Advise & scale impact"
        case .toolOwner:      "Rent out your tools"
        case .franchiseOwner: "Expand your brand"
        case .investor:       "Back what you believe in"
        }
    }

    var icon: String {
        switch self {
        case .customer:       "person.fill"
        case .helper:         "hands.sparkles.fill"
        case .businessOwner:  "building.2.fill"
        case .consultant:     "lightbulb.max.fill"
        case .toolOwner:      "wrench.and.screwdriver.fill"
        case .franchiseOwner: "storefront.fill"
        case .investor:       "chart.pie.fill"
        }
    }

    var tint: Color {
        switch self {
        case .customer:       OneTheme.accent
        case .helper:         OneTheme.ember
        case .businessOwner:  OneTheme.plum
        case .consultant:     OneTheme.sky
        case .toolOwner:      Color(red: 0.55, green: 0.42, blue: 0.30)
        case .franchiseOwner: Color(red: 0.86, green: 0.36, blue: 0.52)
        case .investor:       OneTheme.success
        }
    }
}

// MARK: - Domain models (sample data)

struct UrgencyItem: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let subtitle: String
    let due: String
    let icon: String
    let tint: Color
}

struct PulsePillar: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let score: Int       // 0–100
    let icon: String
    let tint: Color
}

struct DashboardStat: Identifiable, Hashable {
    let id = UUID()
    let label: String
    let value: String
    let delta: String?
    let icon: String
    let tint: Color
}

struct ActivityEvent: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let detail: String
    let time: String
    let icon: String
    let tint: Color
}

struct OpportunityCard: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let subtitle: String
    let badge: String
    let icon: String
    let tint: Color
}

// MARK: - Persona context (persisted)

struct PersonaContext: Codable, Hashable {
    var activePersona: AppPersona = .customer
    var selectedBusinessID: String?
    var selectedBusinessName: String?
}
