import SwiftUI

// MARK: - Notifications

struct NotificationsView: View {
    @EnvironmentObject var notifications: NotificationsStore
    @State private var selectedJob: APIJob?
    @State private var selectedConversation: APIConversation?
    @State private var showPayments = false
    @State private var showCalendar = false
    @State private var showSettings = false
    @State private var targetError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    if let error = notifications.lastError, notifications.items.isEmpty {
                        LoadErrorCard(
                            title: "Notifications could not load",
                            message: error,
                            retryTitle: "Try Again"
                        ) {
                            Task { await notifications.load() }
                        }
                        .padding(.top, 28)
                    } else if notifications.items.isEmpty {
                        Text("No notifications yet")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 40)
                    }

                    if let targetError {
                        Text(targetError)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            .background(Theme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    }

                    ForEach(notifications.items) { n in
                        Button {
                            Task {
                                targetError = nil
                                await notifications.markRead(n.id)
                                await openNotification(n)
                            }
                        } label: {
                            NotificationRow(notification: n)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .task { await notifications.load() }
        .sheet(item: $selectedJob) { job in
            NavigationStack { JobDetailView(job: job) }
                .presentationBackground(Theme.background)
        }
        .sheet(item: $selectedConversation) { conversation in
            NavigationStack { ChatThreadView(conversation: conversation) }
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showPayments) {
            PaymentsView()
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showCalendar) {
            CalendarView()
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showSettings) {
            SettingsSheet()
                .presentationBackground(Theme.background)
        }
    }

    private func openNotification(_ notification: APINotification) async {
        if let jobId = notification.data?.string("job_id") ?? notification.idFromActionURL(prefix: "jobs") {
            await openJob(jobId)
            return
        }

        if let conversationId = notification.data?.string("conversationId")
            ?? notification.data?.string("conversation_id")
            ?? notification.idFromActionURL(prefix: "messages") {
            await openConversation(conversationId)
            return
        }

        let route = notification.routeHint
        if route.contains("payment") || route.contains("payout") || route.contains("wallet") {
            showPayments = true
            return
        }
        if route.contains("appointment") || route.contains("booking") || route.contains("calendar") {
            showCalendar = true
            return
        }
        if route.contains("settings") {
            showSettings = true
            return
        }

        targetError = "This notification is saved, but there is no in-app destination for it yet."
    }

    private func openJob(_ jobId: String) async {
        do {
            selectedJob = try await JobsService.detail(jobId)
        } catch {
            targetError = "That job notification could not be opened. Pull to refresh and try again."
        }
    }

    private func openConversation(_ conversationId: String) async {
        do {
            selectedConversation = try await MessagesService.conversationMeta(conversationId)
        } catch {
            targetError = "That message notification could not be opened. Pull to refresh and try again."
        }
    }
}

private struct NotificationRow: View {
    let notification: APINotification

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(color.opacity(0.18))
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(color)
            }
            .frame(width: 40, height: 40)

            VStack(alignment: .leading, spacing: 4) {
                Text(notification.title ?? "Notification")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                if let msg = notification.message, !msg.isEmpty {
                    Text(msg)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                if let created = notification.created_at {
                    Text(created.prefix(10))
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.top, 2)
                }
            }
            Spacer()

            if notification.is_read != true {
                Circle().fill(Theme.accent).frame(width: 8, height: 8).padding(.top, 6)
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private var icon: String {
        let t = (notification.type ?? "").lowercased()
        if t.contains("bid") { return "hand.raised.fill" }
        if t.contains("message") { return "envelope.fill" }
        if t.contains("job") { return "hammer.fill" }
        if t.contains("appointment") || t.contains("booking") { return "calendar" }
        if t.contains("payment") { return "creditcard.fill" }
        return "bell.fill"
    }

    private var color: Color {
        let t = (notification.type ?? "").lowercased()
        if t.contains("bid") { return Theme.pillarGoals }
        if t.contains("message") { return Theme.accent }
        if t.contains("job") { return Theme.pillarHome }
        if t.contains("appointment") || t.contains("booking") { return Theme.pillarCar }
        if t.contains("payment") { return Theme.success }
        return Theme.textSecondary
    }
}

private extension Dictionary where Key == String, Value == AnyDecodable {
    func string(_ key: String) -> String? {
        guard let v = self[key]?.value else { return nil }
        if let s = v as? String { return s }
        if let i = v as? Int { return String(i) }
        return nil
    }
}

private extension APINotification {
    var routeHint: String {
        [
            type,
            action_url,
            data?.string("action_url"),
            data?.string("url"),
            data?.string("route"),
            data?.string("screen"),
        ]
        .compactMap { $0 }
        .joined(separator: " ")
        .lowercased()
    }

    func idFromActionURL(prefix: String) -> String? {
        let candidates = [action_url, data?.string("action_url"), data?.string("url")]
            .compactMap { $0 }
        for candidate in candidates {
            let parts = candidate
                .split(separator: "?")[0]
                .split(separator: "#")[0]
                .split(separator: "/")
                .map(String.init)
            if let index = parts.firstIndex(of: prefix), parts.indices.contains(index + 1) {
                return parts[index + 1]
            }
        }
        return nil
    }
}
