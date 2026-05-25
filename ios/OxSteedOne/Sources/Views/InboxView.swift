import SwiftUI

struct InboxView: View {
    @Environment(OneStore.self) private var store
    @State private var newUploadTitle = ""

    var body: some View {
        GoScreen(title: "Learn", showsTitle: true) {
            GoCard {
                HStack {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("OxSteed Academy")
                            .font(.headline)
                        Text("Short, practical lessons tied to action and monetization.")
                            .font(.footnote)
                            .foregroundStyle(OneTheme.muted)
                    }
                    Spacer()
                    OxSteedOneMark(size: 44)
                }
            }

            GoCard {
                learnItem("Academy Lessons", "5–15 minute practical videos", "play.rectangle.fill")
                learnItem("Tool Kit Store", "Affiliate bundles linked to what you just learned", "bag.fill")
                learnItem("Creator Upload", "Verified experts can upload and earn", "camera.fill")
                learnItem("Trending Skills", "Regional demand signals for better earnings", "chart.bar.fill")
            }

            GoCard {
                Text("Unified Inbox")
                    .font(.headline)
                Text("Threads remain unified across persona switching.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)

                Toggle("Auto-translate previews", isOn: Binding(
                    get: { store.autoTranslateEnabled },
                    set: { store.setAutoTranslate($0) }
                ))

                ForEach(store.filteredUnifiedThreads) { thread in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(thread.title)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(thread.unreadCount)")
                                .font(.caption.weight(.bold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(OneTheme.amber.opacity(0.2), in: Capsule())
                        }
                        Text(thread.lastMessage)
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                        Text("Persona: \(thread.personaSource)")
                            .font(.caption2)
                            .foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 4)
                }
            }

            GoCard {
                Text("Persona + Role Settings")
                    .font(.headline)
                Text("Manage persona and business sub-role from settings.")
                    .font(.footnote)
                    .foregroundStyle(OneTheme.muted)

                Button("Open Persona Settings") {
                    store.showPersonaSheet = true
                }
                .buttonStyle(GoAccentButtonStyle())
            }

            GoCard {
                Text("Creator Upload + Moderation")
                    .font(.headline)
                TextField("Upload title", text: $newUploadTitle)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button("Submit Upload") {
                    store.addCreatorUpload(title: newUploadTitle)
                    newUploadTitle = ""
                }
                .buttonStyle(GoAccentButtonStyle())

                ForEach(store.creatorUploads) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(item.title)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(item.status.rawValue.capitalized)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(item.status == .approved ? .green : (item.status == .rejected ? .red : OneTheme.amber))
                        }
                        Text("Language: \(item.language.label)")
                            .font(.caption2)
                            .foregroundStyle(OneTheme.muted)
                        HStack {
                            Button("Approve") {
                                store.setCreatorUploadStatus(item.id, status: .approved)
                            }
                            .buttonStyle(.bordered)
                            Button("Reject") {
                                store.setCreatorUploadStatus(item.id, status: .rejected)
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(.vertical, 3)
                }
            }
        }
        .sheet(isPresented: Binding(
            get: { store.showPersonaSheet },
            set: { store.showPersonaSheet = $0 }
        )) {
            ProfileView()
                .environment(store)
        }
    }

    private func learnItem(_ title: String, _ detail: String, _ icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(OneTheme.amber)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }
        }
        .padding(.vertical, 4)
    }
}
