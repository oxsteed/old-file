import SwiftUI

struct PlaceholderView: View {
    let tab: AppTab
    let tint: Color
    let headline: String
    let blurb: String

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Spacer()
                ZStack {
                    Circle()
                        .fill(tint.opacity(0.15))
                        .frame(width: 140, height: 140)
                    Image(systemName: tab.icon)
                        .font(.system(size: 56, weight: .semibold))
                        .foregroundStyle(tint)
                }
                Text(headline)
                    .font(.system(.title2, design: .rounded, weight: .bold))
                Text(blurb)
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 32)
                Text("Coming soon")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(tint.opacity(0.15), in: Capsule())
                    .foregroundStyle(tint)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemGroupedBackground))
            .navigationTitle(tab.title)
        }
    }
}

#Preview {
    PlaceholderView(tab: .life, tint: OneTheme.danger,
                    headline: "Your Life Pulse",
                    blurb: "Track 6 pillars of life with a personalized urgency queue.")
}
