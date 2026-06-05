import SwiftUI

enum AppTab: Hashable {
    case home, life, growth, learn
}

// MARK: - Deep-link destination

/// Resolved destination from a push notification tap or universal link.
enum AppDeepLink: Hashable {
    case conversation(id: String)
    case job(id: String)
    case bid(id: String)
    case notification                 // open notification centre
    case home                         // fallback
}

// MARK: - RootShellView

struct RootShellView: View {
    @EnvironmentObject private var personaStore: PersonaStore
    @State private var tab: AppTab = .home
    /// Pending deep-link set by push-tap handler; consumed by child views.
    @State private var pendingDeepLink: AppDeepLink?
    @State private var showPersonaSheet = false
    @State private var showBusinessRoleSetupSheet = false
    @State private var didApplyInitialPersonaEntry = false

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            Group {
                switch tab {
                case .home: HomeTabView(pendingDeepLink: $pendingDeepLink)
                case .life: LifeTabView()
                case .growth: GrowthTabView()
                case .learn: LearnTabView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .safeAreaInset(edge: .top, alignment: .trailing, spacing: 0) {
            GlobalOxPersonaButton {
                showPersonaSheet = true
            }
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .padding(.bottom, 6)
            .background(Theme.background.opacity(0.01))
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            OxTabBar(selection: $tab)
            .padding(.top, 8)
            .background(Theme.background.opacity(0.01))
        }
        .sheet(isPresented: $showPersonaSheet) {
            PersonaSwitcherSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showBusinessRoleSetupSheet) {
            BusinessRoleSetupSheet()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .onAppear(perform: applyInitialPersonaEntryIfNeeded)
        // Route push notification taps to the appropriate screen.
        .onReceive(NotificationCenter.default.publisher(for: .oxPushTapped)) { note in
            guard let info = note.userInfo else { return }
            handlePushTap(info)
        }
        // Allow any child view (e.g. Growth ladder steps) to switch tabs.
        .onReceive(NotificationCenter.default.publisher(for: .oxSwitchTab)) { note in
            guard let name = note.userInfo?["tab"] as? String else { return }
            withAnimation(.easeInOut(duration: 0.25)) {
                switch name {
                case "home":   tab = .home
                case "life":   tab = .life
                case "growth": tab = .growth
                case "learn":  tab = .learn
                default: break
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .oxOpenBusinessRoleSetup)) { _ in
            tab = .home
            if personaStore.active != .business {
                personaStore.active = .business
            }
            personaStore.hasExplicitPersona = true
            showBusinessRoleSetupSheet = true
        }
        // Handle oxsteed:// deep links (widgets, Spotlight, Handoff)
        .onOpenURL { url in
            handleDeepLink(url)
        }
        .onReceive(NotificationCenter.default.publisher(for: .oxOpenDeepLink)) { note in
            guard let url = note.userInfo?["url"] as? URL else { return }
            handleDeepLink(url)
        }
    }

    // MARK: - Deep-link routing

    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "oxsteed" else { return }
        let host = url.host ?? ""
        let path = url.pathComponents.filter { $0 != "/" }

        switch host {
        case "widget":
            // oxsteed://widget/home, oxsteed://widget/post-job
            let action = path.first ?? "home"
            switch action {
            case "post-job":
                tab = .home
                NotificationCenter.default.post(name: .oxIntentTriggerPostJob, object: nil)
            case "life":
                tab = .life
            default:
                tab = .home
            }

        case "job":
            // oxsteed://job/<id>
            if let id = path.first, !id.isEmpty {
                pendingDeepLink = .job(id: id)
                tab = .home
            }

        case "conversation":
            // oxsteed://conversation/<id>
            if let id = path.first, !id.isEmpty {
                pendingDeepLink = .conversation(id: id)
                tab = .home
            }

        case "inbox":
            tab = .home
            NotificationCenter.default.post(name: .oxIntentTriggerInbox, object: nil)

        default:
            tab = .home
        }
    }

    // MARK: - Push routing

    private func handlePushTap(_ info: [AnyHashable: Any]) {
        let type   = info["type"]   as? String ?? ""
        let itemId = info["id"]     as? String ?? info["jobId"] as? String ?? ""

        switch type {
        case "message:new", "conversation":
            if !itemId.isEmpty {
                pendingDeepLink = .conversation(id: itemId)
            }
            tab = .home

        case "bid:received", "bid:accepted", "bid:rejected":
            if !itemId.isEmpty {
                pendingDeepLink = .bid(id: itemId)
            }
            tab = .home

        case "job:created", "job:updated", "job:completed", "job:cancelled":
            if !itemId.isEmpty {
                pendingDeepLink = .job(id: itemId)
            }
            tab = .home

        case "appointment:created", "appointment:updated", "appointment:cancelled":
            tab = .home  // Calendar lives on home

        case "notification:new":
            pendingDeepLink = .notification
            tab = .home

        default:
            tab = .home
        }
    }

    private func applyInitialPersonaEntryIfNeeded() {
        guard !didApplyInitialPersonaEntry else { return }
        didApplyInitialPersonaEntry = true
        tab = personaStore.active.recommendedInitialShellTab
    }
}

private extension Persona {
    var recommendedInitialShellTab: AppTab {
        switch self {
        case .investor:
            return .growth
        default:
            return .home
        }
    }
}

private struct GlobalOxPersonaButton: View {
    let action: () -> Void
    @EnvironmentObject private var personaStore: PersonaStore
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: displayIcon)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(displayColor)
                    .frame(width: 24, height: 24)
                    .background(displayColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 1) {
                    Text("OxPersona")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(Theme.textTertiary)
                    Text(displayName)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                }
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
            .shadow(color: .black.opacity(0.10), radius: 10, y: 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Switch OxPersona")
    }

    private var displayName: String {
        if personaStore.active == .business {
            return personaStore.businessSubPersona.rawValue
        }
        return localization.localized(L10n.PersonaKey.name(for: personaStore.active))
    }

    private var displayIcon: String {
        personaStore.active == .business ? personaStore.businessSubPersona.icon : personaStore.active.icon
    }

    private var displayColor: Color {
        personaStore.active == .business ? personaStore.businessSubPersona.color : personaStore.active.color
    }
}

extension Notification.Name {
    static let oxOpenDeepLink = Notification.Name("ox.open.deepLink")
}

extension Notification.Name {
    static let oxOpenConversation = Notification.Name("ox.open.conversation")
    static let oxOpenJob = Notification.Name("ox.open.job")
    static let oxOpenBid = Notification.Name("ox.open.bid")
}

private struct BusinessRoleSetupSheet: View {
    @EnvironmentObject private var personaStore: PersonaStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "person.3.fill")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Theme.pillarGoals)
                        .frame(width: 42, height: 42)
                        .background(Theme.pillarGoals.opacity(0.14), in: RoundedRectangle(cornerRadius: 13))

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Set up your team roles")
                            .font(.system(size: 22, weight: .heavy))
                            .foregroundStyle(Theme.textPrimary)
                        Text("Choose the role you need to organize first. Home, Learn, Growth, and Life will adjust around that Business Owner sub-role.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                BusinessSubPersonaPicker(
                    selection: $personaStore.businessSubPersona,
                    title: "Who should OxSteed help you set up first?",
                    subtitle: "Owner / Operator keeps the whole operation visible. Manager, Representative, Support, and Employee focus the loop around that team's work."
                )

                roleQuestionCard

                VStack(alignment: .leading, spacing: 9) {
                    roleSignal("Home", "activates the matching operations view.")
                    roleSignal("Learn", "prioritizes the right SOPs, scripts, QA, or training path.")
                    roleSignal("Growth", "re-ranks programs around the selected team function.")
                }
                .padding(13)
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.stroke, lineWidth: 1))

                Button {
                    dismiss()
                } label: {
                    Text("Use \(personaStore.businessSubPersona.rawValue)")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .onAppear {
            if personaStore.active != .business {
                personaStore.active = .business
            }
            personaStore.hasExplicitPersona = true
            ensureRoleSetupSelection(for: personaStore.businessSubPersona)
        }
        .onChange(of: personaStore.businessSubPersona) { _, role in
            ensureRoleSetupSelection(for: role)
        }
    }

    private var roleQuestionCard: some View {
        let role = personaStore.businessSubPersona
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(role.setupQuestion)
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text(role.setupActivation)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 8) {
                ForEach(role.setupOptions) { option in
                    roleQuestionOption(option, color: role.color)
                }
            }
        }
        .padding(13)
        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private func roleQuestionOption(_ option: BusinessRoleSetupOption, color: Color) -> some View {
        let role = personaStore.businessSubPersona
        let isSelected = (personaStore.businessRoleSetupOptionID(for: role) ?? role.setupOptions.first?.id) == option.id
        return Button {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                personaStore.setBusinessRoleSetupOptionID(option.id, for: role)
            }
        } label: {
            HStack(alignment: .top, spacing: 9) {
                Image(systemName: option.icon)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(color)
                    .frame(width: 30, height: 30)
                    .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 9))

                VStack(alignment: .leading, spacing: 2) {
                    Text(option.title)
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(option.detail)
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(color)
                }
            }
            .padding(10)
            .background(isSelected ? color.opacity(0.10) : Theme.surface, in: RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(isSelected ? color.opacity(0.42) : Theme.stroke, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func ensureRoleSetupSelection(for role: BusinessSubPersona) {
        guard personaStore.businessRoleSetupOptionID(for: role) == nil,
              let defaultID = role.setupOptions.first?.id else { return }
        personaStore.setBusinessRoleSetupOptionID(defaultID, for: role)
    }

    private func roleSignal(_ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.success)
                .padding(.top, 2)
            Text("\(title) \(detail)")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct OxTabBar: View {
    @Binding var selection: AppTab
    @Environment(\.colorScheme) private var colorScheme
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        HStack(spacing: 0) {
            tabButton(.home, label: L10n.tab(.home), icon: "square.grid.2x2.fill")
            tabButton(.life, label: L10n.tab(.life), icon: "heart.text.square.fill")
            tabButton(.growth, label: L10n.tab(.growth), icon: "arrow.up.right.circle.fill")
            tabButton(.learn, label: L10n.tab(.learn), icon: "graduationcap.fill")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(Theme.surface.opacity(0.95))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .strokeBorder(Theme.stroke, lineWidth: 1)
        )
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.40 : 0.12), radius: 18, y: 8)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func tabButton(_ value: AppTab, label: String, icon: String) -> some View {
        let isSelected = selection == value
        return Button {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                selection = value
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                Text(localization.localized(label))
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(isSelected ? Theme.accent : Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(isSelected ? Theme.accentSoft : Color.clear)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    RootShellView().environmentObject(PersonaStore())
}
