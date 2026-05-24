import SwiftUI

struct TodayView: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        @Bindable var store = store

        GoScreen(title: GoLocalization.text(.today, language: store.appLanguage)) {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Mode", selection: $store.mode) {
                    ForEach(GoMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                HeroView()
            }

            MetricGrid(metrics: store.metrics)

            GoCard {
                HStack {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(store.isSignedIn ? "Live OxSteed data" : "Preview mode")
                            .font(.headline)
                        Text(store.isSignedIn ? "Dashboard, inbox, marketplace, and logistics data refresh natively." : "Sign in from Me to replace preview content with your live OxSteed account.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Refresh") {
                        Task { await store.refreshEverything() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(GoTheme.sea)
                }
            }

            if !store.offlineQueue.isEmpty {
                GoCard {
                    Label("\(store.offlineQueue.count) offline action\(store.offlineQueue.count == 1 ? "" : "s") queued", systemImage: "arrow.triangle.2.circlepath")
                        .font(.headline)
                    Text("Drafts and notification routes are preserved so users can resume without going back to the website.")
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 12) {
                Text(GoLocalization.text(.fastActions, language: store.appLanguage))
                    .font(.title2.bold())
                ForEach(store.primaryActions) { action in
                    ActionCard(action: action)
                }
            }

            VStack(alignment: .leading, spacing: 12) {
                Text(GoLocalization.text(.needsAttention, language: store.appLanguage))
                    .font(.title2.bold())
                ForEach(store.tasks) { task in
                    TaskRow(task: task)
                }
            }
        }
    }
}

private struct HeroView: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        GoCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(store.heroTitle)
                        .font(.largeTitle.bold())
                        .foregroundStyle(.white)
                    Text(store.heroSubtitle)
                        .font(.headline)
                        .foregroundStyle(.white.opacity(0.78))
                }
                Spacer()
                Image(systemName: "figure.run.circle.fill")
                    .font(.system(size: 54, weight: .semibold))
                    .foregroundStyle(GoTheme.amber)
            }
        }
        .background(
            LinearGradient(colors: [GoTheme.navy, GoTheme.sea], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
    }
}

private struct MetricGrid: View {
    let metrics: [GoMetric]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 105), spacing: 12)], spacing: 12) {
            ForEach(metrics) { metric in
                GoCard {
                    Image(systemName: metric.symbolName)
                        .font(.title3.bold())
                        .foregroundStyle(GoTheme.amber)
                    Text(metric.value)
                        .font(.largeTitle.bold())
                    Text(metric.label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct ActionCard: View {
    let action: GoAction

    var body: some View {
        GoCard {
            HStack(spacing: 14) {
                Image(systemName: action.symbolName)
                    .font(.title2.bold())
                    .foregroundStyle(action.tint)
                    .frame(width: 42, height: 42)
                    .background(action.tint.opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: 5) {
                    Text(action.title)
                        .font(.headline)
                    Text(action.detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

private struct TaskRow: View {
    let task: GoTask

    var body: some View {
        GoCard {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(task.title)
                        .font(.headline)
                    Text(task.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(task.badge)
                    .font(.caption.bold())
                    .foregroundStyle(GoTheme.sea)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 10)
                    .background(GoTheme.sea.opacity(0.12), in: Capsule())
            }
        }
    }
}
