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
                "shortcut.post_job.phrase1 \(.applicationName)",
                "shortcut.post_job.phrase2 \(.applicationName)",
                "shortcut.post_job.phrase3 \(.applicationName)",
                "shortcut.post_job.phrase4 \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("shortcut.post_job.title"),
            systemImageName: "plus.circle.fill"
        )

        AppShortcut(
            intent: SearchJobsIntent(),
            phrases: [
                "shortcut.search_jobs.phrase1 \(.applicationName)",
                "shortcut.search_jobs.phrase2 \(.applicationName)",
                "shortcut.search_jobs.phrase3 \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("shortcut.search_jobs.title"),
            systemImageName: "magnifyingglass"
        )

        AppShortcut(
            intent: SearchHelpersIntent(),
            phrases: [
                "shortcut.find_helper.phrase1 \(.applicationName)",
                "shortcut.find_helper.phrase2 \(.applicationName)",
                "shortcut.find_helper.phrase3 \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("shortcut.find_helper.title"),
            systemImageName: "person.fill.checkmark"
        )

        // ── Helper persona ──────────────────────────────────────────────────

        AppShortcut(
            intent: ShowNearbyJobsIntent(),
            phrases: [
                "shortcut.nearby_jobs.phrase1 \(.applicationName)",
                "shortcut.nearby_jobs.phrase2 \(.applicationName)",
                "shortcut.nearby_jobs.phrase3 \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("shortcut.nearby_jobs.title"),
            systemImageName: "map.fill"
        )

        AppShortcut(
            intent: AcceptTaskIntent(),
            phrases: [
                "shortcut.accept_task.phrase1 \(.applicationName)",
                "shortcut.accept_task.phrase2 \(.applicationName)",
                "shortcut.accept_task.phrase3 \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("shortcut.accept_task.title"),
            systemImageName: "checkmark.circle.fill"
        )

        // ── Messaging ───────────────────────────────────────────────────────

        AppShortcut(
            intent: MessageCustomerIntent(),
            phrases: [
                "shortcut.messages.phrase1 \(.applicationName)",
                "shortcut.messages.phrase2 \(.applicationName)",
                "shortcut.messages.phrase3 \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("shortcut.messages.title"),
            systemImageName: "envelope.fill"
        )

        // ── Payments ────────────────────────────────────────────────────────

        AppShortcut(
            intent: RequestPayoutIntent(),
            phrases: [
                "shortcut.request_payout.phrase1 \(.applicationName)",
                "shortcut.request_payout.phrase2 \(.applicationName)",
                "shortcut.request_payout.phrase3 \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("shortcut.request_payout.title"),
            systemImageName: "dollarsign.circle.fill"
        )

        // ── Finance / Life tab ──────────────────────────────────────────────

        AppShortcut(
            intent: ShowPulseDashboardIntent(),
            phrases: [
                "shortcut.pulse_dashboard.phrase1 \(.applicationName)",
                "shortcut.pulse_dashboard.phrase2 \(.applicationName)",
                "shortcut.pulse_dashboard.phrase3 \(.applicationName)",
                "shortcut.pulse_dashboard.phrase4 \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("shortcut.pulse_dashboard.title"),
            systemImageName: "chart.line.uptrend.xyaxis"
        )

        AppShortcut(
            intent: LogExpenseIntent(),
            phrases: [
                "shortcut.log_expense.phrase1 \(.applicationName)",
                "shortcut.log_expense.phrase2 \(.applicationName)",
                "shortcut.log_expense.phrase3 \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("shortcut.log_expense.title"),
            systemImageName: "plus.forwardslash.minus"
        )
    }
}
