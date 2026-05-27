import SwiftUI

struct HomeTabView: View {
    @EnvironmentObject var personaStore: PersonaStore
    @State private var showPersonaSheet = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                HomeHeader(persona: personaStore.active) { showPersonaSheet = true }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)

                HomeContent(persona: personaStore.active)
                    .padding(.horizontal, 20)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                    .id(personaStore.active) // re-build only this section on switch
            }
            .padding(.bottom, 24)
        }
        .background(Theme.background.ignoresSafeArea())
        .sheet(isPresented: $showPersonaSheet) {
            PersonaSwitcherSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.86), value: personaStore.active)
    }
}

// MARK: - Header

private struct HomeHeader: View {
    let persona: Persona
    let onTapPersona: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                LogoMark()
                VStack(alignment: .leading, spacing: 2) {
                    Text("OxSteed")
                        .font(.system(size: 22, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text("Good morning, Alex")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                IconChip(systemName: "magnifyingglass")
                IconChip(systemName: "bell.fill", badge: 3)
            }

            Button(action: onTapPersona) {
                HStack(spacing: 12) {
                    Image(systemName: persona.icon)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(persona.color)
                        .frame(width: 36, height: 36)
                        .background(persona.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Acting as")
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(1.2)
                            .foregroundStyle(Theme.textTertiary)
                            .textCase(.uppercase)
                        Text(persona.rawValue)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                    }
                    Spacer()
                    Text("Switch")
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
                .overlay(
                    RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1)
                )
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

// MARK: - Persona-specific content

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
