import SwiftUI

private func money2(_ v: Double?) -> String { String(format: "$%.2f", v ?? 0) }

// MARK: - Expenses

struct BusinessExpensesView: View {
    let businessId: Int

    @Environment(\.dismiss) private var dismiss
    @State private var expenses: [BusinessExpense] = []
    @State private var summary: [ExpenseCategorySummary] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showCreate = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if !summary.isEmpty {
                        Text("By category").sectionTitle()
                        ForEach(summary) { s in
                            HStack {
                                Text((s.category ?? "—").capitalized).font(.system(size: 13)).foregroundStyle(Theme.textPrimary)
                                Spacer()
                                Text(money2(s.totalDollars)).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.textSecondary)
                            }
                            .cardStyle(padding: 10)
                        }
                    }
                    Text("Recent").sectionTitle()
                    if isLoading {
                        ProgressView().tint(Theme.accent).frame(maxWidth: .infinity).padding(.top, 20)
                    } else if let error {
                        Text(error).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.danger)
                    } else if expenses.isEmpty {
                        Text("No expenses logged yet.").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    } else {
                        ForEach(expenses) { e in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(e.description ?? "—").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                                    Text("\((e.category ?? "").capitalized) · \(e.expense_date ?? "")")
                                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                Text(money2(e.amountDollars)).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.danger)
                                Button { act { try await BusinessHubService.deleteExpense(businessId: businessId, expenseId: e.id) } } label: {
                                    Image(systemName: "trash").foregroundStyle(Theme.textTertiary)
                                }
                            }
                            .cardStyle(padding: 12)
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Expenses")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button { showCreate = true } label: { Image(systemName: "plus") }.foregroundStyle(Theme.accent) }
                ToolbarItem(placement: .topBarLeading) { Button("common.done") { dismiss() }.foregroundStyle(Theme.accent) }
            }
            .sheet(isPresented: $showCreate) { CreateExpenseView(businessId: businessId) { await load() } }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true; defer { isLoading = false }
        do { let r = try await BusinessHubService.expenses(businessId: businessId); expenses = r.expenses; summary = r.summary; error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
    }
    private func act(_ op: @escaping () async throws -> Void) {
        Task { do { try await op(); await load() } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription } }
    }
}

private struct CreateExpenseView: View {
    let businessId: Int
    let onCreated: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var category = "supplies"
    @State private var description = ""
    @State private var amount = ""
    @State private var date = ""
    @State private var notes = ""
    @State private var isWorking = false
    @State private var error: String?

    private let categories = ["supplies", "equipment", "travel", "marketing", "software", "fees", "labor", "other"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Expense") {
                    Picker("Category", selection: $category) { ForEach(categories, id: \.self) { Text($0.capitalized).tag($0) } }
                    TextField("Description", text: $description)
                    TextField("Amount (USD)", text: $amount).keyboardType(.decimalPad)
                    TextField("Date YYYY-MM-DD (optional)", text: $date)
                    TextField("Notes (optional)", text: $notes)
                }
                if let error { Text(error).foregroundStyle(Theme.danger).font(.system(size: 12)) }
            }
            .navigationTitle("New expense")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("common.cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }.disabled(isWorking || description.isEmpty || (Double(amount) ?? 0) <= 0)
                }
            }
        }
    }

    private func create() {
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                _ = try await BusinessHubService.createExpense(
                    businessId: businessId, category: category,
                    description: description.trimmingCharacters(in: .whitespaces),
                    amountCents: Int((Double(amount) ?? 0) * 100),
                    expenseDate: date.isEmpty ? nil : date,
                    notes: notes.isEmpty ? nil : notes)
                await onCreated(); dismiss()
            } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
        }
    }
}

// MARK: - Quotes

struct BusinessQuotesView: View {
    let businessId: Int

    @Environment(\.dismiss) private var dismiss
    @State private var quotes: [BusinessQuote] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showCreate = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if isLoading {
                        ProgressView().tint(Theme.accent).frame(maxWidth: .infinity).padding(.top, 30)
                    } else if let error {
                        Text(error).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.danger)
                    } else if quotes.isEmpty {
                        Text("No quotes yet.").font(.system(size: 13)).foregroundStyle(Theme.textSecondary).padding(.top, 30)
                    } else {
                        ForEach(quotes) { q in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(q.title ?? "—").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                                    Text("\(q.client_name ?? "") · \(money2(q.totalDollars))").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                Text((q.status ?? "draft").capitalized)
                                    .font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.accent)
                                    .padding(.horizontal, 8).padding(.vertical, 4).background(Theme.accent.opacity(0.14), in: Capsule())
                                Menu {
                                    Button("Send") { act { try await BusinessHubService.sendQuote(businessId: businessId, quoteId: q.id) } }
                                    Button("Convert to invoice") { act { try await BusinessHubService.convertQuote(businessId: businessId, quoteId: q.id) } }
                                    Button("Delete", role: .destructive) { act { try await BusinessHubService.deleteQuote(businessId: businessId, quoteId: q.id) } }
                                } label: { Image(systemName: "ellipsis.circle").foregroundStyle(Theme.textSecondary) }
                            }
                            .cardStyle(padding: 12)
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Quotes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button { showCreate = true } label: { Image(systemName: "plus") }.foregroundStyle(Theme.accent) }
                ToolbarItem(placement: .topBarLeading) { Button("common.done") { dismiss() }.foregroundStyle(Theme.accent) }
            }
            .sheet(isPresented: $showCreate) { CreateQuoteView(businessId: businessId) { await load() } }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true; defer { isLoading = false }
        do { quotes = try await BusinessHubService.quotes(businessId: businessId); error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
    }
    private func act(_ op: @escaping () async throws -> Void) {
        Task { do { try await op(); await load() } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription } }
    }
}

private struct CreateQuoteView: View {
    let businessId: Int
    let onCreated: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var clientName = ""
    @State private var title = ""
    @State private var taxRate = ""
    @State private var items: [QuoteLineItemInput] = [.init(description: "", quantity: 1, unit_price_cents: 0)]
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Quote") {
                    TextField("Client name", text: $clientName)
                    TextField("Title", text: $title)
                    TextField("Tax rate % (optional)", text: $taxRate).keyboardType(.decimalPad)
                }
                Section("Line items (price in USD)") {
                    ForEach($items) { $item in
                        VStack {
                            TextField("Description", text: $item.description)
                            HStack {
                                TextField("Qty", value: $item.quantity, format: .number).keyboardType(.decimalPad)
                                priceField($item)
                            }
                        }
                    }
                    Button("Add line item") { items.append(.init(description: "", quantity: 1, unit_price_cents: 0)) }
                }
                if let error { Text(error).foregroundStyle(Theme.danger).font(.system(size: 12)) }
            }
            .navigationTitle("New quote")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("common.cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }.disabled(isWorking || clientName.isEmpty || title.isEmpty)
                }
            }
        }
    }

    // Price entered in dollars, stored in cents.
    private func priceField(_ item: Binding<QuoteLineItemInput>) -> some View {
        let dollars = Binding<Double>(
            get: { Double(item.wrappedValue.unit_price_cents) / 100.0 },
            set: { item.wrappedValue.unit_price_cents = Int($0 * 100) }
        )
        return TextField("Unit price", value: dollars, format: .number).keyboardType(.decimalPad)
    }

    private func create() {
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                let valid = items.filter { !$0.description.trimmingCharacters(in: .whitespaces).isEmpty }
                _ = try await BusinessHubService.createQuote(
                    businessId: businessId,
                    clientName: clientName.trimmingCharacters(in: .whitespaces),
                    clientEmail: nil,
                    title: title.trimmingCharacters(in: .whitespaces),
                    lineItems: valid.isEmpty ? items : valid,
                    taxRate: Double(taxRate) ?? 0,
                    validUntil: nil)
                await onCreated(); dismiss()
            } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
        }
    }
}

// MARK: - Tax

struct BusinessTaxView: View {
    let businessId: Int

    @Environment(\.dismiss) private var dismiss
    @State private var estimates: [BusinessTaxEstimate] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var isRefreshing = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Quarterly estimated taxes are projections, not filed amounts. Confirm with a tax professional before paying.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        .cardStyle(padding: 12)

                    if isLoading {
                        ProgressView().tint(Theme.accent).frame(maxWidth: .infinity).padding(.top, 20)
                    } else if let error {
                        Text(error).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.danger)
                    } else if estimates.isEmpty {
                        Text("No estimates yet. Tap refresh to generate them from your revenue and expenses.")
                            .font(.system(size: 13)).foregroundStyle(Theme.textSecondary).padding(.top, 20)
                    } else {
                        ForEach(estimates) { e in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("Q\(e.quarter ?? 0) \(String(e.tax_year ?? 0))").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                                    Text("Due \(e.due_date ?? "—") · est. \(money2(e.estimated_tax))")
                                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                if (e.status ?? "") == "paid" {
                                    Text("Paid").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.success)
                                        .padding(.horizontal, 8).padding(.vertical, 4).background(Theme.success.opacity(0.14), in: Capsule())
                                } else {
                                    Button("Mark paid") { act { try await BusinessHubService.markTaxPaid(businessId: businessId, estimateId: e.id) } }
                                        .font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.accent)
                                }
                            }
                            .cardStyle(padding: 12)
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Estimated tax")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isRefreshing = true
                        act { try await BusinessHubService.refreshTax(businessId: businessId); isRefreshing = false }
                    } label: {
                        if isRefreshing { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                    }.foregroundStyle(Theme.accent)
                }
                ToolbarItem(placement: .topBarLeading) { Button("common.done") { dismiss() }.foregroundStyle(Theme.accent) }
            }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true; defer { isLoading = false }
        do { estimates = try await BusinessHubService.tax(businessId: businessId); error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
    }
    private func act(_ op: @escaping () async throws -> Void) {
        Task { do { try await op(); await load() } catch { isRefreshing = false; self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription } }
    }
}
