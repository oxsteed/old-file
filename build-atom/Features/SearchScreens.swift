import SwiftUI

// MARK: - Universal Search

struct UniversalSearchView: View {
    enum Scope: String, CaseIterable, Identifiable {
        case all = "All"
        case marketplace = "Market"
        case jobs = "Jobs"
        case helpers = "Helpers"
        case messages = "Messages"
        case learn = "Learn"
        var id: String { rawValue }
    }

    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject var messages: MessagesStore
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @State private var scope: Scope = .all
    @State private var query = ""

    @State private var remoteHelpers: [APIHelper] = []
    @State private var isSearchingHelpers = false
    @State private var discoverResults: [APIDiscoverItem] = []
    @State private var isSearchingDiscover = false
    @State private var discoverError: String?
    @State private var savedQueries: [String] = []
    @State private var isSavingQuery = false
    @State private var savedQueryError: String?
    @State private var showAuthSheet = false
    @State private var browserURL: BrowserURL?

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
                    if let savedQueryError {
                        Text(savedQueryError)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.danger)
                    }

                    Picker("", selection: $scope) {
                        ForEach(Scope.allCases) { s in
                            Text(s.rawValue).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)

                    VStack(alignment: .leading, spacing: 10) {
                        if showMarketplace {
                            Text("Marketplace").sectionTitle()
                            marketplaceSection
                        }
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
                    Button {
                        Task { await saveCurrentQuery() }
                    } label: {
                        if isSavingQuery {
                            ProgressView().tint(Theme.accent)
                        } else {
                            Text("Save")
                        }
                    }
                    .foregroundStyle(Theme.accent)
                    .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSavingQuery)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: Text("Search jobs, helpers, tools, products…"))
        }
        .task { await warmLoad() }
        .task(id: query) { await searchDiscoverIfNeeded() }
        .task(id: query) { await searchHelpersIfNeeded() }
        .onAppear { loadSavedQueries() }
        .sheet(isPresented: $showAuthSheet) {
            AuthLandingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(item: $browserURL) { item in
            SafariBrowserView(url: item.url)
                .ignoresSafeArea()
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

    private func saveCurrentQuery() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        isSavingQuery = true
        savedQueryError = nil
        defer { isSavingQuery = false }

        if auth.user != nil {
            do {
                _ = try await SavedSearchesService.create(.init(
                    name: q,
                    keyword: q,
                    category: nil,
                    city: nil,
                    state: nil,
                    radius_miles: 25,
                    min_budget: nil,
                    max_budget: nil,
                    notify: true
                ))
            } catch {
                savedQueryError = "Saved locally. Job alert sync will be available when the server is reachable."
            }
        }

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

    private func searchDiscoverIfNeeded() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (scope == .all || scope == .marketplace || scope == .jobs || scope == .helpers), q.count >= 2 else {
            discoverResults = []
            discoverError = nil
            return
        }
        isSearchingDiscover = true
        discoverError = nil
        defer { isSearchingDiscover = false }
        try? await Task.sleep(nanoseconds: 350_000_000)
        let q2 = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q2 == q else { return }
        do {
            let response = try await DiscoverService.search(q2, limit: 24)
            discoverResults = response.results
        } catch {
            discoverResults = []
            discoverError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private var showMarketplace: Bool { scope == .all || scope == .marketplace }
    private var showJobs: Bool { scope == .all || scope == .jobs }
    private var showHelpers: Bool { scope == .all || scope == .helpers }
    private var showMessages: Bool { scope == .all || scope == .messages }
    private var showLearn: Bool { scope == .all || scope == .learn }

    private var filteredDiscoverResults: [APIDiscoverItem] {
        switch scope {
        case .all, .marketplace:
            return discoverResults
        case .jobs:
            return discoverResults.filter { $0.type == "job" }
        case .helpers:
            return discoverResults.filter { $0.type == "helper" || $0.type == "business" }
        case .messages, .learn:
            return []
        }
    }

    private var marketplaceSection: some View {
        VStack(spacing: 10) {
            let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if q.count < 2 {
                Text("Type at least 2 characters to search the live marketplace.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if isSearchingDiscover {
                HStack(spacing: 10) {
                    ProgressView().tint(Theme.accent)
                    Text("Searching OxSteed…").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    Spacer()
                }
                .padding(.vertical, 4)
            } else if let discoverError {
                VStack(alignment: .leading, spacing: 8) {
                    Text(discoverError)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.danger)
                    Button {
                        Task { await searchDiscoverIfNeeded() }
                    } label: {
                        Label("common.retry", systemImage: "arrow.clockwise")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.accent)
                    }
                    .buttonStyle(.plain)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .cardStyle(padding: 12)
            } else if filteredDiscoverResults.isEmpty {
                Text("No live marketplace results match your search.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(filteredDiscoverResults.prefix(8)) { item in
                    discoverRow(item)
                }
            }
        }
    }

    private func discoverRow(_ item: APIDiscoverItem) -> some View {
        Button {
            openDiscoverItem(item)
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(discoverColor(item.type).opacity(0.16))
                    Image(systemName: discoverIcon(item.type))
                        .foregroundStyle(discoverColor(item.type))
                        .font(.system(size: 16, weight: .bold))
                }
                .frame(width: 44, height: 44)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(item.title)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        if item.verified == true {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Theme.success)
                        }
                    }
                    Text(item.subtitle ?? item.meta ?? item.primaryAction?.capitalized ?? localization.localized("search.fallback_result"))
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                    HStack(spacing: 8) {
                        if let meta = item.meta, !(item.subtitle ?? "").contains(meta) {
                            Text(meta)
                        }
                        if let price = item.priceHint {
                            Text(price)
                        }
                        if let rating = item.rating {
                            Text(String(format: "★ %.1f", rating))
                        }
                    }
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
                }

                Spacer()

                Text(discoverActionTitle(item))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(discoverColor(item.type))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(discoverColor(item.type).opacity(0.12), in: Capsule())
            }
            .cardStyle(padding: 12)
        }
        .buttonStyle(.plain)
    }

    private func openDiscoverItem(_ item: APIDiscoverItem) {
        guard let raw = item.url else { return }
        let url: URL?
        if raw.hasPrefix("http://") || raw.hasPrefix("https://") {
            url = URL(string: raw)
        } else {
            url = URL(string: raw, relativeTo: AuthAPIConfig.baseURL)?.absoluteURL
        }
        if let url {
            browserURL = BrowserURL(url: url)
        }
    }

    private func discoverIcon(_ type: String) -> String {
        switch type {
        case "job": return "hammer.fill"
        case "helper": return "person.fill"
        case "business": return "building.2.fill"
        case "tool": return "wrench.and.screwdriver.fill"
        case "product": return "bag.fill"
        default: return "magnifyingglass"
        }
    }

    private func discoverColor(_ type: String) -> Color {
        switch type {
        case "job": return Theme.accent
        case "helper": return Theme.success
        case "business": return Theme.pillarHome
        case "tool": return Theme.warning
        case "product": return Theme.pillarGoals
        default: return Theme.textSecondary
        }
    }

    private func discoverActionTitle(_ item: APIDiscoverItem) -> String {
        switch item.primaryAction {
        case "bid": return "Bid"
        case "rent": return "Rent"
        default: return "Open"
        }
    }

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
