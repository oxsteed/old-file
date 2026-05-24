import SwiftUI

struct TodayView: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        @Bindable var store = store

        GoScreen(title: "Home") {
            HomeHeader()

            HStack(spacing: 10) {
                SearchPill(text: $store.searchText)
                Button {
                    Task { await store.refreshEverything() }
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                        .background(GoTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(GoTheme.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }

            PremiumHelpHeroCard()

            SectionHeader(title: "Your active modes", action: "Manage") {
                store.selectedTab = .profile
            }

            ActiveModesGrid()

            MetricStrip(metrics: store.metrics)

            SectionHeader(title: "Recent activity", action: "View all") {
                store.selectedTab = .inbox
            }

            VStack(spacing: 10) {
                ForEach(store.tasks.prefix(4)) { task in
                    ActivityRow(task: task)
                }
            }

            if !store.offlineQueue.isEmpty {
                GoCard {
                    Label("\(store.offlineQueue.count) offline action\(store.offlineQueue.count == 1 ? "" : "s") queued", systemImage: "arrow.triangle.2.circlepath")
                        .font(.headline)
                    Text("Drafts and notification routes are preserved so users can resume without going back to the website.")
                        .font(.footnote)
                        .foregroundStyle(GoTheme.muted)
                }
            }
        }
    }
}

private struct HomeHeader: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                OxSteedGoMark(size: 58)
                Spacer()
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "bell")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .background(GoTheme.card, in: Circle())
                    Circle()
                        .fill(GoTheme.amber)
                        .frame(width: 8, height: 8)
                        .offset(x: -6, y: 7)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Home")
                    .font(.system(size: 36, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                Text("Good morning, \(store.currentUser?.email?.components(separatedBy: "@").first ?? "Alex") 👋")
                    .font(.headline)
                    .foregroundStyle(.white)
                Text("What can we help you with today?")
                    .font(.subheadline)
                    .foregroundStyle(GoTheme.muted)
            }
        }
    }
}

private struct SearchPill: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.white.opacity(0.85))
            ZStack(alignment: .leading) {
                if text.isEmpty {
                    Text("Search jobs, services, guides...")
                        .foregroundStyle(GoTheme.muted)
                }
                TextField("", text: $text)
                    .foregroundStyle(.white)
                    .tint(GoTheme.amber)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 48)
        .background(GoTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(GoTheme.border, lineWidth: 1))
    }
}

private struct PremiumHelpHeroCard: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.06, green: 0.08, blue: 0.10),
                            Color(red: 0.23, green: 0.13, blue: 0.06),
                            Color(red: 0.55, green: 0.23, blue: 0.02)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    HeroWorkerIllustration()
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                        .padding(.trailing, 8)
                        .padding(.top, 8)
                )
                .overlay(
                    VStack {
                        HStack {
                            Text("OXSTEED MATCH")
                                .font(.caption2.weight(.heavy))
                                .tracking(1.4)
                                .foregroundStyle(.white.opacity(0.82))
                                .padding(.vertical, 5)
                                .padding(.horizontal, 9)
                                .background(.white.opacity(0.12), in: Capsule())
                            Spacer()
                        }
                        Spacer()
                    }
                    .padding(16)
                )
                .overlay(
                    LinearGradient(colors: [.black.opacity(0.72), .clear], startPoint: .leading, endPoint: .trailing)
                )
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            VStack(alignment: .leading, spacing: 10) {
                Text("Need help today?")
                    .font(.title2.bold())
                    .foregroundStyle(.white)
                Text("Post once. Match, book, message, and pay from here.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.82))
                    .lineLimit(2)
                    .frame(maxWidth: 245, alignment: .leading)
                Button("Post a Job") {
                    store.selectedTab = .hire
                }
                .buttonStyle(GoAccentButtonStyle())
                .padding(.top, 2)
            }
            .padding(18)
        }
        .frame(height: 176)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(GoTheme.border, lineWidth: 1))
        .shadow(color: GoTheme.amber.opacity(0.18), radius: 24, x: 0, y: 10)
    }
}

private struct HeroWorkerIllustration: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(GoTheme.amber.opacity(0.24))
                .frame(width: 148, height: 148)
                .blur(radius: 4)
                .offset(x: 22, y: 18)
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.black.opacity(0.24))
                .frame(width: 122, height: 118)
                .rotationEffect(.degrees(-6))
                .offset(x: 10, y: 26)
            Image(systemName: "person.fill")
                .font(.system(size: 72, weight: .bold))
                .foregroundStyle(.white.opacity(0.22))
                .offset(x: -4, y: 14)
            Image(systemName: "hammer.fill")
                .font(.system(size: 42, weight: .heavy))
                .foregroundStyle(GoTheme.amber.opacity(0.72))
                .rotationEffect(.degrees(-28))
                .offset(x: 36, y: -18)
            Image(systemName: "sparkles")
                .font(.title3.bold())
                .foregroundStyle(.white.opacity(0.74))
                .offset(x: -44, y: -42)
        }
        .accessibilityHidden(true)
    }
}

private struct SectionHeader: View {
    let title: String
    let action: String
    let onTap: () -> Void

    var body: some View {
        HStack {
            Text(title)
                .font(.headline.bold())
                .foregroundStyle(.white)
            Spacer()
            Button(action, action: onTap)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(GoTheme.amber)
                .buttonStyle(.plain)
        }
    }
}

private struct ActiveModesGrid: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ModePreviewCard(
                    badge: "LEARN",
                    imageSymbol: "play.circle.fill",
                    title: "Fix a sink leak in 8 min",
                    subtitle: "Step-by-step video",
                    footer: "4 of 6 steps",
                    progress: 0.68
                ) {
                    store.selectedTab = .hire
                }
                .frame(width: 148)

                ModePreviewCard(
                    badge: "TOOLS",
                    imageSymbol: "ladder",
                    title: "Rent a ladder today",
                    subtitle: "From $12 / day",
                    footer: "Browse tools",
                    progress: 0
                ) {
                    store.selectedTab = .shop
                }
                .frame(width: 148)

                ProStatusCard()
                    .frame(width: 148)
            }
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
    }
}

private struct ModePreviewCard: View {
    let badge: String
    let imageSymbol: String
    let title: String
    let subtitle: String
    let footer: String
    let progress: Double
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 9) {
                ZStack(alignment: .bottomLeading) {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [Color(red: 0.40, green: 0.33, blue: 0.23), Color(red: 0.09, green: 0.11, blue: 0.12)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(height: 86)
                    Image(systemName: imageSymbol)
                        .font(.system(size: 44, weight: .bold))
                        .foregroundStyle(.white.opacity(0.62))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    Text(badge)
                        .font(.caption2.bold())
                        .foregroundStyle(.white)
                        .padding(.vertical, 4)
                        .padding(.horizontal, 9)
                        .background(GoTheme.amber, in: Capsule())
                        .padding(8)
                }

                Text(title)
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                    .lineLimit(2)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(GoTheme.muted)
                Text(footer)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.88))
                    .padding(.top, 2)

                if progress > 0 {
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.white.opacity(0.12))
                            Capsule()
                                .fill(GoTheme.amber)
                                .frame(width: proxy.size.width * progress)
                        }
                    }
                    .frame(height: 6)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 246, alignment: .top)
            .background(GoTheme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(GoTheme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

private struct ProStatusCard: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        Button {
            store.selectedTab = .inbox
        } label: {
            VStack(alignment: .leading, spacing: 11) {
                Text("PRO")
                    .font(.caption2.bold())
                    .foregroundStyle(.white)
                    .padding(.vertical, 4)
                    .padding(.horizontal, 10)
                    .background(GoTheme.amber, in: Capsule())

                Text("2 unpaid\ninvoices")
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                Text("$1,250 due")
                    .font(.caption.bold())
                    .foregroundStyle(GoTheme.amber)

                Divider().overlay(.white.opacity(0.12))

                Text("Next booking")
                    .font(.caption)
                    .foregroundStyle(GoTheme.muted)
                Text("3:30 PM today")
                    .font(.caption.bold())
                    .foregroundStyle(GoTheme.amber)

                Text("Open Pro")
                    .font(.caption.bold())
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 246, alignment: .top)
            .background(GoTheme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(GoTheme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

private struct MetricStrip: View {
    let metrics: [GoMetric]

    var body: some View {
        HStack(spacing: 10) {
            ForEach(metrics.prefix(3)) { metric in
                GoCard {
                    Image(systemName: metric.symbolName)
                        .font(.headline.bold())
                        .foregroundStyle(GoTheme.amber)
                    Text(metric.value)
                        .font(.title.bold())
                    Text(metric.label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(GoTheme.muted)
                }
            }
        }
    }
}

private struct ActivityRow: View {
    let task: GoTask

    var body: some View {
        HStack(spacing: 12) {
            GoModeGlyph(symbolName: "clock.arrow.circlepath", size: 38)
            VStack(alignment: .leading, spacing: 4) {
                Text(task.title)
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                Text(task.subtitle)
                    .font(.caption)
                    .foregroundStyle(GoTheme.muted)
            }
            Spacer()
            Text(task.badge)
                .font(.caption2.bold())
                .foregroundStyle(GoTheme.amber)
                .padding(.vertical, 6)
                .padding(.horizontal, 9)
                .background(GoTheme.amber.opacity(0.10), in: Capsule())
        }
        .padding(12)
        .background(GoTheme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(GoTheme.border, lineWidth: 1))
    }
}
