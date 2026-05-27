import SwiftUI

@main
struct OxSteedApp: App {
    @StateObject private var personaStore = PersonaStore()

    var body: some Scene {
        WindowGroup {
            RootShellView()
                .environmentObject(personaStore)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}
