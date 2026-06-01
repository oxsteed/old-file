import AppIntents

// MARK: - OxSteedShortcuts
//
// Registers all OxSteed actions with Siri, Shortcuts, Spotlight, and Control Center.
// Phrases must contain "\(.applicationName)" per Apple's App Shortcuts requirements.
// Call `OxSteedShortcuts.updateAppShortcutParameters()` whenever the user switches persona
// so Siri suggestions stay role-relevant.

struct OxSteedShortcuts: AppShortcutsProvider {

    static var appShortcuts: [AppShortcut] {

        // ── Customer & general ──────────────────────────────────────────────

        AppShortcut(
            intent: PostJobIntent(),
            phrases: [
                "Post a job on \(.applicationName)",
                "Request help on \(.applicationName)",
                "Create a task on \(.applicationName)",
                "I need help with something on \(.applicationName)"
            ],
            shortTitle: "Post a Job",
            systemImageName: "plus.circle.fill"
        )

        AppShortcut(
            intent: SearchJobsIntent(),
            phrases: [
                "Search jobs on \(.applicationName)",
                "Find a job on \(.applicationName)",
                "Show jobs on \(.applicationName)"
            ],
            shortTitle: "Search Jobs",
            systemImageName: "magnifyingglass"
        )

        AppShortcut(
            intent: SearchHelpersIntent(),
            phrases: [
                "Find a helper on \(.applicationName)",
                "Find a helper on \(.applicationName)",
                "Search helpers on \(.applicationName)"
            ],
            shortTitle: "Find a Helper",
            systemImageName: "person.fill.checkmark"
        )

        // ── Helper persona ──────────────────────────────────────────────────

        AppShortcut(
            intent: ShowNearbyJobsIntent(),
            phrases: [
                "Show nearby jobs on \(.applicationName)",
                "Find work near me on \(.applicationName)",
                "What jobs are available on \(.applicationName)"
            ],
            shortTitle: "Nearby Jobs",
            systemImageName: "map.fill"
        )

        AppShortcut(
            intent: AcceptTaskIntent(),
            phrases: [
                "Accept a task on \(.applicationName)",
                "Find work on \(.applicationName)",
                "Show available tasks on \(.applicationName)"
            ],
            shortTitle: "Accept Task",
            systemImageName: "checkmark.circle.fill"
        )

        // ── Messaging ───────────────────────────────────────────────────────

        AppShortcut(
            intent: MessageCustomerIntent(),
            phrases: [
                "Open my messages on \(.applicationName)",
                "Check my inbox on \(.applicationName)",
                "Message a customer on \(.applicationName)"
            ],
            shortTitle: "Messages",
            systemImageName: "envelope.fill"
        )

        // ── Payments ────────────────────────────────────────────────────────

        AppShortcut(
            intent: RequestPayoutIntent(),
            phrases: [
                "Request a payout on \(.applicationName)",
                "Get paid on \(.applicationName)",
                "Withdraw my earnings on \(.applicationName)"
            ],
            shortTitle: "Request Payout",
            systemImageName: "dollarsign.circle.fill"
        )

        // ── Finance / Life tab ──────────────────────────────────────────────

        AppShortcut(
            intent: ShowPulseDashboardIntent(),
            phrases: [
                "Show my Pulse on \(.applicationName)",
                "Open my dashboard on \(.applicationName)",
                "Check my finances on \(.applicationName)",
                "Show my spending on \(.applicationName)"
            ],
            shortTitle: "Pulse Dashboard",
            systemImageName: "chart.line.uptrend.xyaxis"
        )

        AppShortcut(
            intent: LogExpenseIntent(),
            phrases: [
                "Log an expense on \(.applicationName)",
                "Add an expense on \(.applicationName)",
                "Record a purchase on \(.applicationName)"
            ],
            shortTitle: "Log Expense",
            systemImageName: "plus.forwardslash.minus"
        )
    }
}
