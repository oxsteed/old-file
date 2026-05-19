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
                                NavigationLink {
                                    JobDetailNativeView(jobId: job.id.value, fallback: job)
                                } label: {
                                    JobCard(job: job)
                                }
                                .buttonStyle(.plain)
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

    var body: some View {
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
                Label(location.isEmpty ? "Remote/local" : location, systemImage: "mappin.and.ellipse")
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

struct JobDetailNativeView: View {
    let jobId: String
    let fallback: NativeJob
    @EnvironmentObject private var router: OxSteedRouter
    @EnvironmentObject private var session: SessionStore
    @State private var job: NativeJobDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if isLoading && job == nil {
                    ProgressView("Loading job...")
                        .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    header
                    quickFacts
                    descriptionSection
                    requirementsSection
                    actionPanel
                }

                if let errorMessage {
                    NativeEmptyState(title: "Job details paused", message: errorMessage, systemImage: "briefcase.fill")
                }
            }
            .padding(20)
        }
        .background(AppTheme.background)
        .navigationTitle("Job")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if job == nil { await load() }
        }
    }

    private var currentTitle: String { job?.title ?? fallback.title }
    private var currentDescription: String { job?.description?.nilIfBlank ?? fallback.description?.nilIfBlank ?? "The customer has not added more written scope yet." }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(job?.categoryName ?? fallback.categoryName ?? "Local service")
                .font(.caption.weight(.bold))
                .foregroundStyle(.orange)
            Text(currentTitle)
                .font(.largeTitle.bold())
            Text([job?.locationCity ?? fallback.locationCity, job?.locationState ?? fallback.locationState].compactMap { $0?.nilIfBlank }.joined(separator: ", "))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if job?.isUrgent == true || fallback.isUrgent == true {
                Label("Urgent request", systemImage: "bolt.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var quickFacts: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 10)], spacing: 10) {
            JobFactTile(title: "Budget", value: budget, systemImage: "dollarsign.circle.fill")
            JobFactTile(title: "Bids", value: "\(job?.bidCount ?? fallback.bidCount ?? 0)", systemImage: "bubble.left.and.bubble.right.fill")
            JobFactTile(title: "Status", value: job?.status ?? fallback.status ?? "Open", systemImage: "flag.fill")
            JobFactTile(title: "Schedule", value: schedule, systemImage: "calendar")
        }
    }

    private var descriptionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Scope")
                .font(.headline)
            Text(currentDescription)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var requirementsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Requirements")
                .font(.headline)
            let requirements = job?.requirements ?? []
            if requirements.isEmpty {
                Text("No special requirements listed.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(requirements, id: \.self) { requirement in
                    Label(requirement, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var actionPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Next action")
                .font(.headline)
            Text(session.isSignedIn ? "Submit a quote natively. OxSteed will still handle customer acceptance and payment protection later." : "Sign in on the Account tab to bid or manage this job.")
                .font(.caption)
                .foregroundStyle(.secondary)
            if session.isSignedIn {
                NavigationLink {
                    BidSubmissionNativeView(jobId: jobId, jobTitle: currentTitle, suggestedAmount: suggestedBidAmount)
                } label: {
                    Label("Submit native bid", systemImage: "paperplane.fill")
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
            } else {
                Text("Sign in to bid.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            SecondaryButton(title: "Share job link", systemImage: "square.and.arrow.up") {
                router.open(fallback.route)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var budget: String {
        let min = job?.budgetMin?.value ?? fallback.budgetMin?.value ?? 0
        let max = job?.budgetMax?.value ?? fallback.budgetMax?.value ?? 0
        if max > 0 { return "$\(Int(min))-$\(Int(max))" }
        if min > 0 { return "From $\(Int(min))" }
        return "Open"
    }

    private var suggestedBidAmount: String {
        let max = job?.budgetMax?.value ?? fallback.budgetMax?.value ?? 0
        let min = job?.budgetMin?.value ?? fallback.budgetMin?.value ?? 0
        let amount = max > 0 ? max : min
        return amount > 0 ? String(Int(amount)) : ""
    }

    private var schedule: String {
        if let date = job?.scheduledDate?.nilIfBlank {
            return [date, job?.scheduledTime].compactMap { $0?.nilIfBlank }.joined(separator: " ")
        }
        return "Flexible"
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            job = try await OxSteedAPIClient.shared.jobDetail(id: jobId)
        } catch {
            errorMessage = "Could not load the full native job detail. The public job route is still available."
        }
        isLoading = false
    }
}

struct BidSubmissionNativeView: View {
    let jobId: String
    let jobTitle: String
    let suggestedAmount: String
    @State private var amount = ""
    @State private var etaHours = ""
    @State private var message = ""
    @State private var isSubmitting = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Job") {
                Text(jobTitle)
                    .font(.headline)
                Text("Your quote creates a real OxSteed bid. The customer can accept it later; payment is not collected at bid submission.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Quote") {
                TextField("Amount", text: $amount)
                    .keyboardType(.decimalPad)
                TextField("Estimated hours (optional)", text: $etaHours)
                    .keyboardType(.decimalPad)
                TextField("Message to customer", text: $message, axis: .vertical)
                    .lineLimit(5, reservesSpace: true)
            }
            Section {
                Button(isSubmitting ? "Submitting..." : "Submit bid") {
                    Task { await submit() }
                }
                .disabled(isSubmitting || Double(amount) == nil || message.trimmed.isEmpty)
            }
            if let statusMessage {
                Section {
                    Text(statusMessage)
                }
            }
        }
        .navigationTitle("Submit Bid")
        .onAppear {
            if amount.isEmpty { amount = suggestedAmount }
            if message.isEmpty { message = "I can help with this job. I reviewed the scope and can coordinate timing through OxSteed." }
        }
    }

    private func submit() async {
        guard let quote = Double(amount) else {
            statusMessage = "Enter a valid bid amount."
            return
        }
        isSubmitting = true
        statusMessage = nil
        do {
            let bid = try await OxSteedAPIClient.shared.submitBid(BidSubmission(
                job_id: jobId,
                amount: quote,
                message: message.trimmed,
                eta_hours: Double(etaHours)
            ))
            statusMessage = "Bid submitted. Status: \(bid.status ?? "pending")."
        } catch {
            statusMessage = "Could not submit this bid. Helper accounts may need verified email, active onboarding, and Pro trial access."
        }
        isSubmitting = false
    }
}

private struct JobFactTile: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: systemImage)
                .foregroundStyle(.orange)
            Text(value)
                .font(.headline)
                .lineLimit(2)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private extension String {
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
