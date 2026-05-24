import SwiftUI

struct ProfileView: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        @Bindable var store = store

        GoScreen(title: "Me") {
            GoCard {
                HStack(spacing: 14) {
                    Image(systemName: "person.crop.circle.fill")
                        .font(.system(size: 58))
                        .foregroundStyle(GoTheme.sea)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(store.currentUser?.email ?? "OxSteed User")
                            .font(.title2.bold())
                        Text(store.isSignedIn ? "Signed in" : "Signed out preview")
                            .foregroundStyle(.secondary)
                    }
                }
            }

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
                    .buttonStyle(.borderedProminent)
                    .tint(GoTheme.sea)
                }
                if let authMessage = store.authMessage {
                    Text(authMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            GoCard {
                Text("Default Mode")
                    .font(.headline)
                Picker("Mode", selection: $store.mode) {
                    ForEach(GoMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
            }

            GoCard {
                Label(GoLocalization.text(.languageTranslation, language: store.appLanguage), systemImage: "globe")
                    .font(.headline)
                Text("OxSteedGo supports the same four user languages as the website and keeps cross-language message translation on by default.")
                    .foregroundStyle(.secondary)
                Picker("App language", selection: Binding(
                    get: { store.appLanguage },
                    set: { store.setLanguage($0) }
                )) {
                    ForEach(GoLanguage.allCases) { language in
                        Text(language.label).tag(language)
                    }
                }
                Toggle("Auto-translate messages", isOn: Binding(
                    get: { store.autoTranslateMessages },
                    set: { store.setAutoTranslateMessages($0) }
                ))
                Text(store.autoTranslateMessages ? "Messages are translated to \(store.appLanguage.translatorLabel) when needed." : "Original message text will be shown unless you turn translation back on.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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

            GoCard {
                Label("Notifications & Deep Links", systemImage: "bell.badge")
                    .font(.headline)
                Text("Pushes should open the exact job, message, invoice, booking, order, or logistics request. This preview queues a deep-link action so the app can resume it later.")
                    .foregroundStyle(.secondary)
                Button("Queue Sample Push Route") {
                    store.queueNotificationOpen("Open conversation from push")
                }
                .buttonStyle(.bordered)
            }

            GoCard {
                Label("API target", systemImage: "network")
                    .font(.headline)
                Text("https://oxsteed.com/api")
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct ChecklistRow: View {
    let done: Bool
    let title: String

    var body: some View {
        Label(title, systemImage: done ? "checkmark.circle.fill" : "circle")
            .foregroundStyle(done ? .green : .secondary)
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
                    .foregroundStyle(.secondary)
                LiveFeedSummary()
            }
        case .helper:
            GoCard {
                Label("Helper mode", systemImage: "briefcase.fill")
                    .font(.headline)
                Text("Available jobs, bids, booking accept/decline, calendar availability, profile edits, earnings, and Stripe Connect live here.")
                    .foregroundStyle(.secondary)
                Button("Load nearby helper opportunities") {
                    Task { await store.loadHelpers() }
                }
                .buttonStyle(.bordered)
                HelperPreviewList()
            }
        case .business:
            GoCard {
                Label("Business owner lite", systemImage: "building.2.fill")
                    .font(.headline)
                Text("Appointments, messages, services, quotes, invoices, products, team basics, and intake requests should be handled here so owners do not need the website for daily ops.")
                    .foregroundStyle(.secondary)
                LiveFeedSummary()
                Text("Next native endpoints: `/api/business/:businessId/workspace/mobile-summary`, services, appointments, quotes, and invoices.")
                    .font(.footnote)
                    .foregroundStyle(GoTheme.sea)
            }
        case .logistics:
            GoCard {
                Label("Logistics lite", systemImage: "shippingbox.fill")
                    .font(.headline)
                Text("Sourcing requests, campaigns, shipment milestones, claims, and buyer alerts can be handled from the lightweight app.")
                    .foregroundStyle(.secondary)
                Button("Load logistics requests") {
                    Task { await store.loadLogisticsRequests() }
                }
                .buttonStyle(.bordered)
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
                .foregroundStyle(GoTheme.sea)
        } else {
            Text(store.isSignedIn ? "Refresh Today to load live customer data." : "Sign in to load live customer data.")
                .font(.footnote)
                .foregroundStyle(.secondary)
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
                .foregroundStyle(store.isSignedIn ? .red : .secondary)
        case .idle:
            EmptyView()
        }
    }
}
