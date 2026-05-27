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
                Text(L10n.GrowthKey.eyebrow).sectionTitle()
                Text(L10n.GrowthKey.title)
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
            }
            Spacer()
        }
    }

    private var ladderCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L10n.SectionKey.yourLadder)
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
            SectionHeader(title: L10n.SectionKey.programsForYou, actionLabel: nil)
            ProgramCard(icon: "checkmark.seal.fill",
                        title: L10n.GrowthKey.ascensionTitle,
                        subtitle: L10n.GrowthKey.ascensionSubtitle,
                        cta: L10n.GrowthKey.ascensionCta,
                        color: Theme.accent)
            ProgramCard(icon: "creditcard.fill",
                        title: L10n.GrowthKey.loanTitle,
                        subtitle: L10n.GrowthKey.loanSubtitle,
                        cta: L10n.GrowthKey.loanCta,
                        color: Theme.pillarMoney)
            ProgramCard(icon: "gift.fill",
                        title: L10n.GrowthKey.grantsTitle,
                        subtitle: L10n.GrowthKey.grantsSubtitle,
                        cta: L10n.GrowthKey.grantsCta,
                        color: Theme.pillarGoals)
        }
    }

    private var wholesaleSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: L10n.SectionKey.communityWholesale, actionLabel: L10n.CommonKey.seeAll)
            HStack(spacing: 12) {
                WholesaleCard(title: L10n.GrowthKey.washerTitle,
                              saving: L10n.GrowthKey.washerSaving,
                              joined: L10n.GrowthKey.washerJoined)
                WholesaleCard(title: L10n.GrowthKey.cleaningTitle,
                              saving: L10n.GrowthKey.cleaningSaving,
                              joined: L10n.GrowthKey.cleaningJoined)
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
    let icon: String
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey
    let cta: LocalizedStringKey
    let color: Color
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
    let title: LocalizedStringKey
    let saving: LocalizedStringKey
    let joined: LocalizedStringKey
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
