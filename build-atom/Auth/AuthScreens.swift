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
/// - Guest users: see the document-guided setup flow before the 4-tab shell.
/// - Signed-in users: optionally require biometric unlock, then onboarding, then shell.
struct RootGate: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var personaStore: PersonaStore
    @AppStorage("ox.security.require_biometrics") private var requireBiometrics = false
    @AppStorage("ox.onboarding.completed") private var onboardingCompleted = false
    @AppStorage("ox.guest_onboarding.completed") private var guestOnboardingCompleted = false
    @State private var bootstrapped = false
    @State private var isUnlocked = false
    @AppStorage("ox.accountRestored.shown") private var accountRestoredShown = false
    @State private var showAccountRestored = false
    @State private var showGuestAuthSheet = false

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
                            let previous = personaStore.active
                            personaStore.active = persona
                            personaStore.hasExplicitPersona = true
                            Task {
                                let succeeded = await auth.switchPersona(persona)
                                if !succeeded {
                                    personaStore.active = previous
                                    personaStore.hasExplicitPersona = true
                                }
                            }
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
                if guestOnboardingCompleted {
                    RootShellView()
                } else {
                    GuestOnboardingFlowView(
                        onComplete: { guestOnboardingCompleted = true },
                        onSetPersona: { persona in personaStore.active = persona },
                        onSignIn: { showGuestAuthSheet = true }
                    )
                }
            }
        }
        .sheet(isPresented: $showGuestAuthSheet) {
            AuthLandingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
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
                if guestOnboardingCompleted {
                    onboardingCompleted = true
                }
            } else {
                isUnlocked = false
                if guestOnboardingCompleted {
                    onboardingCompleted = true
                }
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
    @State private var browserURL: BrowserURL?

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
                Text("auth.update_required")
                    .font(.system(size: 24, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)

                Text(message)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Button {
                browserURL = BrowserURL(url: updateURL)
            } label: {
                Text("auth.update_now")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal, 32)
            }
            .buttonStyle(.plain)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
        .sheet(item: $browserURL) { item in
            SafariBrowserView(url: item.url)
        }
    }
}

private struct AppLockView: View {
    var onUnlocked: () -> Void
    @EnvironmentObject private var localization: LocalizationManager
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

            Text("auth.locked")
                .font(.system(size: 22, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)

            Text("auth.locked_message")
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
                Text("auth.unlock")
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
            lastError = localization.localized("Device authentication is not available.")
            return
        }
        do {
            let ok = try await ctx.evaluatePolicy(.deviceOwnerAuthentication,
                                                 localizedReason: localization.localized("Unlock OxSteed"))
            if ok { onUnlocked() }
        } catch {
            lastError = localization.localized("Unlock failed.")
        }
    }
}

// MARK: - Landing

// MARK: - Onboarding

private struct GuestOnboardingFlowView: View {
    @EnvironmentObject private var personaStore: PersonaStore

    let onComplete: () -> Void
    let onSetPersona: (Persona) -> Void
    let onSignIn: () -> Void

    @State private var step: Step = .welcome
    @State private var selectedPersona: Persona = .customer
    @State private var selectedBusinessRole: BusinessSubPersona = .owner
    @State private var selectedNeeds: Set<String> = []
    @State private var selectedContextSignal: String?
    @State private var selectedStyleSignal: String?

    private enum Step: Int, CaseIterable {
        case welcome = 0
        case persona
        case calibrate
        case preview
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 18) {
                    guestProgress

                    switch step {
                    case .welcome:
                        welcomeStep
                    case .persona:
                        personaStep
                    case .calibrate:
                        calibrationStep
                    case .preview:
                        previewStep
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 18)
            }

            bottomActions
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
                .background(Theme.background.opacity(0.96))
        }
        .background(Theme.background.ignoresSafeArea())
        .onAppear {
            loadStoredSetup(for: selectedPersona)
        }
    }

    private var guestProgress: some View {
        HStack(spacing: 6) {
            ForEach(Step.allCases, id: \.rawValue) { item in
                Capsule()
                    .fill(item.rawValue <= step.rawValue ? Theme.accent : Theme.stroke)
                    .frame(width: item == step ? 22 : 7, height: 7)
            }
            Spacer()
            Text("Step \(step.rawValue + 1) of \(Step.allCases.count)")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Theme.textTertiary)
        }
    }

    private var welcomeStep: some View {
        VStack(spacing: 18) {
            Image("OxSteedLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 78, height: 78)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

            VStack(spacing: 8) {
                Text("OxSteed ME")
                    .font(.system(size: 32, weight: .heavy, design: .rounded))
                    .foregroundStyle(Theme.textPrimary)
                Text("One app for your life, your work, and your growth.")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                Text("Let's set it up for you in under 2 minutes.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 10) {
                guestValueRow(icon: "person.crop.circle.badge.questionmark", title: "Choose who you are here as", subtitle: "Customer, Helper, Consultant, Investor, or Business Owner.")
                guestValueRow(icon: "slider.horizontal.3", title: "Answer a few quick signals", subtitle: "Tap chips, skip anything, and avoid a long form.")
                guestValueRow(icon: "sparkles", title: "See value before sign-in", subtitle: "Preview Home, Life Pulse, Growth, and Learn before saving.")
            }
            .cardStyle()
        }
    }

    private var personaStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("What best describes you right now?")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text("Your answer helps us show what matters most to you first.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
            }

            ForEach(Persona.onboardingPersonas) { persona in
                Button {
                    selectedPersona = persona
                    loadStoredSetup(for: persona)
                    personaStore.hasExplicitPersona = true
                    onSetPersona(persona)
                    if persona == .business {
                        personaStore.businessSubPersona = selectedBusinessRole
                    }
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: persona.icon)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(persona.color)
                            .frame(width: 38, height: 38)
                            .background(persona.color.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(persona.rawValue)
                                .font(.system(size: 15, weight: .heavy))
                                .foregroundStyle(Theme.textPrimary)
                            Text(persona.onboardingDescription)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        if selectedPersona == persona {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(Theme.accent)
                        }
                    }
                    .padding(14)
                    .background(selectedPersona == persona ? persona.color.opacity(0.10) : Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(selectedPersona == persona ? persona.color.opacity(0.35) : Theme.stroke, lineWidth: 1))
                }
                .buttonStyle(.plain)

                if persona == .business && selectedPersona == .business {
                    BusinessSubPersonaPicker(
                        selection: $selectedBusinessRole,
                        title: "Who do you work as inside the business?",
                        subtitle: "This changes the Business Owner Home and the Learn path without creating a separate top-level OxPersona."
                    )
                    .padding(.top, -4)
                    .onChange(of: selectedBusinessRole) { _, newRole in
                        personaStore.businessSubPersona = newRole
                    }
                }
            }

            Text("You can add more roles later in OxPersona settings.")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.textTertiary)
        }
    }

    private var calibrationStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(calibrationPrompt)
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text("Tap what fits. Selecting an option activates matching Home, Life, Learn, and Growth previews.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(calibrationOptions) { option in
                    let isSelected = selectedNeeds.contains(option.id)
                    Button {
                        if isSelected {
                            selectedNeeds.remove(option.id)
                        } else {
                            selectedNeeds.insert(option.id)
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Image(systemName: option.icon)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(option.color)
                                .frame(width: 30, height: 30)
                                .background(option.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                            Text(option.title)
                                .font(.system(size: 12, weight: .heavy))
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(2)
                            Text(option.unlock)
                                .font(.system(size: 10))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(3)
                        }
                        .frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)
                        .padding(12)
                        .background(isSelected ? option.color.opacity(0.12) : Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(isSelected ? option.color.opacity(0.42) : Theme.stroke, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }

            signalSection(
                title: selectedPersona.contextSignalPrompt,
                options: selectedPersona.contextSignalOptions,
                selection: $selectedContextSignal
            )

            signalSection(
                title: selectedPersona.styleSignalPrompt,
                options: selectedPersona.styleSignalOptions,
                selection: $selectedStyleSignal
            )

            Button {
                selectedNeeds.removeAll()
                selectedContextSignal = nil
                selectedStyleSignal = nil
                withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                    step = .preview
                }
            } label: {
                Text("Skip for now")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.surfaceElevated, in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    private var previewStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Here's your \(selectedPersona.rawValue) setup")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text("This is your first value moment. Sign in only when you want to save it.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
            }

            FirstValueMomentPreview(
                persona: selectedPersona,
                businessRole: selectedPersona == .business ? selectedBusinessRole : nil,
                setupSignalIDs: selectedSetupSignalIDs
            )
                .cardStyle()

            if !selectedNeeds.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Activated from your answers")
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    ForEach(calibrationOptions.filter { selectedNeeds.contains($0.id) }) { option in
                        HStack(spacing: 8) {
                            Image(systemName: option.icon)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(option.color)
                            Text(option.title)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            Spacer()
                        }
                        .padding(10)
                        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                .cardStyle()
            }

            if !selectedSetupSignalOptions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Priority signals")
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    ForEach(selectedSetupSignalOptions) { option in
                        HStack(spacing: 8) {
                            Image(systemName: option.icon)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(option.color)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(option.title)
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text(option.unlock)
                                    .font(.system(size: 10))
                                    .foregroundStyle(Theme.textSecondary)
                                    .lineLimit(2)
                            }
                            Spacer()
                        }
                        .padding(10)
                        .background(option.color.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(option.color.opacity(0.18), lineWidth: 1))
                    }
                }
                .cardStyle()
            }
        }
    }

    private var bottomActions: some View {
        VStack(spacing: 10) {
            if step == .welcome {
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                        step = .persona
                    }
                } label: {
                    Text("Get Started")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)

                Button {
                    enterNoPersonaGuest()
                    onComplete()
                } label: {
                    Text("Explore without signing in")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .buttonStyle(.plain)
            } else if step == .preview {
                Button {
                    applySelection()
                    onComplete()
                    onSignIn()
                } label: {
                    Text("Sign in to save setup")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)

                Button {
                    applySelection()
                    onComplete()
                } label: {
                    Text("Continue without account")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .buttonStyle(.plain)
            } else {
                HStack(spacing: 12) {
                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                            step = Step(rawValue: max(0, step.rawValue - 1)) ?? .welcome
                        }
                    } label: {
                        Text("common.back")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
                    }
                    .buttonStyle(.plain)

                    Button {
                        if step == .persona {
                            applySelection()
                        }
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                            step = Step(rawValue: min(Step.allCases.count - 1, step.rawValue + 1)) ?? .preview
                        }
                    } label: {
                        Text("common.continue")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func guestValueRow(icon: String, title: String, subtitle: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.accent)
                .frame(width: 34, height: 34)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    private func applySelection() {
        onSetPersona(selectedPersona)
        personaStore.hasExplicitPersona = true
        personaStore.setCalibrationIDs(selectedNeeds, for: selectedPersona)
        personaStore.setSetupSignalID(selectedContextSignal, kind: .context, for: selectedPersona)
        personaStore.setSetupSignalID(selectedStyleSignal, kind: .style, for: selectedPersona)
        if selectedPersona == .business {
            personaStore.businessSubPersona = selectedBusinessRole
        }
    }

    private func enterNoPersonaGuest() {
        selectedPersona = .customer
        selectedNeeds.removeAll()
        selectedContextSignal = nil
        selectedStyleSignal = nil
        onSetPersona(.customer)
        personaStore.hasExplicitPersona = false
        personaStore.setCalibrationIDs([], for: .customer)
        personaStore.setSetupSignalID(nil, kind: .context, for: .customer)
        personaStore.setSetupSignalID(nil, kind: .style, for: .customer)
    }

    private func loadStoredSetup(for persona: Persona) {
        selectedNeeds = personaStore.calibrationIDs(for: persona)
        selectedContextSignal = personaStore.setupSignalID(for: persona, kind: .context)
        selectedStyleSignal = personaStore.setupSignalID(for: persona, kind: .style)
    }

    private var calibrationPrompt: String {
        selectedPersona.calibrationPrompt
    }

    private var calibrationOptions: [PersonaCalibrationOption] {
        selectedPersona.calibrationOptions
    }

    private var selectedSetupSignalIDs: Set<String> {
        Set([selectedContextSignal, selectedStyleSignal].compactMap { $0 })
    }

    private var selectedSetupSignalOptions: [PersonaSetupSignalOption] {
        selectedPersona.setupSignalOptions(matching: selectedSetupSignalIDs)
    }

    private func signalSection(
        title: String,
        options: [PersonaSetupSignalOption],
        selection: Binding<String?>
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            VStack(spacing: 8) {
                ForEach(options) { option in
                    signalButton(option, selection: selection)
                }
            }
        }
        .cardStyle(padding: 12)
    }

    private func signalButton(
        _ option: PersonaSetupSignalOption,
        selection: Binding<String?>
    ) -> some View {
        let isSelected = selection.wrappedValue == option.id
        return Button {
            selection.wrappedValue = isSelected ? nil : option.id
        } label: {
            HStack(alignment: .top, spacing: 9) {
                Image(systemName: option.icon)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(option.color)
                    .frame(width: 30, height: 30)
                    .background(option.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.title)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(option.unlock)
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(option.color)
                        .padding(.top, 5)
                }
            }
            .padding(10)
            .background(isSelected ? option.color.opacity(0.10) : Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(isSelected ? option.color.opacity(0.34) : Theme.stroke, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

private struct OnboardingFlowView: View {
    @EnvironmentObject private var personaStore: PersonaStore

    let onComplete: () -> Void
    let onSetPersona: (Persona) -> Void

    @StateObject private var location = OxLocationManager()
    @StateObject private var lifeData = LifeDataStore.shared

    @State private var step: Step = .welcome
    @State private var primaryPersona: Persona = .customer
    @State private var businessRole: BusinessSubPersona = .owner

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
                        ForEach(Persona.onboardingPersonas) { p in
                            Button {
                                primaryPersona = p
                            } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: p.icon)
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundStyle(p.color)
                                        .frame(width: 34, height: 34)
                                        .background(p.color.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(LocalizedStringKey(L10n.PersonaKey.name(for: p)))
                                            .font(.system(size: 14, weight: .bold))
                                            .foregroundStyle(Theme.textPrimary)
                                        Text(p.onboardingDescription)
                                            .font(.system(size: 11))
                                            .foregroundStyle(Theme.textSecondary)
                                            .fixedSize(horizontal: false, vertical: true)
                                        Text(p.onboardingUnlock)
                                            .font(.system(size: 10, weight: .semibold))
                                            .foregroundStyle(p.color)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
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

                            if p == .business && primaryPersona == .business {
                                BusinessSubPersonaPicker(
                                    selection: $businessRole,
                                    title: "Who do you work as inside the business?",
                                    subtitle: "The nested role adjusts Business Home, Learn, Growth, and Life without changing your top-level OxPersona."
                                )
                                .onChange(of: businessRole) { _, newRole in
                                    personaStore.businessSubPersona = newRole
                                }
                            }
                        }
                    }

                case .permissions:
                    onboardingCard(title: "onboarding.permissions.title", subtitle: "onboarding.permissions.subtitle") {
                        permissionRow(icon: "location.fill",
                                      title: "onboarding.location.title",
                                      subtitle: Text(LocalizedStringKey(location.statusKey)),
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
                        FirstValueMomentPreview(
                            persona: primaryPersona,
                            businessRole: primaryPersona == .business ? businessRole : nil
                        )
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
            if primaryPersona == .business {
                personaStore.businessSubPersona = businessRole
            }
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
            Text(LocalizedStringKey(title)).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
            Spacer()
            Text(ok ? "Ready" : "Needs 1 item").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
        .padding(10)
        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

private struct FirstValueMomentPreview: View {
    let persona: Persona
    var businessRole: BusinessSubPersona? = nil
    var setupSignalIDs: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: displayIcon)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(displayColor)
                    .frame(width: 38, height: 38)
                    .background(displayColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 2) {
                    Text(persona.firstValueTitle(for: businessRole, setupSignalIDs: setupSignalIDs))
                        .font(.system(size: 14, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(persona.firstValueSubtitle(for: businessRole, setupSignalIDs: setupSignalIDs))
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(spacing: 8) {
                ForEach(persona.loopSignals(for: businessRole).prefix(3)) { signal in
                    HStack(spacing: 10) {
                        Image(systemName: signal.icon)
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(signal.color)
                            .frame(width: 30, height: 30)
                            .background(signal.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 9))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(signal.tab): \(signal.title)")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                            Text(signal.subtitle)
                                .font(.system(size: 10))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(2)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(10)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                }
            }
        }
    }

    private var displayIcon: String {
        guard persona == .business, let businessRole else { return persona.icon }
        return businessRole.icon
    }

    private var displayColor: Color {
        guard persona == .business, let businessRole else { return persona.color }
        return businessRole.color
    }
}

final class OxLocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var statusKey: String = "Not determined"

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
        statusKey = "Enabled"
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // non-fatal
    }

    private func updateStatusText(_ s: CLAuthorizationStatus) {
        switch s {
        case .authorizedAlways, .authorizedWhenInUse: statusKey = "Enabled"
        case .denied, .restricted: statusKey = "Disabled"
        case .notDetermined: statusKey = "Not determined"
        @unknown default: statusKey = "Unknown"
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
                    Text("auth.tagline")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.top, 60)

                Picker("", selection: $mode) {
                    Text("auth.sign_in").tag(Mode.login)
                    Text("auth.create_account").tag(Mode.register)
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
    @State private var browserURL: BrowserURL?
    private let termsURL = URL(string: "https://oxsteed.com/terms")!
    private let privacyURL = URL(string: "https://oxsteed.com/privacy")!

    var body: some View {
        VStack(spacing: 14) {
            OxTextField(title: "auth.field.email", text: $email, keyboard: .emailAddress, textContentType: .username)
            OxTextField(title: "auth.field.password", text: $password, secure: true, textContentType: .password)

            VStack(alignment: .leading, spacing: 10) {
                Toggle(isOn: $termsAgreed) {
                    Text("auth.agree_terms").font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                }
                .tint(Theme.accent)

                HStack(spacing: 12) {
                    Button("auth.terms_of_service") {
                        browserURL = BrowserURL(url: termsURL)
                    }
                    Text("•")
                        .foregroundStyle(Theme.textTertiary)
                    Button("auth.privacy_policy") {
                        browserURL = BrowserURL(url: privacyURL)
                    }
                }
                .font(.system(size: 12, weight: .semibold))
                .tint(Theme.accent)

                OxTextField(title: "auth.field.signature_name", text: $agreementName)

                Toggle(isOn: $rememberMe) {
                    Text("auth.remember_me").font(.system(size: 13, weight: .semibold))
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
                    Text("auth.sign_in")
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

            Button("auth.forgot_password") { showForgotPassword = true }
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
        .sheet(item: $browserURL) { item in
            SafariBrowserView(url: item.url)
        }
    }
}

// MARK: - Register

struct RegisterForm: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var personaStore: PersonaStore
    @State private var first = ""
    @State private var last = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var role: String = Persona.customer.serverMode
    @State private var ref = ""

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                OxTextField(title: "auth.field.first_name", text: $first)
                OxTextField(title: "auth.field.last_name", text: $last)
            }
            OxTextField(title: "auth.field.email", text: $email, keyboard: .emailAddress, textContentType: .emailAddress)
            OxTextField(title: "auth.field.phone_optional", text: $phone, keyboard: .phonePad)
            OxTextField(title: "auth.field.password_min", text: $password, secure: true, textContentType: .newPassword)

            VStack(alignment: .leading, spacing: 10) {
                Text("auth.field.role").sectionTitle()
                Picker("", selection: $role) {
                    ForEach(Persona.allCases) { persona in
                        Text(LocalizedStringKey(L10n.PersonaKey.name(for: persona))).tag(persona.serverMode)
                    }
                }
                .pickerStyle(.menu)
                OxTextField(title: "auth.field.referral_optional", text: $ref)
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
                    Text("auth.create_account")
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
        .onAppear {
            role = personaStore.active.serverMode
        }
        .onChange(of: personaStore.active) { _, newPersona in
            if role != newPersona.serverMode {
                role = newPersona.serverMode
            }
        }
        .onChange(of: role) { _, newRole in
            let selectedPersona = Persona(serverMode: newRole)
            if personaStore.active != selectedPersona {
                personaStore.active = selectedPersona
                personaStore.hasExplicitPersona = true
            }
        }
    }
}

// MARK: - Two-Factor

private struct TwoFactorForm: View {
    @EnvironmentObject var auth: AuthStore
    @State private var code = ""

    var body: some View {
        VStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("auth.two_factor_verification")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text("auth.two_factor_message")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            OxTextField(title: "auth.field.verification_code", text: $code, keyboard: .numberPad)

            if let err = auth.lastError {
                Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task { await auth.submitTwoFactor(code: code) }
            } label: {
                HStack {
                    if auth.isLoading { ProgressView().tint(.white) }
                    Text("auth.verify")
                        .font(.system(size: 15, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.white)
            }
            .disabled(auth.isLoading || code.trimmingCharacters(in: .whitespacesAndNewlines).count < 6)

            Button("common.back") { auth.cancelTwoFactor() }
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
                Text("auth.reset_password")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                OxTextField(title: "auth.field.email", text: $email, keyboard: .emailAddress)

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
                        Text("auth.send_reset_email")
                            .font(.system(size: 15, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(.white)
                }
                .disabled(auth.isLoading || email.isEmpty)

                Button("auth.reset_token_prompt") { showReset = true }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("auth.forgot_password_title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("common.done") { dismiss() }.foregroundStyle(Theme.accent) } }
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
                Text("auth.enter_reset_token")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                OxTextField(title: "auth.field.token", text: $token)
                OxTextField(title: "auth.field.new_password", text: $newPassword, secure: true)

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
                            Text("auth.set_new_password")
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
            .navigationTitle("auth.reset_password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("common.done") { dismiss() }.foregroundStyle(Theme.accent) } }
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
        ("heart.text.square.fill",              "auth.restored.life.title",      "auth.restored.life.detail"),
        ("bubble.left.and.bubble.right.fill",   "auth.restored.messages.title",  "auth.restored.messages.detail"),
        ("hammer.fill",                         "auth.restored.jobs.title",      "auth.restored.jobs.detail"),
        ("person.fill.checkmark",               "auth.restored.settings.title",  "auth.restored.settings.detail"),
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
                Text(localization.format("auth.restored.welcome_back", auth.user?.first_name.flatMap { $0.isEmpty ? nil : ", \($0)" } ?? ""))
                    .font(.system(size: 20, weight: .heavy, design: .rounded))
                    .foregroundStyle(Theme.textPrimary)
                Text("auth.restored.title")
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
                Text("auth.lets_go")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)

            Text("auth.restored.sync_hint")
                .font(.system(size: 11))
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
    }
}
