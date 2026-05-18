import SwiftUI

struct RootView: View {
    @Binding var hasSeenIntro: Bool

    var body: some View {
        if hasSeenIntro {
            MainTabView()
        } else {
            IntroView(hasSeenIntro: $hasSeenIntro)
        }
    }
}
