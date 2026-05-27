import SwiftUI

struct HomeTabView: View {
    @EnvironmentObject var personaStore: PersonaStore
    @EnvironmentObject var notifications: NotificationsStore
    @State private var showPersonaSheet = false
    @State private var showSettingsSheet = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    HomeHeader(
                        persona: personaStore.active,
                        unread: notifications.unreadCount,
                        onTapPersona: { showPersonaSheet = true },
                        onTapSettings: { showSettingsSheet = true }
                    )
                    .padding(.horizontal, 20)
                    .padding(.top, 8)

                    HomeContent(persona: personaStore.active)
                        .padding(.horizontal, 20)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                        .id(personaStore.active)
                }
                .padding(.bottom, 24)
            }
            .background(Theme.background.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
        .task { await notifications.load() }
        .sheet(isPresented: $showPersonaSheet) {
            PersonaSwitcherSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showSettingsSheet) {
            SettingsSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.86), value: personaStore.active)
    }
}

private struct HomeHeader: View {
    let persona: Persona
    let unread: Int
    let onTapPersona: () -> Void
    let onTapSettings: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                LogoMark()
                VStack(alignment: .leading, spacing: 2) {
                    Text(L10n.appName)
                        .font(.system(size: 22, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(L10n.greeting)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                IconChip(systemName: "bell.fill", badge: unread > 0 ? unread : nil)
                Button(action: onTapSettings) {
                    IconChip(systemName: "gearshape.fill")
                }
                .buttonStyle(.plain)
            }

            Button(action: onTapPersona) {
                HStack(spacing: 12) {
                    Image(systemName: persona.icon)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(persona.color)
                        .frame(width: 36, height: 36)
                        .background(persona.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L10n.PersonaKey.actingAs)
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(1.2)
                            .foregroundStyle(Theme.textTertiary)
                            .textCase(.uppercase)
                        Text(L10n.PersonaKey.name(for: persona))
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                    }
                    Spacer()
                    Text(L10n.PersonaKey.switchAction)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
                .cardStyle()
            }
            .buttonStyle(.plain)
        }
    }
}

private struct LogoMark: View {
    var body: some View {
        ZStack {
            Circle().fill(
                LinearGradient(colors: [Theme.accent, Theme.accentDeep], startPoint: .topLeading, endPoint: .bottomTrailing)
            )
            Image(systemName: "scope")
                .font(.system(size: 18, weight: .black))
                .foregroundStyle(.white)
        }
        .frame(width: 38, height: 38)
    }
}

private struct IconChip: View {
    let systemName: String
    var badge: Int? = nil

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: 38, height: 38)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
            if let badge, badge > 0 {
                Text("\(badge)")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5).padding(.vertical, 2)
                    .background(Theme.accent, in: Capsule())
                    .offset(x: 6, y: -4)
            }
        }
    }
}

private struct HomeContent: View {
    let persona: Persona
    var body: some View {
        switch persona {
        case .customer: CustomerHome()
        case .helper: HelperHome()
        case .business: BusinessHome()
        case .consultant: ConsultantHome()
        case .toolOwner: ToolOwnerHome()
        case .franchise: FranchiseHome()
        case .investor: InvestorHome()
        }
    }
}
