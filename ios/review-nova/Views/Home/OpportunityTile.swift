import SwiftUI

struct OpportunityTile: View {
    let card: OpportunityCard

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(card.badge.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.8)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(.white.opacity(0.22), in: Capsule())
                Spacer()
                Image(systemName: card.icon)
                    .font(.title3.weight(.semibold))
            }
            Spacer(minLength: 8)
            Text(card.title)
                .font(.system(.headline, design: .rounded, weight: .semibold))
                .lineLimit(2)
            Text(card.subtitle)
                .font(.footnote)
                .opacity(0.9)
                .lineLimit(2)
            HStack {
                Spacer()
                Text("Open")
                    .font(.footnote.weight(.bold))
                Image(systemName: "arrow.right")
                    .font(.footnote.weight(.bold))
            }
            .padding(.top, 4)
        }
        .padding(16)
        .frame(height: 180, alignment: .topLeading)
        .foregroundStyle(.white)
        .background(
            LinearGradient(colors: [card.tint, card.tint.opacity(0.7)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 20, style: .continuous)
        )
        .shadow(color: card.tint.opacity(0.25), radius: 8, x: 0, y: 4)
    }
}
