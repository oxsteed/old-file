import SwiftUI

// ─── Stats grid for OxSteedOne TodayView ─────────────────────────────────────
// Uses @Observable OneStore + OxSteedOne's HomeSection/HomeCard models

struct OneTodayStatsGrid: View {
    @Environment(OneStore.self) private var store

    var body: some View {
        let topCards = store.homeSections.first?.cards.prefix(3) ?? []
        HStack(spacing: 12) {
            ForEach(Array(topCards)) { card in
                StatPill(card: card)
            }
        }
    }
}

private struct StatPill: View {
    let card: HomeCard

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: card.symbolName)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(OneTheme.amber)
            Text(card.value)
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(card.title)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.white.opacity(0.65))
                .lineLimit(1)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(.white.opacity(0.13), lineWidth: 1)
        )
    }
}
