import SwiftUI

struct OneRootView: View {
    @Environment(OneStore.self) private var store
    @State private var guestExploreSection = 0
    @State private var guestSearchText = ""
    @State private var selectedGuestItem: GuestPreviewItem?

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
            VStack(spacing: 0) {
                guestAppHeader
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        guestSearchBar
                        guestModeStrip
                        guestMetricStrip
                        guestListingSection
                        if let message = store.authStatusMessage {
                            Text(message)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .padding(.horizontal, 2)
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 14)
                    .padding(.bottom, 96)
                }
            }
            .background(OneTheme.background.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) {
                guestAuthBar
            }
            .sheet(item: $selectedGuestItem) { item in
                GuestListingDetailSheet(item: item)
                    .presentationDetents([.medium, .large])
            }
            .task {
                await store.loadGuestDiscovery()
            }
            .preferredColorScheme(.dark)
        }
    }

    private var guestAppHeader: some View {
            HStack(spacing: 12) {
            OxSteedOneMark(size: 44)
            VStack(alignment: .leading, spacing: 1) {
                Text(store.localized("app.name", fallback: "OxSteed One"))
                    .font(.title2.weight(.heavy))
                    .foregroundStyle(.white)
                Text(store.localized("home.browse_help_jobs_tools", fallback: "Browse local help, jobs, and tools"))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(OneTheme.muted)
            }
            Spacer()
            NavigationLink(store.localized("auth.sign_in", fallback: "Sign In")) { LoginView() }
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(OneTheme.amber, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(OneTheme.deepNavy.opacity(0.98))
    }

    private var guestSearchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(OneTheme.muted)
            ZStack(alignment: .leading) {
                if guestSearchText.isEmpty {
                    Text(store.localized("home.search_placeholder_text", fallback: "Search jobs, helpers, or tools"))
                        .foregroundStyle(.white.opacity(0.46))
                }
                TextField("", text: $guestSearchText)
                    .textInputAutocapitalization(.never)
                    .foregroundStyle(.white)
            }
            if !guestSearchText.isEmpty {
                Button {
                    guestSearchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(OneTheme.muted)
                }
            }
        }
        .padding(12)
        .background(OneTheme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(OneTheme.border, lineWidth: 1)
        )
    }

    private var guestModeStrip: some View {
        HStack(spacing: 6) {
            guestSegmentButton(store.localized("home.guest_section_jobs", fallback: "Jobs"), icon: "hammer.fill", index: 0)
            guestSegmentButton(store.localized("home.guest_section_helpers", fallback: "Helpers"), icon: "person.2.fill", index: 1)
            guestSegmentButton(store.localized("home.guest_section_tools", fallback: "Tools"), icon: "wrench.and.screwdriver.fill", index: 2)
        }
        .padding(5)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func guestSegmentButton(_ title: String, icon: String, index: Int) -> some View {
        Button {
            withAnimation(.snappy(duration: 0.18)) {
                guestExploreSection = index
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption.weight(.bold))
                Text(title)
                    .font(.subheadline.weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .foregroundStyle(guestExploreSection == index ? .white : OneTheme.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(guestExploreSection == index ? OneTheme.amber : Color.clear)
            )
        }
        .buttonStyle(.plain)
    }

    private var guestMetricStrip: some View {
        HStack(spacing: 8) {
            guestMetric(value: "\(store.customerJobs.count)", label: "Jobs")
            guestMetric(value: "\(store.serviceHelpers.count)", label: store.localized("home.guest_section_helpers", fallback: "Helpers"))
            guestMetric(value: "\(store.rentalTools.count)", label: store.localized("home.guest_section_tools", fallback: "Tools"))
        }
    }

    private func guestMetric(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(OneTheme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var guestListingSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(guestSectionTitle)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                    Text(guestSectionSubtitle)
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                }
                Spacer()
                Button {
                    Task { await store.loadGuestDiscovery(force: true) }
                } label: {
                    Image(systemName: store.isGuestDiscoveryLoading ? "hourglass" : "arrow.clockwise")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(OneTheme.amber)
                        .frame(width: 34, height: 34)
                        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .disabled(store.isGuestDiscoveryLoading)
            }

            let items = guestFilteredItems
            if store.isGuestDiscoveryLoading && items.isEmpty {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(.white.opacity(0.08))
                        .frame(height: 74)
                        .redacted(reason: .placeholder)
                }
            } else if items.isEmpty {
                guestEmptyState
            } else {
                ForEach(items.prefix(8)) { item in
                    Button {
                        selectedGuestItem = item
                    } label: {
                        guestListingRow(item)
                    }
                    .buttonStyle(.plain)
                }
            }

            if let guestError = store.guestDiscoveryError {
                Text(guestError)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(.top, 4)
            }
        }
    }

    private var guestEmptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "tray")
                .font(.title3)
                .foregroundStyle(OneTheme.amber)
            Text(store.localized("home.guest_empty_state_title", fallback: "No matching public listings"))
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
            Text(store.localized("home.guest_empty_state_body", fallback: "Try a different search or refresh public listings."))
                .font(.caption)
                .foregroundStyle(OneTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(OneTheme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(OneTheme.border, lineWidth: 1)
        )
    }

    private var guestAuthBar: some View {
        HStack(spacing: 10) {
            NavigationLink(store.localized("auth.create_account", fallback: "Create Account")) { SignupView() }
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(
                    LinearGradient(
                        colors: [OneTheme.amber, OneTheme.amberDark],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                )
            NavigationLink(store.localized("auth.sign_in", fallback: "Sign In")) { LoginView() }
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(OneTheme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(OneTheme.border, lineWidth: 1)
                )
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(OneTheme.deepNavy.opacity(0.98).ignoresSafeArea())
    }

    private var guestSectionTitle: String {
        switch guestExploreSection {
        case 0: return store.localized("home.guest_section_open_jobs", fallback: "Open Jobs")
        case 1: return store.localized("home.guest_section_available_helpers", fallback: "Available Helpers")
        default: return store.localized("home.guest_section_tool_rentals", fallback: "Tool Rentals")
        }
    }

    private var guestSectionSubtitle: String {
        switch guestExploreSection {
        case 0: return store.localized("home.guest_section_open_jobs_subtitle", fallback: "See live customer needs before joining as a helper.")
        case 1: return store.localized("home.guest_section_available_helpers_subtitle", fallback: "Find local service providers and compare trust signals.")
        default: return store.localized("home.guest_section_tool_rentals_subtitle", fallback: "Browse nearby tools before reserving.")
        }
    }

    private var guestFilteredItems: [GuestPreviewItem] {
        let source: [GuestPreviewItem]
        switch guestExploreSection {
        case 0:
            source = store.customerJobs.map {
                GuestPreviewItem(
                    id: "job-\($0.id.uuidString)",
                    title: $0.title,
                    subtitle: "\($0.category) · \($0.locationQuery.isEmpty ? store.localized(\"home.location_local_area\", fallback: \"Local area\") : $0.locationQuery)",
                    detail: $0.details.isEmpty ? store.localized("guest.item_detail_job_prompt", fallback: "Sign in to message, bid, or manage this job.") : $0.details,
                    icon: "hammer.fill",
                    accessory: $0.status.rawValue.replacingOccurrences(of: "_", with: " ").capitalized,
                    actionTitle: store.localized("guest.action_view_job", fallback: "Sign in to view job")
                )
            }
        case 1:
            source = store.serviceHelpers.map {
                GuestPreviewItem(
                    id: "helper-\($0.id.uuidString)",
                    title: $0.name,
                    subtitle: "\($0.specialty) · \($0.city)",
                    detail: "\(store.localized(\"home.rating_label\", fallback: \"Rating\")) \(String(format: \"%.1f\", $0.rating)) \(store.localized(\"home.rating_stars\", fallback: \"stars.\")) \(store.localized(\"home.rate_prefix\", fallback: \"Starting around\")) $\(Int($0.hourlyRate))/hour.",
                    icon: "person.crop.circle.badge.checkmark",
                    accessory: "\(String(format: "%.1f", $0.rating))★",
                    actionTitle: store.localized("guest.action_book", fallback: "Sign in to book")
                )
            }
        default:
            source = store.rentalTools.map {
                GuestPreviewItem(
                    id: "tool-\($0.id.uuidString)",
                    title: $0.title,
                    subtitle: "\($0.ownerName) · \($0.city)",
                    detail: $0.terms.isEmpty ? store.localized("guest.action_reserve_prompt", fallback: "Sign in to reserve, coordinate pickup, and protect your deposit.") : $0.terms,
                    icon: "wrench.and.screwdriver.fill",
                    accessory: "$\(Int($0.dailyRate))/day",
                    actionTitle: store.localized("guest.action_reserve", fallback: "Sign in to reserve")
                )
            }
        }
        let query = guestSearchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return source }
        return source.filter {
            $0.title.lowercased().contains(query)
            || $0.subtitle.lowercased().contains(query)
            || $0.detail.lowercased().contains(query)
        }
    }

    private func guestListingRow(_ item: GuestPreviewItem) -> some View {
        HStack(spacing: 12) {
            Image(systemName: item.icon)
                .font(.headline.weight(.bold))
                .foregroundStyle(OneTheme.amber)
                .frame(width: 38, height: 38)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(item.subtitle)
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            Text(item.accessory)
                .font(.caption2.weight(.bold))
                .foregroundStyle(OneTheme.amber)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(OneTheme.amber.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .padding(12)
        .background(OneTheme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(OneTheme.border, lineWidth: 1)
        )
    }

    private func authPill(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .foregroundStyle(.white)
            .background(
                Capsule()
                    .fill(.white.opacity(0.16))
            )
    }

    private func featureRow(icon: String, title: String, subtitle: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(OneTheme.amber)
                .frame(width: 20, height: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.7))
            }
            Spacer()
        }
    }

    private func guestLine(title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(OneTheme.muted)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.white.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(.white.opacity(0.09), lineWidth: 1)
                )
        )
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
                Section(store.localized("onboarding.welcome", fallback: "Welcome")) {
                    Text(store.localized("onboarding.welcome_description", fallback: "Set up your first persona and pulse pillars. Pulse is never zero on first launch."))
                }

                Section(store.localized("auth.primary_persona", fallback: "Primary Persona")) {
                    Picker("Start as", selection: Binding(
                        get: { store.onboardingState.selectedPrimaryPersona },
                        set: { store.onboardingState.selectedPrimaryPersona = $0 }
                    )) {
                        ForEach(store.personaOptions) { persona in
                            Text(persona.label).tag(persona)
                        }
                    }
                }

                Section(store.localized("onboarding.pulse_pillars", fallback: "Pulse Pillars")) {
                    Toggle(store.localized("onboarding.pillar_money", fallback: "Money"), isOn: Binding(get: { store.onboardingState.hasMoney }, set: { store.onboardingState.hasMoney = $0 }))
                    Toggle(store.localized("onboarding.pillar_home_care", fallback: "Home Care"), isOn: Binding(get: { store.onboardingState.hasHomeCare }, set: { store.onboardingState.hasHomeCare = $0 }))
                    Toggle(store.localized("onboarding.pillar_car_care", fallback: "Car Care"), isOn: Binding(get: { store.onboardingState.hasCarCare }, set: { store.onboardingState.hasCarCare = $0 }))
                    Toggle(store.localized("onboarding.pillar_personal_care", fallback: "Personal Care"), isOn: Binding(get: { store.onboardingState.hasPersonalCare }, set: { store.onboardingState.hasPersonalCare = $0 }))
                    Toggle(store.localized("onboarding.pillar_goals", fallback: "Goals"), isOn: Binding(get: { store.onboardingState.hasGoals }, set: { store.onboardingState.hasGoals = $0 }))
                    Toggle(store.localized("onboarding.pillar_planned_needs", fallback: "Planned Needs"), isOn: Binding(get: { store.onboardingState.hasPlannedNeeds }, set: { store.onboardingState.hasPlannedNeeds = $0 }))
                }

                Section {
                    Button(store.localized("onboarding.finish_setup", fallback: "Finish Setup")) {
                        store.completeOnboarding()
                    }
                    .buttonStyle(GoAccentButtonStyle())
                }
            }
            .navigationTitle(store.localized("onboarding.get_started", fallback: "Get Started"))
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

private struct GuestPreviewItem: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let detail: String
    let icon: String
    let accessory: String
    let actionTitle: String
}

private struct GuestListingDetailSheet: View {
    let item: GuestPreviewItem
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: item.icon)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(OneTheme.amber)
                        .frame(width: 50, height: 50)
                        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.title)
                            .font(.title3.weight(.bold))
                            .foregroundStyle(.white)
                        Text(item.subtitle)
                            .font(.subheadline)
                            .foregroundStyle(OneTheme.muted)
                    }
                    Spacer()
                    Text(item.accessory)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(OneTheme.amber)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(OneTheme.amber.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }

                Text(item.detail)
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.86))
                    .fixedSize(horizontal: false, vertical: true)

                Spacer()

                NavigationLink(item.actionTitle) { LoginView() }
                    .buttonStyle(GoAccentButtonStyle())
                NavigationLink(store.localized("auth.create_account", fallback: "Create Account")) { SignupView() }
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(OneTheme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(OneTheme.border, lineWidth: 1)
                    )
            }
            .padding(18)
            .background(OneTheme.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.localized("common.done", fallback: "Done")) {
                        dismiss()
                    }
                    .foregroundStyle(OneTheme.amber)
                }
            }
        }
    }
}

private struct LoginView: View {
    @Environment(OneStore.self) private var store

    private var canSubmit: Bool {
        let email = store.authEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = store.authPassword.trimmingCharacters(in: .whitespacesAndNewlines)
        let agreementName = store.authAgreementName.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasTwoNameParts = agreementName.split(separator: " ").count >= 2
        return !email.isEmpty && !password.isEmpty && store.authAcceptedTerms && hasTwoNameParts
    }

    var body: some View {
        @Bindable var store = store
        Form {
            Section(store.localized("auth.welcome_back", fallback: "Welcome Back")) {
                TextField(store.localized("auth.email", fallback: "Email"), text: $store.authEmail)
                    .textContentType(.username)
                SecureField(store.localized("auth.password", fallback: "Password"), text: $store.authPassword)
                    .textContentType(.password)
                TextField(store.localized("auth.full_legal_name", fallback: "Full legal name"), text: $store.authAgreementName)
                    .textContentType(.name)
                Toggle(store.localized("auth.accept_terms", fallback: "I agree to Terms of Service and Privacy Policy"), isOn: $store.authAcceptedTerms)
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
                TextField(store.localized("auth.first_name", fallback: "First name"), text: $store.authFirstName)
                    .textContentType(.givenName)
                TextField(store.localized("auth.last_name", fallback: "Last name"), text: $store.authLastName)
                    .textContentType(.familyName)
                TextField(store.localized("auth.email", fallback: "Email"), text: $store.authEmail)
                    .textContentType(.username)
                SecureField(store.localized("auth.password", fallback: "Password"), text: $store.authPassword)
                    .textContentType(.newPassword)
            }

            Section(store.localized("auth.primary_persona", fallback: "Primary Persona")) {
                Picker(store.localized("auth.persona", fallback: "Persona"), selection: $store.onboardingState.selectedPrimaryPersona) {
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
