import SwiftUI

// MARK: - Post Job

/// Pre-fill data passed from Life tab pillar views.
struct PostJobPrefill: Identifiable {
    let id = UUID()
    var title: String = ""
    var description: String = ""
    var category: String = "Handyman"
    var urgency: String = "this_week"
}

struct PostJobView: View {
    // Optional prefill from Life tab tasks/vehicles
    var prefill: PostJobPrefill? = nil

    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var description = ""
    @State private var category = "Plumbing"
    @State private var budgetMin = "50"
    @State private var budgetMax = "200"
    @State private var urgency = "this_week"
    @State private var city = ""
    @State private var state = ""
    @State private var zip = ""
    @State private var uploadedMediaURLs: [String] = []
    @State private var isUploading = false
    @State private var isRecurring = false
    @State private var recurrenceInterval = "weekly"

    // MARK: AI Intake
    @State private var showAIIntake       = false
    @State private var aiInputText        = ""
    @State private var isParsingAI        = false
    @State private var aiError: String?   = nil
    @State private var aiSuggestedTools:     [String] = []
    @State private var aiClarifyingQuestions:[String] = []
    @State private var showAIResultBanner  = false

    private let categories = ["Plumbing","Electrical","Cleaning","Moving","Handyman","Yard Work","HVAC","Painting"]
    private let urgencies = ["asap","this_week","next_week","flexible"]
    private let recurrenceOptions = ["Weekly","Bi-weekly","Monthly"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    // ── AI Intake card ───────────────────────────────────────
                    AIIntakeCard(
                        show: $showAIIntake,
                        suggestedTools: aiSuggestedTools,
                        clarifyingQuestions: aiClarifyingQuestions,
                        showBanner: showAIResultBanner
                    )

                    HStack(spacing: 8) {
                        OxTextField(title: "Title", text: $title)
                        VoiceMicButton(text: $title, locale: speechLocale(for: localization.bcp47))
                            .frame(width: 36)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Description")
                                .font(.system(size: 11, weight: .semibold))
                                .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
                            Spacer()
                            VoiceMicButton(text: $description, locale: speechLocale(for: localization.bcp47))
                                .frame(width: 32)
                        }
                        TextEditor(text: $description)
                            .scrollContentBackground(.hidden)
                            .frame(height: 110)
                            .padding(8)
                            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                            .foregroundStyle(Theme.textPrimary)
                    }

                    pickerCard(title: "Category", selection: $category, options: categories)
                    pickerCard(title: "Urgency", selection: $urgency, options: urgencies)

                    HStack(spacing: 10) {
                        OxTextField(title: "Budget min ($)", text: $budgetMin, keyboard: .numberPad)
                        OxTextField(title: "Budget max ($)", text: $budgetMax, keyboard: .numberPad)
                    }
                    OxTextField(title: "City", text: $city)
                    HStack(spacing: 10) {
                        OxTextField(title: "State", text: $state)
                        OxTextField(title: "ZIP", text: $zip, keyboard: .numberPad)
                    }

                    ImagePickerButton(label: "feature.add_photos", purpose: "job_media",
                                      uploadedURLs: $uploadedMediaURLs,
                                      isUploading: $isUploading)

                    // ── Recurring / subscription ──────────────────────────────
                    VStack(alignment: .leading, spacing: 10) {
                        Toggle(isOn: $isRecurring) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Recurring Service")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text("Subscribe to this job on a repeating schedule.")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        .tint(Theme.accent)

                        if isRecurring {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Frequency")
                                    .font(.system(size: 11, weight: .semibold))
                                    .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
                                HStack(spacing: 8) {
                                    ForEach(recurrenceOptions, id: \.self) { opt in
                                        Button {
                                            recurrenceInterval = opt
                                        } label: {
                                            Text(localization.localized(opt))
                                                .font(.system(size: 13, weight: .semibold))
                                                .foregroundStyle(recurrenceInterval == opt ? .white : Theme.textSecondary)
                                                .padding(.horizontal, 14).padding(.vertical, 8)
                                                .background(recurrenceInterval == opt ? Theme.accent : Theme.surfaceElevated,
                                                            in: Capsule())
                                                .overlay(Capsule().strokeBorder(recurrenceInterval == opt ? Theme.accent : Theme.stroke, lineWidth: 1))
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                    }
                    .cardStyle()

                    if let err = jobs.lastError {
                        Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    }

                    Button {
                        Task {
                            let inferredCountry = Locale.current.region?.identifier ?? "US"
                            let minBudget = Int(budgetMin.trimmingCharacters(in: .whitespacesAndNewlines))
                            let maxBudget = Int(budgetMax.trimmingCharacters(in: .whitespacesAndNewlines))
                            let req = JobCreateRequest(
                                title: title, description: description,
                                category_name: category,
                                budget_type: "fixed",
                                budget_min: minBudget,
                                budget_max: maxBudget,
                                urgency: backendUrgency(urgency),
                                location_city: city, location_state: state,
                                location_country: inferredCountry, location_zip: zip,
                                scheduled_date: nil, scheduled_time: nil,
                                required_skills: nil,
                                media_urls: uploadedMediaURLs.isEmpty ? nil : uploadedMediaURLs,
                                is_recurring: isRecurring ? true : nil,
                                recurrence_interval: isRecurring ? recurrenceInterval : nil)
                            if await jobs.create(req) { dismiss() }
                        }
                    } label: {
                        Text("feature.post_job")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(title.count < 10 || description.count < 50 || city.isEmpty || isUploading)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("New Job")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .sheet(isPresented: $showAIIntake) {
                AIIntakeSheet(
                    inputText: $aiInputText,
                    isLoading: $isParsingAI,
                    errorMessage: $aiError
                ) { result in
                    applyIntakeResult(result)
                }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
            }
            .onAppear {
                if let p = prefill {
                    if !p.title.isEmpty       { title       = p.title }
                    if !p.description.isEmpty { description = p.description }
                    if !p.category.isEmpty    { category    = p.category }
                    if !p.urgency.isEmpty     { urgency     = p.urgency }
                }
            }
        }
    }

    private func applyIntakeResult(_ result: JobIntakeResult) {
        title       = result.title
        description = result.description
        category    = result.category
        urgency     = result.urgency
        if result.budgetMinDollars > 0 { budgetMin = "\(result.budgetMinDollars)" }
        if result.budgetMaxDollars > 0 { budgetMax = "\(result.budgetMaxDollars)" }
        aiSuggestedTools         = result.suggestedTools
        aiClarifyingQuestions    = result.clarifyingQuestions
        showAIResultBanner       = true
        // Auto-hide banner after 4 seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            withAnimation { showAIResultBanner = false }
        }
    }

    private func pickerCard(title: String, selection: Binding<String>, options: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 11, weight: .semibold))
                .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
            Menu {
                ForEach(options, id: \.self) { opt in
                    Button(localization.localized(opt)) { selection.wrappedValue = opt }
                }
            } label: {
                HStack {
                    Text(localization.localized(selection.wrappedValue))
                        .foregroundStyle(Theme.textPrimary)
                    Spacer()
                    Image(systemName: "chevron.down").foregroundStyle(Theme.textTertiary)
                }
                .padding(.horizontal, 12).padding(.vertical, 12)
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
            }
        }
    }

    private func backendUrgency(_ value: String) -> String {
        switch value.lowercased() {
        case "high", "urgent", "asap":
            return "asap"
        case "medium", "this_week":
            return "this_week"
        case "low", "next_week":
            return "next_week"
        case "flexible":
            return "flexible"
        default:
            return "this_week"
        }
    }
}

// MARK: - Job Detail + Bid

struct JobDetailView: View {
    let job: APIJob
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @State private var bids: [APIBid] = []
    @State private var quotes: [APIHelperQuote] = []
    @State private var currentJob: APIJob?
    @State private var isLoadingProposals = false
    @State private var proposalError: String?
    @State private var acceptingBidId: String?
    @State private var updatingQuoteId: String?
    @State private var showBidSheet    = false
    @State private var showQuoteSheet  = false
    @State private var showAuthSheet   = false
    @State private var showReportSheet = false
    @State private var showReviewSheet = false
    @State private var reportSent      = false
    @State private var reviewEligible  = false
    @State private var actionMessage: String?

    private var displayedJob: APIJob { currentJob ?? job }
    private var isJobOwner: Bool {
        guard let userId = auth.user?.id, let customerId = displayedJob.customer_id else { return false }
        return userId == customerId
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(displayedJob.title)
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                HStack(spacing: 8) {
                    Text(localization.localized(displayedJob.statusDisplay))
                        .font(.system(size: 11, weight: .bold))
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(displayedJob.statusColor.opacity(0.16), in: Capsule())
                        .foregroundStyle(displayedJob.statusColor)
                    Text(displayedJob.budgetDisplay).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                if let d = displayedJob.description {
                    Text(d).font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Label(displayedJob.locationDisplay, systemImage: "location.fill")
                    if !displayedJob.scheduledDisplay.isEmpty {
                        Label(displayedJob.scheduledDisplay, systemImage: "calendar")
                    }
                }
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                .padding(.top, 4)

                if let actionMessage {
                    Text(actionMessage)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.success)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.success.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                }

                if let proposalError {
                    Text(proposalError)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.danger)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
                }

                if displayedJob.status == "completed" && reviewEligible {
                    Button {
                        showReviewSheet = true
                    } label: {
                        Label("review.title", systemImage: "star.fill")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .padding(.top, 8)
                } else if displayedJob.status == "published" || displayedJob.status == "open" || displayedJob.status == "matched" || displayedJob.status == "negotiating" {
                    Group {
                        if isJobOwner {
                            ownerProposalSummary
                        } else {
                            helperActionButtons
                        }
                    }
                    .padding(.top, 8)
                }

                if isLoadingProposals {
                    HStack(spacing: 10) {
                        ProgressView().tint(Theme.accent)
                        Text("Loading proposals…").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    }
                    .cardStyle(padding: 12)
                }

                if isJobOwner && !quotes.isEmpty {
                    Text(localization.format("Quotes (%d)", quotes.count)).sectionTitle().padding(.top, 8)
                    ForEach(quotes) { quote in
                        receivedQuoteCard(quote)
                    }
                }

                if !bids.isEmpty {
                    Text(localization.format(isJobOwner ? "Bids (%d)" : "Your bid (%d)", bids.count)).sectionTitle().padding(.top, 8)
                    ForEach(bids) { b in
                        bidCard(b)
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Job")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        // Report job listing (Guideline 1.2)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showReportSheet = true } label: {
                    Image(systemName: "flag")
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .sheet(isPresented: $showReviewSheet) {
            ReviewSheet(job: displayedJob, onDone: { reviewEligible = false })
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showBidSheet) { PlaceBidSheet(job: displayedJob).presentationDetents([.medium]) }
        .sheet(isPresented: $showQuoteSheet) {
            QuoteBuilderView(jobId: displayedJob.id, jobTitle: displayedJob.title) { showQuoteSheet = false }
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showAuthSheet) {
            AuthLandingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showReportSheet) {
            ReportUserSheet(
                userId: displayedJob.customer_id.map { String($0) },
                contentType: "job",
                contentId: displayedJob.id,
                onDone: { showReportSheet = false; reportSent = true }
            )
            .presentationDetents([.medium])
            .presentationBackground(Theme.background)
        }
        .overlay(alignment: .top) {
            if reportSent {
                Text("chat.report_sent")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Theme.success, in: Capsule())
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 3) { withAnimation { reportSent = false } } }
            }
        }
        .task {
            await loadProposals()
            if displayedJob.status == "completed" && auth.user != nil {
                reviewEligible = (try? await ReviewsService.isEligible(jobId: displayedJob.id)) ?? false
            }
        }
    }

    private var helperActionButtons: some View {
        VStack(spacing: 8) {
            Button {
                if auth.user == nil { showAuthSheet = true }
                else { showBidSheet = true }
            } label: {
                Text("bid.place_title")
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
            }
            Button {
                if auth.user == nil { showAuthSheet = true }
                else { showQuoteSheet = true }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "doc.text.fill")
                    Text("feature.build_quote")
                        .font(.system(size: 15, weight: .bold))
                }
                .foregroundStyle(Theme.accent)
                .frame(maxWidth: .infinity).padding(.vertical, 13)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.accent.opacity(0.3), lineWidth: 1))
            }
        }
    }

    private var ownerProposalSummary: some View {
        HStack(spacing: 10) {
            Label(localization.format("%d bids", bids.count), systemImage: "tray.full.fill")
            Label(localization.format("%d quotes", quotes.count), systemImage: "doc.text.fill")
            Spacer()
            Button {
                Task { await loadProposals() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }
            .disabled(isLoadingProposals)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(Theme.textSecondary)
        .cardStyle(padding: 12)
    }

    private func bidCard(_ bid: APIBid) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(bid.helper_name ?? localization.localized(L10n.CommonKey.helperFallback))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    if let message = bid.message, !message.isEmpty {
                        Text(message)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(3)
                    }
                    if let hours = bid.estimated_hours {
                        Text(localization.format("%.1f estimated hour(s)", hours))
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 5) {
                    Text(bid.amountDisplay)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.accent)
                    Text(localization.localized((bid.status ?? "pending").capitalized))
                        .font(.system(size: 10, weight: .bold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Theme.warning.opacity(0.14), in: Capsule())
                        .foregroundStyle(Theme.warning)
                }
            }
            if isJobOwner && (bid.status ?? "pending") == "pending" {
                Button {
                    Task { await acceptBid(bid) }
                } label: {
                    HStack(spacing: 6) {
                        if acceptingBidId == bid.id {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "checkmark.seal.fill")
                            Text("feature.accept_with_oxsteed")
                        }
                    }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(Theme.success, in: RoundedRectangle(cornerRadius: 12))
                }
                .disabled(acceptingBidId != nil)
            }
        }
        .cardStyle(padding: 12)
    }

    private func receivedQuoteCard(_ quote: APIHelperQuote) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(quote.helper_name ?? localization.localized(L10n.CommonKey.helperFallback))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(localization.format("%d line item(s)", quote.line_items.count))
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                    if let notes = quote.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(2)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 5) {
                    Text(localization.formatCents(quote.total_cents))
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(Theme.accent)
                    Text(localization.localized(quote.statusDisplay))
                        .font(.system(size: 10, weight: .bold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(quote.statusColor.opacity(0.14), in: Capsule())
                        .foregroundStyle(quote.statusColor)
                }
            }
            ForEach(quote.line_items.prefix(3)) { item in
                HStack {
                    Text(item.description)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                    Spacer()
                    Text(localization.formatCents(item.subtotal_cents))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                }
            }
            if quote.status == "sent" {
                HStack(spacing: 8) {
                    quoteStatusButton("feature.decline", systemImage: "xmark.circle.fill", color: Theme.danger) {
                        Task { await updateQuote(quote, status: "declined") }
                    }
                    quoteStatusButton("feature.accept", systemImage: "checkmark.circle.fill", color: Theme.success) {
                        Task { await updateQuote(quote, status: "accepted") }
                    }
                }
                .disabled(updatingQuoteId != nil)
            }
        }
        .cardStyle(padding: 12)
    }

    private func quoteStatusButton(_ title: String,
                                   systemImage: String,
                                   color: Color,
                                   action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if updatingQuoteId != nil {
                    ProgressView().tint(color)
                } else {
                    Image(systemName: systemImage)
                }
                Text(LocalizedStringKey(title))
            }
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(color)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(color.opacity(0.25), lineWidth: 1))
        }
    }

    private func loadProposals() async {
        guard auth.user != nil else { return }
        isLoadingProposals = true
        proposalError = nil
        defer { isLoadingProposals = false }
        async let bidLoad = BidsService.bidsForJob(displayedJob.id)
        async let quoteLoad = isJobOwner ? QuotesService.forJob(displayedJob.id) : []
        do {
            let (loadedBids, loadedQuotes) = try await (bidLoad, quoteLoad)
            bids = loadedBids
            quotes = loadedQuotes
        } catch {
            proposalError = (error as? APIError)?.errorDescription ?? "Unable to load proposals."
        }
    }

    private func acceptBid(_ bid: APIBid) async {
        acceptingBidId = bid.id
        proposalError = nil
        defer { acceptingBidId = nil }
        do {
            let result = try await JobsService.assignHelper(bidId: bid.id, paymentMethod: "oxsteed")
            currentJob = result.job
            bids = bids.map { $0.id == result.bid.id ? result.bid : $0 }
            actionMessage = "Bid accepted. The job is now assigned and added to the calendar."
            await loadProposals()
        } catch {
            proposalError = (error as? APIError)?.errorDescription ?? "Could not accept this bid."
        }
    }

    private func updateQuote(_ quote: APIHelperQuote, status: String) async {
        updatingQuoteId = quote.id
        proposalError = nil
        defer { updatingQuoteId = nil }
        do {
            let updated = try await QuotesService.updateStatus(quoteId: quote.id, status: status)
            quotes = quotes.map { $0.id == updated.id ? updated : $0 }
            actionMessage = status == "accepted" ? "Quote accepted." : "Quote declined."
        } catch {
            proposalError = (error as? APIError)?.errorDescription ?? "Could not update this quote."
        }
    }
}

struct PlaceBidSheet: View {
    let job: APIJob
    @EnvironmentObject var bidsStore: BidsStore
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var hours = ""
    @State private var message = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    Text(job.title).font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    OxTextField(title: "Your bid ($)", text: $amount, keyboard: .numberPad)
                    OxTextField(title: "Estimated hours", text: $hours, keyboard: .decimalPad)
                    OxTextField(title: "Message to customer", text: $message)
                    if let err = bidsStore.lastError {
                        Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    }
                    Button {
                        Task {
                            let cents = (Int(amount) ?? 0) * 100
                            let ok = await bidsStore.place(jobId: job.id, amountCents: cents,
                                                          message: message.isEmpty ? nil : message,
                                                          hours: Double(hours))
                            if ok { dismiss() }
                        }
                    } label: {
                        Text("bid.submit")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(amount.isEmpty)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Place Bid")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent) } }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }
}

// MARK: - AI Intake Card (shown on PostJobView when AI result is ready)

private struct AIIntakeCard: View {
    @Binding var show: Bool
    let suggestedTools: [String]
    let clarifyingQuestions: [String]
    let showBanner: Bool
    @ObservedObject private var ai = OxIntelligenceManager.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Banner shown after a successful parse
            if showBanner {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                    Text("Fields filled from your description")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                }
                .padding(12)
                .background(Theme.success.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            // Describe-your-need button
            Button {
                show = true
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(
                            LinearGradient(
                                colors: [Color.purple, Color.indigo],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            in: RoundedRectangle(cornerRadius: 10)
                        )
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text("Describe Your Need")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            if ai.isAvailable {
                                Text("AI")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 5).padding(.vertical, 2)
                                    .background(Color.purple, in: Capsule())
                            }
                        }
                        Text(ai.isAvailable
                             ? "Type or speak — AI fills the form for you"
                             : "Describe your need and we'll help structure it")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textTertiary)
                }
                .padding(14)
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 14))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(Color.purple.opacity(0.25), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)

            // Suggested tools (if any)
            if !suggestedTools.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Suggested tools / materials")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(suggestedTools, id: \.self) { tool in
                                Text(tool)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.textSecondary)
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(Theme.surfaceElevated, in: Capsule())
                                    .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
                            }
                        }
                    }
                }
            }

            // Clarifying questions (if any)
            if !clarifyingQuestions.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Questions to consider")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
                    ForEach(clarifyingQuestions, id: \.self) { q in
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: "questionmark.circle")
                                .font(.system(size: 13))
                                .foregroundStyle(Color.purple)
                                .padding(.top, 1)
                            Text(q)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - AI Intake Sheet

private struct AIIntakeSheet: View {
    @Binding var inputText: String
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?
    let onResult: (JobIntakeResult) -> Void

    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var ai = OxIntelligenceManager.shared
    @EnvironmentObject var localization: LocalizationManager

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                // Header
                VStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 32, weight: .bold))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [Color.purple, Color.indigo],
                                startPoint: .top, endPoint: .bottom
                            )
                        )
                    Text("Describe Your Need")
                        .font(.system(size: 22, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text("Tell us what you need in plain words — AI will fill in the job form.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20)
                }
                .padding(.top, 8)

                // Input area
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Your description")
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
                        Spacer()
                        VoiceMicButton(text: $inputText,
                                       locale: speechLocale(for: localization.bcp47))
                            .frame(width: 32)
                    }
                    TextEditor(text: $inputText)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 140)
                        .padding(12)
                        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .strokeBorder(Theme.stroke, lineWidth: 1)
                        )
                        .foregroundStyle(Theme.textPrimary)
                        .font(.system(size: 15))
                        .overlay(
                            Group {
                                if inputText.isEmpty {
                                    Text("e.g. \"My kitchen sink is leaking badly under the cabinet, I need a plumber today or tomorrow\"")
                                        .font(.system(size: 14))
                                        .foregroundStyle(Theme.textTertiary)
                                        .padding(20)
                                        .allowsHitTesting(false)
                                }
                            },
                            alignment: .topLeading
                        )
                }
                .padding(.horizontal, 20)

                if let err = errorMessage {
                    Text(err)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.danger)
                        .padding(.horizontal, 20)
                }

                // Parse button
                Button {
                    Task { await parseInput() }
                } label: {
                    HStack(spacing: 8) {
                        if isLoading {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "sparkles")
                            Text(ai.isAvailable ? "Fill Form with AI" : "Fill Form")
                        }
                    }
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(
                        LinearGradient(
                            colors: isLoading
                                ? [Color.gray, Color.gray.opacity(0.7)]
                                : [Color.purple, Color.indigo],
                            startPoint: .leading,
                            endPoint: .trailing
                        ),
                        in: RoundedRectangle(cornerRadius: 14)
                    )
                }
                .buttonStyle(.plain)
                .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).count < 10 || isLoading)
                .padding(.horizontal, 20)

                if !ai.isAvailable {
                    Text("Full AI parsing requires iOS 26+ with Apple Intelligence. Basic field suggestions are still available.")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textTertiary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }

                Spacer()
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Describe Your Need")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private func parseInput() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let result = try await JobIntakeParser.parse(inputText)
            dismiss()
            onResult(result)
        } catch OxAIError.unavailable {
            // Graceful degradation: extract basic fields using simple heuristics
            let result = basicParse(inputText)
            dismiss()
            onResult(result)
        } catch {
            errorMessage = (error as? OxAIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Non-AI fallback: populate just the description and leave other fields for user.
    private func basicParse(_ text: String) -> JobIntakeResult {
        let words  = text.components(separatedBy: .whitespaces)
        let title  = words.prefix(7).joined(separator: " ").capitalized
        return JobIntakeResult(
            title: title,
            category: "Handyman",
            urgency: text.localizedCaseInsensitiveContains("today") ||
                     text.localizedCaseInsensitiveContains("tonight") ||
                     text.localizedCaseInsensitiveContains("urgent") ? "high" : "medium",
            budgetMinDollars: 0,
            budgetMaxDollars: 0,
            description: text,
            suggestedTools: [],
            clarifyingQuestions: []
        )
    }
}
