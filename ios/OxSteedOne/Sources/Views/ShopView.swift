import SwiftUI

struct ShopView: View {
    @Environment(OneStore.self) private var store
    @State private var quoteCustomer = ""
    @State private var quoteLabor = ""
    @State private var quoteMaterials = ""
    @State private var quoteNotes = ""
    @State private var recurringTitle = ""
    @State private var recurringFrequency = "Weekly"
    @State private var recurringDate = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
    @State private var payoutMethod = ""
    @State private var transactionTitle = ""
    @State private var transactionAmount = ""
    @State private var transactionIsCredit = true
    @State private var ascensionName = ""
    @State private var ascensionSkill = "General Home Services"
    @State private var ascensionLicense = "HVAC Contractor"
    @State private var financingAmount = "5000"
    @State private var financingPurpose = "Equipment"
    @State private var financingRevenue = "2800"
    @State private var financingCredit = "Fair"

    var body: some View {
        GoScreen(title: "Growth", showsTitle: true) {
            GoCard {
                Text("Economic Mobility Ladder")
                    .font(.headline)
                Text("Skill → Side Income → Licensed Business → Scaled Operation")
                    .font(.footnote)
                    .foregroundStyle(OneTheme.muted)
                Text("Next Step: \(store.growthNextStep)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OneTheme.amber)
            }

            GoCard {
                growthItem("Business Ascension", "Apply to move from side work to licensed operation.", "arrow.up.right.circle.fill")
                growthItem("Community Wholesale Groups", "Join neighborhood bulk-buy campaigns.", "person.3.fill")
                growthItem("Financing Pre-Qualification", "Micro-loans, equipment, and startup financing pathways.", "banknote.fill")
                growthItem("Grants & Subsidies", "Location-aware opportunities for your trade.", "doc.badge.gearshape.fill")
            }

            GoCard {
                Text("Business Ascension Application")
                    .font(.headline)
                TextField("Full name", text: $ascensionName)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Current skill", text: $ascensionSkill)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Target license/business", text: $ascensionLicense)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button {
                    Task {
                        await store.submitAscensionApplication(fullName: ascensionName, skill: ascensionSkill, targetLicense: ascensionLicense)
                        ascensionName = ""
                    }
                } label: {
                    if store.isSubmittingCustomerJob {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Submit Ascension Application").frame(maxWidth: .infinity)
                    }
                }
                .disabled(store.isSubmittingCustomerJob)
                .buttonStyle(GoAccentButtonStyle())
                Text("Status: \(store.ascensionApplication.status)")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                if let msg = store.customerJobFlowMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(.green)
                }
                if let err = store.lastJobError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            GoCard {
                Text("Community Wholesale Groups")
                    .font(.headline)
                ForEach(store.wholesaleGroups) { group in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(group.name)
                                .font(.subheadline.weight(.semibold))
                            Text("\(group.city) · \(group.category) · \(group.memberCount) members")
                                .font(.caption)
                                .foregroundStyle(OneTheme.muted)
                        }
                        Spacer()
                        Button(group.joined ? "Joined" : "Join") {
                            Task { await store.toggleWholesaleGroupJoin(group.id) }
                        }
                        .disabled(store.isSubmittingCustomerJob)
                        .buttonStyle(.borderedProminent)
                    }
                }
            }

            GoCard {
                Text("Financing Pre-Qualification")
                    .font(.headline)
                TextField("Requested amount", text: $financingAmount)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Purpose", text: $financingPurpose)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Monthly revenue", text: $financingRevenue)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Picker("Credit band", selection: $financingCredit) {
                    Text("Fair").tag("Fair")
                    Text("Good").tag("Good")
                    Text("Very Good").tag("Very Good")
                }
                Button {
                    Task {
                        await store.submitFinancingPrequal(
                            requestedAmount: Double(financingAmount) ?? 0,
                            purpose: financingPurpose,
                            monthlyRevenue: Double(financingRevenue) ?? 0,
                            creditBand: financingCredit
                        )
                    }
                } label: {
                    if store.isSubmittingCustomerJob {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Submit Pre-Qualification").frame(maxWidth: .infinity)
                    }
                }
                .disabled(store.isSubmittingCustomerJob)
                .buttonStyle(GoAccentButtonStyle())
                Text("Status: \(store.financingPrequal.status)")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }

            GoCard {
                Text("Grants & Subsidies")
                    .font(.headline)
                ForEach(store.grantOpportunities) { grant in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(grant.title)
                                .font(.subheadline.weight(.semibold))
                            Text("\(grant.region) · \(grant.dueText)")
                                .font(.caption)
                                .foregroundStyle(OneTheme.muted)
                        }
                        Spacer()
                        Button("Apply") {
                            Task { await store.applyForGrant(grant.id) }
                        }
                        .disabled(store.isSubmittingCustomerJob)
                        .buttonStyle(.bordered)
                    }
                    .padding(.vertical, 2)
                }
            }

            GoCard {
                Text("Progress Tracker")
                    .font(.headline)
                HStack {
                    ForEach(["Skill", "Side Income", "Licensed Business", "Scaled Operation"], id: \.self) { step in
                        Text(step)
                            .font(.caption.weight(step == store.growthProgressStep ? .bold : .regular))
                            .foregroundStyle(step == store.growthProgressStep ? OneTheme.amber : OneTheme.muted)
                    }
                }
                Picker("Current Step", selection: Binding(
                    get: { store.growthProgressStep },
                    set: { store.growthProgressStep = $0 }
                )) {
                    Text("Skill").tag("Skill")
                    Text("Side Income").tag("Side Income")
                    Text("Licensed Business").tag("Licensed Business")
                    Text("Scaled Operation").tag("Scaled Operation")
                }
            }

            GoCard {
                Text("Tax Document Center")
                    .font(.headline)
                Text("Annual 1099-style summary and deductible tracking.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                ForEach(store.taxDocuments) { doc in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Tax Year \(doc.year)")
                            .font(.subheadline.weight(.semibold))
                        Text("Gross: \(currency(doc.grossIncome)) · Deductions: \(currency(doc.deductibleExpenses))")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 3)
                }
            }

            GoCard {
                Text("Voice Input")
                    .font(.headline)
                Toggle("Enable voice input for posting and chat", isOn: Binding(
                    get: { store.voiceInputEnabled },
                    set: { store.voiceInputEnabled = $0 }
                ))
                Text("Language-aware dictation path follows selected app language.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }

            GoCard {
                HStack {
                    Text("Live Growth Data")
                        .font(.headline)
                    Spacer()
                    Button {
                        Task { await store.refreshGrowthData() }
                    } label: {
                        if store.isRefreshingGrowthData {
                            ProgressView()
                        } else {
                            Text("Sync Live Data")
                        }
                    }
                    .disabled(store.isRefreshingGrowthData)
                    .buttonStyle(.bordered)
                }
                if let err = store.lastJobError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            GoCard {
                Text("Wallet")
                    .font(.headline)
                Text("Available: \(currency(store.walletSnapshot.availableBalance))")
                    .font(.subheadline.weight(.semibold))
                Text("Pending escrow: \(currency(store.walletSnapshot.pendingEscrow))")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                Text("Payout method: \(store.walletSnapshot.payoutMethod)")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                TextField("Update payout method", text: $payoutMethod)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button("Save Payout Method") {
                    store.setPayoutMethod(payoutMethod)
                    payoutMethod = ""
                }
                .buttonStyle(.bordered)
                Divider()
                Text("Transaction History")
                    .font(.subheadline.weight(.semibold))
                TextField("Transaction title", text: $transactionTitle)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Amount", text: $transactionAmount)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Toggle("Credit", isOn: $transactionIsCredit)
                Button("Add Transaction") {
                    store.addWalletTransaction(
                        title: transactionTitle,
                        amount: Double(transactionAmount) ?? 0,
                        isCredit: transactionIsCredit
                    )
                    transactionTitle = ""
                    transactionAmount = ""
                    transactionIsCredit = true
                }
                .buttonStyle(GoAccentButtonStyle())
                ForEach(store.walletTransactions.prefix(5)) { tx in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tx.title)
                                .font(.caption.weight(.semibold))
                            Text(tx.timestamp.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption2)
                                .foregroundStyle(OneTheme.muted)
                        }
                        Spacer()
                        Text("\(tx.isCredit ? "+" : "-")\(currency(tx.amount))")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(tx.isCredit ? .green : .red)
                    }
                }
            }

            if store.activePersona == .consultant {
                GoCard {
                    Text("Consultant Profile Snapshot")
                        .font(.headline)
                    if let profile = store.consultantProfile {
                        Text(profile.displayName)
                            .font(.subheadline.weight(.semibold))
                        Text("Packages: \(profile.servicePackages.count) · Appointments: \(profile.appointmentCount) · Notes: \(profile.notesCount)")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    } else {
                        Text("Sync Live Data to load consultant profile.")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                }
            }

            if store.activePersona == .toolOwner {
                GoCard {
                    Text("Tool Owner Inventory")
                        .font(.headline)
                    if store.toolOwnerInventory.isEmpty {
                        Text("Sync Live Data to load inventory.")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    } else {
                        ForEach(store.toolOwnerInventory) { item in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title)
                                        .font(.subheadline.weight(.semibold))
                                    Text("Available: \(item.availableUnits) · Pending returns: \(item.pendingReturns)")
                                        .font(.caption)
                                        .foregroundStyle(OneTheme.muted)
                                }
                                Spacer()
                                Text(item.condition.capitalized)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(OneTheme.amber)
                            }
                        }
                    }
                }
            }

            GoCard {
                Text("Quote Builder")
                    .font(.headline)
                TextField("Customer name", text: $quoteCustomer)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Labor amount", text: $quoteLabor)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Material amount", text: $quoteMaterials)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField("Notes", text: $quoteNotes)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button("Save Quote Draft") {
                    store.addQuoteDraft(
                        customerName: quoteCustomer,
                        labor: Double(quoteLabor) ?? 0,
                        materials: Double(quoteMaterials) ?? 0,
                        notes: quoteNotes
                    )
                    quoteCustomer = ""
                    quoteLabor = ""
                    quoteMaterials = ""
                    quoteNotes = ""
                }
                .buttonStyle(GoAccentButtonStyle())
                ForEach(store.quoteDrafts.prefix(3)) { draft in
                    Text("\(draft.customerName): \(currency(draft.laborAmount + draft.materialAmount))")
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                }
            }

            GoCard {
                Text("Recurring Services")
                    .font(.headline)
                TextField("Service title", text: $recurringTitle)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Picker("Frequency", selection: $recurringFrequency) {
                    Text("Weekly").tag("Weekly")
                    Text("Bi-weekly").tag("Bi-weekly")
                    Text("Monthly").tag("Monthly")
                }
                DatePicker("Next date", selection: $recurringDate, displayedComponents: .date)
                Button("Create Plan") {
                    store.addRecurringPlan(title: recurringTitle, frequency: recurringFrequency, nextDate: recurringDate)
                    recurringTitle = ""
                }
                .buttonStyle(GoAccentButtonStyle())
                ForEach(store.recurringPlans) { plan in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(plan.title)
                                .font(.subheadline.weight(.semibold))
                            Text("\(plan.frequency) · \(plan.active ? "Active" : "Paused")")
                                .font(.caption)
                                .foregroundStyle(OneTheme.muted)
                        }
                        Spacer()
                        Button(plan.active ? "Pause" : "Resume") {
                            store.toggleRecurringPlan(plan.id)
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        }
    }

    private func growthItem(_ title: String, _ detail: String, _ icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(OneTheme.amber)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }
        }
        .padding(.vertical, 4)
    }

    private func currency(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = store.activeLocale
        return formatter.string(from: NSNumber(value: value)) ?? "$0"
    }
}
