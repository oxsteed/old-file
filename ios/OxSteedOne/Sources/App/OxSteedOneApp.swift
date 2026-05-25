import SwiftUI

@main
struct OxSteedOneApp: App {
    @State private var store = OneStore()

    var body: some Scene {
        WindowGroup {
            OneRootView()
                .environment(store)
        }
    }
}
