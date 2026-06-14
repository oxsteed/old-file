import SwiftUI

@main
struct OxSteedRestaurantsKitchenApp: App {
    @StateObject private var store = FoodStore()

    var body: some Scene {
        WindowGroup {
            FoodRootView()
                .environmentObject(store)
                .tint(FoodTheme.flame)
        }
    }
}
