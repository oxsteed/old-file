import SwiftUI

public struct OxSteedRestaurantsCrewShell: View {
    @StateObject private var store = FoodStore()

    public init() {}

    public var body: some View {
        FoodRootView()
            .environmentObject(store)
            .tint(FoodTheme.flame)
    }
}
