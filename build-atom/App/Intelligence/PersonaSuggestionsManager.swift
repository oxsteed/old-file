import AppIntents
import Foundation

// MARK: - PersonaSuggestionsManager
//
// Keeps Siri suggestions role-relevant by calling updateAppShortcutParameters()
// whenever the active persona changes. AppShortcutsProvider handles the actual
// donation — we don't need INInteraction here.
//
// Customer   → Post Job, Search Helpers, Message, Log Expense, Pulse Dashboard
// Helper     → Nearby Jobs, Accept Task, Message, Request Payout
// Business   → Pulse Dashboard, Message, Post Job
// Consultant → Post Job, Message, Pulse Dashboard
// ToolOwner  → Post Job, Message
// Franchise  → Pulse Dashboard, Message
// Investor   → Pulse Dashboard, Message

@MainActor
enum PersonaSuggestionsManager {

    /// Call after a persona switch to refresh Siri Suggestions.
    /// `updateAppShortcutParameters()` signals to the system that app parameters
    /// (like the active persona) have changed, so Siri re-evaluates relevance.
    static func donate(for persona: Persona) {
        OxSteedShortcuts.updateAppShortcutParameters()
        // Store the active persona so AppShortcutsProvider can use it as a
        // dynamic parameter in phrase generation when the API supports it.
        UserDefaults.standard.set(persona.rawValue, forKey: "ox.siri.activePersona")
    }
}
