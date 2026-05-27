import SwiftUI
import PhotosUI

// MARK: - Money Pillar

struct MoneyPillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @State private var showAdd = false
    @State private var addType = "income"

    private var income: Double { lifeData.moneyEntries.filter { $0.type == "income" }.map(\.amount).reduce(0, +) }
    private var expenses: Double { lifeData.moneyEntries.filter { $0.type == "expense" }.map(\.amount).reduce(0, +) }
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
        .toolbarColorScheme(.dark, for: .navigationBar)
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

    private func currencyStr(_ v: Double) -> String { String(format: "$%.0f", abs(v)) }
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
    @Environment(\.dismiss) private var dismiss
    @State private var source = ""
    @State private var amount = ""
    @State private var type = "income"

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Picker("Type", selection: $type) {
                    Text("Income").tag("income"); Text("Expense").tag("expense")
                }.pickerStyle(.segmented)
                OxTextField(title: "Description", text: $source)
                OxTextField(title: "Amount ($)", text: $amount, keyboard: .decimalPad)
                Button {
                    lifeData.moneyEntries.append(
                        .init(source: source, amount: Double(amount) ?? 0, type: type,
                              date: formattedToday()))
                    dismiss()
                } label: {
                    Text("Add Entry").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(source.isEmpty || amount.isEmpty)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Add Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

// MARK: - Home Care Pillar

struct HomeCarePillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @State private var showAdd = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Seasonal Tasks").sectionTitle()
                    ForEach($lifeData.homeTasks) { $task in
                        HStack(spacing: 12) {
                            Button {
                                task.completed.toggle()
                            } label: {
                                Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 20))
                                    .foregroundStyle(task.completed ? Theme.success : Theme.textTertiary)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(task.title).font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(task.completed ? Theme.textTertiary : Theme.textPrimary)
                                    .strikethrough(task.completed)
                                Text(task.category + " · " + task.dueDate)
                                    .font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                            }
                            Spacer()
                            if task.isRecurring {
                                Image(systemName: "arrow.clockwise").font(.system(size: 11))
                                    .foregroundStyle(Theme.textTertiary)
                            }
                        }
                        .padding(12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                    }
                }

                Button {
                    showAdd = true
                } label: {
                    Label("Add Task", systemImage: "plus")
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
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(isPresented: $showAdd) { AddHomeTaskView().presentationDetents([.medium]) }
    }
}

private struct AddHomeTaskView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var category = "General"
    @State private var recurring = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                OxTextField(title: "Task", text: $title)
                OxTextField(title: "Category", text: $category)
                Toggle("Recurring", isOn: $recurring).foregroundStyle(Theme.textPrimary)
                Button {
                    lifeData.homeTasks.append(.init(title: title, category: category,
                                                    dueDate: formattedToday(), completed: false, isRecurring: recurring))
                    dismiss()
                } label: {
                    Text("Add Task").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(title.isEmpty)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Add Task").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

// MARK: - Car Care Pillar

struct CarCarePillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @State private var showAdd = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Text("My Garage").sectionTitle().frame(maxWidth: .infinity, alignment: .leading)
                if lifeData.vehicles.isEmpty {
                    Text("No vehicles added yet.").font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(lifeData.vehicles) { v in
                    vehicleCard(v)
                }
                Button { showAdd = true } label: {
                    Label("Add Vehicle", systemImage: "plus")
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
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(isPresented: $showAdd) { AddVehicleView().presentationDetents([.large]) }
    }

    private func vehicleCard(_ v: Vehicle) -> some View {
        let oilDue = v.lastOilChangeMile + 5000
        let milesUntilOil = oilDue - v.mileage
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "car.fill").foregroundStyle(Theme.pillarCar)
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 40, height: 40)
                    .background(Theme.pillarCar.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(v.year) \(v.make) \(v.model)").font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text("\(v.mileage.formatted()) miles").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
            }
            Divider().background(Theme.stroke)
            HStack {
                Label("Oil change in \(max(0, milesUntilOil).formatted()) mi",
                      systemImage: "oilcan.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(milesUntilOil < 1000 ? Theme.danger : Theme.textSecondary)
                Spacer()
                Text("Last service: \(v.lastServiceDate)").font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .cardStyle()
    }
}

private struct AddVehicleView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @Environment(\.dismiss) private var dismiss
    @State private var year = ""; @State private var make = ""; @State private var model = ""
    @State private var mileage = ""; @State private var lastOil = ""; @State private var lastService = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    HStack(spacing: 10) {
                        OxTextField(title: "Year", text: $year, keyboard: .numberPad)
                        OxTextField(title: "Make", text: $make)
                    }
                    OxTextField(title: "Model", text: $model)
                    OxTextField(title: "Current Mileage", text: $mileage, keyboard: .numberPad)
                    OxTextField(title: "Last Oil Change Mile", text: $lastOil, keyboard: .numberPad)
                    OxTextField(title: "Last Service Date (YYYY-MM-DD)", text: $lastService)
                    Button {
                        lifeData.vehicles.append(.init(year: year, make: make, model: model,
                                                       mileage: Int(mileage) ?? 0,
                                                       lastOilChangeMile: Int(lastOil) ?? 0,
                                                       lastServiceDate: lastService, notes: ""))
                        dismiss()
                    } label: {
                        Text("Add Vehicle").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(year.isEmpty || make.isEmpty || model.isEmpty)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Add Vehicle").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

// MARK: - Personal Care Pillar

struct PersonalCarePillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                streakSummary
                Text("Daily Habits").sectionTitle().frame(maxWidth: .infinity, alignment: .leading)
                ForEach($lifeData.habits) { $habit in
                    HStack(spacing: 14) {
                        Image(systemName: habit.icon).font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.pillarPersonal)
                            .frame(width: 38, height: 38)
                            .background(Theme.pillarPersonal.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(habit.name).font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            Text("🔥 \(habit.streak)-day streak · \(habit.target)×/week")
                                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        Button {
                            habit.completedToday.toggle()
                            if habit.completedToday { habit.streak += 1 }
                            else { habit.streak = max(0, habit.streak - 1) }
                        } label: {
                            Image(systemName: habit.completedToday ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 24))
                                .foregroundStyle(habit.completedToday ? Theme.success : Theme.textTertiary)
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
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private var streakSummary: some View {
        let done = lifeData.habits.filter(\.completedToday).count
        let total = lifeData.habits.count
        return VStack(spacing: 6) {
            Text("\(done)/\(total)").font(.system(size: 42, weight: .heavy)).foregroundStyle(Theme.pillarPersonal)
            Text("habits done today").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            ProgressView(value: total > 0 ? Double(done) / Double(total) : 0)
                .progressViewStyle(.linear).tint(Theme.pillarPersonal)
                .padding(.horizontal, 20)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 16).cardStyle()
    }
}

// MARK: - Goals Pillar

struct GoalsPillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @State private var showAdd = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                ForEach(["short", "mid", "long"], id: \.self) { tier in
                    tierSection(tier)
                }
                Button { showAdd = true } label: {
                    Label("Add Goal", systemImage: "plus")
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
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(isPresented: $showAdd) { AddGoalView().presentationDetents([.medium]) }
    }

    private func tierSection(_ tier: String) -> some View {
        let label: String = tier == "short" ? "Short (0–3 months)" : tier == "mid" ? "Mid (3–12 months)" : "Long (1 year+)"
        let goals = lifeData.goals.filter { $0.tier == tier }
        return VStack(alignment: .leading, spacing: 10) {
            Text(label).sectionTitle()
            if goals.isEmpty {
                Text("No goals in this range yet.").font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary).padding(.vertical, 4)
            }
            ForEach(goals) { goal in
                if let idx = lifeData.goals.firstIndex(where: { $0.id == goal.id }) {
                    HStack(spacing: 12) {
                        Button { lifeData.goals[idx].completed.toggle() } label: {
                            Image(systemName: lifeData.goals[idx].completed ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 20))
                                .foregroundStyle(lifeData.goals[idx].completed ? Theme.success : Theme.textTertiary)
                        }
                        Text(goal.title).font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(lifeData.goals[idx].completed ? Theme.textTertiary : Theme.textPrimary)
                            .strikethrough(lifeData.goals[idx].completed)
                        Spacer()
                    }
                    .padding(12)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                }
            }
        }
    }
}

private struct AddGoalView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var tier = "short"

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                OxTextField(title: "Goal Title", text: $title)
                Picker("Timeframe", selection: $tier) {
                    Text("0–3 months").tag("short")
                    Text("3–12 months").tag("mid")
                    Text("1 year+").tag("long")
                }.pickerStyle(.segmented)
                Button {
                    lifeData.goals.append(.init(title: title, tier: tier, completed: false, linkedFundId: nil))
                    dismiss()
                } label: {
                    Text("Add Goal").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(title.isEmpty)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Add Goal").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

// MARK: - Sinking Funds Pillar

struct SinkingFundsPillarView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @State private var showAdd = false

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                ForEach($lifeData.sinkingFunds) { $fund in
                    fundCard($fund)
                }
                Button { showAdd = true } label: {
                    Label("Add Fund", systemImage: "plus")
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
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(isPresented: $showAdd) { AddSinkingFundView().presentationDetents([.large]) }
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
                    Text("Target: \(f.targetDate)").font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                }
                Spacer()
                Text(String(format: "$%.0f / $%.0f", f.savedAmount, f.targetAmount))
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(f.statusColor)
            }
            ProgressView(value: f.progress).progressViewStyle(.linear).tint(f.statusColor)

            let perPaycheck = perPaycheckAmount(f)
            Text("→ \(String(format: "$%.0f", perPaycheck)) per paycheck")
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            HStack(spacing: 8) {
                Button {
                    if let idx = lifeData.sinkingFunds.firstIndex(where: { $0.id == f.id }) {
                        lifeData.sinkingFunds[idx].savedAmount += perPaycheck
                    }
                } label: {
                    Text("+ Deposit").font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(f.statusColor, in: Capsule())
                }
            }
        }
        .cardStyle()
    }

    private func perPaycheckAmount(_ f: SinkingFund) -> Double {
        let remaining = max(0, f.targetAmount - f.savedAmount)
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"
        guard let target = formatter.date(from: f.targetDate) else { return 0 }
        let weeks = max(1, Calendar.current.dateComponents([.weekOfYear], from: Date(), to: target).weekOfYear ?? 1)
        switch f.paycheckInterval {
        case "weekly":   return remaining / Double(weeks)
        case "monthly":  return remaining / max(1, Double(weeks) / 4.0)
        default:         return remaining / max(1, Double(weeks) / 2.0) // biweekly
        }
    }
}

private struct AddSinkingFundView: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""; @State private var target = ""; @State private var saved = "0"
    @State private var date = ""; @State private var interval = "biweekly"

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    OxTextField(title: "Fund Name", text: $name)
                    OxTextField(title: "Target Amount ($)", text: $target, keyboard: .decimalPad)
                    OxTextField(title: "Already Saved ($)", text: $saved, keyboard: .decimalPad)
                    OxTextField(title: "Target Date (YYYY-MM-DD)", text: $date)
                    Picker("Paycheck Frequency", selection: $interval) {
                        Text("Weekly").tag("weekly")
                        Text("Bi-weekly").tag("biweekly")
                        Text("Monthly").tag("monthly")
                    }.pickerStyle(.segmented).foregroundStyle(Theme.textPrimary)
                    Button {
                        lifeData.sinkingFunds.append(.init(name: name,
                                                           targetAmount: Double(target) ?? 0,
                                                           savedAmount: Double(saved) ?? 0,
                                                           targetDate: date, paycheckInterval: interval,
                                                           icon: "banknote.fill", color: "pillarSinking"))
                        dismiss()
                    } label: {
                        Text("Add Fund").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(name.isEmpty || target.isEmpty || date.isEmpty)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Add Fund").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

// MARK: - Helpers

func formattedToday() -> String {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
}
