import SwiftUI

struct ContentView: View {
    @Bindable var store: CommandCenterStore

    var body: some View {
        NavigationSplitView {
            SidebarView(store: store)
        } detail: {
            DetailSurfaceView(store: store)
        }
        .navigationSplitViewStyle(.balanced)
        .searchable(text: $store.searchText, prompt: "Search initiatives, evidence, or next moves")
        .toolbar {
            ToolbarItemGroup {
                Button {
                    store.refreshSnapshot()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }

                Button {
                    ExternalNavigator.openDashboard()
                } label: {
                    Label("Admin Login", systemImage: "arrow.up.right.square")
                }
            }
        }
    }
}
