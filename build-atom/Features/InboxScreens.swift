import SwiftUI

// MARK: - Messages

struct InboxView: View {
    @EnvironmentObject var messages: MessagesStore
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var showArchived = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if messages.isLoading && activeList.isEmpty && archivedList.isEmpty {
                        ProgressView()
                            .tint(Theme.accent)
                            .padding(.top, 56)
                    } else if let error = messages.lastError, activeList.isEmpty && archivedList.isEmpty {
                        LoadErrorCard(
                            title: "Messages could not load",
                            message: error,
                            retryTitle: "Try Again"
                        ) {
                            Task { await messages.loadConversations() }
                        }
                        .padding(.top, 28)
                    } else if activeList.isEmpty && archivedList.isEmpty && !showArchived {
                        InboxEmptyState(
                            onFindHelpers: routeToHelperSearch,
                            onPostJob: routeToPostJob
                        )
                        .padding(.top, 28)
                    } else {
                        inboxModePicker
                        if sourceConversations.isEmpty && showArchived {
                            ArchivedInboxEmptyState()
                                .padding(.top, 14)
                        } else if sourceConversations.isEmpty {
                            InboxEmptyState(
                                onFindHelpers: routeToHelperSearch,
                                onPostJob: routeToPostJob
                            )
                            .padding(.top, 14)
                        } else {
                            inboxSearchField
                        }
                    }

                    ForEach(filteredConversations) { c in
                        HStack(spacing: 8) {
                            NavigationLink {
                                ChatThreadView(conversation: c)
                            } label: {
                                ConversationRow(conv: c)
                            }
                            .buttonStyle(.plain)

                            Button {
                                Task {
                                    if showArchived {
                                        await messages.restore(c)
                                    } else {
                                        await messages.archive(c)
                                    }
                                }
                            } label: {
                                Image(systemName: showArchived ? "tray.and.arrow.up.fill" : "archivebox.fill")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(showArchived ? Theme.success : Theme.textSecondary)
                                    .frame(width: 42, height: 42)
                                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(showArchived ? "Restore conversation" : "Archive conversation")
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 16)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Messages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
            Button("common.done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
        .task {
            await messages.loadConversations()
            await messages.loadArchivedConversations()
        }
    }

    private var activeList: [APIConversation] { messages.conversations }
    private var archivedList: [APIConversation] { messages.archivedConversations }
    private var sourceConversations: [APIConversation] {
        showArchived ? archivedList : activeList
    }

    private var filteredConversations: [APIConversation] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return sourceConversations }
        return sourceConversations.filter { conv in
            [conv.other_user_name, conv.job_title, conv.last_message, conv.helper_business_name]
                .compactMap { $0 }
                .contains { $0.localizedCaseInsensitiveContains(query) }
        }
    }

    private var inboxModePicker: some View {
        Picker("Inbox", selection: $showArchived) {
            Text("Active").tag(false)
            Text("Archived").tag(true)
        }
        .pickerStyle(.segmented)
    }

    private var inboxSearchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textTertiary)
            TextField("Search conversations", text: $searchText)
                .font(.system(size: 14, weight: .medium))
                .textInputAutocapitalization(.never)
            if !searchText.isEmpty {
                Button { searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textTertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private func routeToHelperSearch() {
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            NotificationCenter.default.post(name: .oxIntentTriggerHelperSearch, object: nil)
        }
    }

    private func routeToPostJob() {
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            NotificationCenter.default.post(name: .oxIntentTriggerPostJob, object: nil)
        }
    }
}

private struct InboxEmptyState: View {
    let onFindHelpers: () -> Void
    let onPostJob: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .fill(Theme.accentSoft)
                    .frame(width: 76, height: 76)
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }

            VStack(spacing: 6) {
                Text("No conversations yet")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                Text("Messages from helpers, customers, and job replies will show up here.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
            }

            VStack(spacing: 10) {
                Button(action: onFindHelpers) {
                    Label("feature.find_trusted_helpers", systemImage: "person.2.fill")
                        .font(.system(size: 15, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .foregroundStyle(.white)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)

                Button(action: onPostJob) {
                    Label("feature.post_a_job", systemImage: "plus.circle.fill")
                        .font(.system(size: 15, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .foregroundStyle(Theme.accent)
                        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

private struct ArchivedInboxEmptyState: View {
    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Theme.surfaceElevated)
                    .frame(width: 70, height: 70)
                Image(systemName: "archivebox.fill")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
            }
            VStack(spacing: 6) {
                Text("No archived conversations")
                    .font(.system(size: 20, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text("Archived threads stay available here when you need to bring them back.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}


struct ConversationRow: View {
    let conv: APIConversation
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Theme.accentSoft)
                Text(initials).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.accent)
            }.frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(conv.other_user_name ?? localization.localized("spotlight.conversation.title"))
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                Text(conv.last_message ?? "—")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer()
            if let u = conv.unread_count, u > 0 {
                Text("\(u)").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                    .frame(minWidth: 18, minHeight: 18).background(Theme.accent, in: Circle())
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }
    private var initials: String {
        let parts = (conv.other_user_name ?? "?").split(separator: " ")
        return parts.prefix(2).map { String($0.prefix(1)) }.joined().uppercased()
    }
}

struct ChatThreadView: View {
    let conversation: APIConversation
    @EnvironmentObject var messages: MessagesStore
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var localization: LocalizationManager
    @State private var draft = ""
    @State private var attachmentURLs: [String] = []
    @State private var isUploadingAttachment = false

    // Translation state: messageId → translated text
    @State private var translations: [String: String] = [:]
    @State private var translatingIds: Set<String>    = []

    /// When ON, incoming messages whose sender locale differs from the user's locale
    /// are translated automatically on arrival. Persisted per-user in UserDefaults.
    @AppStorage("ox.chat.autoTranslate") private var autoTranslate: Bool = true

    // UGC: report / block (Guideline 1.2)
    @State private var showReportSheet  = false
    @State private var showBlockConfirm = false
    @State private var isBlocking       = false
    @State private var blockError: String?
    @State private var reportSent       = false

    // AI: message summarization + smart replies
    @State private var threadSummary: MessageSummaryResult? = nil
    @State private var isSummarizing   = false
    @State private var showSummaryPanel = false
    @State private var smartReplies: [String] = []

    // Other user ID derived from conversation
    private var otherUserId: Int? {
        if let raw = conversation.other_user_id { return Int(raw) }
        return nil
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        let list = messages.messagesByConversation[conversation.id] ?? []
                        ForEach(list) { m in
                            messageBubble(m).id(m.id)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: messages.messagesByConversation[conversation.id]?.count ?? 0) { _, _ in
                    if let last = messages.messagesByConversation[conversation.id]?.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                    // Auto-translate incoming messages when the setting is enabled
                    if autoTranslate {
                        autoTranslateIncoming()
                    }
                }
            }

            // AI summary panel
            if showSummaryPanel, let s = threadSummary {
                ChatSummaryPanel(
                    summary: s,
                    onSelectReply: { draft = $0 },
                    onDismiss: { withAnimation { showSummaryPanel = false } }
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            // Smart reply chips
            if !smartReplies.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(smartReplies, id: \.self) { reply in
                            Button { draft = reply } label: {
                                Text(reply)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(Theme.accent)
                                    .lineLimit(1)
                                    .padding(.horizontal, 12).padding(.vertical, 7)
                                    .background(Theme.accentSoft, in: Capsule())
                                    .overlay(Capsule().strokeBorder(Theme.accent.opacity(0.3), lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                }
                .background(Theme.surface)
            }

            // Input toolbar
            VStack(spacing: 0) {
                if !attachmentURLs.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(attachmentURLs, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: 8).fill(Theme.surfaceElevated)
                                .frame(width: 44, height: 44)
                                .overlay(Image(systemName: "photo.fill").foregroundStyle(Theme.textTertiary))
                        }
                    }
                    .padding(.horizontal, 12).padding(.top, 8)
                }

                HStack(spacing: 10) {
                    ImagePickerButton(label: "", purpose: "message_attachment",
                                      uploadedURLs: $attachmentURLs,
                                      isUploading: $isUploadingAttachment)
                    .frame(width: 38)

                    // Voice input mic — appends transcription to draft
                    VoiceMicButton(text: $draft, locale: speechLocale(for: localization.bcp47.isEmpty ? "en" : localization.bcp47))
                        .frame(width: 32)

                    TextField("Message", text: $draft, axis: .vertical)
                        .padding(10).background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 18))
                        .foregroundStyle(Theme.textPrimary)

                    Button {
                        let text = draft; let urls = attachmentURLs
                        draft = ""; attachmentURLs = []
                        let attachments = urls.isEmpty ? nil : urls.map { APIAttachment(url: $0, type: "image/jpeg", filename: nil) }
                        Task {
                            do {
                                // Client-side moderation before send
                                try await ContentModerator.check(text, context: "chat_message", locale: localization.bcp47.isEmpty ? "en" : localization.bcp47)
                                await messages.send(conversation.id, content: text, attachments: attachments)
                            } catch let modErr as ContentModerator.Error {
                                if case .blocked(let reason) = modErr {
                                    // Restore draft so the user can edit rather than losing their message
                                    draft = text
                                    blockError = reason
                                }
                            } catch {
                                await messages.send(conversation.id, content: text, attachments: attachments)
                            }
                        }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 30)).foregroundStyle(Theme.accent)
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty && attachmentURLs.isEmpty)
                }
                .padding(12)
            }
            .background(Theme.surface)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(conversation.other_user_name ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        // Safety timer + Report / Block menu
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 4) {
                    // Safety timer — compact shield button
                    SafetyTimerButton()

                    // Chat options menu (translation, summarize, report, block)
                    Menu {
                        // Summarize thread
                        Button {
                            Task { await summarizeThread() }
                        } label: {
                            Label(
                                isSummarizing ? "Summarizing…" : "Summarize Thread",
                                systemImage: "sparkles"
                            )
                        }
                        .disabled(isSummarizing)

                        // Auto-translate toggle
                        Button {
                            autoTranslate.toggle()
                            if autoTranslate { autoTranslateIncoming() }
                        } label: {
                            Label(autoTranslate ? "Auto-Translate: On" : "Auto-Translate: Off",
                                  systemImage: autoTranslate ? "checkmark.circle.fill" : "circle")
                        }
                        Divider()
                        Button(role: .destructive) { showReportSheet = true } label: {
                            Label("chat.report_user", systemImage: "flag.fill")
                        }
                        Button(role: .destructive) { showBlockConfirm = true } label: {
                            Label("chat.block_user", systemImage: "hand.raised.fill")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
        .task {
            await messages.loadMessages(conversation.id)
            if autoTranslate { autoTranslateIncoming() }
        }
        // Report sheet
        .sheet(isPresented: $showReportSheet) {
            ReportUserSheet(
                userId: otherUserId.map { String($0) },
                contentType: "user",
                contentId: conversation.id,
                onDone: { showReportSheet = false; reportSent = true }
            )
            .presentationDetents([.medium])
            .presentationBackground(Theme.background)
        }
        // Block confirmation
        .alert("Block \(conversation.other_user_name ?? "this user")?", isPresented: $showBlockConfirm) {
            Button("common.cancel", role: .cancel) {}
            Button("common.block", role: .destructive) {
                Task { await performBlock() }
            }
        } message: {
            Text("They won't be able to message you and you won't see their content.")
        }
        .alert(Text("chat.block_error_title"), isPresented: Binding(
            get: { blockError != nil },
            set: { if !$0 { blockError = nil } }
        )) {
            Button("common.ok", role: .cancel) { blockError = nil }
        } message: { Text(blockError ?? "") }
        .overlay(alignment: .top) {
            if reportSent {
                Text("chat.report_sent")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Theme.success, in: Capsule())
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 3) { withAnimation { reportSent = false } } }
            }
        }
    }

    private func summarizeThread() async {
        guard OxIntelligenceManager.shared.isAvailable else { return }
        let msgs = messages.messagesByConversation[conversation.id] ?? []
        guard msgs.count >= 3 else { return }
        isSummarizing = true
        defer { isSummarizing = false }
        do {
            let result = try await MessageSummarizer.summarize(
                messages: msgs,
                currentUserName: auth.user?.displayName ?? "You",
                otherPartyName: conversation.other_user_name ?? "Other"
            )
            threadSummary = result
            // Build smart reply chips from suggested reply (split into 3 short options)
            smartReplies = buildSmartReplies(from: result)
            withAnimation { showSummaryPanel = true }
        } catch {
            // Silently fail — summarization is optional
        }
    }

    /// Extracts up to 3 short smart reply options from the AI result.
    private func buildSmartReplies(from result: MessageSummaryResult) -> [String] {
        // Use the suggested reply as the primary chip, plus common contextual responses
        var chips: [String] = []
        let suggested = result.suggestedReply.trimmingCharacters(in: .whitespacesAndNewlines)
        if !suggested.isEmpty { chips.append(suggested) }
        // Add unanswered-question acknowledgements
        if let q = result.unansweredQuestions.first, !q.isEmpty {
            let short = q.hasSuffix("?")
                ? "Let me check on that"
                : "I'll get back to you on that"
            if !chips.contains(short) { chips.append(short) }
        }
        // Generic contextual chip based on sentiment
        let contextual: String
        switch result.sentiment {
        case "tense":    contextual = "Let's work this out"
        case "positive": contextual = "Sounds good!"
        default:         contextual = "Got it, thanks"
        }
        if !chips.contains(contextual) { chips.append(contextual) }
        return Array(chips.prefix(3))
    }

    private func performBlock() async {
        guard let uid = otherUserId else { return }
        isBlocking = true
        defer { isBlocking = false }
        do {
            try await MessagesService.blockUser(uid)
        } catch {
            blockError = "Could not block user. Please try again."
        }
    }

    /// Auto-translates all incoming messages that haven't been translated yet.
    /// Only runs if the user's locale is not English (no-op for EN users since most content is EN).
    /// Each message is translated independently so partial results appear quickly.
    private func autoTranslateIncoming() {
        let myId   = auth.user?.id
        let target = localization.bcp47   // e.g. "es", "fr", "ar", "ht"
        guard target != "en" else { return }  // no need to translate for EN locale
        let list = messages.messagesByConversation[conversation.id] ?? []
        for m in list {
            let isIncoming = m.sender_id != myId
            let notYetTranslated = translations[m.id] == nil
            let notInFlight = !translatingIds.contains(m.id)
            guard isIncoming, notYetTranslated, notInFlight, !m.content.isEmpty else { continue }
            translatingIds.insert(m.id)
            Task {
                defer { translatingIds.remove(m.id) }
                guard let result = try? await TranslationService.translate(m.content, to: target) else { return }
                // Only store if result differs meaningfully (avoids overwriting with identical text)
                if result.trimmingCharacters(in: .whitespaces) != m.content.trimmingCharacters(in: .whitespaces) {
                    translations[m.id] = result
                }
            }
        }
    }

    private func messageBubble(_ m: APIMessage) -> some View {
        let mine = m.sender_id == auth.user?.id
        return VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            HStack {
                if mine { Spacer(minLength: 40) }
                VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                    // Show translated text when available, otherwise original
                    Text(translations[m.id] ?? m.content)
                        .font(.system(size: 14)).foregroundStyle(mine ? .white : Theme.textPrimary)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(mine ? Theme.accent : Theme.surfaceElevated,
                                    in: RoundedRectangle(cornerRadius: 16))
                    // Translate button only on incoming messages
                    if !mine {
                        TranslateButton(
                            messageId: m.id,
                            text: m.content,
                            translations: $translations,
                            loading: $translatingIds
                        )
                        .padding(.leading, 6)
                    }
                }
                if !mine { Spacer(minLength: 40) }
            }
            if let attachments = m.attachments, !attachments.isEmpty {
                HStack {
                    if mine { Spacer() }
                    HStack(spacing: 6) {
                        ForEach(attachments, id: \.url) { _ in
                            RoundedRectangle(cornerRadius: 8).fill(Theme.surfaceElevated)
                                .frame(width: 80, height: 80)
                                .overlay(Image(systemName: "photo").foregroundStyle(Theme.textTertiary))
                        }
                    }
                    if !mine { Spacer() }
                }
            }
        }
    }
}

// MARK: - Chat Summary Panel

private struct ChatSummaryPanel: View {
    let summary: MessageSummaryResult
    let onSelectReply: (String) -> Void
    let onDismiss: () -> Void
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Thread Summary", systemImage: "sparkles")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.purple)
                Spacer()
                Button { onDismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.textTertiary)
                        .font(.system(size: 18))
                }
                .buttonStyle(.plain)
            }

            Text(summary.summary)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textPrimary)

            if !summary.unansweredQuestions.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Unanswered")
                        .font(.system(size: 10, weight: .bold))
                        .tracking(0.8).foregroundStyle(Theme.warning).textCase(.uppercase)
                    ForEach(summary.unansweredQuestions, id: \.self) { q in
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(.system(size: 11)).foregroundStyle(Theme.warning)
                            Text(q).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            }

            // Sentiment indicator
            HStack(spacing: 6) {
                Circle()
                    .fill(sentimentColor)
                    .frame(width: 8, height: 8)
                Text(localization.format("ai.sentiment.tone", localization.localized(summary.sentiment.capitalized)))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(14)
        .background(Theme.surfaceElevated)
        .overlay(
            Rectangle()
                .fill(Color.purple.opacity(0.4))
                .frame(width: 3),
            alignment: .leading
        )
    }

    private var sentimentColor: Color {
        switch summary.sentiment {
        case "positive": return Theme.success
        case "tense":    return Theme.danger
        default:         return Theme.warning
        }
    }
}
