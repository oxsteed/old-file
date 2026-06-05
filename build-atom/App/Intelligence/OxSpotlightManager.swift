import CoreSpotlight
import Foundation

// MARK: - OxSpotlightManager
//
// Donates jobs, conversations, and the user's profile to CoreSpotlight so they
// appear in system search, Siri suggestions, and Visual Intelligence.
//
// Call from stores after data loads:
//   OxSpotlightManager.indexJobs(jobs)
//   OxSpotlightManager.indexConversations(conversations, currentUserId:)
//   OxSpotlightManager.indexProfile(user)
//
// Visual Intelligence integration: setting `isEligibleForSearch = true` and
// supplying a `relatedUniqueIdentifier` on CSSearchableItemAttributeSet means
// the system can surface these items when the camera sees related objects.

enum OxSpotlightManager {

    // MARK: - Domain identifiers

    private static let jobDomain          = "com.oxsteed.app.job"
    private static let conversationDomain = "com.oxsteed.app.conversation"
    private static let profileDomain      = "com.oxsteed.app.profile"

    // MARK: - Jobs

    /// Index a list of jobs so they appear in Spotlight and Visual Intelligence.
    static func indexJobs(_ jobs: [APIJob]) {
        let items: [CSSearchableItem] = jobs.map { job in
            let attrs = CSSearchableItemAttributeSet(contentType: .item)
            attrs.title       = job.title
            attrs.contentDescription = [
                job.category,
                job.locationDisplay.isEmpty ? nil : job.locationDisplay,
                job.budgetDisplay
            ].compactMap { $0 }.joined(separator: " · ")
            attrs.keywords    = [job.category, job.urgency, job.location_city, job.location_state]
                .compactMap { $0 }
            attrs.domainIdentifier = jobDomain

            // Mark as eligible for Visual Intelligence (camera-to-search)

            // Deep-link URL for tapping the result
            attrs.relatedUniqueIdentifier = "\(jobDomain).\(job.id)"

            return CSSearchableItem(
                uniqueIdentifier: "\(jobDomain).\(job.id)",
                domainIdentifier: jobDomain,
                attributeSet: attrs
            )
        }
        CSSearchableIndex.default().indexSearchableItems(items) { _ in }
    }

    /// Remove all indexed jobs (call on logout or when jobs are stale).
    static func deleteJobIndex() {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [jobDomain]) { _ in }
    }

    // MARK: - Conversations

    /// Index recent conversations so messages are findable in system search.
    static func indexConversations(_ conversations: [APIConversation], currentUserId: String) {
        let items: [CSSearchableItem] = conversations.prefix(50).compactMap { conv in
            guard let name = conv.other_user_name, !name.isEmpty else { return nil }
            let attrs = CSSearchableItemAttributeSet(contentType: .message)
            attrs.title              = name
            attrs.contentDescription = conv.last_message
            attrs.domainIdentifier   = conversationDomain
            attrs.relatedUniqueIdentifier = "\(conversationDomain).\(conv.id)"
            attrs.keywords = [
                name,
                oxSpotlightLocalized("app.name"),
                oxSpotlightLocalized("spotlight.keyword.message"),
                oxSpotlightLocalized("spotlight.keyword.chat")
            ]
            return CSSearchableItem(
                uniqueIdentifier: "\(conversationDomain).\(conv.id)",
                domainIdentifier: conversationDomain,
                attributeSet: attrs
            )
        }
        CSSearchableIndex.default().indexSearchableItems(items) { _ in }
    }

    static func deleteConversationIndex() {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [conversationDomain]) { _ in }
    }

    // MARK: - User Profile

    /// Index the user's own profile so "my OxSteed profile" is searchable.
    static func indexProfile(_ user: APIUser) {
        let attrs = CSSearchableItemAttributeSet(contentType: .contact)
        attrs.title              = user.displayName
        attrs.contentDescription = oxSpotlightLocalized("spotlight.profile.description")
        attrs.domainIdentifier   = profileDomain
        attrs.keywords           = [
            oxSpotlightLocalized("app.name"),
            oxSpotlightLocalized("spotlight.keyword.profile"),
            user.email,
            user.role
        ].compactMap { $0 }
        let item = CSSearchableItem(
            uniqueIdentifier: "\(profileDomain).\(user.id)",
            domainIdentifier: profileDomain,
            attributeSet: attrs
        )
        CSSearchableIndex.default().indexSearchableItems([item]) { _ in }
    }

    // MARK: - Full wipe on logout

    static func deleteAllIndexes() {
        CSSearchableIndex.default().deleteSearchableItems(
            withDomainIdentifiers: [jobDomain, conversationDomain, profileDomain]
        ) { _ in }
    }

    // MARK: - NSUserActivity helper

    /// Creates an NSUserActivity for a job so it's eligible for Handoff and
    /// Visual Intelligence. Call from JobDetailView's `.userActivity(_:isActive:update:)` modifier.
    static func activityForJob(_ job: APIJob) -> NSUserActivity {
        let activity = NSUserActivity(activityType: "com.oxsteed.app.viewJob")
        activity.title = job.title
        activity.userInfo = ["jobId": job.id]
        activity.requiredUserInfoKeys = ["jobId"]
        activity.isEligibleForSearch    = true
        activity.isEligibleForHandoff   = true
        activity.isEligibleForPrediction = true
        activity.keywords = Set([job.category, job.location_city].compactMap { $0 })
        activity.becomeCurrent()
        return activity
    }

    /// Creates an NSUserActivity for a conversation (Handoff + search).
    static func activityForConversation(_ conv: APIConversation) -> NSUserActivity {
        let activity = NSUserActivity(activityType: "com.oxsteed.app.viewConversation")
        activity.title = conv.other_user_name ?? oxSpotlightLocalized("spotlight.conversation.title")
        activity.userInfo = ["conversationId": conv.id]
        activity.requiredUserInfoKeys = ["conversationId"]
        activity.isEligibleForSearch  = true
        activity.isEligibleForHandoff = true
        activity.becomeCurrent()
        return activity
    }
}

private func oxSpotlightLocalized(_ key: String) -> String {
    let rawLanguage = UserDefaults.standard.string(forKey: LocalizationManager.storageKey)
    let language = rawLanguage == AppLanguage.system.rawValue
        ? AppLanguage.fromStoredCode(Locale.preferredLanguages.first) ?? .en
        : AppLanguage.fromStoredCode(rawLanguage) ?? .en

    if let path = Bundle.main.path(forResource: language.rawValue, ofType: "lproj"),
       let bundle = Bundle(path: path) {
        let localized = bundle.localizedString(forKey: key, value: key, table: nil)
        if localized != key { return localized }
    }

    if let path = Bundle.main.path(forResource: AppLanguage.en.rawValue, ofType: "lproj"),
       let bundle = Bundle(path: path) {
        return bundle.localizedString(forKey: key, value: key, table: nil)
    }

    return Bundle.main.localizedString(forKey: key, value: key, table: nil)
}

// MARK: - Store integration extensions

extension JobsStore {
    /// Call after loading jobs to keep Spotlight in sync.
    func indexInSpotlight() {
        let all = (myJobs + availableJobs).uniqued(by: \.id)
        OxSpotlightManager.indexJobs(all)
    }
}

extension MessagesStore {
    func indexInSpotlight(currentUserId: String) {
        OxSpotlightManager.indexConversations(conversations, currentUserId: currentUserId)
    }
}

// MARK: - Sequence uniquing helper

private extension Sequence {
    func uniqued<T: Hashable>(by key: (Element) -> T) -> [Element] {
        var seen = Set<T>()
        return filter { seen.insert(key($0)).inserted }
    }
}
