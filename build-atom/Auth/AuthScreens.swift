import SwiftUI
import LocalAuthentication
import CoreLocation

// MARK: - Force-update model

private struct AppVersionInfo: Decodable {
    let min_version: String
    let latest_version: String
    let update_url: String
    let message: String
}

// MARK: - RootGate

/// Top-level branch:
/// - Guest users: show the stable 4-tab shell immediately.
/// - Signed-in users: optionally require biometric unlock, then onboarding, then shell.
struct RootGate: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var personaStore: PersonaStore
    @AppStorage("ox.security.require_biometrics") private var requireBiometrics = false
    @AppStorage("ox.onboarding.completed") private var onboardingCompleted = false
    @State private var bootstrapped = false
    @State private var isUnlocked = false
    @AppStorage("ox.accountRestored.shown") private var accountRestoredShown = false
    @State private var showAccountRestored = false

    // Force-update state
    @State private var mustUpdate = false
    @State private var updateURL  = URL(string: "https://apps.apple.com")!
    @State private var updateMsg  = "A required update is available. Please update OxSteed to continue."

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if !bootstrapped {
                ProgressView().tint(Theme.accent)
            } else if mustUpdate {
                ForceUpdateView(message: updateMsg, updateURL: updateURL)
            } else if auth.user != nil {
                if requireBiometrics && !isUnlocked {
                    AppLockView(onUnlocked: { isUnlocked = true })
                } else if !onboardingCompleted {
                    OnboardingFlowView(
                        onComplete: { onboardingCompleted = true },
                        onSetPersona: { persona in
                            personaStore.active = persona
                            Task { await auth.switchPersona(persona) }
                        }
                    )
                } else {
                    RootShellView()
                        .sheet(isPresented: $showAccountRestored) {
                            AccountRestoredView { showAccountRestored = false }
                                .presentationDetents([.medium])
                                .presentationDragIndicator(.visible)
                                .presentationBackground(Theme.background)
                        }
                }
            } else {
                // Guest mode: allow browsing/searching/learning without an account.
                RootShellView()
            }
        }
        .task {
            if !bootstrapped {
                await checkForceUpdate()
                await auth.bootstrap()
                bootstrapped = true
                // Show account-restored banner once when a returning user signs back in
                // on a fresh install (onboardingCompleted is true but banner not yet seen).
                if auth.user != nil && onboardingCompleted && !accountRestoredShown {
                    showAccountRestored = true
                    accountRestoredShown = true
                }
            }
        }
        .onChange(of: auth.user?.id) { _, newValue in
            if newValue == nil {
                isUnlocked = false
                onboardingCompleted = false
                accountRestoredShown = false   // reset so it shows next sign-in on fresh install
            } else if !requireBiometrics {
                isUnlocked = true
            } else {
                isUnlocked = false
            }
        }
        .onChange(of: requireBiometrics) { _, enabled in
            isUnlocked = enabled ? false : true
        }
    }

    // ── Version check ──────────────────────────────────────────────────────
    private func checkForceUpdate() async {
        guard let url = URL(string: "\(APIConfig.baseURL)/api/app-version/ios") else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let info = try JSONDecoder().decode(AppVersionInfo.self, from: data)
            let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
            if versionCompare(current, isLessThan: info.min_version) {
                updateMsg  = info.message
                updateURL  = URL(string: info.update_url) ?? updateURL
                mustUpdate = true
            }
        } catch {
            // Network failure → never block app launch
        }
    }

    /// Returns true if `a` is semantically less than `b` (e.g. "1.0.0" < "1.1.0").
    private func versionCompare(_ a: String, isLessThan b: String) -> Bool {
        a.compare(b, options: .numeric) == .orderedAscending
    }
}

// MARK: - ForceUpdateView

private struct ForceUpdateView: View {
    let message: String
    let updateURL: URL

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle().fill(Theme.accentSoft)
                Image(systemName: "arrow.down.circle.fill")
                    .font(.system(size: 32, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }
            .frame(width: 88, height: 88)

            VStack(spacing: 8) {
                Text("Update Required")
                    .font(.system(size: 24, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)

                Text(message)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Link(destination: updateURL) {
                Text("Update Now")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal, 32)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
    }
}

private struct AppLockView: View {
    var onUnlocked: () -> Void
    @State private var lastError: String?

    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle().fill(Theme.accentSoft)
                Image(systemName: "lock.fill")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }
            .frame(width: 76, height: 76)

            Text("Locked")
                .font(.system(size: 22, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)

            Text("Unlock with Face ID, Touch ID, or device passcode to continue.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 30)

            if let lastError {
                Text(lastError)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.danger)
            }

            Button {
                Task { await unlock() }
            } label: {
                Text("Unlock")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .padding(.horizontal, 24)
        }
        .padding(.top, 40)
        .task { await unlock() }
    }

    private func unlock() async {
        lastError = nil
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
            lastError = "Device authentication is not available."
            return
        }
        do {
            let ok = try await ctx.evaluatePolicy(.deviceOwnerAuthentication,
                                                 localizedReason: "Unlock OxSteed")
            if ok { onUnlocked() }
        } catch {
            lastError = "Unlock failed."
        }
    }
}

// MARK: - Landing

// MARK: - Onboarding

private struct OnboardingFlowView: View {
    let onComplete: () -> Void
    let onSetPersona: (Persona) -> Void

    @StateObject private var location = OxLocationManager()
    @StateObject private var lifeData = LifeDataStore.shared

    @State private var step: Step = .welcome
    @State private var primaryPersona: Persona = .customer

    enum Step: Int, CaseIterable {
        case welcome = 0
        case persona
        case permissions
        case pulseSetup
        case done
    }

    var body: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 10)

            VStack(spacing: 10) {
                Text(LocalizedStringKey("onboarding.welcome.title"))
                    .font(.system(size: 26, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text(LocalizedStringKey("onboarding.welcome.subtitle"))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            Group {
                switch step {
                case .welcome:
                    onboardingCard(title: "onboarding.quick_start.title", subtitle: "onboarding.quick_start.subtitle") {
                        bullet("onboarding.quick_start.bullet_1")
                        bullet("onboarding.quick_start.bullet_2")
                        bullet("onboarding.quick_start.bullet_3")
                    }

                case .persona:
                    onboardingCard(title: "onboarding.persona.title", subtitle: "onboarding.persona.subtitle") {
                        ForEach(Persona.allCases) { p in
                            Button {
                                primaryPersona = p
                            } label: {
                                HStack {
                                    Image(systemName: p.icon).foregroundStyle(p.color)
                                    Text(p.rawValue).foregroundStyle(Theme.textPrimary)
                                    Spacer()
                                    if primaryPersona == p {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent)
                                    }
                                }
                                .padding(12)
                                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 14))
                                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                    }

                case .permissions:
                    onboardingCard(title: "onboarding.permissions.title", subtitle: "onboarding.permissions.subtitle") {
                        permissionRow(icon: "location.fill",
                                      title: "onboarding.location.title",
                                      subtitle: Text(verbatim: location.statusText),
                                      actionTitle: "onboarding.enable") {
                            location.request()
                        }

                        permissionRow(icon: "bell.fill",
                                      title: "onboarding.notifications.title",
                                      subtitle: Text("onboarding.notifications.subtitle"),
                                      actionTitle: "onboarding.enable") {
                            PushManager.shared.requestAndRegister()
                        }
                    }

                case .pulseSetup:
                    onboardingCard(title: "onboarding.pulse.title", subtitle: "onboarding.pulse.subtitle") {
                        PillarChecklistView()
                    }

                case .done:
                    onboardingCard(title: "onboarding.done.title", subtitle: "onboarding.done.subtitle") {
                        bullet("onboarding.done.bullet_1")
                        bullet("onboarding.done.bullet_2")
                        bullet("onboarding.done.bullet_3")
                    }
                }
            }
            .padding(.horizontal, 20)

            Spacer(minLength: 0)

            HStack(spacing: 12) {
                if step != .welcome {
                    Button("common.back") { withAnimation { step = Step(rawValue: max(0, step.rawValue - 1)) ?? .welcome } }
                        .foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
                }

                Button(step == .done ? "onboarding.enter_app" : "common.continue") {
                    advance()
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 18)
        }
        .background(Theme.background.ignoresSafeArea())
    }

    private func advance() {
        switch step {
        case .welcome:
            withAnimation { step = .persona }
        case .persona:
            onSetPersona(primaryPersona)
            withAnimation { step = .permissions }
        case .permissions:
            withAnimation { step = .pulseSetup }
        case .pulseSetup:
            withAnimation { step = .done }
        case .done:
            onComplete()
        }
    }

    private func onboardingCard<Content: View>(title: LocalizedStringKey, subtitle: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 18, weight: .bold)).foregroundStyle(Theme.textPrimary)
                    Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                Text("\(step.rawValue + 1)/\(Step.allCases.count)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
            }
            content()
        }
        .cardStyle()
    }

    private func bullet(_ s: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(Theme.accent).frame(width: 6, height: 6).padding(.top, 6)
            Text(s).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func permissionRow(icon: String,
                               title: LocalizedStringKey,
                               subtitle: Text,
                               actionTitle: LocalizedStringKey,
                               action: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).foregroundStyle(Theme.accent)
                .frame(width: 34, height: 34)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                subtitle.font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(2)
            }
            Spacer()
            Button(actionTitle, action: action)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Theme.accent, in: Capsule())
        }
        .padding(12)
        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private func isoDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}

private struct PillarChecklistView: View {
    @StateObject private var lifeData = LifeDataStore.shared

    var body: some View {
        VStack(spacing: 10) {
            row("Money", ok: !lifeData.moneyEntries.isEmpty)
            row("Home Care", ok: !lifeData.homeTasks.isEmpty)
            row("Car Care", ok: !lifeData.vehicles.isEmpty)
            row("Personal", ok: !lifeData.habits.isEmpty)
            row("Goals", ok: !lifeData.goals.isEmpty)
            row("Sinking Funds", ok: !lifeData.sinkingFunds.isEmpty)
        }
    }

    private func row(_ title: String, ok: Bool) -> some View {
        HStack {
            Image(systemName: ok ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(ok ? Theme.success : Theme.textTertiary)
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
            Spacer()
            Text(ok ? "Ready" : "Needs 1 item").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
        .padding(10)
        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

final class OxLocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var statusText: String = "Not determined"

    private let mgr = CLLocationManager()

    override init() {
        super.init()
        mgr.delegate = self
        updateStatusText(mgr.authorizationStatus)
    }

    func request() {
        mgr.requestWhenInUseAuthorization()
        mgr.requestLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        updateStatusText(manager.authorizationStatus)
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        UserDefaults.standard.set(loc.coordinate.latitude, forKey: "ox.location.lat")
        UserDefaults.standard.set(loc.coordinate.longitude, forKey: "ox.location.lng")
        UserDefaults.standard.set(Date(), forKey: "ox.location.updated_at")
        statusText = "Enabled"
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // non-fatal
    }

    private func updateStatusText(_ s: CLAuthorizationStatus) {
        switch s {
        case .authorizedAlways, .authorizedWhenInUse: statusText = "Enabled"
        case .denied, .restricted: statusText = "Disabled"
        case .notDetermined: statusText = "Not determined"
        @unknown default: statusText = "Unknown"
        }
    }
}

struct AuthLandingView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var mode: Mode = .login
    enum Mode { case login, register }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 12) {
                    Image("OxSteedLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 84, height: 84)
                        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))

                    Text("OxSteed")
                        .font(.system(size: 32, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text("Your personal operating system")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.top, 60)

                Picker("", selection: $mode) {
                    Text("Sign In").tag(Mode.login)
                    Text("Create Account").tag(Mode.register)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)

                Group {
                    if auth.pendingMfaToken != nil {
                        TwoFactorForm()
                    } else {
                        if mode == .login { LoginForm() } else { RegisterForm() }
                    }
                }
                .padding(.horizontal, 20)

                Spacer(minLength: 40)
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }
}

// MARK: - Login

struct LoginForm: View {
    @EnvironmentObject var auth: AuthStore
    @State private var email = ""
    @State private var password = ""
    @State private var agreementName = ""
    @State private var termsAgreed = false
    @State private var rememberMe = false
    @State private var showForgotPassword = false
    private let termsURL = URL(string: "https://oxsteed.com/terms")!
    private let privacyURL = URL(string: "https://oxsteed.com/privacy")!

    var body: some View {
        VStack(spacing: 14) {
            OxTextField(title: "Email", text: $email, keyboard: .emailAddress, textContentType: .username)
            OxTextField(title: "Password", text: $password, secure: true, textContentType: .password)

            VStack(alignment: .leading, spacing: 10) {
                Toggle(isOn: $termsAgreed) {
                    Text("I agree to the Terms of Service").font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                }
                .tint(Theme.accent)

                HStack(spacing: 12) {
                    Link("Terms of Service", destination: termsURL)
                    Text("•")
                        .foregroundStyle(Theme.textTertiary)
                    Link("Privacy Policy", destination: privacyURL)
                }
                .font(.system(size: 12, weight: .semibold))
                .tint(Theme.accent)

                OxTextField(title: "Full Name (Signature)", text: $agreementName)

                Toggle(isOn: $rememberMe) {
                    Text("Remember me").font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                }
                .tint(Theme.accent)
            }
            .cardStyle(padding: 12)

            if let err = auth.lastError {
                Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task {
                    await auth.login(email: email,
                                     password: password,
                                     agreementName: agreementName,
                                     rememberMe: rememberMe)
                }
            } label: {
                HStack {
                    if auth.isLoading { ProgressView().tint(.white) }
                    Text("Sign In")
                        .font(.system(size: 15, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.white)
            }
            .disabled(auth.isLoading ||
                      email.isEmpty ||
                      password.isEmpty ||
                      !termsAgreed ||
                      agreementName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Button("Forgot password?") { showForgotPassword = true }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .cardStyle()
        .sheet(isPresented: $showForgotPassword) {
            ForgotPasswordView()
                .presentationDetents([.medium])
                .presentationBackground(Theme.background)
        }
    }
}

// MARK: - Register

struct RegisterForm: View {
    @EnvironmentObject var auth: AuthStore
    @State private var first = ""
    @State private var last = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var role: String = "customer"
    @State private var ref = ""

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                OxTextField(title: "First name", text: $first)
                OxTextField(title: "Last name", text: $last)
            }
            OxTextField(title: "Email", text: $email, keyboard: .emailAddress, textContentType: .emailAddress)
            OxTextField(title: "Phone (optional)", text: $phone, keyboard: .phonePad)
            OxTextField(title: "Password (8+ chars)", text: $password, secure: true, textContentType: .newPassword)

            VStack(alignment: .leading, spacing: 10) {
                Text("Role").sectionTitle()
                Picker("", selection: $role) {
                    Text("Customer").tag("customer")
                    Text("Helper").tag("helper")
                    Text("Business Owner").tag("business_owner")
                    Text("Consultant").tag("consultant")
                    Text("Tool Owner").tag("tool_owner")
                    Text("Franchise Owner").tag("franchise_applicant")
                    Text("Investor").tag("investor")
                }
                .pickerStyle(.segmented)
                OxTextField(title: "Referral code (optional)", text: $ref)
            }
            .cardStyle(padding: 12)

            if let err = auth.lastError {
                Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task {
                    await auth.register(email: email,
                                        password: password,
                                        firstName: first,
                                        lastName: last,
                                        phone: phone.isEmpty ? nil : phone,
                                        role: role,
                                        ref: ref.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : ref)
                }
            } label: {
                HStack {
                    if auth.isLoading { ProgressView().tint(.white) }
                    Text("Create Account")
                        .font(.system(size: 15, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.white)
            }
            .disabled(auth.isLoading || email.isEmpty || password.count < 8 || first.isEmpty || last.isEmpty)
        }
        .cardStyle()
    }
}

// MARK: - Two-Factor

private struct TwoFactorForm: View {
    @EnvironmentObject var auth: AuthStore
    @State private var code = ""

    var body: some View {
        VStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Two-Factor Verification")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text("Enter your 6-digit code to finish signing in.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            OxTextField(title: "Verification code", text: $code, keyboard: .numberPad)

            if let err = auth.lastError {
                Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task { await auth.submitTwoFactor(code: code) }
            } label: {
                HStack {
                    if auth.isLoading { ProgressView().tint(.white) }
                    Text("Verify")
                        .font(.system(size: 15, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.white)
            }
            .disabled(auth.isLoading || code.trimmingCharacters(in: .whitespacesAndNewlines).count < 6)

            Button("Back") { auth.cancelTwoFactor() }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .cardStyle()
    }
}

// MARK: - Forgot / Reset Password

private struct ForgotPasswordView: View {
    @EnvironmentObject var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var showReset = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text("Reset Password")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                OxTextField(title: "Email", text: $email, keyboard: .emailAddress)

                if let err = auth.lastError {
                    Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    Task {
                        let ok = await auth.requestPasswordReset(email: email)
                        if ok { showReset = true }
                    }
                } label: {
                    HStack {
                        if auth.isLoading { ProgressView().tint(.white) }
                        Text("Send Reset Email")
                            .font(.system(size: 15, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(.white)
                }
                .disabled(auth.isLoading || email.isEmpty)

                Button("I have a reset token") { showReset = true }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Forgot Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() }.foregroundStyle(Theme.accent) } }
        }
        .sheet(isPresented: $showReset) {
            ResetPasswordView()
                .presentationDetents([.medium])
                .presentationBackground(Theme.background)
        }
    }
}

private struct ResetPasswordView: View {
    @EnvironmentObject var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var token = ""
    @State private var newPassword = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text("Enter Reset Token")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                OxTextField(title: "Token", text: $token)
                OxTextField(title: "New password", text: $newPassword, secure: true)

                if let err = auth.lastError {
                    Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    Task {
                        let ok = await auth.resetPassword(token: token, newPassword: newPassword)
                        if ok { dismiss() }
                    }
                } label: {
                    HStack {
                        if auth.isLoading { ProgressView().tint(.white) }
                        Text("Set New Password")
                            .font(.system(size: 15, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(.white)
                }
                .disabled(auth.isLoading || token.isEmpty || newPassword.count < 8)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Reset Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() }.foregroundStyle(Theme.accent) } }
        }
    }
}

// MARK: - Reusable text field

struct OxTextField: View {
    let title: LocalizedStringKey
    @Binding var text: String
    var keyboard: UIKeyboardType = .default
    var secure: Bool = false
    var textContentType: UITextContentType? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(Theme.textTertiary)
                .textCase(.uppercase)
            Group {
                if secure {
                    SecureField("", text: $text)
                        .textContentType(textContentType)
                } else {
                    TextField("", text: $text)
                        .keyboardType(keyboard)
                        .textContentType(textContentType)
                        .textInputAutocapitalization(keyboard == .emailAddress ? .never : .sentences)
                        .autocorrectionDisabled(keyboard == .emailAddress)
                }
            }
            .font(.system(size: 15))
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 12).padding(.vertical, 11)
            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
        }
    }
}

// MARK: - Account Restored View

/// Shown once on a fresh install after a returning user signs in.
/// Confirms that their data is intact and nothing was lost.
struct AccountRestoredView: View {
    var onDismiss: () -> Void = {}
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager

    private let restoredItems: [(icon: String, title: String, detail: String)] = [
        ("heart.text.square.fill",              "Life Dashboard",      "Pulse score, sinking funds, spending history, and goals"),
        ("bubble.left.and.bubble.right.fill",   "Messages",            "All conversations with helpers and customers"),
        ("hammer.fill",                         "Jobs & Bookings",     "Active jobs, past work history, and quotes"),
        ("person.fill.checkmark",               "Persona & Settings",  "Your active role, notification preferences, and language"),
    ]

    private let itemColors: [Color] = [
        Theme.pillarMoney, Theme.accent, Theme.pillarHome, Theme.pillarCar
    ]

    var body: some View {
        VStack(spacing: 22) {
            // Header
            VStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(Theme.success.opacity(0.14))
                        .frame(width: 68, height: 68)
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.system(size: 32, weight: .bold))
                        .foregroundStyle(Theme.success)
                }
                Text(localization.format("Welcome back%@!", auth.user?.first_name.flatMap { $0.isEmpty ? nil : ", \($0)" } ?? ""))
                    .font(.system(size: 20, weight: .heavy, design: .rounded))
                    .foregroundStyle(Theme.textPrimary)
                Text("Your account has been fully restored.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.top, 4)

            // Restored items list
            VStack(spacing: 10) {
                ForEach(Array(restoredItems.enumerated()), id: \.offset) { idx, item in
                    let color = itemColors[idx % itemColors.count]
                    HStack(alignment: .top, spacing: 12) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(color.opacity(0.14))
                                .frame(width: 36, height: 36)
                            Image(systemName: item.icon)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(color)
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            Text(LocalizedStringKey(item.title))
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(Theme.textPrimary)
                            Text(LocalizedStringKey(item.detail))
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.success)
                    }
                }
            }
            .cardStyle()

            // CTA
            Button { onDismiss() } label: {
                Text("Let's Go")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)

            Text("If anything looks missing, pull-to-refresh on any screen to sync the latest data.")
                .font(.system(size: 11))
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
    }
}
