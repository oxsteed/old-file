import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Timeline Provider

struct OxSteedTimelineEntry: TimelineEntry {
    let date: Date
    let data: WidgetData.Snapshot
}

struct OxSteedProvider: TimelineProvider {
    func placeholder(in context: Context) -> OxSteedTimelineEntry {
        OxSteedTimelineEntry(date: .now, data: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (OxSteedTimelineEntry) -> Void) {
        completion(OxSteedTimelineEntry(date: .now, data: WidgetData.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OxSteedTimelineEntry>) -> Void) {
        let entry = OxSteedTimelineEntry(date: .now, data: WidgetData.read())
        // Refresh every 30 minutes; the main app also calls reloadAllTimelines after each fetch
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 30, to: .now)!
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

// MARK: - Small Widget: persona-aware quick-action tile

struct OxSmallWidgetView: View {
    let data: WidgetData.Snapshot

    var body: some View {
        ZStack {
            ContainerRelativeShape()
                .fill(personaColor.gradient)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: personaIcon)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white.opacity(0.9))
                    Spacer()
                    if data.unreadCount > 0 {
                        Text("\(data.unreadCount)")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(personaColor)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(.white, in: Capsule())
                    }
                }
                Spacer()
                Text(primaryStat)
                    .font(.system(size: 28, weight: .heavy))
                    .foregroundStyle(.white)
                Text(primaryLabel)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.8))
            }
            .padding(14)
        }
        .widgetURL(deepLinkURL)
    }

    // MARK: - Persona-driven content

    private var primaryStat: String {
        switch data.persona {
        case "helper":
            return "\(data.nearbyJobsCount)"
        case "business_owner", "consultant":
            if let score = data.pulseScore { return "\(score)" }
            return "\(data.activeJobsCount)"
        default: // customer
            return "\(data.activeJobsCount)"
        }
    }

    private var primaryLabel: String {
        switch data.persona {
        case "helper":     return data.nearbyJobsCount == 1 ? "job nearby" : "jobs nearby"
        case "business_owner", "consultant":
            return data.pulseScore != nil ? "Pulse score" : "active jobs"
        default:           return data.activeJobsCount == 1 ? "active job" : "active jobs"
        }
    }

    private var personaColor: Color {
        switch data.persona {
        case "helper":      return Color(red: 0.2, green: 0.6, blue: 1.0)
        case "business_owner": return Color(red: 0.3, green: 0.8, blue: 0.5)
        case "consultant":  return Color(red: 0.6, green: 0.3, blue: 0.9)
        default:            return Color(red: 0.2, green: 0.5, blue: 0.9)
        }
    }

    private var personaIcon: String {
        switch data.persona {
        case "helper":         return "wrench.and.screwdriver.fill"
        case "business_owner": return "briefcase.fill"
        case "consultant":     return "person.bubble.fill"
        case "tool_owner":     return "hammer.fill"
        default:               return "house.and.flag.fill"
        }
    }

    private var deepLinkURL: URL {
        URL(string: "oxsteed://widget/home")!
    }
}

// MARK: - Medium Widget: top job + Pulse score

struct OxMediumWidgetView: View {
    let data: WidgetData.Snapshot

    var body: some View {
        HStack(spacing: 0) {
            // Left: job info or nearby jobs
            VStack(alignment: .leading, spacing: 8) {
                Label("OxSteed", systemImage: "hammer.circle.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color(red: 0.2, green: 0.5, blue: 0.9))

                if let title = data.topJobTitle {
                    Text(title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                    if let cat = data.topJobCategory {
                        Text(cat)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    if let budget = data.topJobBudget {
                        Text(budget)
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color(red: 0.2, green: 0.5, blue: 0.9))
                    }
                } else {
                    Text(data.persona == "helper" ? "No nearby jobs right now" : "No active jobs")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Link(destination: URL(string: "oxsteed://widget/post-job")!) {
                    Text(data.persona == "helper" ? "Find work" : "Post a job")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(Color(red: 0.2, green: 0.5, blue: 0.9), in: Capsule())
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)

            Divider()

            // Right: Pulse score
            VStack(spacing: 6) {
                Text("Pulse")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.secondary)
                if let score = data.pulseScore {
                    Text("\(score)")
                        .font(.system(size: 32, weight: .heavy))
                        .foregroundStyle(pulseColor(for: score))
                    Text("/ 100")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                } else {
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .font(.system(size: 24))
                        .foregroundStyle(.secondary)
                    Text("—")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 80)
            .padding(.vertical, 14)
        }
        .widgetURL(URL(string: "oxsteed://widget/home")!)
    }

    private func pulseColor(for score: Int) -> Color {
        switch score {
        case 75...: return Color(red: 0.2, green: 0.7, blue: 0.4)
        case 50..<75: return Color(red: 1.0, green: 0.7, blue: 0.0)
        default:    return Color(red: 0.9, green: 0.3, blue: 0.3)
        }
    }
}

// MARK: - Lock Screen Accessory Widget (circular)

struct OxLockScreenWidgetView: View {
    let data: WidgetData.Snapshot

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 2) {
                Image(systemName: "hammer.circle.fill")
                    .font(.system(size: 16, weight: .bold))
                Text(lockScreenStat)
                    .font(.system(size: 14, weight: .heavy))
            }
        }
        .widgetURL(URL(string: "oxsteed://widget/home")!)
    }

    private var lockScreenStat: String {
        switch data.persona {
        case "helper":  return "\(data.nearbyJobsCount)"
        default:        return "\(data.activeJobsCount)"
        }
    }
}

// MARK: - Widget Bundle

@main
struct OxSteedWidgetBundle: WidgetBundle {
    var body: some Widget {
        OxSteedSmallWidget()
        OxSteedMediumWidget()
        OxSteedLockScreenWidget()
    }
}

// MARK: - Widget declarations

struct OxSteedSmallWidget: Widget {
    let kind = "OxSteedSmallWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: OxSteedProvider()) { entry in
            OxSmallWidgetView(data: entry.data)
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("OxSteed")
        .description("Quick stats for your active persona.")
        .supportedFamilies([.systemSmall])
    }
}

struct OxSteedMediumWidget: Widget {
    let kind = "OxSteedMediumWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: OxSteedProvider()) { entry in
            OxMediumWidgetView(data: entry.data)
                .containerBackground(for: .widget) { Color(.systemBackground) }
        }
        .configurationDisplayName("OxSteed Job + Pulse")
        .description("Top job and your Life Pulse score at a glance.")
        .supportedFamilies([.systemMedium])
    }
}

struct OxSteedLockScreenWidget: Widget {
    let kind = "OxSteedLockScreenWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: OxSteedProvider()) { entry in
            OxLockScreenWidgetView(data: entry.data)
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("OxSteed")
        .description("Job count on your Lock Screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}
