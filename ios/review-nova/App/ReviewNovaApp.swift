import SwiftUI

@main
struct ReviewNovaApp: App {
    @StateObject private var store = OneStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(store.isDarkMode ? .dark : nil)
                .tint(OneTheme.accent)
        }
    }
}
