import SwiftUI

struct OxSteedRootView: View {
    @Environment(MobileExperienceStore.self) private var experience

    var body: some View {
        @Bindable var experience = experience

        TabView(selection: $experience.selectedTab) {
            ForEach(OxSteedTab.allCases) { tab in
                NavigationStack {
                    if tab == .account {
                        AccountSurfaceView()
                        ModuleListView(tab: tab)
                    } else {
                        ModuleListView(tab: tab)
                    }
                }
                .tabItem {
                    Label(tab.title, systemImage: tab.symbolName)
                }
                .tag(tab)
            }
        }
    }
}

#Preview {
    OxSteedRootView()
        .environment(SessionStore())
        .environment(MobileExperienceStore())
}
