import SwiftUI

struct PulseCard: View {
    let pillars: [PulsePillar]

    private var overall: Int {
        guard !pillars.isEmpty else { return 0 }
        return pillars.map(\.score).reduce(0, +) / pillars.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Overall pulse")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text("\(overall)")
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .foregroundStyle(OneTheme.accent)
                    Text("balanced & rising")
                        .font(.caption)
                        .foregroundStyle(OneTheme.success)
                }
                Spacer()
                PulseRing(value: Double(overall) / 100.0)
                    .frame(width: 78, height: 78)
            }

            VStack(spacing: 10) {
                ForEach(pillars) { pillar in
                    PulseRow(pillar: pillar)
                }
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground),
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private struct PulseRow: View {
    let pillar: PulsePillar
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: pillar.icon)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(pillar.tint)
                .frame(width: 22)
            Text(pillar.name)
                .font(.subheadline.weight(.medium))
                .frame(width: 70, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(pillar.tint.opacity(0.15))
                    Capsule().fill(pillar.tint)
                        .frame(width: geo.size.width * (CGFloat(pillar.score) / 100.0))
                }
            }
            .frame(height: 8)
            Text("\(pillar.score)")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
                .frame(width: 28, alignment: .trailing)
        }
    }
}

private struct PulseRing: View {
    let value: Double
    var body: some View {
        ZStack {
            Circle()
                .stroke(OneTheme.accent.opacity(0.15), lineWidth: 9)
            Circle()
                .trim(from: 0, to: value)
                .stroke(OneTheme.heroGradient,
                        style: StrokeStyle(lineWidth: 9, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Image(systemName: "waveform.path.ecg")
                .font(.headline)
                .foregroundStyle(OneTheme.accent)
        }
    }
}
