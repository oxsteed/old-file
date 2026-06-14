import SwiftUI

@main
struct OxSteedRestaurantsInventoryApp: App {
    @StateObject private var store = FoodStore()

    var body: some Scene {
        WindowGroup {
            FoodRootView()
                .environmentObject(store)
                .tint(FoodTheme.flame)
        }
    }
}
