import SwiftUI

struct ModuleListView: View {
    let tab: OxSteedTab

    @Environment(SessionStore.self) private var session
    @Environment(MobileExperienceStore.self) private var experience

    var body: some View {
        @Bindable var experience = experience

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if tab == .today {
                    HeroPanel()
                    SignalGrid()
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text(sectionTitle)
                        .font(.title2.bold())
                    Text(sectionSubtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                ForEach(experience.modules(for: tab)) { module in
                    NavigationLink(value: module) {
                        CapabilityModuleCard(module: module)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(tab == .today ? "OxSteed" : tab.title)
        .searchable(text: $experience.searchText, prompt: "Search OxSteed actions")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Toggle(isOn: $experience.showAuthenticatedOnly) {
                    Image(systemName: "lock.shield")
                }
                .toggleStyle(.button)
                .accessibilityLabel("Show authenticated actions")
            }
        }
        .navigationDestination(for: CapabilityModule.self) { module in
            ModuleDetailView(module: module)
        }
        .sheet(item: Binding(
            get: { experience.selectedDomain },
            set: { experience.selectedDomain = $0 }
        )) { domain in
            DomainRouteSheet(domain: domain)
        }
    }

    private var sectionTitle: String {
        switch tab {
        case .today:
            "Everything users can do on the website"
        case .marketplace:
            "Discovery, cart, checkout, and commerce"
        case .work:
            "Helper, message, support, and consulting work"
        case .logistics:
            "Logistics, internal operations, and admin control"
        case .business:
            "Business owner and operator workspaces"
        case .account:
            "Account, settings, safety, and legal"
        }
    }

    private var sectionSubtitle: String {
        switch tab {
        case .today:
            "The first native pass maps the full web surface into stable SwiftUI destinations and API contracts."
        case .marketplace:
            "Products, tools, helper discovery, shopping lists, checkout, invoices, and orders."
        case .work:
            "The daily workbench for helpers, conversations, support, consulting, and launch flows."
        case .logistics:
            "Branch-level logistics plus route-gated employee/admin workspaces."
        case .business:
            "Business services, appointments, intake, quotes, inventory, teams, and recurring operations."
        case .account:
            "Auth, modes, verification, disputes, consent, policies, and settings."
        }
    }
}

private struct HeroPanel: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Native OxSteed")
                        .font(.largeTitle.bold())
                        .foregroundStyle(.white)
                    Text("A real SwiftUI app shell for the whole marketplace, not a webview costume with a fake mustache.")
                        .font(.headline)
                        .foregroundStyle(.white.opacity(0.72))
                }
                Spacer()
                Image(systemName: "iphone.gen3.radiowaves.left.and.right")
                    .font(.system(size: 44, weight: .semibold))
                    .foregroundStyle(AppTheme.gold)
            }

            HStack(spacing: 10) {
                Label(session.isAuthenticated ? "Signed in" : "Signed out", systemImage: session.isAuthenticated ? "checkmark.seal.fill" : "person.crop.circle.badge.exclamationmark")
                Text("Mode: \(session.selectedMode.capitalized)")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.58))
        }
        .padding(20)
        .background(AppTheme.heroGradient, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(.white.opacity(0.16), lineWidth: 1)
        )
    }
}

private struct SignalGrid: View {
    @Environment(MobileExperienceStore.self) private var experience

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            ForEach(experience.dashboardSignals) { signal in
                VStack(alignment: .leading, spacing: 10) {
                    Image(systemName: signal.symbolName)
                        .font(.title3)
                        .foregroundStyle(AppTheme.gold)
                    Text(signal.value)
                        .font(.title.bold())
                    Text(signal.label)
                        .font(.headline)
                    Text(signal.note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(AppTheme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
        }
    }
}
