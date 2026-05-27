import SwiftUI

// ─── Drop-in replacement for the TodayView header card ───────────────────────
// Compatible with OxSteedOne's @Observable OneStore + OneTheme

struct OneTodayHeroCard: View {
    @Environment(OneStore.self) private var store
    @State private var showingPersonaPicker = false

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        switch h {
        case 5..<12: return "Good morning"
        case 12..<17: return "Good afternoon"
        case 17..<22: return "Good evening"
        default: return "Hello"
        }
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            heroBackground
            heroContent
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: OneTheme.amber.opacity(0.22), radius: 16, x: 0, y: 8)
        .sheet(isPresented: $showingPersonaPicker) {
            OnePersonaPickerSheet()
                .presentationDetents([.medium, .large])
        }
    }

    private var heroBackground: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.00, green: 0.08, blue: 0.16),
                    Color(red: 0.02, green: 0.14, blue: 0.24)
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            Circle()
                .fill(OneTheme.amber.opacity(0.12))
                .frame(width: 260, height: 260)
                .offset(x: 130, y: -100)
            Circle()
                .fill(OneTheme.amber.opacity(0.06))
                .frame(width: 160, height: 160)
                .offset(x: -100, y: 80)
        }
    }

    private var heroContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            topRow
            greetingBlock
            quickChips
        }
        .padding(18)
    }

    private var topRow: some View {
        HStack {
            OxSteedOneMark(size: 36)
            Text("OxSteed One")
                .font(.caption.weight(.bold))
                .tracking(1.1)
                .foregroundStyle(.white.opacity(0.85))
            Spacer()
            Button {
                showingPersonaPicker = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: personaIcon(store.activePersona))
                        .font(.caption.weight(.bold))
                    Text(store.activePersona.label)
                        .font(.footnote.weight(.semibold))
                    Image(systemName: "chevron.down")
                        .font(.caption2.weight(.bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(.white.opacity(0.18), in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    private var greetingBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(greeting + ", \(store.currentUserID != nil ? "there" : "Explorer")")
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(.white)
            Text(personaTagline(store.activePersona))
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.80))
        }
        .padding(.top, 2)
    }

    private var quickChips: some View {
        HStack(spacing: 8) {
            HeroChip(icon: "bolt.fill",
                     label: "\(store.urgencyQueue.filter { $0.urgency == "critical" || $0.urgency == "high" }.count) urgent")
            HeroChip(icon: "heart.text.square.fill",
                     label: "Pulse \(store.pulseScore)")
        }
    }

    private func personaIcon(_ p: AppPersona) -> String {
        switch p {
        case .customer: return "person.fill"
        case .helper: return "wrench.and.screwdriver.fill"
        case .businessOwner: return "building.2.fill"
        case .consultant: return "lightbulb.fill"
        case .toolOwner: return "hammer.fill"
        case .franchiseOwner: return "mappin.and.ellipse"
        case .investor: return "chart.line.uptrend.xyaxis"
        }
    }

    private func personaTagline(_ p: AppPersona) -> String {
        switch p {
        case .customer: return "Find help, manage jobs & stay on top of life."
        case .helper: return "Earn more, bid smart, build your reputation."
        case .businessOwner: return "Run your team, track revenue, scale up."
        case .consultant: return "Grow your client base and close more deals."
        case .toolOwner: return "Rent your tools, track inventory, earn passively."
        case .franchiseOwner: return "Expand territory, onboard reps, drive revenue."
        case .investor: return "Fund businesses, collect revenue share, grow wealth."
        }
    }
}

private struct HeroChip: View {
    let icon: String
    let label: String
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
            Text(label)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(.white.opacity(0.18), in: Capsule())
    }
}
