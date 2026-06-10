import SwiftUI
import MapKit
import CoreImage.CIFilterBuiltins
import UIKit

// MARK: - Customer

private enum CustomerHomeSheet: Identifiable {
    case inbox
    case subscriptions
    case calendar
    case payments
    case notifications
    case settings
    case identity
    case map
    case invoices
    case disputes
    case support
    case products
    case sharedCarts
    case orders
    case verifyEmail
    case twoFactor
    case web(title: String, path: String)

    var id: String {
        switch self {
        case .inbox: return "inbox"
        case .subscriptions: return "subscriptions"
        case .calendar: return "calendar"
        case .payments: return "payments"
        case .notifications: return "notifications"
        case .settings: return "settings"
        case .identity: return "identity"
        case .map: return "map"
        case .invoices: return "invoices"
        case .disputes: return "disputes"
        case .support: return "support"
        case .products: return "products"
        case .sharedCarts: return "shared-carts"
        case .orders: return "orders"
        case .verifyEmail: return "verify-email"
        case .twoFactor: return "two-factor"
        case .web(let title, let path): return "web-\(title)-\(path)"
        }
    }

    var titleKey: String {
        switch self {
        case .inbox: return "Messages"
        case .subscriptions: return "Subscriptions"
        case .calendar: return "Bookings"
        case .payments: return "Payments"
        case .notifications: return "Notifications"
        case .settings: return "Settings"
        case .identity: return "Identity"
        case .map: return "Nearby"
        case .invoices: return "Invoices"
        case .disputes: return "Disputes"
        case .support: return "Support"
        case .products: return "Products"
        case .sharedCarts: return "Cart & Checkout"
        case .orders: return "Orders"
        case .verifyEmail: return "Verify Email"
        case .twoFactor: return "Two-Factor"
        case .web(let title, _): return title
        }
    }

    var webURL: URL? {
        guard case .web(_, let path) = self else { return nil }
        return URL(string: "https://oxsteed.com\(path)")
    }
}

struct CustomerHome: View {
    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject var messages: MessagesStore
    @EnvironmentObject private var localization: LocalizationManager
    let isGuest: Bool
    let onRequireAuth: () -> Void
    @State private var postJobPrefill: PostJobPrefill?
    @State private var activeSheet: CustomerHomeSheet?
    @State private var activeMoreGroup: CustomerOperationMoreGroup?

    var body: some View {
        VStack(spacing: 18) {
            customerTodayCard
            customerMetrics

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
                    if customerJobs.isEmpty {
                        emptyCustomerJobs
                    } else {
                        ForEach(customerJobs.prefix(4)) { job in
                            NavigationLink {
                                JobDetailView(job: job)
                            } label: { realJobRow(job) }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            customerOperations

            if !isGuest {
                RecommendationFeedView()
                    .task { await RecommendationsStore.shared.load() }
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
        .sheet(item: $postJobPrefill) { prefill in
            PostJobView(prefill: prefill)
        }
        .sheet(item: $activeSheet) { sheet in
            customerSheetDestination(sheet)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(item: $activeMoreGroup) { group in
            CustomerOperationMoreSheet(group: group) { item in
                activeMoreGroup = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    openCustomerOperation(item.destination)
                }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .presentationBackground(Theme.background)
        }
    }

    private var activeJobs: [APIJob] {
        jobs.myJobs.filter { !["completed", "cancelled"].contains(($0.status ?? "").lowercased()) }
    }

    private var customerJobs: [APIJob] {
        jobs.myJobs.sorted { lhs, rhs in
            let leftScore = actionPriority(lhs)
            let rightScore = actionPriority(rhs)
            if leftScore != rightScore { return leftScore > rightScore }
            return (lhs.created_at ?? "") > (rhs.created_at ?? "")
        }
    }

    private var actionableQuoteCount: Int {
        activeJobs.reduce(0) { $0 + ($1.bid_count ?? 0) }
    }

    private var topActionJob: APIJob? {
        customerJobs.first { actionPriority($0) > 0 } ?? activeJobs.first
    }

    private func actionPriority(_ job: APIJob) -> Int {
        let status = (job.status ?? "").lowercased()
        if (job.bid_count ?? 0) > 0 && ["published", "open", "pending"].contains(status) { return 4 }
        if ["assigned", "accepted", "in_progress", "started"].contains(status) { return 3 }
        if status == "completed" { return 2 }
        if ["published", "open", "pending"].contains(status) { return 1 }
        return 0
    }

    private func nextActionText(for job: APIJob) -> String {
        let status = (job.status ?? "").lowercased()
        let bids = job.bid_count ?? 0
        if bids > 0 && ["published", "open", "pending"].contains(status) {
            return localization.formatPlural("plural.review_quote", bids)
        }
        if ["assigned", "accepted"].contains(status) { return localization.localized("Confirm schedule") }
        if ["in_progress", "started"].contains(status) { return localization.localized("Track work") }
        if status == "completed" { return localization.localized("Review job") }
        if ["published", "open", "pending"].contains(status) { return localization.localized("Waiting for quotes") }
        return localization.localized(job.statusDisplay)
    }

    private var customerMetrics: some View {
        HStack(spacing: 12) {
            StatTile(label: L10n.StatKey.activeJobs,
                     value: isGuest ? "\(jobs.availableJobs.count)" : "\(activeJobs.count)",
                     trend: nil, icon: "hammer.fill", color: Theme.accent)
            StatTile(label: L10n.StatKey.openQuotes,
                     value: isGuest ? "0" : "\(actionableQuoteCount)",
                     trend: nil, icon: "doc.text.fill", color: Theme.pillarHome)
        }
    }

    private var customerOperations: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: localization.localized("Customer tools"), actionLabel: nil)

            operationGroup(title: localization.localized("Get work done"),
                           subtitle: localization.localized("Find help, track requests, and keep every appointment visible."),
                           items: [
                            CustomerOperationItem(title: localization.localized("My Jobs"), subtitle: localization.localized("Requests and quotes"), icon: "list.bullet.rectangle.fill", color: Theme.accent, destination: .web(title: "My Jobs", path: "/my-jobs")),
                            CustomerOperationItem(title: localization.localized("Find Helpers"), subtitle: localization.localized("Profiles and services"), icon: "person.2.fill", color: Theme.accent, destination: nil),
                            CustomerOperationItem(title: localization.localized("Discover"), subtitle: localization.localized("Businesses and services"), icon: "safari.fill", color: Theme.pillarGoals, destination: .web(title: "Discover", path: "/discover")),
                            CustomerOperationItem(title: localization.localized("Bookings"), subtitle: localization.localized("Schedule and requests"), icon: "calendar", color: Theme.pillarHome, destination: .calendar),
                            CustomerOperationItem(title: localization.localized("My Bookings"), subtitle: localization.localized("Helper and rental records"), icon: "calendar.badge.clock", color: Theme.pillarHome, destination: .web(title: "My Bookings", path: "/my-bookings")),
                            CustomerOperationItem(title: localization.localized("Messages"), subtitle: messagesSubtitle, icon: "envelope.fill", color: Theme.pillarGoals, destination: .inbox),
                            CustomerOperationItem(title: localization.localized("Nearby Map"), subtitle: localization.localized("Jobs and rentals"), icon: "map.fill", color: Theme.success, destination: .map)
                           ])

            operationGroup(title: localization.localized("Money and trust"),
                           subtitle: localization.localized("Payments, records, identity, and help when a job goes sideways."),
                           items: [
                            CustomerOperationItem(title: localization.localized("Payments"), subtitle: localization.localized("Escrow and wallet"), icon: "creditcard.fill", color: Theme.success, destination: .payments),
                            CustomerOperationItem(title: localization.localized("Invoices"), subtitle: localization.localized("Bills and receipts"), icon: "doc.text.fill", color: Theme.pillarCar, destination: .invoices),
                            CustomerOperationItem(title: localization.localized("Disputes"), subtitle: localization.localized("Resolve job issues"), icon: "exclamationmark.bubble.fill", color: Theme.warning, destination: .disputes),
                            CustomerOperationItem(title: localization.localized("Support"), subtitle: localization.localized("Escalation help"), icon: "lifepreserver.fill", color: Theme.danger, destination: .support),
                            CustomerOperationItem(title: localization.localized("Verify Identity"), subtitle: localization.localized("Build account trust"), icon: "checkmark.seal.fill", color: Theme.accent, destination: .identity)
                           ])

            operationGroup(title: localization.localized("Supplies and account"),
                           subtitle: localization.localized("Shop products, manage orders, rentals, settings, and notifications."),
                           items: [
                            CustomerOperationItem(title: localization.localized("Products"), subtitle: localization.localized("Marketplace"), icon: "shippingbox.fill", color: Theme.pillarGoals, destination: .products),
                            CustomerOperationItem(title: localization.localized("Cart & Checkout"), subtitle: localization.localized("Shared carts to review"), icon: "cart.fill", color: Theme.success, destination: .sharedCarts),
                            CustomerOperationItem(title: localization.localized("Orders"), subtitle: localization.localized("Purchases and carts"), icon: "bag.fill", color: Theme.pillarCar, destination: .orders),
                            CustomerOperationItem(title: localization.localized("Tool Rentals"), subtitle: localization.localized("Rent nearby tools"), icon: "wrench.and.screwdriver.fill", color: Theme.pillarHome, destination: .web(title: "Tool Rentals", path: "/tool-rentals")),
                            CustomerOperationItem(title: localization.localized("Notifications"), subtitle: localization.localized("Alerts and updates"), icon: "bell.fill", color: Theme.warning, destination: .notifications),
                            CustomerOperationItem(title: localization.localized("Plans"), subtitle: localization.localized("Membership and upgrades"), icon: "sparkles.rectangle.stack.fill", color: Theme.pillarGoals, destination: .web(title: "Plans", path: "/upgrade")),
                            CustomerOperationItem(title: localization.localized("Settings"), subtitle: localization.localized("Profile and alerts"), icon: "gearshape.fill", color: Theme.textSecondary, destination: .settings)
                           ])

            operationGroup(title: localization.localized("Account security"),
                           subtitle: localization.localized("Verification and security steps that unlock full platform access and build trust with helpers."),
                           items: [
                            CustomerOperationItem(title: localization.localized("Verify Email"), subtitle: localization.localized("Confirm your account"), icon: "envelope.badge.shield.half.filled.fill", color: Theme.accent, destination: .verifyEmail),
                            CustomerOperationItem(title: localization.localized("Two-Factor Auth"), subtitle: localization.localized("Protect sign-in"), icon: "lock.shield.fill", color: Theme.success, destination: .twoFactor),
                            CustomerOperationItem(title: localization.localized("Verify Identity"), subtitle: localization.localized("Build account trust"), icon: "checkmark.seal.fill", color: Theme.accent, destination: .identity),
                            CustomerOperationItem(title: localization.localized("Privacy & Safety"), subtitle: localization.localized("Data controls"), icon: "hand.raised.fill", color: Theme.pillarHome, destination: .web(title: "Privacy", path: "/privacy")),
                            CustomerOperationItem(title: localization.localized("Legal & Policies"), subtitle: localization.localized("Terms, escrow, disputes"), icon: "doc.plaintext.fill", color: Theme.textSecondary, destination: .web(title: "Legal", path: "/terms"))
                           ])

            if !isGuest {
                Button { activeSheet = .subscriptions } label: {
                    HStack {
                        Image(systemName: "repeat.circle.fill").foregroundStyle(Theme.pillarGoals)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(localization.localized("Recurring Services"))
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            Text(localization.localized("Subscriptions and repeat jobs"))
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(Theme.textTertiary)
                    }
                    .cardStyle()
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var messagesSubtitle: String {
        if isGuest { return localization.localized("Sign in to chat") }
        if messages.conversations.isEmpty { return localization.localized("Job conversations") }
        return localization.formatPlural("plural.conversation", messages.conversations.count)
    }

    private func operationGroup(title: String, subtitle: String, items: [CustomerOperationItem], visibleCount: Int = 3) -> some View {
        let visibleItems = Array(items.prefix(visibleCount))
        let overflowItems = Array(items.dropFirst(visibleCount))

        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(visibleItems) { item in
                    operationTile(item)
                }
                if !overflowItems.isEmpty {
                    Button {
                        activeMoreGroup = CustomerOperationMoreGroup(
                            title: title,
                            subtitle: subtitle,
                            items: overflowItems
                        )
                    } label: {
                        operationMoreTileLabel(count: overflowItems.count)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    @ViewBuilder
    private func operationTile(_ item: CustomerOperationItem) -> some View {
        if item.destination == nil {
            NavigationLink { HelpersBrowseView() } label: {
                operationTileLabel(item)
            }
            .buttonStyle(.plain)
        } else {
            Button {
                openCustomerOperation(item.destination)
            } label: {
                operationTileLabel(item)
            }
            .buttonStyle(.plain)
        }
    }

    private func operationTileLabel(_ item: CustomerOperationItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: item.icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(item.color)
                .frame(width: 30, height: 30)
                .background(item.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(item.subtitle)
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading)
        .padding(12)
        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private func operationMoreTileLabel(count: Int) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "ellipsis.circle.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.accent)
                .frame(width: 30, height: 30)
                .background(Theme.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text("More")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(localization.formatPlural("plural.more_option", count))
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
        .padding(12)
        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private func openCustomerOperation(_ destination: CustomerHomeSheet?) {
        if isGuest {
            onRequireAuth()
        } else {
            activeSheet = destination
        }
    }

    @ViewBuilder
    private func customerSheetDestination(_ sheet: CustomerHomeSheet) -> some View {
        switch sheet {
        case .inbox:
            InboxView()
        case .subscriptions:
            MySubscriptionsView()
        case .calendar:
            CalendarView()
        case .payments:
            PaymentsView()
        case .notifications:
            NotificationsView()
        case .settings:
            SettingsSheet()
        case .identity:
            VerifyIdentityView()
        case .map:
            MapBrowseView()
        case .invoices:
            CustomerInvoicesView()
        case .disputes:
            CustomerDisputesView()
        case .support:
            CustomerSupportNativeView()
        case .products:
            CustomerProductsView()
        case .sharedCarts:
            CustomerSharedCartsView()
        case .orders:
            CustomerOrdersView()
        case .verifyEmail:
            CustomerVerifyEmailView()
        case .twoFactor:
            CustomerTwoFactorView()
        case .web:
            if let url = sheet.webURL {
                InAppBrowserView(url: url)
                    .ignoresSafeArea()
            }
        }
    }

    private var emptyCustomerJobs: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("No active jobs yet.")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
            Text("Post a project, browse trusted helpers, or rebook someone you already know.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
            HStack(spacing: 10) {
                Button {
                    postJobPrefill = PostJobPrefill()
                } label: {
                    Label("customer.post_job", systemImage: "plus.circle.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(Theme.accent, in: Capsule())
                }
                NavigationLink { HelpersBrowseView() } label: {
                    Label("Find Helpers", systemImage: "person.2.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(Capsule().strokeBorder(Theme.accent, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
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
                Text(localizedCategoryName(job.category, localization: localization)).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Text(localization.localized(job.statusDisplay)).font(.system(size: 11, weight: .bold))
                    .foregroundStyle(job.statusColor)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(job.statusColor.opacity(0.14), in: Capsule())
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                Text(job.budgetDisplay).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Text(nextActionText(for: job))
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(job.statusColor)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(job.statusColor.opacity(0.14), in: Capsule())
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private var customerTodayCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "house.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 38, height: 38)
                    .background(Theme.accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Customer Today")
                        .font(.system(size: 18, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(todaySubtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
            }

            HStack(spacing: 10) {
                primaryCustomerAction
                NavigationLink { HelpersBrowseView() } label: {
                    Image(systemName: "person.2.fill")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.accent)
                        .frame(width: 44, height: 44)
                        .background(Capsule().strokeBorder(Theme.accent, lineWidth: 1.2))
                }
                .buttonStyle(.plain)
            }

            quickProjectChips

            HStack(spacing: 8) {
                Label("Verified helpers", systemImage: "checkmark.seal.fill")
                Label("Protected payments", systemImage: "lock.shield.fill")
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Theme.textSecondary)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, -8)
        .padding(.trailing, -8)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(LinearGradient(colors: [Theme.surface, Theme.surface.opacity(0.6), Theme.accentSoft],
                                 startPoint: .topLeading, endPoint: .bottomTrailing)))
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private var todaySubtitle: String {
        if isGuest { return localization.localized("Browse local work and sign in to post your own project.") }
        if let job = topActionJob { return localization.format("%@ for %@", nextActionText(for: job), job.title) }
        return localization.localized("Describe the next repair, errand, or home project.")
    }

    @ViewBuilder
    private var primaryCustomerAction: some View {
        if let job = topActionJob, !isGuest, actionPriority(job) > 1 {
            NavigationLink { JobDetailView(job: job) } label: {
                primaryActionLabel(title: nextActionText(for: job), icon: "checkmark.seal.fill")
            }
            .buttonStyle(.plain)
        } else {
            Button {
                if isGuest { onRequireAuth() } else { postJobPrefill = PostJobPrefill() }
            } label: {
                primaryActionLabel(title: localization.localized("Post Job"), icon: "plus.circle.fill")
            }
        }
    }

    private var quickProjectChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                quickProjectChip("Plumbing", icon: "drop.fill")
                quickProjectChip("Electrical", icon: "bolt.fill")
                quickProjectChip("Cleaning", icon: "sparkles")
                quickProjectChip("Yard Work", icon: "leaf.fill")
            }
        }
    }

    private func quickProjectChip(_ category: String, icon: String) -> some View {
        Button {
            if isGuest {
                onRequireAuth()
            } else {
                postJobPrefill = PostJobPrefill(category: category)
            }
        } label: {
            Label(localizedCategoryName(category, localization: localization), systemImage: icon)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Theme.surfaceElevated, in: Capsule())
                .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func primaryActionLabel(title: String, icon: String) -> some View {
        Label(title, systemImage: icon)
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(Theme.accent, in: Capsule())
    }
}

private struct CustomerOperationItem: Identifiable {
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    let destination: CustomerHomeSheet?

    var id: String { title }
}

private struct CustomerOperationMoreGroup: Identifiable {
    let title: String
    let subtitle: String
    let items: [CustomerOperationItem]

    var id: String { title }
}

private struct CustomerOperationMoreSheet: View {
    let group: CustomerOperationMoreGroup
    let onSelect: (CustomerOperationItem) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(group.subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(group.items) { item in
                        Button {
                            dismiss()
                            onSelect(item)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: item.icon)
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(item.color)
                                    .frame(width: 38, height: 38)
                                    .background(item.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))

                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.title)
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundStyle(Theme.textPrimary)
                                    Text(item.subtitle)
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.textSecondary)
                                        .lineLimit(2)
                                }

                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.textTertiary)
                            }
                            .cardStyle(padding: 12)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(18)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(group.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.done") { dismiss() }
                }
            }
        }
    }
}

private struct CustomerSharedCart: Decodable, Identifiable, Equatable {
    let id: String
    let shareToken: String
    let cartId: String?
    let sharedByName: String?
    let canModify: Bool?
    let expiresAt: String?
    let createdAt: String?
    let name: String?
    let description: String?
    let status: String?
    let subtotalCents: Int?
    let taxCents: Int?
    let totalCents: Int?
    let currency: String?
    let itemCount: Int?
    let reviewUrl: String?
}

private enum CustomerSharedCartsService {
    struct Response: Decodable {
        let sharedCarts: [CustomerSharedCart]
        let count: Int?
    }

    static func listMine() async throws -> Response {
        try await APIClient.shared.request("/api/shared-carts/my")
    }
}

private struct CustomerSharedCartsView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var carts: [CustomerSharedCart] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var browserURL: URL?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Carts helpers have shared with you for review, approval, and checkout.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    if isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else if let error {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(error)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.danger)
                            Button("common.retry") {
                                Task { await load() }
                            }
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.accent)
                        }
                        .cardStyle()
                    } else if carts.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Label("No shared carts yet", systemImage: "cart")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Theme.textPrimary)
                            Text("When a helper sends products, parts, or materials for approval, they will appear here.")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .cardStyle()
                    } else {
                        ForEach(carts) { cart in
                            Button {
                                open(cart)
                            } label: {
                                sharedCartRow(cart)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(18)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Cart & Checkout")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .sheet(item: $browserURL) { url in
                InAppBrowserView(url: url)
                    .ignoresSafeArea()
            }
        }
    }

    private func sharedCartRow(_ cart: CustomerSharedCart) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "cart.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.success)
                .frame(width: 36, height: 36)
                .background(Theme.success.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 5) {
                Text(nonBlank(cart.name) ?? localization.localized("Shared cart"))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if let description = nonBlank(cart.description) {
                    Text(description)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                HStack(spacing: 8) {
                    Text(localizedItemCount(cart.itemCount ?? 0))
                    Text(totalText(for: cart))
                    if let sharedBy = nonBlank(cart.sharedByName) {
                        Text(sharedBy)
                    }
                }
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
            }

            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textTertiary)
        }
        .cardStyle()
    }

    @MainActor
    private func load() async {
        isLoading = true
        error = nil
        do {
            let response = try await CustomerSharedCartsService.listMine()
            carts = response.sharedCarts
        } catch {
            self.error = String(describing: error)
        }
        isLoading = false
    }

    private func open(_ cart: CustomerSharedCart) {
        let path = nonBlank(cart.reviewUrl) ?? "/shared-cart/\(cart.shareToken)"
        browserURL = URL(string: path, relativeTo: AuthAPIConfig.baseURL)?.absoluteURL
    }

    private func totalText(for cart: CustomerSharedCart) -> String {
        let cents = cart.totalCents ?? cart.subtotalCents ?? 0
        return localization.formatCents(cents, currencyCode: cart.currency ?? "USD")
    }

    private func localizedItemCount(_ count: Int) -> String {
        localization.formatPlural("plural.item", count)
    }

    private func nonBlank(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}

private struct CustomerInvoice: Decodable, Identifiable, Equatable {
    let id: String
    let invoice_number: String?
    let client_name: String?
    let status: String?
    let issued_at: String?
    let due_at: String?
    let amount_cents: Int?
    let business_name: String?
}

private struct CustomerDispute: Decodable, Identifiable, Equatable {
    let id: String
    let job_id: String?
    let reason: String?
    let description: String?
    let status: String?
    let job_title: String?
    let created_at: String?
}

private struct CustomerOrder: Decodable, Identifiable, Equatable {
    let id: String
    let status: String?
    let total_cents: Int?
    let subtotal_cents: Int?
    let created_at: String?
    let updated_at: String?
}

private struct CustomerProduct: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let description: String?
    let category: String?
    let price_cents: Int?
    let product_image_url: String?
    let avg_rating: Double?
    let rating_count: Int?
    let in_carts_count: Int?
    let affiliate_url: String?
}

private enum CustomerOperationsService {
    struct InvoicesResponse: Decodable { let invoices: [CustomerInvoice] }
    struct DisputesResponse: Decodable { let disputes: [CustomerDispute]? }
    struct OrdersResponse: Decodable { let data: [CustomerOrder] }
    struct ProductsResponse: Decodable { let data: [CustomerProduct] }
    struct SupportStatus: Decodable { let online: Bool?; let availableAgents: Int?; let queueLength: Int? }
    struct SupportCreateResponse: Decodable { let ticketId: String?; let message: String?; let routedTo: String? }
    struct TwoFactorStatus: Decodable { let enabled: Bool; let verifiedAt: String?; let backupCodesRemaining: Int? }
    struct TwoFactorSetup: Decodable { let secret: String; let qrCode: String?; let message: String? }
    struct TwoFactorVerify: Decodable { let message: String?; let backupCodes: [String]?; let warning: String? }

    static func invoices() async throws -> [CustomerInvoice] {
        let response: InvoicesResponse = try await APIClient.shared.request("/api/invoices", query: ["limit": 50])
        return response.invoices
    }

    static func disputes() async throws -> [CustomerDispute] {
        let response: DisputesResponse = try await APIClient.shared.request("/api/disputes/my")
        return response.disputes ?? []
    }

    static func openDispute(jobId: String, reason: String, description: String) async throws {
        struct Req: Encodable {
            let reason: String
            let description: String
            let job_type: String
        }
        try await APIClient.shared.requestVoid(
            "/api/disputes/jobs/\(jobId)",
            method: .POST,
            body: Req(reason: reason, description: description, job_type: "standard")
        )
    }

    static func orders() async throws -> [CustomerOrder] {
        let response: OrdersResponse = try await APIClient.shared.request("/api/orders", query: ["limit": 50])
        return response.data
    }

    static func cancelOrder(_ orderId: String) async throws {
        try await APIClient.shared.requestVoid("/api/orders/\(orderId)/cancel", method: .POST)
    }

    static func products(search: String = "") async throws -> [CustomerProduct] {
        if search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let response: ProductsResponse = try await APIClient.shared.request("/api/marketplace/products/browse", query: ["limit": 40, "sortBy": "in_carts"])
            return response.data
        }
        let response: ProductsResponse = try await APIClient.shared.request("/api/marketplace/products/search", query: ["q": search, "limit": 40])
        return response.data
    }

    static func supportStatus() async throws -> SupportStatus {
        try await APIClient.shared.request("/api/support-routing/status")
    }

    static func createSupportTicket(category: String, priority: String, message: String) async throws -> SupportCreateResponse {
        struct Req: Encodable {
            let category: String
            let priority: String
            let message: String
        }
        return try await APIClient.shared.request(
            "/api/support-routing/conversations",
            method: .POST,
            body: Req(category: category, priority: priority, message: message)
        )
    }

    static func twoFactorStatus() async throws -> TwoFactorStatus {
        try await APIClient.shared.request("/api/2fa/status")
    }

    static func setupTwoFactor() async throws -> TwoFactorSetup {
        try await APIClient.shared.request("/api/2fa/setup", method: .POST)
    }

    static func verifyTwoFactorSetup(token: String) async throws -> TwoFactorVerify {
        struct Req: Encodable { let token: String }
        return try await APIClient.shared.request("/api/2fa/verify-setup", method: .POST, body: Req(token: token))
    }

    static func disableTwoFactor(token: String) async throws {
        struct Req: Encodable { let token: String }
        try await APIClient.shared.requestVoid("/api/2fa/disable", method: .POST, body: Req(token: token))
    }
}

private struct CustomerInvoicesView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var invoices: [CustomerInvoice] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        CustomerNativeListShell(title: "Invoices", subtitle: "Bills and receipts from OxSteed jobs.", isLoading: isLoading, error: error, isEmpty: invoices.isEmpty, emptyTitle: "No invoices yet", retry: { await load() }) {
            ForEach(invoices) { invoice in
                nativeInfoRow(icon: "doc.text.fill", color: Theme.pillarCar, title: invoice.invoice_number ?? "Invoice", subtitle: invoice.business_name ?? invoice.client_name ?? "OxSteed invoice", trailing: centsText(invoice.amount_cents, localization: localization), badge: invoice.status)
            }
        }
        .task { await load() }
    }

    @MainActor private func load() async {
        isLoading = true; error = nil
        do { invoices = try await CustomerOperationsService.invoices() }
        catch { self.error = String(describing: error) }
        isLoading = false
    }
}

private struct CustomerDisputesView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var disputes: [CustomerDispute] = []
    @State private var jobs: [APIJob] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showingOpenDispute = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Track job issues, evidence review, and resolution status.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                    Button {
                        showingOpenDispute = true
                    } label: {
                    Label("home.open_dispute", systemImage: "plus.circle.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .background(Theme.warning, in: RoundedRectangle(cornerRadius: 14))
                    }
                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 150)
                    } else if let error {
                        nativeErrorCard(error) { Task { await load() } }
                    } else if disputes.isEmpty {
                        nativeEmptyCard(localization.localized("No disputes open"))
                    } else {
                        ForEach(disputes) { dispute in
                            nativeInfoRow(
                                icon: "exclamationmark.bubble.fill",
                                color: Theme.warning,
                                title: dispute.job_title ?? localization.format("Dispute %@", dispute.id),
                                subtitle: dispute.description ?? dispute.reason?.humanized ?? localization.localized("Job issue"),
                                trailing: dateSnippet(dispute.created_at),
                                badge: dispute.status?.humanized
                            )
                        }
                    }
                }
                .padding(18)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Disputes")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .sheet(isPresented: $showingOpenDispute) {
                OpenDisputeSheet(jobs: jobs) {
                    await load()
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
            }
        }
    }

    @MainActor private func load() async {
        isLoading = true; error = nil
        do {
            async let disputesTask = CustomerOperationsService.disputes()
            async let jobsTask = JobsService.myJobs(limit: 100)
            disputes = try await disputesTask
            let loadedJobs = try await jobsTask
            jobs = loadedJobs.filter { job in
                !["cancelled"].contains((job.status ?? "").lowercased())
            }
        }
        catch { self.error = String(describing: error) }
        isLoading = false
    }
}

private struct CustomerOrdersView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var orders: [CustomerOrder] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        CustomerNativeListShell(title: localization.localized("Orders"), subtitle: localization.localized("Marketplace purchases and order status."), isLoading: isLoading, error: error, isEmpty: orders.isEmpty, emptyTitle: localization.localized("No orders yet"), retry: { await load() }) {
            ForEach(orders) { order in
                VStack(alignment: .leading, spacing: 10) {
                    nativeInfoRow(icon: "bag.fill", color: Theme.pillarCar, title: localization.format("Order %@", String(order.id.prefix(8))), subtitle: dateSnippet(order.created_at), trailing: centsText(order.total_cents ?? order.subtotal_cents, localization: localization), badge: order.status?.humanized)
                    if ["pending", "paid"].contains((order.status ?? "").lowercased()) {
                        Button("home.cancel_order") {
                            Task { await cancel(order) }
                        }
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
            }
        }
        .task { await load() }
    }

    @MainActor private func load() async {
        isLoading = true; error = nil
        do { orders = try await CustomerOperationsService.orders() }
        catch { self.error = String(describing: error) }
        isLoading = false
    }

    @MainActor private func cancel(_ order: CustomerOrder) async {
        error = nil
        do {
            try await CustomerOperationsService.cancelOrder(order.id)
            await load()
        } catch {
            self.error = String(describing: error)
        }
    }
}

private struct OpenDisputeSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var localization: LocalizationManager
    let jobs: [APIJob]
    let onCreated: () async -> Void

    @State private var selectedJobId = ""
    @State private var reason = "poor_quality"
    @State private var description = ""
    @State private var isSubmitting = false
    @State private var error: String?

    private let reasons = [
        "work_not_completed",
        "poor_quality",
        "no_show",
        "overcharged",
        "property_damage",
        "safety_concern",
        "fraud",
        "other"
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if jobs.isEmpty {
                        nativeEmptyCard(localization.localized("No eligible jobs found"))
                    } else {
                        Picker("Job", selection: $selectedJobId) {
                            ForEach(jobs) { job in
                                Text(job.title).tag(job.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .onAppear {
                            if selectedJobId.isEmpty {
                                selectedJobId = jobs.first?.id ?? ""
                            }
                        }

                        Picker(LocalizedStringKey("picker.reason"), selection: $reason) {
                            ForEach(reasons, id: \.self) { Text($0.humanized).tag($0) }
                        }
                        .pickerStyle(.menu)

                        TextEditor(text: $description)
                            .frame(minHeight: 180)
                            .padding(10)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))

                        Text("Include what happened, what resolution you want, and any evidence you can provide.")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                    }

                    if let error {
                        Text(error)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.danger)
                    }
                }
                .padding(18)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Open Dispute")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "common.opening" : "common.open") {
                        Task { await submit() }
                    }
                    .disabled(!canSubmit || isSubmitting)
                }
            }
        }
    }

    private var canSubmit: Bool {
        !selectedJobId.isEmpty && description.trimmingCharacters(in: .whitespacesAndNewlines).count >= 20
    }

    @MainActor private func submit() async {
        isSubmitting = true; error = nil
        do {
            try await CustomerOperationsService.openDispute(jobId: selectedJobId, reason: reason, description: description)
            await onCreated()
            dismiss()
        } catch {
            self.error = String(describing: error)
        }
        isSubmitting = false
    }
}

private struct CustomerProductsView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var products: [CustomerProduct] = []
    @State private var search = ""
    @State private var isLoading = true
    @State private var error: String?
    @State private var browserURL: URL?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Browse supplies, parts, and kits from the live OxSteed marketplace.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)

                    HStack(spacing: 8) {
                        TextField("Search products", text: $search)
                            .textInputAutocapitalization(.never)
                            .padding(12)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                        Button {
                            Task { await load() }
                        } label: {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 44, height: 44)
                                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
                        }
                    }

                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 150)
                    } else if let error {
                        nativeErrorCard(error) { Task { await load() } }
                    } else if products.isEmpty {
                        nativeEmptyCard(localization.localized("No products found"))
                    } else {
                        ForEach(products) { product in
                            Button {
                                if let raw = product.affiliate_url, let url = URL(string: raw) {
                                    browserURL = url
                                }
                            } label: {
                                nativeInfoRow(icon: "shippingbox.fill", color: Theme.pillarGoals, title: product.name, subtitle: product.category ?? product.description ?? localization.localized("Marketplace product"), trailing: centsText(product.price_cents, localization: localization), badge: product.avg_rating.map { String(format: "%.1f ★", $0) })
                            }
                            .buttonStyle(.plain)
                            .disabled(product.affiliate_url == nil)
                        }
                    }
                }
                .padding(18)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Products")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .sheet(item: $browserURL) { url in
                InAppBrowserView(url: url).ignoresSafeArea()
            }
        }
    }

    @MainActor private func load() async {
        isLoading = true; error = nil
        do { products = try await CustomerOperationsService.products(search: search) }
        catch { self.error = String(describing: error) }
        isLoading = false
    }
}

private struct CustomerSupportNativeView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var category = "billing"
    @State private var priority = "normal"
    @State private var message = ""
    @State private var statusText = ""
    @State private var isSubmitting = false
    @State private var result: String?
    @State private var error: String?

    private let categories = ["billing", "job", "payment", "safety", "account", "technical", "other"]
    private let priorities = ["normal", "high", "urgent"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(statusText)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .cardStyle()

                    Picker(localization.localized("Category"), selection: $category) {
                        ForEach(categories, id: \.self) { Text(localizedCategory($0)).tag($0) }
                    }
                    .pickerStyle(.menu)

                    Picker(localization.localized("Priority"), selection: $priority) {
                        ForEach(priorities, id: \.self) { Text(localizedPriority($0)).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    TextEditor(text: $message)
                        .frame(minHeight: 160)
                        .padding(10)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))

                    if let result {
                        Text(result).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.success)
                    }
                    if let error {
                        Text(error).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.danger)
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        Label(isSubmitting ? localization.localized("Sending...") : localization.localized("Create Support Ticket"), systemImage: "paperplane.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .background(canSubmit ? Theme.accent : Theme.textTertiary, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(!canSubmit || isSubmitting)
                }
                .padding(18)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Support")
            .navigationBarTitleDisplayMode(.inline)
            .task { await loadStatus() }
        }
    }

    private var canSubmit: Bool {
        message.trimmingCharacters(in: .whitespacesAndNewlines).count >= 10
    }

    private func localizedCategory(_ category: String) -> String {
        switch category {
        case "billing": return localization.localized("Billing")
        case "job": return localization.localized("Job")
        case "payment": return localization.localized("Payment")
        case "safety": return localization.localized("Safety")
        case "account": return localization.localized("Account")
        case "technical": return localization.localized("Technical")
        case "other": return localization.localized("Other")
        default: return category.humanized
        }
    }

    private func localizedPriority(_ priority: String) -> String {
        switch priority {
        case "normal": return localization.localized("Normal")
        case "high": return localization.localized("High")
        case "urgent": return localization.localized("Urgent")
        default: return priority.humanized
        }
    }

    @MainActor private func loadStatus() async {
        do {
            let status = try await CustomerOperationsService.supportStatus()
            let agents = status.availableAgents ?? 0
            let queue = status.queueLength ?? 0
            statusText = agents > 0
                ? localization.format(agents == 1 ? "%d support agent available now." : "%d support agents available now.", agents)
                : localization.format(queue == 1 ? "Support queue active. %d request waiting." : "Support queue active. %d requests waiting.", queue)
        } catch {
            statusText = localization.localized("Support routing is available.")
        }
    }

    @MainActor private func submit() async {
        isSubmitting = true; error = nil; result = nil
        do {
            let response = try await CustomerOperationsService.createSupportTicket(category: category, priority: priority, message: message)
            result = localization.format("Ticket %@ created. %@", response.ticketId ?? "", response.message ?? localization.localized("Support will follow up shortly."))
            message = ""
        } catch {
            self.error = String(describing: error)
        }
        isSubmitting = false
    }
}

private struct CustomerVerifyEmailView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @EnvironmentObject private var auth: AuthStore
    @State private var otp = ""
    @State private var sent = false
    @State private var isLoading = false
    @State private var message: String?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Label(auth.user?.email_verified == true ? localization.localized("Email verified") : localization.localized("Verify your email"), systemImage: auth.user?.email_verified == true ? "checkmark.seal.fill" : "envelope.badge.shield.half.filled.fill")
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundStyle(auth.user?.email_verified == true ? Theme.success : Theme.textPrimary)

                Text(auth.user?.email ?? localization.localized("Your account email"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)

                if auth.user?.email_verified != true {
                    Button(sent ? "auth.send_code_again" : "auth.send_verification_code") {
                        Task { await requestCode() }
                    }
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))

                    TextField(localization.localized("Verification code"), text: $otp)
                        .keyboardType(.numberPad)
                        .padding(12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))

                    Button(isLoading ? "auth.verifying" : "auth.verify_email") {
                        Task { await verify() }
                    }
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(otp.isEmpty ? Theme.textTertiary : Theme.success, in: RoundedRectangle(cornerRadius: 14))
                    .disabled(otp.isEmpty || isLoading)
                }

                if let message { Text(message).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.success) }
                if let error { Text(error).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.danger) }
                Spacer()
            }
            .padding(18)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text("auth.verify_email"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    @MainActor private func requestCode() async {
        guard let email = auth.user?.email else { return }
        isLoading = true; error = nil; message = nil
        do {
            try await AuthService.requestEmailVerificationOTP(email: email)
            sent = true
            message = localization.localized("Verification code sent.")
        } catch {
            self.error = String(describing: error)
        }
        isLoading = false
    }

    @MainActor private func verify() async {
        guard let email = auth.user?.email else { return }
        isLoading = true; error = nil; message = nil
        do {
            try await AuthService.verifyEmailOTP(email: email, otp: otp)
            auth.user = try? await AuthService.me()
            message = localization.localized("Email verified.")
        } catch {
            self.error = String(describing: error)
        }
        isLoading = false
    }
}

private struct CustomerTwoFactorView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var status: CustomerOperationsService.TwoFactorStatus?
    @State private var setup: CustomerOperationsService.TwoFactorSetup?
    @State private var token = ""
    @State private var disableToken = ""
    @State private var backupCodes: [String] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var message: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Label(status?.enabled == true ? localization.localized("Two-factor is enabled") : localization.localized("Two-factor is off"), systemImage: status?.enabled == true ? "lock.shield.fill" : "lock.open.fill")
                        .font(.system(size: 18, weight: .heavy))
                        .foregroundStyle(status?.enabled == true ? Theme.success : Theme.textPrimary)

                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 120)
                    } else if status?.enabled == true {
                        Text(localization.format("Backup codes remaining: %d", status?.backupCodesRemaining ?? 0))
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                        TextField(localization.localized("Current authenticator code"), text: $disableToken)
                            .keyboardType(.numberPad)
                            .padding(12)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                        Button("twofactor.disable") { Task { await disable() } }
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .background(Theme.danger, in: RoundedRectangle(cornerRadius: 14))
                    } else {
                        if let setup {
                            if let image = qrImage(from: setup.qrCode) {
                                Image(uiImage: image)
                                    .interpolation(.none)
                                    .resizable()
                                    .scaledToFit()
                                    .frame(maxWidth: 220)
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(.white, in: RoundedRectangle(cornerRadius: 14))
                            }
                            Text(localization.format("Secret: %@", setup.secret))
                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                .foregroundStyle(Theme.textSecondary)
                                .textSelection(.enabled)
                            TextField(localization.localized("Authenticator code"), text: $token)
                                .keyboardType(.numberPad)
                                .padding(12)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                            Button("twofactor.verify_enable") { Task { await verifySetup() } }
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 13)
                                .background(Theme.success, in: RoundedRectangle(cornerRadius: 14))
                        } else {
                            Button("twofactor.setup") { Task { await startSetup() } }
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 13)
                                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                        }
                    }

                    if !backupCodes.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(localization.localized("Backup codes"))
                                .font(.system(size: 14, weight: .bold))
                            ForEach(backupCodes, id: \.self) { code in
                                Text(code).font(.system(size: 12, design: .monospaced))
                            }
                        }
                        .cardStyle()
                    }

                    if let message { Text(message).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.success) }
                    if let error { Text(error).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.danger) }
                }
                .padding(18)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Two-Factor")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
        }
    }

    @MainActor private func load() async {
        isLoading = true; error = nil
        do { status = try await CustomerOperationsService.twoFactorStatus() }
        catch { self.error = String(describing: error) }
        isLoading = false
    }

    @MainActor private func startSetup() async {
        error = nil; message = nil
        do { setup = try await CustomerOperationsService.setupTwoFactor() }
        catch { self.error = String(describing: error) }
    }

    @MainActor private func verifySetup() async {
        error = nil; message = nil
        do {
            let response = try await CustomerOperationsService.verifyTwoFactorSetup(token: token)
            backupCodes = response.backupCodes ?? []
            message = response.message ?? localization.localized("Two-factor enabled.")
            setup = nil
            await load()
        } catch {
            self.error = String(describing: error)
        }
    }

    @MainActor private func disable() async {
        error = nil; message = nil
        do {
            try await CustomerOperationsService.disableTwoFactor(token: disableToken)
            message = localization.localized("Two-factor disabled.")
            disableToken = ""
            await load()
        } catch {
            self.error = String(describing: error)
        }
    }

    private func qrImage(from dataURL: String?) -> UIImage? {
        guard let raw = dataURL, let comma = raw.firstIndex(of: ",") else { return nil }
        let b64 = String(raw[raw.index(after: comma)...])
        guard let data = Data(base64Encoded: b64) else { return nil }
        return UIImage(data: data)
    }
}

private struct CustomerNativeListShell<Content: View>: View {
    let title: String
    let subtitle: String
    let isLoading: Bool
    let error: String?
    let isEmpty: Bool
    let emptyTitle: String
    let retry: () async -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 150)
                    } else if let error {
                        nativeErrorCard(error) { Task { await retry() } }
                    } else if isEmpty {
                        nativeEmptyCard(emptyTitle)
                    } else {
                        content()
                    }
                }
                .padding(18)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private func nativeInfoRow(icon: String, color: Color, title: String, subtitle: String, trailing: String?, badge: String?) -> some View {
    HStack(alignment: .top, spacing: 12) {
        Image(systemName: icon)
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(color)
            .frame(width: 38, height: 38)
            .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
            Text(subtitle)
                .font(.system(size: 11))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(2)
            if let badge, !badge.isEmpty {
                Text(badge)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(color)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(color.opacity(0.13), in: Capsule())
            }
        }
        Spacer()
        if let trailing {
            Text(trailing)
                .font(.system(size: 12, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
        }
    }
    .cardStyle()
}

private func nativeErrorCard(_ message: String, retry: @escaping () -> Void) -> some View {
    VStack(alignment: .leading, spacing: 10) {
        Text(message)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.danger)
        Button("common.retry", action: retry)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Theme.accent)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .cardStyle()
}

private func nativeEmptyCard(_ title: String) -> some View {
    Label(title, systemImage: "tray")
        .font(.system(size: 14, weight: .bold))
        .foregroundStyle(Theme.textSecondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
}

private func centsText(_ cents: Int?, localization: LocalizationManager) -> String? {
    guard let cents else { return nil }
    return localization.formatCents(cents)
}

private func localizedCategoryName(_ category: String?, localization: LocalizationManager) -> String {
    guard let category, !category.isEmpty else { return "" }
    return category
        .components(separatedBy: " - ")
        .map { localization.localized($0) }
        .joined(separator: " - ")
}

private func dateSnippet(_ iso: String?) -> String {
    guard let iso, !iso.isEmpty else { return "Recent" }
    return String(iso.prefix(10))
}

private extension String {
    var humanized: String {
        replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}

// MARK: - Helper

struct HelperHome: View {
    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject var bids: BidsStore
    @EnvironmentObject var payments: PaymentsStore
    @EnvironmentObject var cal: CalendarStore
    @EnvironmentObject private var localization: LocalizationManager
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
    @State private var bidTargetJob: APIJob?   // job the helper is bidding on

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
                        // Tap the row body → job detail; tap the Bid button → bid sheet.
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
        .sheet(item: $bidTargetJob) { job in
            HelperBidSheet(job: job)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
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
                Text(localizedCategoryName(job.category, localization: localization)).font(.system(size: 10, weight: .semibold))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Theme.surfaceElevated, in: Capsule()).foregroundStyle(Theme.textSecondary)
                Spacer()
                // "Details" is a plain tap on the row; "Bid" opens the bid sheet directly.
                Button {
                    bidTargetJob = job
                } label: {
                    Text(localization.localized(L10n.CommonKey.bid)).font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 6).background(Theme.accent, in: Capsule())
                }
                .buttonStyle(.plain)
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
    @EnvironmentObject private var localization: LocalizationManager
    @State private var cashAppHandle = "$OxSteed"
    @State private var didLoadWorkspace = false
    @State private var showTeam = false
    @State private var showVortex = false
    @State private var showInvoices = false
    @State private var showServices = false
    @State private var showClients = false
    @State private var showExpenses = false
    @State private var showQuotes = false
    @State private var showTax = false
    @State private var showReviews = false

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
                        Divider()
                        if workspace.selectedBusiness != nil {
                            Button { showInvoices = true } label: { Label("Invoices", systemImage: "doc.plaintext.fill") }
                            Button { showQuotes = true } label: { Label("Quotes", systemImage: "doc.text.magnifyingglass") }
                            Button { showServices = true } label: { Label("Services", systemImage: "list.bullet.rectangle.fill") }
                            Button { showClients = true } label: { Label("Clients", systemImage: "person.2.crop.square.stack.fill") }
                            Button { showExpenses = true } label: { Label("Expenses", systemImage: "creditcard.fill") }
                            Button { showTax = true } label: { Label("Estimated tax", systemImage: "percent") }
                            Button { showReviews = true } label: { Label("Reviews", systemImage: "star.bubble.fill") }
                            Button { showTeam = true } label: {
                                Label("Manage team", systemImage: "person.2.fill")
                            }
                        }
                        Button { showVortex = true } label: {
                            Label("Join with a code", systemImage: "qrcode.viewfinder")
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "briefcase.fill")
                            Text(localization.localized(workspace.selectedBusiness?.role.capitalized ?? "Switch"))
                            Image(systemName: "chevron.down")
                        }
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 8)
                        .background(Theme.surfaceElevated, in: Capsule())
                    }
                    .sheet(isPresented: $showTeam) {
                        if let bizId = workspace.selectedBusiness?.business_id {
                            TeamManagementView(businessId: bizId)
                        }
                    }
                    .sheet(isPresented: $showVortex) {
                        VortexJoinView()
                    }
                    .sheet(isPresented: $showInvoices) {
                        if let bizId = workspace.selectedBusiness?.business_id { BusinessInvoicesView(businessId: bizId) }
                    }
                    .sheet(isPresented: $showServices) {
                        if let bizId = workspace.selectedBusiness?.business_id { BusinessServicesView(businessId: bizId) }
                    }
                    .sheet(isPresented: $showClients) {
                        if let bizId = workspace.selectedBusiness?.business_id { BusinessClientsView(businessId: bizId) }
                    }
                    .sheet(isPresented: $showExpenses) {
                        if let bizId = workspace.selectedBusiness?.business_id { BusinessExpensesView(businessId: bizId) }
                    }
                    .sheet(isPresented: $showQuotes) {
                        if let bizId = workspace.selectedBusiness?.business_id { BusinessQuotesView(businessId: bizId) }
                    }
                    .sheet(isPresented: $showTax) {
                        if let bizId = workspace.selectedBusiness?.business_id { BusinessTaxView(businessId: bizId) }
                    }
                    .sheet(isPresented: $showReviews) {
                        if let bizId = workspace.selectedBusiness?.business_id { BusinessReviewsView(businessId: bizId) }
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
                        Text(localization.localized(L10n.BusinessKey.cashappTitle))
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
    @EnvironmentObject private var localization: LocalizationManager

    // cents → "$X.XK" / "$X.XM"
    private func fmtCents(_ c: Int) -> String {
        let d = Double(c) / 100.0
        if d >= 1_000_000 { return localization.format("%@M", localization.formatNumber(d / 1_000_000, fractionDigits: 1)) }
        if d >= 1_000    { return localization.format("%@K", localization.formatNumber(d / 1_000, fractionDigits: 1)) }
        return localization.formatCurrency(d, fractionDigits: 0)
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
                                Text(localization.localized(item.event_type?.replacingOccurrences(of: "_", with: " ").capitalized ?? "Event"))
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
    @EnvironmentObject private var localization: LocalizationManager
    @State private var showAddTool = false
    @State private var deletingTool: APIToolRental?
    @State private var showDeleteConfirmation = false

    private var hasPickupRules: Bool {
        tools.myTools.contains { tool in
            let rules = tool.owner_rules?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return !rules.isEmpty || tool.pickup_only == true || tool.delivery_available == true
        }
    }

    /// Sum of configured deposit amounts across all tools that require a deposit.
    /// This reflects the deposit pool a renter would need to pay, not real-time
    /// escrow balances (those require a bookings query).
    private var configuredDepositDisplay: String {
        let toolsWithDeposit = tools.myTools.filter { $0.requires_deposit == true }
        guard !toolsWithDeposit.isEmpty else { return localization.formatCurrency(0, fractionDigits: 0) }
        let total = toolsWithDeposit.compactMap { $0.deposit_amount }.reduce(0, +)
        return total > 0 ? localization.formatCurrency(total, fractionDigits: 0) : localization.formatPlural("plural.tool", toolsWithDeposit.count)
    }

    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                StatTile(label: L10n.StatKey.toolsOut, value: "\(tools.myTools.count)", trend: tools.myTools.isEmpty ? localization.localized("Setup") : nil,
                         icon: "hammer.fill", color: Theme.pillarCar)
                StatTile(label: L10n.StatKey.depositsHeld, value: configuredDepositDisplay,
                         trend: tools.myTools.filter { $0.requires_deposit == true }.isEmpty ? nil : localization.localized("Configured"),
                         icon: "lock.fill", color: Theme.warning)
            }

            RecommendationFeedView()
                .task { await RecommendationsStore.shared.load() }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: localization.localized("Rental launch checklist"), actionLabel: nil)
                WorkspaceChecklistRow(title: localization.localized("Create tool catalog"), subtitle: localization.localized("Add condition, rates, deposits, and photos"), icon: "hammer.fill", color: Theme.pillarCar, isComplete: !tools.myTools.isEmpty)
                WorkspaceChecklistRow(title: localization.localized("Set pickup rules"), subtitle: localization.localized("Define handoff windows and return policy"), icon: "clock.badge.checkmark", color: Theme.pillarHome, isComplete: hasPickupRules)
                WorkspaceChecklistRow(title: localization.localized("Connect payouts"), subtitle: localization.localized("Prepare deposits and rental income"), icon: "creditcard.fill", color: Theme.success, isComplete: !payments.payments.isEmpty)
            }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: localization.localized("Your tool catalog"), actionLabel: localization.localized("Add")) {
                    showAddTool = true
                }

                if let error = tools.lastError {
                    Text(error)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                }

                if tools.myTools.isEmpty {
                    Button {
                        showAddTool = true
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundStyle(Theme.accent)
                                .frame(width: 42, height: 42)
                                .background(Theme.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(localization.localized("List your first rental tool"))
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text(localization.localized("Publish rates, deposits, and pickup rules to the backend."))
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textSecondary)
                                    .lineLimit(2)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Theme.textTertiary)
                        }
                        .cardStyle(padding: 12)
                    }
                    .buttonStyle(.plain)
                } else {
                    ForEach(tools.myTools.prefix(5)) { tool in
                        ToolRentalOwnerRow(
                            tool: tool,
                            onToggleAvailability: { isAvailable in
                                Task { await tools.setToolAvailable(tool, isAvailable: isAvailable) }
                            },
                            onDelete: {
                                deletingTool = tool
                                showDeleteConfirmation = true
                            }
                        )
                    }
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: localization.localized("Tool owner actions"), actionLabel: nil)
                HStack(spacing: 12) {
                    WorkspaceNavCard(icon: "graduationcap.fill",
                                     title: localization.localized("Rental basics"),
                                     subtitle: localization.localized("Learn setup"),
                                     color: Theme.pillarGoals) {
                        LearnTabView()
                    }
                    WorkspaceNavCard(icon: "creditcard.fill",
                                     title: localization.localized("Payouts"),
                                     subtitle: localization.format("$%d received", payments.payments.reduce(0) { $0 + $1.amount } / 100),
                                     color: Theme.success) {
                        PaymentsView()
                    }
                }
                WorkspaceInsightCard(icon: "tray.full.fill",
                                     title: localization.localized("Rental requests"),
                                     subtitle: localization.formatPlural("plural.inquiry_thread", messages.conversations.count),
                                     badge: localization.localized("Inbox"),
                                     color: Theme.pillarHome)
            }
        }
        .task {
            await payments.loadPayments()
            await messages.loadConversations()
            await tools.loadMyTools()
        }
        .sheet(isPresented: $showAddTool) {
            AddToolRentalSheet()
                .environmentObject(tools)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .confirmationDialog(localization.localized("Remove this tool listing?"), isPresented: $showDeleteConfirmation) {
            Button("home.delete_listing", role: .destructive) {
                if let deletingTool {
                    Task { await tools.deleteTool(deletingTool) }
                }
            }
            Button("common.cancel", role: .cancel) {}
        } message: {
            Text(deletingTool?.name ?? localization.localized("This listing will be removed from your rental catalog."))
        }
    }
}

private struct ToolRentalOwnerRow: View {
    @EnvironmentObject private var localization: LocalizationManager
    let tool: APIToolRental
    let onToggleAvailability: (Bool) -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "wrench.and.screwdriver.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.pillarCar)
                .frame(width: 42, height: 42)
                .background(Theme.pillarCar.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 3) {
                Text(tool.name ?? localization.localized("map.rental_tool"))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Text([tool.category, toolDailyRateText].compactMap { $0 }.joined(separator: " • "))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                Text(locationText)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 6) {
                Toggle("", isOn: Binding(
                    get: { tool.is_available ?? true },
                    set: { onToggleAvailability($0) }
                ))
                .labelsHidden()
                .tint(Theme.success)

                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 13, weight: .bold))
                }
                .buttonStyle(.plain)
            }
        }
        .cardStyle(padding: 12)
    }

    private var locationText: String {
        let city = tool.location_city?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let state = tool.location_state?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let joined = [city, state].filter { !$0.isEmpty }.joined(separator: ", ")
        return joined.isEmpty ? localization.localized("Location not set") : joined
    }

    private var toolDailyRateText: String? {
        guard let rate = tool.daily_rate else { return nil }
        return localization.format("map.rate_per_day", localization.formatCurrency(rate, fractionDigits: 0))
    }
}

private struct AddToolRentalSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var localization: LocalizationManager
    @EnvironmentObject private var tools: ToolRentalsStore

    @State private var name = ""
    @State private var category = ""
    @State private var dailyRate = ""
    @State private var depositAmount = ""
    @State private var city = ""
    @State private var state = ""
    @State private var condition = "good"
    @State private var rules = ""
    @State private var requiresDeposit = true
    @State private var pickupOnly = true
    @State private var deliveryAvailable = false
    @State private var attestationAccepted = false
    @State private var localError: String?

    private let conditions = ["new", "excellent", "good", "fair"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    field(localization.localized("Tool name"), text: $name)
                    field(localization.localized("Category"), text: $category)

                    HStack(spacing: 10) {
                        field(localization.localized("Daily rate"), text: $dailyRate, keyboard: .decimalPad)
                        if requiresDeposit {
                            field(localization.localized("Deposit"), text: $depositAmount, keyboard: .decimalPad)
                        }
                    }

                    HStack(spacing: 10) {
                        field(localization.localized("City"), text: $city)
                        field(localization.localized("State"), text: $state)
                    }

                    Picker(localization.localized("Condition"), selection: $condition) {
                        ForEach(conditions, id: \.self) { value in
                            Text(localizedCondition(value)).tag(value)
                        }
                    }
                    .pickerStyle(.segmented)

                    Toggle(localization.localized("Require deposit"), isOn: $requiresDeposit)
                        .tint(Theme.accent)
                    Toggle(localization.localized("Pickup only"), isOn: $pickupOnly)
                        .tint(Theme.accent)
                    Toggle(localization.localized("Delivery available"), isOn: $deliveryAvailable)
                        .tint(Theme.accent)

                    VStack(alignment: .leading, spacing: 6) {
                        Text(localization.localized("Pickup and return rules"))
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                        TextEditor(text: $rules)
                            .frame(minHeight: 92)
                            .padding(10)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                    }

                    Toggle(isOn: $attestationAccepted) {
                        Text(localization.localized("I confirm this tool is safe, legal to rent, and accurately described."))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                    }
                    .tint(Theme.success)

                    if let message = localError ?? tools.lastError {
                        Text(message)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.danger)
                    }
                }
                .padding(20)
            }
            .navigationTitle(Text("List a Tool"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("common.save") { Task { await save() } }
                        .disabled(!canSave || tools.isLoading)
                }
            }
        }
    }

    private var canSave: Bool {
        !name.trimmed.isEmpty &&
        !category.trimmed.isEmpty &&
        Double(dailyRate) != nil &&
        !city.trimmed.isEmpty &&
        attestationAccepted &&
        (!requiresDeposit || Double(depositAmount) != nil)
    }

    private func localizedCondition(_ value: String) -> String {
        switch value {
        case "new": return localization.localized("New")
        case "excellent": return localization.localized("Excellent")
        case "good": return localization.localized("Good")
        case "fair": return localization.localized("Fair")
        default: return localization.localized(value.capitalized)
        }
    }

    private func save() async {
        localError = nil
        guard canSave else {
            localError = localization.localized("Add a name, category, daily rate, city, and owner acknowledgement.")
            return
        }

        let request = ToolRentalsService.ToolRentalSaveRequest(
            name: name.trimmed,
            category: category.trimmed,
            description: nil,
            daily_rate: Double(dailyRate),
            hourly_rate: nil,
            deposit_amount: requiresDeposit ? Double(depositAmount) : nil,
            condition: condition,
            brand: nil,
            model: nil,
            is_available: true,
            requires_deposit: requiresDeposit,
            delivery_available: deliveryAvailable,
            pickup_only: pickupOnly,
            location_city: city.trimmed,
            location_state: state.trimmed.nilIfEmpty,
            owner_rules: rules.trimmed.nilIfEmpty,
            replacement_value: nil,
            owner_attestation_accepted: attestationAccepted
        )

        if await tools.createTool(request) {
            dismiss()
        }
    }

    private func field(_ title: String, text: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            TextField(title, text: text)
                .keyboardType(keyboard)
                .textInputAutocapitalization(.words)
                .padding(12)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
        }
    }
}

private extension String {
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var nilIfEmpty: String? {
        isEmpty ? nil : self
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
        if d >= 1_000 { return localization.format("%@K", localization.formatNumber(d / 1_000, fractionDigits: 1)) }
        return localization.formatCurrency(d, fractionDigits: 0)
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
                    if let nextStep = franchiseNextStep(for: app.status) {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "arrow.right.circle.fill")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.accent)
                                .padding(.top, 1)
                            Text(nextStep)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(10)
                        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
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

    private func franchiseNextStep(for status: String?) -> String? {
        switch status?.lowercased() {
        case "inquiry":
            return "We're reviewing your territory and initial fit. You'll hear from us within 3–5 business days."
        case "screening":
            return "Watch your email for a short questionnaire about your background and capital readiness. Reply promptly to keep your application moving."
        case "application_review":
            return "Your full application is with our review team. This typically takes 1–2 weeks. Check your email for any clarification requests."
        case "diligence":
            return "Diligence is active. You may receive document or reference requests — respond within 48 hours to avoid delays."
        case "agreement_pending":
            return "Agreement documents are ready or awaiting your signature. Check your email for a DocuSign link. Contact your coordinator if you haven't received it."
        case "approved":
            return "You're approved! Your coordinator will send training materials and a launch checklist within 5 business days."
        case "launched":
            return "Your franchise is live. Use the Territory Operations area to manage helpers and track activity."
        case "rejected":
            return "This application did not advance. Contact support@oxsteed.com if you have questions or believe there has been an error."
        default:
            return nil
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
    @EnvironmentObject private var localization: LocalizationManager

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
        if d >= 1_000_000 { return localization.format("%@M", localization.formatNumber(d / 1_000_000, fractionDigits: 1)) }
        if d >= 1_000     { return localization.format("%@K", localization.formatNumber(d / 1_000, fractionDigits: 1)) }
        return localization.formatCurrency(d, fractionDigits: 0)
    }
    private func fmt(_ n: Int?) -> String { n.map { "\($0)" } ?? "—" }
    private func pct(_ n: Int?)  -> String { n.map { "\($0)%" } ?? "—" }

    var body: some View {
        VStack(spacing: 18) {

            // ── Investor context banner ──────────────────────────
            HStack(spacing: 12) {
                Image(systemName: "chart.line.uptrend.xyaxis.circle.fill")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Theme.pillarMoney)
                    .frame(width: 44, height: 44)
                    .background(Theme.pillarMoney.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Platform Performance View")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text("Live KPIs for your OxSteed equity relationship. For investor relations queries contact investor@oxsteed.com.")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .cardStyle(padding: 14)

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
                            Text(localization.localized(stage.status.capitalized))
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
    @State private var actionError: String?

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
                                Text("home.new_product")
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
                                Text("common.refresh")
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
                    if let actionError {
                        Text(actionError)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
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
                                Button(product.isActive == true ? "home.pause" : "home.activate") {
                                    Task {
                                        actionError = nil
                                        let ok = await workspace.setProductActive(
                                            productId: product.id,
                                            isActive: !(product.isActive == true)
                                        )
                                        if !ok {
                                            actionError = workspace.lastError ?? "Product status could not be updated."
                                        }
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
    @EnvironmentObject private var localization: LocalizationManager
    @State private var showAddLead = false
    @State private var actionError: String?
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
                                Text("home.new_lead")
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
                    if let actionError {
                        Text(actionError)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
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
                                        Button(localization.localized(status.capitalized)) {
                                            Task {
                                                actionError = nil
                                                let ok = await workspace.updateLeadStatus(leadId: lead.id, status: status)
                                                if !ok {
                                                    actionError = workspace.lastError ?? "Lead status could not be updated."
                                                }
                                            }
                                        }
                                    }
                                } label: {
                                    Text(localization.localized((lead.status ?? "new").capitalized))
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
    @EnvironmentObject private var localization: LocalizationManager

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
                                Text(localization.localized((alert.severity ?? "info").capitalized))
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
    @State private var saveError: String?

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

                    if let saveError {
                        Text(saveError)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
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
                    Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func save() async {
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        let ok = await workspace.createLead(
            name: name,
            email: email.isEmpty ? nil : email,
            phone: phone.isEmpty ? nil : phone,
            serviceInterest: serviceInterest.isEmpty ? nil : serviceInterest,
            budgetCents: Int(budget).map { $0 * 100 },
            notes: notes.isEmpty ? nil : notes
        )
        if ok {
            dismiss()
        } else {
            saveError = workspace.lastError ?? "Lead could not be created."
        }
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
    @State private var saveError: String?

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

                    if let saveError {
                        Text(saveError)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            if isSaving { ProgressView().tint(.white) }
                            Text("home.create_product")
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
                    Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
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
        saveError = nil
        defer { isSaving = false }
        let ok = await workspace.createProduct(
            name: name,
            description: description.isEmpty ? nil : description,
            category: category,
            price: parsedPrice,
            cost: Double(cost),
            sku: sku
        )
        if ok {
            dismiss()
        } else {
            saveError = workspace.lastError ?? "Product could not be created."
        }
    }
}

// MARK: - HelperBidSheet

/// Native bid submission sheet — shown when a helper taps "Bid" on an available job.
/// Lets the helper enter their amount, message, and estimated hours, then submits
/// via BidsStore.place() to POST /api/bids.
struct HelperBidSheet: View {
    let job: APIJob
    @EnvironmentObject var bids: BidsStore
    @Environment(\.dismiss) private var dismiss

    @State private var amountText = ""
    @State private var message = ""
    @State private var hoursText = ""
    @State private var submitted = false

    private var amountCents: Int? {
        guard let d = Double(amountText.trimmingCharacters(in: .whitespacesAndNewlines)), d > 0 else { return nil }
        return Int(d * 100)
    }
    private var hours: Double? { Double(hoursText.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var canSubmit: Bool { amountCents != nil && !bids.isLoading }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {

                    // ── Job summary ──────────────────────────────────
                    VStack(alignment: .leading, spacing: 8) {
                        Text(job.title)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                        HStack(spacing: 12) {
                            if let category = job.category {
                                Label(category, systemImage: "tag.fill")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Label(job.budgetDisplay, systemImage: "dollarsign.circle.fill")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Theme.success)
                            if let d = job.distance_miles {
                                Label(String(format: "%.1f mi", d), systemImage: "location.fill")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        if let desc = job.description, !desc.isEmpty {
                            Text(desc)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(4)
                        }
                    }
                    .cardStyle()

                    // ── Bid form ─────────────────────────────────────
                    if submitted {
                        VStack(spacing: 14) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 44, weight: .bold))
                                .foregroundStyle(Theme.success)
                            Text("Bid submitted!")
                                .font(.system(size: 20, weight: .heavy))
                                .foregroundStyle(Theme.textPrimary)
                            Text("The customer will be notified and can accept or message you from their job detail.")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                                .multilineTextAlignment(.center)
                            Button("Done") { dismiss() }
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                        }
                        .cardStyle()
                    } else {
                        VStack(spacing: 14) {
                            OxTextField(title: "Your bid amount ($)", text: $amountText, keyboard: .decimalPad)

                            OxTextField(title: "Estimated hours (optional)", text: $hoursText, keyboard: .decimalPad)

                            VStack(alignment: .leading, spacing: 6) {
                                Text("Message to customer (optional)")
                                    .font(.system(size: 11, weight: .semibold))
                                    .tracking(0.8)
                                    .foregroundStyle(Theme.textTertiary)
                                    .textCase(.uppercase)
                                TextEditor(text: $message)
                                    .scrollContentBackground(.hidden)
                                    .frame(height: 100)
                                    .padding(8)
                                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                                    .foregroundStyle(Theme.textPrimary)
                                    .font(.system(size: 15))
                            }

                            if let err = bids.lastError {
                                Text(err)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.danger)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }

                            Button {
                                Task { await submitBid() }
                            } label: {
                                HStack {
                                    if bids.isLoading { ProgressView().tint(.white) }
                                    Text("Submit Bid")
                                        .font(.system(size: 15, weight: .bold))
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(canSubmit ? Theme.accent : Theme.textTertiary,
                                            in: RoundedRectangle(cornerRadius: 14))
                                .foregroundStyle(.white)
                            }
                            .disabled(!canSubmit)
                        }
                        .cardStyle()
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Place a Bid")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private func submitBid() async {
        guard let cents = amountCents else { return }
        let ok = await bids.place(
            jobId: job.id,
            amountCents: cents,
            message: message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : message,
            hours: hours
        )
        if ok { submitted = true }
    }
}
