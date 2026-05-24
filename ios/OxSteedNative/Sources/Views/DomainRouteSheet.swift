import SwiftUI

struct DomainRouteSheet: View {
    let domain: CapabilityDomain

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(domain.routeFamily, id: \.self) { route in
                        Text(route)
                            .font(.system(.body, design: .monospaced))
                    }
                } header: {
                    Text(domain.title)
                } footer: {
                    Text("These are the website route families this native module must cover. Detail screens should bind directly to the same backend contracts where possible.")
                }
            }
            .navigationTitle("Route Family")
            .toolbar {
                ToolbarItem(placement: .automatic) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
