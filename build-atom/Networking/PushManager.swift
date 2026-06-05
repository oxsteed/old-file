import Foundation
import UserNotifications
import UIKit

/// Handles APNs registration, permission request, and server token upload.
final class PushManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()
    private override init() { super.init() }

    // MARK: - Permission + Registration

    /// Call once after login. Requests permission, registers, uploads token to server.
    func requestAndRegister() {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if let error { OXLog.error("permission error: \(String(describing: error))", category: "push") }
            guard granted else { OXLog.warn("permission denied", category: "push"); return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Called from AppDelegate / SwiftUI onReceive after APNs delivers the device token.
    func didRegister(deviceToken: Data) {
        let tokenStr = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        OXLog.info("device token received", category: "push")
        // UIKit is main-actor isolated in Swift 6; capture device id on the current (main) context.
        let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        Task {
            try? await NotificationsService.registerPushToken(tokenStr, deviceId: deviceId)
            OXLog.info("token registered with server", category: "push")
        }
    }

    func didFailToRegister(error: Error) {
        OXLog.error("failed to register: \(error.localizedDescription)", category: "push")
    }

    // MARK: - Foreground display

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                 willPresent notification: UNNotification,
                                 withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Show banner + sound even while app is in foreground
        completionHandler([.banner, .badge, .sound])
    }

    // MARK: - Tap handling

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                 didReceive response: UNNotificationResponse,
                                 withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo
        // Post internally so any listening view can react
        NotificationCenter.default.post(name: .oxPushTapped, object: nil, userInfo: userInfo)
        completionHandler()
    }
}

extension Notification.Name {
    static let oxPushTapped         = Notification.Name("ox.push.tapped")
    static let oxAPNsToken          = Notification.Name("ox.apns.token")
    /// Post with userInfo ["tab": "home"|"life"|"growth"|"learn"] to switch tabs app-wide.
    static let oxSwitchTab          = Notification.Name("ox.switch.tab")
    /// Post with userInfo ["category": "car-care", "query": "oil"] to focus Learn from another tab.
    static let oxOpenLearnCategory  = Notification.Name("ox.open.learn.category")
    /// Post to open the Business Owner team/sub-role setup flow.
    static let oxOpenBusinessRoleSetup = Notification.Name("ox.open.business_role_setup")
    /// Post to open the VerifyIdentity flow from anywhere (e.g. creator gate in Learn tab).
    static let oxOpenVerifyIdentity = Notification.Name("ox.open.verify_identity")
}
