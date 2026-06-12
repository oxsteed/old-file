import SwiftUI

@main
struct OxSteedFoodApp: App {
    @StateObject private var store = FoodStore()

    var body: some Scene {
        WindowGroup {
            FoodRootView()
                .environmentObject(store)
                .tint(FoodTheme.flame)
        }
    }
}
