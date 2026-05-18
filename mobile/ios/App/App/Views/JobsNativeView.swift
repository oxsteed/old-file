import SwiftUI

@MainActor
final class JobsViewModel: ObservableObject {
    @Published var jobs: [NativeJob] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            jobs = try await OxSteedAPIClient.shared.jobs()
        } catch {
            errorMessage = "Open jobs are temporarily unavailable."
        }
        isLoading = false
    }
}

struct JobsNativeView: View {
    @StateObject private var model = JobsViewModel()
    @EnvironmentObject private var router: OxSteedRouter

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HeroHeader(
                        eyebrow: "Native job board",
                        title: "See open local work.",
                        subtitle: "Helpers can review fresh job scope, category, budget, urgency, and location signals directly in the native app."
                    )

                    if model.isLoading {
                        ProgressView("Loading open jobs...")
                            .frame(maxWidth: .infinity, minHeight: 120)
                    } else if let error = model.errorMessage {
                        NativeEmptyState(title: "Jobs paused", message: error, systemImage: "briefcase.fill")
                    } else {
                        VStack(spacing: 12) {
                            ForEach(model.jobs) { job in
                                JobCard(job: job) {
                                    router.open(job.route)
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(AppTheme.background)
            .navigationTitle("Jobs")
            .toolbar {
                Button {
                    Task { await model.load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
            .task {
                if model.jobs.isEmpty {
                    await model.load()
                }
            }
        }
    }
}

private struct JobCard: View {
    let job: NativeJob
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(job.categoryName ?? "Local service")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.orange)
                        Text(job.title)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer()
                    if job.isUrgent == true {
                        Label("Urgent", systemImage: "bolt.fill")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.red)
                    }
                }

                if let description = job.description, !description.isEmpty {
                    Text(description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(3)
                }

                HStack(spacing: 10) {
                    Label(location, systemImage: "mappin.and.ellipse")
                    if let bids = job.bidCount {
                        Label("\(bids) bids", systemImage: "bubble.left.and.bubble.right.fill")
                    }
                    Text(budget)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var location: String {
        [job.locationCity, job.locationState].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: ", ")
    }

    private var budget: String {
        let min = job.budgetMin?.value ?? 0
        let max = job.budgetMax?.value ?? 0
        if max > 0 {
            return "$\(Int(min))-$\(Int(max))"
        }
        if min > 0 {
            return "From $\(Int(min))"
        }
        return "Open budget"
    }
}
