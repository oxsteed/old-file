import SwiftUI

struct LifeTabView: View {
    private var pillars: [PulsePillar] { Samples.pillars }

    private var overallScore: Int {
        let total = pillars.map { Double($0.score * $0.weight) }.reduce(0, +)
        let weights = pillars.map { Double($0.weight) }.reduce(0, +)
        return Int(round(total / weights))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                LifeHeader()
                PulseCard(score: overallScore, pillars: pillars)
                UrgencyQueue(pillars: pillars)
                PillarGrid(pillars: pillars)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Theme.background.ignoresSafeArea())
    }
}

private struct LifeHeader: View {
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("LIFE").sectionTitle()
                Text("Your personal pulse")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
            }
            Spacer()
            Image(systemName: "ellipsis.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Theme.textSecondary)
        }
    }
}

private struct PulseCard: View {
    let score: Int
    let pillars: [PulsePillar]

    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                PulseRing(pillars: pillars)
                    .frame(width: 200, height: 200)
                VStack(spacing: 2) {
                    Text("\(score)")
                        .font(.system(size: 52, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text("Pulse")
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(2)
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .padding(.top, 4)

            HStack(spacing: 16) {
                legend(color: Theme.success, label: "On track")
                legend(color: Theme.warning, label: "Slipping")
                legend(color: Theme.danger, label: "Critical")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .cardStyle()
    }

    private func legend(color: Color, label: String) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.textSecondary)
        }
    }
}

private struct PulseRing: View {
    let pillars: [PulsePillar]

    var body: some View {
        ZStack {
            Circle()
                .stroke(Theme.surfaceElevated, lineWidth: 18)

            ForEach(Array(slices().enumerated()), id: \.offset) { _, slice in
                Circle()
                    .trim(from: slice.start, to: slice.end)
                    .stroke(slice.color, style: StrokeStyle(lineWidth: 18, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
                    .opacity(slice.opacity)
            }
        }
    }

    private struct Slice { let start: Double; let end: Double; let color: Color; let opacity: Double }

    private func slices() -> [Slice] {
        let totalWeight = Double(pillars.map(\.weight).reduce(0, +))
        var cursor = 0.0
        var result: [Slice] = []
        for p in pillars {
            let span = Double(p.weight) / totalWeight
            let fillFraction = Double(p.score) / 100.0
            let filledEnd = cursor + span * fillFraction
            // Background of this slice (dim)
            result.append(.init(start: cursor, end: cursor + span, color: p.color.opacity(0.25), opacity: 1))
            // Filled portion
            result.append(.init(start: cursor, end: filledEnd, color: p.color, opacity: 1))
            cursor += span
        }
        return result
    }
}

private struct UrgencyQueue: View {
    let pillars: [PulsePillar]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Urgency queue", actionLabel: nil)
            VStack(spacing: 8) {
                ForEach(pillars.prefix(4)) { p in
                    HStack(spacing: 12) {
                        Image(systemName: p.icon)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(p.color)
                            .frame(width: 34, height: 34)
                            .background(p.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.topItem)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            Text(p.name + " • " + p.deadline)
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.textTertiary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .padding(12)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
                }
            }
        }
    }
}

private struct PillarGrid: View {
    let pillars: [PulsePillar]
    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Six pillars", actionLabel: nil)
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(pillars) { p in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Image(systemName: p.icon).foregroundStyle(p.color).font(.system(size: 14, weight: .bold))
                            Spacer()
                            Text("\(p.weight)%")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(Theme.textTertiary)
                        }
                        Text(p.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                        Text("\(p.score)")
                            .font(.system(size: 26, weight: .heavy))
                            .foregroundStyle(p.color)
                        ProgressView(value: Double(p.score) / 100.0)
                            .progressViewStyle(.linear)
                            .tint(p.color)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .cardStyle(padding: 14)
                }
            }
        }
    }
}
