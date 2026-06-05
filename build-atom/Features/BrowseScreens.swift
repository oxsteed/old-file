import SwiftUI

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
    @EnvironmentObject var life: LifeStore
    @EnvironmentObject private var localization: LocalizationManager

    @State private var detail: HelperProfileDetail?
    @State private var isLoading = false
    @State private var lastError: String?
    @State private var isSavingHelper = false

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
                                        Text(localization.formatCents(price, fractionDigits: 0))
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
        .task {
            await loadDetail()
            if auth.user != nil {
                await life.refresh()
            }
        }
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
        let saved = life.savedHelper(for: helper.id)
        return VStack(spacing: 8) {
            HStack(spacing: 10) {
                Button {
                    if auth.user == nil { showAuthSheet = true }
                    else { Task { await messageHelper() } }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "envelope.fill")
                        Text("feature.message").font(.system(size: 13, weight: .bold))
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
                        Text("feature.book").font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.accent.opacity(0.35), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }

            Button {
                if auth.user == nil {
                    showAuthSheet = true
                } else {
                    Task { await toggleSavedHelper(saved) }
                }
            } label: {
                HStack(spacing: 6) {
                    if isSavingHelper {
                        ProgressView().tint(saved == nil ? Theme.success : Theme.danger)
                    } else {
                        Image(systemName: saved == nil ? "heart.fill" : "heart.slash.fill")
                    }
                    Text(saved == nil ? "Save Helper" : "Remove Saved Helper")
                        .font(.system(size: 13, weight: .bold))
                }
                .foregroundStyle(saved == nil ? Theme.success : Theme.danger)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background((saved == nil ? Theme.success : Theme.danger).opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder((saved == nil ? Theme.success : Theme.danger).opacity(0.30), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(isSavingHelper)

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

    private func toggleSavedHelper(_ saved: APILifeSavedHelper?) async {
        guard !isSavingHelper else { return }
        isSavingHelper = true
        lastError = nil
        defer { isSavingHelper = false }
        let ok: Bool
        if let saved {
            ok = await life.removeSavedHelper(saved)
        } else {
            ok = await life.saveHelper(helperId: helper.id)
        }
        if !ok {
            lastError = life.lastError ?? "Could not update saved helper."
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
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("common.close") { dismiss() }.foregroundStyle(Theme.accent) } }
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
