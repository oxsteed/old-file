import SwiftUI

// MARK: - Post Job

struct PostJobView: View {
    @EnvironmentObject var jobs: JobsStore
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

    private let categories = ["Plumbing","Electrical","Cleaning","Moving","Handyman","Yard Work","HVAC","Painting"]
    private let urgencies = ["low","medium","high"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    OxTextField(title: "Title", text: $title)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Description")
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
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

                    if let err = jobs.lastError {
                        Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    }

                    Button {
                        Task {
                            let req = JobCreateRequest(
                                title: title, description: description,
                                category_name: category,
                                budget_type: "range",
                                budget_min: (Int(budgetMin) ?? 0) * 100,
                                budget_max: (Int(budgetMax) ?? 0) * 100,
                                urgency: urgency,
                                location_city: city, location_state: state,
                                location_country: "US", location_zip: zip,
                                scheduled_date: nil, scheduled_time: nil,
                                required_skills: nil)
                            if await jobs.create(req) { dismiss() }
                        }
                    } label: {
                        Text("Post Job")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(title.count < 10 || description.count < 50 || city.isEmpty)
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
            .toolbarColorScheme(.dark, for: .navigationBar)
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
    @State private var bids: [APIBid] = []
    @State private var showBidSheet = false

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

                Button { showBidSheet = true } label: {
                    Text("Place a Bid")
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
                }
                .padding(.top, 8)

                if !bids.isEmpty {
                    Text("Bids (\(bids.count))").sectionTitle().padding(.top, 8)
                    ForEach(bids) { b in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(b.helper_name ?? "Helper").font(.system(size: 14, weight: .semibold))
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
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(isPresented: $showBidSheet) { PlaceBidSheet(job: job).presentationDetents([.medium]) }
        .task {
            bids = (try? await BidsService.bidsForJob(job.id)) ?? []
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
                        Text("Submit Bid")
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
            .toolbarColorScheme(.dark, for: .navigationBar)
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
            .toolbarColorScheme(.dark, for: .navigationBar)
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
    @State private var draft = ""

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
                }
            }
            HStack(spacing: 10) {
                TextField("Message", text: $draft, axis: .vertical)
                    .padding(10).background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 18))
                    .foregroundStyle(Theme.textPrimary)
                Button {
                    let text = draft; draft = ""
                    Task { await messages.send(conversation.id, content: text) }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30)).foregroundStyle(Theme.accent)
                }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(12)
            .background(Theme.surface)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(conversation.other_user_name ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { await messages.loadMessages(conversation.id) }
    }

    private func messageBubble(_ m: APIMessage) -> some View {
        let mine = m.sender_id == auth.user?.id
        return HStack {
            if mine { Spacer(minLength: 40) }
            Text(m.content)
                .font(.system(size: 14)).foregroundStyle(mine ? .white : Theme.textPrimary)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(mine ? Theme.accent : Theme.surfaceElevated,
                            in: RoundedRectangle(cornerRadius: 16))
            if !mine { Spacer(minLength: 40) }
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
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task { await cal.loadAppointments() }
    }
}

// MARK: - Payments

struct PaymentsView: View {
    @EnvironmentObject var payments: PaymentsStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if let s = payments.connectStatus {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Stripe Connect").sectionTitle()
                            Text(s.charges_enabled == true ? "Active" : "Needs setup")
                                .font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.textPrimary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .cardStyle()
                    }
                    ForEach(payments.payments) { p in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("$\(p.amount / 100)").font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text((p.status ?? "—").capitalized)
                                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            Text(p.created_at?.prefix(10).description ?? "")
                                .font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                        }
                        .cardStyle()
                    }
                    if payments.payments.isEmpty {
                        Text("No payments yet").font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary).padding(.top, 40)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task {
            await payments.loadConnectStatus()
            await payments.loadPayments()
        }
    }
}
