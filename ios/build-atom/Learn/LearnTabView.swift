import SwiftUI

struct LearnTabView: View {
    @EnvironmentObject private var learn: LearnStore
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.openURL) private var openURL

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
    @State private var query: String = ""
    @State private var activeCategory: String = "all"
    @State private var selectedGuide: LearnGuide?
    @State private var showAuthSheet = false
    @State private var showSubmitGuide = false
    @State private var showVerifyPrompt = false   // shown when unverified user taps creator banner
    @State private var showVerifyIdentity = false  // launches full VerifyIdentityView from the gate

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                header
                heroCard
                searchBar
                categoryChips

                // Creator upload banner — visible to helpers, business owners, and consultants
                if auth.activePersona == .helper || auth.activePersona == .business || auth.activePersona == .consultant {
                    creatorBanner
                    creatorSubmissionsCard
                }

                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(title: L10n.SectionKey.startHere, actionLabel: nil)
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(recommendedGuides.prefix(4), id: \.id) { g in
                            Button {
                                selectedGuide = g
                            } label: {
                                GuideCard(guide: g, isCompleted: learn.isCompleted(g.id))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(title: L10n.SectionKey.trendingArea, actionLabel: nil)
                    VStack(spacing: 10) {
                        ForEach(trendingGuides.prefix(6), id: \.id) { g in
                            Button {
                                selectedGuide = g
                            } label: {
                                GuideRow(guide: g, isCompleted: learn.isCompleted(g.id), views: guideViews(g.id), completions: guideCompletions(g.id))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Theme.background.ignoresSafeArea())
        .task {
            // Sync progress + badges when entering the tab.
            await learn.refresh()
        }
        .sheet(item: $selectedGuide) { g in
            NavigationStack {
                LearnGuideDetailView(
                    guide: g,
                    isCompleted: learn.isCompleted(g.id),
                    canMarkCompleted: auth.user != nil,
                    onRequireAuth: { showAuthSheet = true },
                    onMarkCompleted: {
                        await learn.markCompleted(guideId: g.id, difficulty: g.difficulty)
                    }
                )
            }
            .presentationDetents([.large])
            .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showAuthSheet) {
            AuthLandingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showSubmitGuide) {
            SubmitGuideSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        // Verification gate — shown when unverified helper/business taps creator banner
        .sheet(isPresented: $showVerifyPrompt) {
            NavigationStack {
                VStack(spacing: 24) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(Theme.accent)
                    Text("verify.creator_gate.title")
                        .font(.system(size: 22, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text("verify.creator_gate.message")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                    Button {
                        showVerifyPrompt = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                            showVerifyIdentity = true
                        }
                    } label: {
                        Text("verify.creator_gate.cta")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    Button("common.not_now") { showVerifyPrompt = false }
                        .font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                }
                .padding(28)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("common.close") { showVerifyPrompt = false }.foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showVerifyIdentity) {
            VerifyIdentityView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(localization.localized(L10n.LearnKey.eyebrow)).sectionTitle()
                Text(localization.localized(L10n.LearnKey.title))
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
            }
            Spacer()
        }
    }

    private var heroCard: some View {
        let hero = heroContent(for: auth.activePersona)
        return HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text(localization.localized(hero.eyebrow)).sectionTitle()
                Text(localization.localized(hero.title))
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text(localization.localized(hero.subtitle))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 6) {
                statPill("\(learn.completions.count)", label: "completed")
                statPill("\(learn.badges.count)", label: "badges")
                statPill("\(learn.guides.count)", label: "guides")
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(LinearGradient(colors: [Theme.surface, hero.tint.opacity(0.18)],
                                     startPoint: .leading, endPoint: .trailing))
        )
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private struct HeroContent {
        let eyebrow: String
        let title: String
        let subtitle: String
        let tint: Color
    }

    private func heroContent(for persona: Persona) -> HeroContent {
        let tint: Color = {
            switch persona {
            case .helper:     return Theme.success
            case .business:   return Theme.pillarGoals
            case .investor:   return Theme.pillarMoney
            case .customer:   return Theme.pillarHome
            case .consultant: return Theme.pillarPersonal
            case .toolOwner:  return Theme.pillarCar
            case .franchise:  return Theme.pillarSinking
            }
        }()
        return .init(
            eyebrow: L10n.LearnKey.Hero.eyebrow(for: persona),
            title:   L10n.LearnKey.Hero.title(for: persona),
            subtitle: L10n.LearnKey.Hero.subtitle(for: persona),
            tint: tint
        )
    }

    private func statPill(_ value: String, label: String) -> some View {
        HStack(spacing: 8) {
            Text(value)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .frame(minWidth: 28)
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
        }
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.textTertiary)
            TextField("", text: $query, prompt: Text(localization.localized(L10n.LearnKey.searchPlaceholder)))
                .font(.system(size: 13))
                .foregroundStyle(Theme.textPrimary)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
        }
        .padding(.horizontal, 14).padding(.vertical, 14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(categories, id: \.id) { c in
                    let isOn = activeCategory == c.id
                    Button {
                        activeCategory = c.id
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: c.icon)
                                .font(.system(size: 12, weight: .bold))
                            Text(c.labelKey)
                                .font(.system(size: 12, weight: .bold))
                        }
                        .foregroundStyle(isOn ? Theme.textPrimary : Theme.textSecondary)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(isOn ? Theme.accentSoft : Theme.surface, in: Capsule())
                        .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private struct CategoryChip {
        let id: String
        let labelKey: LocalizedStringKey
        let icon: String
    }

    private var categories: [CategoryChip] {
        // Only the icon needs to be hardcoded here; labels come from L10n.
        let knownIcon: [String: String] = [
            "plumbing":    "drop.fill",
            "electrical":  "bolt.fill",
            "carpentry":   "hammer.fill",
            "hvac":        "thermometer.medium",
            "painting":    "paintbrush.fill",
            "car-care":    "car.fill",
            "landscaping": "leaf.fill",
            "maintenance": "wrench.fill",
            "management":  "clipboard.fill",
            "customer":    "house.and.flag.fill",
            "helper":      "wrench.and.screwdriver.fill",
            "logistics":   "shippingbox.fill",
            "consulting":  "person.bubble.fill",
            "tool-rental": "hammer.fill",
            "franchise":   "building.2.fill",
            "life":        "heart.fill",
            "business":    "briefcase.fill",
            "sales":       "person.2.fill",
            "support":     "headphones",
        ]

        let cats = Set(learn.guides.map(\.category))
        let chips = cats
            .sorted()
            .map { id -> CategoryChip in
                let icon = knownIcon[id] ?? "square.grid.2x2.fill"
                return .init(id: id, labelKey: LearnGuideCategoryL10n.label(for: id), icon: icon)
            }

        return [.init(id: "all", labelKey: "learn.category.all", icon: "square.grid.2x2.fill")] + chips
    }

    private func prettyCategory(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    private var filteredGuides: [LearnGuide] {
        learn.guides.filter { g in
            if activeCategory != "all", g.category != activeCategory { return false }
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return true }
            let q = query.lowercased()
            return g.title.lowercased().contains(q) || g.category.lowercased().contains(q)
        }
    }

    private var recommendedGuides: [LearnGuide] {
        // Prefer unfinished, then rank by persona so the top cards feel relevant.
        let unfinished = filteredGuides.filter { !learn.isCompleted($0.id) }
        let sorted = unfinished.sorted { a, b in
            let ra = personaRank(a, persona: auth.activePersona)
            let rb = personaRank(b, persona: auth.activePersona)
            if ra != rb { return ra > rb }
            return a.title < b.title
        }
        return sorted
    }

    private func personaRank(_ g: LearnGuide, persona: Persona) -> Int {
        var score = g.featured ? 100 : 0

        // Boost guides whose category matches the active persona.
        let personaCategory: String? = switch persona {
        case .customer:    "customer"
        case .helper:      "helper"
        case .investor:    "management"
        case .business:    "business"
        case .consultant:  "consulting"
        case .toolOwner:   "tool-rental"
        case .franchise:   "franchise"
        }
        if let cat = personaCategory, g.category == cat { score += 50 }

        switch persona {
        case .helper:
            // Helpers benefit from higher XP / harder material.
            if g.difficulty == "Hard" { score += 30 }
            else if g.difficulty == "Medium" { score += 22 }
            else { score += 12 }
        case .investor, .business, .consultant, .franchise:
            // Operations-focused personas prefer Medium difficulty actionable guides.
            if g.difficulty == "Medium" { score += 30 }
            else if g.difficulty == "Easy" { score += 20 }
            else { score += 10 }
        default:
            // Customers and others do best with fast wins first.
            if g.difficulty == "Easy" { score += 30 }
            else if g.difficulty == "Medium" { score += 20 }
            else { score += 10 }
        }
        return score
    }

    private var trendingGuides: [LearnGuide] {
        let base = filteredGuides
        let stats = learn.stats?.stats ?? [:]
        return base.sorted { a, b in
            let sa = stats[a.id]?.views ?? 0
            let sb = stats[b.id]?.views ?? 0
            if sa != sb { return sa > sb }
            return a.title < b.title
        }
    }

    private func guideViews(_ id: String) -> Int {
        learn.stats?.stats[id]?.views ?? 0
    }

    private func guideCompletions(_ id: String) -> Int {
        learn.stats?.stats[id]?.completions ?? 0
    }

    // MARK: - Creator banner

    /// True when the signed-in user has passed ID verification (background_check_passed).
    private var isVerifiedCreator: Bool {
        auth.user?.background_check_passed == true
    }

    private var creatorBanner: some View {
        Button {
            if isVerifiedCreator {
                showSubmitGuide = true
            } else {
                showVerifyPrompt = true
            }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "plus.square.on.square")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Theme.pillarGoals)
                VStack(alignment: .leading, spacing: 3) {
                    Text("learn.creator.title")
                        .font(.system(size: 14, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text("learn.creator.subtitle")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(LinearGradient(colors: [Theme.surface, Theme.pillarGoals.opacity(0.12)],
                                         startPoint: .leading, endPoint: .trailing))
            )
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.pillarGoals.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var creatorSubmissionsCard: some View {
        if !learn.submissions.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Creator submissions")
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Spacer()
                    Text("\(learn.submissions.count)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Theme.surfaceElevated, in: Capsule())
                }

                ForEach(learn.submissions.prefix(3)) { submission in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: submissionStatusIcon(submission.status))
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(submissionStatusColor(submission.status))
                            .frame(width: 34, height: 34)
                            .background(submissionStatusColor(submission.status).opacity(0.14), in: RoundedRectangle(cornerRadius: 10))

                        VStack(alignment: .leading, spacing: 3) {
                            Text(submission.title ?? "Guide submission")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                            HStack(spacing: 6) {
                                Text(localization.localized(submission.status?.capitalized ?? "Pending"))
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(submissionStatusColor(submission.status))
                                if let category = submission.category {
                                    Text(LearnGuideCategoryL10n.label(for: category))
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(Theme.textSecondary)
                                }
                            }
                            if let note = submission.reviewer_note, !note.isEmpty {
                                Text(note)
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textSecondary)
                                    .lineLimit(2)
                            }
                        }
                        Spacer()
                    }
                    .padding(10)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .cardStyle(padding: 14)
        }
    }

    private func submissionStatusIcon(_ status: String?) -> String {
        switch status {
        case "approved": return "checkmark.seal.fill"
        case "rejected": return "xmark.octagon.fill"
        case "needs_changes": return "pencil.and.scribble"
        default: return "clock.fill"
        }
    }

    private func submissionStatusColor(_ status: String?) -> Color {
        switch status {
        case "approved": return Theme.success
        case "rejected": return Theme.danger
        case "needs_changes": return Theme.warning
        default: return Theme.accent
        }
    }
}

private struct GuideCard: View {
    let guide: LearnGuide
    let isCompleted: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: style.icon)
                    .foregroundStyle(style.color)
                    .font(.system(size: 14, weight: .bold))
                Text(style.labelKey)
                    .font(.system(size: 10, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(style.color)
                    .textCase(.uppercase)
                Spacer()
                if isCompleted {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.success)
                }
            }
            Text(guide.title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(2)
            Spacer(minLength: 6)
            HStack(spacing: 8) {
                Text(guide.difficulty)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(guide.difficulty == "Hard" ? Theme.danger : guide.difficulty == "Medium" ? Theme.warning : Theme.success)
                Text(verbatim: "•").foregroundStyle(Theme.textTertiary)
                Label("\(guide.minutes) min", systemImage: "clock")
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18)
                .fill(LinearGradient(colors: [style.color.opacity(0.18), Theme.surface],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
        )
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private var style: (labelKey: LocalizedStringKey, icon: String, color: Color) {
        LearnGuideStyle.style(for: guide.category)
    }
}

private struct GuideRow: View {
    let guide: LearnGuide
    let isCompleted: Bool
    let views: Int
    let completions: Int
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: style.icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(style.color)
                .frame(width: 44, height: 44)
                .background(style.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text(guide.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                (Text(style.labelKey) + Text(" • \(guide.minutes) min • ") + Text(LearnGuideDifficultyL10n.label(for: guide.difficulty)) + Text(" • \(views) views"))
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Image(systemName: isCompleted ? "checkmark.circle.fill" : "play.fill")
                .foregroundStyle(isCompleted ? Theme.success : Theme.accent)
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private var style: (labelKey: LocalizedStringKey, icon: String, color: Color) {
        LearnGuideStyle.style(for: guide.category)
    }
}

private enum LearnGuideStyle {
    static func style(for category: String) -> (labelKey: LocalizedStringKey, icon: String, color: Color) {
        switch category {
        case "plumbing":   return ("learn.category.plumbing",   "drop.fill",                Theme.pillarHome)
        case "electrical": return ("learn.category.electrical", "bolt.fill",                Theme.pillarCar)
        case "hvac":       return ("learn.category.hvac",       "thermometer.medium",       Theme.pillarSinking)
        case "carpentry":  return ("learn.category.carpentry",  "hammer.fill",              Theme.pillarGoals)
        case "painting":   return ("learn.category.painting",   "paintbrush.fill",          Theme.pillarPersonal)
        case "car-care":   return ("learn.category.car_care",   "car.fill",                 Theme.pillarCar)
        case "landscaping":return ("learn.category.landscaping","leaf.fill",                Theme.success)
        case "maintenance":return ("learn.category.maintenance","wrench.fill",              Theme.textSecondary)
        case "management": return ("learn.category.management", "clipboard.fill",           Theme.pillarMoney)
        case "customer":   return ("learn.category.customer",   "house.and.flag.fill",      Theme.pillarHome)
        case "helper":     return ("learn.category.helper",     "wrench.and.screwdriver.fill", Theme.accent)
        case "logistics":  return ("learn.category.logistics",  "shippingbox.fill",         Theme.pillarSinking)
        case "consulting": return ("learn.category.consulting", "person.bubble.fill",       Theme.pillarPersonal)
        case "tool-rental":return ("learn.category.tool_rental","hammer.fill",              Theme.pillarCar)
        case "franchise":  return ("learn.category.franchise",  "building.2.fill",          Theme.pillarGoals)
        case "life":       return ("learn.category.life",       "heart.fill",               Theme.danger)
        case "business":   return ("learn.category.business",   "briefcase.fill",           Theme.pillarGoals)
        case "sales":      return ("learn.category.sales",      "person.2.fill",            Theme.success)
        case "support":    return ("learn.category.support",    "headphones",               Theme.accent)
        default:           return ("learn.eyebrow",             "graduationcap.fill",       Theme.accent)
        }
    }
}

private struct LearnGuideDetailView: View {
    let guide: LearnGuide
    let isCompleted: Bool
    let canMarkCompleted: Bool
    let onRequireAuth: () -> Void
    let onMarkCompleted: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var isMarking = false
    @State private var safariURL: URL?   // in-app browser for tool links

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    let style = LearnGuideStyle.style(for: guide.category)
                    Image(systemName: style.icon)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(style.color)
                        .frame(width: 44, height: 44)
                        .background(style.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(guide.title).font(.system(size: 20, weight: .heavy)).foregroundStyle(Theme.textPrimary)
                        (Text(style.labelKey) + Text(" • \(guide.minutes) min • ") + Text(LearnGuideDifficultyL10n.label(for: guide.difficulty)))
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                }

                // ── Video player (if a video URL is present) ─────────────────
                if let rawURL = guide.videoURL, let url = URL(string: rawURL) {
                    GuideVideoPlayerView(url: url)
                }

                if let intro = guide.intro {
                    Text(intro).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                        .cardStyle(padding: 14)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("learn.steps_label").sectionTitle()
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(guide.steps.enumerated()), id: \.offset) { idx, s in
                            HStack(alignment: .top, spacing: 10) {
                                Text("\(idx + 1)")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(.white)
                                    .frame(width: 22, height: 22)
                                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 7))
                                Text(s)
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textPrimary)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }
                        }
                    }
                    .cardStyle(padding: 14)
                }

                if !guide.tools.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("learn.tools_label").sectionTitle()
                        VStack(spacing: 10) {
                            ForEach(guide.tools, id: \.self) { t in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(spacing: 12) {
                                        Image(systemName: "wrench.and.screwdriver.fill")
                                            .foregroundStyle(Theme.textSecondary)
                                            .frame(width: 28)
                                        Text(t.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                                        Spacer()
                                        // Rent — always routes through oxsteed.com tool rentals
                                        if t.resolvedLinkType == .rental, let rent = t.rentURL, let u = URL(string: "https://oxsteed.com\(rent)") {
                                            Button("learn.tool.rent") { safariURL = u }
                                                .font(.system(size: 12, weight: .bold))
                                                .foregroundStyle(Theme.accent)
                                        } else if let rent = t.rentURL, let u = URL(string: "https://oxsteed.com\(rent)") {
                                            Button("learn.tool.rent") { safariURL = u }
                                                .font(.system(size: 12, weight: .bold))
                                                .foregroundStyle(Theme.accent)
                                        }
                                        // Buy / Shop OxSteed — label depends on link type
                                        if let buy = t.buyURL, let u = URL(string: buy) {
                                            Button(t.resolvedLinkType.buyLabel) { safariURL = u }
                                                .font(.system(size: 12, weight: .bold))
                                                .foregroundStyle(
                                                    t.resolvedLinkType == .own_inventory
                                                        ? Theme.accent
                                                        : Theme.textSecondary
                                                )
                                        }
                                    }
                                    // FTC + Amazon required disclosure for affiliate links.
                                    // Amazon policy: disclosure must be "clear and conspicuous"
                                    // near the link. "(paid link)" satisfies both FTC and Amazon.
                                    if t.requiresAffiliateDisclosure && t.buyURL != nil {
                                        Text("learn.paid_link")
                                            .font(.system(size: 10))
                                            .foregroundStyle(Theme.textSecondary.opacity(0.6))
                                            .padding(.leading, 40)
                                    }
                                }
                                .cardStyle(padding: 12)
                            }
                        }
                        // Amazon Associates site-wide disclosure — required by program policy.
                        // Must appear on every page/view that displays Amazon affiliate links.
                        if guide.tools.contains(where: { $0.requiresAffiliateDisclosure && $0.buyURL != nil }) {
                            Text("learn.amazon_disclosure")
                                .font(.system(size: 10))
                                .foregroundStyle(Theme.textSecondary.opacity(0.5))
                                .padding(.top, 2)
                        }
                    }
                }

                Button {
                    if !canMarkCompleted { onRequireAuth(); return }
                    guard !isCompleted, !isMarking else { return }
                    isMarking = true
                    Task {
                        await onMarkCompleted()
                        isMarking = false
                    }
                } label: {
                    Text(!canMarkCompleted ? "learn.sign_in_to_save"
                         : isCompleted ? "learn.completed"
                         : (isMarking ? "learn.marking" : "learn.mark_completed"))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle((isCompleted || !canMarkCompleted) ? Theme.textSecondary : .white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background((isCompleted || !canMarkCompleted) ? Theme.surfaceElevated : Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(isCompleted || isMarking)
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text(LocalizedStringKey(L10n.tab(.learn))))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { dismiss() } label: { Text(LocalizedStringKey(L10n.SettingsKey.done)) }.foregroundStyle(Theme.accent)
            }
        }
        .sheet(item: $safariURL) { url in
            InAppBrowserView(url: url)
        }
        .task {
            // Fire-and-forget view tracking
            await LearnService.recordView(guideId: guide.id)
        }
    }
}

// MARK: - Video Player

import AVKit

/// Inline video player for a guide's companion lesson video.
private struct GuideVideoPlayerView: View {
    let url: URL
    @StateObject private var model: VideoPlayerModel

    init(url: URL) {
        self.url = url
        _model = StateObject(wrappedValue: VideoPlayerModel(url: url))
    }

    var body: some View {
        VideoPlayer(player: model.player)
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
            .onDisappear { model.player.pause() }
    }
}

@MainActor
private final class VideoPlayerModel: ObservableObject {
    let player: AVPlayer
    init(url: URL) {
        player = AVPlayer(url: url)
    }
}

// MARK: - In-App Browser

import SafariServices

/// SFSafariViewController wrapped for SwiftUI sheet presentation.
/// Used for tool Buy/Rent links so users never leave the app.
struct InAppBrowserView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.preferredControlTintColor = UIColor(Theme.accent)
        return vc
    }
    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

// MARK: - Submit Guide Sheet (Creator Upload)

import PhotosUI

/// Allows verified helpers and business owners to propose training content.
/// POSTs to /api/learn/guides/submit — moderated before going live.
struct SubmitGuideSheet: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var learn: LearnStore
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var category = "plumbing"
    @State private var difficulty = "Easy"
    @State private var summary = ""
    @State private var steps = ""       // newline-separated steps
    @State private var toolsNeeded = "" // comma-separated tools
    @State private var mediaURLs: [String] = []
    @State private var videoURL: String?           // uploaded video URL
    @State private var isUploading = false
    @State private var isUploadingVideo = false
    @State private var isSubmitting = false
    @State private var submitted = false
    @State private var error: String?

    // PhotosPicker state for video selection
    @State private var selectedVideoItem: PhotosPickerItem?

    private let categories = ["plumbing","electrical","carpentry","hvac","painting","car-care","landscaping","maintenance","management","customer","helper","logistics","consulting","tool-rental","franchise","life"]
    private let difficulties = ["Easy","Medium","Hard"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if submitted {
                        submittedBanner
                    } else {
                        formBody
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text("learn.submit_guide"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Text(LocalizedStringKey(L10n.CommonKey.cancel)) }.foregroundStyle(Theme.textSecondary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if !submitted {
                        Button {
                            Task { await submitGuide() }
                        } label: {
                            if isSubmitting {
                                ProgressView().tint(Theme.accent)
                            } else {
                                Text("common.submit")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(canSubmit ? Theme.accent : Theme.textTertiary)
                            }
                        }
                        .disabled(!canSubmit || isSubmitting)
                    }
                }
            }
        }
    }

    private var canSubmit: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !steps.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var formBody: some View {
        VStack(spacing: 14) {
            // Title
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("learn.submit.title_label")
                TextField("learn.submit.title_placeholder", text: $title)
                    .fieldStyle()
            }

            // Category + difficulty side by side
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 6) {
                    fieldLabel("learn.submit.category_label")
                    Picker("learn.submit.category_label", selection: $category) {
                        ForEach(categories, id: \.self) { c in
                            Text(LearnGuideCategoryL10n.label(for: c)).tag(c)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10).padding(.vertical, 12)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                }

                VStack(alignment: .leading, spacing: 6) {
                    fieldLabel("learn.submit.difficulty_label")
                    Picker("learn.submit.difficulty_label", selection: $difficulty) {
                        ForEach(difficulties, id: \.self) { d in
                            Text(LearnGuideDifficultyL10n.label(for: d)).tag(d)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }

            // Summary
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("learn.submit.summary_label")
                TextEditor(text: $summary)
                    .scrollContentBackground(.hidden)
                    .frame(height: 70)
                    .padding(8)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                    .foregroundStyle(Theme.textPrimary)
            }

            // Steps
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("learn.submit.steps_label")
                TextEditor(text: $steps)
                    .scrollContentBackground(.hidden)
                    .frame(height: 150)
                    .padding(8)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                    .foregroundStyle(Theme.textPrimary)
            }

            // Tools needed
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("learn.submit.tools_label")
                TextField("learn.submit.tools_placeholder", text: $toolsNeeded)
                    .fieldStyle()
            }

            // Photo / diagram upload
            ImagePickerButton(
                label: "Add Photos / Diagrams",
                purpose: "guide_media",
                uploadedURLs: $mediaURLs,
                isUploading: $isUploading
            )

            // ── Video upload ────────────────────────────────────────────────
            VStack(alignment: .leading, spacing: 8) {
                fieldLabel("learn.video.optional_label")

                if videoURL != nil {
                    HStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(Theme.success)
                        Text("learn.video.uploaded")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        Button("learn.submit.remove_video") { self.videoURL = nil }
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.danger)
                    }
                    .cardStyle(padding: 12)
                } else {
                    PhotosPicker(
                        selection: $selectedVideoItem,
                        matching: .videos,
                        photoLibrary: .shared()
                    ) {
                        HStack(spacing: 10) {
                            if isUploadingVideo {
                                ProgressView().tint(Theme.accent)
                                Text("learn.video.uploading")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.textSecondary)
                            } else {
                                Image(systemName: "video.badge.plus")
                                    .font(.system(size: 18))
                                    .foregroundStyle(Theme.accent)
                                Text("learn.video.choose")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.accent)
                            }
                            Spacer()
                        }
                        .padding(14)
                        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.accent.opacity(0.4), lineWidth: 1.5))
                    }
                    .disabled(isUploadingVideo)
                    .onChange(of: selectedVideoItem) { _, item in
                        guard let item else { return }
                        Task { await uploadVideo(item) }
                    }
                }

                Text("learn.video.tip")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
            }

            if let error {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.danger)
            }

            Text("learn.guide.prepublish_notice")
                .font(.system(size: 11))
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
        }
    }

    private var submittedBanner: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 52))
                .foregroundStyle(Theme.success)
            Text("learn.guide.submitted")
                .font(.system(size: 22, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            Text("learn.guide.review_notice")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button { dismiss() } label: {
                Text("common.done")
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .padding(.top, 40)
    }

    private func submitGuide() async {
        isSubmitting = true
        defer { isSubmitting = false }
        error = nil

        struct Req: Encodable {
            let title: String
            let category: String
            let difficulty: String
            let summary: String
            let steps: [String]
            let tools: [String]
            let media_urls: [String]
            let video_url: String?
        }
        struct Resp: Decodable { let ok: Bool }

        let stepList = steps
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let toolList = toolsNeeded
            .components(separatedBy: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        let body = Req(title: title, category: category, difficulty: difficulty,
                       summary: summary, steps: stepList, tools: toolList,
                       media_urls: mediaURLs, video_url: videoURL)
        do {
            // Client-side moderation check across all text fields
            let combined = [title, summary, steps].joined(separator: " ")
            try await ContentModerator.check(combined, context: "guide_submission")

            _ = try await APIClient.shared.request(
                "/api/learn/guides/submit",
                method: .POST, body: body, as: Resp.self
            )
            await learn.refreshSubmissions()
            withAnimation { submitted = true }
        } catch let modErr as ContentModerator.Error {
            if case .blocked(let reason) = modErr { self.error = reason }
        } catch {
            self.error = "Could not submit guide. Please try again."
        }
    }

    /// Upload a video selected from the Photos library to the OxSteed CDN.
    /// Returns early and sets self.error on failure.
    private func uploadVideo(_ item: PhotosPickerItem) async {
        isUploadingVideo = true
        defer { isUploadingVideo = false }
        error = nil
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                self.error = "Could not load video. Please try again."
                return
            }
            let resp: UploadResponse = try await UploadService.uploadMultipartDecodable(
                path: "/api/upload",
                field: "file",
                data: data,
                filename: "guide_video.mp4",
                mimeType: "video/mp4",
                requiresAuth: true,
                extraFields: ["purpose": "guide_video"],
                as: UploadResponse.self
            )
            self.videoURL = resp.url
        } catch {
            self.error = "Video upload failed. Please try a shorter clip."
        }
    }

    private func fieldLabel(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Theme.textTertiary)
            .textCase(.uppercase)
    }
}

private enum LearnGuideDifficultyL10n {
    static func label(for raw: String) -> LocalizedStringKey {
        switch raw {
        case "Easy": return "learn.difficulty.easy"
        case "Medium": return "learn.difficulty.medium"
        case "Hard": return "learn.difficulty.hard"
        default: return LocalizedStringKey(raw)
        }
    }
}

private enum LearnGuideCategoryL10n {
    static func label(for slug: String) -> LocalizedStringKey {
        switch slug {
        case "plumbing": return "learn.category.plumbing"
        case "electrical": return "learn.category.electrical"
        case "carpentry": return "learn.category.carpentry"
        case "hvac": return "learn.category.hvac"
        case "painting": return "learn.category.painting"
        case "car-care": return "learn.category.car_care"
        case "landscaping": return "learn.category.landscaping"
        case "maintenance": return "learn.category.maintenance"
        case "management": return "learn.category.management"
        case "customer": return "learn.category.customer"
        case "helper": return "learn.category.helper"
        case "logistics": return "learn.category.logistics"
        case "consulting": return "learn.category.consulting"
        case "tool-rental": return "learn.category.tool_rental"
        case "franchise": return "learn.category.franchise"
        case "life": return "learn.category.life"
        case "business": return "learn.category.business"
        case "sales": return "learn.category.sales"
        case "support": return "learn.category.support"
        case "all": return "learn.category.all"
        default: return LocalizedStringKey(slug.capitalized)
        }
    }
}

private extension View {
    func fieldStyle() -> some View {
        self
            .font(.system(size: 14))
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 12).padding(.vertical, 12)
            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}
