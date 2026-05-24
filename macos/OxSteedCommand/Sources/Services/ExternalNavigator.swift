import AppKit
import Foundation

enum ExternalNavigator {
    static func openWebsite() {
        open("https://oxsteed.com")
    }

    static func openDashboard() {
        open("https://oxsteed.com/admin/login")
    }

    private static func open(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        NSWorkspace.shared.open(url)
    }
}
