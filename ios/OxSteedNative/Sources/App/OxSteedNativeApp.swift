import SwiftUI

@main
struct OxSteedNativeApp: App {
    @State private var sessionStore = SessionStore()
    @State private var experienceStore = MobileExperienceStore()

    var body: some Scene {
        WindowGroup {
            OxSteedRootView()
                .environment(sessionStore)
                .environment(experienceStore)
        }
    }
}
