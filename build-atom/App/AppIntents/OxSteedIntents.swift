import AppIntents
import Foundation

// MARK: - Notification Names
// Intents post these to open the right screen. RootShellView (and HomeTabView)
// listen for them and route accordingly.

extension Notification.Name {
    // Posted by intents → consumed by OxSteedApp which re-posts triggers
    static let oxIntentOpenPostJob       = Notification.Name("ox.intent.openPostJob")
    static let oxIntentOpenNearbyJobs    = Notification.Name("ox.intent.openNearbyJobs")
    static let oxIntentOpenInbox         = Notification.Name("ox.intent.openInbox")
    static let oxIntentOpenPayout        = Notification.Name("ox.intent.openPayout")
    static let oxIntentOpenLogExpense    = Notification.Name("ox.intent.openLogExpense")
    static let oxIntentOpenPulse         = Notification.Name("ox.intent.openPulse")
    static let oxIntentOpenAvailableJobs = Notification.Name("ox.intent.openAvailableJobs")
    static let oxIntentSearchJobs        = Notification.Name("ox.intent.searchJobs")
    static let oxIntentSearchHelpers     = Notification.Name("ox.intent.searchHelpers")

    // Re-posted by OxSteedApp → consumed by HomeTabView / child screens
    static let oxIntentTriggerPostJob     = Notification.Name("ox.intent.trigger.postJob")
    static let oxIntentTriggerNearbyJobs  = Notification.Name("ox.intent.trigger.nearbyJobs")
    static let oxIntentTriggerInbox       = Notification.Name("ox.intent.trigger.inbox")
    static let oxIntentTriggerPayout      = Notification.Name("ox.intent.trigger.payout")
    static let oxIntentTriggerJobSearch   = Notification.Name("ox.intent.trigger.jobSearch")
    static let oxIntentTriggerHelperSearch = Notification.Name("ox.intent.trigger.helperSearch")
    static let oxIntentOpenLogExpenseInLife = Notification.Name("ox.intent.trigger.logExpense")
}

// MARK: - Post Job

/// Opens the Post Job sheet so the user can request help.
struct PostJobIntent: AppIntent {
    static let title: LocalizedStringResource = "Post a Job"
    static let description = IntentDescription(
        "Post a new job request on OxSteed to get help.",
        categoryName: "Jobs"
    )
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: .oxIntentOpenPostJob, object: nil)
        }
        return .result()
    }
}

// MARK: - Show Nearby Jobs

/// For helpers — surfaces available jobs close to the user.
struct ShowNearbyJobsIntent: AppIntent {
    static let title: LocalizedStringResource = "Show Nearby Jobs"
    static let description = IntentDescription(
        "Browse available jobs near you on OxSteed.",
        categoryName: "Jobs"
    )
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: .oxIntentOpenNearbyJobs, object: nil)
        }
        return .result()
    }
}

// MARK: - Message Customer / Open Inbox

struct MessageCustomerIntent: AppIntent {
    static let title: LocalizedStringResource = "Message Customer"
    static let description = IntentDescription(
        "Open your OxSteed message inbox.",
        categoryName: "Messages"
    )
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: .oxIntentOpenInbox, object: nil)
        }
        return .result()
    }
}

// MARK: - Request Payout

struct RequestPayoutIntent: AppIntent {
    static let title: LocalizedStringResource = "Request Payout"
    static let description = IntentDescription(
        "Go to the OxSteed payout screen to withdraw earnings.",
        categoryName: "Payments"
    )
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: .oxIntentOpenPayout, object: nil)
        }
        return .result()
    }
}

// MARK: - Log Expense

struct LogExpenseIntent: AppIntent {
    static let title: LocalizedStringResource = "Log an Expense"
    static let description = IntentDescription(
        "Add a new expense entry in OxSteed Life.",
        categoryName: "Finance"
    )
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: .oxIntentOpenLogExpense, object: nil)
        }
        return .result()
    }
}

// MARK: - Show Pulse Dashboard

struct ShowPulseDashboardIntent: AppIntent {
    static let title: LocalizedStringResource = "Show My Pulse Dashboard"
    static let description = IntentDescription(
        "Open your OxSteed Life Pulse financial overview.",
        categoryName: "Finance"
    )
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: .oxIntentOpenPulse, object: nil)
        }
        return .result()
    }
}

// MARK: - Accept a Task

/// For helpers — opens the available jobs list so they can browse and accept work.
struct AcceptTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Accept a Task"
    static let description = IntentDescription(
        "Browse and accept open tasks near you on OxSteed.",
        categoryName: "Jobs"
    )
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: .oxIntentOpenAvailableJobs, object: nil)
        }
        return .result()
    }
}

// MARK: - Search Jobs

struct SearchJobsIntent: AppIntent {
    static let title: LocalizedStringResource = "Search Jobs"
    static let description = IntentDescription(
        "Search for available jobs on OxSteed by category or keyword.",
        categoryName: "Search"
    )
    static let openAppWhenRun: Bool = true

    @Parameter(title: "Search Term", requestValueDialog: "What kind of job are you looking for?")
    var searchTerm: String?

    @Parameter(title: "Category", requestValueDialog: "Which category — plumbing, electrical, cleaning…?")
    var category: String?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let term = searchTerm ?? ""
        let cat  = category  ?? ""
        await MainActor.run {
            NotificationCenter.default.post(
                name: .oxIntentSearchJobs,
                object: nil,
                userInfo: ["term": term, "category": cat]
            )
        }
        let query = [term, cat].filter { !$0.isEmpty }.joined(separator: " ")
        return .result(
            dialog: IntentDialog(stringLiteral:
                "Searching for \(query.isEmpty ? "jobs" : query) on OxSteed.")
        )
    }
}

// MARK: - Search Helpers

struct SearchHelpersIntent: AppIntent {
    static let title: LocalizedStringResource = "Find a Helper"
    static let description = IntentDescription(
        "Find skilled helpers near you on OxSteed.",
        categoryName: "Search"
    )
    static let openAppWhenRun: Bool = true

    @Parameter(title: "Skill or Service", requestValueDialog: "What skill or service do you need?")
    var skill: String?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let s = skill ?? ""
        await MainActor.run {
            NotificationCenter.default.post(
                name: .oxIntentSearchHelpers,
                object: nil,
                userInfo: ["skill": s]
            )
        }
        return .result(
            dialog: IntentDialog(stringLiteral:
                "Finding \(s.isEmpty ? "helpers" : "\(s) helpers") near you.")
        )
    }
}
