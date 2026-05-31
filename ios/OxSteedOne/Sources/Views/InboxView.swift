import SwiftUI

struct InboxView: View {
    @Environment(OneStore.self) private var store
    @State private var newUploadTitle = ""

    var body: some View {
        NavigationStack {
        GoScreen(title: store.localized("inbox.page_title", fallback: "Learn"), showsTitle: true) {
            GoCard {
                HStack {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(store.localized("inbox.academy_title", fallback: "OxSteed Academy"))
                            .font(.headline)
                        Text(store.localized("inbox.academy_subtitle", fallback: "Short, practical lessons tied to action and monetization."))
                            .font(.footnote)
                            .foregroundStyle(OneTheme.muted)
                    }
                    Spacer()
                    OxSteedOneMark(size: 44)
                }
            }

            GoCard {
                learnItem(
                  store.localized("inbox.learn_lessons_title", fallback: "Academy Lessons"),
                  store.localized("inbox.learn_lessons_detail", fallback: "5–15 minute practical videos"),
                  "play.rectangle.fill"
                )
                learnItem(
                  store.localized("inbox.tool_kit_store_title", fallback: "Tool Kit Store"),
                  store.localized("inbox.tool_kit_store_detail", fallback: "Affiliate bundles linked to what you just learned"),
                  "bag.fill"
                )
                learnItem(
                  store.localized("inbox.creator_upload_title", fallback: "Creator Upload"),
                  store.localized("inbox.creator_upload_detail", fallback: "Verified experts can upload and earn"),
                  "camera.fill"
                )
                learnItem(
                  store.localized("inbox.trending_skills_title", fallback: "Trending Skills"),
                  store.localized("inbox.trending_skills_detail", fallback: "Regional demand signals for better earnings"),
                  "chart.bar.fill"
                )
            }

            GoCard {
                Text(store.localized("inbox.academy_title", fallback: "OxSteed Academy"))
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
                Text(store.localized("inbox.tool_kit_store_title", fallback: "Tool Kit Store"))
                    .font(.headline)
                ForEach(store.toolkitBundles) { bundle in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(bundle.title)
                            .font(.subheadline.weight(.semibold))
                        Text("\(store.localized("inbox.bundle_link_label", fallback: "Linked lesson:")) \(bundle.lessonTitle)")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                        Text("Estimated cost: \(currency(bundle.estimatedCost))")
                            .font(.caption2)
                            .foregroundStyle(OneTheme.muted)
                        Link(store.localized("inbox.open_affiliate_bundle", fallback: "Open affiliate bundle"), destination: URL(string: bundle.affiliateURL) ?? URL(string: "https://www.amazon.com")!)
                            .font(.caption.weight(.semibold))
                    }
                    .padding(.vertical, 3)
                }
            }

            GoCard {
                Text(store.localized("inbox.trending_skills_near_you", fallback: "Trending Skills Near You"))
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
                HStack {
                    Text(store.localized("inbox.unified_inbox", fallback: "Unified Inbox"))
                        .font(.headline)
                    Spacer()
                    Button(store.localized("home.sync_live_data", fallback: "Sync Live Data")) {
                        Task {
                            await store.fetchUnifiedInbox()
                            if store.autoTranslateEnabled {
                                await store.refreshTranslatedPreviews()
                            }
                        }
                    }
                    .buttonStyle(.bordered)
                }
                Text(store.localized("inbox.unified_inbox_help", fallback: "Threads remain unified across persona switching."))
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)

                Toggle(store.localized("profile.auto_translate_previews", fallback: "Auto-translate inbox previews"), isOn: Binding(
                    get: { store.autoTranslateEnabled },
                    set: { store.setAutoTranslate($0) }
                ))
                Button(store.localized("inbox.refresh_translations", fallback: "Refresh Translations")) {
                    Task { await store.refreshTranslatedPreviews() }
                }
                .buttonStyle(.bordered)

                // Phase 1: show a loading row while the initial inbox fetch is in progress.
                if store.translatedOrOriginalThreads.isEmpty {
                    HStack {
                        ProgressView()
                            .padding(.trailing, 6)
                        Text(store.localized("inbox.loading_conversations", fallback: "Loading conversations…"))
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
                                Text("\(store.localized("inbox.persona_prefix", fallback: "Persona:")) \(thread.personaSource)")
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
                Text(store.localized("inbox.creator_upload_moderation", fallback: "Creator Upload + Moderation"))
                    .font(.headline)
                Text(store.canUploadCreatorContent
                     ? store.localized("inbox.creator_upload_enabled", fallback: "Verified helper/business owner upload is enabled.")
                     : store.localized("inbox.creator_upload_requires_role", fallback: "Upload requires verified Helper or Business Owner role.")
                    .font(.caption)
                    .foregroundStyle(store.canUploadCreatorContent ? .green : OneTheme.muted)
                TextField(store.localized("inbox.upload_title_placeholder", fallback: "Upload title"), text: $newUploadTitle)
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
                        Text(store.localized("inbox.submit_upload", fallback: "Submit Upload")).frame(maxWidth: .infinity)
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
                        Text("\(store.localized("inbox.language_label", fallback: "Language:")) \(item.language.label)")
                            .font(.caption2)
                            .foregroundStyle(OneTheme.muted)
                        HStack {
                            Button(store.localized("inbox.approve", fallback: "Approve")) {
                                store.setCreatorUploadStatus(item.id, status: .approved)
                            }
                            .buttonStyle(.bordered)
                            Button(store.localized("inbox.reject", fallback: "Reject")) {
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
        .task {
            await store.fetchUnifiedInbox()
            if store.autoTranslateEnabled {
                await store.refreshTranslatedPreviews()
            }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15 * 1_000_000_000)
                if Task.isCancelled { break }
                await store.fetchUnifiedInbox()
                if store.autoTranslateEnabled {
                    await store.refreshTranslatedPreviews()
                }
            }
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

    private func currency(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = store.activeLocale
        return formatter.string(from: NSNumber(value: value)) ?? "$0"
    }
}
