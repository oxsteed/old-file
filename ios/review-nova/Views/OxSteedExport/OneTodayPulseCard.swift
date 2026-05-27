import SwiftUI

// ─── Pulse card for OxSteedOne TodayView ─────────────────────────────────────
// Uses OxSteedOne's PulsePillar model (tintHex: String, score, weight, title)

struct OneTodayPulseCard: View {
    @Environment(OneStore.self) private var store
    @State private var animateBars = false

    private var pillars: [PulsePillar] { store.pulsePillars }
    private var score: Int { store.pulseScore }

    var body: some View {
        GoCard {
            headerRow
            scoreRing
            pillarBars
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.9).delay(0.2)) { animateBars = true }
        }
    }

    private var headerRow: some View {
        HStack {
            Label("Life Pulse", systemImage: "heart.text.square.fill")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
            Spacer()
            Text("Score \(score)")
                .font(.caption.weight(.bold))
                .foregroundStyle(OneTheme.amber)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(OneTheme.amber.opacity(0.14), in: Capsule())
        }
    }

    private var scoreRing: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .stroke(.white.opacity(0.12), lineWidth: 8)
                    .frame(width: 72, height: 72)
                Circle()
                    .trim(from: 0, to: animateBars ? CGFloat(score) / 100 : 0)
                    .stroke(
                        AngularGradient(
                            colors: [OneTheme.amber, Color(red: 0.93, green: 0.28, blue: 0.01)],
                            center: .center
                        ),
                        style: StrokeStyle(lineWidth: 8, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .frame(width: 72, height: 72)
                    .animation(.easeOut(duration: 1.0).delay(0.1), value: animateBars)
                VStack(spacing: 1) {
                    Text("\(score)")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .foregroundStyle(.white)
                    Text("/ 100")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(pulseLabel(score))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                Text("Weighted across \(pillars.count) life pillars")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.6))
                if let top = pillars.sorted(by: { $0.score > $1.score }).first {
                    Text("Top: \(top.title) · \(top.score)%")
                        .font(.caption2)
                        .foregroundStyle(OneTheme.amber)
                }
            }
        }
    }

    private var pillarBars: some View {
        VStack(spacing: 8) {
            ForEach(pillars) { pillar in
                PillarBarRow(pillar: pillar, animateBars: animateBars)
            }
        }
    }

    private func pulseLabel(_ s: Int) -> String {
        switch s {
        case 85...: return "Thriving"
        case 70..<85: return "On Track"
        case 55..<70: return "Needs Attention"
        default: return "Critical"
        }
    }
}

private struct PillarBarRow: View {
    let pillar: PulsePillar
    let animateBars: Bool

    private var tint: Color {
        Color(hex: pillar.tintHex) ?? OneTheme.amber
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(pillar.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                Spacer()
                Text("\(pillar.score)%")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(tint)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.1))
                    Capsule()
                        .fill(tint.opacity(0.85))
                        .frame(width: animateBars
                               ? geo.size.width * CGFloat(pillar.score) / 100
                               : 0)
                        .animation(.easeOut(duration: 0.8).delay(Double(pillar.weight) * 0.03), value: animateBars)
                }
            }
            .frame(height: 6)
        }
    }
}

// MARK: - Color from hex helper (local scope)
private extension Color {
    init?(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        guard Scanner(string: hex).scanHexInt64(&int) else { return nil }
        let a, r, g, b: UInt64
        switch hex.count {
        case 6:
            (a, r, g, b) = (255, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = ((int >> 24) & 0xFF, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            return nil
        }
        self.init(.sRGB,
                  red: Double(r) / 255,
                  green: Double(g) / 255,
                  blue: Double(b) / 255,
                  opacity: Double(a) / 255)
    }
}
