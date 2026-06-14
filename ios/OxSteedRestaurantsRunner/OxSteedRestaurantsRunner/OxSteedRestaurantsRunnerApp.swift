import SwiftUI

@main
struct OxSteedRestaurantsRunnerApp: App {
    @StateObject private var store = FoodStore()

    var body: some Scene {
        WindowGroup {
            FoodRootView()
                .environmentObject(store)
                .tint(FoodTheme.flame)
        }
    }
}
