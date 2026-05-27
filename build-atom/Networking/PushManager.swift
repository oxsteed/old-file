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
            if let error { NSLog("[Push] permission error: \(error)") }
            guard granted else { NSLog("[Push] permission denied"); return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Called from AppDelegate / SwiftUI onReceive after APNs delivers the device token.
    func didRegister(deviceToken: Data) {
        let tokenStr = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        NSLog("[Push] device token: \(tokenStr.prefix(20))...")
        Task {
            let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
            try? await NotificationsService.registerPushToken(tokenStr, deviceId: deviceId)
            NSLog("[Push] token registered with server")
        }
    }

    func didFailToRegister(error: Error) {
        NSLog("[Push] failed to register: \(error.localizedDescription)")
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
        NotificationCenter.default.post(name: .oxPushTapped, object: nil, userInfo: userInfo as? [AnyHashable: Any])
        completionHandler()
    }
}

extension Notification.Name {
    static let oxPushTapped = Notification.Name("ox.push.tapped")
    static let oxAPNsToken  = Notification.Name("ox.apns.token")
}
