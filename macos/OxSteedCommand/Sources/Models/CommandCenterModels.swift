import Foundation

enum CommandSection: String, CaseIterable, Identifiable {
    case commandCenter
    case internalWorkspaces
    case logistics
    case translationPlatform
    case mobileRelease

    var id: String { rawValue }

    var title: String {
        switch self {
        case .commandCenter:
            return "Command Center"
        case .internalWorkspaces:
            return "Internal Workspaces"
        case .logistics:
            return "Logistics Branch"
        case .translationPlatform:
            return "Translation Platform"
        case .mobileRelease:
            return "Mobile 3"
        }
    }

    var symbolName: String {
        switch self {
        case .commandCenter:
            return "bolt.horizontal.circle"
        case .internalWorkspaces:
            return "building.2.crop.circle"
        case .logistics:
            return "shippingbox.circle"
        case .translationPlatform:
            return "globe.badge.chevron.backward"
        case .mobileRelease:
            return "iphone.circle"
        }
    }

    var blurb: String {
        switch self {
        case .commandCenter:
            return "Executive view across the highest-leverage OxSteed initiatives."
        case .internalWorkspaces:
            return "Department login, access posture, and employee workspace rollout."
        case .logistics:
            return "Operations, compliance, and buyer-first mode execution."
        case .translationPlatform:
            return "Localization, glossary, and translator workspace foundation."
        case .mobileRelease:
            return "OxSteed One release readiness and remaining TestFlight risk."
        }
    }
}

enum InitiativeStatus: String, CaseIterable {
    case complete
    case active
    case watch

    var label: String {
        rawValue.capitalized
    }
}

struct CommandMetric: Identifiable {
    let id = UUID()
    let label: String
    let value: String
    let note: String
}

struct CommandTask: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
}

struct CommandInitiative: Identifiable {
    let id = UUID()
    let section: CommandSection
    let title: String
    let status: InitiativeStatus
    let summary: String
    let evidence: [String]
    let nextMoves: [CommandTask]
    let verification: [String]
}
