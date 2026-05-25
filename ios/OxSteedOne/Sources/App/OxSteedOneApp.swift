import SwiftUI
import UserNotifications
import os

@main
struct OxSteedOneApp: App {
    @State private var store = OneStore()
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            OneRootView()
                .environment(store)
                .onAppear {
                    // Hand the store reference to AppDelegate so it can relay
                    // the device token once APNs calls back.
                    appDelegate.store = store
                    // Request push permission once the user is authenticated.
                    if store.isAuthenticated {
                        Task { await store.registerForPushNotifications() }
                    }
                }
                .onChange(of: store.isAuthenticated) { _, isAuthenticated in
                    guard isAuthenticated else { return }
                    Task {
                        await store.registerForPushNotifications()
                        await store.sendDeviceTokenToServer()
                    }
                }
        }
    }
}

// MARK: - AppDelegate

final class AppDelegate: NSObject, UIApplicationDelegate {
    private let logger = Logger(subsystem: "com.oxsteed.app", category: "push")
    /// Weak reference set by OxSteedOneApp.onAppear so the delegate can relay
    /// the device token without creating a retain cycle.
    weak var store: OneStore?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        // Hex-encode the binary token and persist it for OneStore to read.
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        OneSessionVault.saveDeviceToken(tokenString)

        // Push token to backend now that it's available.
        Task { await store?.sendDeviceTokenToServer() }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Non-fatal; the app works without push — log and move on.
        logger.error("APNs registration failed: \(error.localizedDescription)")
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension AppDelegate: UNUserNotificationCenterDelegate {
    /// Show banner + sound + badge even when the app is in the foreground.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        return [.banner, .sound, .badge]
    }

    /// Handle notification tap — deep-link to the relevant thread.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        guard let threadIDString = userInfo["thread_id"] as? String,
              let threadID = Int(threadIDString) else { return }

        // Post a notification that OneRootView or InboxView can observe to
        // navigate to the correct thread on the next render cycle.
        await MainActor.run {
            NotificationCenter.default.post(
                name: .oxSteedOpenThread,
                object: nil,
                userInfo: ["thread_id": threadID]
            )
        }
    }
}

// MARK: - Notification name

extension Notification.Name {
    /// Posted when a push notification tap should deep-link to a thread.
    static let oxSteedOpenThread = Notification.Name("oxSteedOpenThread")
}
