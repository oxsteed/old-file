import SwiftUI
import MapKit
import CoreImage.CIFilterBuiltins
import UIKit

// MARK: - Customer

struct CustomerHome: View {
    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject var messages: MessagesStore
    let isGuest: Bool
    let onRequireAuth: () -> Void
    @State private var showPostJob       = false
    @State private var showInbox         = false
    @State private var showSubscriptions = false

    var body: some View {
        VStack(spacing: 18) {
            heroCTA

            if !isGuest {
                RecommendationFeedView()
                    .task { await RecommendationsStore.shared.load() }
            }

            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.activeJobs,
                         value: isGuest
                            ? "\(jobs.availableJobs.count)"
                            : "\(jobs.myJobs.filter { ($0.status ?? "") != "completed" && ($0.status ?? "") != "cancelled" }.count)",
                         trend: nil, icon: "hammer.fill", color: Theme.accent)
                StatTile(label: L10n.StatKey.openQuotes,
                         value: isGuest
                            ? "0"
                            : "\(jobs.myJobs.reduce(0) { $0 + ($1.bid_count ?? 0) })",
                         trend: nil, icon: "doc.text.fill", color: Theme.pillarHome)
            }

            if isGuest {
                VStack(spacing: 10) {
                    SectionHeader(title: "home.browse_jobs.title", actionLabel: nil)
                    if jobs.availableJobs.isEmpty {
                        Text("home.jobs.empty.nearby")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 8)
                    } else {
                        ForEach(jobs.availableJobs.prefix(5)) { job in
                            NavigationLink { JobDetailView(job: job) } label: { realJobRow(job) }
                                .buttonStyle(.plain)
                        }
                        NavigationLink { JobsBrowseView() } label: {
                            Text("home.jobs.see_all")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(Theme.accent)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 6)
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else {
                VStack(spacing: 10) {
                    SectionHeader(title: L10n.SectionKey.yourJobs)
                    if jobs.myJobs.isEmpty {
                        Text("home.jobs.empty.mine")
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
            }

            Button {
                if isGuest { onRequireAuth() }
                else { showInbox = true }
            } label: {
                HStack {
                    Image(systemName: "envelope.fill").foregroundStyle(Theme.accent)
                    Text(L10n.SectionKey.messages).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    Spacer()
                    if !isGuest, !messages.conversations.isEmpty {
                        Text("\(messages.conversations.count)").font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Image(systemName: "chevron.right").foregroundStyle(Theme.textTertiary)
                }
                .cardStyle()
            }
            .buttonStyle(.plain)

            if !isGuest {
                Button { showSubscriptions = true } label: {
                    HStack {
                        Image(systemName: "repeat.circle.fill").foregroundStyle(Theme.pillarGoals)
                        Text("My Subscriptions").font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(Theme.textTertiary)
                    }
                    .cardStyle()
                }
                .buttonStyle(.plain)
            }
        }
        .task {
            if isGuest {
                await jobs.loadAvailable()
            } else {
                await jobs.loadMyJobs()
                await messages.loadConversations()
            }
        }
        .sheet(isPresented: $showPostJob) { PostJobView() }
        .sheet(isPresented: $showInbox) { InboxView() }
        .sheet(isPresented: $showSubscriptions) {
            MySubscriptionsView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
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
                Button {
                    if isGuest { onRequireAuth() } else { showPostJob = true }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                        Text(L10n.CustomerKey.postJob).font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(Theme.accent, in: Capsule())
                }
                NavigationLink { HelpersBrowseView() } label: {
                    Text(L10n.CustomerKey.browseHelpers)
                        .font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.accent)
                        .padding(.horizontal, 16).padding(.vertical, 11)
                        .background(Capsule().strokeBorder(Theme.accent, lineWidth: 1.2))
                }
                .buttonStyle(.plain)
            }
            .padding(.top, 4)
        }
        .padding(20)
        // Expand the *card itself* to full width before applying the background,
        // otherwise the background stays sized to the content and looks off-center.
        .frame(maxWidth: .infinity, alignment: .leading)
        // Give this hero card more presence: reduce the outer side margins
        // (HomeTabView wraps HomeContent in 20pt horizontal padding).
        .padding(.leading, -8)
        .padding(.trailing, -8)
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
    @EnvironmentObject var cal: CalendarStore
    @State private var selectedJob: APIJob?
    @State private var jobToReview: APIJob?            // two-way review: helper rates customer
    @State private var locallyReviewedJobIds: Set<String> = {
        let saved = UserDefaults.standard.stringArray(forKey: "ox.helper.reviewedJobIds") ?? []
        return Set(saved)
    }()
    @State private var mode: Mode = .list
    @State private var mapPosition: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
            span: MKCoordinateSpan(latitudeDelta: 0.15, longitudeDelta: 0.15)
        )
    )

    enum Mode: String, CaseIterable, Identifiable {
        case list = "List"
        case map = "Map"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 18) {
            Picker("", selection: $mode) {
                ForEach(Mode.allCases) { m in
                    Text(m.rawValue).tag(m)
                }
            }
            .pickerStyle(.segmented)

            RecommendationFeedView()
                .task { await RecommendationsStore.shared.load() }

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

            HStack(spacing: 12) {
                NavigationLink { CalendarView() } label: {
                    HStack {
                        Image(systemName: "calendar").foregroundStyle(Theme.accent)
                        Text("Schedule").font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(Theme.textTertiary)
                    }
                    .cardStyle()
                }
                .buttonStyle(.plain)

                NavigationLink { AvailabilityManagerView() } label: {
                    HStack {
                        Image(systemName: "clock.badge.checkmark").foregroundStyle(Theme.success)
                        Text("Availability").font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(Theme.textTertiary)
                    }
                    .cardStyle()
                }
                .buttonStyle(.plain)
            }

            VStack(spacing: 10) {
                SectionHeader(title: L10n.SectionKey.availableNearYou)
                if jobs.availableJobs.isEmpty {
                    Text("No jobs available in your area yet.")
                        .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
                }
                if mode == .list {
                    ForEach(jobs.availableJobs.prefix(10)) { job in
                        Button { selectedJob = job } label: { availableRow(job) }
                            .buttonStyle(.plain)
                    }
                } else {
                    helperJobsMap
                }
            }

            // ── Pending reviews: helper rates the customer ────────────────
            let unreviewed = jobs.myJobs.filter { job in
                job.status == "completed"
                    && job.helper_reviewed_customer != true
                    && !locallyReviewedJobIds.contains(job.id)
            }
            if !unreviewed.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: "Rate your customers", actionLabel: nil)
                    ForEach(unreviewed.prefix(3)) { job in
                        Button { jobToReview = job } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "star.bubble.fill")
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(Theme.pillarCar)
                                    .frame(width: 36, height: 36)
                                    .background(Theme.pillarCar.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(job.title)
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(Theme.textPrimary)
                                        .lineLimit(1)
                                    Text("Tap to rate this customer")
                                        .font(.system(size: 11))
                                        .foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.textTertiary)
                            }
                            .cardStyle()
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .task {
            hydrateMapRegion()
            await jobs.loadAvailable()
            await jobs.loadMyJobs()
            await bids.loadMine()
            await payments.loadPayments()
            await cal.loadAppointments()
        }
        .sheet(item: $selectedJob) { job in
            NavigationStack { JobDetailView(job: job) }
        }
        .sheet(item: $jobToReview) { job in
            ReviewSheet(job: job) {
                // Mark reviewed locally so the prompt disappears immediately
                locallyReviewedJobIds.insert(job.id)
                UserDefaults.standard.set(Array(locallyReviewedJobIds), forKey: "ox.helper.reviewedJobIds")
                jobToReview = nil
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationBackground(Theme.background)
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

    private var helperJobsMap: some View {
        let pins = jobs.availableJobs.compactMap { job -> JobPin? in
            guard let lat = job.location_lat, let lng = job.location_lng else { return nil }
            return JobPin(job: job, coord: CLLocationCoordinate2D(latitude: lat, longitude: lng))
        }
        return Map(position: $mapPosition) {
            ForEach(pins) { pin in
                Annotation(pin.job.title, coordinate: pin.coord) {
                Button {
                    selectedJob = pin.job
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "hammer.fill")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(Theme.accent, in: Circle())
                        Text(pin.job.budgetDisplay)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Theme.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
                    }
                }
                .buttonStyle(.plain)
            }
            }
        }
        .frame(height: 280)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private func hydrateMapRegion() {
        let lat = UserDefaults.standard.object(forKey: "ox.location.lat") as? Double
        let lng = UserDefaults.standard.object(forKey: "ox.location.lng") as? Double
        let span = MKCoordinateSpan(latitudeDelta: 0.15, longitudeDelta: 0.15)
        if let lat, let lng {
            mapPosition = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: lat, longitude: lng), span: span))
        } else if let first = jobs.availableJobs.first, let lat = first.location_lat, let lng = first.location_lng {
            mapPosition = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: lat, longitude: lng), span: span))
        }
    }
}

private struct JobPin: Identifiable {
    let job: APIJob
    let coord: CLLocationCoordinate2D
    var id: String { job.id }
}

// MARK: - Business

struct BusinessHome: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore
    @EnvironmentObject var payments: PaymentsStore
    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject var messages: MessagesStore
    @EnvironmentObject var notifications: NotificationsStore
    @State private var cashAppHandle = "$OxSteed"
    @State private var didLoadWorkspace = false

    var body: some View {
        VStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Workspace").sectionTitle()
                        Text(workspace.selectedBusiness?.business_name ?? "Select a business")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                    }
                    Spacer()
                    Menu {
                        ForEach(workspace.workspace?.items ?? [], id: \.business_id) { item in
                            Button(item.business_name) {
                                Task { await workspace.selectBusiness(item.business_id) }
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "briefcase.fill")
                            Text(workspace.selectedBusiness?.role.capitalized ?? "Switch")
                            Image(systemName: "chevron.down")
                        }
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 8)
                        .background(Theme.surfaceElevated, in: Capsule())
                    }
                }

                if let analytics = workspace.analytics {
                    HStack(spacing: 12) {
                        StatTile(label: L10n.BusinessKey.revenueWeek,
                                 value: "$\(Int(analytics.mtd?.revenue ?? 0))",
                                 trend: nil, icon: "banknote.fill", color: Theme.success)
                        StatTile(label: L10n.StatKey.invoicesPending,
                                 value: "\(analytics.invoices?.sent ?? 0)",
                                 trend: nil, icon: "doc.plaintext.fill", color: Theme.warning)
                    }
                    HStack(spacing: 12) {
                        StatTile(label: "Products", value: "\(workspace.products.count)", trend: nil,
                                 icon: "shippingbox.fill", color: Theme.pillarCar)
                        StatTile(label: "Leads", value: "\(workspace.leads.count)", trend: nil,
                                 icon: "person.crop.circle.badge.questionmark", color: Theme.pillarPersonal)
                    }
                    MiniBarChart(values: analytics.monthly.map { month in
                        let peak = max(1, analytics.monthly.map(\.revenue).max() ?? 1)
                        return max(0.12, month.revenue / peak)
                    })
                    .frame(height: 64)
                } else {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(Theme.surfaceElevated)
                        .frame(height: 110)
                        .overlay(ProgressView().tint(Theme.accent))
                }
            }
            .cardStyle()

            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.teamOnline, value: "\(workspace.workspace?.items.count ?? 0)", trend: nil,
                         icon: "person.3.fill", color: Theme.success)
                StatTile(label: "Health alerts", value: "\(workspace.healthAlerts.count)", trend: nil,
                         icon: "bell.fill", color: Theme.warning)
            }

            RecommendationFeedView()
                .task { await RecommendationsStore.shared.load() }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Operational signals", actionLabel: nil)
                WorkspaceInsightCard(
                    icon: "chart.line.uptrend.xyaxis",
                    title: "Current workspace health",
                    subtitle: "\(workspace.calendarSummary?.this_week_count ?? 0) scheduled this week, \(workspace.healthAlerts.count) active alert(s), \(messages.conversations.count) inbox thread(s)",
                    badge: "Live",
                    color: Theme.pillarGoals
                )
                ForEach(workspace.healthAlerts.prefix(3)) { alert in
                    WorkspaceChecklistRow(
                        title: alert.title ?? "Health alert",
                        subtitle: alert.message ?? "",
                        icon: "bell.fill",
                        color: Theme.warning,
                        isComplete: false
                    )
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Business console", actionLabel: nil)
                HStack(spacing: 12) {
                    WorkspaceNavCard(icon: "square.grid.2x2.fill",
                                     title: "Messages",
                                     subtitle: "Business inbox",
                                     color: Theme.pillarHome) {
                        InboxView()
                    }
                    WorkspaceNavCard(icon: "calendar",
                                     title: "Calendar",
                                     subtitle: "Bookings + events",
                                     color: Theme.accent) {
                        CalendarView()
                    }
                }
                HStack(spacing: 12) {
                    WorkspaceNavCard(icon: "shippingbox.fill",
                                     title: "Growth",
                                     subtitle: "Products and catalog",
                                     color: Theme.pillarCar) {
                        BusinessProductsView()
                    }
                    WorkspaceNavCard(icon: "creditcard.fill",
                                     title: "Finance",
                                     subtitle: "Payouts and revenue",
                                     color: Theme.success) {
                        PaymentsView()
                    }
                }
                HStack(spacing: 12) {
                    WorkspaceNavCard(icon: "tray.full.fill",
                                     title: "Leads",
                                     subtitle: "Pipeline",
                                     color: Theme.pillarPersonal) {
                        BusinessLeadsView()
                    }
                    WorkspaceNavCard(icon: "bell.fill",
                                     title: "Health",
                                     subtitle: "Active alerts",
                                     color: Theme.warning) {
                        BusinessHealthAlertsView()
                    }
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Payout QR", actionLabel: nil)
                HStack(spacing: 14) {
                    QRCodeView(text: "https://cash.app/\(cashAppHandle.trimmingCharacters(in: CharacterSet(charactersIn: "$")))")
                        .frame(width: 108, height: 108)
                        .background(.white, in: RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.stroke, lineWidth: 1))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(L10n.BusinessKey.cashappTitle)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                        Text("Customers can scan this to pay quickly.")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(2)
                        TextField("Cash App handle", text: $cashAppHandle)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.system(size: 13, weight: .semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                            .foregroundStyle(Theme.textPrimary)
                    }
                }
                .cardStyle(padding: 12)
            }
        }
        .task {
            guard !didLoadWorkspace else { return }
            didLoadWorkspace = true
            await payments.loadPayments()
            await jobs.loadMyJobs()
            await messages.loadConversations()
            await notifications.load()
            await workspace.loadWorkspace()
        }
    }
}

private struct QRCodeView: View {
    let text: String
    private let context = CIContext()
    private let filter = CIFilter.qrCodeGenerator()

    var body: some View {
        Image(uiImage: generate())
            .interpolation(.none)
            .resizable()
            .scaledToFit()
            .padding(10)
    }

    private func generate() -> UIImage {
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return UIImage() }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return UIImage() }
        return UIImage(cgImage: cg)
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
    @StateObject private var store = ConsultingStore.shared

    // cents → "$X.XK" / "$X.XM"
    private func fmtCents(_ c: Int) -> String {
        let d = Double(c) / 100.0
        if d >= 1_000_000 { return String(format: "$%.1fM", d / 1_000_000) }
        if d >= 1_000    { return String(format: "$%.1fK", d / 1_000) }
        return String(format: "$%.0f", d)
    }

    var body: some View {
        VStack(spacing: 18) {

            // ── Pipeline stats ──────────────────────────────────────────────
            if let s = store.summary {
                HStack(spacing: 12) {
                    StatTile(label: "Active", value: "\(s.activeCount)",
                             trend: nil, icon: "person.bubble.fill", color: Theme.pillarPersonal)
                    StatTile(label: "Won", value: "\(s.wonCount)",
                             trend: nil, icon: "checkmark.seal.fill", color: Theme.success)
                }
                HStack(spacing: 12) {
                    StatTile(label: "Pipeline",
                             value: fmtCents(s.pipelineCents),
                             trend: nil, icon: "chart.bar.fill", color: Theme.accent)
                    StatTile(label: "Generated",
                             value: fmtCents(s.generatedCents),
                             trend: nil, icon: "arrow.up.right.circle.fill", color: Theme.pillarGoals)
                }
            } else if store.isLoading {
                HStack(spacing: 12) {
                    StatTile(label: "Active", value: "…", trend: nil, icon: "person.bubble.fill", color: Theme.pillarPersonal)
                    StatTile(label: "Won",    value: "…", trend: nil, icon: "checkmark.seal.fill", color: Theme.success)
                }
            }

            RecommendationFeedView()
                .task { await RecommendationsStore.shared.load() }

            // ── Referral pipeline nav ────────────────────────────────────────
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Client command center", actionLabel: nil)

                NavigationLink {
                    ConsultantPipelineView()
                } label: {
                    WorkspaceInsightCard(
                        icon: "person.bubble.fill",
                        title: "Referral pipeline",
                        subtitle: store.summary.map { "\($0.activeCount) active · \($0.wonCount) won · \($0.lostCount) lost" }
                            ?? "Loading…",
                        badge: store.summary != nil ? "Live" : nil,
                        color: Theme.pillarPersonal
                    )
                }
                .buttonStyle(.plain)

                HStack(spacing: 12) {
                    WorkspaceNavCard(icon: "calendar.badge.clock",
                                     title: "Schedule",
                                     subtitle: "Manage sessions",
                                     color: Theme.accent) { CalendarView() }
                    WorkspaceNavCard(icon: "envelope.fill",
                                     title: "Client inbox",
                                     subtitle: "Follow up",
                                     color: Theme.pillarHome) { InboxView() }
                }
            }

            // ── Recent activity ─────────────────────────────────────────────
            if !store.activity.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader(title: "Recent activity", actionLabel: nil)
                    ForEach(store.activity.prefix(4)) { item in
                        HStack(spacing: 10) {
                            Image(systemName: "clock.arrow.circlepath")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.event_type?.replacingOccurrences(of: "_", with: " ").capitalized ?? "Event")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                if let note = item.note_text, !note.isEmpty {
                                    Text(note)
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.textSecondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer()
                        }
                        .padding(.vertical, 6)
                        .padding(.horizontal, 12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }

            // ── Growth ──────────────────────────────────────────────────────
            WorkspaceNavCard(icon: "arrow.up.right.circle.fill",
                             title: "Grow consulting practice",
                             subtitle: "Use the growth ladder to productize services",
                             color: Theme.success) { GrowthTabView() }
        }
        .task { await store.load() }
    }
}

struct ToolOwnerHome: View {
    @EnvironmentObject var payments: PaymentsStore
    @EnvironmentObject var messages: MessagesStore
    @EnvironmentObject var tools: ToolRentalsStore

    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.toolsOut, value: "\(tools.myTools.count)", trend: tools.myTools.isEmpty ? "Setup" : nil,
                         icon: "hammer.fill", color: Theme.pillarCar)
                StatTile(label: L10n.StatKey.depositsHeld, value: "$0", trend: nil,
                         icon: "lock.fill", color: Theme.warning)
            }

            RecommendationFeedView()
                .task { await RecommendationsStore.shared.load() }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Rental launch checklist", actionLabel: nil)
                WorkspaceChecklistRow(title: "Create tool catalog", subtitle: "Add condition, rates, deposits, and photos", icon: "hammer.fill", color: Theme.pillarCar, isComplete: false)
                WorkspaceChecklistRow(title: "Set pickup rules", subtitle: "Define handoff windows and return policy", icon: "clock.badge.checkmark", color: Theme.pillarHome, isComplete: false)
                WorkspaceChecklistRow(title: "Connect payouts", subtitle: "Prepare deposits and rental income", icon: "creditcard.fill", color: Theme.success, isComplete: !payments.payments.isEmpty)
            }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Tool owner actions", actionLabel: nil)
                HStack(spacing: 12) {
                    WorkspaceNavCard(icon: "graduationcap.fill",
                                     title: "Rental basics",
                                     subtitle: "Learn setup",
                                     color: Theme.pillarGoals) {
                        LearnTabView()
                    }
                    WorkspaceNavCard(icon: "creditcard.fill",
                                     title: "Payouts",
                                     subtitle: "$\(payments.payments.reduce(0) { $0 + $1.amount } / 100) received",
                                     color: Theme.success) {
                        PaymentsView()
                    }
                }
                WorkspaceInsightCard(icon: "tray.full.fill",
                                     title: "Rental requests",
                                     subtitle: "\(messages.conversations.count) inquiry thread(s) will appear here once renters contact you.",
                                     badge: "Inbox",
                                     color: Theme.pillarHome)
            }
        }
        .task {
            await payments.loadPayments()
            await messages.loadConversations()
            await tools.loadMyTools()
        }
    }
}

struct FranchiseHome: View {
    @EnvironmentObject var payments: PaymentsStore
    @EnvironmentObject var cal: CalendarStore
    @EnvironmentObject private var localization: LocalizationManager

    @State private var applications: [FranchiseService.Application] = []
    @State private var territory: FranchiseService.TerritoryStatsResponse?
    @State private var isLoading = false
    @State private var loadError: String?

    private var latestApp: FranchiseService.Application? { applications.first }
    private var isLaunched: Bool {
        let s = latestApp?.status ?? ""
        return s == "launched" || s == "approved"
    }

    private var checklistPct: Int {
        guard let a = latestApp, let total = a.checklist_total, total > 0,
              let done = a.checklist_completed else { return 0 }
        return Int(Double(done) / Double(total) * 100)
    }

    private func fmtCents(_ c: Int?) -> String {
        let d = Double(c ?? 0) / 100
        if d >= 1_000 { return String(format: "$%.1fK", d / 1_000) }
        return String(format: "$%.0f", d)
    }

    var body: some View {
        VStack(spacing: 18) {

            // ── Status tiles ─────────────────────────────────────
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.subfranchisees,
                         value: applications.isEmpty ? "—" : "\(applications.count)",
                         trend: latestApp?.status?.capitalized,
                         icon: "building.2.fill", color: Theme.pillarSinking)
                StatTile(label: L10n.StatKey.compliance,
                         value: territory?.application?.compliance_pct.map { "\($0)%" } ?? "\(checklistPct)%",
                         trend: latestApp?.launch_readiness_status?.capitalized,
                         icon: "checkmark.seal.fill", color: Theme.success)
            }

            RecommendationFeedView()
                .task { await RecommendationsStore.shared.load() }

            // ── Territory KPIs (if launched) ──────────────────────
            if isLaunched, let kpis = territory?.territory_kpis {
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: "Territory at a glance", actionLabel: nil)
                    HStack(spacing: 8) {
                        franchiseKpiChip("Helpers",  "\(kpis.helpers_total ?? 0)",         "person.2.fill",       Theme.accent)
                        franchiseKpiChip("Jobs 30d", "\(kpis.jobs_posted_30d ?? 0)",        "hammer.fill",         Theme.pillarGoals)
                        franchiseKpiChip("Revenue",  fmtCents(kpis.revenue_30d_cents),      "dollarsign.circle.fill", Theme.success)
                    }
                }
            }

            // ── Application status ────────────────────────────────
            if let app = latestApp {
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: "Application status", actionLabel: nil)
                    HStack(spacing: 10) {
                        statusChip("Application", value: app.status ?? "—",           color: Theme.accent)
                        statusChip("Agreement",   value: app.agreement_status ?? "—", color: Theme.pillarGoals)
                        statusChip("Training",    value: app.training_status ?? "—",  color: Theme.pillarHome)
                    }
                    if let region = app.desired_region, let city = app.desired_city {
                        Label("\(city), \(region)", systemImage: "map.fill")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    if let total = app.checklist_total, total > 0, let done = app.checklist_completed {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(localization.format("Checklist: %d/%d complete", done, total))
                                .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                            ProgressView(value: Double(done), total: Double(total)).tint(Theme.success)
                        }
                    }
                }
            } else if !isLoading {
                WorkspaceInsightCard(icon: "map.fill",
                                     title: "Start your franchise application",
                                     subtitle: "Define your territory, apply for a program, and begin your launch checklist.",
                                     badge: "Apply",
                                     color: Theme.pillarSinking)
            }

            // ── Operations nav ────────────────────────────────────
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Territory operations", actionLabel: nil)
                HStack(spacing: 12) {
                    WorkspaceNavCard(icon: "calendar",
                                     title: "Onboarding",
                                     subtitle: "\(cal.appointments.count) session(s)",
                                     color: Theme.accent) { CalendarView() }
                    WorkspaceNavCard(icon: "chart.line.uptrend.xyaxis",
                                     title: "Growth",
                                     subtitle: "Expansion ladder",
                                     color: Theme.success) { GrowthTabView() }
                }
                WorkspaceNavCard(icon: "creditcard.fill",
                                 title: "Network payouts",
                                 subtitle: "Review franchise disbursements",
                                 color: Theme.pillarMoney) { PaymentsView() }
            }

            // ── Compliance checklist ──────────────────────────────
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Compliance readiness", actionLabel: nil)
                WorkspaceChecklistRow(title: "Brand standards",
                                      subtitle: "Confirm local operating playbook",
                                      icon: "checkmark.seal.fill", color: Theme.success,
                                      isComplete: latestApp?.agreement_status == "signed")
                WorkspaceChecklistRow(title: "Operator training",
                                      subtitle: "Assign learning path to new reps",
                                      icon: "graduationcap.fill", color: Theme.pillarGoals,
                                      isComplete: latestApp?.training_status == "completed")
                WorkspaceChecklistRow(title: "Revenue tracking",
                                      subtitle: "$\(payments.payments.reduce(0) { $0 + $1.amount } / 100) network payments",
                                      icon: "dollarsign.circle.fill", color: Theme.pillarMoney,
                                      isComplete: !payments.payments.isEmpty)
            }
        }
        .task {
            isLoading = true
            do {
                async let apps = FranchiseService.myApplications()
                async let terr = FranchiseService.territoryStats()
                async let _ = payments.loadPayments()
                async let _ = cal.loadAppointments()
                applications = (try? await apps) ?? []
                territory    = try? await terr
            }
            isLoading = false
        }
    }

    private func statusChip(_ label: String, value: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
            Text(value).font(.system(size: 11, weight: .semibold)).foregroundStyle(color).lineLimit(1)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(color.opacity(0.25), lineWidth: 1))
    }

    private func franchiseKpiChip(_ label: String, _ value: String, _ icon: String, _ color: Color) -> some View {
        VStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(color)
            Text(value).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
            Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.textTertiary).textCase(.uppercase).tracking(0.5)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(color.opacity(0.2), lineWidth: 1))
    }
}

struct InvestorHome: View {
    @EnvironmentObject var notifications: NotificationsStore

    @State private var kpis: InvestorService.PlatformKpis?
    @State private var chart: [InvestorService.ChartRow] = []
    @State private var franchise: InvestorService.FranchisePipelineResponse?
    @State private var period = "30d"
    @State private var isLoading = false
    @State private var loadError: String?

    private let periods = [("7d","7d"), ("30d","30d"), ("90d","90d"), ("1y","1y")]

    // ── Formatters ───────────────────────────────────────────────
    private func fmtCents(_ c: Int?) -> String {
        let d = Double(c ?? 0) / 100
        if d >= 1_000_000 { return String(format: "$%.1fM", d / 1_000_000) }
        if d >= 1_000     { return String(format: "$%.1fK", d / 1_000) }
        return String(format: "$%.0f", d)
    }
    private func fmt(_ n: Int?) -> String { n.map { "\($0)" } ?? "—" }
    private func pct(_ n: Int?)  -> String { n.map { "\($0)%" } ?? "—" }

    var body: some View {
        VStack(spacing: 18) {

            // ── Period picker ────────────────────────────────────
            HStack(spacing: 0) {
                ForEach(periods, id: \.0) { key, label in
                    Button {
                        period = key
                        Task { await loadData() }
                    } label: {
                        Text(label)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(period == key ? .white : Theme.textSecondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 7)
                            .background(period == key ? Theme.accent : Color.clear,
                                        in: RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(3)
            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Theme.stroke, lineWidth: 1))

            if let err = loadError {
                Text(err)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.warning)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            // ── Revenue + users ──────────────────────────────────
            HStack(spacing: 12) {
                StatTile(label: "Revenue",
                         value: isLoading ? "…" : fmtCents(kpis?.revenue_cur_cents),
                         trend: kpis.flatMap { k in
                             let d = (k.revenue_cur_cents ?? 0) - (k.revenue_prev_cents ?? 0)
                             return d >= 0 ? "▲" : "▼"
                         },
                         icon: "dollarsign.circle.fill", color: Theme.success)
                StatTile(label: "New users",
                         value: isLoading ? "…" : fmt(kpis?.new_users_cur),
                         trend: nil,
                         icon: "person.crop.circle.badge.plus", color: Theme.accent)
            }

            HStack(spacing: 12) {
                StatTile(label: "Jobs posted",
                         value: isLoading ? "…" : fmt(kpis?.new_jobs_cur),
                         trend: pct(kpis?.completion_rate),
                         icon: "hammer.fill", color: Theme.pillarGoals)
                StatTile(label: "Active subs",
                         value: isLoading ? "…" : fmt(kpis?.active_subscriptions),
                         trend: nil,
                         icon: "repeat.circle.fill", color: Theme.pillarPersonal)
            }

            RecommendationFeedView()
                .task { await RecommendationsStore.shared.load() }

            // ── Revenue mini-chart ───────────────────────────────
            if isLoading {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Theme.surfaceElevated)
                    .frame(height: 56)
                    .overlay(ProgressView().tint(Theme.accent))
            } else if !chart.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader(title: "Revenue trend", actionLabel: nil)
                    InvestorMiniChart(rows: chart).frame(height: 56)
                }
            }

            // ── Platform health chips ────────────────────────────
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Platform health", actionLabel: nil)
                HStack(spacing: 8) {
                    investorChip("Helpers",  fmt(kpis?.total_helpers),   "person.2.fill",       Theme.accent)
                    investorChip("Verified", fmt(kpis?.verified_helpers), "checkmark.seal.fill", Theme.success)
                    investorChip("Rating",
                                 kpis?.avg_helper_rating.map { String(format: "%.2f", $0) } ?? "—",
                                 "star.fill", Theme.pillarCar)
                }
                HStack(spacing: 8) {
                    investorChip("MTD rev",  fmtCents(kpis?.revenue_mtd_cents),      "banknote.fill",              Theme.success)
                    investorChip("Refunds",  fmtCents(kpis?.refunds_cur_cents),       "arrow.uturn.left.circle",    Theme.warning)
                    investorChip("Payouts",  fmtCents(kpis?.pending_payouts_cents),   "clock.fill",                 Theme.pillarHome)
                }
            }

            // ── Franchise pipeline ───────────────────────────────
            if let f = franchise, !f.pipeline.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: "Franchise pipeline", actionLabel: nil)
                    ForEach(f.pipeline) { stage in
                        let cnt = stage.count ?? 0
                        HStack(spacing: 10) {
                            Text(stage.status.capitalized)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                                .frame(width: 72, alignment: .leading)
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 4).fill(Theme.surfaceElevated)
                                    RoundedRectangle(cornerRadius: 4).fill(Theme.accent)
                                        .frame(width: f.total > 0
                                               ? geo.size.width * CGFloat(cnt) / CGFloat(f.total)
                                               : 0)
                                }
                            }
                            .frame(height: 8)
                            Text("\(cnt)")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(width: 24, alignment: .trailing)
                        }
                    }
                }
            }

            // ── Actions ──────────────────────────────────────────
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Investor actions", actionLabel: nil)
                WorkspaceNavCard(icon: "chart.line.uptrend.xyaxis",
                                 title: "Growth ladder",
                                 subtitle: "Platform flywheel expansion",
                                 color: Theme.success) { GrowthTabView() }
                WorkspaceNavCard(icon: "graduationcap.fill",
                                 title: "Learn",
                                 subtitle: "Guides and certification paths",
                                 color: Theme.pillarHome) { LearnTabView() }
            }
        }
        .task { await loadData() }
    }

    private func loadData() async {
        isLoading = true
        loadError = nil
        do {
            async let kR  = InvestorService.kpis(period: period)
            async let cR  = InvestorService.revenueChart(period: period)
            async let fR  = InvestorService.franchisePipeline()
            async let _   = notifications.load()
            let (k, c, f) = try await (kR, cR, fR)
            kpis      = k.kpis
            chart     = c.chart
            franchise = f
        } catch {
            loadError = "Could not load investor data"
        }
        isLoading = false
    }

    private func investorChip(_ label: String, _ value: String,
                              _ icon: String, _ color: Color) -> some View {
        VStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(color)
            Text(value)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Theme.textTertiary)
                .textCase(.uppercase)
                .tracking(0.5)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(color.opacity(0.2), lineWidth: 1))
    }
}

private struct InvestorMiniChart: View {
    let rows: [InvestorService.ChartRow]
    var body: some View {
        GeometryReader { geo in
            let vals = rows.map { Double(($0.job_fee_cents ?? 0) + ($0.subscription_cents ?? 0)) }
            let maxV = vals.max() ?? 1
            let barW = max(4, geo.size.width / CGFloat(rows.count) - 3)
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(Array(rows.enumerated()), id: \.offset) { i, _ in
                    let barH = max(4, CGFloat(vals[i] / maxV) * (geo.size.height - 4))
                    RoundedRectangle(cornerRadius: 4)
                        .fill(LinearGradient(colors: [Theme.success, Theme.accentDeep],
                                             startPoint: .top, endPoint: .bottom))
                        .frame(width: barW, height: barH)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        }
    }
}

private struct WorkspaceNavCard<Destination: View>: View {
    let icon: String
    let title: String
    let subtitle: String
    let color: Color
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(color)
                    .frame(width: 38, height: 38)
                    .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 11))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
            }
            .cardStyle(padding: 12)
        }
        .buttonStyle(.plain)
    }
}

private struct WorkspaceChecklistRow: View {
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    let isComplete: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: isComplete ? "checkmark.circle.fill" : icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(isComplete ? Theme.success : color)
                .frame(width: 36, height: 36)
                .background((isComplete ? Theme.success : color).opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            Spacer()
            Text(isComplete ? "Ready" : "Next")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(isComplete ? Theme.success : color)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background((isComplete ? Theme.success : color).opacity(0.14), in: Capsule())
        }
        .cardStyle(padding: 12)
    }
}

private struct WorkspaceInsightCard: View {
    let icon: String
    let title: String
    let subtitle: String
    let badge: String?
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(color)
                    .frame(width: 34, height: 34)
                    .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                Spacer()
                if let badge, !badge.isEmpty {
                    Text(badge)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(color)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(color.opacity(0.14), in: Capsule())
                }
            }
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            Text(subtitle)
                .font(.system(size: 11))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle(padding: 12)
    }
}

struct BusinessProductsView: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore
    @State private var isRefreshing = false
    @State private var showAddProduct = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    HStack {
                        Text("Catalog")
                            .sectionTitle()
                        Spacer()
                        Button {
                            showAddProduct = true
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "plus")
                                Text("New Product")
                            }
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                        }
                        Button {
                            Task {
                                isRefreshing = true
                                await workspace.refreshSelectedBusiness()
                                isRefreshing = false
                            }
                        } label: {
                            HStack(spacing: 6) {
                                if isRefreshing { ProgressView().tint(Theme.accent) }
                                Text("Refresh")
                            }
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                        }
                    }
                    if workspace.products.isEmpty {
                        Text("No products loaded yet.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 40)
                    }
                    ForEach(workspace.products) { product in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(product.name)
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(Theme.textPrimary)
                                    Text(product.category ?? "Uncategorized")
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                Text(product.price.map { "$\(Int($0))" } ?? "—")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(Theme.accent)
                            }
                            HStack(spacing: 8) {
                                businessLabel("Stock", "\(product.totalStock ?? 0)")
                                businessLabel("Variants", "\(product.variantCount ?? 0)")
                                businessLabel("Reviews", "\(product.reviewCount ?? 0)")
                                businessLabel(product.isActive == true ? "Active" : "Paused", " ")
                            }
                            HStack {
                                Spacer()
                                Button(product.isActive == true ? "Pause" : "Activate") {
                                    Task {
                                        _ = await workspace.setProductActive(
                                            productId: product.id,
                                            isActive: !(product.isActive == true)
                                        )
                                    }
                                }
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(product.isActive == true ? Theme.warning : Theme.success)
                            }
                        }
                        .cardStyle(padding: 12)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Products")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .sheet(isPresented: $showAddProduct) {
            AddBusinessProductSheet()
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.background)
        }
    }
}

struct BusinessLeadsView: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore
    @State private var showAddLead = false
    private let leadStatuses = ["new", "contacted", "qualified", "quoted", "won", "lost"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    HStack {
                        Text("Pipeline").sectionTitle()
                        Spacer()
                        Button {
                            showAddLead = true
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "plus")
                                Text("New Lead")
                            }
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                        }
                    }
                    if workspace.leads.isEmpty {
                        Text("No leads loaded yet.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 40)
                    }
                    ForEach(workspace.leads) { lead in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(lead.name ?? "Lead")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                Menu {
                                    ForEach(leadStatuses, id: \.self) { status in
                                        Button(status.capitalized) {
                                            Task {
                                                _ = await workspace.updateLeadStatus(leadId: lead.id, status: status)
                                            }
                                        }
                                    }
                                } label: {
                                    Text((lead.status ?? "new").capitalized)
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(Theme.accent)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(Theme.accentSoft, in: Capsule())
                                }
                            }
                            Text(lead.service_interest ?? "Interest not set")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                            if let note = lead.notes, !note.isEmpty {
                                Text(note)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textTertiary)
                                    .lineLimit(2)
                            }
                        }
                        .cardStyle(padding: 12)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Leads")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .sheet(isPresented: $showAddLead) {
            AddBusinessLeadSheet()
                .presentationDetents([.medium])
                .presentationBackground(Theme.background)
        }
    }
}

struct BusinessHealthAlertsView: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if workspace.healthAlerts.isEmpty {
                        Text("No active health alerts.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 40)
                    }
                    ForEach(workspace.healthAlerts) { alert in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(alert.title ?? "Alert")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                Text((alert.severity ?? "info").capitalized)
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.warning)
                            }
                            Text(alert.message ?? "")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                            if let actionURL = alert.action_url, !actionURL.isEmpty {
                                Text(actionURL)
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textTertiary)
                                    .lineLimit(1)
                            }
                        }
                        .cardStyle(padding: 12)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Health")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }
}

private func businessLabel(_ title: String, _ value: String) -> some View {
    HStack(spacing: 4) {
        Text(title).font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textTertiary)
        Text(value).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textPrimary)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 5)
    .background(Theme.surfaceElevated, in: Capsule())
}

private struct AddBusinessLeadSheet: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var serviceInterest = ""
    @State private var budget = ""
    @State private var notes = ""
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    OxTextField(title: "Name", text: $name)
                    OxTextField(title: "Email", text: $email)
                    OxTextField(title: "Phone", text: $phone)
                    OxTextField(title: "Service interest", text: $serviceInterest)
                    OxTextField(title: "Budget ($)", text: $budget, keyboard: .numberPad)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Notes").font(.system(size: 11, weight: .semibold))
                            .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
                        TextEditor(text: $notes)
                            .scrollContentBackground(.hidden)
                            .frame(height: 110)
                            .padding(8)
                            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                            .foregroundStyle(Theme.textPrimary)
                    }

                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            if isSaving { ProgressView().tint(.white) }
                            Text("Create Lead")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(.white)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("New Lead")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let ok = await workspace.createLead(
            name: name,
            email: email.isEmpty ? nil : email,
            phone: phone.isEmpty ? nil : phone,
            serviceInterest: serviceInterest.isEmpty ? nil : serviceInterest,
            budgetCents: Int(budget).map { $0 * 100 },
            notes: notes.isEmpty ? nil : notes
        )
        if ok { dismiss() }
    }
}

private struct AddBusinessProductSheet: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var category = ""
    @State private var sku = ""
    @State private var price = ""
    @State private var cost = ""
    @State private var description = ""
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    OxTextField(title: "Name", text: $name)
                    OxTextField(title: "Category", text: $category)
                    OxTextField(title: "SKU", text: $sku)
                    OxTextField(title: "Price ($)", text: $price, keyboard: .decimalPad)
                    OxTextField(title: "Cost ($)", text: $cost, keyboard: .decimalPad)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Description").font(.system(size: 11, weight: .semibold))
                            .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
                        TextEditor(text: $description)
                            .scrollContentBackground(.hidden)
                            .frame(height: 110)
                            .padding(8)
                            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                            .foregroundStyle(Theme.textPrimary)
                    }

                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            if isSaving { ProgressView().tint(.white) }
                            Text("Create Product")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(.white)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(!canSave || isSaving)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("New Product")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !category.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !sku.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        Double(price) != nil
    }

    private func save() async {
        guard let parsedPrice = Double(price) else { return }
        isSaving = true
        defer { isSaving = false }
        let ok = await workspace.createProduct(
            name: name,
            description: description.isEmpty ? nil : description,
            category: category,
            price: parsedPrice,
            cost: Double(cost),
            sku: sku
        )
        if ok { dismiss() }
    }
}
