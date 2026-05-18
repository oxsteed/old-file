import SwiftUI

@MainActor
final class DiscoverViewModel: ObservableObject {
    @Published var query = ""
    @Published var results: [DiscoverItem] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func loadPopular() async {
        await load { try await OxSteedAPIClient.shared.popularDiscover() }
    }

    func search() async {
        await load { try await OxSteedAPIClient.shared.searchDiscover(query: query) }
    }

    private func load(_ operation: () async throws -> [DiscoverItem]) async {
        isLoading = true
        errorMessage = nil
        do {
            results = try await operation()
        } catch {
            errorMessage = "OxSteed discovery is temporarily unavailable."
        }
        isLoading = false
    }
}

struct DiscoverNativeView: View {
    @StateObject private var model = DiscoverViewModel()
    @EnvironmentObject private var router: OxSteedRouter

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HeroHeader(
                        eyebrow: "Native discovery",
                        title: "Search real OxSteed listings.",
                        subtitle: "Browse helpers, open jobs, businesses, tools, and products from live OxSteed data without leaving the native app."
                    )

                    HStack(spacing: 10) {
                        TextField("Search electricians, cleaning, tutoring...", text: $model.query)
                            .textFieldStyle(.roundedBorder)
                            .submitLabel(.search)
                            .onSubmit { Task { await model.search() } }

                        Button {
                            Task { await model.search() }
                        } label: {
                            Image(systemName: "magnifyingglass")
                                .frame(width: 42, height: 42)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.orange)
                    }

                    if model.isLoading {
                        ProgressView("Loading OxSteed listings...")
                            .frame(maxWidth: .infinity, minHeight: 120)
                    } else if let error = model.errorMessage {
                        NativeEmptyState(title: "Discovery paused", message: error, systemImage: "wifi.exclamationmark")
                    } else {
                        VStack(spacing: 12) {
                            ForEach(model.results) { item in
                                DiscoverResultCard(item: item) {
                                    router.open(item.route)
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(AppTheme.background)
            .navigationTitle("Discover")
            .task {
                if model.results.isEmpty {
                    await model.loadPopular()
                }
            }
        }
    }
}

private struct DiscoverResultCard: View {
    let item: DiscoverItem
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: symbol)
                    .font(.title2)
                    .foregroundStyle(.orange)
                    .frame(width: 34)

                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(item.type.capitalized)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.secondary)
                        if let distance = item.distanceMiles {
                            Text("\(distance, specifier: "%.1f") mi")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(item.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    if let subtitle = item.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.leading)
                            .lineLimit(3)
                    }
                    if let rating = item.rating {
                        Label("\(rating, specifier: "%.1f") rating", systemImage: "star.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.orange)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var symbol: String {
        switch item.type {
        case "helper": return "person.crop.circle.badge.checkmark"
        case "job": return "briefcase.fill"
        case "business": return "building.2.fill"
        case "tool": return "wrench.and.screwdriver.fill"
        default: return "square.grid.2x2.fill"
        }
    }
}
