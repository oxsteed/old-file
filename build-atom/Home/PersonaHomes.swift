import SwiftUI

// MARK: - Customer

struct CustomerHome: View {
    var body: some View {
        VStack(spacing: 18) {
            heroCTA

            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.activeJobs, value: "3", trend: nil, icon: "hammer.fill", color: Theme.accent)
                StatTile(label: L10n.StatKey.openQuotes, value: "2", trend: "+1", icon: "doc.text.fill", color: Theme.pillarHome)
            }

            VStack(spacing: 10) {
                SectionHeader(title: L10n.SectionKey.yourJobs)
                ForEach(Samples.customerJobs) { JobRow(job: $0) }
            }

            VStack(spacing: 10) {
                SectionHeader(title: L10n.SectionKey.messages)
                ForEach(Samples.messages) { MessageRow(thread: $0) }
            }
        }
    }

    private var heroCTA: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.CustomerKey.eyebrow)
                .font(.system(size: 11, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(Theme.accent)
            Text(L10n.CustomerKey.headline)
                .font(.system(size: 26, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
                .lineSpacing(2)
            Text(L10n.CustomerKey.subhead)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
            HStack(spacing: 10) {
                primaryButton(L10n.CustomerKey.postJob, icon: "plus")
                secondaryButton(L10n.CustomerKey.browseHelpers)
            }
            .padding(.top, 4)
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(LinearGradient(
                    colors: [Theme.surface, Theme.surface.opacity(0.6), Theme.accentSoft],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ))
        )
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private func primaryButton(_ title: LocalizedStringKey, icon: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12, weight: .bold))
            Text(title).font(.system(size: 13, weight: .bold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16).padding(.vertical, 11)
        .background(Theme.accent, in: Capsule())
    }

    private func secondaryButton(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 16).padding(.vertical, 11)
            .background(Capsule().strokeBorder(Theme.accent, lineWidth: 1.2))
    }
}

struct MessageRow: View {
    let thread: MessageThread
    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(thread.tint.opacity(0.2))
                Text(thread.initials)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(thread.tint)
            }
            .frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(thread.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(thread.preview)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(thread.timeAgo).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                if thread.unread > 0 {
                    Text("\(thread.unread)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Theme.accent, in: Circle())
                }
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

// MARK: - Helper

struct HelperHome: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.earnedThisMonth, value: "$1,847", trend: "+12%", icon: "dollarsign.circle.fill", color: Theme.success)
                StatTile(label: L10n.StatKey.jobsNearby, value: "14", trend: nil, icon: "location.fill", color: Theme.accent)
            }
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.activeBids, value: "5", trend: nil, icon: "hand.raised.fill", color: Theme.pillarGoals)
                StatTile(label: L10n.StatKey.rating, value: "4.9", trend: "★", icon: "star.fill", color: Theme.pillarCar)
            }

            VStack(spacing: 10) {
                SectionHeader(title: L10n.SectionKey.availableNearYou)
                ForEach(Samples.helperJobs) { AvailableJobRow(job: $0) }
            }
        }
    }
}

// MARK: - Business

struct BusinessHome: View {
    var body: some View {
        VStack(spacing: 18) {
            RevenueCard()

            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.teamOnline, value: "3/4", trend: nil, icon: "person.3.fill", color: Theme.success)
                StatTile(label: L10n.StatKey.invoicesPending, value: "$2,140", trend: nil, icon: "doc.plaintext.fill", color: Theme.warning)
            }

            VStack(spacing: 10) {
                SectionHeader(title: L10n.SectionKey.yourTeam)
                ForEach(Samples.team) { TeamRow(member: $0) }
            }

            CashAppCard()
        }
    }
}

private struct RevenueCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(L10n.BusinessKey.revenueWeek).sectionTitle()
                Spacer()
                Text(L10n.BusinessKey.weekRange).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
            }
            Text("$4,820")
                .font(.system(size: 32, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            MiniBarChart(values: [0.4, 0.6, 0.45, 0.8, 0.7, 0.95, 0.55])
                .frame(height: 64)
        }
        .cardStyle()
    }
}

private struct MiniBarChart: View {
    let values: [Double]
    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(Array(values.enumerated()), id: \.offset) { i, v in
                    RoundedRectangle(cornerRadius: 6)
                        .fill(LinearGradient(colors: [Theme.accent, Theme.accentDeep], startPoint: .top, endPoint: .bottom))
                        .frame(height: max(8, geo.size.height * v))
                        .opacity(i == values.count - 1 ? 0.6 : 1)
                }
            }
        }
    }
}

private struct TeamRow: View {
    let member: TeamMember
    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(member.statusColor.opacity(0.2))
                Text(member.initials).font(.system(size: 12, weight: .bold)).foregroundStyle(member.statusColor)
            }
            .frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text(member.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                Text(member.role).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
            }
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(member.statusColor).frame(width: 7, height: 7)
                Text(member.status).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

private struct CashAppCard: View {
    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(Color.white)
                Image(systemName: "qrcode")
                    .font(.system(size: 36, weight: .light))
                    .foregroundStyle(.black)
            }
            .frame(width: 64, height: 64)
            VStack(alignment: .leading, spacing: 4) {
                Text(L10n.BusinessKey.cashappTitle).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Text("$OxSteedCo").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                Text(L10n.BusinessKey.cashappShare)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.accent)
            }
            Spacer()
            Image(systemName: "square.and.arrow.up")
                .foregroundStyle(Theme.accent)
        }
        .cardStyle()
    }
}

// MARK: - Other personas

struct ConsultantHome: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.inIntake, value: "6", trend: nil, icon: "person.crop.circle.badge.plus", color: Theme.pillarPersonal)
                StatTile(label: L10n.StatKey.thisWeek, value: "11", trend: nil, icon: "calendar", color: Theme.accent)
            }
            EmptyStateCard(icon: "person.bubble.fill",
                           title: L10n.ConsultantKey.emptyTitle,
                           message: L10n.ConsultantKey.emptyMessage,
                           cta: L10n.ConsultantKey.emptyCta)
        }
    }
}

struct ToolOwnerHome: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.toolsOut, value: "7", trend: nil, icon: "hammer.fill", color: Theme.pillarCar)
                StatTile(label: L10n.StatKey.depositsHeld, value: "$640", trend: nil, icon: "lock.fill", color: Theme.warning)
            }
            EmptyStateCard(icon: "qrcode.viewfinder",
                           title: L10n.ToolOwnerKey.emptyTitle,
                           message: L10n.ToolOwnerKey.emptyMessage,
                           cta: L10n.ToolOwnerKey.emptyCta)
        }
    }
}

struct FranchiseHome: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.subfranchisees, value: "9", trend: "+2", icon: "building.2.fill", color: Theme.pillarSinking)
                StatTile(label: L10n.StatKey.compliance, value: "92%", trend: nil, icon: "checkmark.seal.fill", color: Theme.success)
            }
            EmptyStateCard(icon: "map.fill",
                           title: L10n.FranchiseKey.emptyTitle,
                           message: L10n.FranchiseKey.emptyMessage,
                           cta: L10n.FranchiseKey.emptyCta)
        }
    }
}

struct InvestorHome: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.portfolio, value: "$24.8k", trend: "+5.2%", icon: "chart.line.uptrend.xyaxis", color: Theme.success)
                StatTile(label: L10n.StatKey.helpersFunded, value: "12", trend: nil, icon: "person.2.fill", color: Theme.accent)
            }
            EmptyStateCard(icon: "sparkles",
                           title: L10n.InvestorKey.emptyTitle,
                           message: L10n.InvestorKey.emptyMessage,
                           cta: L10n.InvestorKey.emptyCta)
        }
    }
}
