import SwiftUI

/// Full chat thread view for a single conversation.
/// Loads message history on appear, auto-scrolls to the latest message,
/// and sends new messages via OneStore.sendMessage.
struct InboxThreadView: View {
    @Environment(OneStore.self) private var store
    let thread: UnifiedThread

    @State private var messages: [OneMessage] = []
    @State private var messageInput = ""
    @State private var isLoadingMessages = false
    @State private var isSending = false

    var body: some View {
        VStack(spacing: 0) {
            messageList
            sendBar
        }
        .navigationTitle(thread.title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { loadHistory() }
    }

    // MARK: - Message list with auto-scroll

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if isLoadingMessages {
                        HStack {
                            Spacer()
                            ProgressView()
                                .padding()
                            Spacer()
                        }
                    }

                    ForEach(messages) { message in
                        messageBubble(message)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .onChange(of: messages) { _, _ in
                if let lastID = messages.last?.id {
                    withAnimation(.easeOut(duration: 0.25)) {
                        proxy.scrollTo(lastID, anchor: .bottom)
                    }
                }
            }
            .onAppear {
                if let lastID = messages.last?.id {
                    proxy.scrollTo(lastID, anchor: .bottom)
                }
            }
        }
    }

    // MARK: - Individual message bubble

    private func messageBubble(_ message: OneMessage) -> some View {
        let isOutgoing = message.senderID == (store.currentUserID ?? "")
        return HStack(alignment: .bottom, spacing: 8) {
            if isOutgoing { Spacer(minLength: 48) }

            VStack(alignment: isOutgoing ? .trailing : .leading, spacing: 3) {
                if !isOutgoing {
                    Text(message.senderName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(OneTheme.muted)
                        .padding(.leading, 4)
                }

                Text(message.content)
                    .font(.subheadline)
                    .foregroundStyle(isOutgoing ? .black : OneTheme.ink)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        isOutgoing
                            ? OneTheme.amber
                            : Color.white.opacity(0.10),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )

                Text(shortTime(message.createdAt))
                    .font(.caption2)
                    .foregroundStyle(OneTheme.muted)
                    .padding(.horizontal, 4)
            }

            if !isOutgoing { Spacer(minLength: 48) }
        }
    }

    // MARK: - Send bar

    private var sendBar: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message…", text: $messageInput, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .disabled(isSending)

            Button(action: submitMessage) {
                if isSending {
                    ProgressView()
                        .frame(width: 32, height: 32)
                } else {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 36, height: 36)
                        .foregroundStyle(
                            messageInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                ? OneTheme.muted
                                : OneTheme.amber
                        )
                }
            }
            .disabled(messageInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(OneTheme.card)
    }

    // MARK: - Actions

    private func loadHistory() {
        Task {
            isLoadingMessages = true
            messages = await store.fetchMessageHistory(threadID: thread.id)
            isLoadingMessages = false
        }
    }

    private func submitMessage() {
        let trimmed = messageInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        messageInput = ""
        isSending = true

        // Optimistic local bubble so UI feels instant
        let optimistic = OneMessage(
            id: "local-\(UUID().uuidString)",
            threadID: thread.id,
            senderID: store.currentUserID ?? "",
            senderName: "You",
            content: trimmed,
            personaSource: store.activePersona.label,
            createdAt: iso8601Now(),
            isRead: true
        )
        messages.append(optimistic)

        Task {
            await store.sendMessage(
                threadID: thread.id,
                content: trimmed,
                persona: store.activePersona
            )
            isSending = false
        }
    }

    // MARK: - Helpers

    /// Formats an ISO8601 timestamp to a short time string like "3:42 PM".
    private func shortTime(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) {
            let display = DateFormatter()
            display.dateStyle = .none
            display.timeStyle = .short
            return display.string(from: date)
        }
        // Fallback: try without fractional seconds
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: iso) {
            let display = DateFormatter()
            display.dateStyle = .none
            display.timeStyle = .short
            return display.string(from: date)
        }
        return ""
    }

    /// Returns the current time as an ISO8601 string, used for optimistic local messages.
    private func iso8601Now() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }
}
