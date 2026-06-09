import SwiftUI
import CoreLocation

// MARK: - Location provider

private final class LocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    @Published var coordinate: CLLocationCoordinate2D?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func requestOnce() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        coordinate = locations.last?.coordinate
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Location unavailable — discover will work without geo-filtering
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse ||
           manager.authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        }
    }
}

// MARK: - GrowthTabView

struct GrowthTabView: View {
    @EnvironmentObject private var learn: LearnStore
    @EnvironmentObject private var life: LifeStore
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager

    @StateObject private var location = LocationProvider()

    @State private var popular: [APIDiscoverItem]       = []
    @State private var programs: [APIGrowthProgram]     = []
    @State private var wholesale: [APIWholesaleListing] = []

    @State private var isLoadingPopular   = false
    @State private var isLoadingPrograms  = false
    @State private var isLoadingWholesale = false
    @State private var loadError          = false   // full-screen offline banner

    // Section-level errors — shown inline when only one section fails
    @State private var popularError   = false
    @State private var programsError  = false
    @State private var wholesaleError = false

    // Sheet toggles
    @State private var showWholesaleAll     = false
    @State private var showOpportunitiesAll = false
    @State private var showProgramsAll      = false
    @State private var showConsultingIntake = false
    @State private var showFinancing        = false
    @State private var safariURL: URL?

    // Joined listings — persisted across launches
    @State private var joinedListings: Set<Int> = Set(
        UserDefaults.standard.array(forKey: "ox.growth.joinedListings") as? [Int] ?? []
    )
    @State private var joinFailed = false

    var body: some View {
        Group {
            if auth.user == nil {
                guestWall
            } else {
                mainContent
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .onAppear { location.requestOnce() }
        // `CLLocationCoordinate2D` is not `Equatable`, so observe an `Equatable` proxy value instead.
        .onChange(of: location.coordinate.map { [$0.latitude, $0.longitude] }) { _, coord in
            if coord != nil && popular.isEmpty {
                Task { await loadPopular() }
            }
        }
        .task {
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await loadPopular() }
                group.addTask { await loadPrograms() }
                group.addTask { await loadWholesale() }
                group.addTask { await learn.refresh() }
                group.addTask { await life.refresh(window: "1m") }
            }
        }
        .sheet(isPresented: $showWholesaleAll) {
            WholesaleListSheet(listings: wholesale, joined: $joinedListings, onJoin: joinListing)
        }
        .sheet(isPresented: $showOpportunitiesAll) {
            OpportunityListSheet(items: popular, onOpen: openItem)
        }
        .sheet(isPresented: $showProgramsAll) {
            ProgramListSheet(programs: programs, onTap: handleProgramTap)
        }
        .sheet(isPresented: $showConsultingIntake) {
            BusinessConsultingIntakeView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showFinancing) {
            FinancingApplicationView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(item: $safariURL) { url in
            InAppBrowserView(url: url)
                .ignoresSafeArea()
        }
        .alert(LocalizedStringKey(L10n.GrowthKey.joinErrorTitle), isPresented: $joinFailed) {
            Button("common.ok", role: .cancel) { }
        } message: {
            Text(LocalizedStringKey(L10n.GrowthKey.joinErrorMessage))
        }
    }

    // MARK: - Main content

    private var mainContent: some View {
        ScrollView {
            VStack(spacing: 18) {
                header
                ladderCard

                if loadError {
                    errorBanner
                } else {
                    opportunitiesSection
                    programsSection
                    financingSection
                    wholesaleSection
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .refreshable {
            loadError = false
            popularError = false
            programsError = false
            wholesaleError = false
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await loadPopular() }
                group.addTask { await loadPrograms() }
                group.addTask { await loadWholesale() }
                group.addTask { await learn.refresh() }
                group.addTask { await life.refresh(window: "1m") }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(localization.localized(L10n.GrowthKey.eyebrow)).sectionTitle()
                Text(localization.localized(L10n.GrowthKey.title))
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
            }
            Spacer()
        }
    }

    // MARK: - Guest wall

    private var guestWall: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "arrow.up.right.circle.fill")
                .font(.system(size: 56, weight: .light))
                .foregroundStyle(Theme.accent)
            VStack(spacing: 8) {
                Text("growth.unlock_growth")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text(LocalizedStringKey(L10n.GrowthKey.guestSignInSubtitle))
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            VStack(spacing: 12) {
                Button {
                    NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "home"])
                } label: {
                    Text("growth.sign_in_to_continue")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }

                Button {
                    showConsultingIntake = true
                } label: {
                    VStack(spacing: 4) {
                        Text("growth.business_launch_program")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Theme.accent)
                            Text("growth.fill_intake_prompt")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.accent.opacity(0.25), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 40)
            Spacer()
        }
    }

    // MARK: - Error banner

    private var errorBanner: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(Theme.textSecondary)
            Text(LocalizedStringKey(L10n.GrowthKey.loadingErrorTitle))
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
            Button {
                loadError = false
                Task {
                    await withTaskGroup(of: Void.self) { group in
                        group.addTask { await loadPopular() }
                        group.addTask { await loadPrograms() }
                        group.addTask { await loadWholesale() }
                    }
                }
            } label: {
                Text(LocalizedStringKey(L10n.GrowthKey.loadingRetry))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 24).padding(.vertical, 10)
                    .background(Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .cardStyle()
    }

    // MARK: - Section error helper

    @ViewBuilder
    private func sectionErrorView(_ retry: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 13))
                .foregroundStyle(Theme.warning)
            Text(LocalizedStringKey(L10n.GrowthKey.noSectionLoad))
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Button("common.retry", action: retry)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.accent)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Theme.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Ladder

    private var ladderCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(localization.localized(L10n.SectionKey.yourLadder))
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            VStack(spacing: 10) {
                ForEach(growthLadder) { step in
                    GrowthRow(step: step)
                }
            }
        }
        .cardStyle()
    }

    private var growthLadder: [GrowthStep] {
        switch auth.activePersona {
        case .customer:
            let planned    = life.summary?.planned_needs?.active_count ?? 0
            let posted     = life.summary?.activity?.active_jobs_posted ?? 0
            let hasPulse   = life.pulse?.no_data != true

            return [
                GrowthStep(stage: "Step 1", title: localization.localized(L10n.GrowthKey.stepOneTitle),
                           description: localization.localized(L10n.GrowthKey.stepOneDescription),
                           progress: hasPulse ? 1.0 : 0.0, isActive: !hasPulse,
                           tapTab: "life"),
                GrowthStep(stage: "Step 2", title: localization.localized(L10n.GrowthKey.stepTwoTitle),
                           description: localization.localized(L10n.GrowthKey.stepTwoDescription),
                           progress: min(Double(planned) / 3.0, 1.0),
                           isActive: hasPulse && planned < 3,
                           tapTab: "life"),
                GrowthStep(stage: "Step 3", title: localization.localized(L10n.GrowthKey.stepThreeTitle),
                           description: localization.localized(L10n.GrowthKey.stepThreeDescription),
                           progress: min(Double(posted) / 2.0, 1.0),
                           isActive: planned >= 3 && posted < 2,
                           tapTab: "home"),
                GrowthStep(stage: "Step 4", title: localization.localized(L10n.GrowthKey.stepFourTitle),
                           description: localization.localized(L10n.GrowthKey.stepFourDescription),
                           progress: 0.0, isActive: posted >= 2,
                           tapTab: "learn"),
            ]

        default:
            let guides   = learn.completions.count
            let jobsDone = life.summary?.activity?.jobs_completed ?? 0
            let badges   = learn.badges.count

            return [
                GrowthStep(stage: "Step 1", title: localization.localized(L10n.GrowthKey.stepOneTitle),
                           description: localization.localized(L10n.GrowthKey.stepOneDescription),
                           progress: guides > 0 ? 1.0 : 0.0, isActive: guides == 0,
                           tapTab: "learn"),
                GrowthStep(stage: "Step 2", title: localization.localized(L10n.GrowthKey.stepTwoTitle),
                           description: localization.localized(L10n.GrowthKey.stepTwoDescription),
                           progress: min(Double(jobsDone) / 5.0, 1.0),
                           isActive: guides > 0 && jobsDone < 5,
                           tapTab: "home"),
                GrowthStep(stage: "Step 3", title: localization.localized(L10n.GrowthKey.stepThreeTitle),
                           description: localization.localized(L10n.GrowthKey.stepThreeDescription),
                           progress: min(Double(badges) / 3.0, 1.0),
                           isActive: jobsDone >= 5 && badges < 3,
                           tapTab: "learn"),
                GrowthStep(stage: "Step 4", title: localization.localized(L10n.GrowthKey.stepFourTitle),
                           description: localization.localized(L10n.GrowthKey.stepFourDescription),
                           progress: 0.0, isActive: badges >= 3,
                           tapTab: nil),
            ]
        }
    }

    // MARK: - Opportunities

    private var opportunitiesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: L10n.GrowthKey.sectionOpportunities,
                          actionLabel: visiblePopular.count > 6 ? L10n.CommonKey.seeAll : nil,
                          action: visiblePopular.count > 6 ? { showOpportunitiesAll = true } : nil)
            if isLoadingPopular {
                ProgressView().tint(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 10)
            } else if popularError && visiblePopular.isEmpty {
                sectionErrorView { Task { await loadPopular() } }
            } else if visiblePopular.isEmpty {
                Text(LocalizedStringKey(L10n.GrowthKey.noOpportunities))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
            } else {
                VStack(spacing: 10) {
                    ForEach(visiblePopular.prefix(6)) { item in
                        OpportunityRow(item: item, onOpen: { openItem(item) })
                    }
                }
            }
        }
    }

    private var visiblePopular: [APIDiscoverItem] {
        let persona = auth.activePersona
        let allowed: Set<String> = {
            switch persona {
            case .customer:  return ["helper", "business", "tool"]
            case .helper:    return ["job", "tool", "business"]
            case .business:  return ["business", "tool", "job"]
            case .investor:  return ["business", "tool"]
            default:         return ["job", "helper", "tool", "business"]
            }
        }()
        let filtered = popular.filter { allowed.contains($0.type) }
        return filtered.isEmpty ? popular : filtered
    }

    private func openItem(_ item: APIDiscoverItem) {
        guard let raw = item.url?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return }
        if let url = URL(string: raw), url.scheme != nil {
            safariURL = url
            return
        }
        if let url = URL(string: raw, relativeTo: AuthAPIConfig.baseURL)?.absoluteURL {
            safariURL = url
        }
    }

    // MARK: - Programs

    private var programsSection: some View {
        VStack(spacing: 10) {
            SectionHeader(title: L10n.SectionKey.programsForYou,
                          actionLabel: programs.count > 3 ? L10n.CommonKey.seeAll : nil,
                          action: programs.count > 3 ? { showProgramsAll = true } : nil)
            if isLoadingPrograms {
                ProgressView().tint(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 10)
            } else if programsError && programs.isEmpty {
                sectionErrorView { Task { await loadPrograms() } }
            } else if programs.isEmpty {
                EmptyStateCard(icon: "checkmark.seal",
                               title: "No programs yet",
                               message: "Programs matched to your profile will appear here.",
                               cta: "")
            } else {
                let visible = Array(programs.prefix(3))
                FeaturedProgramCard(program: visible[0], onTap: { handleProgramTap(visible[0]) })
                ForEach(visible.dropFirst()) { program in
                    ProgramCard(program: program, onTap: { handleProgramTap(program) })
                }
            }
        }
    }

    private func handleProgramTap(_ program: APIGrowthProgram) {
        let type = program.ctaType ?? "external"
        switch type {
        case "tab_learn":  NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "learn"])
        case "tab_life":   NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "life"])
        case "tab_home":   NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "home"])
        case "tab_growth": break  // already here
        case "consulting_intake": showConsultingIntake = true
        default:
            if let urlStr = program.ctaUrl, let url = URL(string: urlStr) {
                safariURL = url
            }
        }
    }

    // MARK: - Financing

    private var financingSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: L10n.GrowthKey.sectionFinancing, actionLabel: nil)
            Button { showFinancing = true } label: {
                HStack(spacing: 14) {
                    Image(systemName: "dollarsign.circle.fill")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(Theme.pillarMoney)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("growth.pre_qualify")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                        Text(LocalizedStringKey(L10n.GrowthKey.financingDescription))
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(3)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.textTertiary)
                }
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(LinearGradient(colors: [Theme.surface, Theme.pillarMoney.opacity(0.12)],
                                             startPoint: .leading, endPoint: .trailing))
                )
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.pillarMoney.opacity(0.35), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Wholesale

    private var wholesaleSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: L10n.SectionKey.communityWholesale,
                          actionLabel: wholesale.count > 3 ? L10n.CommonKey.seeAll : nil,
                          action: wholesale.count > 3 ? { showWholesaleAll = true } : nil)
            if isLoadingWholesale {
                ProgressView().tint(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 10)
            } else if wholesaleError && wholesale.isEmpty {
                sectionErrorView { Task { await loadWholesale() } }
            } else if wholesale.isEmpty {
                Text(LocalizedStringKey(L10n.GrowthKey.noWholesale))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.vertical, 4)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(wholesale.prefix(5)) { listing in
                            WholesaleCard(
                                listing: listing,
                                isJoined: joinedListings.contains(listing.id),
                                onTap: {
                                    if let urlStr = listing.externalUrl, let url = URL(string: urlStr) {
                                        safariURL = url
                                    }
                                },
                                onJoin: { Task { await joinListing(listing) } }
                            )
                            .frame(width: 180)
                        }
                    }
                    .padding(.horizontal, 1)  // avoid card shadow clipping
                }
            }
        }
    }

    // MARK: - Data loading

    private func loadPopular() async {
        guard !isLoadingPopular else { return }
        isLoadingPopular = true
        popularError = false
        defer { isLoadingPopular = false }
        do {
            let coord = location.coordinate
            let resp = try await DiscoverService.popular(
                lat: coord?.latitude,
                lng: coord?.longitude
            )
            popular = resp.results
        } catch {
            if case APIError.offline = error, popular.isEmpty, programs.isEmpty, wholesale.isEmpty {
                loadError = true
            } else if popular.isEmpty {
                popularError = true
            }
            OXLog.error("popular load failed: \(String(describing: error))", category: "growth")
        }
    }

    private func loadPrograms() async {
        guard !isLoadingPrograms else { return }
        isLoadingPrograms = true
        programsError = false
        defer { isLoadingPrograms = false }
        do {
            let persona = auth.activePersona.rawValue
            let fetched = try await GrowthService.programs(persona: persona)
            programs = fetched.isEmpty ? seedPrograms() : fetched
        } catch {
            if case APIError.offline = error, popular.isEmpty, programs.isEmpty, wholesale.isEmpty {
                loadError = true
            }
            if programs.isEmpty {
                programs = seedPrograms()
            }
            OXLog.error("programs load failed: \(String(describing: error))", category: "growth")
        }
    }

    private func seedPrograms() -> [APIGrowthProgram] {
        [
            APIGrowthProgram(
                id: -1,
                title: localization.localized(L10n.GrowthKey.seedBusinessConsultingTitle),
                subtitle: localization.localized(L10n.GrowthKey.seedBusinessConsultingSubtitle),
                iconName: "briefcase.fill",
                colorKey: "money",
                ctaLabel: localization.localized(L10n.GrowthKey.seedBusinessConsultingCta),
                ctaUrl: nil,
                ctaType: "consulting_intake",
                personaFilter: nil,
                sortOrder: 0
            ),
            APIGrowthProgram(
                id: -2,
                title: localization.localized(L10n.GrowthKey.seedWholesaleTitle),
                subtitle: localization.localized(L10n.GrowthKey.seedWholesaleSubtitle),
                iconName: "cart.fill.badge.plus",
                colorKey: "sinking",
                ctaLabel: localization.localized(L10n.GrowthKey.seedWholesaleCta),
                ctaUrl: nil,
                ctaType: "tab_growth",
                personaFilter: nil,
                sortOrder: 1
            ),
        ]
    }

    private func loadWholesale() async {
        guard !isLoadingWholesale else { return }
        isLoadingWholesale = true
        wholesaleError = false
        defer { isLoadingWholesale = false }
        do {
            wholesale = try await GrowthService.wholesale()
        } catch {
            if case APIError.offline = error, popular.isEmpty, programs.isEmpty, wholesale.isEmpty {
                loadError = true
            } else if wholesale.isEmpty {
                wholesaleError = true
            }
            OXLog.error("wholesale load failed: \(String(describing: error))", category: "growth")
        }
    }

    private func joinListing(_ listing: APIWholesaleListing) async {
        guard auth.user != nil else { return }
        do {
            try await GrowthService.joinWholesale(listingId: listing.id)
            joinedListings.insert(listing.id)
            UserDefaults.standard.set(Array(joinedListings), forKey: "ox.growth.joinedListings")
            // Refresh wholesale to get updated joined_count
            if let updated = try? await GrowthService.wholesale() {
                wholesale = updated
            }
        } catch {
            joinFailed = true
        }
    }
}

// MARK: - GrowthRow

private struct GrowthRow: View {
    let step: GrowthStep

    var body: some View {
        Button(action: tapAction) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle()
                        .fill(step.isActive ? Theme.accent : Theme.surfaceElevated)
                        .frame(width: 28, height: 28)
                    if step.progress >= 1 {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                    } else {
                        Text(String(step.stage.last ?? "1"))
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(step.isActive ? .white : Theme.textSecondary)
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(step.title)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        if step.tapTab != nil && step.progress < 1 {
                            Image(systemName: "arrow.right")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(step.isActive ? Theme.accent : Theme.textTertiary)
                        }
                    }
                    Text(step.description)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                    ProgressView(value: step.progress)
                        .tint(step.isActive ? Theme.accent : Theme.success.opacity(0.6))
                        .padding(.top, 2)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(step.tapTab == nil || step.progress >= 1)
    }

    private func tapAction() {
        guard let tab = step.tapTab, step.progress < 1 else { return }
        NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": tab])
    }
}

// MARK: - OpportunityRow

private struct OpportunityRow: View {
    let item: APIDiscoverItem
    let onOpen: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Icon with verified badge overlay
            ZStack(alignment: .bottomTrailing) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(color)
                    .frame(width: 44, height: 44)
                    .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
                if item.verified == true || item.backgroundChecked == true {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.success)
                        .background(Theme.background, in: Circle())
                        .offset(x: 4, y: 4)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if let sub = item.subtitle, !sub.isEmpty {
                    Text(sub)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                // Rating + freshness badges
                HStack(spacing: 6) {
                    if let rating = item.rating {
                        HStack(spacing: 2) {
                            Image(systemName: "star.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(Theme.warning)
                            Text(String(format: "%.1f", rating))
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                            if let count = item.reviewCount, count > 0 {
                                Text("(\(count))")
                                    .font(.system(size: 10))
                                    .foregroundStyle(Theme.textTertiary)
                            }
                        }
                    }
                    if let days = item.freshnessDays, days <= 3 {
                        Text("New")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Theme.success)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Theme.success.opacity(0.15), in: Capsule())
                    }
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                if let d = item.distanceMiles {
                    Text(String(format: "%.1f mi", d))
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.textTertiary)
                }
                if item.url != nil {
                    Button(action: onOpen) {
                        HStack(spacing: 4) {
                            Text(item.primaryAction ?? "Open")
                            Image(systemName: "arrow.right")
                        }
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.accent)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .cardStyle(padding: 12)
    }

    private var icon: String {
        switch item.type {
        case "job":      return "hammer.fill"
        case "helper":   return "person.crop.circle.badge.checkmark"
        case "tool":     return "wrench.and.screwdriver.fill"
        case "business": return "building.2.fill"
        default:         return "sparkles"
        }
    }

    private var color: Color {
        switch item.type {
        case "job":      return Theme.accent
        case "helper":   return Theme.success
        case "tool":     return Theme.pillarHome
        case "business": return Theme.pillarGoals
        default:         return Theme.textSecondary
        }
    }
}

// MARK: - FeaturedProgramCard

private struct FeaturedProgramCard: View {
    let program: APIGrowthProgram
    let onTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                Image(systemName: program.iconName ?? "star.fill")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(themeColor)
                    .frame(width: 56, height: 56)
                    .background(themeColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 16))
                Spacer()
                Text("Program")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(0.6)
                    .foregroundStyle(themeColor)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(themeColor.opacity(0.13), in: Capsule())
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(program.title)
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                if let sub = program.subtitle {
                    Text(sub)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Button(action: onTap) {
                Text(program.ctaLabel ?? "Get started")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(themeColor, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 18)
                .fill(LinearGradient(
                    colors: [Theme.surface, themeColor.opacity(0.09)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ))
        )
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(themeColor.opacity(0.28), lineWidth: 1))
    }

    private var themeColor: Color {
        switch program.colorKey {
        case "money":    return Theme.pillarMoney
        case "home":     return Theme.pillarHome
        case "car":      return Theme.pillarCar
        case "personal": return Theme.pillarPersonal
        case "goals":    return Theme.pillarGoals
        case "sinking":  return Theme.pillarSinking
        case "success":  return Theme.success
        case "warning":  return Theme.warning
        case "danger":   return Theme.danger
        default:         return Theme.accent
        }
    }
}

// MARK: - ProgramCard

private struct ProgramCard: View {
    let program: APIGrowthProgram
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Image(systemName: program.iconName ?? "checkmark.seal.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(themeColor)
                    .frame(width: 40, height: 40)
                    .background(themeColor.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 3) {
                    Text(program.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    if let sub = program.subtitle {
                        Text(sub)
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                Spacer()
                Text(program.ctaLabel ?? NSLocalizedString(L10n.GrowthKey.programOpen, comment: ""))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(themeColor, in: Capsule())
            }
            .cardStyle(padding: 12)
        }
        .buttonStyle(.plain)
    }

    private var themeColor: Color {
        switch program.colorKey {
        case "money":    return Theme.pillarMoney
        case "home":     return Theme.pillarHome
        case "car":      return Theme.pillarCar
        case "personal": return Theme.pillarPersonal
        case "goals":    return Theme.pillarGoals
        case "sinking":  return Theme.pillarSinking
        case "success":  return Theme.success
        case "warning":  return Theme.warning
        case "danger":   return Theme.danger
        default:         return Theme.accent
        }
    }
}

// MARK: - WholesaleCard

private struct WholesaleCard: View {
    let listing: APIWholesaleListing
    let isJoined: Bool
    let onTap: () -> Void
    let onJoin: () -> Void
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: listing.iconName ?? "shippingbox.fill")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.pillarSinking)
            Text(listing.title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(2)
            if let pct = listing.savePercent {
                HStack(spacing: 6) {
                    Text(localization.format(L10n.GrowthKey.savePrefix, Int(pct)))
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.success)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Theme.success.opacity(0.16), in: Capsule())
                    Spacer()
                }
            }
            if let joined = listing.joinedCount {
                Text(localization.format(L10n.GrowthKey.joinedPrefix, joined))
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.textTertiary)
            }
            Spacer()
            // Inner join button takes hit priority; outer .onTapGesture handles card tap
            Button(action: onJoin) {
                Text(isJoined ? LocalizedStringKey(L10n.GrowthKey.joinedGroupLabel) : LocalizedStringKey(L10n.GrowthKey.joinGroupLabelCta))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(isJoined ? Theme.success : .white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(
                        isJoined ? Theme.success.opacity(0.15) : Theme.accent,
                        in: RoundedRectangle(cornerRadius: 10)
                    )
            }
            .buttonStyle(.plain)
            .disabled(isJoined)
        }
        .frame(maxWidth: .infinity, minHeight: 160, alignment: .topLeading)
        .cardStyle(padding: 14)
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
    }
}

// MARK: - OpportunityListSheet

private struct OpportunityListSheet: View {
    let items: [APIDiscoverItem]
    let onOpen: (APIDiscoverItem) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(items) { item in
                        OpportunityRow(item: item, onOpen: { onOpen(item) })
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(LocalizedStringKey(L10n.GrowthKey.sectionOpportunities))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.done") { dismiss() }
                        .foregroundStyle(Theme.accent)
                        .font(.system(size: 15, weight: .semibold))
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }
}

// MARK: - ProgramListSheet

private struct ProgramListSheet: View {
    let programs: [APIGrowthProgram]
    let onTap: (APIGrowthProgram) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(programs) { program in
                        ProgramCard(program: program, onTap: { onTap(program) })
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(LocalizedStringKey(L10n.GrowthKey.sectionPrograms))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.done") { dismiss() }
                        .foregroundStyle(Theme.accent)
                        .font(.system(size: 15, weight: .semibold))
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }
}

// MARK: - WholesaleListSheet

private struct WholesaleListSheet: View {
    let listings: [APIWholesaleListing]
    @Binding var joined: Set<Int>
    let onJoin: (APIWholesaleListing) async -> Void
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var localization: LocalizationManager
    @State private var safariURL: URL?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(listings) { listing in
                        HStack(spacing: 12) {
                            Image(systemName: listing.iconName ?? "shippingbox.fill")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(Theme.pillarSinking)
                                .frame(width: 44, height: 44)
                                .background(Theme.pillarSinking.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(listing.title)
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(Theme.textPrimary)
                                if let sub = listing.subtitle {
                                    Text(sub)
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.textSecondary)
                                        .lineLimit(2)
                                }
                                HStack(spacing: 8) {
                                    if let pct = listing.savePercent {
                                        Text(localization.format(L10n.GrowthKey.savePrefix, Int(pct)))
                                            .font(.system(size: 11, weight: .bold))
                                            .foregroundStyle(Theme.success)
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(Theme.success.opacity(0.15), in: Capsule())
                                    }
                                    if let n = listing.joinedCount {
                                        Text(localization.format(L10n.GrowthKey.joinedPrefix, n))
                                            .font(.system(size: 11))
                                            .foregroundStyle(Theme.textTertiary)
                                    }
                                }
                            }
                            Spacer()
                            VStack(spacing: 6) {
                                if let urlStr = listing.externalUrl, let url = URL(string: urlStr) {
                                    Button { safariURL = url } label: {
                                        Text("common.view")
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundStyle(Theme.accent)
                                    }
                                    .buttonStyle(.plain)
                                }
                                let isJoined = joined.contains(listing.id)
                                Button {
                                    Task { await onJoin(listing) }
                                } label: {
                                    Text(isJoined ? LocalizedStringKey(L10n.GrowthKey.joinedLabel) : LocalizedStringKey(L10n.GrowthKey.joinGroupLabelCta))
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundStyle(isJoined ? Theme.success : .white)
                                        .padding(.horizontal, 12).padding(.vertical, 6)
                                        .background(
                                            isJoined ? Theme.success.opacity(0.15) : Theme.accent,
                                            in: Capsule()
                                        )
                                }
                                .buttonStyle(.plain)
                                .disabled(isJoined)
                            }
                        }
                        .cardStyle(padding: 14)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(LocalizedStringKey(L10n.GrowthKey.sectionWholesale))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.done") { dismiss() }
                        .foregroundStyle(Theme.accent)
                        .font(.system(size: 15, weight: .semibold))
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
        .sheet(item: $safariURL) { url in
            InAppBrowserView(url: url)
                .ignoresSafeArea()
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }
}

// MARK: - Financing Pre-Qual Form

struct FinancingApplicationView: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss

    @State private var loanType = "equipment"
    @State private var amountNeeded = ""
    @State private var monthsInBusiness = ""
    @State private var annualRevenue = ""
    @State private var creditScore = "600–649"
    @State private var businessType = "sole_proprietor"
    @State private var isSubmitting = false
    @State private var submitted = false
    @State private var submittedApplication: APIGrowthFinancingApplication?
    @State private var error: String?

    private let loanTypes = [
        ("equipment", L10n.GrowthKey.financingLoanEquipment),
        ("working_capital", L10n.GrowthKey.financingLoanWorkingCapital),
        ("vehicle", L10n.GrowthKey.financingLoanVehicle),
        ("startup", L10n.GrowthKey.financingLoanStartup),
    ]
    private let creditBands = ["< 580", "580–599", "600–649", "650–699", "700–749", "750+"]
    private let bizTypes = [
        ("sole_proprietor", L10n.GrowthKey.financingBizSoleProprietor),
        ("llc", L10n.GrowthKey.financingBizLLC),
        ("s_corp", L10n.GrowthKey.financingBizSCorp),
        ("c_corp", L10n.GrowthKey.financingBizCCorp),
        ("partnership", L10n.GrowthKey.financingBizPartnership),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if submitted {
                        submittedView
                    } else {
                        formView
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(LocalizedStringKey(L10n.GrowthKey.financingTitle))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("common.cancel") { dismiss() }.foregroundStyle(Theme.textSecondary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if !submitted {
                        Button {
                            Task { await submitApplication() }
                        } label: {
                            if isSubmitting {
                                ProgressView().tint(Theme.accent)
                            } else {
                                    Text("common.submit")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(canSubmit ? Theme.accent : Theme.textTertiary)
                            }
                        }
                        .disabled(!canSubmit || isSubmitting)
                    }
                }
            }
        }
    }

    private var canSubmit: Bool {
        !amountNeeded.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        Double(amountNeeded) != nil
    }

    private var formView: some View {
        VStack(spacing: 14) {
            // Disclaimer
            HStack(spacing: 8) {
                Image(systemName: "lock.shield.fill").foregroundStyle(Theme.success)
                Text(LocalizedStringKey(L10n.GrowthKey.financingDisclaimer))
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            .padding(12)
            .background(Theme.success.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))

            // Loan type
            VStack(alignment: .leading, spacing: 6) {
                finLabel(L10n.GrowthKey.financingQuestionUse)
                VStack(spacing: 6) {
                    ForEach(loanTypes, id: \.0) { (id, label) in
                        Button { loanType = id } label: {
                            HStack {
                                Text(LocalizedStringKey(label)).font(.system(size: 14)).foregroundStyle(Theme.textPrimary)
                                Spacer()
                                if loanType == id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Theme.accent)
                                }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(loanType == id ? Theme.accent.opacity(0.1) : Theme.surfaceElevated,
                                        in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(
                                loanType == id ? Theme.accent.opacity(0.4) : Theme.stroke, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Amount
            VStack(alignment: .leading, spacing: 6) {
                finLabel(L10n.GrowthKey.financingAmountNeeded)
                TextField("e.g. 15000", text: $amountNeeded)
                    .keyboardType(.numberPad)
                    .finFieldStyle()
            }

            // Months in business
            VStack(alignment: .leading, spacing: 6) {
                finLabel(L10n.GrowthKey.financingMonthsInBusiness)
                TextField("e.g. 24", text: $monthsInBusiness)
                    .keyboardType(.numberPad)
                    .finFieldStyle()
            }

            // Annual revenue
            VStack(alignment: .leading, spacing: 6) {
                finLabel(L10n.GrowthKey.financingAnnualRevenue)
                TextField("e.g. 80000", text: $annualRevenue)
                    .keyboardType(.numberPad)
                    .finFieldStyle()
            }

            // Credit score — radio list (6 bands is too many for a segmented picker)
            VStack(alignment: .leading, spacing: 6) {
                finLabel(L10n.GrowthKey.financingCreditScore)
                VStack(spacing: 6) {
                    ForEach(creditBands, id: \.self) { band in
                        Button { creditScore = band } label: {
                            HStack {
                                Text(band).font(.system(size: 14)).foregroundStyle(Theme.textPrimary)
                                Spacer()
                                if creditScore == band {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Theme.accent)
                                }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(creditScore == band ? Theme.accent.opacity(0.1) : Theme.surfaceElevated,
                                        in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(
                                creditScore == band ? Theme.accent.opacity(0.4) : Theme.stroke, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Business type
            VStack(alignment: .leading, spacing: 6) {
                finLabel(L10n.GrowthKey.financingBusinessStructure)
                Picker(LocalizedStringKey(L10n.GrowthKey.financingBusinessType), selection: $businessType) {
                    ForEach(bizTypes, id: \.0) { (id, label) in
                        Text(LocalizedStringKey(label)).tag(id)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
                .finFieldStyle()
            }

            if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(Theme.danger)
            }

            Text(LocalizedStringKey(L10n.GrowthKey.financingTerms))
                .font(.system(size: 10))
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
        }
    }

    private var submittedView: some View {
        VStack(spacing: 20) {
            Spacer(minLength: 40)
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 56))
                .foregroundStyle(Theme.success)
            Text(LocalizedStringKey(L10n.GrowthKey.financingSubmittedTitle))
                .font(.system(size: 22, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            Text(LocalizedStringKey(L10n.GrowthKey.financingSubmittedCopy))
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            if let submittedApplication {
                VStack(spacing: 8) {
                    if let status = submittedApplication.status, !status.isEmpty {
                        Label(localization.localized(status.capitalized), systemImage: "doc.text.fill")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                    }
                    Text(localization.format(L10n.GrowthKey.financingReferenceFormat, submittedApplication.id))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(12)
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
            }
            Button { dismiss() } label: {
                Text("common.got_it")
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    private func submitApplication() async {
        isSubmitting = true
        defer { isSubmitting = false }
        error = nil

        let body = APIGrowthFinancingPreQualRequest(
            loan_type: loanType,
            amount_needed: Double(amountNeeded) ?? 0,
            months_in_business: Int(monthsInBusiness),
            annual_revenue: Double(annualRevenue),
            credit_score_band: creditScore,
            business_type: businessType
        )
        do {
            submittedApplication = try await GrowthService.submitFinancingPreQual(body)
            withAnimation { submitted = true }
        } catch let modErr as ContentModerator.Error {
            if case .blocked(let reason) = modErr { self.error = reason }
        } catch APIError.validation(let message, _) {
            self.error = message
        } catch {
            self.error = localization.localized(L10n.GrowthKey.financingErrorSubmit)
        }
    }

    private func finLabel(_ text: String) -> some View {
        Text(LocalizedStringKey(text))
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
    }
}

private extension View {
    func finFieldStyle() -> some View {
        self
            .font(.system(size: 14))
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 12).padding(.vertical, 12)
            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

