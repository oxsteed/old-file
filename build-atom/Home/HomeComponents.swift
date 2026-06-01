import SwiftUI

struct StatTile: View {
    let label: LocalizedStringKey
    let value: String
    let trend: String?
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(color)
                    .frame(width: 26, height: 26)
                    .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
                Spacer()
                if let trend {
                    Text(trend)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.success)
                }
            }
            Text(value)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle(padding: 14)
    }
}

struct SectionHeader: View {
    let title: LocalizedStringKey
    var actionLabel: LocalizedStringKey? = L10n.CommonKey.seeAll
    var action: (() -> Void)? = nil

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            Spacer()
            if let label = actionLabel {
                Button(action: { action?() }) {
                    Text(label)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                }
            }
        }
    }
}

struct JobRow: View {
    let job: JobItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 12)
                .fill(job.statusColor.opacity(0.18))
                .frame(width: 44, height: 44)
                .overlay(
                    Image(systemName: "hammer.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(job.statusColor)
                )
            VStack(alignment: .leading, spacing: 4) {
                Text(job.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(job.category)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                    Text(verbatim: "•").foregroundStyle(Theme.textTertiary).font(.system(size: 10))
                    Text(job.timeLabel)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                }
                Text(job.status)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(job.statusColor)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(job.statusColor.opacity(0.14), in: Capsule())
                    .padding(.top, 2)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(job.amount)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(job.helper)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

struct AvailableJobRow: View {
    let job: AvailableJob

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(job.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Text(job.payout)
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(Theme.accent)
            }
            HStack(spacing: 8) {
                Label(job.distance, systemImage: "location.fill")
                Text(verbatim: "•").foregroundStyle(Theme.textTertiary)
                Text(job.postedAgo)
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(Theme.textSecondary)

            HStack(spacing: 6) {
                ForEach(job.tags, id: \.self) { tag in
                    Text(tag)
                        .font(.system(size: 10, weight: .semibold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Theme.surfaceElevated, in: Capsule())
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                Text(L10n.CommonKey.bid)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 6)
                    .background(Theme.accent, in: Capsule())
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

struct EmptyStateCard: View {
    let icon: String
    let title: LocalizedStringKey
    let message: LocalizedStringKey
    let cta: LocalizedStringKey

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(Theme.accent)
                .frame(width: 64, height: 64)
                .background(Theme.accentSoft, in: Circle())
            Text(title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)
            Text(cta)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 18).padding(.vertical, 10)
                .background(Theme.accent, in: Capsule())
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .cardStyle(padding: 18)
    }
}

struct HomePulseSnapshot: View {
    @EnvironmentObject private var life: LifeStore
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @State private var animateProgress = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("home.pulse.title", systemImage: "heart.text.square.fill")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Text(localization.format("home.pulse.score_format", life.pulse?.pulse_score ?? 0))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Theme.accentSoft, in: Capsule())
            }

            if auth.user == nil {
                Text("home.pulse.sign_in_to_view")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            } else {
                HStack(spacing: 16) {
                    HomePulseRing(score: life.pulse?.pulse_score ?? 0, animated: animateProgress)
                        .frame(width: 74, height: 74)

                    VStack(spacing: 8) {
                        HomePulseMetricBar(label: "home.pulse.metric.coverage", value: life.pulse?.score_breakdown?.coverage, color: Theme.success, animated: animateProgress)
                        HomePulseMetricBar(label: "home.pulse.metric.buffer", value: life.pulse?.score_breakdown?.buffer, color: Theme.pillarHome, animated: animateProgress)
                        HomePulseMetricBar(label: "home.pulse.metric.reliability", value: life.pulse?.score_breakdown?.reliability, color: Theme.pillarGoals, animated: animateProgress)
                        HomePulseMetricBar(label: "home.pulse.metric.obligations", value: life.pulse?.score_breakdown?.obligations, color: Theme.accent, animated: animateProgress)
                    }
                }
            }
        }
        .cardStyle(padding: 16)
        .onAppear {
            withAnimation(.easeOut(duration: 0.8).delay(0.15)) {
                animateProgress = true
            }
        }
        .task {
            if auth.user != nil, life.pulse == nil {
                await life.refresh(window: "1m")
            }
        }
    }

}

private struct HomePulseRing: View {
    let score: Int
    let animated: Bool

    var body: some View {
        ZStack {
            Circle()
                .stroke(Theme.surfaceElevated, lineWidth: 8)
            Circle()
                .trim(from: 0, to: animated ? CGFloat(score) / 100 : 0)
                .stroke(
                    AngularGradient(colors: [Theme.accent, Theme.pillarMoney], center: .center),
                    style: StrokeStyle(lineWidth: 8, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            Text("\(score)")
                .font(.system(size: 18, weight: .heavy, design: .rounded))
                .foregroundStyle(Theme.textPrimary)
        }
        .animation(.easeOut(duration: 0.9), value: animated)
    }
}

private struct HomePulseMetricBar: View {
    let label: LocalizedStringKey
    let value: Int?
    let color: Color
    let animated: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text("\(min(max(value ?? 0, 0), 100))")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(color)
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(color.opacity(0.13))
                    Capsule()
                        .fill(color)
                        .frame(width: animated ? geometry.size.width * CGFloat(min(max(value ?? 0, 0), 100)) / 100 : 0)
                }
            }
            .frame(height: 6)
        }
        .animation(.easeOut(duration: 0.75), value: animated)
    }
}

struct PersonaDashboard: View {
    @EnvironmentObject private var jobs: JobsStore
    @EnvironmentObject private var bids: BidsStore
    @EnvironmentObject private var messages: MessagesStore
    @EnvironmentObject private var calendar: CalendarStore
    @EnvironmentObject private var notifications: NotificationsStore
    @EnvironmentObject private var payments: PaymentsStore
    @EnvironmentObject private var tools: ToolRentalsStore
    @EnvironmentObject private var localization: LocalizationManager

    let persona: Persona

    private var metrics: [PersonaMetric] {
        switch persona {
        case .customer:
            return [
                .init(label: "Active jobs", value: "\(activeJobsCount)", detail: "in progress", icon: "list.bullet.clipboard.fill", color: Theme.accent),
                .init(label: "Quotes", value: "\(quoteCount)", detail: "received", icon: "tray.full.fill", color: Theme.pillarHome),
                .init(label: "Messages", value: "\(messages.conversations.count)", detail: "threads", icon: "bubble.left.fill", color: Theme.success)
            ]
        case .helper:
            return [
                .init(label: "Earnings", value: paymentsTotal, detail: "received", icon: "dollarsign.circle.fill", color: Theme.success),
                .init(label: "Nearby", value: "\(jobs.availableJobs.count)", detail: "jobs", icon: "location.fill", color: Theme.accent),
                .init(label: "Bids", value: "\(bids.myBids.count)", detail: "active", icon: "hand.raised.fill", color: Theme.pillarGoals)
            ]
        case .business:
            return [
                .init(label: "Revenue", value: paymentsTotal, detail: "received", icon: "chart.bar.fill", color: Theme.success),
                .init(label: "Orders", value: "\(activeJobsCount)", detail: "active", icon: "shippingbox.fill", color: Theme.accent),
                .init(label: "Team", value: "\(Samples.team.count)", detail: "members", icon: "person.3.fill", color: Theme.pillarGoals)
            ]
        case .consultant:
            return [
                .init(label: "Intakes", value: "\(calendar.bookingsIncoming.count)", detail: "new", icon: "person.crop.circle.badge.plus", color: Theme.pillarPersonal),
                .init(label: "Sessions", value: "\(calendar.appointments.count)", detail: "booked", icon: "calendar", color: Theme.accent),
                .init(label: "Inbox", value: "\(messages.conversations.count)", detail: "clients", icon: "bubble.left.and.bubble.right.fill", color: Theme.pillarHome)
            ]
        case .toolOwner:
            return [
                .init(label: "Payouts", value: paymentsTotal, detail: "received", icon: "dollarsign.circle.fill", color: Theme.success),
                .init(label: "Requests", value: "\(messages.conversations.count)", detail: "inbox", icon: "tray.full.fill", color: Theme.pillarHome),
                .init(label: "Inventory", value: "\(tools.myTools.count)", detail: "tools", icon: "hammer.fill", color: Theme.pillarCar)
            ]
        case .franchise:
            return [
                .init(label: "Revenue", value: paymentsTotal, detail: "network", icon: "chart.line.uptrend.xyaxis", color: Theme.success),
                .init(label: "Territory", value: "1", detail: "active", icon: "map.fill", color: Theme.pillarSinking),
                .init(label: "Compliance", value: "Set up", detail: "required", icon: "checkmark.seal.fill", color: Theme.warning)
            ]
        case .investor:
            return [
                .init(label: "Portfolio", value: paymentsTotal, detail: "tracked", icon: "chart.pie.fill", color: Theme.success),
                .init(label: "Deals", value: "\(payments.payments.count)", detail: "backed", icon: "checkmark.seal.fill", color: Theme.pillarHome),
                .init(label: "Alerts", value: "\(notifications.unreadCount)", detail: "unread", icon: "bell.fill", color: Theme.accent)
            ]
        }
    }

    private var actions: [PersonaAction] {
        switch persona {
        case .customer:
            let quoteAction = jobs.myJobs.first(where: { ($0.bid_count ?? 0) > 0 })
            return [
                quoteAction.map {
                    .init(title: "Review quotes for \($0.title)", subtitle: "\($0.bid_count ?? 0) proposal(s) ready", due: "Now", icon: "checkmark.seal.fill", color: Theme.accent, destination: .job($0))
                } ?? .init(title: "Describe your next project", subtitle: "Get matched with a local helper", due: "Start", icon: "plus.circle.fill", color: Theme.accent, destination: .browseJobs),
                .init(title: "Find trusted local helpers", subtitle: "Browse ratings and availability", due: "Explore", icon: "person.2.fill", color: Theme.pillarHome, destination: .helpers),
                .init(title: "Plan a household goal", subtitle: "Keep your Life Pulse on track", due: "This week", icon: "target", color: Theme.success, destination: .goals)
            ]
        case .helper:
            let jobAction = jobs.availableJobs.first.map {
                PersonaAction(title: "Bid on \($0.title)", subtitle: $0.budgetDisplay, due: "New", icon: "hammer.fill", color: Theme.accent, destination: .job($0))
            }
            return [
                jobAction ?? .init(title: "Search for jobs nearby", subtitle: "New opportunities appear here", due: "Browse", icon: "location.fill", color: Theme.accent, destination: .browseJobs),
                .init(title: "Update your availability", subtitle: "Keep your calendar bookable", due: "Today", icon: "calendar", color: Theme.pillarHome, destination: .availability),
                .init(title: "Review payouts", subtitle: "Track earnings and transfers", due: "Wallet", icon: "creditcard.fill", color: Theme.success, destination: .payments)
            ]
        case .business:
            return [
                .init(title: "Review open work orders", subtitle: "\(activeJobsCount) job(s) in your pipeline", due: "Today", icon: "shippingbox.fill", color: Theme.accent, destination: .browseJobs),
                .init(title: "Coordinate team schedules", subtitle: "Assign your next appointment", due: "Plan", icon: "person.3.fill", color: Theme.pillarHome, destination: .calendar),
                .init(title: "Manage payouts", subtitle: "Revenue and transfer status", due: "Finance", icon: "creditcard.fill", color: Theme.success, destination: .payments)
            ]
        case .consultant:
            return [
                .init(title: "Review client intakes", subtitle: "\(calendar.bookingsIncoming.count) new request(s)", due: "Today", icon: "person.crop.circle.badge.checkmark", color: Theme.pillarPersonal, destination: .calendar),
                .init(title: "Schedule an advisory session", subtitle: "Manage your booking calendar", due: "Book", icon: "calendar", color: Theme.accent, destination: .calendar),
                .init(title: "Build your practice", subtitle: "Explore growth programs", due: "Grow", icon: "arrow.up.right.circle.fill", color: Theme.success, destination: .growth)
            ]
        case .toolOwner:
            return [
                .init(title: "Prepare your rental inventory", subtitle: "Catalog tools and deposit rules", due: "Setup", icon: "hammer.fill", color: Theme.pillarCar, destination: .learn),
                .init(title: "Review payout settings", subtitle: "Be ready to receive rent", due: "Wallet", icon: "creditcard.fill", color: Theme.success, destination: .payments),
                .init(title: "Grow tool earnings", subtitle: "See owner opportunities", due: "Explore", icon: "arrow.up.right.circle.fill", color: Theme.accent, destination: .growth)
            ]
        case .franchise:
            return [
                .init(title: "Plan territory expansion", subtitle: "Build your local coverage", due: "Strategy", icon: "map.fill", color: Theme.pillarSinking, destination: .growth),
                .init(title: "Schedule an onboarding review", subtitle: "Compliance and operations", due: "Required", icon: "checkmark.shield.fill", color: Theme.warning, destination: .calendar),
                .init(title: "Monitor disbursements", subtitle: "Track network earnings", due: "Finance", icon: "creditcard.fill", color: Theme.success, destination: .payments)
            ]
        case .investor:
            return [
                .init(title: "Review portfolio payments", subtitle: "Track distributions and returns", due: "Now", icon: "chart.pie.fill", color: Theme.success, destination: .payments),
                .init(title: "Explore growth opportunities", subtitle: "Discover businesses to support", due: "Explore", icon: "sparkles", color: Theme.accent, destination: .growth),
                .init(title: "Read account alerts", subtitle: "\(notifications.unreadCount) notification(s) waiting", due: "Inbox", icon: "bell.fill", color: Theme.pillarHome, destination: .notifications)
            ]
        }
    }

    private var opportunities: [PersonaOpportunity] {
        switch persona {
        case .customer:
            return [
                .init(badge: "Home", title: "Find vetted help", subtitle: "Book trusted local specialists", icon: "house.fill", color: Theme.pillarHome, destination: .helpers),
                .init(badge: "Plan", title: "Build a home fund", subtitle: "Prepare for upcoming repairs", icon: "banknote.fill", color: Theme.success, destination: .sinkingFunds)
            ]
        case .helper:
            return [
                .init(badge: "Earn", title: "Jobs near you", subtitle: "Bid on work available today", icon: "location.fill", color: Theme.accent, destination: .browseJobs),
                .init(badge: "Grow", title: "Level up skills", subtitle: "Learn and earn more", icon: "graduationcap.fill", color: Theme.pillarGoals, destination: .learn)
            ]
        case .business:
            return [
                .init(badge: "Scale", title: "Team growth", subtitle: "Plan staffing and expansion", icon: "person.3.fill", color: Theme.pillarGoals, destination: .growth),
                .init(badge: "Cash", title: "Payout center", subtitle: "Control incoming revenue", icon: "creditcard.fill", color: Theme.success, destination: .payments)
            ]
        case .consultant:
            return [
                .init(badge: "Clients", title: "Advisory pipeline", subtitle: "Keep sessions moving", icon: "person.bubble.fill", color: Theme.pillarPersonal, destination: .calendar),
                .init(badge: "Growth", title: "Expand services", subtitle: "Create new offerings", icon: "sparkles", color: Theme.pillarGoals, destination: .growth)
            ]
        case .toolOwner:
            return [
                .init(badge: "Rent", title: "Tool rental launch", subtitle: "Get inventory ready", icon: "hammer.fill", color: Theme.pillarCar, destination: .learn),
                .init(badge: "Income", title: "Passive earning", subtitle: "Review payout tools", icon: "dollarsign.circle.fill", color: Theme.success, destination: .payments)
            ]
        case .franchise:
            return [
                .init(badge: "Territory", title: "Expansion plan", subtitle: "Grow local coverage", icon: "map.fill", color: Theme.pillarSinking, destination: .growth),
                .init(badge: "Train", title: "Onboard your team", subtitle: "Build operational skills", icon: "graduationcap.fill", color: Theme.accent, destination: .learn)
            ]
        case .investor:
            return [
                .init(badge: "Capital", title: "Growth pipeline", subtitle: "Review new opportunities", icon: "chart.line.uptrend.xyaxis", color: Theme.success, destination: .growth),
                .init(badge: "Learn", title: "Portfolio basics", subtitle: "Sharpen evaluation skills", icon: "graduationcap.fill", color: Theme.pillarHome, destination: .learn)
            ]
        }
    }

    private var activity: [PersonaActivity] {
        switch persona {
        case .customer:
            let jobsActivity = jobs.myJobs.prefix(2).map {
                PersonaActivity(title: $0.title, subtitle: $0.statusDisplay, stamp: "Job", icon: "hammer.fill", color: $0.statusColor)
            }
            return jobsActivity + [
                .init(title: "Your home dashboard is ready", subtitle: "Track projects and Life Pulse here", stamp: "Now", icon: "house.fill", color: Theme.pillarHome)
            ]
        case .helper:
            return [
                .init(title: "Nearby opportunities", subtitle: "\(jobs.availableJobs.count) job(s) ready to browse", stamp: "Feed", icon: "location.fill", color: Theme.accent),
                .init(title: "Bids submitted", subtitle: "\(bids.myBids.count) active bid(s)", stamp: "Bids", icon: "hand.raised.fill", color: Theme.pillarGoals),
                .init(title: "Earnings recorded", subtitle: paymentsTotal, stamp: "Pay", icon: "checkmark.circle.fill", color: Theme.success)
            ]
        case .business:
            return [
                .init(title: "Team operations", subtitle: "\(Samples.team.count) team members visible", stamp: "Team", icon: "person.3.fill", color: Theme.pillarGoals),
                .init(title: "Open work orders", subtitle: "\(activeJobsCount) active job(s)", stamp: "Jobs", icon: "shippingbox.fill", color: Theme.accent),
                .init(title: "Payments tracked", subtitle: paymentsTotal, stamp: "Cash", icon: "dollarsign.circle.fill", color: Theme.success)
            ]
        case .consultant:
            return [
                .init(title: "Client requests", subtitle: "\(calendar.bookingsIncoming.count) intake(s) ready", stamp: "New", icon: "person.crop.circle.badge.plus", color: Theme.pillarPersonal),
                .init(title: "Scheduled sessions", subtitle: "\(calendar.appointments.count) on your calendar", stamp: "Plan", icon: "calendar", color: Theme.accent)
            ]
        case .toolOwner:
            return [
                .init(title: "Inventory setup", subtitle: "Add tools to begin renting", stamp: "Next", icon: "hammer.fill", color: Theme.pillarCar),
                .init(title: "Payout readiness", subtitle: paymentsTotal + " received", stamp: "Pay", icon: "creditcard.fill", color: Theme.success)
            ]
        case .franchise:
            return [
                .init(title: "Territory setup", subtitle: "Prepare locations and operators", stamp: "Next", icon: "map.fill", color: Theme.pillarSinking),
                .init(title: "Compliance review", subtitle: "Complete onboarding tasks", stamp: "Due", icon: "checkmark.shield.fill", color: Theme.warning)
            ]
        case .investor:
            return [
                .init(title: "Portfolio cash flow", subtitle: paymentsTotal + " recorded", stamp: "Pay", icon: "chart.line.uptrend.xyaxis", color: Theme.success),
                .init(title: "Notifications", subtitle: "\(notifications.unreadCount) unread update(s)", stamp: "Now", icon: "bell.fill", color: Theme.accent)
            ]
        }
    }

    private var activeJobsCount: Int {
        jobs.myJobs.filter { ($0.status ?? "") != "completed" && ($0.status ?? "") != "cancelled" }.count
    }

    private var quoteCount: Int {
        jobs.myJobs.reduce(0) { $0 + ($1.bid_count ?? 0) }
    }

    private var paymentsTotal: String {
        "$\(payments.payments.reduce(0) { $0 + $1.amount } / 100)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PersonaMetricStrip(metrics: metrics)
            PersonaActionSection(items: actions, destination: destination)
            PersonaOpportunitySection(items: opportunities, destination: destination)
            PersonaActivitySection(items: activity)
            HomePulseSnapshot()
            HStack(spacing: 10) {
                Text(localization.format("YOUR %@ WORKSPACE", persona.rawValue.uppercased()))
                    .font(.system(size: 11, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(persona.color)
                Rectangle()
                    .fill(Theme.stroke)
                    .frame(height: 1)
            }
            .padding(.top, 2)
        }
    }

    @ViewBuilder
    private func destination(_ route: PersonaDashboardRoute) -> some View {
        switch route {
        case .job(let job): JobDetailView(job: job)
        case .browseJobs: JobsBrowseView()
        case .helpers: HelpersBrowseView()
        case .calendar: CalendarView()
        case .availability: AvailabilityManagerView()
        case .payments: PaymentsView()
        case .notifications: NotificationsView()
        case .growth: GrowthTabView()
        case .learn: LearnTabView()
        case .goals: GoalsPillarView()
        case .sinkingFunds: SinkingFundsPillarView()
        }
    }
}

private enum PersonaDashboardRoute {
    case job(APIJob)
    case browseJobs
    case helpers
    case calendar
    case availability
    case payments
    case notifications
    case growth
    case learn
    case goals
    case sinkingFunds
}

private struct PersonaMetric: Identifiable {
    let label: String
    let value: String
    let detail: String
    let icon: String
    let color: Color
    var id: String { label }
}

private struct PersonaAction: Identifiable {
    let title: String
    let subtitle: String
    let due: String
    let icon: String
    let color: Color
    let destination: PersonaDashboardRoute
    var id: String { title }
}

private struct PersonaOpportunity: Identifiable {
    let badge: String
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    let destination: PersonaDashboardRoute
    var id: String { title }
}

private struct PersonaActivity: Identifiable {
    let title: String
    let subtitle: String
    let stamp: String
    let icon: String
    let color: Color
    var id: String { title }
}

private struct PersonaMetricStrip: View {
    let metrics: [PersonaMetric]

    var body: some View {
        HStack(spacing: 10) {
            ForEach(metrics) { metric in
                VStack(alignment: .leading, spacing: 8) {
                    Image(systemName: metric.icon)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(metric.color)
                        .frame(width: 30, height: 30)
                        .background(metric.color.opacity(0.17), in: RoundedRectangle(cornerRadius: 9))
                    Text(metric.value)
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                    Text(metric.label)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                    Text(metric.detail)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(metric.color)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .cardStyle(padding: 11)
            }
        }
    }
}

private struct PersonaActionSection: View {
    let items: [PersonaAction]
    let destination: (PersonaDashboardRoute) -> AnyView

    init<Destination: View>(items: [PersonaAction], @ViewBuilder destination: @escaping (PersonaDashboardRoute) -> Destination) {
        self.items = items
        self.destination = { AnyView(destination($0)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Needs attention")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            ForEach(items) { item in
                NavigationLink {
                    destination(item.destination)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: item.icon)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(item.color)
                            .frame(width: 38, height: 38)
                            .background(item.color.opacity(0.17), in: RoundedRectangle(cornerRadius: 11))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.title)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                            Text(item.subtitle)
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Text(item.due)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(item.color)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(item.color.opacity(0.16), in: Capsule())
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .cardStyle(padding: 11)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct PersonaOpportunitySection: View {
    let items: [PersonaOpportunity]
    let destination: (PersonaDashboardRoute) -> AnyView

    init<Destination: View>(items: [PersonaOpportunity], @ViewBuilder destination: @escaping (PersonaDashboardRoute) -> Destination) {
        self.items = items
        self.destination = { AnyView(destination($0)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("For you")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items) { item in
                        NavigationLink {
                            destination(item.destination)
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text(item.badge.uppercased())
                                        .font(.system(size: 10, weight: .bold))
                                        .tracking(1)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 5)
                                        .background(.white.opacity(0.18), in: Capsule())
                                    Spacer()
                                    Image(systemName: item.icon)
                                        .font(.system(size: 18, weight: .semibold))
                                }
                                Spacer()
                                Text(item.title)
                                    .font(.system(size: 16, weight: .bold))
                                    .lineLimit(2)
                                Text(item.subtitle)
                                    .font(.system(size: 12))
                                    .opacity(0.88)
                                    .lineLimit(2)
                                HStack {
                                    Spacer()
                                    Text("Open")
                                    Image(systemName: "arrow.right")
                                }
                                .font(.system(size: 12, weight: .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(14)
                            .frame(width: 218, height: 168)
                            .background(
                                LinearGradient(colors: [item.color, item.color.opacity(0.62)],
                                               startPoint: .topLeading, endPoint: .bottomTrailing),
                                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

private struct PersonaActivitySection: View {
    let items: [PersonaActivity]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent activity")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    HStack(spacing: 11) {
                        Image(systemName: item.icon)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(item.color)
                            .frame(width: 34, height: 34)
                            .background(item.color.opacity(0.17), in: Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            Text(item.subtitle)
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Text(item.stamp)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    if index < items.count - 1 {
                        Divider()
                            .overlay(Theme.stroke)
                            .padding(.leading, 57)
                    }
                }
            }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.stroke, lineWidth: 1))
        }
    }
}
