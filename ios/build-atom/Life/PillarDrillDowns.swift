import SwiftUI
import PhotosUI

// MARK: - Money Pillar

struct MoneyPillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @EnvironmentObject private var localization: LocalizationManager
    @State private var showAdd = false
    @State private var addType = "income"

    private var usesServerMoney: Bool { KeychainManager.shared.getAccessToken() != nil }
    private var income: Double {
        if usesServerMoney {
            return life.expenseSummary?.total_income ?? life.expenses.filter { $0.type == "income" }.compactMap(\.amount).reduce(0, +)
        }
        return lifeData.moneyEntries.filter { $0.type == "income" }.map(\.amount).reduce(0, +)
    }
    private var expenses: Double {
        if usesServerMoney {
            return life.expenseSummary?.total_expenses ?? life.expenses.filter { $0.type == "expense" }.compactMap(\.amount).reduce(0, +)
        }
        return lifeData.moneyEntries.filter { $0.type == "expense" }.map(\.amount).reduce(0, +)
    }
    private var balance: Double { income - expenses }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                summaryCard
                cashFlowSection
                entriesSection
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Money")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showAdd = true } label: {
                    Image(systemName: "plus").foregroundStyle(Theme.accent)
                }
            }
        }
        .sheet(isPresented: $showAdd) {
            AddMoneyEntryView().presentationDetents([.medium])
        }
        .task { await life.refresh() }
    }

    private var summaryCard: some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                moneyTile(label: "Income", value: income, color: Theme.success)
                moneyTile(label: "Expenses", value: expenses, color: Theme.danger)
                moneyTile(label: "Net", value: balance, color: balance >= 0 ? Theme.pillarMoney : Theme.danger)
            }
        }
        .cardStyle()
    }

    private func moneyTile(label: String, value: Double, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(label).font(.system(size: 10, weight: .bold)).tracking(0.8)
                .foregroundStyle(Theme.textTertiary).textCase(.uppercase)
            Text(currencyStr(value)).font(.system(size: 18, weight: .heavy)).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity)
    }

    private var cashFlowSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("30-Day Cash Flow").sectionTitle()
            CashFlowBar(income: income, expenses: expenses)
                .frame(height: 48)
                .cardStyle(padding: 12)
        }
    }

    private var entriesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Transactions", actionLabel: nil)
            if usesServerMoney {
                if life.expenses.isEmpty {
                    Text("No transactions yet.")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                }
                ForEach(life.expenses) { entry in
                    serverMoneyRow(entry)
                }
            } else {
                ForEach(lifeData.moneyEntries.reversed()) { entry in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.source).font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            Text(entry.date).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                        }
                        Spacer()
                        Text("\(entry.type == "income" ? "+" : "-")\(currencyStr(entry.amount))")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(entry.type == "income" ? Theme.success : Theme.danger)
                    }
                    .padding(12)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                }
            }
        }
    }

    private func serverMoneyRow(_ entry: APILifeExpense) -> some View {
        let type = entry.type ?? "expense"
        let amount = entry.amount ?? 0
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.description ?? entry.category ?? "Transaction")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(entry.occurred_at.map { String($0.prefix(10)) } ?? "")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
            }
            Spacer()
            Text("\(type == "income" ? "+" : "-")\(currencyStr(amount))")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(type == "income" ? Theme.success : Theme.danger)
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private func currencyStr(_ v: Double) -> String {
        localization.formatCurrency(abs(v), fractionDigits: 0)
    }
}

private struct CashFlowBar: View {
    let income: Double
    let expenses: Double
    var body: some View {
        GeometryReader { geo in
            let total = max(income, 1)
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 8).fill(Theme.surfaceElevated)
                RoundedRectangle(cornerRadius: 8).fill(Theme.success)
                    .frame(width: geo.size.width * min(income / total, 1))
                RoundedRectangle(cornerRadius: 8).fill(Theme.danger.opacity(0.8))
                    .frame(width: geo.size.width * min(expenses / total, 1))
                    .blendMode(.normal)
            }
        }
    }
}

private struct AddMoneyEntryView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @Environment(\.dismiss) private var dismiss
    @State private var source = ""
    @State private var amount = ""
    @State private var type = "income"
    @State private var date = formattedToday()
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Picker(LocalizedStringKey("picker.type"), selection: $type) {
                    Text("Income").tag("income"); Text("Expense").tag("expense")
                }.pickerStyle(.segmented)
                OxTextField(title: "Description", text: $source)
                OxTextField(title: "Amount ($)", text: $amount, keyboard: .decimalPad)
                OxTextField(title: "Date (YYYY-MM-DD)", text: $date)
                if let err = life.lastError {
                    Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                }
                Button {
                    Task { await save() }
                } label: {
                    HStack(spacing: 8) {
                        if isSaving { ProgressView().tint(.white) }
                        Text("life.add_entry").font(.system(size: 15, weight: .bold))
                    }
                    .foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(source.isEmpty || amount.isEmpty || isSaving)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Add Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let value = Double(amount) ?? 0
        guard value > 0 else { return }
        if KeychainManager.shared.getAccessToken() != nil {
            if await life.createExpense(source: source, amount: value, type: type, occurredAt: date) {
                dismiss()
            }
        } else {
            lifeData.moneyEntries.append(
                .init(source: source, amount: value, type: type, date: date))
            dismiss()
        }
    }
}

// MARK: - Home Care Pillar

struct HomeCarePillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @State private var showAdd       = false
    @State private var postJobPrefill: PostJobPrefill? = nil

    private var serverTasks: [APILifeHomeTask] { life.homeTasks.filter { ($0.section ?? "home") == "home" } }
    private var usesServerTasks: Bool { KeychainManager.shared.getAccessToken() != nil && !serverTasks.isEmpty }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Seasonal Tasks").sectionTitle()
                    if usesServerTasks {
                        ForEach(serverTasks) { task in
                            serverHomeTaskRow(task)
                        }
                    } else {
                        ForEach($lifeData.homeTasks) { $task in
                            localHomeTaskRow($task)
                        }
                    }
                }

                Button {
                    showAdd = true
                } label: {
                    Label("life.add_task", systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Home Care")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .sheet(isPresented: $showAdd) { AddHomeTaskView().presentationDetents([.medium]) }
        .sheet(item: $postJobPrefill) { pf in
            PostJobView(prefill: pf)
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .task { await life.refresh(section: "home") }
    }

    private func serverHomeTaskRow(_ task: APILifeHomeTask) -> some View {
        let completed = task.is_completed ?? false
        return HStack(spacing: 12) {
            Button {
                Task { await life.toggleHomeTask(task) }
            } label: {
                Image(systemName: completed ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(completed ? Theme.success : Theme.textTertiary)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(completed ? Theme.textTertiary : Theme.textPrimary)
                    .strikethrough(completed)
                Text([task.description, task.due_date].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
            }
            Spacer()
            if (task.frequency ?? "").isEmpty == false {
                Image(systemName: "arrow.clockwise").font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
            }
            Button {
                postJobPrefill = PostJobPrefill(
                    title: task.title,
                    description: "Home care task: \(task.title)\(task.description.map { " (\($0))" } ?? "")",
                    category: "Handyman",
                    urgency: task.urgency ?? "medium"
                )
            } label: {
                Image(systemName: "arrow.up.right.circle")
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.accent)
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private func localHomeTaskRow(_ task: Binding<HomeTask>) -> some View {
        HStack(spacing: 12) {
            Button {
                task.wrappedValue.completed.toggle()
            } label: {
                Image(systemName: task.wrappedValue.completed ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(task.wrappedValue.completed ? Theme.success : Theme.textTertiary)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(task.wrappedValue.title).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(task.wrappedValue.completed ? Theme.textTertiary : Theme.textPrimary)
                    .strikethrough(task.wrappedValue.completed)
                Text(task.wrappedValue.category + " · " + task.wrappedValue.dueDate)
                    .font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
            }
            Spacer()
            if task.wrappedValue.isRecurring {
                Image(systemName: "arrow.clockwise").font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
            }
            Button {
                postJobPrefill = PostJobPrefill(
                    title: task.wrappedValue.title,
                    description: "Home care task: \(task.wrappedValue.title) (\(task.wrappedValue.category))",
                    category: "Handyman",
                    urgency: "medium"
                )
            } label: {
                Image(systemName: "arrow.up.right.circle")
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.accent)
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct AddHomeTaskView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var category = "General"
    @State private var recurring = false
    @State private var dueDate = formattedToday()
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                OxTextField(title: "Task", text: $title)
                OxTextField(title: "Category", text: $category)
                OxTextField(title: "Due Date (YYYY-MM-DD)", text: $dueDate)
                Toggle("Recurring", isOn: $recurring).foregroundStyle(Theme.textPrimary)
                if let err = life.lastError {
                    Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                }
                Button {
                    Task { await save() }
                } label: {
                    HStack(spacing: 8) {
                        if isSaving { ProgressView().tint(.white) }
                        Text("life.add_task").font(.system(size: 15, weight: .bold))
                    }
                    .foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(title.isEmpty || isSaving)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Add Task").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        if KeychainManager.shared.getAccessToken() != nil {
            if await life.createHomeTask(title: title, category: category, dueDate: dueDate, isRecurring: recurring) {
                dismiss()
            }
        } else {
            lifeData.homeTasks.append(.init(title: title, category: category,
                                            dueDate: dueDate, completed: false, isRecurring: recurring))
            dismiss()
        }
    }
}

// MARK: - Car Care Pillar

struct CarCarePillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @EnvironmentObject private var localization: LocalizationManager
    @State private var showAdd: Bool = false
    @State private var postJobPrefill: PostJobPrefill? = nil
    /// Map of vehicleId → open recall count fetched from NHTSA
    @State private var recallCounts: [UUID: Int] = [:]

    private var isSignedIn: Bool { KeychainManager.shared.getAccessToken() != nil }
    private var displayVehicles: [GarageVehicleDisplay] {
        if isSignedIn, !life.vehicles.isEmpty {
            return life.vehicles.map { GarageVehicleDisplay(vehicle: Self.localVehicle(from: $0), apiVehicle: $0) }
        }
        return lifeData.vehicles.map { GarageVehicleDisplay(vehicle: $0, apiVehicle: nil) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Text("My Garage").sectionTitle().frame(maxWidth: .infinity, alignment: .leading)
                if displayVehicles.isEmpty {
                    Text("No vehicles added yet.").font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(displayVehicles) { item in
                    vehicleCard(item)
                }
                Button { showAdd = true } label: {
                    Label("life.add_vehicle", systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Car Care")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .sheet(isPresented: $showAdd) { AddVehicleView().presentationDetents([.large]) }
        .sheet(item: $postJobPrefill) { pf in
            PostJobView(prefill: pf)
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .task {
            if isSignedIn {
                await lifeData.flushPendingSync(keys: ["vehicles"])
                await life.refresh(section: "car_care")
            }
            await loadRecalls()
        }
    }

    private func vehicleCard(_ item: GarageVehicleDisplay) -> some View {
        let v = item.vehicle
        let oilDue        = v.lastOilChangeMile + 5_000
        let milesUntilOil = oilDue - v.mileage
        let recalls       = recallCounts[v.id] ?? 0
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "car.fill").foregroundStyle(Theme.pillarCar)
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 40, height: 40)
                    .background(Theme.pillarCar.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(v.year) \(v.make) \(v.model)").font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(localization.format("%@ miles", v.mileage.formatted()))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                if !v.vin.isEmpty {
                    Text("VIN ✓").font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.success).padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Theme.success.opacity(0.14), in: Capsule())
                }
            }

            // NHTSA recall alert banner
                if recalls > 0 {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Theme.danger).font(.system(size: 13))
                        Text(localization.format("%d open recall(s) — check nhtsa.gov", recalls))
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.danger)
                    }
                    .padding(10)
                    .background(Theme.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.danger.opacity(0.25), lineWidth: 1))
                }

            Divider().background(Theme.stroke)
            HStack {
                Label(localization.format("Oil change in %@ mi", max(0, milesUntilOil).formatted()),
                      systemImage: "oilcan.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(milesUntilOil < 1_000 ? Theme.danger : Theme.textSecondary)
                Spacer()
                Text(localization.format("Last service: %@", v.lastServiceDate)).font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
            }
            Button {
                postJobPrefill = PostJobPrefill(
                    title: "\(v.year) \(v.make) \(v.model) — Service Needed",
                    description: milesUntilOil < 1_000
                        ? "Oil change due. Current mileage: \(v.mileage.formatted()). Last service: \(v.lastServiceDate)."
                        : "Vehicle service for my \(v.year) \(v.make) \(v.model). Current mileage: \(v.mileage.formatted()).",
                    category: "Handyman",
                    urgency: milesUntilOil < 1_000 ? "high" : "medium"
                )
            } label: {
                Label("life.post_service_job", systemImage: "arrow.up.right.circle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.pillarCar)
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(Theme.pillarCar.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
            }
            if let apiVehicle = item.apiVehicle {
                HStack(spacing: 10) {
                    Button {
                        Task { await life.updateVehicleMileage(apiVehicle, mileage: v.mileage, markOilChanged: true) }
                    } label: {
                        Label("life.log_oil_change", systemImage: "checkmark.seal.fill")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.success)
                            .frame(maxWidth: .infinity).padding(.vertical, 9)
                            .background(Theme.success.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                    }
                    Button {
                        Task { await life.deleteVehicle(apiVehicle) }
                    } label: {
                        Label("common.remove", systemImage: "trash.fill")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity).padding(.vertical, 9)
                            .background(Theme.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
        }
        .cardStyle()
    }

    private func loadRecalls() async {
        for item in displayVehicles where !item.vehicle.make.isEmpty && !item.vehicle.model.isEmpty && !item.vehicle.year.isEmpty {
            let v = item.vehicle
            let count = await NHTSAService.recallCount(make: v.make, model: v.model, year: v.year)
            recallCounts[v.id] = count
        }
    }

    private static func localVehicle(from api: APILifeVehicle) -> Vehicle {
        var vehicle = Vehicle(
            vin: api.vin ?? "",
            year: api.year ?? "",
            make: api.make,
            model: api.model,
            mileage: api.mileage ?? 0,
            lastOilChangeMile: api.last_oil_change_mile ?? 0,
            lastServiceDate: api.last_service_date ?? "—",
            notes: api.notes ?? ""
        )
        if let rawId = api.client_id, let id = UUID(uuidString: rawId) {
            vehicle.id = id
        }
        return vehicle
    }
}

private struct GarageVehicleDisplay: Identifiable {
    let vehicle: Vehicle
    let apiVehicle: APILifeVehicle?
    var id: UUID { vehicle.id }
}

// MARK: - NHTSA Public API

enum NHTSAService {
    struct RecallResponse: Decodable {
        let Count: Int?
        let Message: String?
    }

    struct VINDecodeResult: Decodable {
        let Results: [VINField]?
        struct VINField: Decodable { let Variable: String; let Value: String? }
    }

    /// Returns the number of open NHTSA recalls for a given make/model/year.
    static func recallCount(make: String, model: String, year: String) async -> Int {
        let urlStr = "https://api.nhtsa.gov/recalls/recallsByVehicle?make=\(make)&model=\(model)&modelYear=\(year)"
            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        guard let url = URL(string: urlStr) else { return 0 }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let resp = try JSONDecoder().decode(RecallResponse.self, from: data)
            return resp.Count ?? 0
        } catch { return 0 }
    }

    /// Decodes a VIN and returns (year, make, model) if successful.
    static func decodeVIN(_ vin: String) async -> (year: String, make: String, model: String)? {
        guard vin.count == 17 else { return nil }
        let urlStr = "https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/\(vin)?format=json"
        guard let url = URL(string: urlStr) else { return nil }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let resp = try JSONDecoder().decode(VINDecodeResult.self, from: data)
            let fields = resp.Results ?? []
            func val(_ name: String) -> String {
                fields.first { $0.Variable == name }?.Value ?? ""
            }
            let year  = val("Model Year")
            let make  = val("Make")
            let model = val("Model")
            guard !year.isEmpty, !make.isEmpty, !model.isEmpty else { return nil }
            return (year, make.capitalized, model.capitalized)
        } catch { return nil }
    }
}

private struct AddVehicleView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss

    @State private var vin         = ""
    @State private var year        = ""
    @State private var make        = ""
    @State private var model       = ""
    @State private var mileage     = ""
    @State private var lastOil     = ""
    @State private var lastService = ""
    @State private var isDecoding  = false
    @State private var isSaving    = false
    @State private var decodeError: String?

    private var canSave: Bool { !year.isEmpty && !make.isEmpty && !model.isEmpty }
    private var isSignedIn: Bool { KeychainManager.shared.getAccessToken() != nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    // VIN input with decode button
                    VStack(alignment: .leading, spacing: 6) {
                        Text("VIN (optional)").font(.system(size: 11, weight: .semibold))
                            .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
                        HStack(spacing: 8) {
                            TextField("17-character VIN", text: $vin)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.textPrimary)
                                .padding(10)
                                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                            Button {
                                Task { await decodeVIN() }
                            } label: {
                                if isDecoding {
                                    ProgressView().tint(.white).frame(width: 50, height: 40)
                                } else {
                                    Text("life.decode")
                                        .font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                                        .frame(width: 60, height: 40)
                                }
                            }
                            .background(vin.count == 17 ? Theme.accent : Theme.textTertiary,
                                        in: RoundedRectangle(cornerRadius: 12))
                            .disabled(vin.count != 17 || isDecoding)
                        }
                        if let err = decodeError {
                            Text(err).font(.system(size: 11)).foregroundStyle(Theme.danger)
                        }
                    }

                    if !year.isEmpty {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                            Text(localization.format("Decoded: %@ %@ %@", year, make, model))
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                        }
                    }

                    HStack(spacing: 10) {
                        OxTextField(title: "Year", text: $year, keyboard: .numberPad)
                        OxTextField(title: "Make", text: $make)
                    }
                    OxTextField(title: "Model", text: $model)
                    OxTextField(title: "Current Mileage", text: $mileage, keyboard: .numberPad)
                    OxTextField(title: "Last Oil Change Mile", text: $lastOil, keyboard: .numberPad)
                    OxTextField(title: "Last Service Date (YYYY-MM-DD)", text: $lastService)

                    Button {
                        Task { await saveVehicle() }
                    } label: {
                        if isSaving {
                            ProgressView().tint(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                        } else {
                            Text("life.add_vehicle")
                                .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                        }
                    }
                    .disabled(!canSave || isSaving)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Add Vehicle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func decodeVIN() async {
        isDecoding = true; decodeError = nil
        defer { isDecoding = false }
        guard let result = await NHTSAService.decodeVIN(vin) else {
            decodeError = "VIN not recognised — please enter details manually."
            return
        }
        year  = result.year
        make  = result.make
        model = result.model
    }

    private func saveVehicle() async {
        isSaving = true
        defer { isSaving = false }
        var vehicle = Vehicle(
            vin: vin,
            year: year,
            make: make,
            model: model,
            mileage: Int(mileage) ?? 0,
            lastOilChangeMile: Int(lastOil) ?? 0,
            lastServiceDate: lastService.isEmpty ? "—" : lastService,
            notes: ""
        )

        if isSignedIn {
            let saved = await life.createVehicle(
                clientId: vehicle.id.uuidString,
                vin: vehicle.vin,
                year: vehicle.year,
                make: vehicle.make,
                model: vehicle.model,
                mileage: vehicle.mileage,
                lastOilChangeMile: vehicle.lastOilChangeMile,
                lastServiceDate: vehicle.lastServiceDate,
                notes: vehicle.notes
            )
            if saved != nil {
                lifeData.vehicles.append(vehicle)
                dismiss()
                return
            }
        }

        vehicle.id = UUID()
        lifeData.vehicles.append(vehicle)
        dismiss()
    }
}

// MARK: - Personal Care Pillar

struct PersonalCarePillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @EnvironmentObject private var localization: LocalizationManager

    private var isSignedIn: Bool { KeychainManager.shared.getAccessToken() != nil }
    private var usesServerHabits: Bool { isSignedIn && !life.habits.isEmpty }
    private var displayHabits: [HabitDisplay] {
        if usesServerHabits {
            return life.habits.map { HabitDisplay(habit: Self.localHabit(from: $0), apiHabit: $0) }
        }
        return lifeData.habits.map { HabitDisplay(habit: $0, apiHabit: nil) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                streakSummary
                Text("Daily Habits").sectionTitle().frame(maxWidth: .infinity, alignment: .leading)
                ForEach(displayHabits) { item in
                    HStack(spacing: 14) {
                        Image(systemName: item.habit.icon).font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.pillarPersonal)
                            .frame(width: 38, height: 38)
                            .background(Theme.pillarPersonal.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.habit.name).font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            Text(localization.format("🔥 %d-day streak · %d×/week", item.habit.streak, item.habit.target))
                                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        Button {
                            toggleHabit(item)
                        } label: {
                            Image(systemName: item.habit.completedToday ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 24))
                                .foregroundStyle(item.habit.completedToday ? Theme.success : Theme.textTertiary)
                        }
                    }
                    .cardStyle(padding: 12)
                }
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Personal Care")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .task {
            if isSignedIn {
                await lifeData.flushPendingSync(keys: ["habits"])
                await life.refresh(section: "personal_care")
            }
        }
    }

    private var streakSummary: some View {
        let done = displayHabits.filter(\.habit.completedToday).count
        let total = displayHabits.count
        return VStack(spacing: 6) {
            Text("\(done)/\(total)").font(.system(size: 42, weight: .heavy)).foregroundStyle(Theme.pillarPersonal)
            Text("habits done today").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            ProgressView(value: total > 0 ? Double(done) / Double(total) : 0)
                .progressViewStyle(.linear).tint(Theme.pillarPersonal)
                .padding(.horizontal, 20)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 16).cardStyle()
    }

    private func toggleHabit(_ item: HabitDisplay) {
        if let apiHabit = item.apiHabit {
            Task { await life.toggleHabit(apiHabit) }
            return
        }

        guard let idx = lifeData.habits.firstIndex(where: { $0.id == item.habit.id }) else { return }
        lifeData.habits[idx].completedToday.toggle()
        if lifeData.habits[idx].completedToday {
            lifeData.habits[idx].streak += 1
        } else {
            lifeData.habits[idx].streak = max(0, lifeData.habits[idx].streak - 1)
        }

        if isSignedIn {
            let local = lifeData.habits[idx]
            Task {
                if let backed = await life.ensureHabitBacked(local) {
                    await life.setHabitState(backed, completedToday: local.completedToday, streak: local.streak)
                }
            }
        }
    }

    private static func localHabit(from api: APILifeHabit) -> Habit {
        var habit = Habit(
            name: api.name,
            icon: api.icon ?? "circle.fill",
            streak: api.streak ?? 0,
            completedToday: api.completed_today ?? false,
            target: api.target_days_per_week ?? 1
        )
        if let rawId = api.client_id, let id = UUID(uuidString: rawId) {
            habit.id = id
        }
        return habit
    }
}

private struct HabitDisplay: Identifiable {
    let habit: Habit
    let apiHabit: APILifeHabit?
    var id: UUID { habit.id }
}

// MARK: - Goals Pillar

struct GoalsPillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @State private var showAdd = false

    private var usesServerGoals: Bool { KeychainManager.shared.getAccessToken() != nil && !life.goals.isEmpty }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                ForEach(["short", "mid", "long"], id: \.self) { tier in
                    tierSection(tier)
                }
                Button { showAdd = true } label: {
                    Label("life.add_goal", systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Goals")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .sheet(isPresented: $showAdd) { AddGoalView().presentationDetents([.medium]) }
        .task { await life.refresh() }
    }

    private func tierSection(_ tier: String) -> some View {
        let label: String = tier == "short" ? "Short (0–3 months)" : tier == "mid" ? "Mid (3–12 months)" : "Long (1 year+)"
        let localGoals = lifeData.goals.filter { $0.tier == tier }
        let serverGoals = life.goals.filter { normalizedTier($0.goal_type) == tier }
        return VStack(alignment: .leading, spacing: 10) {
            Text(label).sectionTitle()
            if usesServerGoals {
                if serverGoals.isEmpty {
                    Text("No goals in this range yet.").font(.system(size: 12))
                        .foregroundStyle(Theme.textTertiary).padding(.vertical, 4)
                }
                ForEach(serverGoals) { goal in
                    serverGoalRow(goal)
                }
            } else if localGoals.isEmpty {
                Text("No goals in this range yet.").font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary).padding(.vertical, 4)
            } else {
                ForEach(localGoals) { goal in
                    if let idx = lifeData.goals.firstIndex(where: { $0.id == goal.id }) {
                        localGoalRow(goal: goal, index: idx)
                    }
                }
            }
        }
    }

    private func serverGoalRow(_ goal: APILifeGoal) -> some View {
        let completed = goal.is_completed ?? false
        return HStack(spacing: 12) {
            Button { Task { await life.toggleGoal(goal) } } label: {
                Image(systemName: completed ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(completed ? Theme.success : Theme.textTertiary)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(goal.title).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(completed ? Theme.textTertiary : Theme.textPrimary)
                    .strikethrough(completed)
                if let due = goal.due_date {
                    Text(due).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                }
            }
            Spacer()
            Button(role: .destructive) {
                Task { await life.deleteGoal(goal) }
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.danger)
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private func localGoalRow(goal: Goal, index: Int) -> some View {
        HStack(spacing: 12) {
            Button { Task { await lifeData.toggleGoal(goal.id) } } label: {
                Image(systemName: lifeData.goals[index].completed ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(lifeData.goals[index].completed ? Theme.success : Theme.textTertiary)
            }
            Text(goal.title).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(lifeData.goals[index].completed ? Theme.textTertiary : Theme.textPrimary)
                .strikethrough(lifeData.goals[index].completed)
            Spacer()
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private func normalizedTier(_ value: String?) -> String {
        switch value {
        case "mid", "medium", "medium_term": return "mid"
        case "long", "long_term": return "long"
        default: return "short"
        }
    }
}

private struct AddGoalView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var tier = "short"
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                OxTextField(title: "Goal Title", text: $title)
                Picker(LocalizedStringKey("picker.timeframe"), selection: $tier) {
                    Text("0–3 months").tag("short")
                    Text("3–12 months").tag("mid")
                    Text("1 year+").tag("long")
                }.pickerStyle(.segmented)
                if let err = life.lastError {
                    Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                }
                Button {
                    Task { await save() }
                } label: {
                    HStack(spacing: 8) {
                        if isSaving { ProgressView().tint(.white) }
                            Text("life.add_goal").font(.system(size: 15, weight: .bold))
                    }
                    .foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(title.isEmpty || isSaving)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Add Goal").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        if KeychainManager.shared.getAccessToken() != nil {
            if await life.createGoal(title: title, tier: tier) {
                dismiss()
            }
        } else {
            await lifeData.addGoal(title: title, tier: tier)
            dismiss()
        }
    }
}

// MARK: - Sinking Funds Pillar

struct SinkingFundsPillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @EnvironmentObject private var localization: LocalizationManager
    @State private var showAdd = false

    private var usesServerFunds: Bool { KeychainManager.shared.getAccessToken() != nil && !life.sinkingFunds.isEmpty }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if usesServerFunds {
                    ForEach(life.sinkingFunds) { fund in
                        serverFundCard(fund)
                    }
                } else {
                    ForEach($lifeData.sinkingFunds) { $fund in
                        fundCard($fund)
                    }
                }
                Button { showAdd = true } label: {
                    Label("life.add_fund", systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Sinking Funds")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .sheet(isPresented: $showAdd) { AddSinkingFundView().presentationDetents([.large]) }
        .task { await life.refresh() }
    }

    private func serverFundCard(_ fund: APILifeSinkingFund) -> some View {
        let target = fund.target_amount ?? 0
        let saved = fund.saved_amount ?? 0
        let progress = fund.progress
        let color = statusColor(progress)
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: fund.icon ?? "banknote.fill").foregroundStyle(Theme.pillarSinking)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 36, height: 36)
                    .background(Theme.pillarSinking.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(fund.name).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                    Text(localization.format("Target: %@", fund.target_date ?? "Not set")).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                }
                Spacer()
                Text("\(localization.formatCurrency(saved, fractionDigits: 0)) / \(localization.formatCurrency(target, fractionDigits: 0))")
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(color)
            }
            ProgressView(value: progress).progressViewStyle(.linear).tint(color)

            let perPaycheck = perPaycheckAmount(targetAmount: target, savedAmount: saved, targetDate: fund.target_date, paycheckInterval: fund.paycheck_interval)
            Text(localization.format("→ %@ per paycheck", localization.formatCurrency(perPaycheck, fractionDigits: 0)))
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            HStack(spacing: 8) {
                Button {
                    Task { await life.depositToSinkingFund(fund, amount: perPaycheck) }
                } label: {
                        Text("life.deposit").font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(color, in: Capsule())
                }
                Button(role: .destructive) {
                    Task { await life.deleteSinkingFund(fund) }
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.danger)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Theme.danger.opacity(0.12), in: Capsule())
                }
            }
        }
        .cardStyle()
    }

    private func fundCard(_ fund: Binding<SinkingFund>) -> some View {
        let f = fund.wrappedValue
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: f.icon).foregroundStyle(Theme.pillarSinking)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 36, height: 36)
                    .background(Theme.pillarSinking.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(f.name).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                    Text(localization.format("Target: %@", f.targetDate)).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                }
                Spacer()
                Text("\(localization.formatCurrency(f.savedAmount, fractionDigits: 0)) / \(localization.formatCurrency(f.targetAmount, fractionDigits: 0))")
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(f.statusColor)
            }
            ProgressView(value: f.progress).progressViewStyle(.linear).tint(f.statusColor)

            let perPaycheck = perPaycheckAmount(f)
            Text(localization.format("→ %@ per paycheck", localization.formatCurrency(perPaycheck, fractionDigits: 0)))
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            HStack(spacing: 8) {
                Button {
                    Task { await lifeData.depositToSinkingFund(f.id, amount: perPaycheck) }
                } label: {
                    Text("life.deposit").font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(f.statusColor, in: Capsule())
                }
            }
        }
        .cardStyle()
    }

    private func perPaycheckAmount(_ f: SinkingFund) -> Double {
        perPaycheckAmount(targetAmount: f.targetAmount, savedAmount: f.savedAmount, targetDate: f.targetDate, paycheckInterval: f.paycheckInterval)
    }

    private func perPaycheckAmount(targetAmount: Double, savedAmount: Double, targetDate: String?, paycheckInterval: String?) -> Double {
        let remaining = max(0, targetAmount - savedAmount)
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"
        guard let targetDate, let target = formatter.date(from: targetDate) else { return 0 }
        let weeks = max(1, Calendar.current.dateComponents([.weekOfYear], from: Date(), to: target).weekOfYear ?? 1)
        switch paycheckInterval {
        case "weekly":   return remaining / Double(weeks)
        case "monthly":  return remaining / max(1, Double(weeks) / 4.0)
        default:         return remaining / max(1, Double(weeks) / 2.0) // biweekly
        }
    }

    private func statusColor(_ progress: Double) -> Color {
        if progress >= 0.8 { return Theme.success }
        if progress >= 0.5 { return Theme.warning }
        return Theme.danger
    }
}

private struct AddSinkingFundView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject var life: LifeStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""; @State private var target = ""; @State private var saved = "0"
    @State private var date = ""; @State private var interval = "biweekly"
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    OxTextField(title: "Fund Name", text: $name)
                    OxTextField(title: "Target Amount ($)", text: $target, keyboard: .decimalPad)
                    OxTextField(title: "Already Saved ($)", text: $saved, keyboard: .decimalPad)
                    OxTextField(title: "Target Date (YYYY-MM-DD)", text: $date)
                    Picker(LocalizedStringKey("picker.paycheck_frequency"), selection: $interval) {
                        Text("Weekly").tag("weekly")
                        Text("Bi-weekly").tag("biweekly")
                        Text("Monthly").tag("monthly")
                    }.pickerStyle(.segmented).foregroundStyle(Theme.textPrimary)
                    if let err = life.lastError {
                        Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    }
                    Button {
                        Task { await save() }
                    } label: {
                        HStack(spacing: 8) {
                            if isSaving { ProgressView().tint(.white) }
                            Text("life.add_fund").font(.system(size: 15, weight: .bold))
                        }
                        .foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(name.isEmpty || target.isEmpty || date.isEmpty || isSaving)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Add Fund").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let targetAmount = Double(target) ?? 0
        let savedAmount = Double(saved) ?? 0
        if KeychainManager.shared.getAccessToken() != nil {
            if await life.createSinkingFund(name: name,
                                            targetAmount: targetAmount,
                                            savedAmount: savedAmount,
                                            targetDate: date,
                                            paycheckInterval: interval) {
                dismiss()
            }
        } else {
            await lifeData.addSinkingFund(name: name,
                                          targetAmount: targetAmount,
                                          savedAmount: savedAmount,
                                          targetDate: date,
                                          paycheckInterval: interval)
            dismiss()
        }
    }
}

// MARK: - Helpers

func formattedToday() -> String {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
}
