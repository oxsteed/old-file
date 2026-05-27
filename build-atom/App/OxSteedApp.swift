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
                .environment(\.locale, localization.locale)
                .environment(\.layoutDirection, localization.layoutDirection)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                .id(localization.language)
                .onChange(of: auth.user?.id) { _, _ in
                    // Sync local persona switcher with server-side mode
                    if let u = auth.user { personaStore.active = u.preferredPersona }
                }
        }
    }
}
