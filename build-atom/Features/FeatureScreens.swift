import SwiftUI
import MapKit

// MARK: - Post Job

/// Pre-fill data passed from Life tab pillar views.
struct PostJobPrefill: Identifiable {
    let id = UUID()
    var title: String = ""
    var description: String = ""
    var category: String = "Handyman"
    var urgency: String = "medium"
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
    @State private var urgency = "medium"
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
    private let urgencies = ["low","medium","high"]
    private let recurrenceOptions = ["weekly","biweekly","monthly"]

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

                    ImagePickerButton(label: "Add Photos", purpose: "job_media",
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
                                            Text(opt.capitalized)
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
                            let req = JobCreateRequest(
                                title: title, description: description,
                                category_name: category,
                                budget_type: "range",
                                budget_min: (Int(budgetMin) ?? 0) * 100,
                                budget_max: (Int(budgetMax) ?? 0) * 100,
                                urgency: urgency,
                                location_city: city, location_state: state,
                                location_country: inferredCountry, location_zip: zip,
                                scheduled_date: nil, scheduled_time: nil,
                                required_skills: nil,
                                is_recurring: isRecurring ? true : nil,
                                recurrence_interval: isRecurring ? recurrenceInterval : nil)
                            if await jobs.create(req) { dismiss() }
                        }
                    } label: {
                        Text("Post Job")
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
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
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
                    Button(opt.capitalized) { selection.wrappedValue = opt }
                }
            } label: {
                HStack {
                    Text(selection.wrappedValue.capitalized)
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
}

// MARK: - Job Detail + Bid

struct JobDetailView: View {
    let job: APIJob
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @State private var bids: [APIBid] = []
    @State private var showBidSheet    = false
    @State private var showQuoteSheet  = false
    @State private var showAuthSheet   = false
    @State private var showReportSheet = false
    @State private var showReviewSheet = false
    @State private var reportSent      = false
    @State private var reviewEligible  = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(job.title)
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                HStack(spacing: 8) {
                    Text(job.statusDisplay)
                        .font(.system(size: 11, weight: .bold))
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(job.statusColor.opacity(0.16), in: Capsule())
                        .foregroundStyle(job.statusColor)
                    Text(job.budgetDisplay).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                if let d = job.description {
                    Text(d).font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Label(job.locationDisplay, systemImage: "location.fill")
                    if !job.scheduledDisplay.isEmpty {
                        Label(job.scheduledDisplay, systemImage: "calendar")
                    }
                }
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                .padding(.top, 4)

                if job.status == "completed" && reviewEligible {
                    Button {
                        showReviewSheet = true
                    } label: {
                        Label("review.title", systemImage: "star.fill")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .padding(.top, 8)
                } else if job.status == "published" || job.status == "open" {
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
                                Text("Build a Quote")
                                    .font(.system(size: 15, weight: .bold))
                            }
                            .foregroundStyle(Theme.accent)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.accent.opacity(0.3), lineWidth: 1))
                        }
                    }
                    .padding(.top, 8)
                }

                if !bids.isEmpty {
                    Text(localization.format("Bids (%d)", bids.count)).sectionTitle().padding(.top, 8)
                    ForEach(bids) { b in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(b.helper_name ?? localization.localized(L10n.CommonKey.helperFallback)).font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                if let m = b.message {
                                    Text(m).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(2)
                                }
                            }
                            Spacer()
                            Text(b.amountDisplay).font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.accent)
                        }
                        .cardStyle(padding: 12)
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
            ReviewSheet(job: job, onDone: { reviewEligible = false })
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showBidSheet) { PlaceBidSheet(job: job).presentationDetents([.medium]) }
        .sheet(isPresented: $showQuoteSheet) {
            QuoteBuilderView(jobId: job.id, jobTitle: job.title) { showQuoteSheet = false }
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
                userId: job.customer_id.map { String($0) },
                contentType: "job",
                contentId: job.id,
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
            bids = (try? await BidsService.bidsForJob(job.id)) ?? []
            if job.status == "completed" && auth.user != nil {
                reviewEligible = (try? await ReviewsService.isEligible(jobId: job.id)) ?? false
            }
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
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent) } }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }
}

// MARK: - Messages

struct InboxView: View {
    @EnvironmentObject var messages: MessagesStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    if messages.conversations.isEmpty {
                        Text("No conversations yet").font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary).padding(.top, 40)
                    }
                    ForEach(messages.conversations) { c in
                        NavigationLink {
                            ChatThreadView(conversation: c)
                        } label: {
                            ConversationRow(conv: c)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 16)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Messages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .task { await messages.loadConversations() }
    }
}

struct ConversationRow: View {
    let conv: APIConversation
    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Theme.accentSoft)
                Text(initials).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.accent)
            }.frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(conv.other_user_name ?? "Conversation")
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                Text(conv.last_message ?? "—")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer()
            if let u = conv.unread_count, u > 0 {
                Text("\(u)").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                    .frame(minWidth: 18, minHeight: 18).background(Theme.accent, in: Circle())
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }
    private var initials: String {
        let parts = (conv.other_user_name ?? "?").split(separator: " ")
        return parts.prefix(2).map { String($0.prefix(1)) }.joined().uppercased()
    }
}

struct ChatThreadView: View {
    let conversation: APIConversation
    @EnvironmentObject var messages: MessagesStore
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var localization: LocalizationManager
    @State private var draft = ""
    @State private var attachmentURLs: [String] = []
    @State private var isUploadingAttachment = false

    // Translation state: messageId → translated text
    @State private var translations: [String: String] = [:]
    @State private var translatingIds: Set<String>    = []

    /// When ON, incoming messages whose sender locale differs from the user's locale
    /// are translated automatically on arrival. Persisted per-user in UserDefaults.
    @AppStorage("ox.chat.autoTranslate") private var autoTranslate: Bool = true

    // UGC: report / block (Guideline 1.2)
    @State private var showReportSheet  = false
    @State private var showBlockConfirm = false
    @State private var isBlocking       = false
    @State private var blockError: String?
    @State private var reportSent       = false

    // AI: message summarization + smart replies
    @State private var threadSummary: MessageSummaryResult? = nil
    @State private var isSummarizing   = false
    @State private var showSummaryPanel = false
    @State private var smartReplies: [String] = []

    // Other user ID derived from conversation
    private var otherUserId: Int? {
        if let raw = conversation.other_user_id { return Int(raw) }
        return nil
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        let list = messages.messagesByConversation[conversation.id] ?? []
                        ForEach(list) { m in
                            messageBubble(m).id(m.id)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: messages.messagesByConversation[conversation.id]?.count ?? 0) { _, _ in
                    if let last = messages.messagesByConversation[conversation.id]?.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                    // Auto-translate incoming messages when the setting is enabled
                    if autoTranslate {
                        autoTranslateIncoming()
                    }
                }
            }

            // AI summary panel
            if showSummaryPanel, let s = threadSummary {
                ChatSummaryPanel(
                    summary: s,
                    onSelectReply: { draft = $0 },
                    onDismiss: { withAnimation { showSummaryPanel = false } }
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            // Smart reply chips
            if !smartReplies.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(smartReplies, id: \.self) { reply in
                            Button { draft = reply } label: {
                                Text(reply)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(Theme.accent)
                                    .lineLimit(1)
                                    .padding(.horizontal, 12).padding(.vertical, 7)
                                    .background(Theme.accentSoft, in: Capsule())
                                    .overlay(Capsule().strokeBorder(Theme.accent.opacity(0.3), lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                }
                .background(Theme.surface)
            }

            // Input toolbar
            VStack(spacing: 0) {
                if !attachmentURLs.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(attachmentURLs, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: 8).fill(Theme.surfaceElevated)
                                .frame(width: 44, height: 44)
                                .overlay(Image(systemName: "photo.fill").foregroundStyle(Theme.textTertiary))
                        }
                    }
                    .padding(.horizontal, 12).padding(.top, 8)
                }

                HStack(spacing: 10) {
                    ImagePickerButton(label: "", purpose: "message_attachment",
                                      uploadedURLs: $attachmentURLs,
                                      isUploading: $isUploadingAttachment)
                    .frame(width: 38)

                    // Voice input mic — appends transcription to draft
                    VoiceMicButton(text: $draft, locale: speechLocale(for: localization.bcp47.isEmpty ? "en" : localization.bcp47))
                        .frame(width: 32)

                    TextField("Message", text: $draft, axis: .vertical)
                        .padding(10).background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 18))
                        .foregroundStyle(Theme.textPrimary)

                    Button {
                        let text = draft; let urls = attachmentURLs
                        draft = ""; attachmentURLs = []
                        let attachments = urls.isEmpty ? nil : urls.map { APIAttachment(url: $0, type: "image/jpeg", filename: nil) }
                        Task {
                            do {
                                // Client-side moderation before send
                                try await ContentModerator.check(text, context: "chat_message", locale: localization.bcp47.isEmpty ? "en" : localization.bcp47)
                                await messages.send(conversation.id, content: text, attachments: attachments)
                            } catch let modErr as ContentModerator.Error {
                                if case .blocked(let reason) = modErr {
                                    // Restore draft so the user can edit rather than losing their message
                                    draft = text
                                    blockError = reason
                                }
                            } catch {
                                await messages.send(conversation.id, content: text, attachments: attachments)
                            }
                        }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 30)).foregroundStyle(Theme.accent)
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty && attachmentURLs.isEmpty)
                }
                .padding(12)
            }
            .background(Theme.surface)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(conversation.other_user_name ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        // Safety timer + Report / Block menu
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 4) {
                    // Safety timer — compact shield button
                    SafetyTimerButton()

                    // Chat options menu (translation, summarize, report, block)
                    Menu {
                        // Summarize thread
                        Button {
                            Task { await summarizeThread() }
                        } label: {
                            Label(
                                isSummarizing ? "Summarizing…" : "Summarize Thread",
                                systemImage: "sparkles"
                            )
                        }
                        .disabled(isSummarizing)

                        // Auto-translate toggle
                        Button {
                            autoTranslate.toggle()
                            if autoTranslate { autoTranslateIncoming() }
                        } label: {
                            Label(autoTranslate ? "Auto-Translate: On" : "Auto-Translate: Off",
                                  systemImage: autoTranslate ? "checkmark.circle.fill" : "circle")
                        }
                        Divider()
                        Button(role: .destructive) { showReportSheet = true } label: {
                            Label("chat.report_user", systemImage: "flag.fill")
                        }
                        Button(role: .destructive) { showBlockConfirm = true } label: {
                            Label("chat.block_user", systemImage: "hand.raised.fill")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
        .task {
            await messages.loadMessages(conversation.id)
            if autoTranslate { autoTranslateIncoming() }
        }
        // Report sheet
        .sheet(isPresented: $showReportSheet) {
            ReportUserSheet(
                userId: otherUserId.map { String($0) },
                contentType: "user",
                contentId: conversation.id,
                onDone: { showReportSheet = false; reportSent = true }
            )
            .presentationDetents([.medium])
            .presentationBackground(Theme.background)
        }
        // Block confirmation
        .alert("Block \(conversation.other_user_name ?? "this user")?", isPresented: $showBlockConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Block", role: .destructive) {
                Task { await performBlock() }
            }
        } message: {
            Text("They won't be able to message you and you won't see their content.")
        }
        .alert(Text("chat.block_error_title"), isPresented: Binding(
            get: { blockError != nil },
            set: { if !$0 { blockError = nil } }
        )) {
            Button("OK", role: .cancel) { blockError = nil }
        } message: { Text(blockError ?? "") }
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
    }

    private func summarizeThread() async {
        guard OxIntelligenceManager.shared.isAvailable else { return }
        let msgs = messages.messagesByConversation[conversation.id] ?? []
        guard msgs.count >= 3 else { return }
        isSummarizing = true
        defer { isSummarizing = false }
        do {
            let result = try await MessageSummarizer.summarize(
                messages: msgs,
                currentUserName: auth.user?.displayName ?? "You",
                otherPartyName: conversation.other_user_name ?? "Other"
            )
            threadSummary = result
            // Build smart reply chips from suggested reply (split into 3 short options)
            smartReplies = buildSmartReplies(from: result)
            withAnimation { showSummaryPanel = true }
        } catch {
            // Silently fail — summarization is optional
        }
    }

    /// Extracts up to 3 short smart reply options from the AI result.
    private func buildSmartReplies(from result: MessageSummaryResult) -> [String] {
        // Use the suggested reply as the primary chip, plus common contextual responses
        var chips: [String] = []
        let suggested = result.suggestedReply.trimmingCharacters(in: .whitespacesAndNewlines)
        if !suggested.isEmpty { chips.append(suggested) }
        // Add unanswered-question acknowledgements
        if let q = result.unansweredQuestions.first, !q.isEmpty {
            let short = q.hasSuffix("?")
                ? "Let me check on that"
                : "I'll get back to you on that"
            if !chips.contains(short) { chips.append(short) }
        }
        // Generic contextual chip based on sentiment
        let contextual: String
        switch result.sentiment {
        case "tense":    contextual = "Let's work this out"
        case "positive": contextual = "Sounds good!"
        default:         contextual = "Got it, thanks"
        }
        if !chips.contains(contextual) { chips.append(contextual) }
        return Array(chips.prefix(3))
    }

    private func performBlock() async {
        guard let uid = otherUserId else { return }
        isBlocking = true
        defer { isBlocking = false }
        do {
            try await MessagesService.blockUser(uid)
        } catch {
            blockError = "Could not block user. Please try again."
        }
    }

    /// Auto-translates all incoming messages that haven't been translated yet.
    /// Only runs if the user's locale is not English (no-op for EN users since most content is EN).
    /// Each message is translated independently so partial results appear quickly.
    private func autoTranslateIncoming() {
        let myId   = auth.user?.id
        let target = localization.bcp47   // e.g. "es", "fr", "ar", "ht"
        guard target != "en" else { return }  // no need to translate for EN locale
        let list = messages.messagesByConversation[conversation.id] ?? []
        for m in list {
            let isIncoming = m.sender_id != myId
            let notYetTranslated = translations[m.id] == nil
            let notInFlight = !translatingIds.contains(m.id)
            guard isIncoming, notYetTranslated, notInFlight, !m.content.isEmpty else { continue }
            translatingIds.insert(m.id)
            Task {
                defer { translatingIds.remove(m.id) }
                guard let result = try? await TranslationService.translate(m.content, to: target) else { return }
                // Only store if result differs meaningfully (avoids overwriting with identical text)
                if result.trimmingCharacters(in: .whitespaces) != m.content.trimmingCharacters(in: .whitespaces) {
                    translations[m.id] = result
                }
            }
        }
    }

    private func messageBubble(_ m: APIMessage) -> some View {
        let mine = m.sender_id == auth.user?.id
        return VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            HStack {
                if mine { Spacer(minLength: 40) }
                VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                    // Show translated text when available, otherwise original
                    Text(translations[m.id] ?? m.content)
                        .font(.system(size: 14)).foregroundStyle(mine ? .white : Theme.textPrimary)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(mine ? Theme.accent : Theme.surfaceElevated,
                                    in: RoundedRectangle(cornerRadius: 16))
                    // Translate button only on incoming messages
                    if !mine {
                        TranslateButton(
                            messageId: m.id,
                            text: m.content,
                            translations: $translations,
                            loading: $translatingIds
                        )
                        .padding(.leading, 6)
                    }
                }
                if !mine { Spacer(minLength: 40) }
            }
            if let attachments = m.attachments, !attachments.isEmpty {
                HStack {
                    if mine { Spacer() }
                    HStack(spacing: 6) {
                        ForEach(attachments, id: \.url) { _ in
                            RoundedRectangle(cornerRadius: 8).fill(Theme.surfaceElevated)
                                .frame(width: 80, height: 80)
                                .overlay(Image(systemName: "photo").foregroundStyle(Theme.textTertiary))
                        }
                    }
                    if !mine { Spacer() }
                }
            }
        }
    }
}

// MARK: - Review Sheet

/// Two-way review submission after a job completes.
/// Both customer→helper and helper→customer are handled by POST /api/reviews/jobs/:jobId
/// — the backend infers the reviewer's role from the authenticated user.
struct ReviewSheet: View {
    let job: APIJob
    var onDone: () -> Void

    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss

    @State private var rating: Int = 0
    @State private var comment     = ""
    @State private var isSubmitting = false
    @State private var submitted    = false
    @State private var error: String?

    // Determine who the user is reviewing
    private var isHelper: Bool {
        guard let uid = auth.user?.id else { return false }
        if let customerId = job.customer_id { return uid == customerId }
        return false
    }

    private var revieweeName: String {
        if isHelper {
            return job.assigned_helper_name ?? localization.localized(L10n.CommonKey.yourHelper)
        } else {
            return job.customer_name ?? localization.localized(L10n.CommonKey.theCustomer)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Handle
            Capsule()
                .fill(Theme.stroke)
                .frame(width: 40, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 20)

            if submitted {
                submittedState
            } else {
                reviewForm
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }

    // ── Submitted confirmation ─────────────────────────────────────────────
    private var submittedState: some View {
        VStack(spacing: 20) {
            Spacer()
            ZStack {
                Circle().fill(Theme.success.opacity(0.15))
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 36, weight: .bold))
                    .foregroundStyle(Theme.success)
            }
            .frame(width: 80, height: 80)
            Text("review.submitted_title")
                .font(.system(size: 20, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            Text("review.submitted_message")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
            Button("Done") { dismiss(); onDone() }
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal, 24)
            Spacer()
        }
    }

    // ── Review form ────────────────────────────────────────────────────────
    private var reviewForm: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Title
                VStack(alignment: .leading, spacing: 4) {
                    Text(localization.format("Rate %@", revieweeName))
                        .font(.system(size: 20, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(localization.format("for \"%@\"", job.title))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }

                // Star picker
                HStack(spacing: 8) {
                    ForEach(1...5, id: \.self) { star in
                        Image(systemName: star <= rating ? "star.fill" : "star")
                            .font(.system(size: 32))
                            .foregroundStyle(star <= rating ? .yellow : Theme.stroke)
                            .onTapGesture { withAnimation(.spring(response: 0.2)) { rating = star } }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)

                // Comment
                VStack(alignment: .leading, spacing: 6) {
                    Text("Comment (optional)")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .textCase(.uppercase)

                    TextEditor(text: $comment)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textPrimary)
                        .frame(minHeight: 80, maxHeight: 160)
                        .padding(10)
                        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Theme.stroke, lineWidth: 1)
                        )
                }

                if let error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.danger)
                }

                Button {
                    Task { await submitReview() }
                } label: {
                    Group {
                        if isSubmitting {
                            ProgressView().tint(.white)
                        } else {
                            Text("Submit Review")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        rating > 0 ? Theme.accent : Theme.stroke,
                        in: RoundedRectangle(cornerRadius: 14)
                    )
                }
                .disabled(rating == 0 || isSubmitting)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    // ── Submission ─────────────────────────────────────────────────────────
    private func submitReview() async {
        guard rating > 0 else { return }
        isSubmitting = true
        error = nil
        do {
            // Client-side moderation before submission
            if !comment.isEmpty {
                try await ContentModerator.check(comment, context: "review", locale: localization.bcp47.isEmpty ? "en" : localization.bcp47)
            }
            try await ReviewsService.submit(jobId: job.id, rating: rating,
                                            comment: comment.isEmpty ? nil : comment)
            withAnimation { submitted = true }
        } catch let modErr as ContentModerator.Error {
            if case .blocked(let reason) = modErr { self.error = reason }
        } catch {
            self.error = "Failed to submit. Please try again."
        }
        isSubmitting = false
    }
}

// MARK: - Report User Sheet

/// Reusable sheet for reporting a user or piece of content.
/// Submits to POST /api/messages/report.
struct ReportUserSheet: View {
    var userId: String?
    var contentType: String     // 'user' | 'message' | 'job' | 'review' | 'profile'
    var contentId: String?
    var onDone: () -> Void

    @State private var selectedReason = "harassment"
    @State private var description    = ""
    @State private var isSubmitting   = false
    @State private var error: String?

    private let reasons: [(key: String, label: String)] = [
        ("harassment", "Harassment or bullying"),
        ("spam",       "Spam or scam"),
        ("fraud",      "Fraud or fake listing"),
        ("inappropriate", "Inappropriate content"),
        ("other",      "Other"),
    ]

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("What's the issue?")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)

                VStack(spacing: 0) {
                    ForEach(reasons, id: \.key) { r in
                        Button { selectedReason = r.key } label: {
                            HStack {
                                Text(r.label)
                                    .font(.system(size: 15))
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                if selectedReason == r.key {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Theme.accent)
                                }
                            }
                            .padding(.vertical, 12)
                            .padding(.horizontal, 16)
                        }
                        .buttonStyle(.plain)
                        if r.key != reasons.last?.key {
                            Divider().padding(.leading, 16)
                        }
                    }
                }
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 14))

                VStack(alignment: .leading, spacing: 6) {
                    Text("Additional details (optional)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textTertiary)
                    TextEditor(text: $description)
                        .scrollContentBackground(.hidden)
                        .frame(height: 80)
                        .padding(10)
                        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(Theme.textPrimary)
                }

                if let error { Text(error).font(.system(size: 12)).foregroundStyle(Theme.danger) }

                Button {
                    Task { await submit() }
                } label: {
                    Group {
                        if isSubmitting { ProgressView().tint(.white) }
                        else { Text("Submit Report").font(.system(size: 15, weight: .bold)).foregroundStyle(.white) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(isSubmitting)

                Spacer()
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { onDone() }.foregroundStyle(Theme.accent)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func submit() async {
        isSubmitting = true; error = nil
        defer { isSubmitting = false }
        do {
            try await MessagesService.reportContent(
                reportedUserId: userId,
                contentType: contentType,
                contentId: contentId,
                reason: selectedReason,
                description: description.isEmpty ? nil : description
            )
            onDone()
        } catch {
            self.error = "Failed to submit report. Please try again."
        }
    }
}

// MARK: - Calendar

struct CalendarView: View {
    @EnvironmentObject var cal: CalendarStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if cal.appointments.isEmpty {
                        Text("No upcoming appointments")
                            .font(.system(size: 13)).foregroundStyle(Theme.textSecondary).padding(.top, 40)
                    }
                    ForEach(cal.appointments) { appt in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(appt.service_title ?? appt.job_title ?? "Appointment")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Theme.textPrimary)
                            Text("\(appt.scheduled_date ?? "") · \(appt.location ?? "")")
                                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                            Text((appt.status ?? "pending").capitalized)
                                .font(.system(size: 11, weight: .bold))
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Theme.accentSoft, in: Capsule())
                                .foregroundStyle(Theme.accent)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .cardStyle()
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .task { await cal.loadAppointments() }
    }
}

// MARK: - Payments

struct PaymentsView: View {
    @EnvironmentObject var payments: PaymentsStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.openURL) private var openURL
    @State private var isStartingConnect  = false
    @State private var filterStatus: String? = nil  // nil = all

    private var filteredPayments: [APIPayment] {
        guard let f = filterStatus else { return payments.payments }
        return payments.payments.filter { $0.status == f }
    }

    private var totalEarned: Int {
        payments.payments
            .filter { $0.status == "completed" || $0.status == "paid" }
            .reduce(0) { $0 + $1.amount }
    }

    private var pendingAmount: Int {
        payments.payments
            .filter { $0.status == "pending" || $0.status == "processing" }
            .reduce(0) { $0 + $1.amount }
    }

    /// Escrow isn't explicitly modeled in `APIPayment` yet; treat pending funds as "in escrow".
    private var escrowAmount: Int { pendingAmount }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {

                    // ── Balance summary ───────────────────────────────────────
                    HStack(spacing: 12) {
                        walletTile("Total Earned",
                                   value: dollars(totalEarned),
                                   icon: "dollarsign.circle.fill",
                                   color: Theme.success)
                        walletTile("Pending",
                                   value: dollars(pendingAmount),
                                   icon: "clock.fill",
                                   color: Theme.warning)
                    }

                    if escrowAmount > 0 {
                        HStack(spacing: 10) {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.pillarMoney)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("In Escrow")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text("Released when the job is marked complete.")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            Text(dollars(escrowAmount))
                                .font(.system(size: 16, weight: .heavy))
                                .foregroundStyle(Theme.pillarMoney)
                        }
                        .cardStyle(padding: 14)
                    }

                    // ── Payout account ────────────────────────────────────────
                    payoutAccountCard

                    // ── Filter chips ──────────────────────────────────────────
                    if !payments.payments.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                filterChip("All",        key: nil)
                                filterChip("Completed",  key: "completed")
                                filterChip("Pending",    key: "pending")
                                filterChip("Paid",       key: "paid")
                                filterChip("Refunded",   key: "refunded")
                            }
                            .padding(.horizontal, 20)
                        }
                        .padding(.horizontal, -20)
                    }

                    // ── Transaction list ──────────────────────────────────────
                    Text("Transaction History").sectionTitle()

                    if filteredPayments.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "tray")
                                .font(.system(size: 28))
                                .foregroundStyle(Theme.textTertiary)
                            Text("No transactions yet")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 30)
                    } else {
                        VStack(spacing: 8) {
                            ForEach(filteredPayments) { p in
                                transactionRow(p)
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .task {
            await payments.loadConnectStatus()
            await payments.loadPayments()
        }
    }

    // ── Payout account card ────────────────────────────────────────────────
    @ViewBuilder
    private var payoutAccountCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Payout Account", systemImage: "creditcard.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                if let s = payments.connectStatus, s.charges_enabled == true {
                    Text("Active")
                        .font(.system(size: 11, weight: .bold))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Theme.success.opacity(0.15), in: Capsule())
                        .foregroundStyle(Theme.success)
                }
            }

            if let s = payments.connectStatus {
                if s.charges_enabled == true {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Stripe Connect linked")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            if let acct = s.stripe_account_id {
                                Text(acct).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                            }
                        }
                        Spacer()
                        manageWalletButton
                    }
                } else {
                    actionButton("Complete Setup", icon: "arrow.right.circle.fill") {
                        Task { await startConnect() }
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Set up payouts to receive earnings.")
                        .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    actionButton("Start Setup", icon: "plus.circle.fill") {
                        Task { await startConnect() }
                    }
                }
            }
        }
        .cardStyle()
    }

    // ── Transaction row ────────────────────────────────────────────────────
    private func transactionRow(_ p: APIPayment) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(statusColor(p.status).opacity(0.12))
                Image(systemName: statusIcon(p.status))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(statusColor(p.status))
            }
            .frame(width: 38, height: 38)

            VStack(alignment: .leading, spacing: 3) {
                Text(p.description ?? "Payment")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text((p.status ?? "—").capitalized)
                        .font(.system(size: 11))
                        .foregroundStyle(statusColor(p.status))
                    Text("·")
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.textTertiary)
                    Text(p.created_at?.prefix(10).description ?? "")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textTertiary)
                }
            }

            Spacer()

            Text(dollars(p.amount))
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    private func walletTile(_ label: String, value: String, icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 12)).foregroundStyle(color)
                Text(label).font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            Text(value).font(.system(size: 20, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle(padding: 14)
    }

    private func filterChip(_ label: String, key: String?) -> some View {
        Button { withAnimation { filterStatus = key } } label: {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(filterStatus == key ? .white : Theme.textSecondary)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background(
                    filterStatus == key ? Theme.accent : Theme.cardBackground,
                    in: Capsule()
                )
        }
        .buttonStyle(.plain)
    }

    private func actionButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if isStartingConnect { ProgressView().tint(.white).scaleEffect(0.8) }
                else { Image(systemName: icon).font(.system(size: 12)) }
                Text(title).font(.system(size: 13, weight: .bold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(Theme.accent, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isStartingConnect)
    }

    private func statusColor(_ status: String?) -> Color {
        switch status {
        case "completed", "paid": return Theme.success
        case "pending", "processing": return Theme.warning
        case "refunded": return Theme.pillarHome
        case "failed": return Theme.danger
        default: return Theme.textTertiary
        }
    }

    private func statusIcon(_ status: String?) -> String {
        switch status {
        case "completed", "paid": return "checkmark.circle.fill"
        case "pending":           return "clock.fill"
        case "processing":        return "arrow.trianglehead.clockwise"
        case "refunded":          return "arrow.uturn.left.circle.fill"
        case "failed":            return "xmark.circle.fill"
        default:                  return "circle.fill"
        }
    }

    private func dollars(_ cents: Int) -> String {
        String(format: "$%.2f", Double(cents) / 100.0)
    }

    private func startConnect() async {
        guard !isStartingConnect else { return }
        isStartingConnect = true
        defer { isStartingConnect = false }
        let resp = try? await PaymentsService.startConnect(country: "US", type: "individual")
        if let urlStr = resp?["onboarding_url"]?.value as? String, let url = URL(string: urlStr) {
            openURL(url)
        }
        await payments.loadConnectStatus()
    }
}

// MARK: - Notifications

struct NotificationsView: View {
    @EnvironmentObject var notifications: NotificationsStore
    @State private var selectedJob: APIJob?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    if notifications.items.isEmpty {
                        Text("No notifications yet")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 40)
                    }

                    ForEach(notifications.items) { n in
                        Button {
                            Task {
                                await notifications.markRead(n.id)
                                if let jobId = n.data?.string("job_id") {
                                    selectedJob = try? await JobsService.detail(jobId)
                                }
                            }
                        } label: {
                            NotificationRow(notification: n)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .task { await notifications.load() }
        .sheet(item: $selectedJob) { job in
            NavigationStack { JobDetailView(job: job) }
                .presentationBackground(Theme.background)
        }
    }
}

private struct NotificationRow: View {
    let notification: APINotification

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(color.opacity(0.18))
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(color)
            }
            .frame(width: 40, height: 40)

            VStack(alignment: .leading, spacing: 4) {
                Text(notification.title ?? "Notification")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                if let msg = notification.message, !msg.isEmpty {
                    Text(msg)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                if let created = notification.created_at {
                    Text(created.prefix(10))
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.top, 2)
                }
            }
            Spacer()

            if notification.is_read != true {
                Circle().fill(Theme.accent).frame(width: 8, height: 8).padding(.top, 6)
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private var icon: String {
        let t = (notification.type ?? "").lowercased()
        if t.contains("bid") { return "hand.raised.fill" }
        if t.contains("message") { return "envelope.fill" }
        if t.contains("job") { return "hammer.fill" }
        if t.contains("appointment") || t.contains("booking") { return "calendar" }
        if t.contains("payment") { return "creditcard.fill" }
        return "bell.fill"
    }

    private var color: Color {
        let t = (notification.type ?? "").lowercased()
        if t.contains("bid") { return Theme.pillarGoals }
        if t.contains("message") { return Theme.accent }
        if t.contains("job") { return Theme.pillarHome }
        if t.contains("appointment") || t.contains("booking") { return Theme.pillarCar }
        if t.contains("payment") { return Theme.success }
        return Theme.textSecondary
    }
}

private extension Dictionary where Key == String, Value == AnyDecodable {
    func string(_ key: String) -> String? {
        guard let v = self[key]?.value else { return nil }
        if let s = v as? String { return s }
        if let i = v as? Int { return String(i) }
        return nil
    }
}

// MARK: - Universal Search

struct UniversalSearchView: View {
    enum Scope: String, CaseIterable, Identifiable {
        case all = "All"
        case jobs = "Jobs"
        case helpers = "Helpers"
        case messages = "Messages"
        case learn = "Learn"
        var id: String { rawValue }
    }

    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject var messages: MessagesStore
    @EnvironmentObject var auth: AuthStore
    @State private var scope: Scope = .all
    @State private var query = ""

    @State private var remoteHelpers: [APIHelper] = []
    @State private var isSearchingHelpers = false
    @State private var savedQueries: [String] = []
    @State private var showAuthSheet = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !savedQueries.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Saved").sectionTitle()
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(savedQueries, id: \.self) { q in
                                        Button {
                                            query = q
                                        } label: {
                                            Text(q)
                                                .font(.system(size: 12, weight: .semibold))
                                                .foregroundStyle(Theme.textPrimary)
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 8)
                                                .background(Theme.surface, in: Capsule())
                                                .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                    }

                    Picker("", selection: $scope) {
                        ForEach(Scope.allCases) { s in
                            Text(s.rawValue).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)

                    VStack(alignment: .leading, spacing: 10) {
                        if showJobs {
                            Text("Jobs").sectionTitle()
                            jobsSection
                        }
                        if showHelpers {
                            Text("Helpers").sectionTitle()
                            helpersSection
                        }
                        if showMessages {
                            Text("Messages").sectionTitle()
                            messagesSection
                        }
                        if showLearn {
                            Text("Learn").sectionTitle()
                            learnSection
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { saveCurrentQuery() }
                        .foregroundStyle(Theme.accent)
                        .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: Text("Search jobs, helpers, messages, learn…"))
        }
        .task { await warmLoad() }
        .task(id: query) { await searchHelpersIfNeeded() }
        .onAppear { loadSavedQueries() }
        .sheet(isPresented: $showAuthSheet) {
            AuthLandingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
    }

    private func warmLoad() async {
        if jobs.availableJobs.isEmpty { await jobs.loadAvailable() }
        // Guest mode: don't hit protected endpoints.
        if auth.user != nil {
            if jobs.myJobs.isEmpty { await jobs.loadMyJobs() }
            if messages.conversations.isEmpty { await messages.loadConversations() }
        }
    }

    private func loadSavedQueries() {
        if let data = UserDefaults.standard.data(forKey: "ox.search.saved"),
           let list = try? JSONDecoder().decode([String].self, from: data) {
            savedQueries = list
        } else {
            savedQueries = []
        }
    }

    private func saveCurrentQuery() {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        var list = savedQueries
        list.removeAll(where: { $0.caseInsensitiveCompare(q) == .orderedSame })
        list.insert(q, at: 0)
        if list.count > 12 { list = Array(list.prefix(12)) }
        savedQueries = list
        if let data = try? JSONEncoder().encode(list) {
            UserDefaults.standard.set(data, forKey: "ox.search.saved")
        }
    }

    private func searchHelpersIfNeeded() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (scope == .all || scope == .helpers), q.count >= 2 else {
            remoteHelpers = []
            return
        }
        isSearchingHelpers = true
        defer { isSearchingHelpers = false }
        try? await Task.sleep(nanoseconds: 350_000_000)
        let q2 = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q2 == q else { return }
        remoteHelpers = (try? await HelpersService.browse(query: q2)) ?? []
    }

    private var showJobs: Bool { scope == .all || scope == .jobs }
    private var showHelpers: Bool { scope == .all || scope == .helpers }
    private var showMessages: Bool { scope == .all || scope == .messages }
    private var showLearn: Bool { scope == .all || scope == .learn }

    private var jobsSection: some View {
        let q = query.lowercased()
        let all = (jobs.myJobs + jobs.availableJobs)
        let filtered = q.isEmpty ? Array(all.prefix(10)) : Array(all.filter { $0.title.lowercased().contains(q) }.prefix(20))
        return VStack(spacing: 10) {
            if filtered.isEmpty {
                Text("No jobs match your search.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(filtered) { job in
                    NavigationLink { JobDetailView(job: job) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(job.title).font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text(job.locationDisplay).font(.system(size: 11))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            Text(job.budgetDisplay).font(.system(size: 12, weight: .bold))
                                .foregroundStyle(Theme.accent)
                        }
                        .cardStyle(padding: 12)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var helpersSection: some View {
        VStack(spacing: 10) {
            if isSearchingHelpers {
                HStack(spacing: 10) {
                    ProgressView().tint(Theme.accent)
                    Text("Searching helpers…").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    Spacer()
                }
                .padding(.vertical, 4)
            }
            if query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 {
                Text("Type at least 2 characters to search helpers.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if remoteHelpers.isEmpty {
                Text("No helpers match your search.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(remoteHelpers) { h in
                    NavigationLink { HelperProfileView(helper: h) } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle().fill(Theme.accentSoft)
                                Image(systemName: "person.fill").foregroundStyle(Theme.accent)
                            }
                            .frame(width: 40, height: 40)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(h.displayName).font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text(h.city.flatMap { c in h.state.map { "\(c), \($0)" } } ?? "")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            if let r = h.rating {
                                Text(String(format: "★ %.1f", r)).font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(Theme.success)
                            }
                        }
                        .cardStyle(padding: 12)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var messagesSection: some View {
        if auth.user == nil {
            return AnyView(
                VStack(alignment: .leading, spacing: 10) {
                    Text("Sign in to view and search messages.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        showAuthSheet = true
                    } label: {
                        HStack {
                            Image(systemName: "person.crop.circle.badge.checkmark")
                            Text("Sign In").font(.system(size: 13, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Theme.accent, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .cardStyle(padding: 12)
            )
        }

        let q = query.lowercased()
        let filtered = q.isEmpty
            ? Array(messages.conversations.prefix(10))
            : messages.conversations.filter {
                ($0.other_user_name ?? "").lowercased().contains(q) ||
                ($0.last_message ?? "").lowercased().contains(q) ||
                ($0.job_title ?? "").lowercased().contains(q)
            }
        return AnyView(VStack(spacing: 10) {
            if filtered.isEmpty {
                Text("No conversations match your search.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(filtered) { c in
                    NavigationLink { ChatThreadView(conversation: c) } label: { ConversationRow(conv: c) }
                        .buttonStyle(.plain)
                }
            }
        })
    }

    private var learnSection: some View {
        let q = query.lowercased()
        let filtered = q.isEmpty
            ? Array(Samples.courses.prefix(8))
            : Array(Samples.courses.filter { $0.title.lowercased().contains(q) }.prefix(12))
        return VStack(spacing: 10) {
            ForEach(filtered) { c in
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12).fill(c.color.opacity(0.16))
                        Image(systemName: c.icon).foregroundStyle(c.color).font(.system(size: 16, weight: .bold))
                    }
                    .frame(width: 44, height: 44)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(c.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                        Text("\(c.category) • \(c.duration) • \(c.level)")
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    Image(systemName: "play.fill").foregroundStyle(Theme.accent)
                }
                .cardStyle(padding: 12)
            }
            if filtered.isEmpty {
                Text("No lessons match your search.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

// MARK: - Helper availability manager

struct AvailabilityManagerView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var blocks: [AvailabilityBlock] = []
    @State private var isLoading = false
    @State private var showAddSheet = false
    @State private var lastError: String?
    @AppStorage("ox.helper.bufferMinutes") private var bufferMinutes: Int = 0

    private let bufferOptions = [0, 15, 30, 45, 60]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {

                    // ── Buffer time between jobs ──────────────────────────────
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 10) {
                            Image(systemName: "timer")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Buffer Between Jobs")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text("Auto-block this time after each booking.")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                        }
                        HStack(spacing: 8) {
                            ForEach(bufferOptions, id: \.self) { mins in
                                Button {
                                    bufferMinutes = mins
                                } label: {
                                    Text(mins == 0 ? "None" : "\(mins) min")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(bufferMinutes == mins ? .white : Theme.textSecondary)
                                        .padding(.horizontal, 12).padding(.vertical, 7)
                                        .background(bufferMinutes == mins ? Theme.accent : Theme.surfaceElevated, in: Capsule())
                                        .overlay(Capsule().strokeBorder(bufferMinutes == mins ? Theme.accent : Theme.stroke, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .cardStyle()

                    if isLoading {
                        HStack(spacing: 10) {
                            ProgressView().tint(Theme.accent)
                            Text("Loading availability…").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }

                    if let lastError {
                        Text(lastError)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.danger)
                    }

                    if blocks.isEmpty && !isLoading {
                        Text("No availability blocks yet.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 24)
                    }

                    ForEach(blocks) { b in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(b.date ?? "—")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text("\(b.start_time ?? "—") – \(b.end_time ?? "—")")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            Text((b.is_available ?? true) ? "Available" : "Unavailable")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle((b.is_available ?? true) ? Theme.success : Theme.warning)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(((b.is_available ?? true) ? Theme.success : Theme.warning).opacity(0.14), in: Capsule())
                        }
                        .cardStyle(padding: 12)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Availability")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAddSheet = true } label: {
                        Image(systemName: "plus").foregroundStyle(Theme.accent)
                    }
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showAddSheet) {
            AddAvailabilityBlockView { newBlock in
                blocks.insert(newBlock, at: 0)
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.background)
        }
    }

    private func load() async {
        guard let helperId = auth.user?.id else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let (from, to) = dateRange(days: 21)
            blocks = try await CalendarService.helperAvailabilityBlocks(helperId, fromDate: from, toDate: to)
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func dateRange(days: Int) -> (String, String) {
        let cal = Calendar.current
        let start = Date()
        let end = cal.date(byAdding: .day, value: days, to: start) ?? start
        return (isoDay(start), isoDay(end))
    }

    private func isoDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}

private struct AddAvailabilityBlockView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var start = Date()
    @State private var end = Calendar.current.date(byAdding: .hour, value: 2, to: Date()) ?? Date()
    @State private var isAvailable = true
    @State private var isSaving = false
    @State private var lastError: String?

    let onCreate: (AvailabilityBlock) -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                DatePicker("Date", selection: $date, displayedComponents: [.date])
                DatePicker("Start", selection: $start, displayedComponents: [.hourAndMinute])
                DatePicker("End", selection: $end, displayedComponents: [.hourAndMinute])
                Toggle("Available", isOn: $isAvailable)

                if let lastError {
                    Text(lastError).font(.system(size: 12)).foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    Task { await save() }
                } label: {
                    HStack {
                        if isSaving { ProgressView().tint(.white) }
                        Text("Save Block").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(isSaving)

                Spacer()
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("New Availability")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func save() async {
        lastError = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let b = try await CalendarService.createAvailability(
                date: isoDay(date),
                startTime: hhmm(start),
                endTime: hhmm(end),
                isAvailable: isAvailable,
                notes: nil
            )
            onCreate(b)
            dismiss()
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func isoDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}

// MARK: - Guest-friendly Browsing (Jobs + Helpers)

struct JobsBrowseView: View {
    @EnvironmentObject var jobs: JobsStore
    @State private var query = ""

    var body: some View {
        List {
            ForEach(filteredJobs) { job in
                NavigationLink { JobDetailView(job: job) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(job.title).font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Text(job.locationDisplay.isEmpty ? "—" : job.locationDisplay)
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .listRowBackground(Theme.surface)
            }
            if filteredJobs.isEmpty {
                Text("No jobs to show.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .listRowBackground(Theme.background)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Jobs")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: Text("Search jobs"))
        .toolbarBackground(Theme.background, for: .navigationBar)
        .refreshable { await jobs.loadAvailable() }
        .task { await jobs.loadAvailable() }
    }

    private var filteredJobs: [APIJob] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return jobs.availableJobs }
        return jobs.availableJobs.filter {
            $0.title.lowercased().contains(q) ||
            ($0.category ?? "").lowercased().contains(q) ||
            $0.locationDisplay.lowercased().contains(q)
        }
    }
}

struct HelpersBrowseView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var query = ""
    @State private var isLoading = false
    @State private var helpers: [APIHelper] = []
    @State private var showAuthSheet = false

    var body: some View {
        List {
            if isLoading {
                HStack(spacing: 10) {
                    ProgressView().tint(Theme.accent)
                    Text("Loading helpers…").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                }
                .listRowBackground(Theme.background)
            }

            ForEach(helpers) { h in
                NavigationLink { HelperProfileView(helper: h) } label: {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle().fill(Theme.accentSoft)
                            Image(systemName: "person.fill").foregroundStyle(Theme.accent)
                        }
                        .frame(width: 40, height: 40)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(h.displayName).font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            Text(h.city.flatMap { c in h.state.map { "\(c), \($0)" } } ?? "")
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        if let r = h.rating {
                            Text(String(format: "★ %.1f", r)).font(.system(size: 12, weight: .bold))
                                .foregroundStyle(Theme.success)
                        }
                    }
                }
                .listRowBackground(Theme.surface)
            }

            if !isLoading && helpers.isEmpty {
                Text(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                     ? "No helpers to show."
                     : "No helpers match your search.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .listRowBackground(Theme.background)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Helpers")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: Text("Search helpers"))
        .toolbarBackground(Theme.background, for: .navigationBar)
        .task { await load() }
        .task(id: query) { await debouncedSearch() }
        .sheet(isPresented: $showAuthSheet) {
            AuthLandingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
    }

    private func debouncedSearch() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        try? await Task.sleep(nanoseconds: 320_000_000)
        guard q == query.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
        await load()
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let lat = UserDefaults.standard.object(forKey: "ox.location.lat") as? Double
        let lng = UserDefaults.standard.object(forKey: "ox.location.lng") as? Double
        helpers = (try? await HelpersService.browse(query: q.isEmpty ? nil : q,
                                                    lat: lat, lng: lng, radius: 25,
                                                    sort: q.isEmpty ? "best_match" : nil)) ?? []
    }
}

struct HelperProfileView: View {
    let helper: APIHelper
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var messages: MessagesStore

    @State private var detail: HelperProfileDetail?
    @State private var isLoading = false
    @State private var lastError: String?

    @State private var showAuthSheet     = false
    @State private var showBookingSheet  = false
    @State private var showSubscribe     = false
    @State private var openedConversation: APIConversation?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                headerCard

                actionRow

                if isLoading {
                    HStack(spacing: 10) {
                        ProgressView().tint(Theme.accent)
                        Text("Loading profile…").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    }
                    .padding(.top, 6)
                }

                if let lastError {
                    Text(lastError).font(.system(size: 12)).foregroundStyle(Theme.danger)
                }

                if let d = detail {
                    // Trust badges row — ID, Background check, License, Insurance
                    IDVerificationBadges(badges: .init(
                        backgroundCheck: d.backgroundChecked ?? false,
                        idVerified:      d.verified ?? false,
                        licenseVerified: false,   // not yet in API response
                        insuranceVerified: false   // not yet in API response
                    ))

                    if let bio = d.bioLong ?? d.bioShort, !bio.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("About").sectionTitle()
                            Text(bio).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                        }
                        .cardStyle()
                    }

                    if !d.services.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Services").sectionTitle()
                            ForEach(d.services) { s in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(s.name).font(.system(size: 14, weight: .semibold))
                                            .foregroundStyle(Theme.textPrimary)
                                        if let desc = s.description, !desc.isEmpty {
                                            Text(desc).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                                                .lineLimit(2)
                                        }
                                    }
                                    Spacer()
                                    if let price = s.price {
                                        Text("$\(price / 100)")
                                            .font(.system(size: 13, weight: .bold))
                                            .foregroundStyle(Theme.accent)
                                    }
                                }
                                .cardStyle(padding: 12)
                            }
                        }
                    }

                    if !d.faqs.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("FAQs").sectionTitle()
                            ForEach(d.faqs) { f in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(f.question).font(.system(size: 13, weight: .bold))
                                        .foregroundStyle(Theme.textPrimary)
                                    Text(f.answer).font(.system(size: 12))
                                        .foregroundStyle(Theme.textSecondary)
                                }
                                .cardStyle(padding: 12)
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .task { await loadDetail() }
        .sheet(isPresented: $showAuthSheet) {
            AuthLandingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showBookingSheet) {
            BookingRequestSheet(helper: helper)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showSubscribe) {
            SubscribeToHelperSheet(helper: helper)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(item: $openedConversation) { conv in
            NavigationStack { ChatThreadView(conversation: conv) }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(Theme.accentSoft)
                    Image(systemName: "person.fill").font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
                .frame(width: 52, height: 52)

                VStack(alignment: .leading, spacing: 2) {
                    Text(detail?.displayName ?? helper.displayName)
                        .font(.system(size: 18, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(detail?.headline ?? helper.businessName ?? "")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer()
                if let r = (detail?.rating ?? helper.rating) {
                    Text(String(format: "★ %.1f", r))
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.success)
                }
            }
            if let city = helper.city, let state = helper.state {
                Label("\(city), \(state)", systemImage: "location.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .cardStyle()
    }

    private var actionRow: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Button {
                    if auth.user == nil { showAuthSheet = true }
                    else { Task { await messageHelper() } }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "envelope.fill")
                        Text("Message").font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)

                Button {
                    if auth.user == nil { showAuthSheet = true }
                    else { showBookingSheet = true }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar.badge.plus")
                        Text("Book").font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.accent.opacity(0.35), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }

            // Subscribe — recurring service button
            Button {
                if auth.user == nil { showAuthSheet = true }
                else { showSubscribe = true }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "repeat.circle.fill")
                    Text("Subscribe to Recurring Service")
                        .font(.system(size: 13, weight: .bold))
                }
                .foregroundStyle(Theme.pillarGoals)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(Theme.pillarGoals.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.pillarGoals.opacity(0.30), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    private func loadDetail() async {
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await APIClient.shared.request("/api/helpers/\(helper.id)/profile",
                                                       requiresAuth: false,
                                                       as: HelperProfileDetail.self)
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func messageHelper() async {
        do {
            let conv = try await MessagesService.openOrCreate(helperId: helper.id, customerId: nil, jobId: nil)
            await messages.loadConversations()
            await messages.loadMessages(conv.id)
            openedConversation = conv
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    struct HelperProfileDetail: Decodable, Equatable {
        let id: String?
        let firstName: String?
        let lastName: String?
        let profileHeadline: String?
        let bioShort: String?
        let bioLong: String?
        let rating: Double?
        let reviewCount: Int?
        let jobsCompleted: Int?
        let verified: Bool?
        let backgroundChecked: Bool?
        let services: [Service]
        let faqs: [FAQ]

        var displayName: String {
            let fn = firstName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let ln = lastName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let full = [fn, ln].filter { !$0.isEmpty }.joined(separator: " ")
            return full.isEmpty ? "Helper" : full
        }
        var headline: String? { profileHeadline }
        var bio: String? { bioLong ?? bioShort }

        struct Service: Decodable, Identifiable, Equatable {
            let id: String
            let name: String
            let description: String?
            let price: Int?
            let priceUnit: String?
            let popular: Bool?
        }

        struct FAQ: Decodable, Identifiable, Equatable {
            var id: String { question + "|" + answer }
            let question: String
            let answer: String
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeIfPresent(String.self, forKey: .id)
            firstName = try c.decodeIfPresent(String.self, forKey: .firstName)
            lastName = try c.decodeIfPresent(String.self, forKey: .lastName)
            profileHeadline = try c.decodeIfPresent(String.self, forKey: .profileHeadline)
            bioShort = try c.decodeIfPresent(String.self, forKey: .bioShort)
            bioLong = try c.decodeIfPresent(String.self, forKey: .bioLong)
            rating = try c.decodeIfPresent(Double.self, forKey: .rating)
            reviewCount = try c.decodeIfPresent(Int.self, forKey: .reviewCount)
            jobsCompleted = try c.decodeIfPresent(Int.self, forKey: .jobsCompleted)
            verified = try c.decodeIfPresent(Bool.self, forKey: .verified)
            backgroundChecked = try c.decodeIfPresent(Bool.self, forKey: .backgroundChecked)
            services = (try c.decodeIfPresent([Service].self, forKey: .services)) ?? []
            faqs = (try c.decodeIfPresent([FAQ].self, forKey: .faqs)) ?? []
        }

        private enum CodingKeys: String, CodingKey {
            case id
            case firstName
            case lastName
            case profileHeadline
            case bioShort
            case bioLong
            case rating
            case reviewCount
            case jobsCompleted
            case verified
            case backgroundChecked
            case services
            case faqs
        }
    }
}

private struct BookingRequestSheet: View {
    let helper: APIHelper
    @Environment(\.dismiss) private var dismiss

    @State private var serviceName = "General Service"
    @State private var date = Date()
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(60 * 60)
    @State private var location = ""
    @State private var notes = ""
    @State private var isSubmitting = false
    @State private var lastError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    Text("Request Booking").font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    OxTextField(title: "Service", text: $serviceName)

                    DatePicker("Date", selection: $date, displayedComponents: [.date])
                        .datePickerStyle(.compact)
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))

                    HStack(spacing: 10) {
                        DatePicker("Start", selection: $start, displayedComponents: [.hourAndMinute])
                        DatePicker("End", selection: $end, displayedComponents: [.hourAndMinute])
                    }
                    .datePickerStyle(.compact)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))

                    OxTextField(title: "Location (optional)", text: $location)
                    OxTextField(title: "Notes (optional)", text: $notes)

                    if let lastError {
                        Text(lastError).font(.system(size: 12)).foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        HStack {
                            if isSubmitting { ProgressView().tint(.white) }
                            Text("Request").font(.system(size: 15, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(isSubmitting || serviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Booking")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Close") { dismiss() }.foregroundStyle(Theme.accent) } }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func submit() async {
        guard !isSubmitting else { return }
        isSubmitting = true
        lastError = nil
        defer { isSubmitting = false }
        do {
            let req = BookingCreateRequest(
                helperId: helper.id,
                businessId: nil,
                serviceName: serviceName,
                requestedDate: isoDay(date),
                requestedStartTime: hhmm(start),
                requestedEndTime: hhmm(end),
                serviceLocation: location.isEmpty ? nil : location,
                description: notes.isEmpty ? nil : notes,
                confirmationHours: 24
            )
            _ = try await BookingsService.create(req)
            dismiss()
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func isoDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}

// MARK: - Tax Documents View

struct TaxDocumentsView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var selectedYear  = Calendar.current.component(.year, from: Date())
    @State private var summary: TaxSummary?
    @State private var expenses: [TaxExpense] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var showShare  = false
    @State private var shareItems: [Any] = []

    private let availableYears: [Int] = {
        let current = Calendar.current.component(.year, from: Date())
        return Array((current - 4)...current).reversed()
    }()

    // ── Models ─────────────────────────────────────────────────────────────
    struct TaxSummary: Decodable {
        let year: Int
        struct HelperEarnings: Decodable { let gross_cents: Int; let job_count: Int }
        struct BusinessRevenue: Decodable { let revenue_cents: Int; let invoice_count: Int }
        struct CategoryBreakdown: Decodable, Identifiable {
            var id: String { category }
            let category: String; let total_cents: Int; let count: Int
        }
        let helper_earnings: HelperEarnings
        let business_revenue: BusinessRevenue
        let total_income_cents: Int
        let total_expense_cents: Int
        let net_income_cents: Int
        let expense_by_category: [CategoryBreakdown]
        let form_1099_required: Bool
        let disclaimer: String
    }
    struct TaxExpensesResponse: Decodable { let expenses: [TaxExpense]; let total: Int }
    struct TaxExpense: Decodable, Identifiable {
        let id: String
        let category: String?; let description: String?
        let amount_cents: Int; let expense_date: String?
        let notes: String?; let business_name: String?
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Year picker
                HStack {
                    Text("Tax Year").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Picker("Year", selection: $selectedYear) {
                        ForEach(availableYears, id: \.self) { Text(String($0)).tag($0) }
                    }
                    .pickerStyle(.menu).tint(Theme.accent)
                }
                .cardStyle(padding: 14)
                .onChange(of: selectedYear) { _, _ in Task { await load() } }

                if isLoading {
                    HStack { Spacer(); ProgressView().tint(Theme.accent); Spacer() }.padding(.top, 40)
                } else if let e = error {
                    Text(e).font(.system(size: 13)).foregroundStyle(Theme.danger)
                } else if let s = summary {
                    summarySection(s)
                    if !expenses.isEmpty { expensesSection }
                    Text(s.disclaimer).font(.system(size: 11)).foregroundStyle(Theme.textTertiary).padding(.top, 4)
                }
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Tax Documents")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { buildShareText(); showShare = true } label: {
                    Image(systemName: "square.and.arrow.up").foregroundStyle(Theme.accent)
                }
                .disabled(summary == nil)
            }
        }
        .sheet(isPresented: $showShare) { TaxShareSheet(items: shareItems) }
        .task { await load() }
    }

    @ViewBuilder
    private func summarySection(_ s: TaxSummary) -> some View {
        Text(localization.format("Income Summary — %d", s.year)).sectionTitle()
        HStack(spacing: 12) {
            taxTile("Helper Earnings", value: dollars(s.helper_earnings.gross_cents),
                    sub: localization.format("%d jobs", s.helper_earnings.job_count), icon: "wrench.and.screwdriver.fill", color: Theme.accent)
            taxTile("Business Revenue", value: dollars(s.business_revenue.revenue_cents),
                    sub: localization.format("%d invoices", s.business_revenue.invoice_count), icon: "briefcase.fill", color: Theme.pillarGoals)
        }
        HStack(spacing: 12) {
            taxTile("Total Income", value: dollars(s.total_income_cents), sub: nil, icon: "arrow.up.circle.fill", color: Theme.success)
            taxTile("Deductible Exp.", value: dollars(s.total_expense_cents), sub: nil, icon: "minus.circle.fill", color: Theme.danger)
        }
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Net Income").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Spacer()
                Text(dollars(s.net_income_cents))
                    .font(.system(size: 20, weight: .heavy))
                    .foregroundStyle(s.net_income_cents >= 0 ? Theme.success : Theme.danger)
            }
            if s.form_1099_required {
                Label("1099-NEC may be required (gross ≥ $600)", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warning)
            }
        }.cardStyle(padding: 16)

        if !s.expense_by_category.isEmpty {
            Text("Expenses by Category").sectionTitle()
            VStack(spacing: 8) {
                ForEach(s.expense_by_category) { cat in
                    HStack {
                        Text(cat.category.capitalized).font(.system(size: 13)).foregroundStyle(Theme.textPrimary)
                        Spacer()
                        Text(dollars(cat.total_cents)).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }

    private func taxTile(_ label: LocalizedStringKey, value: String, sub: String?, icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 12)).foregroundStyle(color)
                Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Text(value).font(.system(size: 18, weight: .heavy)).foregroundStyle(Theme.textPrimary)
            if let sub { Text(sub).font(.system(size: 10)).foregroundStyle(Theme.textTertiary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading).cardStyle(padding: 14)
    }

    private var expensesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(localization.format("Expense Details (%d)", expenses.count)).sectionTitle()
            ForEach(expenses) { exp in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(exp.description ?? exp.category?.capitalized ?? "Expense")
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                        if let cat = exp.category { Text(cat.capitalized).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                        if let date = exp.expense_date { Text(date).font(.system(size: 10)).foregroundStyle(Theme.textTertiary) }
                    }
                    Spacer()
                    Text(dollars(exp.amount_cents)).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private func load() async {
        isLoading = true; error = nil
        do {
            async let s = TaxService.summary(year: selectedYear)
            async let e = TaxService.expenses(year: selectedYear)
            let (sum, exp) = try await (s, e)
            summary = sum; expenses = exp
        } catch { self.error = "Unable to load tax data." }
        isLoading = false
    }

    private func buildShareText() {
        guard let s = summary else { return }
        let lines = [
            "OxSteed Tax Summary — \(s.year)",
            "Helper Earnings: \(dollars(s.helper_earnings.gross_cents))",
            "Business Revenue: \(dollars(s.business_revenue.revenue_cents))",
            "Deductible Expenses: \(dollars(s.total_expense_cents))",
            "Net Income: \(dollars(s.net_income_cents))", "",
            s.disclaimer
        ]
        shareItems = [lines.joined(separator: "\n")]
    }

    private func dollars(_ cents: Int) -> String { String(format: "$%.2f", Double(cents) / 100.0) }
}

private struct TaxShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

enum TaxService {
    static func summary(year: Int) async throws -> TaxDocumentsView.TaxSummary {
        try await APIClient.shared.request(
            "/api/tax/summary",
            query: ["year": year],
            as: TaxDocumentsView.TaxSummary.self
        )
    }
    static func expenses(year: Int) async throws -> [TaxDocumentsView.TaxExpense] {
        let r = try await APIClient.shared.request(
            "/api/tax/expenses",
            query: ["year": year, "limit": 200],
            as: TaxDocumentsView.TaxExpensesResponse.self
        )
        return r.expenses
    }
}

// MARK: - QuoteBuilderView

struct QuoteBuilderView: View {
    let jobId: String
    let jobTitle: String
    var onSent: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var localization: LocalizationManager
    @State private var lineItems: [QuoteLineItem] = [
        QuoteLineItem(description: "", type: "labor", quantity: 1, unit_price_cents: 0)
    ]
    @State private var taxRatePct: Double = 0    // 0–30 percent slider
    @State private var notes: String = ""
    @State private var validDays: Int = 7
    @State private var isSending = false
    @State private var errorMsg: String?
    @State private var showSuccess = false

    private var subtotalCents: Int {
        lineItems.reduce(0) { $0 + $1.subtotal_cents }
    }
    private var taxCents: Int {
        Int((Double(subtotalCents) * taxRatePct / 100.0).rounded())
    }
    private var totalCents: Int { subtotalCents + taxCents }

    private func dollars(_ cents: Int) -> String {
        String(format: "$%.2f", Double(cents) / 100.0)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {

                    // Job context banner
                    HStack(spacing: 10) {
                        Image(systemName: "briefcase.fill")
                            .foregroundStyle(Theme.accent)
                        Text(jobTitle)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(2)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))

                    // Line items
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Line Items").sectionTitle()
                            Spacer()
                            Button {
                                lineItems.append(QuoteLineItem(
                                    description: "", type: "labor", quantity: 1, unit_price_cents: 0
                                ))
                            } label: {
                                Label("Add", systemImage: "plus.circle.fill")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Theme.accent)
                            }
                        }

                        ForEach($lineItems) { $item in
                            LineItemRow(item: $item) {
                                lineItems.removeAll { $0.id == item.id }
                            }
                        }
                    }

                    // Tax
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Tax Rate").font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                            Spacer()
                            Text(String(format: "%.1f%%", taxRatePct))
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(Theme.textPrimary)
                        }
                        Slider(value: $taxRatePct, in: 0...30, step: 0.5)
                            .tint(Theme.accent)
                    }
                    .cardStyle()

                    // Totals summary
                    VStack(spacing: 8) {
                        totalRow("Subtotal", value: dollars(subtotalCents))
                        if taxCents > 0 {
                            totalRow("Tax (\(String(format: "%.1f", taxRatePct))%)", value: dollars(taxCents))
                        }
                        Divider()
                        HStack {
                            Text("Total").font(.system(size: 16, weight: .heavy))
                                .foregroundStyle(Theme.textPrimary)
                            Spacer()
                            Text(dollars(totalCents))
                                .font(.system(size: 18, weight: .heavy))
                                .foregroundStyle(Theme.accent)
                        }
                    }
                    .cardStyle()

                    // Valid for
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Quote Valid For").font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                        Picker("Valid for", selection: $validDays) {
                            Text("3 days").tag(3)
                            Text("7 days").tag(7)
                            Text("14 days").tag(14)
                            Text("30 days").tag(30)
                        }
                        .pickerStyle(.segmented)
                    }
                    .cardStyle()

                    // Notes
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Notes (optional)").font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                        TextEditor(text: $notes)
                            .frame(minHeight: 80)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textPrimary)
                            .scrollContentBackground(.hidden)
                            .padding(8)
                            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 10))
                    }
                    .cardStyle()

                    if let err = errorMsg {
                        Text(err)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.danger)
                            .padding(.horizontal, 4)
                    }

                    // Send button
                    Button {
                        Task { await sendQuote() }
                    } label: {
                        HStack(spacing: 8) {
                            if isSending {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: "paperplane.fill")
                                Text(localization.format("Send Quote — %@", dollars(totalCents)))
                                    .font(.system(size: 15, weight: .bold))
                            }
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(
                            canSend ? Theme.accent : Theme.textTertiary,
                            in: RoundedRectangle(cornerRadius: 14)
                        )
                    }
                    .disabled(!canSend || isSending)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Build a Quote")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
        .overlay(alignment: .top) {
            if showSuccess {
                Text("Quote sent!")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Theme.success, in: Capsule())
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }

    // MARK: - Helpers

    private var canSend: Bool {
        totalCents > 0 && lineItems.allSatisfy { !$0.description.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private func sendQuote() async {
        isSending = true; errorMsg = nil
        let req = QuotesService.CreateRequest(
            job_id: jobId,
            line_items: lineItems,
            tax_rate: taxRatePct / 100.0,
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : notes,
            valid_days: validDays
        )
        do {
            _ = try await QuotesService.send(req)
            withAnimation { showSuccess = true }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            onSent?()
            dismiss()
        } catch {
            errorMsg = "Could not send quote. Check your connection and try again."
        }
        isSending = false
    }

    @ViewBuilder
    private func totalRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
        }
    }
}

// MARK: - Line item row editor

private struct LineItemRow: View {
    @Binding var item: QuoteLineItem
    let onRemove: () -> Void

    // Local string buffers so keyboard doesn't fight with Int binding
    @State private var priceBuf: String = ""
    @State private var qtyBuf: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                // Type badge picker
                Menu {
                    Button("Labor")    { item.type = "labor" }
                    Button("Material") { item.type = "material" }
                    Button("Other")    { item.type = "other" }
                } label: {
                    Text(item.type.capitalized)
                        .font(.system(size: 11, weight: .bold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(typeBadgeColor.opacity(0.16), in: Capsule())
                        .foregroundStyle(typeBadgeColor)
                }

                Spacer()

                Button(action: onRemove) {
                    Image(systemName: "minus.circle.fill")
                        .foregroundStyle(Theme.danger.opacity(0.7))
                }
            }

            TextField("Description (e.g. 2 hrs electrical work)", text: $item.description)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textPrimary)
                .padding(10)
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 9))

            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Qty").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    TextField("1", text: $qtyBuf)
                        .keyboardType(.decimalPad)
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 60)
                        .padding(8)
                        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 9))
                        .onChange(of: qtyBuf) { _, v in
                            if let d = Double(v), d > 0 { item.quantity = d }
                        }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Unit price").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    HStack(spacing: 4) {
                        Text("$").font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                        TextField("0.00", text: $priceBuf)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 14, weight: .semibold))
                            .onChange(of: priceBuf) { _, v in
                                if let d = Double(v), d >= 0 {
                                    item.unit_price_cents = Int((d * 100).rounded())
                                }
                            }
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 9))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Subtotal").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    Text(String(format: "$%.2f", Double(item.subtotal_cents) / 100.0))
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.accent)
                        .padding(8)
                }
            }
        }
        .padding(12)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
        .onAppear {
            priceBuf = item.unit_price_cents > 0 ? String(format: "%.2f", Double(item.unit_price_cents) / 100.0) : ""
            qtyBuf   = item.quantity != 1 ? String(item.quantity) : ""
        }
    }

    private var typeBadgeColor: Color {
        switch item.type {
        case "labor":    return Theme.pillarHome
        case "material": return Theme.pillarMoney
        default:         return Theme.accent
        }
    }
}

// MARK: - Sent Quotes List (helper-side)

struct SentQuotesView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var quotes: [APIHelperQuote] = []
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = error {
                Text(err).font(.system(size: 14)).foregroundStyle(Theme.danger).padding(20)
            } else if quotes.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.system(size: 40)).foregroundStyle(Theme.textTertiary)
                    Text("No quotes sent yet").font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(quotes) { q in
                            sentQuoteCard(q)
                        }
                    }
                    .padding(20)
                }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Sent Quotes")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .task { await load() }
    }

    private func sentQuoteCard(_ q: APIHelperQuote) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(q.job_title ?? localization.localized(L10n.CommonKey.jobFallback)).font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.textPrimary).lineLimit(1)
                Spacer()
                Text(q.statusDisplay)
                    .font(.system(size: 11, weight: .bold))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(q.statusColor.opacity(0.16), in: Capsule())
                    .foregroundStyle(q.statusColor)
            }
            HStack {
                Text(q.totalDisplay).font(.system(size: 16, weight: .heavy)).foregroundStyle(Theme.accent)
                Spacer()
                Text(localization.format("%d item(s)", q.line_items.count))
                    .font(.system(size: 12)).foregroundStyle(Theme.textTertiary)
            }
            if let d = q.valid_until {
                Text(localization.format("Valid until %@", String(d.prefix(10))))
                    .font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
            }
        }
        .cardStyle()
    }

    private func load() async {
        isLoading = true; error = nil
        quotes = (try? await QuotesService.sent()) ?? []
        isLoading = false
    }
}

// MARK: - SavedSearchesView

struct SavedSearchesView: View {
    @State private var searches: [APISavedSearch] = []
    @State private var isLoading    = false
    @State private var showCreate   = false
    @State private var editTarget: APISavedSearch? = nil

    var body: some View {
        Group {
            if isLoading && searches.isEmpty {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if searches.isEmpty {
                emptyState
            } else {
                searchList
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Job Alerts")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCreate = true } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
        }
        .toolbarBackground(Theme.background, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .sheet(isPresented: $showCreate, onDismiss: { Task { await load() } }) {
            SavedSearchEditSheet(existing: nil)
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(item: $editTarget, onDismiss: { Task { await load() } }) { s in
            SavedSearchEditSheet(existing: s)
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "magnifyingglass.circle")
                .font(.system(size: 48)).foregroundStyle(Theme.textTertiary)
            Text("No Job Alerts").font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            Text("Save a search to get push notifications when matching jobs are posted.")
                .font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center).padding(.horizontal, 32)
            Button { showCreate = true } label: {
                Label("Create Alert", systemImage: "plus.circle.fill")
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 24).padding(.vertical, 12)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var searchList: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(searches) { s in
                    searchCard(s)
                }
            }
            .padding(20)
        }
    }

    private func searchCard(_ s: APISavedSearch) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(s.notify ? Theme.accent.opacity(0.15) : Theme.surfaceElevated)
                Image(systemName: s.notify ? "bell.fill" : "bell.slash.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(s.notify ? Theme.accent : Theme.textTertiary)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(s.name)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(s.summaryLine)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }

            Spacer()

            Menu {
                Button("Edit") { editTarget = s }
                Button("Delete", role: .destructive) {
                    Task {
                        try? await SavedSearchesService.delete(s.id)
                        searches.removeAll { $0.id == s.id }
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.textTertiary)
                    .padding(8)
            }
        }
        .cardStyle()
    }

    private func load() async {
        isLoading = true
        searches = (try? await SavedSearchesService.list()) ?? []
        isLoading = false
    }
}

// MARK: - SavedSearchEditSheet

struct SavedSearchEditSheet: View {
    let existing: APISavedSearch?
    @Environment(\.dismiss) private var dismiss

    @State private var name        = ""
    @State private var keyword     = ""
    @State private var category    = ""
    @State private var city        = ""
    @State private var state       = ""
    @State private var radiusMiles = ""
    @State private var minBudget   = ""
    @State private var maxBudget   = ""
    @State private var notify      = true

    @State private var isSaving = false
    @State private var error: String?

    private var isEditing: Bool { existing != nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {

                    fieldCard("Alert Name", systemImage: "tag") {
                        TextField("e.g. Plumbing jobs in Austin", text: $name)
                            .inputStyle()
                    }

                    fieldCard("Keyword", systemImage: "magnifyingglass") {
                        TextField("e.g. plumbing, electrical…", text: $keyword)
                            .inputStyle()
                    }

                    fieldCard("Category", systemImage: "square.grid.2x2") {
                        TextField("e.g. home_repair", text: $category)
                            .inputStyle()
                    }

                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            Label("City", systemImage: "building.2")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                            TextField("Austin", text: $city).inputStyle()
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Label("State", systemImage: "map")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                            TextField("TX", text: $state).inputStyle()
                        }
                    }
                    .cardStyle()

                    fieldCard("Radius (miles)", systemImage: "location.circle") {
                        TextField("25", text: $radiusMiles)
                            .keyboardType(.numberPad).inputStyle()
                    }

                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Min Budget").font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                            TextField("$0", text: $minBudget).keyboardType(.numberPad).inputStyle()
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Max Budget").font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                            TextField("Any", text: $maxBudget).keyboardType(.numberPad).inputStyle()
                        }
                    }
                    .cardStyle()

                    Toggle(isOn: $notify) {
                        Label("Push Notifications", systemImage: "bell.badge")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                    }
                    .cardStyle()

                    if let err = error {
                        Text(err).font(.system(size: 13)).foregroundStyle(Theme.danger).padding(.horizontal, 4)
                    }

                    Button {
                        Task { await save() }
                    } label: {
                        Group {
                            if isSaving {
                                ProgressView().tint(.white)
                            } else {
                                Text(isEditing ? "Save Changes" : "Create Alert")
                                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            }
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(name.trimmingCharacters(in: .whitespaces).isEmpty ? Theme.textTertiary : Theme.accent,
                                    in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(isEditing ? "Edit Alert" : "New Job Alert")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.textSecondary)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
        .onAppear { prefill() }
    }

    // MARK: Helpers

    private func prefill() {
        guard let s = existing else { return }
        name        = s.name
        keyword     = s.keyword  ?? ""
        category    = s.category ?? ""
        city        = s.city     ?? ""
        state       = s.state    ?? ""
        radiusMiles = s.radius_miles.map { String($0) } ?? ""
        minBudget   = s.min_budget.map { String($0 / 100) } ?? ""
        maxBudget   = s.max_budget.map { String($0 / 100) } ?? ""
        notify      = s.notify
    }

    private func save() async {
        isSaving = true; error = nil
        let minC = Int(minBudget).map { $0 * 100 }
        let maxC = Int(maxBudget).map { $0 * 100 }
        let rad  = Int(radiusMiles)
        do {
            if let s = existing {
                let req = SavedSearchesService.UpdateRequest(
                    name: name.trimmingCharacters(in: .whitespaces),
                    keyword:      keyword.isEmpty  ? nil : keyword,
                    category:     category.isEmpty ? nil : category,
                    city:         city.isEmpty     ? nil : city,
                    state:        state.isEmpty    ? nil : state,
                    radius_miles: rad, min_budget: minC, max_budget: maxC, notify: notify
                )
                _ = try await SavedSearchesService.update(s.id, req: req)
            } else {
                let req = SavedSearchesService.CreateRequest(
                    name: name.trimmingCharacters(in: .whitespaces),
                    keyword:      keyword.isEmpty  ? nil : keyword,
                    category:     category.isEmpty ? nil : category,
                    city:         city.isEmpty     ? nil : city,
                    state:        state.isEmpty    ? nil : state,
                    radius_miles: rad, min_budget: minC, max_budget: maxC, notify: notify
                )
                _ = try await SavedSearchesService.create(req)
            }
            dismiss()
        } catch {
            self.error = "Could not save. Please try again."
        }
        isSaving = false
    }

    @ViewBuilder
    private func fieldCard<Content: View>(_ label: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            content()
        }
        .cardStyle()
    }
}

private extension View {
    func inputStyle() -> some View {
        self
            .font(.system(size: 14))
            .foregroundStyle(Theme.textPrimary)
            .padding(10)
            .frame(maxWidth: .infinity)
            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 9))
    }
}

// MARK: - Universal Map Browse

/// Shows jobs, helpers, and tool-rental pickup points on a single map.
/// Accessible from the Home tab "Map" chip for any persona.
struct MapBrowseView: View {
    @EnvironmentObject var jobs: JobsStore
    @Environment(\.dismiss) private var dismiss

    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
            span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18)
        )
    )

    // Filter toggles
    @State private var showJobs    = true
    @State private var showHelpers = true
    @State private var showTools   = true

    // Live data
    @State private var helpers: [APIHelper] = []
    @State private var tools: [APIToolRental] = []
    @State private var isLoading = false

    // Selection
    @State private var selectedJob: APIJob?
    @State private var selectedHelper: APIHelper?

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                map

                // Filter bar floats over the map
                filterBar
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle("Explore Map")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
        .task { await load() }
        .sheet(item: $selectedJob) { job in
            NavigationStack { JobDetailView(job: job) }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(item: $selectedHelper) { helper in
            NavigationStack { HelperProfileView(helper: helper) }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
    }

    // MARK: Map

    private var map: some View {
        Map(position: $position) {
            // Jobs — blue hammer pins
            if showJobs {
                ForEach(jobPins) { pin in
                    Annotation(pin.job.title, coordinate: pin.coord) {
                        Button { selectedJob = pin.job } label: {
                            mapPin(icon: "hammer.fill", color: Theme.accent,
                                   label: pin.job.budgetDisplay)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            // Helpers — green person pins
            if showHelpers {
                ForEach(helperPins) { pin in
                    Annotation(pin.helper.displayName, coordinate: pin.coord) {
                        Button { selectedHelper = pin.helper } label: {
                            mapPin(icon: "person.fill", color: Theme.success,
                                   label: "★ \(pin.helper.rating.map { String(format: "%.1f", $0) } ?? "—")")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            // Tools — orange wrench pins
            if showTools {
                ForEach(toolPins) { pin in
                    Annotation(pin.tool.name ?? "Tool", coordinate: pin.coord) {
                        mapPin(icon: "wrench.fill", color: Theme.warning, label: pin.tool.dailyRateDisplay)
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .onAppear { centreOnUserLocation() }
    }

    @ViewBuilder
    private func mapPin(icon: String, color: Color, label: String) -> some View {
        VStack(spacing: 3) {
            ZStack {
                Circle().fill(color)
                    .frame(width: 32, height: 32)
                    .shadow(color: color.opacity(0.4), radius: 4, y: 2)
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
            }
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Theme.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
        }
    }

    // MARK: Filter bar

    private var filterBar: some View {
        HStack(spacing: 8) {
            filterChip("Jobs", icon: "hammer.fill", color: Theme.accent, on: $showJobs)
            filterChip("Helpers", icon: "person.fill", color: Theme.success, on: $showHelpers)
            filterChip("Tools", icon: "wrench.fill", color: Theme.warning, on: $showTools)
            Spacer()
            if isLoading {
                ProgressView().tint(Theme.accent).scaleEffect(0.8)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke.opacity(0.5), lineWidth: 1))
        .shadow(color: .black.opacity(0.1), radius: 6, y: 2)
    }

    private func filterChip(_ label: String, icon: String, color: Color, on: Binding<Bool>) -> some View {
        Button { withAnimation(.spring(response: 0.25)) { on.wrappedValue.toggle() } } label: {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11, weight: .bold))
                Text(label).font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(on.wrappedValue ? .white : Theme.textSecondary)
            .padding(.horizontal, 11).padding(.vertical, 7)
            .background(on.wrappedValue ? color : Theme.surfaceElevated, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: Data + pins

    private var jobPins: [JobMapPin] {
        jobs.availableJobs.compactMap { job -> JobMapPin? in
            guard let lat = job.location_lat, let lng = job.location_lng else { return nil }
            return JobMapPin(job: job, coord: .init(latitude: lat, longitude: lng))
        }
    }

    private var helperPins: [HelperMapPin] {
        helpers.compactMap { h -> HelperMapPin? in
            guard let lat = h.location_lat, let lng = h.location_lng else { return nil }
            return HelperMapPin(helper: h, coord: .init(latitude: lat, longitude: lng))
        }
    }

    private var toolPins: [ToolMapPin] {
        tools.compactMap { t -> ToolMapPin? in
            guard let lat = t.location_lat, let lng = t.location_lng else { return nil }
            return ToolMapPin(tool: t, coord: .init(latitude: lat, longitude: lng))
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        await jobs.loadAvailable()
        if let raw = try? await APIClient.shared.request("/api/helpers?limit=50&with_location=true",
                                                         method: .GET, as: [APIHelper].self) {
            helpers = raw
        }
        if let raw = try? await APIClient.shared.request("/api/tool-rentals?limit=50&with_location=true",
                                                         method: .GET, as: [APIToolRental].self) {
            tools = raw
        }
    }

    private func centreOnUserLocation() {
        let lat = UserDefaults.standard.object(forKey: "ox.location.lat") as? Double
        let lng = UserDefaults.standard.object(forKey: "ox.location.lng") as? Double
        guard let lat, let lng else { return }
        position = .region(MKCoordinateRegion(
            center: .init(latitude: lat, longitude: lng),
            span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18)
        ))
    }

    // Local pin models
    private struct JobMapPin: Identifiable {
        let job: APIJob; let coord: CLLocationCoordinate2D
        var id: String { job.id }
    }
    private struct HelperMapPin: Identifiable {
        let helper: APIHelper; let coord: CLLocationCoordinate2D
        var id: String { helper.id }
    }
    private struct ToolMapPin: Identifiable {
        let tool: APIToolRental; let coord: CLLocationCoordinate2D
        var id: String { tool.id }
    }
}

// MARK: - Counter-Propose Booking

/// Helper-side sheet: suggest an alternative date/time for an incoming booking.
struct CounterProposeSheet: View {
    let bookingId: String
    /// Display name of the other party (customer or helper), shown in the header.
    var partyName: String = "the customer"
    @Environment(\.dismiss) private var dismiss

    @State private var date       = Date().addingTimeInterval(86_400)   // tomorrow
    @State private var startTime  = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var endTime    = Calendar.current.date(bySettingHour: 10, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var message    = ""
    @State private var isLoading  = false
    @State private var lastError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Explanation
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.system(size: 22))
                            .foregroundStyle(Theme.accent)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Suggest a different time")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Theme.textPrimary)
                            Text("\(partyName.capitalized) will receive a notification and can accept or decline your suggestion.")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .cardStyle()

                    // Date
                    VStack(alignment: .leading, spacing: 6) {
                        fieldLabel("Proposed Date")
                        DatePicker("", selection: $date, in: Date()..., displayedComponents: [.date])
                            .datePickerStyle(.compact)
                            .labelsHidden()
                            .foregroundStyle(Theme.textPrimary)
                            .padding(.horizontal, 12).padding(.vertical, 10)
                            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    // Start / End time
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            fieldLabel("Start")
                            DatePicker("", selection: $startTime, displayedComponents: [.hourAndMinute])
                                .datePickerStyle(.compact).labelsHidden()
                                .foregroundStyle(Theme.textPrimary)
                                .padding(10)
                                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            fieldLabel("End")
                            DatePicker("", selection: $endTime, displayedComponents: [.hourAndMinute])
                                .datePickerStyle(.compact).labelsHidden()
                                .foregroundStyle(Theme.textPrimary)
                                .padding(10)
                                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                        }
                    }

                    // Optional note
                    VStack(alignment: .leading, spacing: 6) {
                        fieldLabel("Note (optional)")
                        TextField("e.g. I have another job until noon", text: $message, axis: .vertical)
                            .lineLimit(3, reservesSpace: true)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textPrimary)
                            .padding(12)
                            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                    }

                    if let lastError {
                        Text(lastError).font(.system(size: 12))
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button { Task { await submit() } } label: {
                        HStack(spacing: 8) {
                            if isLoading { ProgressView().tint(.white).scaleEffect(0.85) }
                            else { Image(systemName: "paperplane.fill").font(.system(size: 13)) }
                            Text("Send Suggestion")
                                .font(.system(size: 15, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)
                    .disabled(isLoading)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Counter-Propose")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Theme.textTertiary)
            .textCase(.uppercase)
    }

    private func submit() async {
        isLoading = true; lastError = nil
        defer { isLoading = false }
        do {
            try await BookingsService.counterPropose(
                bookingId: bookingId,
                date: isoDay(date),
                startTime: hhmm(startTime),
                endTime: hhmm(endTime),
                message: message.isEmpty ? nil : message
            )
            dismiss()
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func isoDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale   = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale   = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}

/// Customer-side row showing a pending counter-proposal with Accept / Decline actions.
struct CounterProposalBannerView: View {
    let booking: APIBooking
    var onResolved: (() -> Void)? = nil
    @EnvironmentObject private var localization: LocalizationManager
    @State private var isAccepting  = false
    @State private var isDeclining  = false
    @State private var resolved     = false

    var body: some View {
        if resolved { EmptyView() }
        else if let counter = booking.counter_proposed_at, !counter.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Label("Helper suggested a new time", systemImage: "calendar.badge.clock")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.warning)

                if let d = booking.counter_date { Text(localization.format("Date: %@", d)).font(.system(size: 13)).foregroundStyle(Theme.textPrimary) }
                if let s = booking.counter_start_time, let e = booking.counter_end_time {
                    Text(localization.format("Time: %@ – %@", s, e)).font(.system(size: 13)).foregroundStyle(Theme.textPrimary)
                }
                if let msg = booking.counter_message, !msg.isEmpty {
                    Text("\"\(msg)\"").font(.system(size: 12, design: .serif)).foregroundStyle(Theme.textSecondary)
                }

                HStack(spacing: 10) {
                    Button { Task { await respond(accept: true) } } label: {
                        HStack(spacing: 5) {
                            if isAccepting { ProgressView().tint(.white).scaleEffect(0.75) }
                            else { Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)) }
                            Text("Accept").font(.system(size: 13, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18).padding(.vertical, 9)
                        .background(Theme.success, in: Capsule())
                    }
                    .buttonStyle(.plain).disabled(isAccepting || isDeclining)

                    Button { Task { await respond(accept: false) } } label: {
                        HStack(spacing: 5) {
                            if isDeclining { ProgressView().tint(Theme.danger).scaleEffect(0.75) }
                            else { Image(systemName: "xmark").font(.system(size: 12, weight: .bold)) }
                            Text("Decline").font(.system(size: 13, weight: .bold))
                        }
                        .foregroundStyle(Theme.danger)
                        .padding(.horizontal, 18).padding(.vertical, 9)
                        .background(Theme.danger.opacity(0.10), in: Capsule())
                        .overlay(Capsule().strokeBorder(Theme.danger.opacity(0.3), lineWidth: 1))
                    }
                    .buttonStyle(.plain).disabled(isAccepting || isDeclining)
                }
            }
            .padding(14)
            .background(Theme.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.warning.opacity(0.25), lineWidth: 1))
        }
    }

    private func respond(accept: Bool) async {
        if accept { isAccepting = true } else { isDeclining = true }
        defer { isAccepting = false; isDeclining = false }
        _ = try? await BookingsService.respondToCounterPropose(bookingId: booking.id, accept: accept)
        resolved = true
        onResolved?()
    }
}

// MARK: - BookingsService extension (counter-propose)

extension BookingsService {
    struct CounterProposeRequest: Encodable {
        let counter_date: String
        let counter_start_time: String
        let counter_end_time: String
        let counter_message: String?
    }
    struct CounterProposeResponse: Decodable {
        let booking: APIBooking?
        let message: String?
    }

    static func counterPropose(bookingId: String,
                                date: String,
                                startTime: String,
                                endTime: String,
                                message: String?) async throws {
        let req = CounterProposeRequest(counter_date: date,
                                        counter_start_time: startTime,
                                        counter_end_time: endTime,
                                        counter_message: message)
        let _: CounterProposeResponse = try await APIClient.shared.request(
            "/api/bookings/\(bookingId)/counter-propose",
            method: .POST,
            body: req
        )
    }

    static func respondToCounterPropose(bookingId: String, accept: Bool) async throws {
        struct Req: Encodable { let action: String }
        let _: CounterProposeResponse = try await APIClient.shared.request(
            "/api/bookings/\(bookingId)/counter-propose/respond",
            method: .POST,
            body: Req(action: accept ? "accept" : "decline")
        )
    }
}

// Note: counter_propose fields are declared directly on APIBooking in APIModels.swift

// MARK: - Wallet Management View

/// Full-screen payout account manager.
/// Launched from the "Manage Wallet" button inside PaymentsView.
/// Shows: connect status, payout method details, instant payout CTA,
/// Stripe dashboard deep-link, and a disconnect option.
struct WalletManagementView: View {
    @EnvironmentObject var payments: PaymentsStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    @State private var isStartingConnect   = false
    @State private var isRequestingPayout  = false
    @State private var payoutError: String?
    @State private var payoutSuccess       = false
    @State private var showDisconnectAlert = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    statusHeader
                    payoutMethodCard
                    actionsCard
                    if let payoutError {
                        Text(payoutError)
                            .font(.system(size: 12)).foregroundStyle(Theme.danger)
                            .multilineTextAlignment(.center).padding(.horizontal)
                    }
                    if payoutSuccess {
                        Label("Payout initiated! Funds typically arrive in 1–2 business days.", systemImage: "checkmark.circle.fill")
                            .font(.system(size: 13)).foregroundStyle(Theme.success)
                            .multilineTextAlignment(.center).padding(.horizontal)
                    }
                    helpCard
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Manage Wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
        .task {
            await payments.loadConnectStatus()
        }
        .alert("Disconnect Payout Account?", isPresented: $showDisconnectAlert) {
            Button("Cancel", role: .cancel) {}
            Button("Disconnect", role: .destructive) { Task { await disconnectAccount() } }
        } message: {
            Text("You won't be able to receive payouts until you reconnect a Stripe account.")
        }
    }

    // MARK: - Sub-views

    @ViewBuilder
    private var statusHeader: some View {
        let connected = payments.connectStatus?.charges_enabled == true
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill((connected ? Theme.success : Theme.warning).opacity(0.14))
                    .frame(width: 72, height: 72)
                Image(systemName: connected ? "creditcard.fill" : "creditcard.trianglebadge.exclamationmark")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(connected ? Theme.success : Theme.warning)
            }
            Text(connected ? "Payout Account Active" : "Payout Account Needed")
                .font(.system(size: 18, weight: .heavy, design: .rounded))
                .foregroundStyle(Theme.textPrimary)
            Text(connected
                 ? "Earnings are automatically sent to your linked bank account."
                 : "Complete Stripe setup to receive payments for your work.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private var payoutMethodCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Payout Method", systemImage: "building.columns.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textSecondary)

            if let s = payments.connectStatus {
                if s.charges_enabled == true {
                    // Connected state
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                            Text("Stripe Connect linked")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                        }
                        if let acct = s.stripe_account_id {
                            Text(localization.format("Account: %@", acct))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(Theme.textTertiary)
                        }
                        HStack(spacing: 16) {
                            statusPill("Charges", enabled: s.charges_enabled == true)
                            statusPill("Payouts", enabled: s.payouts_enabled == true)
                        }
                    }
                } else {
                    // Incomplete setup
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 10) {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning)
                            Text("Setup incomplete — tap below to finish.")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        primaryButton("Complete Setup", icon: "arrow.right.circle.fill", color: Theme.accent) {
                            Task { await startConnect() }
                        }
                        .disabled(isStartingConnect)
                    }
                }
            } else {
                // Not yet connected
                VStack(alignment: .leading, spacing: 10) {
                    Text("No payout account connected. It only takes a few minutes to set up.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                    primaryButton("Connect Stripe Account", icon: "plus.circle.fill", color: Theme.accent) {
                        Task { await startConnect() }
                    }
                    .disabled(isStartingConnect)
                }
            }
        }
        .cardStyle()
    }

    @ViewBuilder
    private var actionsCard: some View {
        if payments.connectStatus?.charges_enabled == true {
            VStack(alignment: .leading, spacing: 12) {
                Label("Actions", systemImage: "bolt.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)

                // Instant payout
                primaryButton(
                    isRequestingPayout ? "Requesting…" : "Request Instant Payout",
                    icon: "arrow.down.circle.fill",
                    color: Theme.success
                ) {
                    Task { await requestPayout() }
                }
                .disabled(isRequestingPayout)

                // Manage in Stripe dashboard
                Button {
                    if let url = URL(string: "https://dashboard.stripe.com/express") {
                        openURL(url)
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Manage in Stripe Dashboard")
                            .font(.system(size: 14, weight: .semibold))
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .foregroundStyle(Theme.accent)
                    .padding(.vertical, 12)
                    .padding(.horizontal, 14)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)

                // Disconnect
                Button { showDisconnectAlert = true } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "xmark.circle")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Disconnect Payout Account")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.danger.opacity(0.2), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .cardStyle()
        }
    }

    private var helpCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("How payouts work", systemImage: "info.circle")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            Text("Earnings are held in escrow until a job is marked complete. After release, funds are sent to your Stripe account and arrive in 1–2 business days. Instant payouts (if eligible) arrive within 30 minutes.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textTertiary)
        }
        .cardStyle()
    }

    // MARK: - Helpers

    private func statusPill(_ label: String, enabled: Bool) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(enabled ? Theme.success : Theme.textTertiary)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(enabled ? Theme.success : Theme.textTertiary)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background((enabled ? Theme.success : Theme.textTertiary).opacity(0.10), in: Capsule())
    }

    private func primaryButton(_ title: String, icon: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold))
                Text(title).font(.system(size: 14, weight: .bold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(color, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func startConnect() async {
        isStartingConnect = true
        defer { isStartingConnect = false }
        if let resp = try? await PaymentsService.startConnect(country: "US", type: "individual"),
           let urlStr = resp["onboarding_url"]?.value as? String,
           let url = URL(string: urlStr) {
            openURL(url)
        }
        await payments.loadConnectStatus()
    }

    private func requestPayout() async {
        isRequestingPayout = true
        payoutError = nil
        payoutSuccess = false
        defer { isRequestingPayout = false }
        do {
            try await PaymentsService.requestInstantPayout()
            payoutSuccess = true
        } catch {
            payoutError = (error as? APIError)?.errorDescription ?? "Payout request failed. Please try again."
        }
    }

    private func disconnectAccount() async {
        _ = try? await PaymentsService.disconnectConnect()
        await payments.loadConnectStatus()
    }
}

// MARK: - PaymentsService extensions (instant payout + disconnect)

extension PaymentsService {
    static func requestInstantPayout() async throws {
        struct Req: Encodable { let type: String }
        struct Resp: Decodable { let status: String?; let message: String? }
        let _: Resp = try await APIClient.shared.request(
            "/api/payments/payout/instant",
            method: .POST,
            body: Req(type: "instant")
        )
    }

    static func disconnectConnect() async throws {
        struct Resp: Decodable { let success: Bool? }
        let _: Resp = try await APIClient.shared.request(
            "/api/payments/connect/disconnect",
            method: .POST,
            body: EmptyEncodable()
        )
    }

    private struct EmptyEncodable: Encodable {}
}

// MARK: - PaymentsView "Manage Wallet" button

extension PaymentsView {
    /// Call this from payoutAccountCard when the account is active to surface WalletManagementView.
    var manageWalletButton: some View {
        NavigationLink {
            WalletManagementView()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "gearshape.fill").font(.system(size: 12))
                Text("Manage Wallet").font(.system(size: 13, weight: .bold))
            }
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(Theme.accentSoft, in: Capsule())
        }
        .buttonStyle(.plain)
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
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
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

// MARK: - Chat Summary Panel

private struct ChatSummaryPanel: View {
    let summary: MessageSummaryResult
    let onSelectReply: (String) -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Thread Summary", systemImage: "sparkles")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.purple)
                Spacer()
                Button { onDismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.textTertiary)
                        .font(.system(size: 18))
                }
                .buttonStyle(.plain)
            }

            Text(summary.summary)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textPrimary)

            if !summary.unansweredQuestions.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Unanswered")
                        .font(.system(size: 10, weight: .bold))
                        .tracking(0.8).foregroundStyle(Theme.warning).textCase(.uppercase)
                    ForEach(summary.unansweredQuestions, id: \.self) { q in
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(.system(size: 11)).foregroundStyle(Theme.warning)
                            Text(q).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            }

            // Sentiment indicator
            HStack(spacing: 6) {
                Circle()
                    .fill(sentimentColor)
                    .frame(width: 8, height: 8)
                Text(summary.sentiment.capitalized + " tone")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(14)
        .background(Theme.surfaceElevated)
        .overlay(
            Rectangle()
                .fill(Color.purple.opacity(0.4))
                .frame(width: 3),
            alignment: .leading
        )
    }

    private var sentimentColor: Color {
        switch summary.sentiment {
        case "positive": return Theme.success
        case "tense":    return Theme.danger
        default:         return Theme.warning
        }
    }
}
