import SwiftUI

struct InboxView: View {
    @Environment(GoStore.self) private var store

    private let threads = [
        ("Carter Plumbing", "Can you confirm the shutoff valve photo?", "2m"),
        ("OxSteed Support", "Your invoice question was escalated.", "18m"),
        ("Fence Repair Bid", "Two helpers updated their estimates.", "1h"),
        ("Logistics Campaign", "Shipment milestone added.", "3h")
    ]

    var body: some View {
        GoScreen(title: GoLocalization.text(.inbox, language: store.appLanguage)) {
            GoCard {
                Text("One Inbox")
                    .font(.largeTitle.bold())
                Text("Job messages, helper chats, support escalations, business conversations, and logistics updates live together here.")
                    .foregroundStyle(.secondary)
                Toggle("Auto-translate messages", isOn: Binding(
                    get: { store.autoTranslateMessages },
                    set: { store.setAutoTranslateMessages($0) }
                ))
                Picker("Message language", selection: Binding(
                    get: { store.appLanguage },
                    set: { store.setLanguage($0) }
                )) {
                    ForEach(GoLanguage.allCases) { language in
                        Text(language.label).tag(language)
                    }
                }
                .pickerStyle(.menu)
                if store.autoTranslateMessages {
                    Text("Messages from people who use another language are translated to \(store.appLanguage.translatorLabel) by default. You can still view the original.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Button("Load Conversations") {
                    Task { await store.loadConversations() }
                }
                .buttonStyle(.borderedProminent)
                .tint(GoTheme.sea)
            }

            switch store.conversations {
            case .idle:
                ForEach(threads, id: \.0) { thread in
                    ThreadRow(title: thread.0, message: thread.1, trailing: thread.2)
                }
            case .loading:
                GoCard { ProgressView("Loading inbox") }
            case .failed(let message):
                GoCard {
                    Text(store.isSignedIn ? message : "Sign in to load your live inbox.")
                        .foregroundStyle(store.isSignedIn ? .red : .secondary)
                }
            case .loaded(let conversations):
                if conversations.isEmpty {
                    GoCard { ContentUnavailableView("No conversations", systemImage: "bubble.left", description: Text("New job and booking messages will appear here.")) }
                } else {
                    if case .loading = store.messageTranslationState {
                        GoCard { ProgressView("Translating messages") }
                    }
                    ForEach(store.displayedConversations.prefix(20)) { conversation in
                        ThreadRow(conversation: conversation)
                    }
                }
            }
        }
        .task {
            await store.loadConversations()
        }
    }
}

private struct ThreadRow: View {
    let conversation: GoMessageDisplay
    @State private var showOriginal = false

    var body: some View {
        GoCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .foregroundStyle(GoTheme.sea)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(conversation.title)
                            .font(.headline)
                        Text(showOriginal ? conversation.originalMessage : (conversation.translatedMessage ?? conversation.originalMessage))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if conversation.unreadCount > 0 {
                        Text("\(conversation.unreadCount)")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .padding(7)
                            .background(GoTheme.sea, in: Circle())
                    }
                }

                if conversation.hasTranslation {
                    HStack {
                        Label("Translated", systemImage: "globe")
                            .font(.caption.bold())
                            .foregroundStyle(GoTheme.sea)
                        Spacer()
                        Button(showOriginal ? "Show translation" : "Show original") {
                            showOriginal.toggle()
                        }
                        .font(.caption.bold())
                    }
                }
            }
        }
    }
}

private extension ThreadRow {
    init(title: String, message: String, trailing: String) {
        self.conversation = GoMessageDisplay(
            id: title.hashValue,
            title: title,
            originalMessage: message,
            translatedMessage: nil,
            unreadCount: Int(trailing) ?? 0
        )
    }
}
