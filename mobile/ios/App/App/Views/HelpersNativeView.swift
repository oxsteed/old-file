import SwiftUI

@MainActor
final class HelpersViewModel: ObservableObject {
    @Published var query = ""
    @Published var helpers: [NativeHelper] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            helpers = try await OxSteedAPIClient.shared.helpers(query: query)
        } catch {
            errorMessage = "Helper search is temporarily unavailable."
        }
        isLoading = false
    }
}

struct HelpersNativeView: View {
    @StateObject private var model = HelpersViewModel()
    @EnvironmentObject private var router: OxSteedRouter

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HeroHeader(
                        eyebrow: "Native helper directory",
                        title: "Compare local helpers in the app.",
                        subtitle: "OxSteed profiles carry service context, ratings, completed-work signals, verification, and booking paths."
                    )

                    HStack(spacing: 10) {
                        TextField("Search helpers", text: $model.query)
                            .textFieldStyle(.roundedBorder)
                            .submitLabel(.search)
                            .onSubmit { Task { await model.load() } }
                        Button("Search") {
                            Task { await model.load() }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.orange)
                    }

                    if model.isLoading {
                        ProgressView("Loading helpers...")
                            .frame(maxWidth: .infinity, minHeight: 120)
                    } else if let error = model.errorMessage {
                        NativeEmptyState(title: "Directory paused", message: error, systemImage: "person.crop.circle.badge.exclamationmark")
                    } else {
                        VStack(spacing: 12) {
                            ForEach(model.helpers) { helper in
                                HelperCard(helper: helper) {
                                    router.open(helper.route)
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(AppTheme.background)
            .navigationTitle("Helpers")
            .task {
                if model.helpers.isEmpty {
                    await model.load()
                }
            }
        }
    }
}

private struct HelperCard: View {
    let helper: NativeHelper
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Image(systemName: "person.crop.circle.fill.badge.checkmark")
                        .font(.largeTitle)
                        .foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(helper.displayName)
                            .font(.headline)
                            .foregroundStyle(.primary)
                        Text(location)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(.tertiary)
                }

                Text(helper.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)

                HStack(spacing: 10) {
                    if let rating = helper.rating, rating > 0 {
                        Label("\(rating, specifier: "%.1f")", systemImage: "star.fill")
                    }
                    if let completed = helper.jobsCompleted, completed > 0 {
                        Label("\(completed) jobs", systemImage: "checkmark.circle.fill")
                    }
                    if helper.verified == true {
                        Label("Verified", systemImage: "shield.checkered")
                    }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var location: String {
        [helper.city, helper.state].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: ", ")
    }
}
