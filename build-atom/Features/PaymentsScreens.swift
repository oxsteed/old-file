import SwiftUI

// MARK: - Payments

struct PaymentsView: View {
    @EnvironmentObject var payments: PaymentsStore
    @EnvironmentObject private var localization: LocalizationManager
    @State private var isStartingConnect  = false
    @State private var connectError: String?
    @State private var browserURL: BrowserURL?
    @State private var filterStatus: String? = nil  // nil = all

    private var filteredPayments: [APIPayment] {
        guard let f = filterStatus else { return payments.payments }
        return payments.payments.filter { $0.status == f }
    }

    private var totalEarned: Int {
        payments.payments
            .filter { $0.status == "completed" || $0.status == "paid" }
            .reduce(0) { $0 + $1.amount }
    }

    private var pendingAmount: Int {
        payments.payments
            .filter { $0.status == "pending" || $0.status == "processing" }
            .reduce(0) { $0 + $1.amount }
    }

    /// Escrow isn't explicitly modeled in `APIPayment` yet; treat pending funds as "in escrow".
    private var escrowAmount: Int { pendingAmount }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {

                    // ── Balance summary ───────────────────────────────────────
                    HStack(spacing: 12) {
                        walletTile("Total Earned",
                                   value: dollars(totalEarned),
                                   icon: "dollarsign.circle.fill",
                                   color: Theme.success)
                        walletTile("Pending",
                                   value: dollars(pendingAmount),
                                   icon: "clock.fill",
                                   color: Theme.warning)
                    }

                    if escrowAmount > 0 {
                        HStack(spacing: 10) {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.pillarMoney)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("In Escrow")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text("Released when the job is marked complete.")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            Text(dollars(escrowAmount))
                                .font(.system(size: 16, weight: .heavy))
                                .foregroundStyle(Theme.pillarMoney)
                        }
                        .cardStyle(padding: 14)
                    }

                    // ── Payout account ────────────────────────────────────────
                    payoutAccountCard

                    // ── Filter chips ──────────────────────────────────────────
                    if !payments.payments.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                filterChip("All",        key: nil)
                                filterChip("Completed",  key: "completed")
                                filterChip("Pending",    key: "pending")
                                filterChip("Paid",       key: "paid")
                                filterChip("Refunded",   key: "refunded")
                            }
                            .padding(.horizontal, 20)
                        }
                        .padding(.horizontal, -20)
                    }

                    // ── Transaction list ──────────────────────────────────────
                    Text("Transaction History").sectionTitle()

                    if filteredPayments.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "tray")
                                .font(.system(size: 28))
                                .foregroundStyle(Theme.textTertiary)
                            Text("No transactions yet")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 30)
                    } else {
                        VStack(spacing: 8) {
                            ForEach(filteredPayments) { p in
                                transactionRow(p)
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .task {
            await payments.loadConnectStatus()
            await payments.loadPayments()
        }
        .sheet(item: $browserURL) { item in
            SafariBrowserView(url: item.url)
                .ignoresSafeArea()
        }
    }

    // ── Payout account card ────────────────────────────────────────────────
    @ViewBuilder
    private var payoutAccountCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Payout Account", systemImage: "creditcard.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                if let s = payments.connectStatus, s.charges_enabled == true {
                    Text("Active")
                        .font(.system(size: 11, weight: .bold))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Theme.success.opacity(0.15), in: Capsule())
                        .foregroundStyle(Theme.success)
                }
            }

            if let connectError {
                Label(connectError, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.danger)
                    .padding(.top, 2)
            }

            if let s = payments.connectStatus {
                if s.charges_enabled == true {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Stripe Connect linked")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            if let acct = s.stripe_account_id {
                                Text(acct).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                            }
                        }
                        Spacer()
                        manageWalletButton
                    }
                } else {
                    actionButton("payments.complete_setup", icon: "arrow.right.circle.fill") {
                        Task { await startConnect() }
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Set up payouts to receive earnings.")
                        .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    actionButton("payments.start_setup", icon: "plus.circle.fill") {
                        Task { await startConnect() }
                    }
                }
            }
        }
        .cardStyle()
    }

    // ── Transaction row ────────────────────────────────────────────────────
    private func transactionRow(_ p: APIPayment) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(statusColor(p.status).opacity(0.12))
                Image(systemName: statusIcon(p.status))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(statusColor(p.status))
            }
            .frame(width: 38, height: 38)

            VStack(alignment: .leading, spacing: 3) {
                Text(p.description ?? "Payment")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(localization.localized((p.status ?? "—").capitalized))
                        .font(.system(size: 11))
                        .foregroundStyle(statusColor(p.status))
                    Text("·")
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.textTertiary)
                    Text(p.created_at?.prefix(10).description ?? "")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textTertiary)
                }
            }

            Spacer()

            Text(dollars(p.amount))
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    private func walletTile(_ label: String, value: String, icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 12)).foregroundStyle(color)
                Text(localization.localized(label)).font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            Text(value).font(.system(size: 20, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle(padding: 14)
    }

    private func filterChip(_ label: String, key: String?) -> some View {
        Button { withAnimation { filterStatus = key } } label: {
            Text(localization.localized(label))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(filterStatus == key ? .white : Theme.textSecondary)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background(
                    filterStatus == key ? Theme.accent : Theme.cardBackground,
                    in: Capsule()
                )
        }
        .buttonStyle(.plain)
    }

    private func actionButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if isStartingConnect { ProgressView().tint(.white).scaleEffect(0.8) }
                else { Image(systemName: icon).font(.system(size: 12)) }
                Text(LocalizedStringKey(title)).font(.system(size: 13, weight: .bold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(Theme.accent, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isStartingConnect)
    }

    private func statusColor(_ status: String?) -> Color {
        switch status {
        case "completed", "paid": return Theme.success
        case "pending", "processing": return Theme.warning
        case "refunded": return Theme.pillarHome
        case "failed": return Theme.danger
        default: return Theme.textTertiary
        }
    }

    private func statusIcon(_ status: String?) -> String {
        switch status {
        case "completed", "paid": return "checkmark.circle.fill"
        case "pending":           return "clock.fill"
        case "processing":        return "arrow.trianglehead.clockwise"
        case "refunded":          return "arrow.uturn.left.circle.fill"
        case "failed":            return "xmark.circle.fill"
        default:                  return "circle.fill"
        }
    }

    private func dollars(_ cents: Int) -> String {
        localization.formatCents(cents)
    }

    private func startConnect() async {
        guard !isStartingConnect else { return }
        isStartingConnect = true
        connectError = nil
        defer { isStartingConnect = false }
        do {
            let resp = try await PaymentsService.startConnect(country: "US", type: "individual")
            guard let urlStr = resp["onboarding_url"]?.value as? String, let url = URL(string: urlStr) else {
                connectError = "Stripe setup did not return an onboarding link. Please try again."
                await payments.loadConnectStatus()
                return
            }
            browserURL = BrowserURL(url: url)
        } catch {
            connectError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        await payments.loadConnectStatus()
    }
}

// MARK: - Wallet Management View

/// Full-screen payout account manager.
/// Launched from the "Manage Wallet" button inside PaymentsView.
/// Shows: connect status, payout method details, instant payout CTA,
/// Stripe dashboard deep-link, and a disconnect option.
struct WalletManagementView: View {
    @EnvironmentObject var payments: PaymentsStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss

    @State private var isStartingConnect   = false
    @State private var isRequestingPayout  = false
    @State private var payoutError: String?
    @State private var connectError: String?
    @State private var payoutSuccess       = false
    @State private var showDisconnectAlert = false
    @State private var browserURL: BrowserURL?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    statusHeader
                    payoutMethodCard
                    actionsCard
                    if let payoutError {
                        Text(payoutError)
                            .font(.system(size: 12)).foregroundStyle(Theme.danger)
                            .multilineTextAlignment(.center).padding(.horizontal)
                    }
                    if let connectError {
                        Text(connectError)
                            .font(.system(size: 12)).foregroundStyle(Theme.danger)
                            .multilineTextAlignment(.center).padding(.horizontal)
                    }
                    if payoutSuccess {
                        Label("Payout initiated! Funds typically arrive in 1–2 business days.", systemImage: "checkmark.circle.fill")
                            .font(.system(size: 13)).foregroundStyle(Theme.success)
                            .multilineTextAlignment(.center).padding(.horizontal)
                    }
                    helpCard
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Manage Wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
        .task {
            await payments.loadConnectStatus()
        }
        .alert("Disconnect Payout Account?", isPresented: $showDisconnectAlert) {
            Button("common.cancel", role: .cancel) {}
            Button("payments.disconnect", role: .destructive) { Task { await disconnectAccount() } }
        } message: {
            Text("You won't be able to receive payouts until you reconnect a Stripe account.")
        }
        .sheet(item: $browserURL) { item in
            SafariBrowserView(url: item.url)
                .ignoresSafeArea()
        }
    }

    // MARK: - Sub-views

    @ViewBuilder
    private var statusHeader: some View {
        let connected = payments.connectStatus?.charges_enabled == true
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill((connected ? Theme.success : Theme.warning).opacity(0.14))
                    .frame(width: 72, height: 72)
                Image(systemName: connected ? "creditcard.fill" : "creditcard.trianglebadge.exclamationmark")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(connected ? Theme.success : Theme.warning)
            }
            Text(connected ? "Payout Account Active" : "Payout Account Needed")
                .font(.system(size: 18, weight: .heavy, design: .rounded))
                .foregroundStyle(Theme.textPrimary)
            Text(connected
                 ? "Earnings are automatically sent to your linked bank account."
                 : "Complete Stripe setup to receive payments for your work.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private var payoutMethodCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Payout Method", systemImage: "building.columns.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textSecondary)

            if let s = payments.connectStatus {
                if s.charges_enabled == true {
                    // Connected state
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                            Text("Stripe Connect linked")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                        }
                        if let acct = s.stripe_account_id {
                            Text(localization.format("Account: %@", acct))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(Theme.textTertiary)
                        }
                        HStack(spacing: 16) {
                            statusPill("Charges", enabled: s.charges_enabled == true)
                            statusPill("Payouts", enabled: s.payouts_enabled == true)
                        }
                    }
                } else {
                    // Incomplete setup
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 10) {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning)
                            Text("Setup incomplete — tap below to finish.")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        primaryButton("payments.complete_setup", icon: "arrow.right.circle.fill", color: Theme.accent) {
                            Task { await startConnect() }
                        }
                        .disabled(isStartingConnect)
                    }
                }
            } else {
                // Not yet connected
                VStack(alignment: .leading, spacing: 10) {
                    Text("No payout account connected. It only takes a few minutes to set up.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                    primaryButton("payments.connect_account", icon: "plus.circle.fill", color: Theme.accent) {
                        Task { await startConnect() }
                    }
                    .disabled(isStartingConnect)
                }
            }
        }
        .cardStyle()
    }

    @ViewBuilder
    private var actionsCard: some View {
        if payments.connectStatus?.charges_enabled == true {
            VStack(alignment: .leading, spacing: 12) {
                Label("Actions", systemImage: "bolt.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)

                // Instant payout
                primaryButton(
                    isRequestingPayout ? "payments.requesting" : "payments.request_instant_payout",
                    icon: "arrow.down.circle.fill",
                    color: Theme.success
                ) {
                    Task { await requestPayout() }
                }
                .disabled(isRequestingPayout)

                // Manage in Stripe dashboard
                Button {
                    if let url = URL(string: "https://dashboard.stripe.com/express") {
                        browserURL = BrowserURL(url: url)
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.system(size: 13, weight: .semibold))
                        Text("payments.manage_stripe_dashboard")
                            .font(.system(size: 14, weight: .semibold))
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .foregroundStyle(Theme.accent)
                    .padding(.vertical, 12)
                    .padding(.horizontal, 14)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)

                // Disconnect
                Button { showDisconnectAlert = true } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "xmark.circle")
                            .font(.system(size: 13, weight: .semibold))
                        Text("payments.disconnect_payout_account")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.danger.opacity(0.2), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .cardStyle()
        }
    }

    private var helpCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("How payouts work", systemImage: "info.circle")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            Text("Earnings are held in escrow until a job is marked complete. After release, funds are sent to your Stripe account and arrive in 1–2 business days. Instant payouts (if eligible) arrive within 30 minutes.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textTertiary)
        }
        .cardStyle()
    }

    // MARK: - Helpers

    private func statusPill(_ label: String, enabled: Bool) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(enabled ? Theme.success : Theme.textTertiary)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(enabled ? Theme.success : Theme.textTertiary)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background((enabled ? Theme.success : Theme.textTertiary).opacity(0.10), in: Capsule())
    }

    private func primaryButton(_ title: String, icon: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold))
                Text(LocalizedStringKey(title)).font(.system(size: 14, weight: .bold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(color, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func startConnect() async {
        guard !isStartingConnect else { return }
        isStartingConnect = true
        connectError = nil
        payoutError = nil
        defer { isStartingConnect = false }
        do {
            let resp = try await PaymentsService.startConnect(country: "US", type: "individual")
            guard let urlStr = resp["onboarding_url"]?.value as? String, let url = URL(string: urlStr) else {
                connectError = "Stripe setup did not return an onboarding link. Please try again."
                await payments.loadConnectStatus()
                return
            }
            browserURL = BrowserURL(url: url)
        } catch {
            connectError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        await payments.loadConnectStatus()
    }

    private func requestPayout() async {
        isRequestingPayout = true
        payoutError = nil
        payoutSuccess = false
        defer { isRequestingPayout = false }
        do {
            try await PaymentsService.requestInstantPayout()
            payoutSuccess = true
        } catch {
            payoutError = (error as? APIError)?.errorDescription ?? "Payout request failed. Please try again."
        }
    }

    private func disconnectAccount() async {
        connectError = nil
        payoutError = nil
        do {
            try await PaymentsService.disconnectConnect()
        } catch {
            connectError = (error as? APIError)?.errorDescription ?? "Could not disconnect the payout account."
        }
        await payments.loadConnectStatus()
    }
}

// MARK: - PaymentsService extensions (instant payout + disconnect)

extension PaymentsService {
    static func requestInstantPayout() async throws {
        struct Req: Encodable { let type: String }
        struct Resp: Decodable { let status: String?; let message: String? }
        let _: Resp = try await APIClient.shared.request(
            "/api/payments/payout/instant",
            method: .POST,
            body: Req(type: "instant")
        )
    }

    static func disconnectConnect() async throws {
        struct Resp: Decodable { let success: Bool? }
        let _: Resp = try await APIClient.shared.request(
            "/api/payments/connect/disconnect",
            method: .POST,
            body: EmptyEncodable()
        )
    }

    private struct EmptyEncodable: Encodable {}
}

// MARK: - PaymentsView "Manage Wallet" button

extension PaymentsView {
    /// Call this from payoutAccountCard when the account is active to surface WalletManagementView.
    var manageWalletButton: some View {
        NavigationLink {
            WalletManagementView()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "gearshape.fill").font(.system(size: 12))
                Text("Manage Wallet").font(.system(size: 13, weight: .bold))
            }
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(Theme.accentSoft, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}
