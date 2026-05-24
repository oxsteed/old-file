import Foundation
import Observation

@Observable
final class MobileExperienceStore {
    var selectedTab: OxSteedTab = .today
    var selectedDomain: CapabilityDomain?
    var searchText = ""
    var showAuthenticatedOnly = false
    var modules = OxSteedCapabilityCatalog.modules

    var dashboardSignals: [DashboardSignal] {
        [
            DashboardSignal(label: "Native domains", value: "\(CapabilityDomain.allCases.count)", note: "Every major website capability group has an iOS destination.", symbolName: "square.grid.3x3"),
            DashboardSignal(label: "Mapped routes", value: "\(CapabilityDomain.allCases.flatMap(\.routeFamily).count)", note: "Route families are represented before detail screens fan out.", symbolName: "point.3.connected.trianglepath.dotted"),
            DashboardSignal(label: "Actions", value: "\(modules.flatMap(\.actions).count)", note: "Concrete native actions tied to existing backend contracts.", symbolName: "checklist")
        ]
    }

    var visibleModules: [CapabilityModule] {
        modules.filter { module in
            module.domain.tab == selectedTab || selectedTab == .today && module.domain == .customer || selectedTab == .today && module.domain == .learning
        }
        .filter { module in
            guard showAuthenticatedOnly else { return true }
            return module.actions.contains(where: \.requiresAuth)
        }
        .filter { module in
            let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return true }

            return module.title.localizedCaseInsensitiveContains(trimmed) ||
                module.summary.localizedCaseInsensitiveContains(trimmed) ||
                module.domain.title.localizedCaseInsensitiveContains(trimmed) ||
                module.actions.contains { action in
                    action.title.localizedCaseInsensitiveContains(trimmed) ||
                        action.detail.localizedCaseInsensitiveContains(trimmed) ||
                        action.endpointHint.localizedCaseInsensitiveContains(trimmed)
                }
        }
    }

    func modules(for tab: OxSteedTab) -> [CapabilityModule] {
        let oldTab = selectedTab
        selectedTab = tab
        defer { selectedTab = oldTab }
        return visibleModules
    }
}
