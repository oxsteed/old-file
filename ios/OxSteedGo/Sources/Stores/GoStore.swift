import Foundation
import Observation

@Observable
final class GoStore {
    var selectedTab: GoTab = .today
    var mode: GoMode = .customer
    var searchText = ""
    var draftJob = GoDraftJob()
    var savedJobMessage: String?
    var email = ""
    var password = ""
    var twoFactorCode = ""
    var authMessage: String?
    var currentUser: GoAuthUser?
    var mobileFeed: GoResourceState<GoMobileFeed> = .idle
    var nearbyHelpers: GoResourceState<[HelperProfile]> = .idle
    var products: GoResourceState<[Product]> = .idle
    var conversations: GoResourceState<[Conversation]> = .idle
    var logisticsRequests: GoResourceState<[LogisticsRequest]> = .idle
    var offlineQueue: [GoOfflineAction] = []
    var appLanguage: GoLanguage = GoSessionVault.loadLanguage()
    var autoTranslateMessages = GoSessionVault.loadAutoTranslate()
    var translatedMessages: [Int: String] = [:]
    var messageTranslationState: GoResourceState<[Int: String]> = .idle

    private let api = GoAPIClient()

    var isSignedIn: Bool {
        currentUser != nil && api.token != nil
    }

    var heroTitle: String {
        switch mode {
        case .customer:
            "Get real work handled"
        case .helper:
            "Win better local jobs"
        case .business:
            "Run the front desk"
        case .logistics:
            "Move group buys cleanly"
        }
    }

    var heroSubtitle: String {
        switch mode {
        case .customer:
            "Post a job, book a trusted pro, shop the right supplies, and keep the whole conversation in one pocket-sized command center."
        case .helper:
            "See nearby opportunities, incoming bookings, customer messages, earnings nudges, and profile tasks without hunting through the full platform."
        case .business:
            "Manage appointments, services, quotes, invoices, intake requests, team basics, and customer messages from a lighter business-owner view."
        case .logistics:
            "Track sourcing requests, campaigns, shipments, and buyer actions from the simpler OxSteed Go surface."
        }
    }

    var metrics: [GoMetric] {
        if case .loaded(let feed) = mobileFeed, let summary = feed.summary {
            return [
                GoMetric(label: "Open jobs", value: "\(summary.openJobs ?? 0)", symbolName: "hammer"),
                GoMetric(label: "Bookings", value: "\(summary.incomingBookingRequests ?? 0)", symbolName: "calendar"),
                GoMetric(label: "Unread", value: "\(summary.unreadMessages ?? 0)", symbolName: "bubble.left")
            ]
        }

        switch mode {
        case .customer:
            return [
                GoMetric(label: "Open jobs", value: "2", symbolName: "hammer"),
                GoMetric(label: "Upcoming", value: "3", symbolName: "calendar"),
                GoMetric(label: "Unread", value: "5", symbolName: "bubble.left")
            ]
        case .helper:
            return [
                GoMetric(label: "Leads", value: "8", symbolName: "briefcase"),
                GoMetric(label: "Bookings", value: "4", symbolName: "checkmark.seal"),
                GoMetric(label: "Profile", value: "86%", symbolName: "person.text.rectangle")
            ]
        case .business:
            return [
                GoMetric(label: "Appointments", value: "7", symbolName: "calendar.badge.clock"),
                GoMetric(label: "Quotes", value: "3", symbolName: "doc.text"),
                GoMetric(label: "Intakes", value: "5", symbolName: "tray.full")
            ]
        case .logistics:
            return [
                GoMetric(label: "Requests", value: "6", symbolName: "shippingbox"),
                GoMetric(label: "Campaigns", value: "2", symbolName: "person.3"),
                GoMetric(label: "Alerts", value: "1", symbolName: "exclamationmark.triangle")
            ]
        }
    }

    var primaryActions: [GoAction] {
        [
            GoAction(
                id: "post-job",
                title: "Post a job",
                detail: "Describe the work, location, urgency, and budget in a native quick-post flow.",
                symbolName: "square.and.pencil",
                tint: .orange,
                route: "/post-job"
            ),
            GoAction(
                id: "find-helper",
                title: "Find a helper",
                detail: "Search trusted local helpers and start a booking or message.",
                symbolName: "person.2.wave.2",
                tint: .teal,
                route: "/helpers"
            ),
            GoAction(
                id: "shop-list",
                title: "Shop the list",
                detail: "Browse skill-aware supplies and tools for the job you are planning.",
                symbolName: "bag",
                tint: .green,
                route: "/products"
            ),
            GoAction(
                id: "messages",
                title: "Open inbox",
                detail: "Keep job, booking, support, and business conversations together.",
                symbolName: "bubble.left.and.bubble.right",
                tint: .blue,
                route: "/messages"
            )
        ]
    }

    var tasks: [GoTask] {
        if case .loaded(let feed) = mobileFeed {
            var liveTasks: [GoTask] = []
            liveTasks.append(contentsOf: (feed.jobs?.mine ?? []).prefix(2).map {
                GoTask(title: $0.title ?? "Untitled job", subtitle: [$0.status, $0.categoryName].compactMap { $0 }.joined(separator: " · "), badge: "Job")
            })
            liveTasks.append(contentsOf: (feed.appointments ?? []).prefix(2).map {
                GoTask(title: $0.title ?? "Appointment", subtitle: $0.scheduledStartTime ?? "Scheduled", badge: $0.status ?? "Calendar")
            })
            liveTasks.append(contentsOf: (feed.plannedNeeds ?? []).prefix(2).map {
                GoTask(title: $0.title ?? "Planned need", subtitle: $0.dueDate ?? $0.category ?? "Planned", badge: $0.status ?? "Need")
            })
            if !liveTasks.isEmpty {
                return liveTasks
            }
        }

        return [
            GoTask(title: "Confirm tomorrow's appointment", subtitle: "Sink repair with Carter Plumbing", badge: "Today"),
            GoTask(title: "Review two new bids", subtitle: "Back fence repair", badge: "Action"),
            GoTask(title: "Add photos to your request", subtitle: "Garage shelf install", badge: "Improve match"),
            GoTask(title: "Pay invoice draft", subtitle: "OxSteed invoice INV-1042", badge: "Payment")
        ]
    }

    func saveDraftJob() {
        let trimmed = draftJob.title.trimmingCharacters(in: .whitespacesAndNewlines)
        savedJobMessage = trimmed.isEmpty ? "Add a title before saving this job draft." : "Saved '\(trimmed)' as a native job draft."
    }

    @MainActor
    func restoreSession() async {
        guard let saved = GoSessionVault.load() else { return }
        api.token = saved.token
        currentUser = saved.user
        mode = GoMode(rawValue: saved.user?.defaultMode ?? "") ?? mode
        await refreshEverything()
    }

    @MainActor
    func signIn() async {
        authMessage = nil
        do {
            let request = GoLoginRequest(
                email: email,
                password: password,
                twoFactorCode: twoFactorCode.isEmpty ? nil : twoFactorCode
            )
            let response: GoAuthResponse = try await api.post("/auth/login", body: request)
            if response.requiresTwoFactor == true {
                authMessage = "Enter your two-factor code to finish signing in."
                return
            }
            guard let token = response.token else {
                authMessage = "OxSteed did not return a session token."
                return
            }
            api.token = token
            currentUser = response.user
            GoSessionVault.save(GoSavedSession(token: token, refreshToken: response.refreshToken, user: response.user))
            await refreshEverything()
        } catch {
            authMessage = error.localizedDescription
        }
    }

    @MainActor
    func signOut() {
        api.token = nil
        currentUser = nil
        GoSessionVault.clear()
        mobileFeed = .idle
        conversations = .idle
        logisticsRequests = .idle
    }

    func setLanguage(_ language: GoLanguage) {
        appLanguage = language
        GoSessionVault.saveLanguage(language)
        translatedMessages = [:]
        messageTranslationState = .idle
        if autoTranslateMessages {
            Task { await translateLoadedConversationsIfNeeded() }
        }
    }

    func setAutoTranslateMessages(_ enabled: Bool) {
        autoTranslateMessages = enabled
        GoSessionVault.saveAutoTranslate(enabled)
        if enabled {
            Task { await translateLoadedConversationsIfNeeded() }
        } else {
            translatedMessages = [:]
            messageTranslationState = .idle
        }
    }

    @MainActor
    func refreshEverything() async {
        await loadMobileFeed()
        await loadHelpers()
        await loadProducts()
        await loadConversations()
        await loadLogisticsRequests()
    }

    @MainActor
    func loadMobileFeed() async {
        guard isSignedIn else { return }
        mobileFeed = .loading
        do {
            let envelope: GoDataEnvelope<GoMobileFeed> = try await api.get("/mobile/feed")
            mobileFeed = .loaded(envelope.data)
        } catch {
            mobileFeed = .failed(error.localizedDescription)
        }
    }

    @MainActor
    func loadHelpers() async {
        nearbyHelpers = .loading
        do {
            let query = searchText.isEmpty ? "" : "?q=\(searchText.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? searchText)"
            let envelope: GoDataEnvelope<NearbyPayload> = try await api.get("/mobile/nearby\(query)")
            nearbyHelpers = .loaded(envelope.data.helpers ?? [])
        } catch {
            nearbyHelpers = .failed(error.localizedDescription)
        }
    }

    @MainActor
    func loadProducts() async {
        products = .loading
        do {
            let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            let path = query.count >= 2
                ? "/marketplace/products/search?q=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query)"
                : "/marketplace/products/browse?limit=20"
            let envelope: GoDataEnvelope<[Product]> = try await api.get(path)
            products = .loaded(envelope.data)
        } catch {
            products = .failed(error.localizedDescription)
        }
    }

    @MainActor
    func loadConversations() async {
        guard isSignedIn else { return }
        conversations = .loading
        do {
            let rows: [Conversation] = try await api.get("/messages/conversations")
            conversations = .loaded(rows)
            await translateLoadedConversationsIfNeeded()
        } catch {
            conversations = .failed(error.localizedDescription)
        }
    }

    var displayedConversations: [GoMessageDisplay] {
        guard case .loaded(let rows) = conversations else { return [] }
        return rows.map { conversation in
            let original = conversation.lastMessage ?? conversation.jobTitle ?? "No messages yet"
            return GoMessageDisplay(
                id: conversation.id,
                title: conversation.otherUserName ?? conversation.conversationBusinessName ?? conversation.helperBusinessName ?? "Conversation #\(conversation.id)",
                originalMessage: original,
                translatedMessage: autoTranslateMessages ? translatedMessages[conversation.id] : nil,
                unreadCount: conversation.unreadCount ?? 0
            )
        }
    }

    @MainActor
    func translateLoadedConversationsIfNeeded() async {
        guard autoTranslateMessages, appLanguage != .english, case .loaded(let rows) = conversations else {
            return
        }
        let candidates = rows.filter { row in
            guard translatedMessages[row.id] == nil else { return false }
            let text = row.lastMessage ?? row.jobTitle ?? ""
            return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        guard !candidates.isEmpty else { return }

        messageTranslationState = .loading
        var updates: [Int: String] = [:]
        for conversation in candidates {
            let original = conversation.lastMessage ?? conversation.jobTitle ?? ""
            do {
                let request = TranslationRequest(text: original, sourceLocale: nil, targetLocale: appLanguage.rawValue)
                let envelope: GoDataEnvelope<TranslationPayload> = try await api.post("/translate", body: request)
                if let translated = envelope.data.translatedText ?? envelope.data.text, !translated.isEmpty {
                    updates[conversation.id] = translated
                }
            } catch {
                // Keep original text visible if translation fails for a single row.
                continue
            }
        }
        translatedMessages.merge(updates) { _, new in new }
        messageTranslationState = .loaded(translatedMessages)
    }

    @MainActor
    func loadLogisticsRequests() async {
        guard isSignedIn else { return }
        logisticsRequests = .loading
        do {
            let envelope: GoDataEnvelope<[LogisticsRequest]> = try await api.get("/logistics/requests")
            logisticsRequests = .loaded(envelope.data)
        } catch {
            logisticsRequests = .failed(error.localizedDescription)
        }
    }

    @MainActor
    func submitJobOrQueue() async {
        let trimmed = draftJob.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, draftJob.details.count >= 20, !draftJob.city.isEmpty else {
            savedJobMessage = "Add a title, city, and at least 20 characters of detail."
            return
        }

        let payload = GoJobSubmitRequest(
            title: trimmed,
            description: draftJob.details,
            categoryName: draftJob.category,
            budgetType: draftJob.budgetType,
            budgetMin: draftJob.budgetMin.isEmpty ? nil : draftJob.budgetMin,
            budgetMax: draftJob.budgetMax.isEmpty ? nil : draftJob.budgetMax,
            urgency: draftJob.urgency.lowercased().replacingOccurrences(of: " ", with: "_"),
            locationCity: draftJob.city,
            locationState: draftJob.state.isEmpty ? nil : draftJob.state,
            locationZip: draftJob.zip.isEmpty ? nil : draftJob.zip,
            locationCountry: "US",
            requiredSkills: draftJob.requiredSkill.isEmpty ? [] : [["name": draftJob.requiredSkill]],
            scheduledDate: draftJob.scheduledDate.isEmpty ? nil : draftJob.scheduledDate,
            preferredHelperId: draftJob.preferredHelperId.isEmpty ? nil : draftJob.preferredHelperId,
            notes: draftJob.photoNote.isEmpty ? nil : draftJob.photoNote
        )

        guard isSignedIn else {
            offlineQueue.append(GoOfflineAction(type: "job_draft", title: trimmed, payloadPreview: draftJob.details))
            savedJobMessage = "Saved offline. Sign in to sync this job draft."
            return
        }

        do {
            let _: GenericResponse = try await api.post("/jobs", body: payload)
            savedJobMessage = "Posted '\(trimmed)' to OxSteed."
            await loadMobileFeed()
        } catch {
            offlineQueue.append(GoOfflineAction(type: "job_submit_retry", title: trimmed, payloadPreview: error.localizedDescription))
            savedJobMessage = "Could not post yet. Queued for retry."
        }
    }

    func queueNotificationOpen(_ title: String) {
        offlineQueue.append(GoOfflineAction(type: "notification_deeplink", title: title, payloadPreview: "Route this push into the exact native screen."))
    }
}
