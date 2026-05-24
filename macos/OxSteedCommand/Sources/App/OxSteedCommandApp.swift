import AppKit
import SwiftUI

@main
struct OxSteedCommandApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store = CommandCenterStore()

    var body: some Scene {
        WindowGroup("OxSteed Command") {
            ContentView(store: store)
                .frame(minWidth: 1180, minHeight: 760)
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("Refresh Strategic Snapshot") {
                    store.refreshSnapshot()
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])

                Button("Open OxSteed Website") {
                    ExternalNavigator.openWebsite()
                }
                .keyboardShortcut("o", modifiers: [.command, .shift])
            }
        }

        Settings {
            SettingsView(store: store)
                .frame(width: 520, height: 360)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}
