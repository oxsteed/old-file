import SwiftUI

struct HomeTabView: View {
    @Binding var pendingDeepLink: AppDeepLink?
    @EnvironmentObject var personaStore: PersonaStore
    @EnvironmentObject var notifications: NotificationsStore
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject var bids: BidsStore
    @EnvironmentObject var messages: MessagesStore
    @EnvironmentObject var calendar: CalendarStore
    @EnvironmentObject var payments: PaymentsStore
    @EnvironmentObject var tools: ToolRentalsStore
    @EnvironmentObject var localization: LocalizationManager
    @EnvironmentObject var learn: LearnStore
    @EnvironmentObject var life: LifeStore
    @State private var showPersonaSheet = false
    @State private var showSettingsSheet = false
    @State private var showNotificationsSheet = false
    @State private var showInboxSheet = false
    @State private var showSearchSheet = false
    @State private var showMapSheet = false
    @State private var showAuthSheet = false
    // Intent-triggered sheets (App Intents / Siri)
    @State private var showPostJobSheet  = false
    @State private var showPayoutSheet   = false

    var body: some View {
        let isGuest = auth.user == nil
        let persona = isGuest ? Persona.customer : personaStore.active
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    HomeHeader(
                        persona: persona,
                        isGuest: isGuest,
                        userName: auth.user?.homeGreetingName,
                        unread: notifications.unreadCount,
                        onTapPersona: {
                            if isGuest { showAuthSheet = true }
                            else { showPersonaSheet = true }
                        },
                        onTapSearch: { showSearchSheet = true },
                        onTapMap: { showMapSheet = true },
                        onTapInbox: {
                            if isGuest { showAuthSheet = true }
                            else { showInboxSheet = true }
                        },
                        onTapNotifications: {
                            if isGuest { showAuthSheet = true }
                            else { showNotificationsSheet = true }
                        },
                        onTapSettings: { showSettingsSheet = true }
                    )
                    .padding(.horizontal, 20)
                    .padding(.top, 8)

                    if !isGuest && persona != .customer {
                        PersonaDashboard(persona: persona)
                            .padding(.horizontal, 20)
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                            .id(persona)
                    }

                    HomeContent(persona: persona, isGuest: isGuest, onRequireAuth: { showAuthSheet = true })
                        .padding(.horizontal, 20)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                        .id(persona)
                }
                .padding(.bottom, 24)
            }
            .background(Theme.background.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
        .task {
            // Guest mode: don't fetch protected resources.
            if !isGuest { await notifications.load() }
        }
        .sheet(isPresented: $showPersonaSheet) {
            PersonaSwitcherSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showSettingsSheet) {
            SettingsSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showNotificationsSheet) {
            NotificationsView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showInboxSheet) {
            InboxView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showSearchSheet) {
            UniversalSearchView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showMapSheet) {
            MapBrowseView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showAuthSheet) {
            AuthLandingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.86), value: personaStore.active)
        // ── App Intent / Siri routing ────────────────────────────────────
        .sheet(isPresented: $showPostJobSheet) {
            PostJobView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showPayoutSheet) {
            PaymentsView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .onReceive(NotificationCenter.default.publisher(for: .oxIntentTriggerPostJob)) { _ in
            guard auth.user != nil else { showAuthSheet = true; return }
            showPostJobSheet = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .oxIntentTriggerNearbyJobs)) { _ in
            showSearchSheet = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .oxIntentTriggerInbox)) { _ in
            guard auth.user != nil else { showAuthSheet = true; return }
            showInboxSheet = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .oxIntentTriggerPayout)) { _ in
            guard auth.user != nil else { showAuthSheet = true; return }
            showPayoutSheet = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .oxIntentTriggerJobSearch)) { _ in
            showSearchSheet = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .oxIntentTriggerHelperSearch)) { _ in
            showSearchSheet = true
        }
        .onChange(of: pendingDeepLink) { _, deepLink in
            guard let deepLink else { return }
            switch deepLink {
            case .conversation(let id):
                NotificationCenter.default.post(name: .oxOpenConversation, object: nil, userInfo: ["id": id])
                showInboxSheet = true
            case .job(let id):
                NotificationCenter.default.post(name: .oxOpenJob, object: nil, userInfo: ["id": id])
                showSearchSheet = true
            case .bid(let id):
                NotificationCenter.default.post(name: .oxOpenBid, object: nil, userInfo: ["id": id])
                showInboxSheet = true
            case .notification:
                showNotificationsSheet = true
            case .home:
                break
            }
            pendingDeepLink = nil
        }
    }
}

private struct HomeHeader: View {
    let persona: Persona
    let isGuest: Bool
    let userName: String?
    let unread: Int
    let onTapPersona: () -> Void
    let onTapSearch: () -> Void
    let onTapMap: () -> Void
    let onTapInbox: () -> Void
    let onTapNotifications: () -> Void
    let onTapSettings: () -> Void
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        ZStack {
            Theme.heroGradient
            Circle()
                .fill(Theme.accent.opacity(0.18))
                .frame(width: 240, height: 240)
                .offset(x: 120, y: -94)
            Circle()
                .fill(Theme.pillarHome.opacity(0.12))
                .frame(width: 164, height: 164)
                .offset(x: -120, y: 100)

            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 10) {
                    LogoMark()
                    Text(localization.localized(L10n.appName))
                        .font(.system(size: 15, weight: .bold))
                        .tracking(1.1)
                        .foregroundStyle(.white.opacity(0.9))
                    Spacer()
                    Button(action: onTapSettings) {
                        Image(systemName: "gearshape.fill")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 34, height: 34)
                            .background(.white.opacity(0.15), in: Circle())
                    }
                    .accessibilityLabel(localization.localized(L10n.NavigationKey.settings))
                    .buttonStyle(.plain)

                    Button(action: onTapPersona) {
                        HStack(spacing: 6) {
                            Image(systemName: persona.icon)
                                .font(.system(size: 11, weight: .bold))
                            Text(localization.localized(isGuest ? L10n.AuthKey.signIn : L10n.PersonaKey.name(for: persona)))
                                .lineLimit(1)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 9, weight: .bold))
                        }
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 8)
                        .background(.white.opacity(0.15), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }

                VStack(alignment: .leading, spacing: 5) {
                    Text(greetingText)
                        .font(.system(size: 25, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                    if isGuest {
                        Text(localization.localized("settings.guest.subtitle"))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white.opacity(0.76))
                    } else {
                        Text(localization.localized(persona.tagline))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white.opacity(0.76))
                    }
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        HeroActionChip(title: L10n.CommonKey.search, icon: "magnifyingglass", action: onTapSearch)
                        HeroActionChip(title: L10n.NavigationKey.map, icon: "map.fill", action: onTapMap)
                        HeroActionChip(title: L10n.CommonKey.inbox, icon: "envelope.fill", action: onTapInbox)
                        HeroActionChip(title: L10n.NavigationKey.alerts, icon: "bell.fill", badge: unread, action: onTapNotifications)
                    }
                }
            }
            .padding(18)
        }
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(.white.opacity(0.09), lineWidth: 1))
        .shadow(color: Theme.accent.opacity(0.17), radius: 18, y: 9)
    }

    private var greetingText: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let key: String
        switch hour {
        case 5..<12:  key = isGuest ? "app.greeting.morning.guest" : "app.greeting.morning"
        case 12..<18: key = isGuest ? "app.greeting.afternoon.guest" : "app.greeting.afternoon"
        default:      key = isGuest ? "app.greeting.evening.guest" : "app.greeting.evening"
        }

        guard !isGuest, let userName, !userName.isEmpty else {
            return localization.localized(key)
        }
        let resolvedName = localization.localized(userName)
        return localization.format(key, resolvedName)
    }
}

private extension APIUser {
    var homeGreetingName: String {
        greetingName
    }
}

private struct LogoMark: View {
    var body: some View {
        Image("OxSteedLogo")
            .resizable()
            .scaledToFit()
            .frame(width: 38, height: 38)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct HeroActionChip: View {
    let title: String
    let icon: String
    var badge: Int = 0
    let action: () -> Void
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                Text(localization.localized(title))
                    .lineLimit(1)
                if badge > 0 {
                    Text("\(badge)")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Theme.accent, in: Capsule())
                }
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white.opacity(0.92))
            .padding(.horizontal, 8)
            .padding(.vertical, 9)
            .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct HomeContent: View {
    let persona: Persona
    let isGuest: Bool
    let onRequireAuth: () -> Void
    var body: some View {
        // Persona packs are resolved through the registry — the shell never
        // switches on persona identity (docs/oxsteed-pack-architecture.md §3.1).
        PersonaRegistry.module(for: persona)
            .homeView(isGuest: isGuest, onRequireAuth: onRequireAuth)
    }
}
