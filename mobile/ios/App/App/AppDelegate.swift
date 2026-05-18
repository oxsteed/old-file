import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
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
        NotificationCenter.default.post(name: .oxsteedDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        NotificationCenter.default.post(name: .oxsteedDidFailToRegisterForRemoteNotifications, object: error)
    }
}

extension Notification.Name {
    static let oxsteedDidRegisterForRemoteNotifications = Notification.Name("oxsteedDidRegisterForRemoteNotifications")
    static let oxsteedDidFailToRegisterForRemoteNotifications = Notification.Name("oxsteedDidFailToRegisterForRemoteNotifications")
}
