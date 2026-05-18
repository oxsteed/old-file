import SwiftUI

@main
struct OxSteedApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var router = OxSteedRouter()
    @StateObject private var session = SessionStore()
    @AppStorage("hasSeenIntro") private var hasSeenIntro = false

    var body: some Scene {
        WindowGroup {
            RootView(hasSeenIntro: $hasSeenIntro)
                .environmentObject(router)
                .environmentObject(session)
                .sheet(item: $router.presentedRoute) { route in
                    SafariView(url: route.url)
                        .ignoresSafeArea()
                }
                .onOpenURL { url in
                    router.handleIncoming(url)
                }
        }
    }
}
