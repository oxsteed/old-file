import SwiftUI

// MARK: - Tax Documents View

struct TaxDocumentsView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var selectedYear  = Calendar.current.component(.year, from: Date())
    @State private var summary: TaxSummary?
    @State private var expenses: [TaxExpense] = []
    @State private var preview1099: Tax1099Preview?
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

        enum CodingKeys: String, CodingKey {
            case id, category, description, amount_cents, expense_date, notes, business_name
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeTaxString(forKey: .id)
            category = try c.decodeIfPresent(String.self, forKey: .category)
            description = try c.decodeIfPresent(String.self, forKey: .description)
            amount_cents = try c.decodeIfPresent(Int.self, forKey: .amount_cents) ?? 0
            expense_date = try c.decodeIfPresent(String.self, forKey: .expense_date)
            notes = try c.decodeIfPresent(String.self, forKey: .notes)
            business_name = try c.decodeIfPresent(String.self, forKey: .business_name)
        }
    }
    struct Tax1099Preview: Decodable {
        struct Payer: Decodable, Identifiable {
            var id: String { "\(payer_email ?? payer_name)-\(total_paid_cents)" }
            let payer_name: String
            let payer_email: String?
            let business_name: String?
            let total_paid_cents: Int
            let payment_count: Int
            let form_required: Bool
        }
        let year: Int
        let payers: [Payer]
        let disclaimer: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Year picker
                HStack {
                    Text("Tax Year").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Picker(LocalizedStringKey("Year"), selection: $selectedYear) {
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
                    if let preview1099 { preview1099Section(preview1099) }
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
                        Text(localization.localized(cat.category.capitalized)).font(.system(size: 13)).foregroundStyle(Theme.textPrimary)
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
                        Text(exp.description ?? exp.category.map { localization.localized($0.capitalized) } ?? localization.localized("Expense"))
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                        if let cat = exp.category { Text(localization.localized(cat.capitalized)).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
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

    private func preview1099Section(_ preview: Tax1099Preview) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("1099 Preview").sectionTitle()
            if preview.payers.isEmpty {
                Text("No payer-level 1099 preview data for this year yet.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .cardStyle(padding: 12)
            } else {
                VStack(spacing: 8) {
                    ForEach(preview.payers.prefix(6)) { payer in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: payer.form_required ? "doc.badge.exclamationmark" : "doc.text")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(payer.form_required ? Theme.warning : Theme.textSecondary)
                                .frame(width: 34, height: 34)
                                .background((payer.form_required ? Theme.warning : Theme.textSecondary).opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(payer.business_name ?? payer.payer_name)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                    .lineLimit(1)
                                Text(localization.format("%d payments", payer.payment_count))
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textSecondary)
                                if payer.form_required {
                                    Text("Form threshold reached")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(Theme.warning)
                                }
                            }
                            Spacer()
                            Text(dollars(payer.total_paid_cents))
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(Theme.textPrimary)
                        }
                        .padding(10)
                        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
            Text(preview.disclaimer)
                .font(.system(size: 10))
                .foregroundStyle(Theme.textTertiary)
        }
    }

    private func load() async {
        isLoading = true; error = nil
        do {
            async let s = TaxService.summary(year: selectedYear)
            async let e = TaxService.expenses(year: selectedYear)
            async let p = TaxService.preview1099(year: selectedYear)
            let (sum, exp, preview) = try await (s, e, p)
            summary = sum; expenses = exp; preview1099 = preview
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
            "1099 Preview: \(preview1099?.payers.filter { $0.form_required }.count ?? 0) payer(s) may require forms", "",
            s.disclaimer
        ]
        shareItems = [lines.joined(separator: "\n")]
    }

    private func dollars(_ cents: Int) -> String { localization.formatCents(cents) }
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
    static func preview1099(year: Int) async throws -> TaxDocumentsView.Tax1099Preview {
        try await APIClient.shared.request(
            "/api/tax/1099-preview",
            query: ["year": year],
            as: TaxDocumentsView.Tax1099Preview.self
        )
    }
}

private extension KeyedDecodingContainer {
    func decodeTaxString(forKey key: Key) throws -> String {
        if let value = try? decode(String.self, forKey: key) { return value }
        if let value = try? decode(Int.self, forKey: key) { return String(value) }
        if let value = try? decode(Double.self, forKey: key) { return String(value) }
        throw DecodingError.typeMismatch(
            String.self,
            DecodingError.Context(codingPath: codingPath + [key], debugDescription: "Expected string-compatible tax id")
        )
    }
}
