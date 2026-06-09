import SwiftUI
import Network
import Combine
import CloudKit

// MARK: - Shared pillar entry types (local persistence via UserDefaults)

struct MoneyEntry: Codable, Identifiable {
    var id = UUID()
    var source: String
    var amount: Double
    var type: String // "income" | "expense"
    var date: String
}

struct HomeTask: Codable, Identifiable {
    var id = UUID()
    var title: String
    var category: String
    var dueDate: String
    var completed: Bool
    var isRecurring: Bool
}

struct Vehicle: Codable, Identifiable {
    var id = UUID()
    var vin: String          // 17-char VIN; empty string if not entered
    var year: String
    var make: String
    var model: String
    var mileage: Int
    var lastOilChangeMile: Int
    var lastServiceDate: String
    var notes: String

    /// Failable convenience init for legacy records that have no vin field.
    init(vin: String = "", year: String, make: String, model: String,
         mileage: Int, lastOilChangeMile: Int, lastServiceDate: String, notes: String) {
        self.vin = vin
        self.year = year; self.make = make; self.model = model
        self.mileage = mileage; self.lastOilChangeMile = lastOilChangeMile
        self.lastServiceDate = lastServiceDate; self.notes = notes
    }
}

struct Habit: Codable, Identifiable {
    var id = UUID()
    var name: String
    var icon: String
    var streak: Int
    var completedToday: Bool
    var target: Int // days per week
}

struct Goal: Codable, Identifiable {
    var id = UUID()
    var title: String
    var tier: String // "short" | "mid" | "long"
    var completed: Bool
    var linkedFundId: UUID?
}

struct SinkingFund: Codable, Identifiable {
    var id = UUID()
    var name: String
    var targetAmount: Double
    var savedAmount: Double
    var targetDate: String
    var paycheckInterval: String // "weekly" | "biweekly" | "monthly"
    var icon: String
    var color: String

    var progress: Double {
        guard targetAmount > 0 else { return 0 }
        return min(savedAmount / targetAmount, 1.0)
    }
    var statusColor: Color {
        if progress >= 0.8 { return Theme.success }
        if progress >= 0.5 { return Theme.warning }
        return Theme.danger
    }
}

// MARK: - Local store (UserDefaults persistence + offline-resilient sync queue)

@MainActor
final class LifeDataStore: ObservableObject {
    static let shared = LifeDataStore()

    // MARK: Published data
    @Published var moneyEntries: [MoneyEntry] = [] {
        didSet { save("ox.money", moneyEntries); icloudMirror("oxicloud.money", moneyEntries); enqueueSync("money") }
    }
    @Published var homeTasks: [HomeTask] = [] {
        didSet { save("ox.homeTasks", homeTasks); icloudMirror("oxicloud.homeTasks", homeTasks); enqueueSync("homeTasks") }
    }
    @Published var vehicles: [Vehicle] = [] {
        didSet { save("ox.vehicles", vehicles); icloudMirror("oxicloud.vehicles", vehicles); enqueueSync("vehicles") }
    }
    @Published var habits: [Habit] = [] {
        didSet { save("ox.habits", habits); icloudMirror("oxicloud.habits", habits); enqueueSync("habits") }
    }
    @Published var goals: [Goal] = [] {
        didSet { save("ox.goals", goals); icloudMirror("oxicloud.goals", goals); enqueueSync("goals") }
    }
    @Published var sinkingFunds: [SinkingFund] = [] {
        didSet { save("ox.sinkingFunds", sinkingFunds); icloudMirror("oxicloud.funds", sinkingFunds); enqueueSync("sinkingFunds") }
    }

    // MARK: Sync state (observed by UI for badge)
    @Published private(set) var pendingSyncCount: Int = 0
    @Published private(set) var isSyncing: Bool = false
    @Published private(set) var lastSyncedAt: Date? = nil

    // MARK: Private
    private var pendingKeys: Set<String> = [] {
        didSet {
            pendingSyncCount = pendingKeys.count
            UserDefaults.standard.set(Array(pendingKeys), forKey: "ox.pendingSync")
        }
    }
    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "ox.networkMonitor")
    private var isOnline = false
    private var syncTask: Task<Void, Never>?

    /// When true, mutations to the published collections are NOT pushed to the
    /// server. Used during initial local load/seed and during server hydration
    /// so seeded demo data and freshly-downloaded data are never echoed back up.
    private var suppressSync = false
    /// The user id whose Life data has already been hydrated from the server
    /// this session. Prevents repeated hydration and forces a re-pull when a
    /// different account signs in.
    private var hydratedForUserId: String?

    /// iCloud Key-Value Store for cross-device backup.
    /// Used as a secondary mirror: write on every change, restore on first launch on a new device.
    private let icloud = NSUbiquitousKeyValueStore.default

    private init() {
        let saved = UserDefaults.standard.stringArray(forKey: "ox.pendingSync") ?? []
        pendingKeys = Set(saved)
        pendingSyncCount = pendingKeys.count

        loadAll()
        startMonitor()
        startICloudObserver()
    }

    // MARK: - iCloud KV store

    private func startICloudObserver() {
        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: icloud, queue: .main
        ) { [weak self] note in
            guard let self else { return }
            Task { @MainActor in self.mergeFromICloud() }
        }
        icloud.synchronize()
    }

    /// Called when iCloud pushes external changes (e.g. edits from another device).
    @MainActor
    private func mergeFromICloud() {
        // Only replace local data if the iCloud copy is newer
        // (indicated by a stored timestamp key "oxicloud.ts").
        let icloudTs  = icloud.double(forKey: "oxicloud.ts")
        let localTs   = UserDefaults.standard.double(forKey: "ox.localTs")
        guard icloudTs > localTs else { return }

        // Pull each collection from iCloud
        func decode<T: Decodable>(_ key: String, as _: T.Type) -> T? {
            guard let d = icloud.data(forKey: key) else { return nil }
            return try? JSONDecoder().decode(T.self, from: d)
        }
        if let v: [Vehicle]      = decode("oxicloud.vehicles", as: [Vehicle].self) { vehicles = v }
        if let h: [Habit]        = decode("oxicloud.habits",   as: [Habit].self)   { habits   = h }
        if let g: [Goal]         = decode("oxicloud.goals",    as: [Goal].self)    { goals    = g }
        if let f: [SinkingFund]  = decode("oxicloud.funds",    as: [SinkingFund].self) { sinkingFunds = f }
        if let m: [MoneyEntry]   = decode("oxicloud.money",    as: [MoneyEntry].self)  { moneyEntries = m }
        if let t: [HomeTask]     = decode("oxicloud.homeTasks",as: [HomeTask].self)    { homeTasks = t }

        UserDefaults.standard.set(icloudTs, forKey: "ox.localTs")
    }

    /// Mirror a collection to iCloud KV store.
    private func icloudMirror<T: Encodable>(_ key: String, _ value: T) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        // iCloud KV limit: 64 KB per key, 1 MB total. Silently skip if too large.
        guard data.count < 60_000 else { return }
        icloud.set(data, forKey: key)
        icloud.set(Date().timeIntervalSince1970, forKey: "oxicloud.ts")
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "ox.localTs")
        icloud.synchronize()
    }

    // MARK: - Network monitor

    private func startMonitor() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let online = path.status == .satisfied
                if !self.isOnline && online {
                    // Came back online — flush the queue
                    await self.flushPendingSync()
                }
                self.isOnline = online
            }
        }
        monitor.start(queue: monitorQueue)
    }

    // MARK: - Pending sync queue

    private func enqueueSync(_ key: String) {
        guard !suppressSync else { return }
        guard isOnline else {
            pendingKeys.insert(key)
            return
        }
        // Online: flush immediately in background
        Task { await flushPendingSync(keys: [key]) }
    }

    func flushPendingSync(keys: Set<String>? = nil) async {
        let targets = keys ?? pendingKeys
        guard !targets.isEmpty else { return }
        isSyncing = true
        defer { isSyncing = false }

        var flushed: Set<String> = []
        for key in targets {
            do {
                switch key {
                case "money":
                    try await syncMoneyEntries()
                    flushed.insert(key)
                case "homeTasks":
                    try await syncHomeTasks()
                    flushed.insert(key)
                case "vehicles":
                    try await syncVehicles()
                    flushed.insert(key)
                case "habits":
                    try await syncHabits()
                    flushed.insert(key)
                case "goals":
                    try await syncGoals()
                    flushed.insert(key)
                case "sinkingFunds":
                    try await syncSinkingFunds()
                    flushed.insert(key)
                default:
                    break
                }
            } catch {
                // Leave key in queue; retry on next connectivity event
            }
        }
        pendingKeys.subtract(flushed)
        if flushed.count > 0 { lastSyncedAt = Date() }
    }

    // MARK: - Sync implementations

    private func syncMoneyEntries() async throws {
        struct Req: Encodable {
            struct Item: Encodable {
                let client_id: String
                let source: String
                let amount: Double
                let type: String
                let date: String
            }
            let money_entries: [Item]
        }
        let req = Req(money_entries: moneyEntries.map { entry in
            .init(client_id: entry.id.uuidString,
                  source: entry.source,
                  amount: entry.amount,
                  type: entry.type,
                  date: entry.date)
        })
        _ = try await APIClient.shared.request(
            "/api/life/expenses/bulk-upsert",
            method: .POST,
            body: req,
            as: OkResponse.self
        )
    }

    private func syncHomeTasks() async throws {
        // Upsert each local home task via the Life API.
        // We send the full snapshot; the server merges by title + section.
        struct Req: Encodable {
            struct Item: Encodable {
                let title: String
                let section: String
                let is_completed: Bool
                let is_recurring: Bool
                let due_date: String?
            }
            let home_tasks: [Item]
        }
        let req = Req(home_tasks: homeTasks.map { t in
            .init(title: t.title,
                  section: t.category.lowercased(),
                  is_completed: t.completed,
                  is_recurring: t.isRecurring,
                  due_date: t.dueDate)
        })
        _ = try await APIClient.shared.request(
            "/api/life/home-tasks/bulk-upsert",
            method: .POST,
            body: req,
            as: OkResponse.self
        )
    }

    private func syncVehicles() async throws {
        struct Req: Encodable {
            struct Item: Encodable {
                let client_id: String
                let vin: String
                let year: String
                let make: String
                let model: String
                let mileage: Int
                let last_oil_change_mile: Int
                let last_service_date: String
                let notes: String
            }
            let vehicles: [Item]
        }
        let req = Req(vehicles: vehicles.map { vehicle in
            .init(client_id: vehicle.id.uuidString,
                  vin: vehicle.vin,
                  year: vehicle.year,
                  make: vehicle.make,
                  model: vehicle.model,
                  mileage: vehicle.mileage,
                  last_oil_change_mile: vehicle.lastOilChangeMile,
                  last_service_date: vehicle.lastServiceDate == "—" ? "" : vehicle.lastServiceDate,
                  notes: vehicle.notes)
        })
        _ = try await APIClient.shared.request(
            "/api/life/vehicles/bulk-upsert",
            method: .POST,
            body: req,
            as: OkResponse.self
        )
    }

    private func syncHabits() async throws {
        struct Req: Encodable {
            struct Item: Encodable {
                let client_id: String
                let name: String
                let icon: String
                let streak: Int
                let completed_today: Bool
                let target_days_per_week: Int
            }
            let habits: [Item]
        }
        let req = Req(habits: habits.map { habit in
            .init(client_id: habit.id.uuidString,
                  name: habit.name,
                  icon: habit.icon,
                  streak: habit.streak,
                  completed_today: habit.completedToday,
                  target_days_per_week: habit.target)
        })
        _ = try await APIClient.shared.request(
            "/api/life/habits/bulk-upsert",
            method: .POST,
            body: req,
            as: OkResponse.self
        )
    }

    private func syncGoals() async throws {
        struct Req: Encodable {
            struct Item: Encodable { let title: String; let tier: String; let is_completed: Bool }
            let goals: [Item]
        }
        let req = Req(goals: goals.map { g in .init(title: g.title, tier: g.tier, is_completed: g.completed) })
        _ = try await APIClient.shared.request(
            "/api/life/goals/bulk-upsert",
            method: .POST,
            body: req,
            as: OkResponse.self
        )
    }

    private func syncSinkingFunds() async throws {
        struct Req: Encodable {
            struct Item: Encodable {
                let client_id: String
                let name: String
                let target_amount: Double
                let saved_amount: Double
                let target_date: String
                let paycheck_interval: String
                let icon: String
                let color: String
            }
            let sinking_funds: [Item]
        }
        let req = Req(sinking_funds: sinkingFunds.map { f in
            .init(client_id: f.id.uuidString,
                  name: f.name,
                  target_amount: f.targetAmount,
                  saved_amount: f.savedAmount,
                  target_date: f.targetDate,
                  paycheck_interval: f.paycheckInterval,
                  icon: f.icon,
                  color: f.color)
        })
        _ = try await APIClient.shared.request(
            "/api/life/sinking-funds/bulk-upsert",
            method: .POST,
            body: req,
            as: OkResponse.self
        )
    }

    func addGoal(title: String, tier: String) async {
        goals.append(.init(title: title, tier: tier, completed: false, linkedFundId: nil))
        await flushPendingSync(keys: ["goals"])
    }

    func toggleGoal(_ id: UUID) async {
        guard let idx = goals.firstIndex(where: { $0.id == id }) else { return }
        goals[idx].completed.toggle()
        await flushPendingSync(keys: ["goals"])
    }

    func addSinkingFund(name: String, targetAmount: Double, savedAmount: Double, targetDate: String, paycheckInterval: String) async {
        sinkingFunds.append(.init(name: name,
                                  targetAmount: targetAmount,
                                  savedAmount: savedAmount,
                                  targetDate: targetDate,
                                  paycheckInterval: paycheckInterval,
                                  icon: "banknote.fill",
                                  color: "pillarSinking"))
        await flushPendingSync(keys: ["sinkingFunds"])
    }

    func depositToSinkingFund(_ id: UUID, amount: Double) async {
        guard amount > 0, let idx = sinkingFunds.firstIndex(where: { $0.id == id }) else { return }
        sinkingFunds[idx].savedAmount = min(sinkingFunds[idx].targetAmount, sinkingFunds[idx].savedAmount + amount)
        await flushPendingSync(keys: ["sinkingFunds"])
    }

    // MARK: - UserDefaults helpers

    private func loadAll() {
        // Seeds and restored-local assignments must never be pushed to the server.
        suppressSync = true
        defer { suppressSync = false }
        // Prefer local UserDefaults; fall back to iCloud KV (e.g. on a fresh device)
        moneyEntries = load("ox.money", [MoneyEntry].self)
                    ?? icloudLoad("oxicloud.money", [MoneyEntry].self)
                    ?? seedMoney()
        homeTasks    = load("ox.homeTasks", [HomeTask].self)
                    ?? icloudLoad("oxicloud.homeTasks", [HomeTask].self)
                    ?? seedTasks()
        vehicles     = load("ox.vehicles", [Vehicle].self)
                    ?? icloudLoad("oxicloud.vehicles", [Vehicle].self)
                    ?? seedVehicles()
        habits       = load("ox.habits", [Habit].self)
                    ?? icloudLoad("oxicloud.habits", [Habit].self)
                    ?? seedHabits()
        goals        = load("ox.goals", [Goal].self)
                    ?? icloudLoad("oxicloud.goals", [Goal].self)
                    ?? seedGoals()
        sinkingFunds = load("ox.sinkingFunds", [SinkingFund].self)
                    ?? icloudLoad("oxicloud.funds", [SinkingFund].self)
                    ?? seedFunds()
    }

    private func load<T: Decodable>(_ key: String, _ type: T.Type) -> T? {
        guard let d = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: d)
    }
    private func icloudLoad<T: Decodable>(_ key: String, _ type: T.Type) -> T? {
        guard let d = icloud.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: d)
    }
    private func save<T: Encodable>(_ key: String, _ value: T) {
        UserDefaults.standard.set(try? JSONEncoder().encode(value), forKey: key)
    }

    // MARK: - Server hydration (server is the source of truth once signed in)

    /// Pull the signed-in user's Life data from the backend and replace the
    /// local collections. Runs once per user id per launch. Seed/demo data is
    /// only shown to logged-out guests; once a real account is known the server
    /// is authoritative. Assignments run with `suppressSync` enabled so the
    /// downloaded data is never echoed back up to the server.
    func hydrateFromServer(userId: String) async {
        guard hydratedForUserId != userId else { return }

        suppressSync = true
        defer { suppressSync = false }

        var loadedAny = false

        if let resp = try? await LifeService.vehicles() {
            vehicles = resp.vehicles.map { v in
                var veh = Vehicle(vin: v.vin ?? "",
                                  year: v.year ?? "",
                                  make: v.make,
                                  model: v.model,
                                  mileage: v.mileage ?? 0,
                                  lastOilChangeMile: v.last_oil_change_mile ?? 0,
                                  lastServiceDate: v.last_service_date ?? "",
                                  notes: v.notes ?? "")
                if let cid = v.client_id, let uuid = UUID(uuidString: cid) { veh.id = uuid }
                return veh
            }
            loadedAny = true
        }

        if let resp = try? await LifeService.habits() {
            habits = resp.habits.map { h in
                Habit(id: Self.localId(h.client_id),
                      name: h.name,
                      icon: h.icon ?? "star.fill",
                      streak: h.streak ?? 0,
                      completedToday: h.completed_today ?? false,
                      target: h.target_days_per_week ?? 7)
            }
            loadedAny = true
        }

        if let resp = try? await LifeService.sinkingFunds() {
            sinkingFunds = resp.sinking_funds.map { f in
                SinkingFund(id: Self.localId(f.client_id),
                            name: f.name,
                            targetAmount: f.target_amount ?? 0,
                            savedAmount: f.saved_amount ?? 0,
                            targetDate: f.target_date ?? "",
                            paycheckInterval: f.paycheck_interval ?? "monthly",
                            icon: f.icon ?? "banknote.fill",
                            color: f.color ?? "pillarSinking")
            }
            loadedAny = true
        }

        if let resp = try? await LifeService.goals() {
            goals = resp.goals.map { g in
                Goal(title: g.title,
                     tier: Self.normalizedTier(g.goal_type),
                     completed: g.is_completed ?? false,
                     linkedFundId: nil)
            }
            loadedAny = true
        }

        if let resp = try? await LifeService.homeTasks(section: "home", completed: nil) {
            homeTasks = resp.home_tasks.map { t in
                HomeTask(title: t.title,
                         category: t.section ?? "home",
                         dueDate: t.due_date ?? "",
                         completed: t.is_completed ?? false,
                         isRecurring: (t.frequency.map { $0 != "one_time" && !$0.isEmpty }) ?? false)
            }
            loadedAny = true
        }

        if let resp = try? await LifeService.expenses(limit: 200) {
            moneyEntries = resp.expenses.map { e in
                MoneyEntry(id: Self.localId(e.client_id),
                           source: e.description ?? e.category ?? "",
                           amount: e.amount ?? 0,
                           type: e.type ?? "expense",
                           date: e.occurred_at ?? e.created_at ?? "")
            }
            loadedAny = true
        }

        if loadedAny { hydratedForUserId = userId }
    }

    /// Clears the hydration marker so the next signed-in user pulls fresh data
    /// from the server rather than seeing the previous session's records.
    func resetForLogout() {
        hydratedForUserId = nil
    }

    /// Map a server `client_id` back to a stable local UUID, or mint a new one.
    private static func localId(_ clientId: String?) -> UUID {
        if let clientId, let uuid = UUID(uuidString: clientId) { return uuid }
        return UUID()
    }

    /// Normalize a server goal type onto the local tier vocabulary.
    private static func normalizedTier(_ goalType: String?) -> String {
        switch (goalType ?? "").lowercased() {
        case "short", "mid", "long": return (goalType ?? "").lowercased()
        default: return "short"
        }
    }

    // MARK: - Seeds (first-launch data so score is never zero)

    private func seedMoney() -> [MoneyEntry] {
        [.init(source: "Salary", amount: 3400, type: "income", date: "2026-05-01"),
         .init(source: "Side job", amount: 280, type: "income", date: "2026-05-15"),
         .init(source: "Rent", amount: 1200, type: "expense", date: "2026-05-01"),
         .init(source: "Groceries", amount: 320, type: "expense", date: "2026-05-10")]
    }
    private func seedTasks() -> [HomeTask] {
        [.init(title: "Replace HVAC filter", category: "HVAC", dueDate: "2026-05-30", completed: false, isRecurring: true),
         .init(title: "Test smoke detectors", category: "Safety", dueDate: "2026-06-15", completed: false, isRecurring: true),
         .init(title: "Deep clean gutters", category: "Exterior", dueDate: "2026-07-01", completed: false, isRecurring: false)]
    }
    private func seedVehicles() -> [Vehicle] {
        [.init(vin: "", year: "2019", make: "Honda", model: "Accord",
               mileage: 62400, lastOilChangeMile: 59000, lastServiceDate: "2026-01-12", notes: "")]
    }
    private func seedHabits() -> [Habit] {
        [.init(name: "Exercise", icon: "figure.run", streak: 4, completedToday: false, target: 5),
         .init(name: "Meal prep", icon: "fork.knife", streak: 2, completedToday: false, target: 3),
         .init(name: "8 hrs sleep", icon: "moon.fill", streak: 6, completedToday: true, target: 7)]
    }
    private func seedGoals() -> [Goal] {
        [.init(title: "Finish HVAC certification", tier: "short", completed: false, linkedFundId: nil),
         .init(title: "Build 3-month emergency fund", tier: "mid", completed: false, linkedFundId: nil),
         .init(title: "Own rental property", tier: "long", completed: false, linkedFundId: nil)]
    }
    private func seedFunds() -> [SinkingFund] {
        [.init(name: "Christmas gifts", targetAmount: 600, savedAmount: 230, targetDate: "2026-12-01", paycheckInterval: "biweekly", icon: "gift.fill", color: "pillarSinking"),
         .init(name: "Car registration", targetAmount: 280, savedAmount: 180, targetDate: "2026-09-15", paycheckInterval: "biweekly", icon: "car.fill", color: "pillarCar"),
         .init(name: "Vacation", targetAmount: 1500, savedAmount: 340, targetDate: "2027-03-01", paycheckInterval: "biweekly", icon: "airplane", color: "pillarGoals")]
    }
}
