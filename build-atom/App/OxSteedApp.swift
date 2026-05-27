import SwiftUI

@main
struct OxSteedApp: App {
    @StateObject private var auth = AuthStore()
    @StateObject private var personaStore = PersonaStore()
    @StateObject private var localization = LocalizationManager()
    @StateObject private var jobs = JobsStore()
    @StateObject private var bids = BidsStore()
    @StateObject private var messages = MessagesStore()
    @StateObject private var calendar = CalendarStore()
    @StateObject private var notifications = NotificationsStore()
    @StateObject private var payments = PaymentsStore()
    @StateObject private var socket = OxSocketManager.shared
    @StateObject private var lifeData = LifeDataStore.shared

    var body: some Scene {
        WindowGroup {
            RootGate()
                .environmentObject(auth)
                .environmentObject(personaStore)
                .environmentObject(localization)
                .environmentObject(jobs)
                .environmentObject(bids)
                .environmentObject(messages)
                .environmentObject(calendar)
                .environmentObject(notifications)
                .environmentObject(payments)
                .environmentObject(socket)
                .environmentObject(lifeData)
                .environment(\.locale, localization.locale)
                .environment(\.layoutDirection, localization.layoutDirection)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                .id(localization.language)
                .onChange(of: auth.user?.id) { _, _ in
                    if let u = auth.user {
                        personaStore.active = u.preferredPersona
                        if let token = KeychainManager.shared.getAccessToken() {
                            Task { await socket.connect(token: token) }
                        }
                        PushManager.shared.requestAndRegister()
                    } else {
                        Task { await socket.disconnect() }
                    }
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
        }
    }

    private func handleSocketEvent(_ event: String) {
        Task { @MainActor in
            switch event {
            case "message:new":
                await messages.loadConversations()
            case "bid:received", "bid:accepted", "bid:rejected":
                await bids.loadMine()
                await notifications.load()
            case "job:created", "job:updated", "job:completed", "job:cancelled":
                await jobs.loadMyJobs()
                await jobs.loadAvailable()
            case "appointment:created", "appointment:updated", "appointment:cancelled":
                await calendar.loadAppointments()
            case "notification:new":
                await notifications.load()
            default:
                break
            }
        }
    }
}
