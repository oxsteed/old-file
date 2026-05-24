import SwiftUI

@main
struct OxSteedGoApp: App {
    @State private var store = GoStore()

    var body: some Scene {
        WindowGroup {
            GoRootView()
                .environment(store)
        }
    }
}
