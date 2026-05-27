import SwiftUI

// ─── Urgency section for OxSteedOne TodayView ────────────────────────────────
// Uses OxSteedOne's UrgencyItem model (pillar, urgency, dueText, dueDate)

struct OneTodayUrgencySection: View {
    @Environment(OneStore.self) private var store

    private var items: [UrgencyItem] { Array(store.urgencyQueue.prefix(5)) }

    var body: some View {
        GoCard {
            headerRow
            itemList
        }
    }

    private var headerRow: some View {
        HStack {
            Label("Action Queue", systemImage: "bolt.badge.clock.fill")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
            Spacer()
            let criticalCount = items.filter { $0.urgency == "critical" || $0.urgency == "high" }.count
            if criticalCount > 0 {
                Text("\(criticalCount) urgent")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color.red.opacity(0.75), in: Capsule())
            }
        }
    }

    private var itemList: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                UrgencyRowItem(item: item)
                if idx < items.count - 1 {
                    Divider().opacity(0.18).padding(.leading, 32)
                }
            }
        }
    }
}

private struct UrgencyRowItem: View {
    let item: UrgencyItem

    var body: some View {
        HStack(spacing: 12) {
            urgencyDot
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                Text(item.pillar)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.55))
            }
            Spacer()
            dueBadge
        }
        .padding(.vertical, 10)
    }

    private var urgencyDot: some View {
        Circle()
            .fill(urgencyColor)
            .frame(width: 10, height: 10)
            .shadow(color: urgencyColor.opacity(0.5), radius: 4)
    }

    private var dueBadge: some View {
        Text(item.dueText)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(urgencyColor)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(urgencyColor.opacity(0.15), in: Capsule())
    }

    private var urgencyColor: Color {
        switch item.urgency {
        case "critical": return .red
        case "high": return OneTheme.amber
        case "medium": return Color(red: 0.95, green: 0.85, blue: 0.3)
        default: return .white.opacity(0.5)
        }
    }
}
