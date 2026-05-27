import SwiftUI

struct PersonaSwitcherSheet: View {
    @EnvironmentObject var personaStore: PersonaStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 6) {
                    Text(L10n.PersonaKey.title)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(L10n.PersonaKey.subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
                .padding(.top, 8)

                VStack(spacing: 10) {
                    ForEach(Persona.allCases) { persona in
                        Button {
                            personaStore.active = persona
                            dismiss()
                        } label: {
                            row(for: persona)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 30)
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }

    private func row(for persona: Persona) -> some View {
        let isActive = persona == personaStore.active
        return HStack(spacing: 14) {
            Image(systemName: persona.icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(persona.color)
                .frame(width: 44, height: 44)
                .background(persona.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text(L10n.PersonaKey.name(for: persona))
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(persona.tagline)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            if isActive {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Theme.accent)
                    .font(.system(size: 20))
            } else {
                Image(systemName: "chevron.right")
                    .foregroundStyle(Theme.textTertiary)
                    .font(.system(size: 13, weight: .bold))
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(isActive ? Theme.accentSoft : Theme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(isActive ? Theme.accent.opacity(0.5) : Theme.stroke, lineWidth: 1)
        )
    }
}
