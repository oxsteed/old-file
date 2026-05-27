import SwiftUI

// ─── Persona picker bottom sheet for OxSteedOne ───────────────────────────────
// Compatible with @Observable OneStore

struct OnePersonaPickerSheet: View {
    @Environment(OneStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color(red: 0.01, green: 0.05, blue: 0.09).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 20) {
                sheetHandle
                sheetHeader
                personaGrid
                Spacer()
            }
            .padding(.horizontal, 20)
        }
    }

    private var sheetHandle: some View {
        HStack {
            Spacer()
            RoundedRectangle(cornerRadius: 3)
                .fill(.white.opacity(0.25))
                .frame(width: 36, height: 5)
            Spacer()
        }
        .padding(.top, 12)
    }

    private var sheetHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Switch Persona")
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(.white)
            Text("One account — many roles. Switch anytime.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.6))
        }
    }

    private var personaGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            ForEach(AppPersona.allCases) { persona in
                PersonaCell(
                    persona: persona,
                    isActive: store.activePersona == persona
                ) {
                    store.personaContext.activePersona = persona
                    store.homeReloadToken = UUID()
                    dismiss()
                }
            }
        }
    }
}

private struct PersonaCell: View {
    let persona: AppPersona
    let isActive: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                Image(systemName: personaIcon(persona))
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(isActive ? .black : OneTheme.amber)
                    .frame(width: 36, height: 36)
                    .background(
                        isActive ? OneTheme.amber : OneTheme.amber.opacity(0.12),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
                VStack(alignment: .leading, spacing: 2) {
                    Text(persona.label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                    Text(personaTagline(persona))
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.55))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(
                isActive ? OneTheme.amber.opacity(0.18) : .white.opacity(0.07),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isActive ? OneTheme.amber.opacity(0.5) : .white.opacity(0.1), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func personaIcon(_ p: AppPersona) -> String {
        switch p {
        case .customer: return "person.fill"
        case .helper: return "wrench.and.screwdriver.fill"
        case .businessOwner: return "building.2.fill"
        case .consultant: return "lightbulb.fill"
        case .toolOwner: return "hammer.fill"
        case .franchiseOwner: return "mappin.and.ellipse"
        case .investor: return "chart.line.uptrend.xyaxis"
        }
    }

    private func personaTagline(_ p: AppPersona) -> String {
        switch p {
        case .customer: return "Find help & manage life"
        case .helper: return "Earn more, bid smart"
        case .businessOwner: return "Run your team & scale"
        case .consultant: return "Grow clients & close deals"
        case .toolOwner: return "Rent tools, earn passively"
        case .franchiseOwner: return "Expand territory & revenue"
        case .investor: return "Fund & grow wealth"
        }
    }
}
