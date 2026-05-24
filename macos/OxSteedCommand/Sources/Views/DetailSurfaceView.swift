import SwiftUI

struct DetailSurfaceView: View {
    @Bindable var store: CommandCenterStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HeroPanel(store: store)

                if store.selectedSection == .commandCenter || store.selectedSection == nil {
                    OverviewMetricsView(metrics: store.topMetrics)
                    PriorityMovesView(tasks: store.priorityMoves)
                }

                SectionHeaderView(
                    title: store.selectedSection?.title ?? "Command Center",
                    subtitle: store.selectedSection?.blurb ?? "Executive view across OxSteed."
                )

                ForEach(store.visibleInitiatives) { initiative in
                    InitiativeCard(initiative: initiative)
                }

                if store.visibleInitiatives.isEmpty {
                    ContentUnavailableView(
                        "No matching initiatives",
                        systemImage: "magnifyingglass",
                        description: Text("Try a broader search term or switch back to the full command center view.")
                    )
                    .frame(maxWidth: .infinity, minHeight: 240)
                }
            }
            .padding(24)
        }
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.96, green: 0.97, blue: 0.99),
                    Color(red: 0.93, green: 0.95, blue: 0.98)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        )
    }
}

private struct HeroPanel: View {
    @Bindable var store: CommandCenterStore

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("OxSteed Executive Desk")
                .font(.system(size: 30, weight: .bold, design: .rounded))

            Text(store.statusHeadline)
                .font(.title3)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Label("Operator: \(store.operatorName)", systemImage: "person.crop.circle.badge.checkmark")
                Label("API: \(store.apiBaseURL)", systemImage: "network")
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.10, green: 0.18, blue: 0.31),
                            Color(red: 0.15, green: 0.39, blue: 0.56),
                            Color(red: 0.88, green: 0.47, blue: 0.23)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .foregroundStyle(.white)
    }
}

private struct OverviewMetricsView: View {
    let metrics: [CommandMetric]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 16)], spacing: 16) {
            ForEach(metrics) { metric in
                VStack(alignment: .leading, spacing: 10) {
                    Text(metric.label.uppercased())
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Text(metric.value)
                        .font(.title2.weight(.semibold))

                    Text(metric.note)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
        }
    }
}

private struct PriorityMovesView: View {
    let tasks: [CommandTask]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Priority Moves")
                .font(.title2.weight(.semibold))

            ForEach(tasks) { task in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "flag.fill")
                        .foregroundStyle(Color(red: 0.88, green: 0.47, blue: 0.23))
                        .padding(.top, 2)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(task.title)
                            .font(.headline)
                        Text(task.detail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
    }
}

private struct SectionHeaderView: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.title2.weight(.semibold))
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}
