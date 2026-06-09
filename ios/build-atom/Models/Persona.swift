import SwiftUI

enum Persona: String, CaseIterable, Identifiable {
    case customer = "Customer"
    case helper = "Helper"
    case business = "Business Owner"
    case consultant = "Consultant"
    case toolOwner = "Tool Owner"
    case franchise = "Franchise Owner"
    case investor = "Investor"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .customer: return "house.and.flag.fill"
        case .helper: return "wrench.and.screwdriver.fill"
        case .business: return "briefcase.fill"
        case .consultant: return "person.bubble.fill"
        case .toolOwner: return "hammer.fill"
        case .franchise: return "building.2.fill"
        case .investor: return "chart.line.uptrend.xyaxis"
        }
    }

    var tagline: String {
        switch self {
        case .customer: return "Get help when you need it"
        case .helper: return "Turn skills into local work"
        case .business: return "Run and scale your operation"
        case .consultant: return "Onboard and serve clients"
        case .toolOwner: return "Rent out your tool inventory"
        case .franchise: return "Manage your territory"
        case .investor: return "Track your portfolio"
        }
    }

    var color: Color {
        switch self {
        case .customer: return Theme.pillarHome
        case .helper: return Theme.accent
        case .business: return Theme.pillarGoals
        case .consultant: return Theme.pillarPersonal
        case .toolOwner: return Theme.pillarCar
        case .franchise: return Theme.pillarSinking
        case .investor: return Theme.pillarMoney
        }
    }
}

final class PersonaStore: ObservableObject {
    @Published var active: Persona = .customer
}
