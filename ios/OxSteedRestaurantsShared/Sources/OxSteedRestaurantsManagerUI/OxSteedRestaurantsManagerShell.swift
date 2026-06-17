import SwiftUI

public struct OxSteedRestaurantsManagerShell: View {
    @StateObject private var store = FoodStore()

    public init() {}

    public var body: some View {
        FoodRootView()
            .environmentObject(store)
            .tint(FoodTheme.flame)
    }
}
