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
    @EnvironmentObject private var personaStore: PersonaStore
    @State private var showAuthSheet = false
    @State private var section: LifeSection = .home
    // Pulse AI insight
    @State private var pulseInsight: PulseSummaryResult? = nil
    @State private var isLoadingInsight = false

    var body: some View {
        let activePersona = personaStore.active
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    LifeHeader()

                    if auth.user == nil {
                        GuestAuthPromptCard(
                            title: "Save your Life Pulse",
                            subtitle: "Sign in or create an account to keep your Pulse, urgency queue, goals, and funds across devices.",
                            icon: "heart.text.square.fill",
                            color: activePersona.color,
                            action: { showAuthSheet = true }
                        )
                    }

                    LifePulseCard(pulse: life.pulse, summary: life.summary, isLoading: life.isLoading)

                    PersonaLoopNudgeCard(
                        nudge: activePersona.loopNudge(
                            from: "life",
                            businessRole: activePersona == .business ? personaStore.businessSubPersona : nil,
                            calibrationIDs: personaStore.calibrationIDs(for: activePersona),
                            setupSignalIDs: personaStore.setupSignalIDs(for: activePersona)
                        )
                    )

                    if auth.user == nil {
                        LifeGuestPulsePreviewCard(
                            persona: activePersona,
                            businessRole: activePersona == .business ? personaStore.businessSubPersona : nil,
                            calibrationIDs: personaStore.calibrationIDs(for: activePersona),
                            setupSignalIDs: personaStore.setupSignalIDs(for: activePersona),
                            onSavePulse: { showAuthSheet = true }
                        )
                    }

                    if auth.user != nil || OxIntelligenceManager.shared.isAvailable {
                        AskPulseCard(
                            insight: pulseInsight,
                            isLoading: isLoadingInsight,
                            onAsk: { Task { await loadPulseInsight() } }
                        )
                    }

                    LifeUrgencyQueue()
                    LifePersonaFocusCard(
                        persona: activePersona,
                        businessRole: activePersona == .business ? personaStore.businessSubPersona : nil,
                        businessSetupOption: activePersona == .business
                            ? personaStore.businessRoleSetupOption(for: personaStore.businessSubPersona)
                            : nil
                    )

                    if auth.user != nil {
                        // ── First-run explainer: shown when all pillars are empty ──
                        if life.isFirstRun {
                            LifeWelcomeCard()
                        }

                        LifeQuickStats(summary: life.summary, persona: activePersona)
                        LifeMoneyCard(summary: life.expenseSummary)
                        LifeChecklistCard(items: life.checklist,
                                          onToggle: { item in await life.toggleChecklist(item) })
                        LifeTasksCard(section: $section,
                                      tasks: life.homeTasks,
                                      onToggle: { task in await life.toggleHomeTask(task) })
                        if activePersona == .customer {
                            LifeSavedHelpersCard(items: life.savedHelpers)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 96)
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
            if auth.user != nil {
                await life.refresh(window: "1m", section: section.apiValue)
            }
        }
        .onChange(of: section) { _, newValue in
            guard auth.user != nil else { return }
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
        isLoadingInsight = true
        defer { isLoadingInsight = false }
        if auth.user != nil, let backendInsight = try? await LifeService.pulseInsight() {
            pulseInsight = backendInsight
            return
        }
        guard let pulse = life.pulse else { return }
        pulseInsight = try? await PulseSummarizer.summarize(pulse: pulse, summary: life.summary)
    }
}

// MARK: - LifeHeader

private struct LifeHeader: View {
    @EnvironmentObject private var lifeData: LifeDataStore
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(localization.localized(L10n.LifeKey.eyebrow)).sectionTitle()
                Text(localization.localized(L10n.LifeKey.title))
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
    @EnvironmentObject private var localization: LocalizationManager

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
                Text(localization.localized(L10n.LifeKey.pulseLabel))
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

// MARK: - LifeWelcomeCard

/// Shown to new users when no pillar data exists yet.
/// Explains what Pulse is and gives two clear first steps.
private struct LifeWelcomeCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 48, height: 48)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Welcome to Life")
                        .font(.system(size: 17, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text("Your personal operating system")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
            }

            Text("Life tracks six pillars of your daily life and gives you a Pulse score — a single number that reflects how on top of things you are across money, home, car, personal habits, goals, and sinking funds.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 8) {
                welcomeStep(number: "1", icon: "dollarsign.circle.fill", color: Theme.pillarMoney,
                            title: "Add an expense or income",
                            subtitle: "Tap Money to log your first entry.")
                welcomeStep(number: "2", icon: "house.fill", color: Theme.pillarHome,
                            title: "Add a home task",
                            subtitle: "Track repairs, cleaning, or maintenance.")
            }
        }
        .cardStyle()
    }

    private func welcomeStep(number: String, icon: String, color: Color, title: String, subtitle: String) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(color.opacity(0.15)).frame(width: 36, height: 36)
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(color)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                Text(subtitle).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
        }
        .padding(10)
        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

private struct LifeGuestPulsePreviewCard: View {
    let persona: Persona
    var businessRole: BusinessSubPersona?
    var calibrationIDs: Set<String> = []
    var setupSignalIDs: Set<String> = []
    let onSavePulse: () -> Void

    private var previewItems: [LifePreviewItem] {
        switch persona {
        case .customer:
            return customerPreviewItems
        case .helper:
            return [
                .init(pillar: .money, title: "Slow-week reserve", detail: "Start with $25/week", level: 2),
                .init(pillar: .goals, title: "Complete first paid job", detail: "Growth milestone", level: 1),
                .init(pillar: .personal, title: "Protect recovery time", detail: "Pending", level: 1)
            ]
        case .consultant:
            return [
                .init(pillar: .money, title: "Income variability plan", detail: "Watch", level: 2),
                .init(pillar: .goals, title: "Draft first offer package", detail: "Pending", level: 1),
                .init(pillar: .personal, title: "Weekly follow-up habit", detail: "Pending", level: 1)
            ]
        case .investor:
            return [
                .init(pillar: .money, title: "Capital allocation rule", detail: "Pending", level: 1),
                .init(pillar: .goals, title: "Build operator watchlist", detail: "Growth-linked", level: 2),
                .init(pillar: .sinking, title: "Opportunity reserve", detail: "Preview", level: 1)
            ]
        case .business:
            switch businessRole ?? .owner {
            case .owner:
                return [
                    .init(pillar: .money, title: "Payroll cushion", detail: "Watch", level: 2),
                    .init(pillar: .goals, title: "Create first QA checklist", detail: "Pending", level: 1),
                    .init(pillar: .personal, title: "Owner stability routine", detail: "Pending", level: 1)
                ]
            case .manager:
                return [
                    .init(pillar: .goals, title: "Team schedule handoff", detail: "Watch", level: 2),
                    .init(pillar: .home, title: "Quality checklist review", detail: "Pending", level: 1),
                    .init(pillar: .personal, title: "Manager recovery block", detail: "Pending", level: 1)
                ]
            case .representative:
                return [
                    .init(pillar: .goals, title: "Lead follow-up block", detail: "Today", level: 2),
                    .init(pillar: .money, title: "Service agreement target", detail: "Pending", level: 1),
                    .init(pillar: .personal, title: "Outreach rhythm", detail: "Watch", level: 2)
                ]
            case .support:
                return [
                    .init(pillar: .home, title: "Escalation queue review", detail: "Watch", level: 2),
                    .init(pillar: .personal, title: "De-escalation recovery", detail: "Pending", level: 1),
                    .init(pillar: .goals, title: "Update script library", detail: "Pending", level: 1)
                ]
            case .employee:
                return [
                    .init(pillar: .goals, title: "Assigned task checklist", detail: "Today", level: 2),
                    .init(pillar: .personal, title: "Shift readiness routine", detail: "Pending", level: 1),
                    .init(pillar: .home, title: "Complete next SOP", detail: "Watch", level: 2)
                ]
            }
        case .toolOwner:
            return [
                .init(pillar: .sinking, title: "Tool replacement fund", detail: "Pending", level: 1),
                .init(pillar: .home, title: "Condition check before rentals", detail: "Watch", level: 2),
                .init(pillar: .money, title: "Deposit readiness", detail: "Preview", level: 1)
            ]
        case .franchise:
            return [
                .init(pillar: .money, title: "Territory launch reserve", detail: "Watch", level: 2),
                .init(pillar: .goals, title: "Operator onboarding plan", detail: "Pending", level: 1),
                .init(pillar: .personal, title: "Owner cadence", detail: "Pending", level: 1)
            ]
        }
    }

    private var customerPreviewItems: [LifePreviewItem] {
        var items: [LifePreviewItem] = []
        if setupSignalIDs.contains("customer-urgent-car") {
            appendUnique(.init(pillar: .car, title: "2019 Honda Accord oil change", detail: "Overdue", level: 3), to: &items)
        } else if setupSignalIDs.contains("customer-urgent-home") {
            appendUnique(.init(pillar: .home, title: "Replace HVAC filter", detail: "Watch", level: 2), to: &items)
        } else if setupSignalIDs.contains("customer-urgent-money") {
            appendUnique(.init(pillar: .money, title: "Monthly budget check", detail: "Pending", level: 2), to: &items)
        } else if setupSignalIDs.contains("customer-urgent-routines") {
            appendUnique(.init(pillar: .personal, title: "Exercise routine", detail: "2 habits remaining", level: 1), to: &items)
        } else if setupSignalIDs.contains("customer-urgent-ahead") {
            appendUnique(.init(pillar: .sinking, title: "Vacation fund", detail: "23% funded", level: 2), to: &items)
        }
        if calibrationIDs.contains("home-care") || calibrationIDs.isEmpty {
            appendUnique(.init(pillar: .home, title: "Replace HVAC filter", detail: "Watch", level: 2), to: &items)
        }
        if calibrationIDs.contains("car-care") || calibrationIDs.isEmpty {
            appendUnique(.init(pillar: .car, title: "2019 Honda Accord oil change", detail: "Overdue", level: 3), to: &items)
        }
        if calibrationIDs.contains("money") {
            appendUnique(.init(pillar: .money, title: "Monthly budget check", detail: "Pending", level: 1), to: &items)
        }
        if calibrationIDs.contains("goals") || calibrationIDs.isEmpty {
            appendUnique(.init(pillar: .sinking, title: "Vacation fund", detail: "23% funded", level: 2), to: &items)
        }
        if calibrationIDs.contains("personal") {
            appendUnique(.init(pillar: .personal, title: "Exercise routine", detail: "2 habits remaining", level: 1), to: &items)
        }
        if calibrationIDs.contains("hire-help") {
            appendUnique(.init(pillar: .home, title: "Compare helper options", detail: "Home-linked", level: 2), to: &items)
        }
        let fallback: [LifePreviewItem] = [
            .init(pillar: .home, title: "Replace HVAC filter", detail: "Watch", level: 2),
            .init(pillar: .car, title: "2019 Honda Accord oil change", detail: "Overdue", level: 3),
            .init(pillar: .sinking, title: "Vacation fund", detail: "23% funded", level: 2)
        ]
        for item in fallback where items.count < 3 && !items.contains(where: { $0.title == item.title }) {
            items.append(item)
        }
        return Array(items.prefix(3))
    }

    private func appendUnique(_ item: LifePreviewItem, to items: inout [LifePreviewItem]) {
        guard !items.contains(where: { $0.title == item.title }) else { return }
        items.append(item)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                SixSegmentPulseRing(score: 68, pillarScores: [0.58, 0.42, 0.33, 0.64, 0.52, 0.23])
                VStack(alignment: .leading, spacing: 5) {
                    Text(pulsePreviewTitle)
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text("This is demo data. Sign in only when you want to make the Pulse yours and keep progress across devices.")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(spacing: 8) {
                ForEach(previewItems) { item in
                    VStack(alignment: .leading, spacing: 9) {
                        HStack(spacing: 11) {
                            Image(systemName: item.pillar.icon)
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(item.pillar.color)
                                .frame(width: 34, height: 34)
                                .background(item.pillar.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title)
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(Theme.textPrimary)
                                    .lineLimit(1)
                                Text(item.detail)
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            Text(item.badge)
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(item.badgeColor)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(item.badgeColor.opacity(0.13), in: Capsule())
                        }

                        if let action = LifeLoopAction(pillar: item.pillar, title: item.title, detail: item.detail) {
                            HStack(spacing: 8) {
                                Button {
                                    action.openLearn()
                                } label: {
                                    lifeLoopActionLabel(title: action.learnTitle, icon: "graduationcap.fill", color: Theme.accent, filled: true)
                                }
                                .buttonStyle(.plain)

                                Button {
                                    action.openSecondary()
                                } label: {
                                    lifeLoopActionLabel(title: action.secondaryTitle, icon: action.secondaryIcon, color: action.secondaryColor, filled: false)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(10)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                }
            }

            HStack(spacing: 10) {
                Button(action: onSavePulse) {
                    Label("Save my Pulse", systemImage: "person.crop.circle.badge.checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(Theme.accent, in: Capsule())
                }
                .buttonStyle(.plain)

                Button {
                    NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "learn"])
                } label: {
                    Label("Learn first", systemImage: "graduationcap.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(Theme.accent.opacity(0.10), in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .cardStyle()
    }

    private func lifeLoopActionLabel(title: String, icon: String, color: Color, filled: Bool) -> some View {
        Label(title, systemImage: icon)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(filled ? .white : color)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(filled ? color : color.opacity(0.09), in: Capsule())
            .overlay(Capsule().strokeBorder(filled ? Color.clear : color.opacity(0.28), lineWidth: 1))
    }

    private var pulsePreviewTitle: String {
        if persona == .business, let businessRole {
            return "\(businessRole.rawValue) Pulse preview"
        }
        return "\(persona.rawValue) Pulse preview"
    }
}

private struct LifePreviewItem: Identifiable {
    let pillar: PillarType
    let title: String
    let detail: String
    let level: Int

    var id: String { "\(pillar.rawValue)-\(title)" }

    var badge: String {
        switch level {
        case 3: return "Critical"
        case 2: return "Watch"
        default: return "Pending"
        }
    }

    var badgeColor: Color {
        switch level {
        case 3: return Theme.danger
        case 2: return Theme.warning
        default: return Theme.accent
        }
    }
}

private struct LifeLoopAction {
    let learnTitle: String
    let learnCategory: String
    let learnQuery: String
    let guideID: String?
    let secondaryTitle: String
    let secondaryIcon: String
    let secondaryColor: Color
    let secondaryTab: String
    let triggersPostJob: Bool

    init?(pillar: PillarType, title: String, detail: String) {
        let signal = "\(title) \(detail)".lowercased()
        switch pillar {
        case .car:
            if signal.contains("oil") || signal.contains("honda") {
                learnTitle = "Learn oil change"
                learnCategory = "car-care"
                learnQuery = "oil"
                guideID = "change-oil"
            } else {
                learnTitle = "Track car care"
                learnCategory = "life"
                learnQuery = "vehicle maintenance"
                guideID = "track-vehicle-maintenance"
            }
            secondaryTitle = "Hire car help"
            secondaryIcon = "plus.circle.fill"
            secondaryColor = Theme.pillarHome
            secondaryTab = "home"
            triggersPostJob = true
        case .home:
            if signal.contains("hvac") || signal.contains("filter") {
                learnTitle = "Learn HVAC filter"
                learnCategory = "hvac"
                learnQuery = "filter"
                guideID = "replace-hvac-filter"
            } else {
                learnTitle = "Home calendar"
                learnCategory = "life"
                learnQuery = "home maintenance"
                guideID = "create-home-maintenance-calendar"
            }
            secondaryTitle = "Post home help"
            secondaryIcon = "plus.circle.fill"
            secondaryColor = Theme.pillarHome
            secondaryTab = "home"
            triggersPostJob = true
        case .money:
            learnTitle = "Build budget"
            learnCategory = "life"
            learnQuery = "budget"
            guideID = "build-monthly-budget"
            secondaryTitle = "Explore earning"
            secondaryIcon = "arrow.up.right.circle.fill"
            secondaryColor = Theme.success
            secondaryTab = "growth"
            triggersPostJob = false
        case .sinking:
            learnTitle = "Plan this need"
            learnCategory = "life"
            learnQuery = "planned needs"
            guideID = "use-planned-needs"
            secondaryTitle = "Open Growth"
            secondaryIcon = "arrow.up.right.circle.fill"
            secondaryColor = Theme.success
            secondaryTab = "growth"
            triggersPostJob = false
        case .personal:
            learnTitle = "Reset routine"
            learnCategory = "life"
            learnQuery = "habit"
            guideID = nil
            secondaryTitle = "Open Growth"
            secondaryIcon = "arrow.up.right.circle.fill"
            secondaryColor = Theme.success
            secondaryTab = "growth"
            triggersPostJob = false
        case .goals:
            learnTitle = "Plan next step"
            learnCategory = "life"
            learnQuery = "planned"
            guideID = "use-planned-needs"
            secondaryTitle = "Open Growth"
            secondaryIcon = "arrow.up.right.circle.fill"
            secondaryColor = Theme.success
            secondaryTab = "growth"
            triggersPostJob = false
        }
    }

    func openLearn() {
        NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": "learn"])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            var info: [String: Any] = [
                "category": learnCategory,
                "query": learnQuery
            ]
            if let guideID {
                info["guideId"] = guideID
            }
            NotificationCenter.default.post(name: .oxOpenLearnCategory, object: nil, userInfo: info)
        }
    }

    func openSecondary() {
        NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": secondaryTab])
        guard triggersPostJob else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            NotificationCenter.default.post(name: .oxIntentTriggerPostJob, object: nil)
        }
    }
}

private struct LifePersonaFocusCard: View {
    let persona: Persona
    var businessRole: BusinessSubPersona?
    var businessSetupOption: BusinessRoleSetupOption?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: displayIcon)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(displayColor)
                    .frame(width: 34, height: 34)
                    .background(displayColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(focusTitle)
                        .font(.system(size: 14, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(focusText)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }

            if persona == .business, let businessRole, let businessSetupOption {
                BusinessRoleSetupSignalRow(
                    label: "Pulse priority",
                    option: businessSetupOption,
                    color: businessRole.color
                )
            }

            VStack(spacing: 8) {
                ForEach(persona.lifeTabActions(for: businessRole)) { action in
                    focusButton(action)
                }
            }
        }
        .cardStyle()
    }

    private var focusText: String {
        switch persona {
        case .customer:
            return "Life keeps urgent home, car, money, and planned-need items close to your next Home action."
        case .helper:
            return "Life emphasizes income consistency, slow-week reserves, health habits, and equipment planning."
        case .consultant:
            return "Life keeps income variability, follow-up routines, and personal capacity visible while you build offers."
        case .investor:
            return "Life keeps capital discipline, goal tracking, and opportunity reserves in view before you commit funds."
        case .business:
            switch businessRole ?? .owner {
            case .owner:
                return "Life keeps owner stability, payroll cushion, and team quality habits connected to operations."
            case .manager:
                return "Life keeps manager capacity, team cadence, and quality habits connected to the schedule."
            case .representative:
                return "Life keeps follow-up rhythm, outreach blocks, and revenue goals from slipping."
            case .support:
                return "Life keeps support energy, escalation cadence, and recovery habits visible."
            case .employee:
                return "Life keeps shift readiness, personal routines, and training progress connected to assigned work."
            }
        case .toolOwner:
            return "Life keeps tool maintenance, deposit readiness, and replacement funds visible while rentals grow."
        case .franchise:
            return "Life keeps territory launch reserves, operator cadence, and compliance routines visible."
        }
    }

    private func focusButton(_ action: PersonaTabAction) -> some View {
        Button {
            guard let tab = action.targetTab else { return }
            NotificationCenter.default.post(name: .oxSwitchTab, object: nil, userInfo: ["tab": tab])
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: action.icon)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(action.color)
                    .frame(width: 30, height: 30)
                    .background(action.color.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 2) {
                    Text(action.title)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(action.subtitle)
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.top, 8)
            }
            .padding(10)
            .background(action.color.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(action.color.opacity(0.18), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(action.targetTab == nil)
    }

    private var focusTitle: String {
        if persona == .business, let businessRole {
            return "\(businessRole.rawValue) Life focus"
        }
        return "\(persona.rawValue) Life focus"
    }

    private var displayIcon: String {
        businessRole?.icon ?? persona.icon
    }

    private var displayColor: Color {
        businessRole?.color ?? persona.color
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

            if pulse == nil || pulse?.no_data == true {
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
                            Text(localization.localized(pulseLabel(for: pulse?.pulse_score)))
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

    private func pulseLabel(for score: Int?) -> String {
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
                    urgencyCard(item)
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
                                title: localization.format("life.urgency.habit_not_done", worst.name),
                                urgencyLabel: localization.formatPlural("plural.habit_remaining", pending.count),
                                level: 1))
        } else {
            result.append(.init(id: 3, pillar: .personal,
                                title: localization.localized("life.urgency.all_habits_complete"),
                                urgencyLabel: localization.localized("life.urgency.perfect_day"),
                                level: 0))
        }

        // 5. Goals — least-progressed active goal
        let active = lifeData.goals.filter { !$0.completed }
        if let g = active.first {
            result.append(.init(id: 4, pillar: .goals,
                                title: g.title,
                                urgencyLabel: localization.format("life.urgency.term_goal", localization.localized(g.tier.capitalized)),
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

    private func urgencyCard(_ item: UrgencyItem) -> some View {
        VStack(alignment: .leading, spacing: 9) {
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
            }

            HStack(spacing: 8) {
                NavigationLink(value: item.pillar) {
                    queueActionLabel(title: "Open \(item.pillar.rawValue.capitalized)", icon: "arrow.right.circle.fill", color: item.pillar.color, filled: false)
                }
                .buttonStyle(.plain)

                if let action = LifeLoopAction(pillar: item.pillar, title: item.title, detail: item.urgencyLabel) {
                    Button {
                        action.openLearn()
                    } label: {
                        queueActionLabel(title: action.learnTitle, icon: "graduationcap.fill", color: Theme.accent, filled: true)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .cardStyle(padding: 12)
    }

    private func queueActionLabel(title: String, icon: String, color: Color, filled: Bool) -> some View {
        Label(title, systemImage: icon)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(filled ? .white : color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(filled ? color : color.opacity(0.08), in: Capsule())
            .overlay(Capsule().strokeBorder(filled ? Color.clear : color.opacity(0.25), lineWidth: 1))
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
    @EnvironmentObject private var localization: LocalizationManager

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
            Text(value.map { localization.formatCurrency($0, fractionDigits: 0) } ?? "—")
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
    @EnvironmentObject private var localization: LocalizationManager

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
                                            Text(localization.localized(urgency.capitalized)).foregroundStyle(Theme.accent)
                                        }
                                    }
                                    .font(.system(size: 11))
                                }
                                Spacer()
                                if let cost = task.estimated_cost {
                                    Text(localization.formatCurrency(cost, fractionDigits: 0))
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
            case .customer:
                statTile("Planned", value: summary?.planned_needs?.active_count.map(String.init), icon: "calendar", color: Theme.pillarSinking)
                statTile("Overdue", value: summary?.home?.overdue.map(String.init), icon: "exclamationmark.triangle.fill", color: Theme.warning)
                statTile("Goals", value: summary?.goals?.active.map(String.init), icon: "target", color: Theme.pillarGoals)
            case .helper:
                statTile("Jobs done", value: summary?.activity?.jobs_completed.map(String.init), icon: "checkmark.seal.fill", color: Theme.success)
                statTile("Active bids", value: summary?.activity?.active_bids.map(String.init), icon: "hand.raised.fill", color: Theme.pillarGoals)
                statTile("Rating", value: summary?.activity?.avg_rating.map { String(format: "%.1f", $0) }, icon: "star.fill", color: Theme.warning)
            case .consultant:
                statTile("Sessions", value: summary?.activity?.active_jobs_posted.map(String.init), icon: "calendar.badge.clock", color: Theme.pillarPersonal)
                statTile("Follow-ups", value: openChecklistCount.map(String.init), icon: "bubble.left.and.bubble.right.fill", color: Theme.accent)
                statTile("Goals", value: summary?.goals?.active.map(String.init), icon: "target", color: Theme.pillarGoals)
            case .investor:
                statTile("Goals", value: summary?.goals?.active.map(String.init), icon: "target", color: Theme.pillarMoney)
                statTile("Funds", value: summary?.planned_needs?.active_count.map(String.init), icon: "banknote.fill", color: Theme.success)
                statTile("Watch", value: openChecklistCount.map(String.init), icon: "eye.fill", color: Theme.accent)
            case .business:
                statTile("Tasks", value: openChecklistCount.map(String.init), icon: "list.bullet.clipboard.fill", color: Theme.pillarGoals)
                statTile("Overdue", value: summary?.home?.overdue.map(String.init), icon: "exclamationmark.triangle.fill", color: Theme.warning)
                statTile("Buffer", value: summary?.planned_needs?.active_count.map(String.init), icon: "banknote.fill", color: Theme.success)
            case .toolOwner:
                statTile("Tools", value: summary?.home?.total_pending.map(String.init), icon: "hammer.fill", color: Theme.pillarCar)
                statTile("Funds", value: summary?.planned_needs?.active_count.map(String.init), icon: "banknote.fill", color: Theme.success)
                statTile("Tasks", value: openChecklistCount.map(String.init), icon: "checklist", color: Theme.pillarHome)
            case .franchise:
                statTile("Territory", value: summary?.goals?.active.map(String.init), icon: "map.fill", color: Theme.pillarSinking)
                statTile("Checks", value: openChecklistCount.map(String.init), icon: "checkmark.shield.fill", color: Theme.warning)
                statTile("Buffer", value: summary?.planned_needs?.active_count.map(String.init), icon: "banknote.fill", color: Theme.success)
            }
        }
    }

    private var openChecklistCount: Int? {
        guard let total = summary?.checklist?.total else { return nil }
        return max(0, total - (summary?.checklist?.completed ?? 0))
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
                        Text("life.ask_ai")
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
