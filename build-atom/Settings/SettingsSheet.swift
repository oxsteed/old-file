import SwiftUI

struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var localization: LocalizationManager

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    languageCard
                    placeholderCard(icon: "bell.fill", title: L10n.SettingsKey.notifications, color: Theme.pillarHome)
                    placeholderCard(icon: "lock.shield.fill", title: L10n.SettingsKey.privacy, color: Theme.pillarMoney)
                    placeholderCard(icon: "paintbrush.fill", title: L10n.SettingsKey.appearance, color: Theme.pillarPersonal)
                }
                .padding(20)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text(L10n.SettingsKey.title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Text(L10n.SettingsKey.done)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                    }
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    // MARK: - Language

    private var languageCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "globe")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 36, height: 36)
                    .background(Theme.accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(L10n.SettingsKey.language)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(L10n.SettingsKey.languageSubtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
            }

            VStack(spacing: 8) {
                ForEach(AppLanguage.allCases) { lang in
                    languageRow(lang)
                }
            }
        }
        .cardStyle()
    }

    private func languageRow(_ lang: AppLanguage) -> some View {
        let isSelected = localization.language == lang
        return Button {
            withAnimation(.easeInOut(duration: 0.22)) {
                localization.language = lang
            }
        } label: {
            HStack(spacing: 12) {
                Text(lang.flag)
                    .font(.system(size: 22))
                    .frame(width: 32, height: 32)
                Text(lang.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(isSelected ? Theme.accent.opacity(0.14) : Theme.surfaceElevated)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(isSelected ? Theme.accent.opacity(0.4) : Theme.stroke, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Placeholder rows

    private func placeholderCard(icon: String, title: LocalizedStringKey, color: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 36, height: 36)
                .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textTertiary)
        }
        .cardStyle()
    }
}

#Preview {
    SettingsSheet()
        .environmentObject(LocalizationManager())
        .preferredColorScheme(.dark)
}
