import SwiftUI

struct GoRootView: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        @Bindable var store = store

        TabView(selection: $store.selectedTab) {
            ForEach(GoTab.allCases) { tab in
                NavigationStack {
                    switch tab {
                    case .today:
                        TodayView()
                    case .hire:
                        HireView()
                    case .shop:
                        ShopView()
                    case .inbox:
                        InboxView()
                    case .profile:
                        ProfileView()
                    }
                }
                .tabItem {
                    Label(tab.localizedTitle(store.appLanguage), systemImage: tab.symbolName)
                }
                .tag(tab)
            }
        }
        .task {
            await store.restoreSession()
        }
    }
}

#Preview {
    GoRootView()
        .environment(GoStore())
}
