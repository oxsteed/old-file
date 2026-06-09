import SwiftUI

struct PersonaSwitcherSheet: View {
    @EnvironmentObject var personaStore: PersonaStore
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss
    @State private var switchingTo: Persona?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 6) {
                    Text(localization.localized(L10n.PersonaKey.title))
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(localization.localized(L10n.PersonaKey.subtitle))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
                .padding(.top, 8)

                VStack(spacing: 10) {
                    ForEach(Persona.allCases) { persona in
                        Button {
                            Task { await switchPersona(persona) }
                        } label: {
                            row(for: persona)
                        }
                        .buttonStyle(.plain)
                        .disabled(switchingTo != nil)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, error == nil ? 30 : 0)

                if let error {
                    Text(error)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.danger)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 30)
                }
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }

    private func row(for persona: Persona) -> some View {
        let isActive = persona == personaStore.active
        let isSwitching = switchingTo == persona
        return HStack(spacing: 14) {
            Image(systemName: persona.icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(persona.color)
                .frame(width: 44, height: 44)
                .background(persona.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text(localization.localized(L10n.PersonaKey.name(for: persona)))
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(persona.tagline)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            if isSwitching {
                ProgressView()
                    .tint(Theme.accent)
            } else if isActive {
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

    @MainActor
    private func switchPersona(_ persona: Persona) async {
        guard switchingTo == nil else { return }
        let previous = personaStore.active
        error = nil
        switchingTo = persona
        personaStore.active = persona
        let succeeded = await auth.switchPersona(persona)
        switchingTo = nil
        if succeeded {
            dismiss()
        } else {
            personaStore.active = previous
            error = auth.lastError ?? "Could not switch workspace. Please try again."
        }
    }
}
