import SwiftUI

// MARK: - RecommendationFeedView
//
// Horizontal scrolling strip of "what to do next" cards driven by
// RecommendationsStore. Mirrors the web RecommendationFeed component.
// Inject into any persona home view — it self-loads on appear.

struct RecommendationFeedView: View {
    @StateObject private var store = RecommendationsStore.shared
    var onNavigate: ((String) -> Void)?  // receives action_url

    var body: some View {
        if store.isLoading && store.recommendations.isEmpty {
            skeletonView
        } else if !store.recommendations.isEmpty {
            feedView
        }
        // hides entirely when empty and not loading
    }

    // MARK: - Feed

    private var feedView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("home.recommendations.title")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.textTertiary)
                .textCase(.uppercase)
                .tracking(0.8)
                .padding(.horizontal, 2)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(store.recommendations) { rec in
                        RecCard(rec: rec, onNavigate: onNavigate, onDismiss: {
                            store.dismiss(rec.id)
                        })
                    }
                }
                .padding(.horizontal, 2)
                .padding(.vertical, 2)
            }
        }
    }

    // MARK: - Skeleton

    private var skeletonView: some View {
        VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: 4)
                .fill(Theme.surface)
                .frame(width: 100, height: 10)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Theme.surface)
                            .frame(width: 200, height: 140)
                            .shimmer()
                    }
                }
            }
        }
    }
}

// MARK: - RecCard

private struct RecCard: View {
    let rec: Recommendation
    var onNavigate: ((String) -> Void)?
    var onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Icon + dismiss
            HStack(alignment: .top) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(accentColor.opacity(0.14))
                        .frame(width: 36, height: 36)
                    Image(systemName: iconName)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(accentColor)
                }
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.textTertiary)
                        .padding(6)
                }
            }

            // Body
            VStack(alignment: .leading, spacing: 4) {
                Text(rec.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(2)
                Text(rec.subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            // CTA
            Button {
                onNavigate?(rec.action_url)
            } label: {
                HStack(spacing: 4) {
                    Text(rec.action_label)
                        .font(.system(size: 12, weight: .semibold))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 10, weight: .bold))
                }
                .foregroundStyle(accentColor)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(accentColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .frame(width: 200, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(accentColor.opacity(0.18), lineWidth: 1)
        )
    }

    // MARK: Accent colour per rec type

    private var accentColor: Color {
        switch rec.type {
        case "guide":             return Color(red: 0.35, green: 0.60, blue: 1.00)   // blue
        case "post_job":          return Theme.accent                                  // orange
        case "find_helper":       return Theme.success                                 // green
        case "rent_tool":         return Color(red: 0.62, green: 0.50, blue: 1.00)   // purple
        case "list_tool":         return Theme.warning                                 // yellow
        case "earn_income":       return Theme.warning
        case "start_business":    return Theme.accent
        case "get_consultant":    return Color(red: 0.35, green: 0.60, blue: 1.00)
        case "explore_franchise": return Color(red: 0.62, green: 0.50, blue: 1.00)
        case "activate_referral": return Theme.success
        case "complete_profile":  return Theme.danger
        case "upskill_badge":     return Theme.warning
        default:                  return Theme.accent
        }
    }

    // MARK: SF Symbol per icon_hint

    private var iconName: String {
        switch rec.icon_hint {
        case "book":      return "book.fill"
        case "briefcase": return "briefcase.fill"
        case "users":     return "person.2.fill"
        case "wrench":    return "wrench.and.screwdriver.fill"
        case "dollar":    return "dollarsign.circle.fill"
        case "zap":       return "bolt.fill"
        case "star":      return "star.fill"
        case "map":       return "map.fill"
        case "share":     return "square.and.arrow.up.fill"
        case "shield":    return "shield.fill"
        case "award":     return "rosette"
        default:          return "sparkles"
        }
    }
}

// MARK: - Shimmer modifier

private extension View {
    func shimmer() -> some View {
        self.overlay(
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [.clear, Theme.surfaceElevated.opacity(0.6), .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .clipped()
        )
    }
}
