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

    private func localized(_ key: GoCopyKey) -> String {
        GoLocalization.text(key, language: appLanguage)
    }

    var heroTitle: String {
        switch mode {
        case .customer:
            localized(.heroGetRealWorkHandled)
        case .helper:
            localized(.heroWinBetterLocalJobs)
        case .business:
            localized(.heroRunTheFrontDesk)
        case .logistics:
            localized(.heroMoveGroupBuysCleanly)
        }
    }

    var heroSubtitle: String {
        switch mode {
        case .customer:
            localized(.heroSubtitleCustomer)
        case .helper:
            localized(.heroSubtitleHelper)
        case .business:
            localized(.heroSubtitleBusiness)
        case .logistics:
            localized(.heroSubtitleLogistics)
        }
    }

    var metrics: [GoMetric] {
        if case .loaded(let feed) = mobileFeed, let summary = feed.summary {
            return [
                GoMetric(label: localized(.metricOpenJobs), value: "\(summary.openJobs ?? 0)", symbolName: "hammer"),
                GoMetric(label: localized(.metricBookings), value: "\(summary.incomingBookingRequests ?? 0)", symbolName: "calendar"),
                GoMetric(label: localized(.metricUnread), value: "\(summary.unreadMessages ?? 0)", symbolName: "bubble.left")
            ]
        }

        switch mode {
        case .customer:
            return [
                GoMetric(label: localized(.metricOpenJobs), value: "2", symbolName: "hammer"),
                GoMetric(label: localized(.metricUpcoming), value: "3", symbolName: "calendar"),
                GoMetric(label: localized(.metricUnread), value: "5", symbolName: "bubble.left")
            ]
        case .helper:
            return [
                GoMetric(label: localized(.metricLeads), value: "8", symbolName: "briefcase"),
                GoMetric(label: localized(.metricBookings), value: "4", symbolName: "checkmark.seal"),
                GoMetric(label: localized(.metricProfile), value: "86%", symbolName: "person.text.rectangle")
            ]
        case .business:
            return [
                GoMetric(label: localized(.metricAppointments), value: "7", symbolName: "calendar.badge.clock"),
                GoMetric(label: localized(.metricQuotes), value: "3", symbolName: "doc.text"),
                GoMetric(label: localized(.metricIntakes), value: "5", symbolName: "tray.full")
            ]
        case .logistics:
            return [
                GoMetric(label: localized(.metricRequests), value: "6", symbolName: "shippingbox"),
                GoMetric(label: localized(.metricCampaigns), value: "2", symbolName: "person.3"),
                GoMetric(label: localized(.metricAlerts), value: "1", symbolName: "exclamationmark.triangle")
            ]
        }
    }

    var primaryActions: [GoAction] {
        [
            GoAction(
                id: "post-job",
                title: localized(.actionPostAJob),
                detail: localized(.actionPostAJobDetail),
                symbolName: "square.and.pencil",
                tint: .orange,
                route: "/post-job"
            ),
            GoAction(
                id: "find-helper",
                title: localized(.actionFindHelper),
                detail: localized(.actionFindHelperDetail),
                symbolName: "person.2.wave.2",
                tint: .teal,
                route: "/helpers"
            ),
            GoAction(
                id: "shop-list",
                title: localized(.actionShopTheList),
                detail: localized(.actionShopTheListDetail),
                symbolName: "bag",
                tint: .green,
                route: "/products"
            ),
            GoAction(
                id: "messages",
                title: localized(.actionOpenInbox),
                detail: localized(.actionOpenInboxDetail),
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
                GoTask(
                    title: $0.title ?? localized(.taskUntitledJob),
                    subtitle: [$0.status, $0.categoryName].compactMap { $0 }.joined(separator: " · "),
                    badge: localized(.taskBadgeJob)
                )
            })
            liveTasks.append(contentsOf: (feed.appointments ?? []).prefix(2).map {
                GoTask(
                    title: $0.title ?? localized(.taskAppointment),
                    subtitle: $0.scheduledStartTime ?? localized(.taskScheduled),
                    badge: $0.status ?? localized(.taskBadgeAppointment)
                )
            })
            liveTasks.append(contentsOf: (feed.plannedNeeds ?? []).prefix(2).map {
                GoTask(
                    title: $0.title ?? localized(.taskPlannedNeed),
                    subtitle: $0.dueDate ?? $0.category ?? localized(.taskBadgeNeed),
                    badge: $0.status ?? localized(.taskBadgeNeed)
                )
            })
            if !liveTasks.isEmpty {
                return liveTasks
            }
        }

        return [
            GoTask(title: localized(.taskConfirmTomorrowAppointment), subtitle: localized(.taskConfirmTomorrowSubtitle), badge: localized(.taskBadgeToday)),
            GoTask(title: localized(.taskReviewNewBids), subtitle: localized(.taskReviewNewBidsSubtitle), badge: localized(.taskBadgeAction)),
            GoTask(title: localized(.taskAddPhotosToRequest), subtitle: localized(.taskAddPhotosToRequestSubtitle), badge: localized(.taskBadgeImprove)),
            GoTask(title: localized(.taskPayInvoiceDraft), subtitle: localized(.taskPayInvoiceDraftSubtitle), badge: localized(.taskBadgePayment))
        ]
    }

    func saveDraftJob() {
        let trimmed = draftJob.title.trimmingCharacters(in: .whitespacesAndNewlines)
        savedJobMessage = trimmed.isEmpty
            ? localized(.jobDraftNeedTitle)
            : String(format: localized(.jobDraftSavedMessage), trimmed)
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
                authMessage = localized(.signInTwoFactorCode)
                return
            }
            guard let token = response.token else {
                authMessage = localized(.sessionTokenMissing)
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

        Task {
            struct PreferredLanguageUpdate: Encodable {
                let preferredLanguage: String
            }

            struct EmptyResponse: Decodable {}

            do {
                let _: EmptyResponse = try await api.patch(
                    "/users/me",
                    body: PreferredLanguageUpdate(preferredLanguage: language.rawValue)
                )
            } catch {
                // Best effort: keeps local preference even when offline.
            }
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
            let original = conversation.lastMessage ?? conversation.jobTitle ?? localized(.taskNoMessagesYet)
            return GoMessageDisplay(
                id: conversation.id,
                title: conversation.otherUserName ?? conversation.conversationBusinessName ?? conversation.helperBusinessName ?? "\(localized(.conversationTitlePrefix)) #\(conversation.id)",
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
            savedJobMessage = localized(.jobDraftValidationMessage)
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
            savedJobMessage = localized(.offlineSignInToSync)
            return
        }

        do {
            let _: GenericResponse = try await api.post("/jobs", body: payload)
            savedJobMessage = String(format: localized(.jobPosted), trimmed)
            await loadMobileFeed()
        } catch {
            offlineQueue.append(GoOfflineAction(type: "job_submit_retry", title: trimmed, payloadPreview: error.localizedDescription))
            savedJobMessage = localized(.jobRetryQueued)
        }
    }

    func queueNotificationOpen(_ title: String) {
        offlineQueue.append(GoOfflineAction(type: "notification_deeplink", title: title, payloadPreview: localized(.notificationPayloadPreview)))
    }
}
