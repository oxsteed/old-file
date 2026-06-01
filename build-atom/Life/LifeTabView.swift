import SwiftUI

// MARK: - Pillar type (used for NavigationLink values + urgency queue)

enum PillarType: String, Hashable, CaseIterable {
    case money, home, car, personal, goals, sinking

    var label: LocalizedStringKey {
        switch self {
        case .money:    return "Money"
        case .home:     return "Home Care"
        case .car:      return "Car Care"
        case .personal: return "Personal Care"
        case .goals:    return "Goals"
        case .sinking:  return "Sinking Funds"
        }
    }
    var icon: String {
        switch self {
        case .money:    return "dollarsign.circle.fill"
        case .home:     return "house.fill"
        case .car:      return "car.fill"
        case .personal: return "figure.run"
        case .goals:    return "target"
        case .sinking:  return "banknote.fill"
        }
    }
    var color: Color {
        switch self {
        case .money:    return Theme.pillarMoney
        case .home:     return Theme.pillarHome
        case .car:      return Theme.pillarCar
        case .personal: return Theme.pillarPersonal
        case .goals:    return Theme.pillarGoals
        case .sinking:  return Theme.pillarSinking
        }
    }
    /// Weight used for ring arc sizing (total = 1.0)
    var weight: Double {
        switch self {
        case .money:    return 0.25
        case .home:     return 0.20
        case .car:      return 0.20
        case .personal: return 0.15
        case .goals:    return 0.10
        case .sinking:  return 0.10
        }
    }
}

// MARK: - LifeTabView

struct LifeTabView: View {
    @EnvironmentObject private var life: LifeStore
    @EnvironmentObject private var auth: AuthStore
    @State private var showAuthSheet = false
    @State private var section: LifeSection = .home
    // Pulse AI insight
    @State private var pulseInsight: PulseSummaryResult? = nil
    @State private var isLoadingInsight = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    LifeHeader()
                    if auth.user == nil {
                        VStack(spacing: 12) {
                            EmptyStateCard(icon: "lock.fill",
                                           title: "home.pulse.sign_in_to_view",
                                           message: "Add income, home tasks, or a sinking fund to activate your pulse score.",
                                           cta: L10n.AuthKey.signIn)
                            Button {
                                showAuthSheet = true
                            } label: {
                                Text(L10n.AuthKey.signIn)
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                            }
                            .padding(.horizontal, 4)
                        }
                    } else {
                        let persona = auth.activePersona
                        LifePulseCard(pulse: life.pulse, summary: life.summary, isLoading: life.isLoading)
                        // AI Pulse insight card
                        if OxIntelligenceManager.shared.isAvailable {
                            AskPulseCard(
                                insight: pulseInsight,
                                isLoading: isLoadingInsight,
                                onAsk: { Task { await loadPulseInsight() } }
                            )
                        }
                        LifeUrgencyQueue()
                        LifeQuickStats(summary: life.summary, persona: persona)
                        LifeMoneyCard(summary: life.expenseSummary)
                        LifeChecklistCard(items: life.checklist,
                                          onToggle: { item in await life.toggleChecklist(item) })
                        LifeTasksCard(section: $section,
                                      tasks: life.homeTasks,
                                      onToggle: { task in await life.toggleHomeTask(task) })
                        if persona == .customer {
                            LifeSavedHelpersCard(items: life.savedHelpers)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .background(Theme.background.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            // Navigate to any pillar drill-down by value
            .navigationDestination(for: PillarType.self) { pillar in
                switch pillar {
                case .money:    MoneyPillarView()
                case .home:     HomeCarePillarView()
                case .car:      CarCarePillarView()
                case .personal: PersonalCarePillarView()
                case .goals:    GoalsPillarView()
                case .sinking:  SinkingFundsPillarView()
                }
            }
        }
        .task {
            await life.refresh(window: "1m", section: section.apiValue)
        }
        .onChange(of: section) { _, newValue in
            Task { await life.refresh(window: "1m", section: newValue.apiValue) }
        }
        .sheet(isPresented: $showAuthSheet) {
            AuthLandingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
    }

    private func loadPulseInsight() async {
        guard let pulse = life.pulse else { return }
        isLoadingInsight = true
        defer { isLoadingInsight = false }
        pulseInsight = try? await PulseSummarizer.summarize(
            pulse: pulse,
            summary: life.summary
        )
    }
}

// MARK: - LifeHeader

private struct LifeHeader: View {
    @EnvironmentObject private var lifeData: LifeDataStore
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(L10n.LifeKey.eyebrow).sectionTitle()
                Text(L10n.LifeKey.title)
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
            }
            Spacer()
            if lifeData.isSyncing {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.7).tint(Theme.textSecondary)
                    Text(localization.localized(L10n.LifeKey.syncing)).font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
                .transition(.opacity)
            } else if lifeData.pendingSyncCount > 0 {
                HStack(spacing: 4) {
                    Circle().fill(Theme.warning).frame(width: 6, height: 6)
                    Text("\(lifeData.pendingSyncCount) \(localization.localized(L10n.LifeKey.pending))")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
                .transition(.opacity)
            } else if lifeData.lastSyncedAt != nil {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.success)
                    Text(localization.localized(L10n.LifeKey.saved)).font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: lifeData.isSyncing)
        .animation(.easeInOut(duration: 0.2), value: lifeData.pendingSyncCount)
    }
}

// MARK: - LifeSection (API-backed task sections)

private enum LifeSection: String, CaseIterable, Identifiable {
    case home
    case carCare
    case personalCare

    var id: String { rawValue }
    var label: LocalizedStringKey {
        switch self {
        case .home: return "Home Care"
        case .carCare: return "Car Care"
        case .personalCare: return "Personal Care"
        }
    }
    var apiValue: String {
        switch self {
        case .home: return "home"
        case .carCare: return "car_care"
        case .personalCare: return "personal_care"
        }
    }
    var icon: String {
        switch self {
        case .home: return "house.fill"
        case .carCare: return "car.fill"
        case .personalCare: return "person.fill"
        }
    }
}

// MARK: - Six-Segment Pulse Ring

/// Draws six coloured arcs (one per life pillar), weighted by pillar contribution.
/// Each arc's opacity encodes that pillar's local health (0 = dim, 1 = full).
struct SixSegmentPulseRing: View {
    let score: Int?
    /// Normalised health score per pillar, in PillarType.allCases order (0.0-1.0).
    let pillarScores: [Double]

    private let pillars = PillarType.allCases
    private let lineWidth: CGFloat = 11
    private let gapFraction: Double = 3.0 / 360.0
    private var availableFraction: Double { 1.0 - gapFraction * Double(pillars.count) }

    var body: some View {
        let centerColor = ringColor(for: score)
        ZStack {
            // Background track
            Circle().stroke(Theme.surfaceElevated, lineWidth: lineWidth)

            // Six arcs
            ForEach(Array(pillars.enumerated()), id: \.offset) { i, pillar in
                let (start, end) = arcRange(index: i)
                let health = pillarScores.indices.contains(i) ? pillarScores[i] : 0.5
                Circle()
                    .trim(from: start, to: end)
                    .stroke(
                        pillar.color.opacity(0.18 + health * 0.82),
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .butt)
                    )
                    .rotationEffect(.degrees(-90))
                    .animation(.spring(response: 0.6, dampingFraction: 0.8), value: health)
            }

            // Centre score
            VStack(spacing: 1) {
                Text(score.map(String.init) ?? "—")
                    .font(.system(size: 21, weight: .heavy))
                    .foregroundStyle(centerColor)
                Text(L10n.LifeKey.pulseLabel)
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
                    .tracking(1.2)
            }
        }
        .frame(width: 98, height: 98)
    }

    private func arcRange(index: Int) -> (Double, Double) {
        var start = 0.0
        for i in 0..<index {
            start += pillars[i].weight * availableFraction + gapFraction
        }
        return (start, start + pillars[index].weight * availableFraction)
    }

    private func ringColor(for score: Int?) -> Color {
        guard let s = score else { return Theme.textTertiary }
        if s >= 75 { return Theme.success }
        if s >= 45 { return Theme.warning }
        return Theme.danger
    }
}

// MARK: - LifePulseCard

private struct LifePulseCard: View {
    let pulse: APILifePulse?
    let summary: APILifeDashboardSummary?
    let isLoading: Bool
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject private var localization: LocalizationManager

    /// 0-1 health per pillar, derived from local UserDefaults/iCloud data.
    private var pillarScores: [Double] {
        // Money: how much of income is left after expenses
        let income   = lifeData.moneyEntries.filter { $0.type == "income" }.map(\.amount).reduce(0, +)
        let expenses = lifeData.moneyEntries.filter { $0.type == "expense" }.map(\.amount).reduce(0, +)
        let money    = income > 0 ? min(1, max(0, (income - expenses) / income)) : 0.5

        // Home Care: fraction of tasks completed
        let totalHome = lifeData.homeTasks.count
        let home = totalHome > 0 ? Double(lifeData.homeTasks.filter(\.completed).count) / Double(totalHome) : 0.7

        // Car Care: fraction of vehicles NOT overdue for oil
        let totalCars = lifeData.vehicles.count
        let car = totalCars > 0
            ? Double(lifeData.vehicles.filter { $0.mileage - $0.lastOilChangeMile < 3_000 }.count) / Double(totalCars)
            : 0.7

        // Personal Care: today's habit completion rate
        let totalHabits = lifeData.habits.count
        let personal = totalHabits > 0
            ? Double(lifeData.habits.filter(\.completedToday).count) / Double(totalHabits)
            : 0.6

        // Goals: fraction completed
        let totalGoals = lifeData.goals.count
        let goals = totalGoals > 0
            ? Double(lifeData.goals.filter(\.completed).count) / Double(totalGoals)
            : 0.5

        // Sinking Funds: average progress
        let sinking = lifeData.sinkingFunds.isEmpty ? 0.6
            : lifeData.sinkingFunds.map(\.progress).reduce(0, +) / Double(lifeData.sinkingFunds.count)

        return [money, home, car, personal, goals, sinking]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Life Pulse").sectionTitle()
                Spacer()
                if isLoading {
                    ProgressView().tint(Theme.textTertiary).scaleEffect(0.9)
                }
            }

            if pulse?.no_data == true {
                HStack(spacing: 14) {
                    SixSegmentPulseRing(score: nil, pillarScores: Array(repeating: 0.25, count: 6))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("No data yet")
                            .font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                        Text("Add income, home tasks, or a sinking fund to activate your pulse score.")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                }
            } else {
                HStack(alignment: .top, spacing: 16) {
                    SixSegmentPulseRing(score: pulse?.pulse_score, pillarScores: pillarScores)

                    VStack(alignment: .leading, spacing: 8) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(pulseLabel(for: pulse?.pulse_score))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                            if let net = summary?.finances?.net {
                                Text(localization.format("Net: %@", money(net)))
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(net >= 0 ? Theme.success : Theme.danger)
                            }
                        }

                        // 3×2 pillar navigation chips
                        let pillars = PillarType.allCases
                        VStack(alignment: .leading, spacing: 5) {
                            ForEach([0, 2, 4], id: \.self) { row in
                                HStack(spacing: 5) {
                                    ForEach([row, row + 1], id: \.self) { idx in
                                        if idx < pillars.count {
                                            let p = pillars[idx]
                                            NavigationLink(value: p) {
                                                HStack(spacing: 4) {
                                                    Image(systemName: p.icon)
                                                        .font(.system(size: 9, weight: .bold))
                                                    Text(p.label)
                                                        .font(.system(size: 10, weight: .bold))
                                                }
                                                .foregroundStyle(p.color)
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 5)
                                                .background(p.color.opacity(0.14), in: Capsule())
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Spacer()
                }
            }
        }
        .cardStyle()
    }

    private func pulseLabel(for score: Int?) -> LocalizedStringKey {
        guard let score else { return "—" }
        if score >= 80 { return L10n.LifeKey.onTrack }
        if score >= 60 { return L10n.LifeKey.slipping }
        if score >= 40 { return L10n.LifeKey.critical }
        return L10n.LifeKey.needsAttention
    }

    private func money(_ v: Double) -> String {
        String(format: "%@$%.0f", v < 0 ? "-" : "", abs(v))
    }
}

// MARK: - LifeUrgencyQueue

/// Shows the single most critical item from each of the six life pillars,
/// sorted by urgency level (most critical first). Each row navigates to the pillar.
struct LifeUrgencyQueue: View {
    @EnvironmentObject var lifeData: LifeDataStore
    @EnvironmentObject private var localization: LocalizationManager

    struct UrgencyItem: Identifiable {
        let id: Int
        let pillar: PillarType
        let title: String
        let urgencyLabel: String
        /// 0 = OK, 1 = Pending, 2 = Watch, 3 = Critical
        let level: Int
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: L10n.SectionKey.urgencyQueue, actionLabel: nil)
            VStack(spacing: 8) {
                ForEach(urgencyItems) { item in
                    NavigationLink(value: item.pillar) {
                        urgencyRow(item)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var urgencyItems: [UrgencyItem] {
        var result: [UrgencyItem] = []

        // 1. Money
        let income   = lifeData.moneyEntries.filter { $0.type == "income" }.map(\.amount).reduce(0, +)
        let expenses = lifeData.moneyEntries.filter { $0.type == "expense" }.map(\.amount).reduce(0, +)
        let net      = income - expenses
        result.append(.init(id: 0, pillar: .money,
                            title: net >= 0 ? "Net surplus this month" : "Net deficit this month",
                            urgencyLabel: net >= 0
                                ? String(format: "+$%.0f", net)
                                : String(format: "–$%.0f", abs(net)),
                            level: net >= 0 ? 0 : (net < -500 ? 3 : 2)))

        // 2. Home Care — most overdue task
        let dueTasks = lifeData.homeTasks
            .filter { !$0.completed && !$0.dueDate.isEmpty }
            .sorted { $0.dueDate < $1.dueDate }
        if let first = dueTasks.first {
            result.append(.init(id: 1, pillar: .home,
                                title: first.title,
                                urgencyLabel: localization.format("Due %@", first.dueDate),
                                level: 2))
        } else {
            result.append(.init(id: 1, pillar: .home,
                                title: "All home tasks complete",
                                urgencyLabel: "Great job",
                                level: 0))
        }

        // 3. Car Care — vehicle most overdue for oil change
        if let worst = lifeData.vehicles.max(by: {
            ($0.mileage - $0.lastOilChangeMile) < ($1.mileage - $1.lastOilChangeMile)
        }) {
            let milesSince = worst.mileage - worst.lastOilChangeMile
            let lvl        = milesSince > 4_500 ? 3 : milesSince > 3_000 ? 2 : 0
            result.append(.init(id: 2, pillar: .car,
                                title: "\(worst.year) \(worst.make) \(worst.model)",
                                urgencyLabel: milesSince > 3_000
                                    ? "Oil change overdue"
                                    : "\(5_000 - milesSince) mi until oil change",
                                level: lvl))
        } else {
            result.append(.init(id: 2, pillar: .car,
                                title: "No vehicles added",
                                urgencyLabel: "Tap to add",
                                level: 1))
        }

        // 4. Personal Care — habit not done today with highest target
        let pending = lifeData.habits.filter { !$0.completedToday }
        if let worst = pending.max(by: { $0.target < $1.target }) {
            result.append(.init(id: 3, pillar: .personal,
                                title: "\(worst.name) not done today",
                                urgencyLabel: "\(pending.count) habit\(pending.count == 1 ? "" : "s") remaining",
                                level: 1))
        } else {
            result.append(.init(id: 3, pillar: .personal,
                                title: "All habits complete today",
                                urgencyLabel: "Perfect day",
                                level: 0))
        }

        // 5. Goals — least-progressed active goal
        let active = lifeData.goals.filter { !$0.completed }
        if let g = active.first {
            result.append(.init(id: 4, pillar: .goals,
                                title: g.title,
                                urgencyLabel: g.tier.capitalized + "-term goal",
                                level: 1))
        } else if lifeData.goals.isEmpty {
            result.append(.init(id: 4, pillar: .goals,
                                title: "No goals set",
                                urgencyLabel: "Add one to score",
                                level: 1))
        } else {
            result.append(.init(id: 4, pillar: .goals,
                                title: "All goals achieved",
                                urgencyLabel: "Set new goals",
                                level: 0))
        }

        // 6. Sinking Funds — most behind fund
        if let worst = lifeData.sinkingFunds.min(by: { $0.progress < $1.progress }) {
            let lvl = worst.progress < 0.3 ? 3 : worst.progress < 0.6 ? 2 : 0
            result.append(.init(id: 5, pillar: .sinking,
                                title: worst.name,
                                urgencyLabel: String(format: "%.0f%% funded", worst.progress * 100),
                                level: lvl))
        } else {
            result.append(.init(id: 5, pillar: .sinking,
                                title: "No sinking funds",
                                urgencyLabel: "Add a fund",
                                level: 1))
        }

        return result.sorted { $0.level > $1.level }
    }

    private func urgencyRow(_ item: UrgencyItem) -> some View {
        HStack(spacing: 12) {
            Image(systemName: item.pillar.icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(item.pillar.color)
                .frame(width: 34, height: 34)
                .background(item.pillar.color.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Text(item.urgencyLabel)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()

            urgencyBadge(item.level)

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.textTertiary)
        }
        .cardStyle(padding: 12)
    }

    private func urgencyBadge(_ level: Int) -> some View {
        let (label, color): (String, Color) = switch level {
        case 3:  ("Critical", Theme.danger)
        case 2:  ("Watch",    Theme.warning)
        case 1:  ("Pending",  Theme.accent)
        default: ("OK",       Theme.success)
        }
        return Text(label)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - LifeMoneyCard

private struct LifeMoneyCard: View {
    let summary: APILifeExpenseSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Money", actionLabel: nil)
            HStack(spacing: 12) {
                moneyTile("Income",   value: summary?.total_income,   color: Theme.success, icon: "arrow.down.circle.fill")
                moneyTile("Expenses", value: summary?.total_expenses,  color: Theme.danger,  icon: "arrow.up.circle.fill")
                moneyTile("Net",      value: summary?.net,
                          color: (summary?.net ?? 0) >= 0 ? Theme.success : Theme.danger,
                          icon: "equal.circle.fill")
            }
        }
    }

    private func moneyTile(_ label: String, value: Double?, color: Color, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 34, height: 34)
                .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
            Text(value.map { String(format: "$%.0f", $0) } ?? "—")
                .font(.system(size: 20, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            Text(label).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle(padding: 14)
    }
}

// MARK: - LifeChecklistCard

private struct LifeChecklistCard: View {
    let items: [APILifeChecklistItem]
    let onToggle: (APILifeChecklistItem) async -> Void
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Checklist", actionLabel: nil)
            if items.isEmpty {
                Text("No checklist items yet.")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).padding(.vertical, 6)
            } else {
                VStack(spacing: 10) {
                    ForEach(items.prefix(5)) { item in
                        Button { Task { await onToggle(item) } } label: {
                            HStack(spacing: 12) {
                                Image(systemName: item.is_completed == true ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(item.is_completed == true ? Theme.success : Theme.textTertiary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title)
                                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(2)
                                    if let due = item.due_date, !due.isEmpty {
                                        Text(localization.format("Due %@", due)).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                                    }
                                }
                                Spacer()
                            }
                            .cardStyle(padding: 12)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

// MARK: - LifeTasksCard

private struct LifeTasksCard: View {
    @Binding var section: LifeSection
    let tasks: [APILifeHomeTask]
    let onToggle: (APILifeHomeTask) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Tasks").font(.system(size: 17, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Spacer()
                Picker("", selection: $section) {
                    ForEach(LifeSection.allCases) { s in Label(s.label, systemImage: s.icon).tag(s) }
                }
                .pickerStyle(.menu)
            }

            if tasks.isEmpty {
                Text("No tasks here yet.")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary).padding(.vertical, 6)
            } else {
                VStack(spacing: 10) {
                    ForEach(tasks.prefix(5)) { task in
                        Button { Task { await onToggle(task) } } label: {
                            HStack(spacing: 12) {
                                Image(systemName: task.is_completed == true ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(task.is_completed == true ? Theme.success : Theme.textTertiary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(task.title).font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(Theme.textPrimary).lineLimit(2)
                                    HStack(spacing: 8) {
                                        if let due = task.due_date, !due.isEmpty {
                                            Text(due).foregroundStyle(Theme.textSecondary)
                                        }
                                        if let urgency = task.urgency, !urgency.isEmpty {
                                            Text(urgency.capitalized).foregroundStyle(Theme.accent)
                                        }
                                    }
                                    .font(.system(size: 11))
                                }
                                Spacer()
                                if let cost = task.estimated_cost {
                                    Text(String(format: "$%.0f", cost))
                                        .font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.textSecondary)
                                }
                            }
                            .cardStyle(padding: 12)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

// MARK: - LifeSavedHelpersCard

private struct LifeSavedHelpersCard: View {
    let items: [APILifeSavedHelper]
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Saved helpers", actionLabel: nil)
            if items.isEmpty {
                Text("No saved helpers yet.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary).padding(.vertical, 6)
            } else {
                VStack(spacing: 10) {
                    ForEach(items.prefix(3)) { h in
                        HStack(spacing: 12) {
                            Circle().fill(Theme.accentSoft).frame(width: 40, height: 40)
                                .overlay(Image(systemName: "person.crop.circle.fill").foregroundStyle(Theme.accent))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(h.display_name ?? "Helper")
                                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                                if let bio = h.bio_short, !bio.isEmpty {
                                    Text(bio).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(2)
                                }
                            }
                            Spacer()
                            if let r = h.avg_rating {
                                Text(String(format: "%.1f★", r))
                                    .font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.warning)
                            }
                        }
                        .cardStyle(padding: 12)
                    }
                }
            }
        }
    }
}

// MARK: - LifeQuickStats

private struct LifeQuickStats: View {
    let summary: APILifeDashboardSummary?
    let persona: Persona

    var body: some View {
        HStack(spacing: 12) {
            switch persona {
            case .helper:
                statTile("Jobs done", value: summary?.activity?.jobs_completed.map(String.init), icon: "checkmark.seal.fill", color: Theme.success)
                statTile("Active bids", value: summary?.activity?.active_bids.map(String.init), icon: "hand.raised.fill", color: Theme.pillarGoals)
                statTile("Rating", value: summary?.activity?.avg_rating.map { String(format: "%.1f", $0) }, icon: "star.fill", color: Theme.warning)
            default:
                statTile("Planned", value: summary?.planned_needs?.active_count.map(String.init), icon: "calendar", color: Theme.pillarSinking)
                statTile("Overdue", value: summary?.home?.overdue.map(String.init), icon: "exclamationmark.triangle.fill", color: Theme.warning)
                statTile("Goals", value: summary?.goals?.active.map(String.init), icon: "target", color: Theme.pillarGoals)
            }
        }
    }

    private func statTile(_ label: String, value: String?, icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon).font(.system(size: 14, weight: .bold)).foregroundStyle(color)
                .frame(width: 34, height: 34).background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
            Text(value ?? "—").font(.system(size: 22, weight: .heavy)).foregroundStyle(Theme.textPrimary)
            Text(label).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle(padding: 14)
    }
}

#Preview {
    LifeTabView()
        .environmentObject(LifeStore())
        .environmentObject(AuthStore())
        .environmentObject(LifeDataStore.shared)
}

// MARK: - Ask Pulse Card

private struct AskPulseCard: View {
    let insight: PulseSummaryResult?
    let isLoading: Bool
    let onAsk: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header row
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color.purple)
                    Text("Pulse Insight")
                        .font(.system(size: 12, weight: .bold))
                        .tracking(0.6).foregroundStyle(Color.purple).textCase(.uppercase)
                }
                Spacer()
                if insight == nil && !isLoading {
                    Button(action: onAsk) {
                        Text("Ask AI")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12).padding(.vertical, 5)
                            .background(
                                LinearGradient(
                                    colors: [Color.purple, Color.indigo],
                                    startPoint: .leading, endPoint: .trailing
                                ),
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)
                } else if isLoading {
                    ProgressView().scaleEffect(0.75).tint(Color.purple)
                } else {
                    Button(action: onAsk) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.purple)
                    }
                    .buttonStyle(.plain)
                }
            }

            if isLoading {
                Text("Analysing your Pulse data…")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
            } else if let s = insight {
                // Overview
                Text(s.overview)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textPrimary)

                // Top insight callout
                if !s.topInsight.isEmpty {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "lightbulb.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.warning)
                            .padding(.top, 1)
                        Text(s.topInsight)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                    }
                    .padding(10)
                    .background(Theme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                }

                // Suggestions
                if !s.suggestions.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Suggestions")
                            .font(.system(size: 10, weight: .bold))
                            .tracking(0.8).foregroundStyle(Theme.textTertiary).textCase(.uppercase)
                        ForEach(s.suggestions, id: \.self) { suggestion in
                            HStack(alignment: .top, spacing: 6) {
                                Image(systemName: "arrow.right.circle.fill")
                                    .font(.system(size: 11)).foregroundStyle(Theme.accent)
                                    .padding(.top, 2)
                                Text(suggestion)
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                    }
                }
            } else {
                Text("Get an AI-powered summary of your spending, goals, and financial habits.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .cardStyle()
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(Color.purple.opacity(0.2), lineWidth: 1)
        )
    }
}
