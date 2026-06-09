import Foundation

#if canImport(WidgetKit)
import WidgetKit
#endif

// MARK: - Shared widget data model
// Widgets cannot access app stores directly. They read from a shared App Group
// UserDefaults that the main app writes after each data refresh.

enum WidgetData {
    private static let widgetGroup = "group.com.oxsteed.app.widget"

    // Shared key names
    static let activePersona    = "widget.activePersona"
    static let activejobsCount  = "widget.activeJobsCount"
    static let nearbyJobsCount  = "widget.nearbyJobsCount"
    static let topJobTitle      = "widget.topJobTitle"
    static let topJobCategory   = "widget.topJobCategory"
    static let topJobBudget     = "widget.topJobBudget"
    static let pulseScore       = "widget.pulseScore"
    static let unreadCount      = "widget.unreadCount"
    static let helperNetWeek    = "widget.helperNetWeek"

    static var defaults: UserDefaults? { UserDefaults(suiteName: widgetGroup) }

    // MARK: - Write (called from main app after each store refresh)

    static func write(
        persona: String,
        activeJobs: Int,
        nearbyJobs: Int,
        topJobTitle: String?,
        topJobCategory: String?,
        topJobBudget: String?,
        pulseScore: Int?,
        unreadCount: Int,
        helperNetWeekCents: Int?
    ) {
        guard let d = defaults else { return }
        d.set(persona,           forKey: activePersona)
        d.set(activeJobs,        forKey: activejobsCount)
        d.set(nearbyJobs,        forKey: nearbyJobsCount)
        d.set(topJobTitle,       forKey: WidgetData.topJobTitle)
        d.set(topJobCategory,    forKey: WidgetData.topJobCategory)
        d.set(topJobBudget,      forKey: WidgetData.topJobBudget)
        if let score = pulseScore { d.set(score, forKey: WidgetData.pulseScore) }
        d.set(unreadCount,       forKey: WidgetData.unreadCount)
        if let net = helperNetWeekCents { d.set(net, forKey: helperNetWeek) }

#if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
#endif
    }

    // MARK: - Read (called from widget)

    struct Snapshot {
        var persona: String
        var activeJobsCount: Int
        var nearbyJobsCount: Int
        var topJobTitle: String?
        var topJobCategory: String?
        var topJobBudget: String?
        var pulseScore: Int?
        var unreadCount: Int
        var helperNetWeekCents: Int?

        static var placeholder: Snapshot {
            Snapshot(
                persona: "customer",
                activeJobsCount: 2,
                nearbyJobsCount: 7,
                topJobTitle: "Leaky kitchen sink repair",
                topJobCategory: "Plumbing",
                topJobBudget: "$80–$150",
                pulseScore: 72,
                unreadCount: 3,
                helperNetWeekCents: nil
            )
        }
    }

    static func read() -> Snapshot {
        let d = defaults
        return Snapshot(
            persona:            d?.string(forKey: activePersona) ?? "customer",
            activeJobsCount:    d?.integer(forKey: activejobsCount) ?? 0,
            nearbyJobsCount:    d?.integer(forKey: nearbyJobsCount) ?? 0,
            topJobTitle:        d?.string(forKey: topJobTitle),
            topJobCategory:     d?.string(forKey: topJobCategory),
            topJobBudget:       d?.string(forKey: topJobBudget),
            pulseScore:         d?.object(forKey: pulseScore) as? Int,
            unreadCount:        d?.integer(forKey: unreadCount) ?? 0,
            helperNetWeekCents: d?.object(forKey: helperNetWeek) as? Int
        )
    }
}

