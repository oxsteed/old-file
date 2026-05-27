import SwiftUI

@main
struct OxSteedApp: App {
    @StateObject private var personaStore = PersonaStore()
    @StateObject private var localization = LocalizationManager()

    var body: some Scene {
        WindowGroup {
            RootShellView()
                .environmentObject(personaStore)
                .environmentObject(localization)
                .environment(\.locale, localization.locale)
                .environment(\.layoutDirection, localization.layoutDirection)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                // Force a full re-render when language changes so all
                // `LocalizedStringKey` lookups re-evaluate against the new locale.
                .id(localization.language)
        }
    }
}
