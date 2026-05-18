import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            OverviewView()
                .tabItem { Label("Overview", systemImage: "square.grid.2x2.fill") }

            DiscoverNativeView()
                .tabItem { Label("Discover", systemImage: "magnifyingglass.circle.fill") }

            JobsNativeView()
                .tabItem { Label("Jobs", systemImage: "briefcase.fill") }

            HelpersNativeView()
                .tabItem { Label("Helpers", systemImage: "person.crop.circle.badge.checkmark") }

            WorkflowsNativeView()
                .tabItem { Label("Work", systemImage: "plus.circle.fill") }

            AccountView()
                .tabItem { Label("Account", systemImage: "person.crop.circle.fill") }
        }
        .tint(.orange)
    }
}
