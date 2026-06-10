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
}
