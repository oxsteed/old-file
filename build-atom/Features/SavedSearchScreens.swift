import SwiftUI

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
                Label("home.create_alert", systemImage: "plus.circle.fill")
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
                Button("common.edit") { editTarget = s }
                Button("common.delete", role: .destructive) {
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
                    Button("common.cancel") { dismiss() }.foregroundStyle(Theme.textSecondary)
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
