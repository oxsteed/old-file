import SwiftUI

struct ModuleDetailView: View {
    let module: CapabilityModule

    @Environment(MobileExperienceStore.self) private var experience

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 14) {
                    Text(module.domain.title)
                        .font(.caption.bold())
                        .foregroundStyle(module.domain.tint)
                    Text(module.title)
                        .font(.largeTitle.bold())
                    Text(module.summary)
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
                .background(module.domain.tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 28, style: .continuous))

                VStack(alignment: .leading, spacing: 12) {
                    Text("Native Actions")
                        .font(.title2.bold())
                    ForEach(module.actions) { action in
                        ActionRow(action: action, tint: module.domain.tint)
                    }
                }

                NavigationLink {
                    NativeWorkspaceView(module: module)
                } label: {
                    Label("Open Native Workspace", systemImage: "iphone.gen3")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(module.domain.tint)

                Button {
                    experience.selectedDomain = module.domain
                } label: {
                    Label("Show Website Route Family", systemImage: "point.3.connected.trianglepath.dotted")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(module.domain.tint)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Primary Route")
                        .font(.headline)
                    Text(module.primaryRoute)
                        .font(.system(.body, design: .monospaced))
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(AppTheme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .padding()
        }
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(module.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private struct ActionRow: View {
    let action: CapabilityAction
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(action.title)
                    .font(.headline)
                Spacer()
                if action.requiresAuth {
                    Label("Auth", systemImage: "lock.fill")
                        .font(.caption.bold())
                        .foregroundStyle(tint)
                }
            }

            Text(action.detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text(action.endpointHint)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.vertical, 6)
                .padding(.horizontal, 8)
                .background(tint.opacity(0.12), in: Capsule())
        }
        .padding()
        .background(AppTheme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
