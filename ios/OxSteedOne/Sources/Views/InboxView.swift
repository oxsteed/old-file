import SwiftUI

struct InboxView: View {
    @Environment(OneStore.self) private var store
    @State private var newUploadTitle = ""

    var body: some View {
        NavigationStack {
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
                Text("OxSteed Academy")
                    .font(.headline)
                ForEach(store.academyLessons) { lesson in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(lesson.title)
                            .font(.subheadline.weight(.semibold))
                        Text("\(lesson.durationMinutes) min · \(lesson.category)")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 2)
                }
            }

            GoCard {
                Text("Tool Kit Store")
                    .font(.headline)
                ForEach(store.toolkitBundles) { bundle in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(bundle.title)
                            .font(.subheadline.weight(.semibold))
                        Text("Linked lesson: \(bundle.lessonTitle)")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                        Text("Estimated cost: \(currency(bundle.estimatedCost))")
                            .font(.caption2)
                            .foregroundStyle(OneTheme.muted)
                        Link("Open affiliate bundle", destination: URL(string: bundle.affiliateURL) ?? URL(string: "https://www.amazon.com")!)
                            .font(.caption.weight(.semibold))
                    }
                    .padding(.vertical, 3)
                }
            }

            GoCard {
                Text("Trending Skills Near You")
                    .font(.headline)
                ForEach(store.trendingSkills) { skill in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(skill.name)
                                .font(.subheadline.weight(.semibold))
                            Text(skill.city)
                                .font(.caption2)
                                .foregroundStyle(OneTheme.muted)
                        }
                        Spacer()
                        Text("\(skill.learnerCount) learning")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(OneTheme.amber)
                    }
                }
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
                Button("Refresh Translations") {
                    Task { await store.refreshTranslatedPreviews() }
                }
                .buttonStyle(.bordered)

                // Phase 1: show a loading row while the initial inbox fetch is in progress.
                if store.translatedOrOriginalThreads.isEmpty {
                    HStack {
                        ProgressView()
                            .padding(.trailing, 6)
                        Text("Loading conversations…")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 4)
                }
                ForEach(store.translatedOrOriginalThreads) { thread in
                    NavigationLink(destination: InboxThreadView(thread: thread)) {
                        HStack(alignment: .center, spacing: 10) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(thread.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(OneTheme.ink)
                                Text(thread.lastMessage)
                                    .font(.caption)
                                    .foregroundStyle(OneTheme.muted)
                                    .lineLimit(2)
                                Text("Persona: \(thread.personaSource)")
                                    .font(.caption2)
                                    .foregroundStyle(OneTheme.muted)
                            }
                            Spacer()
                            if thread.unreadCount > 0 {
                                Text("\(thread.unreadCount)")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.white)
                                    .frame(minWidth: 22, minHeight: 22)
                                    .background(.red, in: Circle())
                            }
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(OneTheme.muted)
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            }

            GoCard {
                Text("Creator Upload + Moderation")
                    .font(.headline)
                Text(store.canUploadCreatorContent
                     ? "Verified helper/business owner upload is enabled."
                     : "Upload requires verified Helper or Business Owner role.")
                    .font(.caption)
                    .foregroundStyle(store.canUploadCreatorContent ? .green : OneTheme.muted)
                TextField("Upload title", text: $newUploadTitle)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button {
                    Task {
                        await store.addCreatorUpload(title: newUploadTitle)
                        newUploadTitle = ""
                    }
                } label: {
                    if store.isSubmittingCustomerJob {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Submit Upload").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(GoAccentButtonStyle())
                .disabled(!store.canUploadCreatorContent || store.isSubmittingCustomerJob)
                if let msg = store.customerJobFlowMessage {
                    Text(msg).font(.caption).foregroundStyle(.green)
                }
                if let err = store.lastJobError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }

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
        } // NavigationStack
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

    private func currency(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = store.activeLocale
        return formatter.string(from: NSNumber(value: value)) ?? "$0"
    }
}
