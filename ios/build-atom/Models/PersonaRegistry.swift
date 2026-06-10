import SwiftUI

// MARK: - Persona pack registry (docs/oxsteed-pack-architecture.md §3.1, §6)
//
// A persona is a pack you register, never a condition you check. This file is
// the ONLY place persona identity may be switched on. Shell code (tabs,
// switcher) asks the registry; it never names a persona.
//
// Today each module wraps the existing home views in PersonaHomes.swift.
// As homes are split into per-persona folders/packages, only the module
// bodies here change — call sites stay untouched.

// Stable pack identifiers — shared contract with the server's country packs
// (`enabled_personas` in /api/country-config). Never localized, never shown.
extension Persona {
    var packId: String {
        switch self {
        case .customer:   return "customer"
        case .helper:     return "helper"
        case .business:   return "business"
        case .consultant: return "consultant"
        case .toolOwner:  return "toolOwner"
        case .franchise:  return "franchise"
        case .investor:   return "investor"
        }
    }
}

@MainActor
protocol PersonaModule {
    var persona: Persona { get }
    /// Tab 1 — the persona's operating surface.
    func homeView(isGuest: Bool, onRequireAuth: @escaping () -> Void) -> AnyView
}

// MARK: - Modules (one per pack; no module may reference another)

struct CustomerPersonaModule: PersonaModule {
    let persona: Persona = .customer
    func homeView(isGuest: Bool, onRequireAuth: @escaping () -> Void) -> AnyView {
        AnyView(CustomerHome(isGuest: isGuest, onRequireAuth: onRequireAuth))
    }
}

struct HelperPersonaModule: PersonaModule {
    let persona: Persona = .helper
    func homeView(isGuest: Bool, onRequireAuth: @escaping () -> Void) -> AnyView {
        AnyView(HelperHome())
    }
}

struct BusinessPersonaModule: PersonaModule {
    let persona: Persona = .business
    func homeView(isGuest: Bool, onRequireAuth: @escaping () -> Void) -> AnyView {
        AnyView(BusinessHome())
    }
}

struct ConsultantPersonaModule: PersonaModule {
    let persona: Persona = .consultant
    func homeView(isGuest: Bool, onRequireAuth: @escaping () -> Void) -> AnyView {
        AnyView(ConsultantHome())
    }
}

struct ToolOwnerPersonaModule: PersonaModule {
    let persona: Persona = .toolOwner
    func homeView(isGuest: Bool, onRequireAuth: @escaping () -> Void) -> AnyView {
        AnyView(ToolOwnerHome())
    }
}

struct FranchisePersonaModule: PersonaModule {
    let persona: Persona = .franchise
    func homeView(isGuest: Bool, onRequireAuth: @escaping () -> Void) -> AnyView {
        AnyView(FranchiseHome())
    }
}

struct InvestorPersonaModule: PersonaModule {
    let persona: Persona = .investor
    func homeView(isGuest: Bool, onRequireAuth: @escaping () -> Void) -> AnyView {
        AnyView(InvestorHome())
    }
}

// MARK: - Registry

@MainActor
enum PersonaRegistry {
    static let modules: [Persona: any PersonaModule] = [
        .customer:   CustomerPersonaModule(),
        .helper:     HelperPersonaModule(),
        .business:   BusinessPersonaModule(),
        .consultant: ConsultantPersonaModule(),
        .toolOwner:  ToolOwnerPersonaModule(),
        .franchise:  FranchisePersonaModule(),
        .investor:   InvestorPersonaModule(),
    ]

    static func module(for persona: Persona) -> any PersonaModule {
        modules[persona] ?? CustomerPersonaModule()
    }

    /// Personas the active country pack allows, in canonical order.
    /// Country can veto, never redesign — disabled personas simply don't
    /// appear; the ones that remain are byte-for-byte the same packs.
    static func enabledPersonas(country: CountryStore?) -> [Persona] {
        Persona.allCases.filter { country?.isPersonaEnabled($0) ?? true }
    }

    // MARK: - Persona-named tabs (docs/oxsteed-four-tabs-by-persona.md §0)
    //
    // The tabs change clothes, never bones: Tab 1 = operate, Tab 2 = Pulse
    // (constant for everyone), Tab 3 = move up, Tab 4 = get better. Labels
    // come from the persona pack; positions and icons never move.

    static func tabTitleKey(_ tab: AppTab, persona: Persona) -> String {
        switch tab {
        case .life:   return "tab.pulse"                          // the constant
        case .home:   return "tab.\(persona.packId).home"
        case .growth: return "tab.\(persona.packId).growth"
        case .learn:  return "tab.\(persona.packId).learn"
        }
    }

    // MARK: - Persona growth ladders (docs/oxsteed-four-tabs-by-persona.md, Tab 3)
    //
    // Each pack defines its own 4-step ladder as data. Progress is derived
    // from shared signals; ladders describe, they never demand — progress
    // only accumulates (product-definition rule 4).

    struct GrowthLadderSignals {
        var hasPulse = false
        var plannedNeeds = 0
        var jobsPosted = 0
        var guidesDone = 0
        var jobsCompleted = 0
        var badges = 0
    }

    struct GrowthLadderStepSpec: Identifiable {
        let id: Int
        let titleKey: String
        let descriptionKey: String
        let progress: Double
        let isActive: Bool
        let tapTab: String?
    }

    static func growthLadder(for persona: Persona, signals s: GrowthLadderSignals) -> [GrowthLadderStepSpec] {
        let p = persona.packId
        func key(_ n: Int, _ part: String) -> String { "growth.ladder.\(p).step\(n).\(part)" }

        // Step-completion heuristics. The customer ladder runs on planning
        // signals; every earning persona runs on learn → do → prove → scale.
        let steps: [(progress: Double, isActive: Bool, tapTab: String?)]
        switch persona {
        case .customer:
            steps = [
                (s.hasPulse ? 1.0 : 0.0, !s.hasPulse, "life"),
                (min(Double(s.plannedNeeds) / 3.0, 1.0), s.hasPulse && s.plannedNeeds < 3, "life"),
                (min(Double(s.jobsPosted) / 2.0, 1.0), s.plannedNeeds >= 3 && s.jobsPosted < 2, "home"),
                (0.0, s.jobsPosted >= 2, "learn"),
            ]
        default:
            steps = [
                (s.guidesDone > 0 ? 1.0 : 0.0, s.guidesDone == 0, "learn"),
                (min(Double(s.jobsCompleted) / 5.0, 1.0), s.guidesDone > 0 && s.jobsCompleted < 5, "home"),
                (min(Double(s.badges) / 3.0, 1.0), s.jobsCompleted >= 5 && s.badges < 3, "learn"),
                (0.0, s.badges >= 3, nil),
            ]
        }

        return steps.enumerated().map { idx, step in
            GrowthLadderStepSpec(
                id: idx + 1,
                titleKey: key(idx + 1, "title"),
                descriptionKey: key(idx + 1, "description"),
                progress: step.progress,
                isActive: step.isActive,
                tapTab: step.tapTab
            )
        }
    }
}
