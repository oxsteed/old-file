import SwiftUI

struct SettingsView: View {
    @Bindable var store: CommandCenterStore

    var body: some View {
        Form {
            Section("Operator") {
                TextField("Operator name", text: $store.operatorName)
                TextField("Primary API base URL", text: $store.apiBaseURL)
            }

            Section("Why this app exists") {
                Text("This first macOS release is the super-admin desk for OxSteed: a native control plane that keeps the highest-impact initiatives visible, actionable, and ready for live API wiring.")
                    .foregroundStyle(.secondary)
            }

            Section("Actions") {
                Button("Open OxSteed Website") {
                    ExternalNavigator.openWebsite()
                }
                Button("Open Admin Login") {
                    ExternalNavigator.openDashboard()
                }
            }
        }
        .formStyle(.grouped)
        .padding(18)
    }
}
