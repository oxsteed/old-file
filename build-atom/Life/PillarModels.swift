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
                case "homeTasks":
                    try await syncHomeTasks()
                    flushed.insert(key)
                case "goals":
                    try await syncGoals()
                    flushed.insert(key)
                default:
                    // Other pillar types (money, vehicles, habits, funds) are local-only for now;
                    // mark them flushed so the badge clears.
                    flushed.insert(key)
                }
            } catch {
                // Leave key in queue; retry on next connectivity event
            }
        }
        pendingKeys.subtract(flushed)
        if flushed.count > 0 { lastSyncedAt = Date() }
    }

    // MARK: - Sync implementations

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

    // MARK: - UserDefaults helpers

    private func loadAll() {
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
