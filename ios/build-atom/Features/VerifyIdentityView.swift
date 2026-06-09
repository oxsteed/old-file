import SwiftUI
import SafariServices

// MARK: - DiDit Identity Verification

/// Presents the user's current identity-verification status and lets them
/// start (or resume) the DiDit verification flow from inside the app.
///
/// Entry points:
///   • Settings sheet → "Verify Identity" row
///   • Helper profile completion checklist
///   • Any screen that detects didit_status != "approved"
struct VerifyIdentityView: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss

    @State private var isLaunching   = false
    @State private var launchError: String?
    @State private var safariURL: URL?
    @State private var pollTimer: Timer?

    private var status: DiDitStatus {
        DiDitStatus(raw: auth.user?.didit_status)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // ── Status hero ──────────────────────────────────────────
                    statusHero

                    // ── Why verify card ──────────────────────────────────────
                    benefitsCard

                    // ── Steps ────────────────────────────────────────────────
                    if status != .approved {
                        stepsCard
                    }

                    // ── CTA ──────────────────────────────────────────────────
                    ctaButton

                    if let launchError {
                        Text(launchError)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.danger)
                            .multilineTextAlignment(.center)
                    }

                    Spacer(minLength: 40)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("verify_identity.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.close") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
        .sheet(item: $safariURL) { url in
            SafariView(url: url)
                .ignoresSafeArea()
                .onDisappear {
                    // Resume polling when the user returns from the web flow.
                    startPolling()
                }
        }
        .onDisappear { stopPolling() }
    }

    // MARK: - Sub-views

    private var statusHero: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(status.color.opacity(0.14))
                    .frame(width: 80, height: 80)
                Image(systemName: status.icon)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(status.color)
            }
            Text(status.headline)
                .font(.system(size: 22, weight: .heavy, design: .rounded))
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
            Text(status.subheadline)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 8)
    }

    private var benefitsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("verify_identity.benefits.title", systemImage: "checkmark.shield.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            ForEach(benefits, id: \.self) { benefit in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.success)
                        .padding(.top, 1)
                    Text(LocalizedStringKey(benefit))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .cardStyle()
    }

    private var stepsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("verify_identity.steps.title")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            ForEach(Array(steps.enumerated()), id: \.offset) { idx, step in
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        Circle().fill(Theme.accent.opacity(0.12))
                            .frame(width: 26, height: 26)
                        Text("\(idx + 1)")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.accent)
                    }
                    Text(LocalizedStringKey(step))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .cardStyle()
    }

    @ViewBuilder
    private var ctaButton: some View {
        switch status {
        case .approved:
            HStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.success)
                Text("verify_identity.cta.verified")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.success)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Theme.success.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))

        case .pending:
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    ProgressView().tint(Theme.warning)
                    Text("verify_identity.cta.pending")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.warning)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Theme.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))

                Text("verify_identity.cta.pending_note")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary)
                    .multilineTextAlignment(.center)
            }

        case .rejected:
            Button { Task { await launch() } } label: {
                HStack(spacing: 8) {
                    if isLaunching { ProgressView().tint(.white).scaleEffect(0.85) }
                    else { Image(systemName: "arrow.counterclockwise").font(.system(size: 14, weight: .bold)) }
                    Text("verify_identity.cta.try_again")
                        .font(.system(size: 15, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Theme.danger, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .disabled(isLaunching)

        default: // .notStarted
            Button { Task { await launch() } } label: {
                HStack(spacing: 8) {
                    if isLaunching { ProgressView().tint(.white).scaleEffect(0.85) }
                    else { Image(systemName: "person.badge.shield.checkmark.fill").font(.system(size: 14, weight: .bold)) }
                    Text("verify_identity.cta.start")
                        .font(.system(size: 15, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .disabled(isLaunching)
        }
    }

    // MARK: - Logic

    private func launch() async {
        isLaunching = true
        launchError = nil
        defer { isLaunching = false }
        do {
            let url = try await DiDitService.startVerification()
            safariURL = url
        } catch {
            launchError = (error as? APIError)?.errorDescription ?? localization.localized("verify_identity.error.start_failed")
        }
    }

    /// Poll /auth/me every 5 s after the user returns from the SafariView.
    private func startPolling() {
        stopPolling()
        guard status == .notStarted || status == .pending else { return }
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
            Task { @MainActor in
                await auth.refreshMe()
                if auth.user?.didit_status == "approved" { stopPolling() }
            }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    // MARK: - Static content

    private let benefits = [
        "verify_identity.benefit.badge",
        "verify_identity.benefit.categories",
        "verify_identity.benefit.required",
        "verify_identity.benefit.escrow",
    ]

    private let steps = [
        "verify_identity.step.start",
        "verify_identity.step.id",
        "verify_identity.step.selfie",
        "verify_identity.step.return",
    ]
}

// MARK: - DiDit Status

enum DiDitStatus: Equatable {
    case notStarted, pending, approved, rejected

    init(raw: String?) {
        switch raw?.lowercased() {
        case "pending", "in_progress": self = .pending
        case "approved", "verified":   self = .approved
        case "rejected", "failed":     self = .rejected
        default:                       self = .notStarted
        }
    }

    var headline: LocalizedStringKey {
        switch self {
        case .notStarted: return "didit.headline.not_started"
        case .pending:    return "didit.headline.pending"
        case .approved:   return "didit.headline.approved"
        case .rejected:   return "didit.headline.rejected"
        }
    }

    var subheadline: LocalizedStringKey {
        switch self {
        case .notStarted: return "didit.subheadline.not_started"
        case .pending:    return "didit.subheadline.pending"
        case .approved:   return "didit.subheadline.approved"
        case .rejected:   return "didit.subheadline.rejected"
        }
    }

    var icon: String {
        switch self {
        case .notStarted: return "person.badge.shield.checkmark"
        case .pending:    return "hourglass"
        case .approved:   return "checkmark.seal.fill"
        case .rejected:   return "xmark.seal.fill"
        }
    }

    var color: Color {
        switch self {
        case .notStarted: return Theme.textTertiary
        case .pending:    return Theme.warning
        case .approved:   return Theme.success
        case .rejected:   return Theme.danger
        }
    }
}

// MARK: - DiDit Service

enum DiDitService {
    private struct StartResp: Decodable {
        let verification_url: String
        let session_id: String?
    }

    /// Returns the URL to open in SafariView to start/resume the DiDit flow.
    static func startVerification() async throws -> URL {
        let resp: StartResp = try await APIClient.shared.request(
            "/api/didit/start",
            method: .POST,
            body: EmptyBody()
        )
        guard let url = URL(string: resp.verification_url) else {
            throw APIError.server(code: 0, message: "Invalid verification URL from server.")
        }
        return url
    }

    private struct EmptyBody: Encodable {}
}

// MARK: - AuthStore extension (refresh /auth/me)

extension AuthStore {
    /// Lightweight re-fetch of the current user record without full bootstrap.
    func refreshMe() async {
        guard isAuthenticated else { return }
        if let updated = try? await AuthService.me() {
            self.user = updated
        }
    }
}

// MARK: - SafariView wrapper

private struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

// MARK: - URL: Identifiable

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
