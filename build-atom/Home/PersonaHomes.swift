import SwiftUI

// MARK: - Customer

struct CustomerHome: View {
    var body: some View {
        VStack(spacing: 18) {
            heroCTA

            HStack(spacing: 12) {
                StatTile(label: "Active jobs", value: "3", trend: nil, icon: "hammer.fill", color: Theme.accent)
                StatTile(label: "Open quotes", value: "2", trend: "+1", icon: "doc.text.fill", color: Theme.pillarHome)
            }

            VStack(spacing: 10) {
                SectionHeader(title: "Your jobs")
                ForEach(Samples.customerJobs) { JobRow(job: $0) }
            }

            VStack(spacing: 10) {
                SectionHeader(title: "Messages")
                ForEach(Samples.messages) { MessageRow(thread: $0) }
            }
        }
    }

    private var heroCTA: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("LOCAL SKILLS DIRECTORY")
                .font(.system(size: 11, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(Theme.accent)
            Text("Local help,\nwhen you need it")
                .font(.system(size: 26, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
                .lineSpacing(2)
            Text("Post a job in minutes. Get bids from skilled local helpers.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
            HStack(spacing: 10) {
                primaryButton("Post a Job", icon: "plus")
                secondaryButton("Browse Helpers")
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

    private func primaryButton(_ title: String, icon: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12, weight: .bold))
            Text(title).font(.system(size: 13, weight: .bold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16).padding(.vertical, 11)
        .background(Theme.accent, in: Capsule())
    }

    private func secondaryButton(_ title: String) -> some View {
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
                StatTile(label: "Earned this month", value: "$1,847", trend: "+12%", icon: "dollarsign.circle.fill", color: Theme.success)
                StatTile(label: "Jobs nearby", value: "14", trend: nil, icon: "location.fill", color: Theme.accent)
            }
            HStack(spacing: 12) {
                StatTile(label: "Active bids", value: "5", trend: nil, icon: "hand.raised.fill", color: Theme.pillarGoals)
                StatTile(label: "Rating", value: "4.9", trend: "★", icon: "star.fill", color: Theme.pillarCar)
            }

            VStack(spacing: 10) {
                SectionHeader(title: "Available near you")
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
                StatTile(label: "Team online", value: "3/4", trend: nil, icon: "person.3.fill", color: Theme.success)
                StatTile(label: "Invoices pending", value: "$2,140", trend: nil, icon: "doc.plaintext.fill", color: Theme.warning)
            }

            VStack(spacing: 10) {
                SectionHeader(title: "Your team")
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
                Text("Revenue this week").sectionTitle()
                Spacer()
                Text("Mon–Sun").font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
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
                Text("Cash App payouts").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Text("$OxSteedCo").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                Text("Share QR with customers")
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

// MARK: - Other personas (rich placeholders)

struct ConsultantHome: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: "In intake", value: "6", trend: nil, icon: "person.crop.circle.badge.plus", color: Theme.pillarPersonal)
                StatTile(label: "This week", value: "11 appts", trend: nil, icon: "calendar", color: Theme.accent)
            }
            EmptyStateCard(icon: "person.bubble.fill",
                           title: "Intake queue is calm",
                           message: "Your next session is Thursday with Priya R. Tap to open client notes.",
                           cta: "Open calendar")
        }
    }
}

struct ToolOwnerHome: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: "Tools out", value: "7", trend: nil, icon: "hammer.fill", color: Theme.pillarCar)
                StatTile(label: "Deposits held", value: "$640", trend: nil, icon: "lock.fill", color: Theme.warning)
            }
            EmptyStateCard(icon: "qrcode.viewfinder",
                           title: "Scan to check tools in or out",
                           message: "Damage deposits release automatically when a tool returns clean.",
                           cta: "Open scanner")
        }
    }
}

struct FranchiseHome: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: "Sub-franchisees", value: "9", trend: "+2", icon: "building.2.fill", color: Theme.pillarSinking)
                StatTile(label: "Compliance", value: "92%", trend: nil, icon: "checkmark.seal.fill", color: Theme.success)
            }
            EmptyStateCard(icon: "map.fill",
                           title: "Territory at a glance",
                           message: "View sub-franchisee locations, revenue share, and onboarding pipeline on the map.",
                           cta: "Open territory map")
        }
    }
}

struct InvestorHome: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: "Portfolio", value: "$24.8k", trend: "+5.2%", icon: "chart.line.uptrend.xyaxis", color: Theme.success)
                StatTile(label: "Helpers funded", value: "12", trend: nil, icon: "person.2.fill", color: Theme.accent)
            }
            EmptyStateCard(icon: "sparkles",
                           title: "New opportunities in Springfield",
                           message: "Three helper-businesses near you are ready for early-stage funding.",
                           cta: "View deals")
        }
    }
}
