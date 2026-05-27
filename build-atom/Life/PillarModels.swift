import SwiftUI

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
    var year: String
    var make: String
    var model: String
    var mileage: Int
    var lastOilChangeMile: Int
    var lastServiceDate: String
    var notes: String
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

// MARK: - Local store (UserDefaults persistence)

@MainActor
final class LifeDataStore: ObservableObject {
    static let shared = LifeDataStore()

    @Published var moneyEntries: [MoneyEntry] = [] { didSet { save("ox.money", moneyEntries) } }
    @Published var homeTasks: [HomeTask] = [] { didSet { save("ox.homeTasks", homeTasks) } }
    @Published var vehicles: [Vehicle] = [] { didSet { save("ox.vehicles", vehicles) } }
    @Published var habits: [Habit] = [] { didSet { save("ox.habits", habits) } }
    @Published var goals: [Goal] = [] { didSet { save("ox.goals", goals) } }
    @Published var sinkingFunds: [SinkingFund] = [] { didSet { save("ox.sinkingFunds", sinkingFunds) } }

    private init() { loadAll() }

    private func loadAll() {
        moneyEntries = load("ox.money", [MoneyEntry].self) ?? seedMoney()
        homeTasks    = load("ox.homeTasks", [HomeTask].self) ?? seedTasks()
        vehicles     = load("ox.vehicles", [Vehicle].self)  ?? seedVehicles()
        habits       = load("ox.habits", [Habit].self)       ?? seedHabits()
        goals        = load("ox.goals", [Goal].self)         ?? seedGoals()
        sinkingFunds = load("ox.sinkingFunds", [SinkingFund].self) ?? seedFunds()
    }

    private func load<T: Decodable>(_ key: String, _ type: T.Type) -> T? {
        guard let d = UserDefaults.standard.data(forKey: key) else { return nil }
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
        [.init(year: "2019", make: "Honda", model: "Accord", mileage: 62400, lastOilChangeMile: 59000, lastServiceDate: "2026-01-12", notes: "")]
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
