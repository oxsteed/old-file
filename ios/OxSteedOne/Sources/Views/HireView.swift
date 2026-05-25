import SwiftUI

struct HireView: View {
    @Environment(OneStore.self) private var store

    @State private var lifeTitle = ""
    @State private var lifeDetail = ""
    @State private var selectedLifePillar = "money"

    @State private var fundTitle = ""
    @State private var fundTargetAmount = ""
    @State private var fundCurrentAmount = ""
    @State private var fundTargetDate = Calendar.current.date(byAdding: .month, value: 6, to: Date()) ?? Date()

    @State private var addAmountByFundID: [UUID: String] = [:]
    @State private var bookingCustomer = ""
    @State private var bookingTime = ""
    @State private var bookingDate = Date()
    @State private var counterByBookingID: [UUID: String] = [:]

    var body: some View {
        GoScreen(title: "Life", showsTitle: true) {
            GoCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Pulse Score")
                                .font(.headline)
                            Text("Life stability across six pillars")
                                .font(.footnote)
                                .foregroundStyle(OneTheme.muted)
                        }
                        Spacer()
                        pulseRing
                    }
                    if let selected = store.selectedPulsePillar {
                        Text("Selected: \(selected.title) · \(selected.score)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(OneTheme.amber)
                        Text(selected.summary)
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                }
            }

            GoCard {
                Text("Six Pillars")
                    .font(.headline)
                ForEach(store.pulsePillars) { pillar in
                    Button {
                        store.selectPulsePillar(pillar.id)
                    } label: {
                        HStack {
                            Circle()
                                .fill(color(from: pillar.tintHex))
                                .frame(width: 10, height: 10)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(pillar.title) (\(pillar.weight)%)")
                                    .font(.subheadline.weight(.semibold))
                                Text(pillar.summary)
                                    .font(.caption)
                                    .foregroundStyle(OneTheme.muted)
                            }
                            Spacer()
                            Text("\(pillar.score)")
                                .font(.headline.weight(.bold))
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            }

            GoCard {
                Text("Pillar Drilldown")
                    .font(.headline)
                if let selected = store.selectedPulsePillar {
                    pillarDrilldown(for: selected.id)
                }
            }

            GoCard {
                Text("Urgency Queue")
                    .font(.headline)
                Text("One critical item per pillar, sorted by urgency.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                ForEach(store.urgencyQueue) { item in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title)
                                .font(.subheadline.weight(.semibold))
                            Text("\(item.pillar) · \(item.dueText)")
                                .font(.caption)
                                .foregroundStyle(OneTheme.muted)
                        }
                        Spacer()
                        Text(item.urgency.capitalized)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(item.urgency == "critical" ? .red : OneTheme.amber)
                    }
                    .padding(.vertical, 4)
                }
            }

            GoCard {
                Text("Life Log (Offline Resilient)")
                    .font(.headline)
                Picker("Pillar", selection: $selectedLifePillar) {
                    ForEach(store.pulsePillars, id: \.id) { pillar in
                        Text(pillar.title).tag(pillar.id)
                    }
                }
                TextField("Entry title", text: $lifeTitle)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Detail", text: $lifeDetail)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button("Save Life Entry") {
                    store.addLifeLogEntry(pillarID: selectedLifePillar, title: lifeTitle, detail: lifeDetail)
                    lifeTitle = ""
                    lifeDetail = ""
                }
                .buttonStyle(GoAccentButtonStyle())

                ForEach(store.lifeLogEntries.prefix(5)) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.title)
                            .font(.subheadline.weight(.semibold))
                        Text("\(entry.pillarID.uppercased()) · \(entry.detail)")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                }
            }

            GoCard {
                Text("Planned Needs / Sinking Funds")
                    .font(.headline)
                TextField("Fund title", text: $fundTitle)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Target amount", text: $fundTargetAmount)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Current amount", text: $fundCurrentAmount)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                DatePicker("Target date", selection: $fundTargetDate, displayedComponents: .date)
                Button("Create Sinking Fund") {
                    store.addSinkingFund(
                        title: fundTitle,
                        targetAmount: Double(fundTargetAmount) ?? 0,
                        currentAmount: Double(fundCurrentAmount) ?? 0,
                        targetDate: fundTargetDate
                    )
                    fundTitle = ""
                    fundTargetAmount = ""
                    fundCurrentAmount = ""
                }
                .buttonStyle(GoAccentButtonStyle())

                ForEach(store.sinkingFunds) { fund in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(fund.title)
                            .font(.subheadline.weight(.semibold))
                        Text("Target: \(currency(fund.targetAmount)) · Current: \(currency(fund.currentAmount))")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                        Text("Status: \(store.sinkingFundStatus(for: fund).uppercased())")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(statusColor(store.sinkingFundStatus(for: fund)))

                        HStack {
                            TextField("Add", text: Binding(
                                get: { addAmountByFundID[fund.id] ?? "" },
                                set: { addAmountByFundID[fund.id] = $0 }
                            ))
                            .padding(8)
                            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                            Button("Add") {
                                let amount = Double(addAmountByFundID[fund.id] ?? "") ?? 0
                                store.addToSinkingFund(fund.id, amount: amount)
                                addAmountByFundID[fund.id] = ""
                            }
                            .buttonStyle(GoAccentButtonStyle())
                        }
                    }
                }

                if !store.weeklyContributionSummaries.isEmpty {
                    Text("Weekly Contributions")
                        .font(.subheadline.weight(.semibold))
                    ForEach(store.weeklyContributionSummaries, id: \.self) { summary in
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                }
            }

            GoCard {
                Text("Booking Requests + Counter-Propose")
                    .font(.headline)
                TextField("Customer name", text: $bookingCustomer)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                DatePicker("Requested date", selection: $bookingDate, displayedComponents: .date)
                TextField("Requested time", text: $bookingTime)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button("Create Booking Request") {
                    store.createBookingDraft(customerName: bookingCustomer, proposedDate: bookingDate, customerTime: bookingTime)
                    bookingCustomer = ""
                    bookingTime = ""
                }
                .buttonStyle(GoAccentButtonStyle())

                ForEach(store.bookingDrafts) { draft in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(draft.customerName) · \(draft.customerProposedTime)")
                            .font(.subheadline.weight(.semibold))
                        Text("Status: \(draft.status)")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                        if let counter = draft.helperCounterProposalTime {
                            Text("Counter: \(counter)")
                                .font(.caption2)
                                .foregroundStyle(OneTheme.amber)
                        }
                        HStack {
                            TextField("Counter-propose time", text: Binding(
                                get: { counterByBookingID[draft.id] ?? "" },
                                set: { counterByBookingID[draft.id] = $0 }
                            ))
                            .padding(8)
                            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            Button("Send") {
                                store.counterProposeBooking(draft.id, newTime: counterByBookingID[draft.id] ?? "")
                                counterByBookingID[draft.id] = ""
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(.vertical, 3)
                }
            }

            GoCard {
                Text("Buffer Time Between Jobs")
                    .font(.headline)
                Toggle("Enable dispatch buffer", isOn: Binding(
                    get: { store.dispatchBufferSettings.enabled },
                    set: { store.setDispatchBuffer(enabled: $0) }
                ))
                Stepper("Minutes between jobs: \(store.dispatchBufferSettings.minutesBetweenJobs)", value: Binding(
                    get: { store.dispatchBufferSettings.minutesBetweenJobs },
                    set: { store.setDispatchBufferMinutes($0) }
                ), in: 0...120, step: 5)
            }
        }
    }

    private var pulseRing: some View {
        ZStack {
            ForEach(Array(store.pulsePillars.enumerated()), id: \.element.id) { index, pillar in
                Circle()
                    .trim(from: startTrim(for: index), to: endTrim(for: index))
                    .stroke(
                        color(from: pillar.tintHex),
                        style: StrokeStyle(lineWidth: 8, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
            }
            Text("\(store.pulseScore)")
                .font(.system(size: 24, weight: .heavy, design: .rounded))
                .foregroundStyle(OneTheme.ink)
        }
        .frame(width: 86, height: 86)
    }

    private func startTrim(for index: Int) -> CGFloat {
        let count = CGFloat(store.pulsePillars.count)
        let segment = 1.0 / count
        return CGFloat(index) * segment + 0.008
    }

    private func endTrim(for index: Int) -> CGFloat {
        let count = CGFloat(store.pulsePillars.count)
        let segment = 1.0 / count
        return CGFloat(index + 1) * segment - 0.008
    }

    private func color(from hex: String) -> Color {
        let cleaned = hex.replacingOccurrences(of: "#", with: "")
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let r = Double((value & 0xFF0000) >> 16) / 255
        let g = Double((value & 0x00FF00) >> 8) / 255
        let b = Double(value & 0x0000FF) / 255
        return Color(red: r, green: g, blue: b)
    }

    private func currency(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = store.activeLocale
        return formatter.string(from: NSNumber(value: value)) ?? "$0"
    }

    @ViewBuilder
    private func pillarDrilldown(for pillarID: String) -> some View {
        switch pillarID {
        case "money":
            detailRow("Income Sources", "Primary job + side gigs tracked this month")
            detailRow("Budget vs Actual", "Spending is 8% above plan")
            detailRow("Emergency Fund", "\(currency(420)) saved; every dollar counts")
            detailRow("30-Day Cash Flow", "You'll be short \(currency(120)) on June 3 unless a new job posts")
        case "home":
            detailRow("Seasonal Tasks", "Gutter clean and HVAC filter swap pending")
            detailRow("Appliance Lifespans", "Water heater projected replacement in 2029")
            detailRow("Service History", "Plumber visited March 15, 2026")
            detailRow("Convert Task to Job", "Post task directly to Home workflow")
        case "car":
            detailRow("My Garage", "VIN-decoded vehicle with recall watch")
            detailRow("Maintenance Timeline", "Oil change due in 400 miles or 12 days")
            detailRow("Service History", "Mechanic + manual entries combined")
            detailRow("Annual Spend", "\(currency(1840)) year-to-date car care")
        case "personal":
            detailRow("Habit Tracker", "Exercise, meal prep, and sleep targets")
            detailRow("Appointments", "Dentist and annual physical due")
            detailRow("Self-Care Budget", "\(currency(95))/month reserved")
            detailRow("Micro-Achievements", "2 habit streaks active")
        case "goals":
            detailRow("Short-Term Goal", "Save \(currency(400)) for new tires")
            detailRow("Mid-Term Goal", "Finish HVAC certification in 9 months")
            detailRow("Long-Term Goal", "Buy a duplex in Springfield")
            detailRow("Linked Goals", "Unlinked goals do not count toward Pulse")
        case "funds":
            detailRow("Planned Needs", "Water heater replacement \(currency(1200)) by 2028")
            detailRow("Holiday Fund", "Christmas gifts \(currency(600)) by Dec 1")
            detailRow("Weekly Contribution", "\(currency(23))/week suggested to hit target")
            detailRow("Quote Offset", "Sinking-fund balance offsets approved quote")
        default:
            Text("Select a pillar to view details.")
                .font(.caption)
                .foregroundStyle(OneTheme.muted)
        }
    }

    private func detailRow(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            Text(text)
                .font(.caption)
                .foregroundStyle(OneTheme.muted)
        }
        .padding(.vertical, 2)
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "on-track": return .green
        case "behind": return OneTheme.amber
        default: return .red
        }
    }
}
