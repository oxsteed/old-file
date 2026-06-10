import Foundation

// MARK: - Business Hub models (Phase 2: invoices, services, clients)
//
// Postgres returns NUMERIC/DECIMAL and BIGINT/int8 (incl. COUNT) as JSON
// STRINGS, so money/count/bigserial fields use the app's flexible decoders.

struct BusinessInvoice: Decodable, Identifiable, Equatable {
    let id: String
    let invoice_number: String?
    let client_name: String?
    let client_email: String?
    let client_company: String?
    let status: String?
    let issue_date: String?
    let due_date: String?
    let subtotal: Double?
    let total: Double?
    let amount_paid: Double?
    let invoice_tax_rate: Double?
    let notes: String?
    let job_id: String?
    let sent_at: String?
    let paid_at: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, invoice_number, client_name, client_email, client_company, status
        case issue_date, due_date, subtotal, total, amount_paid, invoice_tax_rate
        case notes, job_id, sent_at, paid_at, created_at
    }

    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        invoice_number = try c.decodeIfPresent(String.self, forKey: .invoice_number)
        client_name = try c.decodeIfPresent(String.self, forKey: .client_name)
        client_email = try c.decodeIfPresent(String.self, forKey: .client_email)
        client_company = try c.decodeIfPresent(String.self, forKey: .client_company)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        issue_date = try c.decodeIfPresent(String.self, forKey: .issue_date)
        due_date = try c.decodeIfPresent(String.self, forKey: .due_date)
        subtotal = try c.decodeFlexibleDoubleIfPresent(forKey: .subtotal)
        total = try c.decodeFlexibleDoubleIfPresent(forKey: .total)
        amount_paid = try c.decodeFlexibleDoubleIfPresent(forKey: .amount_paid)
        invoice_tax_rate = try c.decodeFlexibleDoubleIfPresent(forKey: .invoice_tax_rate)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        job_id = try c.decodeFlexibleStringIfPresent(forKey: .job_id)
        sent_at = try c.decodeIfPresent(String.self, forKey: .sent_at)
        paid_at = try c.decodeIfPresent(String.self, forKey: .paid_at)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }
}

struct InvoiceSummary: Decodable, Equatable {
    let draft: Int?
    let sent: Int?
    let paid: Int?
    let overdue: Int?
    let outstanding_total: Double?

    enum CodingKeys: String, CodingKey { case draft, sent, paid, overdue, outstanding_total }

    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        draft = try c.decodeFlexibleIntIfPresent(forKey: .draft)
        sent = try c.decodeFlexibleIntIfPresent(forKey: .sent)
        paid = try c.decodeFlexibleIntIfPresent(forKey: .paid)
        overdue = try c.decodeFlexibleIntIfPresent(forKey: .overdue)
        outstanding_total = try c.decodeFlexibleDoubleIfPresent(forKey: .outstanding_total)
    }
}

/// Encodable line item for invoice creation.
struct InvoiceLineItemInput: Encodable, Equatable, Identifiable {
    var id = UUID()
    var description: String
    var quantity: Double
    var unit_price: Double

    enum CodingKeys: String, CodingKey { case description, quantity, unit_price }
}

struct BusinessService: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let description: String?
    let category: String?
    let duration_minutes: Int?
    let base_price_cents: Int?
    let is_active: Bool?
    let staff_count: Int?

    enum CodingKeys: String, CodingKey {
        case id, name, description, category, duration_minutes, base_price_cents, is_active, staff_count
    }

    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        description = try c.decodeIfPresent(String.self, forKey: .description)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        duration_minutes = try c.decodeFlexibleIntIfPresent(forKey: .duration_minutes)
        base_price_cents = try c.decodeFlexibleIntIfPresent(forKey: .base_price_cents)
        is_active = try c.decodeFlexibleBoolIfPresent(forKey: .is_active)
        staff_count = try c.decodeFlexibleIntIfPresent(forKey: .staff_count)
    }

    var priceDollars: Double { Double(base_price_cents ?? 0) / 100.0 }
}

struct BusinessClient: Decodable, Identifiable, Equatable {
    let id: String
    let customer_id: String?
    let display_name: String?
    let email: String?
    let phone: String?
    let city: String?
    let state: String?
    let status: String?
    let internal_notes: String?
    let lifetime_value_cents: Int?
    let total_jobs: Int?
    let last_job_at: String?
    let created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, customer_id, display_name, email, phone, city, state, status
        case internal_notes, lifetime_value_cents, total_jobs, last_job_at, created_at
    }

    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id)
        customer_id = try c.decodeFlexibleStringIfPresent(forKey: .customer_id)
        display_name = try c.decodeIfPresent(String.self, forKey: .display_name)
        email = try c.decodeIfPresent(String.self, forKey: .email)
        phone = try c.decodeIfPresent(String.self, forKey: .phone)
        city = try c.decodeIfPresent(String.self, forKey: .city)
        state = try c.decodeIfPresent(String.self, forKey: .state)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        internal_notes = try c.decodeIfPresent(String.self, forKey: .internal_notes)
        lifetime_value_cents = try c.decodeFlexibleIntIfPresent(forKey: .lifetime_value_cents)
        total_jobs = try c.decodeFlexibleIntIfPresent(forKey: .total_jobs)
        last_job_at = try c.decodeIfPresent(String.self, forKey: .last_job_at)
        created_at = try c.decodeIfPresent(String.self, forKey: .created_at)
    }

    var lifetimeValueDollars: Double { Double(lifetime_value_cents ?? 0) / 100.0 }
}

// MARK: - Service

enum BusinessHubService {

    // ── Invoices ────────────────────────────────────────────────────────────
    static func invoices(businessId: Int, status: String? = nil)
        async throws -> (invoices: [BusinessInvoice], summary: InvoiceSummary?) {
        struct Resp: Decodable { let invoices: [BusinessInvoice]; let summary: InvoiceSummary? }
        var q: [String: Any] = [:]
        if let status { q["status"] = status }
        let r: Resp = try await APIClient.shared.request(
            "/api/businesses/\(businessId)/invoices", query: q.isEmpty ? nil : q)
        return (r.invoices, r.summary)
    }

    static func createInvoice(businessId: Int,
                              clientName: String,
                              clientEmail: String?,
                              dueDate: String?,
                              lineItems: [InvoiceLineItemInput],
                              taxRate: Double,
                              notes: String?) async throws -> BusinessInvoice {
        struct Req: Encodable {
            let client_name: String
            let client_email: String?
            let due_date: String?
            let line_items: [InvoiceLineItemInput]
            let invoice_tax_rate: Double
            let notes: String?
        }
        struct Resp: Decodable { let invoice: BusinessInvoice }
        let r: Resp = try await APIClient.shared.request(
            "/api/businesses/\(businessId)/invoices", method: .POST,
            body: Req(client_name: clientName, client_email: clientEmail, due_date: dueDate,
                      line_items: lineItems, invoice_tax_rate: taxRate, notes: notes))
        return r.invoice
    }

    static func sendInvoice(businessId: Int, invoiceId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/invoices/\(invoiceId)/send", method: .POST)
    }

    static func markInvoicePaid(businessId: Int, invoiceId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/invoices/\(invoiceId)/pay", method: .POST)
    }

    static func deleteInvoice(businessId: Int, invoiceId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/invoices/\(invoiceId)", method: .DELETE)
    }

    // ── Services ────────────────────────────────────────────────────────────
    static func services(businessId: Int, includeInactive: Bool = true) async throws -> [BusinessService] {
        try await APIClient.shared.request(
            "/api/businesses/\(businessId)/services", query: ["include_inactive": includeInactive])
    }

    static func createService(businessId: Int,
                              name: String,
                              description: String?,
                              category: String?,
                              durationMinutes: Int,
                              basePriceCents: Int) async throws -> BusinessService {
        struct Req: Encodable {
            let name: String
            let description: String?
            let category: String?
            let duration_minutes: Int
            let base_price_cents: Int
        }
        return try await APIClient.shared.request(
            "/api/businesses/\(businessId)/services", method: .POST,
            body: Req(name: name, description: description, category: category,
                      duration_minutes: durationMinutes, base_price_cents: basePriceCents))
    }

    static func deleteService(businessId: Int, serviceId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/services/\(serviceId)", method: .DELETE)
    }

    // ── Clients ─────────────────────────────────────────────────────────────
    static func clients(businessId: Int) async throws -> [BusinessClient] {
        struct Resp: Decodable { let clients: [BusinessClient] }
        let r: Resp = try await APIClient.shared.request("/api/businesses/\(businessId)/clients")
        return r.clients
    }

    static func createClient(businessId: Int,
                             displayName: String,
                             email: String?,
                             phone: String?,
                             notes: String?) async throws -> BusinessClient {
        struct Req: Encodable {
            let display_name: String
            let email: String?
            let phone: String?
            let internal_notes: String?
        }
        struct Resp: Decodable { let client: BusinessClient }
        let r: Resp = try await APIClient.shared.request(
            "/api/businesses/\(businessId)/clients", method: .POST,
            body: Req(display_name: displayName, email: email, phone: phone, internal_notes: notes))
        return r.client
    }

    static func deleteClient(businessId: Int, clientId: String) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/clients/\(clientId)", method: .DELETE)
    }
}
