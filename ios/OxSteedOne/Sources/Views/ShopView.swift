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
    @State private var financingAmount = ""
    @State private var financingPurpose = ""
    @State private var financingRevenue = ""
    @State private var financingCredit = "Fair"

    var body: some View {
        GoScreen(title: t("shop.growth_title", fallback: "Growth"), showsTitle: true) {
            GoCard {
                Text(t("shop.economic_mobility_ladder", fallback: "Economic Mobility Ladder"))
                    .font(.headline)
                Text(t("shop.ladder_path", fallback: "Skill → Side Income → Licensed Business → Scaled Operation"))
                    .font(.footnote)
                    .foregroundStyle(OneTheme.muted)
                Text(t("shop.next_step", fallback: "Next Step:") + " " + localizedGrowthNextStep(store.growthNextStep))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OneTheme.amber)
            }

            GoCard {
                growthItem(t("shop.business_ascension", fallback: "Business Ascension"), t("shop.business_ascension_detail", fallback: "Apply to move from side work to licensed operation."), "arrow.up.right.circle.fill")
                growthItem(t("shop.community_wholesale_groups", fallback: "Community Wholesale Groups"), t("shop.community_wholesale_groups_detail", fallback: "Join neighborhood bulk-buy campaigns."), "person.3.fill")
                growthItem(t("shop.financing_prequalification", fallback: "Financing Pre-Qualification"), t("shop.financing_prequalification_detail", fallback: "Micro-loans, equipment, and startup financing pathways."), "banknote.fill")
                growthItem(t("shop.grants_and_subsidies", fallback: "Grants & Subsidies"), t("shop.grants_and_subsidies_detail", fallback: "Location-aware opportunities for your trade."), "doc.badge.gearshape.fill")
            }

            GoCard {
                Text(t("shop.business_ascension_application", fallback: "Business Ascension Application"))
                    .font(.headline)
                TextField(t("shop.full_name", fallback: "Full name"), text: $ascensionName)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField(t("shop.current_skill", fallback: "Current skill"), text: $ascensionSkill)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField(t("shop.target_license_business", fallback: "Target license/business"), text: $ascensionLicense)
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
                        Text(t("shop.submit_ascension_application", fallback: "Submit Ascension Application")).frame(maxWidth: .infinity)
                    }
                }
                .disabled(store.isSubmittingCustomerJob)
                .buttonStyle(GoAccentButtonStyle())
                Text(t("shop.status_label", fallback: "Status:") + " " + localizedAscensionStatus(store.ascensionApplication.status))
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
                Text(t("shop.community_wholesale_groups", fallback: "Community Wholesale Groups"))
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
                        Button(group.joined ? t("shop.joined", fallback: "Joined") : t("shop.join", fallback: "Join")) {
                            Task { await store.toggleWholesaleGroupJoin(group.id) }
                        }
                        .disabled(store.isSubmittingCustomerJob)
                        .buttonStyle(.borderedProminent)
                    }
                }
            }

            GoCard {
                Text(t("shop.financing_prequalification", fallback: "Financing Pre-Qualification"))
                    .font(.headline)
                TextField(t("shop.requested_amount", fallback: "Requested amount"), text: $financingAmount)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField(t("shop.purpose", fallback: "Purpose"), text: $financingPurpose)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField(t("shop.monthly_revenue", fallback: "Monthly revenue"), text: $financingRevenue)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Picker(t("shop.credit_band", fallback: "Credit band"), selection: $financingCredit) {
                    Text(t("shop.credit_fair", fallback: "Fair")).tag("Fair")
                    Text(t("shop.credit_good", fallback: "Good")).tag("Good")
                    Text(t("shop.credit_very_good", fallback: "Very Good")).tag("Very Good")
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
                        Text(t("shop.submit_prequalification", fallback: "Submit Pre-Qualification")).frame(maxWidth: .infinity)
                    }
                }
                .disabled(store.isSubmittingCustomerJob)
                .buttonStyle(GoAccentButtonStyle())
                Text(t("shop.status_label", fallback: "Status:") + " " + localizedFinancingStatus(store.financingPrequal.status))
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }

            GoCard {
                Text(t("shop.grants_and_subsidies", fallback: "Grants & Subsidies"))
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
                        Button(t("shop.apply", fallback: "Apply")) {
                            Task { await store.applyForGrant(grant.id) }
                        }
                        .disabled(store.isSubmittingCustomerJob)
                        .buttonStyle(.bordered)
                    }
                    .padding(.vertical, 2)
                }
            }

            GoCard {
                Text(t("shop.progress_tracker", fallback: "Progress Tracker"))
                    .font(.headline)
                HStack {
                    ForEach(["Skill", "Side Income", "Licensed Business", "Scaled Operation"], id: \.self) { step in
                        Text(localizedGrowthStepLabel(step))
                            .font(.caption.weight(step == store.growthProgressStep ? .bold : .regular))
                            .foregroundStyle(step == store.growthProgressStep ? OneTheme.amber : OneTheme.muted)
                    }
                }
                Picker(t("shop.current_step", fallback: "Current Step"), selection: Binding(
                    get: { store.growthProgressStep },
                    set: { store.growthProgressStep = $0 }
                )) {
                    Text(localizedGrowthStepLabel("Skill")).tag("Skill")
                    Text(localizedGrowthStepLabel("Side Income")).tag("Side Income")
                    Text(localizedGrowthStepLabel("Licensed Business")).tag("Licensed Business")
                    Text(localizedGrowthStepLabel("Scaled Operation")).tag("Scaled Operation")
                }
            }

            GoCard {
                Text(t("shop.tax_document_center", fallback: "Tax Document Center"))
                    .font(.headline)
                Text(t("shop.tax_document_description", fallback: "Annual 1099-style summary and deductible tracking."))
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                ForEach(store.taxDocuments) { doc in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t("shop.tax_year", fallback: "Tax Year") + " \(doc.year)")
                            .font(.subheadline.weight(.semibold))
                        Text(t("shop.gross", fallback: "Gross") + ": \(currency(doc.grossIncome)) " + "· " + t("shop.deductions", fallback: "Deductions") + ": \(currency(doc.deductibleExpenses))")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 3)
                }
            }

            GoCard {
                Text(t("shop.voice_input", fallback: "Voice Input"))
                    .font(.headline)
                Toggle(t("shop.voice_input_enable_label", fallback: "Enable voice input for posting and chat"), isOn: Binding(
                    get: { store.voiceInputEnabled },
                    set: { store.voiceInputEnabled = $0 }
                ))
                Text(t("shop.voice_input_description", fallback: "Language-aware dictation path follows selected app language."))
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }

            GoCard {
                HStack {
                    Text(t("shop.live_growth_data", fallback: "Live Growth Data"))
                        .font(.headline)
                    Spacer()
                    Button {
                        Task { await store.refreshGrowthData() }
                    } label: {
                        if store.isRefreshingGrowthData {
                            ProgressView()
                        } else {
                            Text(t("shop.sync_live_data", fallback: "Sync Live Data"))
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
                Text(t("shop.wallet", fallback: "Wallet"))
                    .font(.headline)
                Text(t("shop.available_prefix", fallback: "Available:") + " \(currency(store.walletSnapshot.availableBalance))")
                    .font(.subheadline.weight(.semibold))
                Text(t("shop.pending_escrow", fallback: "Pending escrow") + ": \(currency(store.walletSnapshot.pendingEscrow))")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                Text(t("shop.payout_method", fallback: "Payout method") + ": \(store.walletSnapshot.payoutMethod)")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                TextField(t("shop.update_payout_method", fallback: "Update payout method"), text: $payoutMethod)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button(t("shop.save_payout_method", fallback: "Save Payout Method")) {
                    store.setPayoutMethod(payoutMethod)
                    payoutMethod = ""
                }
                .buttonStyle(.bordered)
                Divider()
                Text(t("shop.transaction_history", fallback: "Transaction History"))
                    .font(.subheadline.weight(.semibold))
                TextField(t("shop.transaction_title", fallback: "Transaction title"), text: $transactionTitle)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField(t("shop.amount", fallback: "Amount"), text: $transactionAmount)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Toggle(t("shop.credit", fallback: "Credit"), isOn: $transactionIsCredit)
                Button(t("shop.add_transaction", fallback: "Add Transaction")) {
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
                    Text(t("shop.consultant_profile_snapshot", fallback: "Consultant Profile Snapshot"))
                        .font(.headline)
                    if let profile = store.consultantProfile {
                        Text(profile.displayName)
                            .font(.subheadline.weight(.semibold))
                        Text(localizedPackagesLabel(profile.servicePackages.count) + " · " + localizedAppointmentsLabel(profile.appointmentCount) + " · " + localizedNotesLabel(profile.notesCount))
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    } else {
                        Text(t("shop.sync_growth_data_hint", fallback: "Sync Live Data to load consultant profile."))
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                }
            }

            if store.activePersona == .toolOwner {
                GoCard {
                    Text(t("shop.tool_owner_inventory", fallback: "Tool Owner Inventory"))
                        .font(.headline)
                    if store.toolOwnerInventory.isEmpty {
                        Text(t("shop.sync_tool_inventory_hint", fallback: "Sync Live Data to load inventory."))
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    } else {
                        ForEach(store.toolOwnerInventory) { item in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                Text(item.title)
                                        .font(.subheadline.weight(.semibold))
                                    Text(t("shop.available_prefix", fallback: "Available") + ": \(item.availableUnits) · " + t("shop.pending_returns", fallback: "Pending returns") + ": \(item.pendingReturns)")
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
                Text(t("shop.quote_builder", fallback: "Quote Builder"))
                    .font(.headline)
                TextField(t("shop.customer_name", fallback: "Customer name"), text: $quoteCustomer)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField(t("shop.labor_amount", fallback: "Labor amount"), text: $quoteLabor)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField(t("shop.material_amount", fallback: "Material amount"), text: $quoteMaterials)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                TextField(t("shop.quote_notes", fallback: "Notes"), text: $quoteNotes)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button(t("shop.save_quote_draft", fallback: "Save Quote Draft")) {
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
                Text(t("shop.recurring_services", fallback: "Recurring Services"))
                    .font(.headline)
                TextField(t("shop.service_title", fallback: "Service title"), text: $recurringTitle)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Picker(t("shop.frequency", fallback: "Frequency"), selection: $recurringFrequency) {
                    Text(t("shop.frequency_weekly", fallback: "Weekly")).tag("Weekly")
                    Text(t("shop.frequency_bi_weekly", fallback: "Bi-weekly")).tag("Bi-weekly")
                    Text(t("shop.frequency_monthly", fallback: "Monthly")).tag("Monthly")
                }
                DatePicker(t("shop.frequency_label_next_date", fallback: "Next date"), selection: $recurringDate, displayedComponents: .date)
                Button(t("shop.create_plan", fallback: "Create Plan")) {
                    store.addRecurringPlan(title: recurringTitle, frequency: recurringFrequency, nextDate: recurringDate)
                    recurringTitle = ""
                }
                .buttonStyle(GoAccentButtonStyle())
                ForEach(store.recurringPlans) { plan in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(plan.title)
                                .font(.subheadline.weight(.semibold))
                            Text("\(localizedFrequency(plan.frequency)) · \(plan.active ? t("shop.status_active", fallback: "Active") : t("shop.status_paused", fallback: "Paused"))")
                                .font(.caption)
                                .foregroundStyle(OneTheme.muted)
                        }
                        Spacer()
                        Button(plan.active ? t("shop.pause", fallback: "Pause") : t("shop.resume", fallback: "Resume")) {
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

    private func t(_ key: String, fallback: String) -> String {
        store.localized(key, fallback: fallback)
    }

    private func localizedGrowthNextStep(_ nextStep: String) -> String {
        switch nextStep {
        case "Start Business Ascension application":
            return t("shop.ascension_status_not_started", fallback: "Start Business Ascension application")
        case "Complete Learning tab courses for your license track":
            return t("shop.ascension_status_submitted", fallback: "Complete Learning tab courses for your license track")
        case "Submit financing pre-qualification":
            return t("shop.ascension_status_financing_pending", fallback: "Submit financing pre-qualification")
        default:
            return t("shop.ascension_status_default", fallback: "Join a wholesale group and execute first scaled operation")
        }
    }

    private func localizedGrowthStepLabel(_ step: String) -> String {
        switch step {
        case "Side Income":
            return t("shop.progress_step_side_income", fallback: "Side Income")
        case "Licensed Business":
            return t("shop.progress_step_licensed_business", fallback: "Licensed Business")
        case "Scaled Operation":
            return t("shop.progress_step_scaled_operation", fallback: "Scaled Operation")
        default:
            return t("shop.progress_step_skill", fallback: "Skill")
        }
    }

    private func localizedAscensionStatus(_ status: String) -> String {
        switch status {
        case "Not Started":
            return t("shop.ascension_status_not_started", fallback: "Start Business Ascension application")
        case "Submitted":
            return t("shop.ascension_status_submitted", fallback: "Complete Learning tab courses for your license track")
        default:
            return status
        }
    }

    private func localizedFinancingStatus(_ status: String) -> String {
        switch status {
        case "Not Started":
            return t("shop.financing_status_not_started", fallback: "Not Started")
        case "Submitted":
            return t("shop.financing_status_submitted", fallback: "Submitted")
        default:
            return status
        }
    }

    private func localizedFrequency(_ frequency: String) -> String {
        switch frequency {
        case "Bi-weekly":
            return t("shop.frequency_bi_weekly", fallback: "Bi-weekly")
        case "Monthly":
            return t("shop.frequency_monthly", fallback: "Monthly")
        default:
            return t("shop.frequency_weekly", fallback: "Weekly")
        }
    }

    private func localizedPackagesLabel(_ count: Int) -> String {
        String(format: t("shop.packages_label", fallback: "Packages: %d"), count)
    }

    private func localizedAppointmentsLabel(_ count: Int) -> String {
        String(format: t("shop.appointments_label", fallback: "Appointments: %d"), count)
    }

    private func localizedNotesLabel(_ count: Int) -> String {
        String(format: t("shop.notes_label", fallback: "Notes: %d"), count)
    }
}
