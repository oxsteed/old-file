import SwiftUI

struct GrowthTabView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                header
                ladderCard
                programsSection
                wholesaleSection
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Theme.background.ignoresSafeArea())
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("GROWTH").sectionTitle()
                Text("Move up economically")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
            }
            Spacer()
        }
    }

    private var ladderCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Your ladder")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            VStack(spacing: 10) {
                ForEach(Samples.growthLadder) { step in
                    GrowthRow(step: step)
                }
            }
        }
        .cardStyle()
    }

    private var programsSection: some View {
        VStack(spacing: 10) {
            SectionHeader(title: "Programs for you", actionLabel: nil)
            ProgramCard(icon: "checkmark.seal.fill",
                        title: "Business Ascension",
                        subtitle: "Side income → licensed business in 6 weeks",
                        cta: "Apply",
                        color: Theme.accent)
            ProgramCard(icon: "creditcard.fill",
                        title: "Micro-loan pre-qualify",
                        subtitle: "Up to $5,000 for tools and equipment",
                        cta: "Check",
                        color: Theme.pillarMoney)
            ProgramCard(icon: "gift.fill",
                        title: "Local grants in Springfield",
                        subtitle: "3 active grants matched to your trade",
                        cta: "View",
                        color: Theme.pillarGoals)
        }
    }

    private var wholesaleSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Community wholesale", actionLabel: "See all")
            HStack(spacing: 12) {
                WholesaleCard(title: "Pressure washer bundle", saving: "Save 22%", joined: "14 joined")
                WholesaleCard(title: "Commercial cleaning supplies", saving: "Save 18%", joined: "9 joined")
            }
        }
    }
}

private struct GrowthRow: View {
    let step: GrowthStep
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(step.isActive ? Theme.accent : Theme.surfaceElevated).frame(width: 28, height: 28)
                if step.progress >= 1 {
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                } else {
                    Text(String(step.stage.last ?? "1"))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(step.isActive ? .white : Theme.textSecondary)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(step.title).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Text(step.description).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                ProgressView(value: step.progress)
                    .tint(step.isActive ? Theme.accent : Theme.success.opacity(0.6))
                    .padding(.top, 2)
            }
        }
    }
}

private struct ProgramCard: View {
    let icon: String, title: String, subtitle: String, cta: String, color: Color
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 40, height: 40)
                .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                Text(subtitle).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Text(cta)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(color, in: Capsule())
        }
        .cardStyle(padding: 12)
    }
}

private struct WholesaleCard: View {
    let title: String, saving: String, joined: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "shippingbox.fill")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.pillarSinking)
            Text(title).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.textPrimary).lineLimit(2)
            HStack(spacing: 6) {
                Text(saving).font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.success)
                    .padding(.horizontal, 6).padding(.vertical, 3)
                    .background(Theme.success.opacity(0.16), in: Capsule())
                Spacer()
            }
            Text(joined).font(.system(size: 10)).foregroundStyle(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        .cardStyle(padding: 14)
    }
}
