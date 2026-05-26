import SwiftUI

struct OneRootView: View {
    @Environment(OneStore.self) private var store

    var body: some View {
        Group {
            if store.forceUpdateRequired {
                forceUpdateView
            } else if !store.isAuthenticated {
                authView
            } else if store.showOnboarding {
                onboardingView
            } else if store.shouldRequireUnlock {
                lockView
            } else {
                mainAppView
            }
        }
        .task {
            store.restoreSession()
        }
        .environment(\.layoutDirection, store.appLanguage.layoutDirection == .rightToLeft ? .rightToLeft : .leftToRight)
        .environment(\.dynamicTypeSize, store.appPreferences.largeTextEnabled ? .accessibility2 : .large)
        .preferredColorScheme(preferredColorScheme)
    }

    private var mainAppView: some View {
        @Bindable var store = store
        return TabView(selection: $store.selectedTab) {
            NavigationStack {
                TodayView()
            }
            .tabItem {
                Label(AppTab.home.title, systemImage: AppTab.home.symbolName)
            }
            .tag(AppTab.home)

            NavigationStack {
                HireView()
            }
            .tabItem {
                Label(AppTab.life.title, systemImage: AppTab.life.symbolName)
            }
            .tag(AppTab.life)

            NavigationStack {
                ShopView()
            }
            .tabItem {
                Label(AppTab.growth.title, systemImage: AppTab.growth.symbolName)
            }
            .tag(AppTab.growth)

            NavigationStack {
                InboxView()
            }
            .tabItem {
                Label(AppTab.learn.title, systemImage: AppTab.learn.symbolName)
            }
            .tag(AppTab.learn)

            NavigationStack {
                ProfileView()
            }
            .tabItem {
                Label(AppTab.profile.title, systemImage: AppTab.profile.symbolName)
            }
            .tag(AppTab.profile)
        }
        .tint(OneTheme.amber)
        .background(OneTheme.background.ignoresSafeArea())
    }

    private var authView: some View {
        NavigationStack {
            VStack(spacing: 16) {
                OxSteedOneMark(size: 72)
                Text(store.localized("auth.title", fallback: "One Account. Many Roles."))
                    .font(.title3.bold())
                    .foregroundStyle(OneTheme.ink)
                Text(store.localized("auth.subtitle", fallback: "Sign in to load your personas, messages, and transactions."))
                    .font(.footnote)
                    .foregroundStyle(OneTheme.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                NavigationLink(store.localized("auth.sign_in", fallback: "Sign In")) { LoginView() }
                    .buttonStyle(GoAccentButtonStyle())
                NavigationLink(store.localized("auth.create_account", fallback: "Create Account")) { SignupView() }
                    .buttonStyle(.bordered)

                if let message = store.authStatusMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.top, 8)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(OneTheme.background.ignoresSafeArea())
        }
    }

    private var forceUpdateView: some View {
        ZStack {
            OneTheme.background.ignoresSafeArea()
            VStack(spacing: 16) {
                OxSteedOneMark(size: 72)
                Text(store.localized("force_update.title", fallback: "Update Required"))
                    .font(.title.bold())
                    .foregroundStyle(OneTheme.ink)
                Text(store.localized("force_update.body", fallback: "Please update OxSteed One to continue."))
                    .font(.footnote)
                    .foregroundStyle(OneTheme.muted)
                Text("Minimum version: \(store.minimumRequiredVersion)")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }
            .padding(24)
        }
    }

    private var lockView: some View {
        ZStack {
            OneTheme.background.ignoresSafeArea()
            VStack(spacing: 16) {
                OxSteedOneMark(size: 72)
                Text(store.localized("lock.title", fallback: "OxSteed One Locked"))
                    .font(.title3.bold())
                    .foregroundStyle(OneTheme.ink)
                Button(store.localized("lock.button", fallback: "Unlock with Face ID / Touch ID")) {
                    Task { await store.unlockWithBiometrics() }
                }
                .buttonStyle(GoAccentButtonStyle())
                if let message = store.authStatusMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            .padding(20)
        }
    }

    private var onboardingView: some View {
        NavigationStack {
            Form {
                Section("Welcome") {
                    Text("Set up your first persona and pulse pillars. Pulse is never zero on first launch.")
                }

                Section("Primary Persona") {
                    Picker("Start as", selection: Binding(
                        get: { store.onboardingState.selectedPrimaryPersona },
                        set: { store.onboardingState.selectedPrimaryPersona = $0 }
                    )) {
                        ForEach(store.personaOptions) { persona in
                            Text(persona.label).tag(persona)
                        }
                    }
                }

                Section("Pulse Pillars") {
                    Toggle("Money", isOn: Binding(get: { store.onboardingState.hasMoney }, set: { store.onboardingState.hasMoney = $0 }))
                    Toggle("Home Care", isOn: Binding(get: { store.onboardingState.hasHomeCare }, set: { store.onboardingState.hasHomeCare = $0 }))
                    Toggle("Car Care", isOn: Binding(get: { store.onboardingState.hasCarCare }, set: { store.onboardingState.hasCarCare = $0 }))
                    Toggle("Personal Care", isOn: Binding(get: { store.onboardingState.hasPersonalCare }, set: { store.onboardingState.hasPersonalCare = $0 }))
                    Toggle("Goals", isOn: Binding(get: { store.onboardingState.hasGoals }, set: { store.onboardingState.hasGoals = $0 }))
                    Toggle("Planned Needs", isOn: Binding(get: { store.onboardingState.hasPlannedNeeds }, set: { store.onboardingState.hasPlannedNeeds = $0 }))
                }

                Section {
                    Button("Finish Setup") {
                        store.completeOnboarding()
                    }
                    .buttonStyle(GoAccentButtonStyle())
                }
            }
            .navigationTitle("Get Started")
        }
    }

    private var preferredColorScheme: ColorScheme? {
        switch store.appPreferences.appearance {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

#Preview {
    OneRootView()
        .environment(OneStore())
}

private struct LoginView: View {
    @Environment(OneStore.self) private var store

    private var canSubmit: Bool {
        let email = store.authEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = store.authPassword.trimmingCharacters(in: .whitespacesAndNewlines)
        return !email.isEmpty && !password.isEmpty
    }

    var body: some View {
        @Bindable var store = store
        Form {
            Section(store.localized("auth.welcome_back", fallback: "Welcome Back")) {
                TextField("Email", text: $store.authEmail)
                    .textContentType(.username)
                SecureField("Password", text: $store.authPassword)
                    .textContentType(.password)
                            }
            Section {
                Button {
                    Task {
                        await store.login(
                            email: store.authEmail,
                            password: store.authPassword,
                            agreementName: store.authAgreementName,
                            acceptedTerms: store.authAcceptedTerms
                        )
                    }
                } label: {
                    if store.isAuthenticating {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text(store.localized("auth.sign_in", fallback: "Sign In"))
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(store.isAuthenticating || !canSubmit)
                .buttonStyle(GoAccentButtonStyle())
            }

            if let message = store.authStatusMessage {
                Section {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(store.localized("auth.sign_in", fallback: "Sign In"))
    }
}

private struct SignupView: View {
    @Environment(OneStore.self) private var store

    var body: some View {
        @Bindable var store = store
        Form {
            Section(store.localized("auth.create_account_title", fallback: "Create Account")) {
                TextField("First name", text: $store.authFirstName)
                    .textContentType(.givenName)
                TextField("Last name", text: $store.authLastName)
                    .textContentType(.familyName)
                TextField("Email", text: $store.authEmail)
                    .textContentType(.username)
                SecureField("Password", text: $store.authPassword)
                    .textContentType(.newPassword)
            }

            Section(store.localized("auth.primary_persona", fallback: "Primary Persona")) {
                Picker("Persona", selection: $store.onboardingState.selectedPrimaryPersona) {
                    ForEach(store.personaOptions) { persona in
                        Text(persona.label).tag(persona)
                    }
                }
                .pickerStyle(.menu)
            }

            Section {
                Button {
                    Task {
                        await store.register(
                            email: store.authEmail,
                            password: store.authPassword,
                            firstName: store.authFirstName,
                            lastName: store.authLastName,
                            primaryPersona: store.onboardingState.selectedPrimaryPersona
                        )
                    }
                } label: {
                    if store.isAuthenticating {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text(store.localized("auth.create_account", fallback: "Create Account"))
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(store.isAuthenticating)
                .buttonStyle(GoAccentButtonStyle())
            }
        }
        .navigationTitle(store.localized("auth.create_account", fallback: "Create Account"))
    }
}
