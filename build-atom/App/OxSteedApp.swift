import SwiftUI
import UIKit
import AppIntents
import WidgetKit
import SafariServices

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .oxAPNsToken, object: nil, userInfo: ["token": deviceToken])
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushManager.shared.didFailToRegister(error: error)
    }
}

@main
struct OxSteedApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @AppStorage("ox.appearance") private var appearancePref: String = "system"
    @AppStorage("ox.fontSizeCategory") private var fontSizeCategory: String = "medium"

    private var dynamicTypeSize: DynamicTypeSize {
        switch fontSizeCategory {
        case "small":   return .small
        case "large":   return .xLarge
        case "xlarge":  return .xxLarge
        default:        return .medium
        }
    }
    @StateObject private var auth = AuthStore()
    @StateObject private var personaStore = PersonaStore()
    @StateObject private var localization = LocalizationManager()
    @StateObject private var jobs = JobsStore()
    @StateObject private var bids = BidsStore()
    @StateObject private var messages = MessagesStore()
    @StateObject private var calendar = CalendarStore()
    @StateObject private var notifications = NotificationsStore()
    @StateObject private var payments = PaymentsStore()
    @StateObject private var toolRentals = ToolRentalsStore()
    @StateObject private var workspace = BusinessWorkspaceStore()
    @StateObject private var socket = OxSocketManager.shared
    @StateObject private var lifeData = LifeDataStore.shared
    @StateObject private var life = LifeStore()
    @StateObject private var learn = LearnStore()
    @StateObject private var recommendations = RecommendationsStore.shared
    @StateObject private var linkRouter = LinkRouter()

    var body: some Scene {
        WindowGroup {
            appRootView
        }
    }

    private var appRootView: some View {
        let base = RootGate()
            .environmentObject(auth)
            .environmentObject(personaStore)
            .environmentObject(localization)
            .environmentObject(jobs)
            .environmentObject(bids)
            .environmentObject(messages)
            .environmentObject(calendar)
            .environmentObject(notifications)
            .environmentObject(payments)
            .environmentObject(toolRentals)
            .environmentObject(workspace)
            .environmentObject(socket)
            .environmentObject(lifeData)
            .environmentObject(life)
            .environmentObject(learn)
            .environmentObject(recommendations)
            .environmentObject(linkRouter)
            .environment(\.locale, localization.locale)
            .environment(\.layoutDirection, localization.layoutDirection)
            .environment(\.openURL, OpenURLAction { url in
                linkRouter.open(url)
                return .handled
            })
            .dynamicTypeSize(dynamicTypeSize)
            .preferredColorScheme(colorScheme(for: appearancePref))
            .tint(Theme.accent)
            .id(localization.language)
            .onChange(of: auth.user?.id) { _, _ in
                if let u = auth.user {
                    if let preferredLanguage = u.preferred_language,
                       let language = AppLanguage.fromStoredCode(preferredLanguage),
                       language != localization.language {
                        localization.language = language
                    }
                    personaStore.active = u.preferredPersona
                    personaStore.hasExplicitPersona = true
                    if let token = KeychainManager.shared.getAccessToken() {
                        Task { @MainActor in socket.connect(token: token) }
                    }
                    PushManager.shared.requestAndRegister()
                    PersonaSuggestionsManager.donate(for: u.preferredPersona)
                    OxSpotlightManager.indexProfile(u)
                    updateWidgetData()
                } else {
                    Task { @MainActor in socket.disconnect() }
                    // Wipe private Spotlight data on logout
                    OxSpotlightManager.deleteAllIndexes()
                }
            }
            .onChange(of: auth.user?.preferredPersona) { _, preferred in
                guard let preferred else { return }
                if personaStore.active != preferred {
                    personaStore.active = preferred
                }
                personaStore.hasExplicitPersona = true
            }
            .onChange(of: personaStore.active) { _, newPersona in
                PersonaSuggestionsManager.donate(for: newPersona)
            }
            .onReceive(NotificationCenter.default.publisher(for: .oxSocketMessage)) { note in
                guard let event = note.userInfo?["event"] as? String else { return }
                handleSocketEvent(event)
            }
            .onReceive(NotificationCenter.default.publisher(for: .oxAPNsToken)) { note in
                if let tokenData = note.userInfo?["token"] as? Data {
                    PushManager.shared.didRegister(deviceToken: tokenData)
                }
            }
            .task {
                await bootstrapOnLaunch()
            }
            .sheet(item: $linkRouter.presentedBrowserURL) { item in
                SafariBrowserView(url: item.url)
                    .ignoresSafeArea()
            }
        return withIntentRouting(base)
    }

    private func withIntentRouting<V: View>(_ view: V) -> some View {
        view
        // MARK: - Intent notification routing
        // Each App Intent posts a notification; the shell listens here
        // and dispatches to the right tab + screen via NotificationCenter.
            .onReceive(NotificationCenter.default.publisher(for: .oxIntentOpenPulse)) { _ in
                NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "life"])
            }
            .onReceive(NotificationCenter.default.publisher(for: .oxIntentOpenLogExpense)) { _ in
                NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "life"])
                NotificationCenter.default.post(name: .oxIntentOpenLogExpenseInLife, object: nil)
            }
            .onReceive(NotificationCenter.default.publisher(for: .oxIntentOpenPostJob)) { _ in
                NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "home"])
                NotificationCenter.default.post(name: .oxIntentTriggerPostJob, object: nil)
            }
            .onReceive(NotificationCenter.default.publisher(for: .oxIntentOpenNearbyJobs)) { _ in
                NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "home"])
                NotificationCenter.default.post(name: .oxIntentTriggerNearbyJobs, object: nil)
            }
            .onReceive(NotificationCenter.default.publisher(for: .oxIntentOpenAvailableJobs)) { _ in
                NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "home"])
                NotificationCenter.default.post(name: .oxIntentTriggerNearbyJobs, object: nil)
            }
            .onReceive(NotificationCenter.default.publisher(for: .oxIntentOpenInbox)) { _ in
                NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "home"])
                NotificationCenter.default.post(name: .oxIntentTriggerInbox, object: nil)
            }
            .onReceive(NotificationCenter.default.publisher(for: .oxIntentOpenPayout)) { _ in
                NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "home"])
                NotificationCenter.default.post(name: .oxIntentTriggerPayout, object: nil)
            }
            .onReceive(NotificationCenter.default.publisher(for: .oxIntentSearchJobs)) { note in
                let term = note.userInfo?["term"] as? String ?? ""
                let cat  = note.userInfo?["category"] as? String ?? ""
                NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "home"])
                NotificationCenter.default.post(
                    name: .oxIntentTriggerJobSearch,
                    object: nil,
                    userInfo: ["term": term, "category": cat]
                )
            }
            .onReceive(NotificationCenter.default.publisher(for: .oxIntentSearchHelpers)) { note in
                let skill = note.userInfo?["skill"] as? String ?? ""
                NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "home"])
                NotificationCenter.default.post(
                    name: .oxIntentTriggerHelperSearch,
                    object: nil,
                    userInfo: ["skill": skill]
                )
            }
    }

    @MainActor
    private func bootstrapOnLaunch() async {
        // Refresh content moderation blocklist in background
        ContentModerator.refreshBlocklist()
        // Register App Shortcuts with Siri (must be called at launch)
        OxSteedShortcuts.updateAppShortcutParameters()
        // Bootstrap intelligence manager
        _ = OxIntelligenceManager.shared
    }

    private func colorScheme(for pref: String) -> ColorScheme? {
        switch pref {
        case "dark":  return .dark
        case "light": return .light
        default:      return nil  // follow system
        }
    }

    /// Writes a snapshot of current store state to the shared App Group so widgets stay current.
    private func updateWidgetData() {
        let persona = auth.user?.preferredPersona.rawValue ?? "customer"
        let activeJobs = jobs.myJobs.filter {
            ($0.status ?? "") != "completed" && ($0.status ?? "") != "cancelled"
        }.count
        let nearby = jobs.availableJobs.count
        let topJob = jobs.availableJobs.first ?? jobs.myJobs.first
        let helperNetWeekCents = weeklyHelperNetCents(from: payments.payments)
        WidgetData.write(
            persona: persona,
            activeJobs: activeJobs,
            nearbyJobs: nearby,
            topJobTitle: topJob?.title,
            topJobCategory: topJob?.category,
            topJobBudget: topJob?.budgetDisplay,
            pulseScore: life.pulse?.pulse_score,
            unreadCount: notifications.unreadCount,
            helperNetWeekCents: helperNetWeekCents
        )
    }

    private func weeklyHelperNetCents(from list: [APIPayment]) -> Int? {
        guard auth.user?.preferredPersona == .helper else { return nil }
        let formatter = ISO8601DateFormatter()
        let cutoff = Date().addingTimeInterval(-7 * 24 * 60 * 60)
        let total = list.reduce(0) { partial, payment in
            guard (payment.status ?? "").lowercased() == "completed",
                  let createdAt = payment.created_at,
                  let createdDate = formatter.date(from: createdAt),
                  createdDate >= cutoff else {
                return partial
            }
            return partial + payment.amount
        }
        return total > 0 ? total : nil
    }

    private func handleSocketEvent(_ event: String) {
        Task { @MainActor in
            switch event {
            case "message:new":
                await messages.loadConversations()
                if let uid = auth.user?.id { messages.indexInSpotlight(currentUserId: uid) }
            case "conversation:archived":
                await messages.loadConversations()
                if let uid = auth.user?.id { messages.indexInSpotlight(currentUserId: uid) }
            case "bid:received", "bid:accepted", "bid:rejected":
                await bids.loadMine()
                await notifications.load()
            case "job:created", "job:updated", "job:completed", "job:cancelled":
                await jobs.loadMyJobs()
                await jobs.loadAvailable()
                jobs.indexInSpotlight()
                updateWidgetData()
            case "appointment:created", "appointment:updated", "appointment:cancelled":
                await calendar.loadAppointments()
                await workspace.refreshSelectedBusiness()
            case "notification:new":
                await notifications.load()
            case "business:message:new", "business:lead:new", "business:product:updated", "business:health:alert":
                await workspace.refreshSelectedBusiness()
            default:
                break
            }
        }
    }
}

// MARK: - In-app link routing

@MainActor
final class LinkRouter: ObservableObject {
    @Published var presentedBrowserURL: BrowserURL?

    func open(_ url: URL) {
        if url.scheme == "oxsteed" {
            NotificationCenter.default.post(name: .oxOpenDeepLink, object: nil, userInfo: ["url": url])
            return
        }

        guard let scheme = url.scheme?.lowercased() else { return }
        switch scheme {
        case "http", "https":
            presentedBrowserURL = BrowserURL(url: url)
        case "mailto", "tel", "sms":
            UIApplication.shared.open(url)
        default:
            UIApplication.shared.open(url)
        }
    }
}

struct BrowserURL: Identifiable, Equatable {
    let url: URL
    var id: String { url.absoluteString }
}

struct SafariBrowserView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredControlTintColor = UIColor(Theme.accent)
        return controller
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
