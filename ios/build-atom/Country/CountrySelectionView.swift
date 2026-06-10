import SwiftUI

// MARK: - Country picker
//
// Lists active countries (selectable) and coming-soon countries (visible,
// inert). Adding a country to either list is a server-side row change —
// this view never names a country.

struct CountrySelectionView: View {
    @EnvironmentObject private var country: CountryStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss
    @State private var switching = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(localization.localized("country.title"))
                        .font(.system(size: 22, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(localization.localized("country.subtitle"))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.top, 8)

                if country.available.isEmpty && country.comingSoon.isEmpty && country.isLoading {
                    ProgressView()
                        .tint(Theme.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 24)
                } else {
                    if !country.available.isEmpty {
                        sectionLabel("country.available")
                        VStack(spacing: 10) {
                            ForEach(country.available) { entry in
                                Button {
                                    Task {
                                        switching = true
                                        await country.select(entry)
                                        switching = false
                                        dismiss()
                                    }
                                } label: {
                                    countryRow(entry, selectable: true)
                                }
                                .buttonStyle(.plain)
                                .disabled(switching)
                            }
                        }
                    }

                    if !country.comingSoon.isEmpty {
                        sectionLabel("country.coming_soon")
                        VStack(spacing: 10) {
                            ForEach(country.comingSoon) { entry in
                                countryRow(entry, selectable: false)
                            }
                        }
                        Text(localization.localized("country.coming_soon_hint"))
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textTertiary)
                            .padding(.horizontal, 4)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Theme.background.ignoresSafeArea())
        .task { await country.load() }
    }

    private func sectionLabel(_ key: String) -> some View {
        Text(localization.localized(key))
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Theme.textSecondary)
            .textCase(.uppercase)
            .padding(.top, 4)
    }

    private func countryRow(_ entry: APICountryListEntry, selectable: Bool) -> some View {
        let isSelected = selectable && entry.code == country.selectedCode
        return HStack(spacing: 14) {
            Text(entry.flag_emoji ?? "")
                .font(.system(size: 26))
                .frame(width: 44, height: 44)
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                .opacity(selectable ? 1 : 0.55)

            VStack(alignment: .leading, spacing: 3) {
                Text(entry.name)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(selectable ? Theme.textPrimary : Theme.textSecondary)
                if let locales = entry.locales, !locales.isEmpty {
                    Text(locales.map { $0.uppercased() }.joined(separator: " · "))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            Spacer()

            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Theme.accent)
                    .font(.system(size: 20))
            } else if !selectable {
                Text(localization.localized("country.coming_soon_badge"))
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.warning)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Theme.warning.opacity(0.12), in: Capsule())
            } else {
                Image(systemName: "chevron.right")
                    .foregroundStyle(Theme.textTertiary)
                    .font(.system(size: 13, weight: .bold))
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(isSelected ? Theme.accentSoft : Theme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(isSelected ? Theme.accent.opacity(0.5) : Theme.stroke, lineWidth: 1)
        )
    }
}

#Preview {
    CountrySelectionView()
        .environmentObject(CountryStore())
        .environmentObject(LocalizationManager())
}
