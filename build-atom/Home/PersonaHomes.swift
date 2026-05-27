import SwiftUI

// MARK: - Customer

struct CustomerHome: View {
    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject var messages: MessagesStore
    @State private var showPostJob = false
    @State private var showInbox = false

    var body: some View {
        VStack(spacing: 18) {
            heroCTA

            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.activeJobs,
                         value: "\(jobs.myJobs.filter { ($0.status ?? "") != "completed" && ($0.status ?? "") != "cancelled" }.count)",
                         trend: nil, icon: "hammer.fill", color: Theme.accent)
                StatTile(label: L10n.StatKey.openQuotes,
                         value: "\(jobs.myJobs.reduce(0) { $0 + ($1.bid_count ?? 0) })",
                         trend: nil, icon: "doc.text.fill", color: Theme.pillarHome)
            }

            VStack(spacing: 10) {
                SectionHeader(title: L10n.SectionKey.yourJobs)
                if jobs.myJobs.isEmpty {
                    Text("No jobs yet — tap Post a Job to get started.")
                        .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
                } else {
                    ForEach(jobs.myJobs.prefix(4)) { job in
                        NavigationLink {
                            JobDetailView(job: job)
                        } label: { realJobRow(job) }
                        .buttonStyle(.plain)
                    }
                }
            }

            Button { showInbox = true } label: {
                HStack {
                    Image(systemName: "envelope.fill").foregroundStyle(Theme.accent)
                    Text(L10n.SectionKey.messages).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    Spacer()
                    if !messages.conversations.isEmpty {
                        Text("\(messages.conversations.count)").font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Image(systemName: "chevron.right").foregroundStyle(Theme.textTertiary)
                }
                .cardStyle()
            }
            .buttonStyle(.plain)
        }
        .task {
            await jobs.loadMyJobs()
            await messages.loadConversations()
        }
        .sheet(isPresented: $showPostJob) { PostJobView() }
        .sheet(isPresented: $showInbox) { InboxView() }
    }

    private func realJobRow(_ job: APIJob) -> some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 12)
                .fill(job.statusColor.opacity(0.18))
                .frame(width: 44, height: 44)
                .overlay(Image(systemName: "hammer.fill").font(.system(size: 16, weight: .bold))
                    .foregroundStyle(job.statusColor))
            VStack(alignment: .leading, spacing: 4) {
                Text(job.title).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary).lineLimit(1)
                Text(job.category ?? "").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Text(job.statusDisplay).font(.system(size: 11, weight: .bold))
                    .foregroundStyle(job.statusColor)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(job.statusColor.opacity(0.14), in: Capsule())
            }
            Spacer()
            Text(job.budgetDisplay).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private var heroCTA: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.CustomerKey.eyebrow).font(.system(size: 11, weight: .bold)).tracking(1.4).foregroundStyle(Theme.accent)
            Text(L10n.CustomerKey.headline).font(.system(size: 26, weight: .heavy)).foregroundStyle(Theme.textPrimary).lineSpacing(2)
            Text(L10n.CustomerKey.subhead).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            HStack(spacing: 10) {
                Button { showPostJob = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                        Text(L10n.CustomerKey.postJob).font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(Theme.accent, in: Capsule())
                }
                Text(L10n.CustomerKey.browseHelpers)
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.accent)
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(Capsule().strokeBorder(Theme.accent, lineWidth: 1.2))
            }
            .padding(.top, 4)
        }
        .padding(20)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(LinearGradient(colors: [Theme.surface, Theme.surface.opacity(0.6), Theme.accentSoft],
                                 startPoint: .topLeading, endPoint: .bottomTrailing)))
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

// MARK: - Helper

struct HelperHome: View {
    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject var bids: BidsStore
    @EnvironmentObject var payments: PaymentsStore
    @State private var selectedJob: APIJob?

    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.earnedThisMonth,
                         value: "$\(payments.payments.reduce(0) { $0 + $1.amount } / 100)",
                         trend: nil, icon: "dollarsign.circle.fill", color: Theme.success)
                StatTile(label: L10n.StatKey.jobsNearby, value: "\(jobs.availableJobs.count)",
                         trend: nil, icon: "location.fill", color: Theme.accent)
            }
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.activeBids, value: "\(bids.myBids.count)",
                         trend: nil, icon: "hand.raised.fill", color: Theme.pillarGoals)
                StatTile(label: L10n.StatKey.rating, value: "—", trend: "★",
                         icon: "star.fill", color: Theme.pillarCar)
            }

            VStack(spacing: 10) {
                SectionHeader(title: L10n.SectionKey.availableNearYou)
                if jobs.availableJobs.isEmpty {
                    Text("No jobs available in your area yet.")
                        .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
                }
                ForEach(jobs.availableJobs.prefix(10)) { job in
                    Button { selectedJob = job } label: { availableRow(job) }
                        .buttonStyle(.plain)
                }
            }
        }
        .task {
            await jobs.loadAvailable()
            await bids.loadMine()
            await payments.loadPayments()
        }
        .sheet(item: $selectedJob) { job in
            NavigationStack { JobDetailView(job: job) }
        }
    }

    private func availableRow(_ job: APIJob) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(job.title).font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Spacer()
                Text(job.budgetDisplay).font(.system(size: 16, weight: .heavy)).foregroundStyle(Theme.accent)
            }
            HStack(spacing: 8) {
                if let d = job.distance_miles {
                    Label(String(format: "%.1f mi", d), systemImage: "location.fill")
                } else if !job.locationDisplay.isEmpty {
                    Label(job.locationDisplay, systemImage: "location.fill")
                }
            }
            .font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.textSecondary)
            HStack {
                Text(job.category ?? "").font(.system(size: 10, weight: .semibold))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Theme.surfaceElevated, in: Capsule()).foregroundStyle(Theme.textSecondary)
                Spacer()
                Text(L10n.CommonKey.bid).font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 6).background(Theme.accent, in: Capsule())
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

// MARK: - Business

struct BusinessHome: View {
    @EnvironmentObject var payments: PaymentsStore
    @EnvironmentObject var jobs: JobsStore

    var body: some View {
        VStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text(L10n.BusinessKey.revenueWeek).sectionTitle()
                    Spacer()
                    Text(L10n.BusinessKey.weekRange).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                }
                Text("$\(payments.payments.reduce(0) { $0 + $1.amount } / 100)")
                    .font(.system(size: 32, weight: .heavy)).foregroundStyle(Theme.textPrimary)
                MiniBarChart(values: [0.4, 0.6, 0.45, 0.8, 0.7, 0.95, 0.55]).frame(height: 64)
            }
            .cardStyle()

            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.teamOnline, value: "—", trend: nil,
                         icon: "person.3.fill", color: Theme.success)
                StatTile(label: L10n.StatKey.invoicesPending, value: "\(jobs.myJobs.count)",
                         trend: nil, icon: "doc.plaintext.fill", color: Theme.warning)
            }

            NavigationLink { PaymentsView() } label: {
                HStack {
                    Image(systemName: "creditcard.fill").foregroundStyle(Theme.accent)
                    Text("Wallet & Payouts").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(Theme.textTertiary)
                }
                .cardStyle()
            }
            .buttonStyle(.plain)
        }
        .task {
            await payments.loadPayments()
            await jobs.loadMyJobs()
        }
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

// MARK: - Other personas

struct ConsultantHome: View {
    @EnvironmentObject var cal: CalendarStore
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.inIntake, value: "\(cal.bookingsIncoming.count)",
                         trend: nil, icon: "person.crop.circle.badge.plus", color: Theme.pillarPersonal)
                StatTile(label: L10n.StatKey.thisWeek, value: "\(cal.appointments.count)",
                         trend: nil, icon: "calendar", color: Theme.accent)
            }
            NavigationLink { CalendarView() } label: {
                EmptyStateCard(icon: "calendar",
                               title: L10n.ConsultantKey.emptyTitle,
                               message: L10n.ConsultantKey.emptyMessage,
                               cta: L10n.ConsultantKey.emptyCta)
            }
            .buttonStyle(.plain)
        }
        .task {
            await cal.loadAppointments()
            await cal.loadBookings(asHelper: true)
        }
    }
}

struct ToolOwnerHome: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.toolsOut, value: "—", trend: nil,
                         icon: "hammer.fill", color: Theme.pillarCar)
                StatTile(label: L10n.StatKey.depositsHeld, value: "—", trend: nil,
                         icon: "lock.fill", color: Theme.warning)
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
                StatTile(label: L10n.StatKey.subfranchisees, value: "—", trend: nil,
                         icon: "building.2.fill", color: Theme.pillarSinking)
                StatTile(label: L10n.StatKey.compliance, value: "—", trend: nil,
                         icon: "checkmark.seal.fill", color: Theme.success)
            }
            EmptyStateCard(icon: "map.fill",
                           title: L10n.FranchiseKey.emptyTitle,
                           message: L10n.FranchiseKey.emptyMessage,
                           cta: L10n.FranchiseKey.emptyCta)
        }
    }
}

struct InvestorHome: View {
    @EnvironmentObject var payments: PaymentsStore
    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.portfolio,
                         value: "$\(payments.payments.reduce(0) { $0 + $1.amount } / 100)",
                         trend: nil, icon: "chart.line.uptrend.xyaxis", color: Theme.success)
                StatTile(label: L10n.StatKey.helpersFunded, value: "—", trend: nil,
                         icon: "person.2.fill", color: Theme.accent)
            }
            NavigationLink { PaymentsView() } label: {
                EmptyStateCard(icon: "sparkles",
                               title: L10n.InvestorKey.emptyTitle,
                               message: L10n.InvestorKey.emptyMessage,
                               cta: L10n.InvestorKey.emptyCta)
            }
            .buttonStyle(.plain)
        }
        .task { await payments.loadPayments() }
    }
}
