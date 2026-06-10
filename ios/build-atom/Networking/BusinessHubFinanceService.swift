import Foundation

// MARK: - Business Hub finance models (Phase 2 increment 2: expenses, quotes, tax)
// Numeric/BIGINT columns arrive as JSON strings → flexible decoders.

struct BusinessExpense: Decodable, Identifiable, Equatable {
    let id: String
    let category: String?
    let description: String?
    let amount_cents: Int?
    let expense_date: String?
    let receipt_url: String?
    let notes: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, category, description, amount_cents, expense_date, receipt_url, notes, created_at
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        amount_cents = try c.decodeFlexibleIntIfPresent(forKey: .amount_cents)
        expense_date = try c.decodeIfPresent(String.self, forKey: .expense_date)
        receipt_url = try c.decodeIfPresent(String.self, forKey: .receipt_url)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }
    var amountDollars: Double { Double(amount_cents ?? 0) / 100.0 }
}

struct ExpenseCategorySummary: Decodable, Identifiable, Equatable {
    var id: String { category ?? "" }
    let category: String?
    let total_cents: Int?
    enum CodingKeys: String, CodingKey { case category, total_cents }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        total_cents = try c.decodeFlexibleIntIfPresent(forKey: .total_cents)
    }
    var totalDollars: Double { Double(total_cents ?? 0) / 100.0 }
}

struct BusinessQuote: Decodable, Identifiable, Equatable {
    let id: String
    let client_name: String?
    let client_email: String?
    let title: String?
    let subtotal_cents: Int?
    let tax_rate: Double?
    let total_cents: Int?
    let valid_until: String?
    let status: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, client_name, client_email, title, subtotal_cents, tax_rate, total_cents, valid_until, status, created_at
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        client_name = try c.decodeIfPresent(String.self, forKey: .client_name)
        client_email = try c.decodeIfPresent(String.self, forKey: .client_email)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        subtotal_cents = try c.decodeFlexibleIntIfPresent(forKey: .subtotal_cents)
        tax_rate = try c.decodeFlexibleDoubleIfPresent(forKey: .tax_rate)
        total_cents = try c.decodeFlexibleIntIfPresent(forKey: .total_cents)
        valid_until = try c.decodeIfPresent(String.self, forKey: .valid_until)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }
    var totalDollars: Double { Double(total_cents ?? 0) / 100.0 }
}

/// Encodable line item for quote creation (server expects cents per unit).
struct QuoteLineItemInput: Encodable, Equatable, Identifiable {
    var id = UUID()
    var description: String
    var quantity: Double
    var unit_price_cents: Int
    enum CodingKeys: String, CodingKey { case description, quantity, unit_price_cents }
}

struct BusinessTaxEstimate: Decodable, Identifiable, Equatable {
    let id: String
    let tax_year: Int?
    let quarter: Int?
    let estimated_net_income: Double?
    let estimated_tax: Double?
    let due_date: String?
    let status: String?
    let paid_amount: Double?
    let paid_at: String?

    enum CodingKeys: String, CodingKey {
        case id, tax_year, quarter, estimated_net_income, estimated_tax, due_date, status, paid_amount, paid_at
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        tax_year = try c.decodeFlexibleIntIfPresent(forKey: .tax_year)
        quarter = try c.decodeFlexibleIntIfPresent(forKey: .quarter)
        estimated_net_income = try c.decodeFlexibleDoubleIfPresent(forKey: .estimated_net_income)
        estimated_tax = try c.decodeFlexibleDoubleIfPresent(forKey: .estimated_tax)
        due_date = try c.decodeIfPresent(String.self, forKey: .due_date)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        paid_amount = try c.decodeFlexibleDoubleIfPresent(forKey: .paid_amount)
        paid_at = try c.decodeIfPresent(String.self, forKey: .paid_at)
    }
}

// MARK: - Service extension

extension BusinessHubService {

    // ── Expenses ────────────────────────────────────────────────────────────
    static func expenses(businessId: Int)
        async throws -> (expenses: [BusinessExpense], summary: [ExpenseCategorySummary]) {
        struct Resp: Decodable { let expenses: [BusinessExpense]; let summary: [ExpenseCategorySummary]? }
        let r: Resp = try await APIClient.shared.request("/api/businesses/\(businessId)/expenses")
        return (r.expenses, r.summary ?? [])
    }

    static func createExpense(businessId: Int,
                              category: String,
                              description: String,
                              amountCents: Int,
                              expenseDate: String?,
                              notes: String?) async throws -> BusinessExpense {
        struct Req: Encodable {
            let category: String
            let description: String
            let amount_cents: Int
            let expense_date: String?
            let notes: String?
        }
        return try await APIClient.shared.request(
            "/api/businesses/\(businessId)/expenses", method: .POST,
            body: Req(category: category, description: description, amount_cents: amountCents,
                      expense_date: expenseDate, notes: notes))
    }

    static func deleteExpense(businessId: Int, expenseId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/expenses/\(expenseId)", method: .DELETE)
    }

    // ── Quotes ──────────────────────────────────────────────────────────────
    static func quotes(businessId: Int) async throws -> [BusinessQuote] {
        struct Resp: Decodable { let quotes: [BusinessQuote] }
        let r: Resp = try await APIClient.shared.request("/api/businesses/\(businessId)/quotes")
        return r.quotes
    }

    static func createQuote(businessId: Int,
                            clientName: String,
                            clientEmail: String?,
                            title: String,
                            lineItems: [QuoteLineItemInput],
                            taxRate: Double,
                            validUntil: String?) async throws -> BusinessQuote {
        struct Req: Encodable {
            let client_name: String
            let client_email: String?
            let title: String
            let line_items: [QuoteLineItemInput]
            let tax_rate: Double
            let valid_until: String?
        }
        return try await APIClient.shared.request(
            "/api/businesses/\(businessId)/quotes", method: .POST,
            body: Req(client_name: clientName, client_email: clientEmail, title: title,
                      line_items: lineItems, tax_rate: taxRate, valid_until: validUntil))
    }

    static func sendQuote(businessId: Int, quoteId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/quotes/\(quoteId)/send", method: .POST)
    }

    static func convertQuote(businessId: Int, quoteId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/quotes/\(quoteId)/convert", method: .POST)
    }

    static func deleteQuote(businessId: Int, quoteId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/quotes/\(quoteId)", method: .DELETE)
    }

    // ── Tax ─────────────────────────────────────────────────────────────────
    static func tax(businessId: Int) async throws -> [BusinessTaxEstimate] {
        struct Resp: Decodable { let estimates: [BusinessTaxEstimate] }
        let r: Resp = try await APIClient.shared.request("/api/businesses/\(businessId)/tax")
        return r.estimates
    }

    static func refreshTax(businessId: Int) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/tax/refresh", method: .POST)
    }

    static func markTaxPaid(businessId: Int, estimateId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/tax/\(estimateId)/pay", method: .POST)
    }
}
