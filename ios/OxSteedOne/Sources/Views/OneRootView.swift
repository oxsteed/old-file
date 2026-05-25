import SwiftUI

struct OneRootView: View {
    @Environment(OneStore.self) private var store

    var body: some View {
        Group {
            if store.forceUpdateRequired {
                forceUpdateView
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
        }
        .tint(OneTheme.amber)
        .background(OneTheme.background.ignoresSafeArea())
    }

    private var forceUpdateView: some View {
        ZStack {
            OneTheme.background.ignoresSafeArea()
            VStack(spacing: 16) {
                OxSteedOneMark(size: 72)
                Text("Update Required")
                    .font(.title.bold())
                    .foregroundStyle(OneTheme.ink)
                Text("Please update OxSteed One to continue.")
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
                Text("OxSteed One Locked")
                    .font(.title3.bold())
                    .foregroundStyle(OneTheme.ink)
                Button("Unlock with Face ID / Touch ID") {
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
}

#Preview {
    OneRootView()
        .environment(OneStore())
}
