import SwiftUI

// ─── Persona-aware home sections cards for OxSteedOne ─────────────────────────
// Replaces the plain ForEach(store.homeSections) block in TodayView

struct OneTodayHomeSections: View {
    @Environment(OneStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(store.homeSections) { section in
                HomeSectionCard(section: section)
            }
        }
        .id(store.homeReloadToken)
    }
}

private struct HomeSectionCard: View {
    @Environment(OneStore.self) private var store
    let section: HomeSection

    var body: some View {
        GoCard {
            HStack {
                Text(section.title)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                Spacer()
                Text("\(section.cards.count) metrics")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.45))
            }
            VStack(spacing: 2) {
                ForEach(section.cards) { card in
                    HomeCardRow(card: card, masked: store.appPreferences.privacyMode)
                    if card.id != section.cards.last?.id {
                        Divider().opacity(0.15).padding(.leading, 38)
                    }
                }
            }
        }
    }
}

private struct HomeCardRow: View {
    let card: HomeCard
    let masked: Bool

    private var displayValue: String {
        guard masked else { return card.value }
        return String(repeating: "•", count: max(4, min(card.value.count, 8)))
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            GoModeGlyph(symbolName: card.symbolName, size: 34)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(card.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                    Spacer()
                    Text(displayValue)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(OneTheme.amber)
                }
                Text(card.detail)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
        .padding(.vertical, 8)
    }
}
