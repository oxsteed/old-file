import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: OneStore

    var body: some View {
        Group {
            if store.isAuthenticated {
                mainTabs
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut(duration: 0.35), value: store.isAuthenticated)
    }

    // MARK: - Authenticated shell

    private var mainTabs: some View {
        TabView(selection: $store.selectedTab) {
            HomeView()
                .tabItem { Label(AppTab.home.title, systemImage: AppTab.home.icon) }
                .tag(AppTab.home)

            PlaceholderView(
                tab: .life,
                tint: OneTheme.danger,
                headline: "Your Life Pulse",
                blurb: "Track 6 pillars of life — Health, Wealth, Skills, Network, Family & Purpose — with a personalized urgency queue."
            )
            .tabItem { Label(AppTab.life.title, systemImage: AppTab.life.icon) }
            .tag(AppTab.life)

            PlaceholderView(
                tab: .growth,
                tint: OneTheme.plum,
                headline: "Climb the ladder",
                blurb: "Ascension paths, wholesale groups, grants & financing — everything you need to level up financially."
            )
            .tabItem { Label(AppTab.growth.title, systemImage: AppTab.growth.icon) }
            .tag(AppTab.growth)

            PlaceholderView(
                tab: .learn,
                tint: OneTheme.sky,
                headline: "Academy & Toolkit",
                blurb: "Bite-sized lessons, trending skills and creator bundles — learn while you earn."
            )
            .tabItem { Label(AppTab.learn.title, systemImage: AppTab.learn.icon) }
            .tag(AppTab.learn)
        }
        .tint(OneTheme.accent)
    }
}

#Preview {
    RootView().environmentObject(OneStore())
}
