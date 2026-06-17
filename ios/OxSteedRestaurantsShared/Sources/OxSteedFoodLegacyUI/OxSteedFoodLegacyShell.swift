import SwiftUI

public struct OxSteedFoodLegacyShell: View {
    @StateObject private var store = FoodStore()

    public init() {}

    public var body: some View {
        FoodRootView()
            .environmentObject(store)
            .tint(FoodTheme.flame)
    }
}
