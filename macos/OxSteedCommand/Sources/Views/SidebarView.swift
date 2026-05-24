import SwiftUI

struct SidebarView: View {
    @Bindable var store: CommandCenterStore

    var body: some View {
        List(selection: $store.selectedSection) {
            ForEach(CommandSection.allCases) { section in
                HStack(spacing: 10) {
                    Image(systemName: section.symbolName)
                        .foregroundStyle(.secondary)
                        .frame(width: 16)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(section.title)
                            .lineLimit(1)
                        Text(section.blurb)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                .tag(Optional(section))
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("OxSteed Command")
    }
}
