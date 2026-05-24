import SwiftUI

struct ProfileView: View {
    @Environment(GoStore.self) private var store
    @State private var enabledModes: Set<String> = ["Home", "Learn", "Pro"]

    var body: some View {
        @Bindable var store = store

        GoScreen(title: "Modes") {
            ModesHeader()

            VStack(alignment: .leading, spacing: 10) {
                Text("YOUR MODES")
                    .font(.caption.weight(.bold))
                    .tracking(3)
                    .foregroundStyle(GoTheme.muted)

                VStack(spacing: 0) {
                    ModeToggleRow(
                        title: "Home",
                        subtitle: "Marketplace jobs & hiring",
                        symbolName: "briefcase.fill",
                        isOn: binding(for: "Home")
                    )
                    ModeToggleRow(
                        title: "Learn",
                        subtitle: "DIY videos & step-by-step guides",
                        symbolName: "graduationcap.fill",
                        isOn: binding(for: "Learn")
                    )
                    ModeToggleRow(
                        title: "Tools",
                        subtitle: "Tool rentals & equipment",
                        symbolName: "wrench.fill",
                        isOn: binding(for: "Tools")
                    )
                    ModeToggleRow(
                        title: "Pro",
                        subtitle: "Clients, invoices & scheduling",
                        symbolName: "chart.line.uptrend.xyaxis",
                        isOn: binding(for: "Pro")
                    )
                }
                .background(GoTheme.card, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 15).stroke(GoTheme.border, lineWidth: 1))
            }

            ConnectedExperiences()

            GoCard {
                Text(store.isSignedIn ? "Session" : GoLocalization.text(.signIn, language: store.appLanguage))
                    .font(.headline)
                if store.isSignedIn {
                    Button("Sign Out", role: .destructive) {
                        store.signOut()
                    }
                } else {
                    TextField("Email", text: $store.email)
                        .textFieldStyle(.roundedBorder)
                    SecureField("Password", text: $store.password)
                        .textFieldStyle(.roundedBorder)
                    TextField("2FA code if required", text: $store.twoFactorCode)
                        .textFieldStyle(.roundedBorder)
                    Button("Sign In") {
                        Task { await store.signIn() }
                    }
                    .buttonStyle(GoAccentButtonStyle())
                }
                if let authMessage = store.authMessage {
                    Text(authMessage)
                        .font(.footnote)
                        .foregroundStyle(GoTheme.muted)
                }
            }

            GoCard {
                Label(GoLocalization.text(.languageTranslation, language: store.appLanguage), systemImage: "globe")
                    .font(.headline)
                Text("OxSteed Go supports English, Spanish, French, and Haitian Creole, with cross-language message translation on by default.")
                    .font(.subheadline)
                    .foregroundStyle(GoTheme.muted)
                Picker("App language", selection: Binding(
                    get: { store.appLanguage },
                    set: { store.setLanguage($0) }
                )) {
                    ForEach(GoLanguage.allCases) { language in
                        Text(language.label).tag(language)
                    }
                }
                .tint(GoTheme.amber)
                Toggle("Auto-translate messages", isOn: Binding(
                    get: { store.autoTranslateMessages },
                    set: { store.setAutoTranslateMessages($0) }
                ))
                .tint(GoTheme.amber)
                Text(store.autoTranslateMessages ? "Messages are translated to \(store.appLanguage.translatorLabel) when needed." : "Original message text will be shown unless you turn translation back on.")
                    .font(.footnote)
                    .foregroundStyle(GoTheme.muted)
            }

            GoCard {
                Label("Account checklist", systemImage: "checklist")
                    .font(.headline)
                ChecklistRow(done: store.isSignedIn, title: "Sign in")
                ChecklistRow(done: false, title: "Verify identity")
                ChecklistRow(done: false, title: "Turn on notifications")
                ChecklistRow(done: false, title: "Connect payment methods")
                ChecklistRow(done: false, title: "Enable calendar sync")
            }

            ModeWorkspacePanel()
        }
    }

    private func binding(for mode: String) -> Binding<Bool> {
        Binding {
            enabledModes.contains(mode)
        } set: { newValue in
            if newValue {
                enabledModes.insert(mode)
            } else {
                enabledModes.remove(mode)
            }
        }
    }
}

private struct ModesHeader: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    store.selectedTab = .today
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .background(GoTheme.card, in: Circle())
                }
                .buttonStyle(.plain)

                Text("Modes")
                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.top, 8)
                Text("Enable the experiences you want.\nEach mode works independently.")
                    .font(.subheadline)
                    .foregroundStyle(GoTheme.muted)
            }
            Spacer()
            OxSteedGoMark(size: 108)
                .padding(.top, 42)
        }
    }
}

private struct ModeToggleRow: View {
    let title: String
    let subtitle: String
    let symbolName: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 14) {
            GoModeGlyph(symbolName: symbolName, size: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline.bold())
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(GoTheme.muted)
            }
            Spacer()
            Toggle(title, isOn: $isOn)
                .labelsHidden()
                .tint(GoTheme.amber)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(GoTheme.border)
                .frame(height: 1)
                .padding(.leading, 70)
        }
    }
}

private struct ConnectedExperiences: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("CONNECTED EXPERIENCES")
                .font(.caption.weight(.bold))
                .tracking(3)
                .foregroundStyle(GoTheme.muted)

            VStack(spacing: 0) {
                ConnectedRow(left: "graduationcap.fill", right: "briefcase.fill", title: "Learn → Hire a helper", subtitle: "Learn it or get it done")
                ConnectedRow(left: "briefcase.fill", right: "chart.line.uptrend.xyaxis", title: "Home → Open in Pro", subtitle: "Manage jobs in your business")
                ConnectedRow(left: "graduationcap.fill", right: "wrench.fill", title: "Learn → Rent tools", subtitle: "Get the tools you need")
            }
            .background(GoTheme.card, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15).stroke(GoTheme.border, lineWidth: 1))
        }
    }
}

private struct ConnectedRow: View {
    let left: String
    let right: String
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 10) {
            GoModeGlyph(symbolName: left, size: 40)
            Image(systemName: "arrow.right")
                .font(.caption.bold())
                .foregroundStyle(GoTheme.muted)
            GoModeGlyph(symbolName: right, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(GoTheme.muted)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.bold())
                .foregroundStyle(.white.opacity(0.55))
        }
        .padding(12)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(GoTheme.border)
                .frame(height: 1)
                .padding(.leading, 104)
        }
    }
}

private struct ChecklistRow: View {
    let done: Bool
    let title: String

    var body: some View {
        Label(title, systemImage: done ? "checkmark.circle.fill" : "circle")
            .foregroundStyle(done ? .green : GoTheme.muted)
    }
}

private struct ModeWorkspacePanel: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        switch store.mode {
        case .customer:
            GoCard {
                Label("Customer dashboard", systemImage: "house.and.flag")
                    .font(.headline)
                Text("Jobs, bids, appointments, planned needs, invoices, orders, and disputes should be reachable without opening the website.")
                    .foregroundStyle(GoTheme.muted)
                LiveFeedSummary()
            }
        case .helper:
            GoCard {
                Label("Helper mode", systemImage: "briefcase.fill")
                    .font(.headline)
                Text("Available jobs, bids, booking accept/decline, calendar availability, profile edits, earnings, and Stripe Connect live here.")
                    .foregroundStyle(GoTheme.muted)
                Button("Load nearby helper opportunities") {
                    Task { await store.loadHelpers() }
                }
                .buttonStyle(GoAccentButtonStyle())
                HelperPreviewList()
            }
        case .business:
            GoCard {
                Label("Business owner lite", systemImage: "building.2.fill")
                    .font(.headline)
                Text("Appointments, messages, services, quotes, invoices, products, team basics, and intake requests should be handled here.")
                    .foregroundStyle(GoTheme.muted)
                LiveFeedSummary()
            }
        case .logistics:
            GoCard {
                Label("Logistics lite", systemImage: "shippingbox.fill")
                    .font(.headline)
                Text("Sourcing requests, campaigns, shipment milestones, claims, and buyer alerts can be handled from the lightweight app.")
                    .foregroundStyle(GoTheme.muted)
                Button("Load logistics requests") {
                    Task { await store.loadLogisticsRequests() }
                }
                .buttonStyle(GoAccentButtonStyle())
                LogisticsPreviewList()
            }
        }
    }
}

private struct LiveFeedSummary: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        if case .loaded(let feed) = store.mobileFeed {
            Text("Jobs: \(feed.jobs?.mine?.count ?? 0) · Appointments: \(feed.appointments?.count ?? 0) · Businesses: \(feed.businesses?.count ?? 0)")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(GoTheme.amber)
        } else {
            Text(store.isSignedIn ? "Refresh Home to load live customer data." : "Sign in to load live customer data.")
                .font(.footnote)
                .foregroundStyle(GoTheme.muted)
        }
    }
}

private struct HelperPreviewList: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        switch store.nearbyHelpers {
        case .loaded(let helpers):
            ForEach(helpers.prefix(3)) { helper in
                Text(helper.ownerName ?? helper.profileHeadline ?? "Helper #\(helper.id)")
                    .font(.subheadline.weight(.semibold))
            }
        case .loading:
            ProgressView()
        case .failed(let message):
            Text(message)
                .font(.footnote)
                .foregroundStyle(.red)
        case .idle:
            EmptyView()
        }
    }
}

private struct LogisticsPreviewList: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        switch store.logisticsRequests {
        case .loaded(let requests):
            ForEach(requests.prefix(3)) { request in
                Text(request.title ?? request.reference ?? "Request #\(request.id)")
                    .font(.subheadline.weight(.semibold))
            }
        case .loading:
            ProgressView()
        case .failed(let message):
            Text(store.isSignedIn ? message : "Sign in to load logistics requests.")
                .font(.footnote)
                .foregroundStyle(store.isSignedIn ? .red : GoTheme.muted)
        case .idle:
            EmptyView()
        }
    }
}
