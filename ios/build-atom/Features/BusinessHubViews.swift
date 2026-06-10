import SwiftUI

private func money(_ v: Double?) -> String { String(format: "$%.2f", v ?? 0) }

// MARK: - Invoices

struct BusinessInvoicesView: View {
    let businessId: Int

    @Environment(\.dismiss) private var dismiss
    @State private var invoices: [BusinessInvoice] = []
    @State private var summary: InvoiceSummary?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showCreate = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let s = summary {
                        HStack(spacing: 10) {
                            statTile("Outstanding", money(s.outstanding_total), Theme.warning)
                            statTile("Paid", "\(s.paid ?? 0)", Theme.success)
                            statTile("Sent", "\(s.sent ?? 0)", Theme.accent)
                        }
                    }
                    if isLoading {
                        ProgressView().tint(Theme.accent).frame(maxWidth: .infinity).padding(.top, 30)
                    } else if let error {
                        Text(error).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.danger)
                    } else if invoices.isEmpty {
                        emptyState("No invoices yet", "doc.plaintext")
                    } else {
                        ForEach(invoices) { inv in row(inv) }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Invoices")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showCreate = true } label: { Image(systemName: "plus") }
                        .foregroundStyle(Theme.accent)
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("common.done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
            .sheet(isPresented: $showCreate) {
                CreateInvoiceView(businessId: businessId) { await load() }
            }
            .task { await load() }
        }
    }

    private func row(_ inv: BusinessInvoice) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(inv.client_name ?? "—").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Text("\(inv.invoice_number ?? "") · \(money(inv.total))")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            statusPill(inv.status ?? "draft")
            Menu {
                Button("Send") { act { try await BusinessHubService.sendInvoice(businessId: businessId, invoiceId: inv.id) } }
                Button("Mark paid") { act { try await BusinessHubService.markInvoicePaid(businessId: businessId, invoiceId: inv.id) } }
                Button("Delete", role: .destructive) { act { try await BusinessHubService.deleteInvoice(businessId: businessId, invoiceId: inv.id) } }
            } label: {
                Image(systemName: "ellipsis.circle").foregroundStyle(Theme.textSecondary)
            }
        }
        .cardStyle(padding: 12)
    }

    private func statusPill(_ s: String) -> some View {
        let color: Color = s == "paid" ? Theme.success : s == "overdue" ? Theme.danger : s == "sent" ? Theme.accent : Theme.textTertiary
        return Text(s.capitalized)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(color.opacity(0.14), in: Capsule())
    }

    private func load() async {
        isLoading = true; defer { isLoading = false }
        do {
            let r = try await BusinessHubService.invoices(businessId: businessId)
            invoices = r.invoices; summary = r.summary; error = nil
        } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
    }

    private func act(_ op: @escaping () async throws -> Void) {
        Task { do { try await op(); await load() } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription } }
    }

    private func statTile(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value).font(.system(size: 17, weight: .heavy)).foregroundStyle(color)
            Text(label).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle(padding: 12)
    }

    private func emptyState(_ text: String, _ icon: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 30)).foregroundStyle(Theme.textTertiary)
            Text(text).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
        }.frame(maxWidth: .infinity).padding(.top, 30)
    }
}

private struct CreateInvoiceView: View {
    let businessId: Int
    let onCreated: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var clientName = ""
    @State private var clientEmail = ""
    @State private var dueDate = ""
    @State private var taxRate = ""
    @State private var notes = ""
    @State private var items: [InvoiceLineItemInput] = [.init(description: "", quantity: 1, unit_price: 0)]
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Client") {
                    TextField("Client name", text: $clientName)
                    TextField("Email (optional)", text: $clientEmail).keyboardType(.emailAddress).autocapitalization(.none)
                    TextField("Due date YYYY-MM-DD (optional)", text: $dueDate)
                }
                Section("Line items") {
                    ForEach($items) { $item in
                        VStack {
                            TextField("Description", text: $item.description)
                            HStack {
                                TextField("Qty", value: $item.quantity, format: .number).keyboardType(.decimalPad)
                                TextField("Unit price", value: $item.unit_price, format: .number).keyboardType(.decimalPad)
                            }
                        }
                    }
                    Button("Add line item") { items.append(.init(description: "", quantity: 1, unit_price: 0)) }
                }
                Section("Other") {
                    TextField("Tax rate % (optional)", text: $taxRate).keyboardType(.decimalPad)
                    TextField("Notes (optional)", text: $notes)
                }
                if let error { Text(error).foregroundStyle(Theme.danger).font(.system(size: 12)) }
            }
            .navigationTitle("New invoice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("common.cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Create") { create() }.disabled(isWorking || !canCreate) }
            }
        }
    }

    private var canCreate: Bool {
        !clientName.trimmingCharacters(in: .whitespaces).isEmpty &&
        items.contains { !$0.description.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private func create() {
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                let valid = items.filter { !$0.description.trimmingCharacters(in: .whitespaces).isEmpty }
                _ = try await BusinessHubService.createInvoice(
                    businessId: businessId,
                    clientName: clientName.trimmingCharacters(in: .whitespaces),
                    clientEmail: clientEmail.isEmpty ? nil : clientEmail,
                    dueDate: dueDate.isEmpty ? nil : dueDate,
                    lineItems: valid,
                    taxRate: Double(taxRate) ?? 0,
                    notes: notes.isEmpty ? nil : notes)
                await onCreated()
                dismiss()
            } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
        }
    }
}

// MARK: - Services

struct BusinessServicesView: View {
    let businessId: Int

    @Environment(\.dismiss) private var dismiss
    @State private var services: [BusinessService] = []
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
                    } else if services.isEmpty {
                        Text("No services yet. Add one so clients can book.").font(.system(size: 13)).foregroundStyle(Theme.textSecondary).padding(.top, 30)
                    } else {
                        ForEach(services) { s in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(s.name).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                                    Text("\(s.duration_minutes ?? 0) min · \(money(s.priceDollars))")
                                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                if s.is_active == false {
                                    Text("Inactive").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textTertiary)
                                }
                                Button { act { try await BusinessHubService.deleteService(businessId: businessId, serviceId: s.id) } } label: {
                                    Image(systemName: "trash").foregroundStyle(Theme.danger)
                                }
                            }
                            .cardStyle(padding: 12)
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Services")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button { showCreate = true } label: { Image(systemName: "plus") }.foregroundStyle(Theme.accent) }
                ToolbarItem(placement: .topBarLeading) { Button("common.done") { dismiss() }.foregroundStyle(Theme.accent) }
            }
            .sheet(isPresented: $showCreate) { CreateServiceView(businessId: businessId) { await load() } }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true; defer { isLoading = false }
        do { services = try await BusinessHubService.services(businessId: businessId); error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
    }
    private func act(_ op: @escaping () async throws -> Void) {
        Task { do { try await op(); await load() } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription } }
    }
}

private struct CreateServiceView: View {
    let businessId: Int
    let onCreated: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var category = ""
    @State private var description = ""
    @State private var duration = 60
    @State private var price = ""
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Service") {
                    TextField("Name", text: $name)
                    TextField("Category (optional)", text: $category)
                    TextField("Description (optional)", text: $description)
                }
                Section("Booking") {
                    Stepper("Duration: \(duration) min", value: $duration, in: 15...600, step: 15)
                    TextField("Price (USD)", text: $price).keyboardType(.decimalPad)
                }
                if let error { Text(error).foregroundStyle(Theme.danger).font(.system(size: 12)) }
            }
            .navigationTitle("New service")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("common.cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }.disabled(isWorking || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func create() {
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                let cents = Int((Double(price) ?? 0) * 100)
                _ = try await BusinessHubService.createService(
                    businessId: businessId,
                    name: name.trimmingCharacters(in: .whitespaces),
                    description: description.isEmpty ? nil : description,
                    category: category.isEmpty ? nil : category,
                    durationMinutes: duration,
                    basePriceCents: cents)
                await onCreated(); dismiss()
            } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
        }
    }
}

// MARK: - Clients

struct BusinessClientsView: View {
    let businessId: Int

    @Environment(\.dismiss) private var dismiss
    @State private var clients: [BusinessClient] = []
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
                    } else if clients.isEmpty {
                        Text("No clients yet.").font(.system(size: 13)).foregroundStyle(Theme.textSecondary).padding(.top, 30)
                    } else {
                        ForEach(clients) { c in
                            HStack(spacing: 12) {
                                Image(systemName: "person.crop.circle.fill").font(.system(size: 30)).foregroundStyle(Theme.textTertiary)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(c.display_name ?? "—").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                                    Text([c.email, c.phone].compactMap { $0 }.joined(separator: " · "))
                                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                if (c.total_jobs ?? 0) > 0 {
                                    Text("\(c.total_jobs ?? 0) jobs").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textTertiary)
                                }
                                Button { act { try await BusinessHubService.deleteClient(businessId: businessId, clientId: c.id) } } label: {
                                    Image(systemName: "trash").foregroundStyle(Theme.danger)
                                }
                            }
                            .cardStyle(padding: 12)
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Clients")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button { showCreate = true } label: { Image(systemName: "plus") }.foregroundStyle(Theme.accent) }
                ToolbarItem(placement: .topBarLeading) { Button("common.done") { dismiss() }.foregroundStyle(Theme.accent) }
            }
            .sheet(isPresented: $showCreate) { CreateClientView(businessId: businessId) { await load() } }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true; defer { isLoading = false }
        do { clients = try await BusinessHubService.clients(businessId: businessId); error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
    }
    private func act(_ op: @escaping () async throws -> Void) {
        Task { do { try await op(); await load() } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription } }
    }
}

private struct CreateClientView: View {
    let businessId: Int
    let onCreated: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var notes = ""
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Client") {
                    TextField("Name", text: $name)
                    TextField("Email (optional)", text: $email).keyboardType(.emailAddress).autocapitalization(.none)
                    TextField("Phone (optional)", text: $phone).keyboardType(.phonePad)
                    TextField("Notes (optional)", text: $notes)
                }
                if let error { Text(error).foregroundStyle(Theme.danger).font(.system(size: 12)) }
            }
            .navigationTitle("New client")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("common.cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }.disabled(isWorking || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func create() {
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                _ = try await BusinessHubService.createClient(
                    businessId: businessId,
                    displayName: name.trimmingCharacters(in: .whitespaces),
                    email: email.isEmpty ? nil : email,
                    phone: phone.isEmpty ? nil : phone,
                    notes: notes.isEmpty ? nil : notes)
                await onCreated(); dismiss()
            } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
        }
    }
}
