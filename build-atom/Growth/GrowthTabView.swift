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
    @Environment(\.openURL) private var openURL

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
    @State private var showGrants           = false

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
        .sheet(isPresented: $showGrants) {
            GrantsDirectoryView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .alert("Couldn't join", isPresented: $joinFailed) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("Something went wrong joining this deal. Please try again.")
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
                    grantsSection
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
                Text(L10n.GrowthKey.eyebrow).sectionTitle()
                Text(L10n.GrowthKey.title)
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
                Text("Unlock Growth")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text("Sign in to see opportunities near you, programs matched to your goals, and community wholesale deals.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            VStack(spacing: 12) {
                Button {
                    NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "home"])
                } label: {
                    Text("Sign In to Continue")
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
                        Text("Business Launch Program")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Theme.accent)
                        Text("Fill a short intake form (no account needed)")
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
            Text("Couldn't load Growth content.")
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
                Text("Retry")
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
            Text("Couldn't load.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Button("Retry", action: retry)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.accent)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Theme.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Ladder

    private var ladderCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L10n.SectionKey.yourLadder)
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
                GrowthStep(stage: "Step 1", title: "Build your baseline",
                           description: "Add expenses/income so your Life Pulse is real.",
                           progress: hasPulse ? 1.0 : 0.0, isActive: !hasPulse,
                           tapTab: "life"),
                GrowthStep(stage: "Step 2", title: "Plan ahead",
                           description: "Create 3 planned needs for the next 30 days.",
                           progress: min(Double(planned) / 3.0, 1.0),
                           isActive: hasPulse && planned < 3,
                           tapTab: "life"),
                GrowthStep(stage: "Step 3", title: "Get local help",
                           description: "Post your first jobs and compare bids.",
                           progress: min(Double(posted) / 2.0, 1.0),
                           isActive: planned >= 3 && posted < 2,
                           tapTab: "home"),
                GrowthStep(stage: "Step 4", title: "Lock in savings",
                           description: "Use Learn guides and trusted helpers to reduce recurring costs.",
                           progress: 0.0, isActive: posted >= 2,
                           tapTab: "learn"),
            ]

        default:
            let guides   = learn.completions.count
            let jobsDone = life.summary?.activity?.jobs_completed ?? 0
            let badges   = learn.badges.count

            return [
                GrowthStep(stage: "Step 1", title: "Build a skill",
                           description: "Complete your first guide in Learn.",
                           progress: guides > 0 ? 1.0 : 0.0, isActive: guides == 0,
                           tapTab: "learn"),
                GrowthStep(stage: "Step 2", title: "Side income",
                           description: "Complete 5 jobs and build rating momentum.",
                           progress: min(Double(jobsDone) / 5.0, 1.0),
                           isActive: guides > 0 && jobsDone < 5,
                           tapTab: "home"),
                GrowthStep(stage: "Step 3", title: "Professional credibility",
                           description: "Earn badges and unlock higher-trust work.",
                           progress: min(Double(badges) / 3.0, 1.0),
                           isActive: jobsDone >= 5 && badges < 3,
                           tapTab: "learn"),
                GrowthStep(stage: "Step 4", title: "Scale up",
                           description: "Use opportunities + tools to take on bigger projects.",
                           progress: 0.0, isActive: badges >= 3,
                           tapTab: nil),
            ]
        }
    }

    // MARK: - Opportunities

    private var opportunitiesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Opportunities",
                          actionLabel: visiblePopular.count > 6 ? "See all" : nil,
                          action: visiblePopular.count > 6 ? { showOpportunitiesAll = true } : nil)
            if isLoadingPopular {
                ProgressView().tint(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 10)
            } else if popularError && visiblePopular.isEmpty {
                sectionErrorView { Task { await loadPopular() } }
            } else if visiblePopular.isEmpty {
                Text("No nearby opportunities yet — check back soon.")
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
            openURL(url); return
        }
        if let url = URL(string: raw, relativeTo: AuthAPIConfig.baseURL)?.absoluteURL {
            openURL(url)
        }
    }

    // MARK: - Programs

    private var programsSection: some View {
        VStack(spacing: 10) {
            SectionHeader(title: L10n.SectionKey.programsForYou,
                          actionLabel: programs.count > 3 ? "See all" : nil,
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
                openURL(url)
            }
        }
    }

    // MARK: - Financing

    private var financingSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Financing", actionLabel: nil)
            Button { showFinancing = true } label: {
                HStack(spacing: 14) {
                    Image(systemName: "dollarsign.circle.fill")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(Theme.pillarMoney)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Pre-qualify in minutes")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                        Text("Check your eligibility for equipment loans, working capital, and tool financing — no hard credit pull.")
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

    // MARK: - Grants

    private var grantsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Grants & Subsidies", actionLabel: nil)
            Button { showGrants = true } label: {
                HStack(spacing: 14) {
                    Image(systemName: "gift.fill")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(Theme.pillarGoals)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Free money for skilled workers")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                        Text("Federal, state, and nonprofit grants for training, tools, and business startup matched to your trade.")
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
                        .fill(LinearGradient(colors: [Theme.surface, Theme.pillarGoals.opacity(0.12)],
                                             startPoint: .leading, endPoint: .trailing))
                )
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.pillarGoals.opacity(0.35), lineWidth: 1))
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
                Text("Community wholesale deals coming soon.")
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
                                        openURL(url)
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
            programs = fetched.isEmpty ? Self.seedPrograms() : fetched
        } catch {
            if case APIError.offline = error, popular.isEmpty, programs.isEmpty, wholesale.isEmpty {
                loadError = true
            }
            if programs.isEmpty {
                programs = Self.seedPrograms()
            }
            OXLog.error("programs load failed: \(String(describing: error))", category: "growth")
        }
    }

    private static func seedPrograms() -> [APIGrowthProgram] {
        [
            APIGrowthProgram(
                id: -1,
                title: "Business Consulting Intake",
                subtitle: "Turn your skill into a real business. Strategy, setup, branding, and launch — all done for you.",
                iconName: "briefcase.fill",
                colorKey: "money",
                ctaLabel: "Start your intake",
                ctaUrl: nil,
                ctaType: "consulting_intake",
                personaFilter: nil,
                sortOrder: 0
            ),
            APIGrowthProgram(
                id: -2,
                title: "Community Pool Purchasing",
                subtitle: "Join buying groups to access wholesale prices on materials, tools, and supplies.",
                iconName: "cart.fill.badge.plus",
                colorKey: "sinking",
                ctaLabel: "Browse pools",
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
                Text(program.ctaLabel ?? "Open")
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
                    Text(localization.format("Save %d%%", Int(pct)))
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.success)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Theme.success.opacity(0.16), in: Capsule())
                    Spacer()
                }
            }
            if let joined = listing.joinedCount {
                Text(localization.format("%d joined", joined))
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.textTertiary)
            }
            Spacer()
            // Inner join button takes hit priority; outer .onTapGesture handles card tap
            Button(action: onJoin) {
                Text(isJoined ? LocalizedStringKey("Joined ✓") : LocalizedStringKey("Join group"))
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
            .navigationTitle("Opportunities")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
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
            .navigationTitle("Programs for You")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
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
    @Environment(\.openURL) private var openURL

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
                                        Text("Save \(Int(pct))%")
                                            .font(.system(size: 11, weight: .bold))
                                            .foregroundStyle(Theme.success)
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(Theme.success.opacity(0.15), in: Capsule())
                                    }
                                    if let n = listing.joinedCount {
                                        Text("\(n) joined")
                                            .font(.system(size: 11))
                                            .foregroundStyle(Theme.textTertiary)
                                    }
                                }
                            }
                            Spacer()
                            VStack(spacing: 6) {
                                if let urlStr = listing.externalUrl, let url = URL(string: urlStr) {
                                    Button { openURL(url) } label: {
                                        Text("View")
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundStyle(Theme.accent)
                                    }
                                    .buttonStyle(.plain)
                                }
                                let isJoined = joined.contains(listing.id)
                                Button {
                                    Task { await onJoin(listing) }
                                } label: {
                                    Text(isJoined ? "Joined" : "Join")
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
            .navigationTitle("Community Wholesale")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
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

// MARK: - Financing Pre-Qual Form

struct FinancingApplicationView: View {
    @EnvironmentObject var auth: AuthStore
    @Environment(\.dismiss) private var dismiss

    @State private var loanType = "equipment"
    @State private var amountNeeded = ""
    @State private var monthsInBusiness = ""
    @State private var annualRevenue = ""
    @State private var creditScore = "600–649"
    @State private var businessType = "sole_proprietor"
    @State private var isSubmitting = false
    @State private var submitted = false
    @State private var error: String?

    private let loanTypes = [
        ("equipment", "Equipment / Tools"),
        ("working_capital", "Working Capital"),
        ("vehicle", "Vehicle / Fleet"),
        ("startup", "Business Startup"),
    ]
    private let creditBands = ["< 580", "580–599", "600–649", "650–699", "700–749", "750+"]
    private let bizTypes = [
        ("sole_proprietor", "Sole Proprietor"),
        ("llc", "LLC"),
        ("s_corp", "S-Corp"),
        ("c_corp", "C-Corp"),
        ("partnership", "Partnership"),
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
            .navigationTitle("Financing Pre-Qualification")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.textSecondary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if !submitted {
                        Button {
                            Task { await submitApplication() }
                        } label: {
                            if isSubmitting {
                                ProgressView().tint(Theme.accent)
                            } else {
                                Text("Submit")
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
                Text("No hard credit pull. Your information is used only to match you with suitable lenders.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            .padding(12)
            .background(Theme.success.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))

            // Loan type
            VStack(alignment: .leading, spacing: 6) {
                finLabel("What do you need financing for?")
                VStack(spacing: 6) {
                    ForEach(loanTypes, id: \.0) { (id, label) in
                        Button { loanType = id } label: {
                            HStack {
                                Text(label).font(.system(size: 14)).foregroundStyle(Theme.textPrimary)
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
                finLabel("Amount needed ($)")
                TextField("e.g. 15000", text: $amountNeeded)
                    .keyboardType(.numberPad)
                    .finFieldStyle()
            }

            // Months in business
            VStack(alignment: .leading, spacing: 6) {
                finLabel("Months in business")
                TextField("e.g. 24", text: $monthsInBusiness)
                    .keyboardType(.numberPad)
                    .finFieldStyle()
            }

            // Annual revenue
            VStack(alignment: .leading, spacing: 6) {
                finLabel("Estimated annual revenue ($)")
                TextField("e.g. 80000", text: $annualRevenue)
                    .keyboardType(.numberPad)
                    .finFieldStyle()
            }

            // Credit score — radio list (6 bands is too many for a segmented picker)
            VStack(alignment: .leading, spacing: 6) {
                finLabel("Estimated credit score")
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
                finLabel("Business structure")
                Picker("Business type", selection: $businessType) {
                    ForEach(bizTypes, id: \.0) { (id, label) in
                        Text(label).tag(id)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
                .finFieldStyle()
            }

            if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(Theme.danger)
            }

            Text("By submitting you agree that OxSteed may share your information with partner lenders to generate non-binding pre-qualification offers.")
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
            Text("Application Submitted")
                .font(.system(size: 22, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            Text("We'll match your profile with lenders and send pre-qualification offers within 1–2 business days.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button { dismiss() } label: {
                Text("Got it")
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

        struct Req: Encodable {
            let loan_type: String
            let amount_needed: Double
            let months_in_business: Int?
            let annual_revenue: Double?
            let credit_score_band: String
            let business_type: String
        }
        struct Resp: Decodable { let ok: Bool }

        let body = Req(
            loan_type: loanType,
            amount_needed: Double(amountNeeded) ?? 0,
            months_in_business: Int(monthsInBusiness),
            annual_revenue: Double(annualRevenue),
            credit_score_band: creditScore,
            business_type: businessType
        )
        do {
            _ = try await APIClient.shared.request(
                "/api/growth/financing/pre-qual",
                method: .POST, body: body, as: Resp.self
            )
            withAnimation { submitted = true }
        } catch let modErr as ContentModerator.Error {
            if case .blocked(let reason) = modErr { self.error = reason }
        } catch {
            self.error = "Could not submit. Please try again."
        }
    }

    private func finLabel(_ text: String) -> some View {
        Text(text)
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

// MARK: - Grants Directory

/// Static + server-backed directory of grants and subsidies, filtered by persona/trade.
struct GrantsDirectoryView: View {
    @EnvironmentObject var auth: AuthStore
    @Environment(\.dismiss) private var dismiss

    @State private var grants: [GrantItem] = []
    @State private var isLoading = false
    @State private var filter: GrantFilter = .all

    enum GrantFilter: String, CaseIterable {
        case all = "All"
        case federal = "Federal"
        case state = "State"
        case nonprofit = "Nonprofit"
    }

    struct GrantItem: Identifiable, Decodable {
        let id: String
        let name: String
        let sponsor: String
        let amount: String          // e.g. "Up to $5,000"
        let eligibility: String
        let deadline: String?
        let applyURL: String?
        let category: String        // "federal" | "state" | "nonprofit"

        enum CodingKeys: String, CodingKey {
            case id, name, sponsor, amount, eligibility, deadline, category
            case applyURL = "apply_url"
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Filter chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(GrantFilter.allCases, id: \.self) { f in
                            let isOn = filter == f
                            Button { filter = f } label: {
                                Text(f.rawValue)
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(isOn ? Theme.textPrimary : Theme.textSecondary)
                                    .padding(.horizontal, 14).padding(.vertical, 8)
                                    .background(isOn ? Theme.accentSoft : Theme.surface, in: Capsule())
                                    .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20).padding(.vertical, 10)
                }
                .background(Theme.background)

                if isLoading {
                    Spacer()
                    ProgressView().tint(Theme.accent)
                    Spacer()
                } else if visibleGrants.isEmpty {
                    Spacer()
                    VStack(spacing: 10) {
                        Image(systemName: "gift").font(.system(size: 32)).foregroundStyle(Theme.textTertiary)
                        Text("No grants matched your filters.").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                } else {
                    ScrollView {
                        VStack(spacing: 12) {
                            ForEach(visibleGrants) { g in
                                GrantCard(grant: g)
                            }
                        }
                        .padding(20)
                    }
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Grants & Subsidies")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
        .task { await loadGrants() }
    }

    private var visibleGrants: [GrantItem] {
        filter == .all ? grants : grants.filter { $0.category == filter.rawValue.lowercased() }
    }

    private func loadGrants() async {
        isLoading = true
        defer { isLoading = false }

        struct Resp: Decodable { let grants: [GrantItem] }
        let persona = auth.activePersona.rawValue.lowercased().replacingOccurrences(of: " ", with: "_")
        if let resp = try? await APIClient.shared.request(
            "/api/growth/grants",
            query: ["persona": persona],
            requiresAuth: false,
            as: Resp.self
        ) {
            grants = resp.grants
        } else {
            // Fallback seed so the screen is never empty on first launch / offline
            grants = GrantsDirectoryView.seedGrants()
        }
    }

    // Fallback content while server data loads
    private static func seedGrants() -> [GrantItem] {
        [
            GrantItem(id: "g1", name: "Workforce Innovation & Opportunity Act (WIOA)",
                      sponsor: "U.S. Dept. of Labor", amount: "Up to $10,000",
                      eligibility: "Unemployed or underemployed adults seeking vocational training",
                      deadline: nil, applyURL: "https://www.careeronestop.org/LocalHelp/find-american-job-centers.aspx",
                      category: "federal"),
            GrantItem(id: "g2", name: "Small Business Innovation Research (SBIR)",
                      sponsor: "SBA", amount: "Up to $275,000",
                      eligibility: "Small businesses with innovative product/service ideas",
                      deadline: nil, applyURL: "https://www.sbir.gov",
                      category: "federal"),
            GrantItem(id: "g3", name: "Minority Business Development Agency Grants",
                      sponsor: "MBDA", amount: "Varies",
                      eligibility: "Minority-owned small businesses",
                      deadline: nil, applyURL: "https://www.mbda.gov",
                      category: "federal"),
            GrantItem(id: "g4", name: "Apprenticeship Building America",
                      sponsor: "U.S. Dept. of Labor", amount: "Up to $5,000 per apprentice",
                      eligibility: "Registered apprenticeship sponsors in skilled trades",
                      deadline: nil, applyURL: "https://www.apprenticeship.gov",
                      category: "federal"),
            GrantItem(id: "g5", name: "Kiva U.S. Microloans",
                      sponsor: "Kiva (nonprofit)", amount: "$0–$15,000 (0% interest)",
                      eligibility: "Self-employed workers and micro-businesses",
                      deadline: nil, applyURL: "https://www.kiva.org/borrow",
                      category: "nonprofit"),
            GrantItem(id: "g6", name: "Accion Opportunity Fund",
                      sponsor: "Accion (nonprofit)", amount: "$5,000–$100,000",
                      eligibility: "Small business owners in underserved communities",
                      deadline: nil, applyURL: "https://aofund.org",
                      category: "nonprofit"),
        ]
    }
}

private struct GrantCard: View {
    let grant: GrantsDirectoryView.GrantItem
    @Environment(\.openURL) private var openURL

    private var categoryColor: Color {
        switch grant.category {
        case "federal":   return Theme.pillarMoney
        case "state":     return Theme.pillarHome
        case "nonprofit": return Theme.pillarGoals
        default:          return Theme.accent
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(grant.name)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(grant.sponsor)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                Text(grant.category.capitalized)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(categoryColor)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(categoryColor.opacity(0.14), in: Capsule())
            }

            HStack(spacing: 6) {
                Image(systemName: "dollarsign.circle.fill").foregroundStyle(Theme.success)
                    .font(.system(size: 13))
                Text(grant.amount)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.success)
            }

            Text(grant.eligibility)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(3)

            if let deadline = grant.deadline {
                Label("Deadline: \(deadline)", systemImage: "calendar")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.warning)
            }

            if let urlStr = grant.applyURL, let url = URL(string: urlStr) {
                Button { openURL(url) } label: {
                    Text("Apply / Learn More")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.accent.opacity(0.3), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .cardStyle()
    }
}
