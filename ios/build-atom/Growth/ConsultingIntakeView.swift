import SwiftUI

// MARK: - BusinessConsultingIntakeView

struct BusinessConsultingIntakeView: View {
    private typealias CI = L10n.ConsultingIntakeKey

    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss

    @State private var step = 1
    private let totalSteps = 5

    // Step 1 — Contact
    @State private var contactEmail = ""
    @State private var contactFirstName = ""
    @State private var contactLastName = ""
    @State private var phone = ""
    @State private var referralSource = ""

    // Step 2 — Your Business
    @State private var skillSelection = ""     // chosen from picker
    @State private var customSkill = ""        // typed when "Other" is chosen
    @State private var targetMarket = ""
    @State private var hasRevenue = ""         // "no" | "informal" | "formal"
    @State private var businessNameDecided = "" // "yes" | "no"
    @State private var businessName = ""
    @State private var operatingCountry = "US"
    @State private var operatingState = ""     // state or city

    // Step 3 — What You Need
    @State private var selectedSetupItemIds: Set<String> = []
    @State private var selectAllChosen = false
    @State private var currentPhase = ""      // "1"..."25" or ""
    @State private var urgency = ""
    @State private var additionalNotes = ""

    // Step 4 — Package
    @State private var packageSelected = ""

    // Submission
    @State private var isSubmitting = false
    @State private var submitted = false
    @State private var submitError: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !submitted {
                    progressBar
                }
                if submitted {
                    submittedView
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 22) {
                            stepHeader
                            stepContent
                            if let err = submitError {
                                Text(err)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.danger)
                            }
                        }
                        .padding(20)
                        .animation(.default, value: step)
                    }
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(LocalizedStringKey(CI.title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(step > 1 ? "common.back" : "common.cancel") {
                        if step > 1 { withAnimation { step -= 1 } }
                        else { dismiss() }
                    }
                    .foregroundStyle(Theme.textSecondary)
                }
                if !submitted {
                    ToolbarItem(placement: .topBarTrailing) {
                        if isSubmitting {
                            ProgressView().tint(Theme.accent)
                        } else {
                            Button(step < totalSteps ? "common.next" : "common.submit") {
                                if step < totalSteps { withAnimation { step += 1 } }
                                else { Task { await submit() } }
                            }
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(canAdvance ? Theme.accent : Theme.textTertiary)
                            .disabled(!canAdvance)
                        }
                    }
                }
            }
        }
        .onAppear {
            // Mirror website behavior: prefill editable contact fields when signed in.
            if let user = auth.user {
                if contactEmail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    contactEmail = user.email
                }
                if contactFirstName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    contactFirstName = user.first_name ?? ""
                }
                if contactLastName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    contactLastName = user.last_name ?? ""
                }
            }
        }
    }

    // MARK: - Progress bar

    private var progressBar: some View {
        VStack(spacing: 6) {
            HStack {
                ForEach(1...totalSteps, id: \.self) { i in
                    Capsule()
                        .fill(i <= step ? Theme.accent : Theme.surfaceElevated)
                        .frame(height: 3)
                        .animation(.easeInOut(duration: 0.3), value: step)
                }
            }
            .padding(.horizontal, 20)
            HStack {
                Text(LocalizedStringKey(stepSubtitle))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
                Spacer()
                Text(localization.format("Step %d of %d", step, totalSteps))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
            }
            .padding(.horizontal, 20)
        }
        .padding(.vertical, 10)
        .background(Theme.background)
    }

    // MARK: - Step header

    @ViewBuilder
    private var stepHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(LocalizedStringKey(stepTitle))
                .font(.system(size: 20, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            Text(LocalizedStringKey(stepDescription))
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
        }
    }

    private var stepTitle: String {
        switch step {
        case 1: return CI.stepLabel1
        case 2: return CI.stepLabel2
        case 3: return CI.stepLabel3
        case 4: return CI.stepLabel4
        case 5: return CI.stepLabel5
        default: return ""
        }
    }

    private var stepSubtitle: String {
        switch step {
        case 1: return CI.subtitle1
        case 2: return CI.subtitle2
        case 3: return CI.subtitle3
        case 4: return CI.subtitle4
        case 5: return CI.subtitle5
        default: return ""
        }
    }

    private var stepDescription: String {
        switch step {
        case 1: return CI.description1
        case 2: return CI.description2
        case 3: return CI.description3
        case 4: return CI.description4
        case 5: return CI.description5
        default: return ""
        }
    }

    // MARK: - Can advance

    private var canAdvance: Bool {
        switch step {
        case 1:
            // Backend requires these fields regardless of auth.
            let emailOk = !contactEmail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let firstOk = !contactFirstName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let lastOk  = !contactLastName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let phoneOk = !phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            return emailOk && firstOk && lastOk && phoneOk
        case 2:
            let skill = skillSelection == "__other__" ? customSkill : skillSelection
            let nameOk = businessNameDecided != "yes" || !businessName.trimmingCharacters(in: .whitespaces).isEmpty
            return !skill.isEmpty && !targetMarket.isEmpty && !hasRevenue.isEmpty
                && !businessNameDecided.isEmpty && !operatingCountry.isEmpty && !operatingState.isEmpty && nameOk
        case 3:
            return !selectedSetupItemIds.isEmpty && !urgency.isEmpty
        case 4:
            return !packageSelected.isEmpty
        case 5:
            // Step 5 is just review; allow submit if prior steps are valid.
            return true
        default:
            return true
        }
    }

    // MARK: - Step content router

    @ViewBuilder
    private var stepContent: some View {
        switch step {
        case 1: step1
        case 2: step2
        case 3: step3
        case 4: step4
        case 5: step5
        default: EmptyView()
        }
    }

    // MARK: - Step 1: Contact

    private var step1: some View {
        VStack(spacing: 14) {
            intakeField(CI.emailLabel) {
                TextField(LocalizedStringKey(CI.emailPlaceholder), text: $contactEmail)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.emailAddress)
                    .intakeFieldStyle()
            }
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    intakeLabel(CI.firstNameLabel)
                    TextField(LocalizedStringKey(CI.firstNamePlaceholder), text: $contactFirstName)
                        .textContentType(.givenName)
                        .textInputAutocapitalization(.words)
                        .intakeFieldStyle()
                }
                VStack(alignment: .leading, spacing: 6) {
                    intakeLabel(CI.lastNameLabel)
                    TextField(LocalizedStringKey(CI.lastNamePlaceholder), text: $contactLastName)
                        .textContentType(.familyName)
                        .textInputAutocapitalization(.words)
                        .intakeFieldStyle()
                }
            }

            intakeField(CI.phoneLabel) {
                TextField(LocalizedStringKey(CI.phonePlaceholder), text: $phone)
                    .keyboardType(.phonePad)
                    .intakeFieldStyle()
            }

            VStack(alignment: .leading, spacing: 6) {
                intakeLabel(CI.referralLabel)
                VStack(spacing: 6) {
                    ForEach(referralOptions, id: \.value) { opt in
                        radioRow(label: opt.label, value: opt.value, binding: $referralSource)
                    }
                }
            }
        }
    }

    private let referralOptions: [(value: String, label: String)] = [
        ("marketplace", CI.contactSourceMarketplace),
        ("google", CI.contactSourceGoogle),
        ("referral", CI.contactSourceReferral),
        ("social", CI.contactSourceSocial),
        ("other", CI.contactSourceOther),
    ]

    // MARK: - Step 2: Your Business

    private var step2: some View {
        VStack(spacing: 14) {
            // Skill picker
            VStack(alignment: .leading, spacing: 6) {
                intakeLabel(CI.skillLabel)
                Picker(LocalizedStringKey(CI.skillPickerPlaceholder), selection: $skillSelection) {
                    Text(LocalizedStringKey(CI.skillPickerPlaceholder)).tag("")
                    ForEach(skillOptions, id: \.self) { s in
                        Text(s).tag(s)
                    }
                    Text(LocalizedStringKey("Other - not listed")).tag("__other__")
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
                .intakeFieldStyle()

                if skillSelection == "__other__" {
                    TextField(LocalizedStringKey(CI.skillPlaceholder), text: $customSkill)
                        .intakeFieldStyle()
                        .padding(.top, 4)
                }
            }

            intakeField(CI.targetMarketLabel) {
                TextField(LocalizedStringKey(CI.targetMarketPlaceholder), text: $targetMarket)
                    .intakeFieldStyle()
            }

            VStack(alignment: .leading, spacing: 6) {
                intakeLabel(CI.revenueLabel)
                VStack(spacing: 6) {
                    radioRow(label: CI.revenueNone, value: "no", binding: $hasRevenue)
                    radioRow(label: CI.revenueInformal, value: "informal", binding: $hasRevenue)
                    radioRow(label: CI.revenueFormal, value: "formal", binding: $hasRevenue)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                intakeLabel(CI.businessNameLabel)
                VStack(spacing: 6) {
                    radioRow(label: CI.businessNameYes, value: "yes", binding: $businessNameDecided)
                    radioRow(label: CI.businessNameNo, value: "no", binding: $businessNameDecided)
                }
                if businessNameDecided == "yes" {
                    TextField(LocalizedStringKey(CI.businessNamePlaceholder), text: $businessName)
                        .intakeFieldStyle()
                        .padding(.top, 4)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                intakeLabel(CI.countryLabel)
                Picker(LocalizedStringKey(CI.countryPickerLabel), selection: $operatingCountry) {
                    ForEach(Self.countryCodes, id: \.self) { code in
                        Text(Self.countryName(code)).tag(code)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
                .intakeFieldStyle()
            }

            intakeField(CI.regionLabel) {
                TextField(LocalizedStringKey(CI.regionPlaceholder), text: $operatingState)
                    .intakeFieldStyle()
            }
        }
    }

    private let skillOptions: [String] = Self.skillOptionsWebsite

    // MARK: - Step 3: What You Need

    private var step3: some View {
        VStack(alignment: .leading, spacing: 18) {
            let allItemsCount = Self.allSetupItemIds.count
            let selectedItemsCount = selectedSetupItemIds.count

            VStack(alignment: .leading, spacing: 10) {
                intakeField(CI.phaseLabel) {
                    Picker(LocalizedStringKey(CI.phasePickerLabel), selection: $currentPhase) {
                        Text(LocalizedStringKey(CI.phasePlaceholder)).tag("")
                        ForEach(Self.businessPhases, id: \.id) { phase in
                            Text(localization.format("Phase %d – %@", phase.id, phase.name)).tag(String(phase.id))
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .intakeFieldStyle()
                }

                Toggle(isOn: Binding(
                    get: { selectAllChosen },
                    set: { newValue in
                        selectAllChosen = newValue
                        if newValue {
                            selectedSetupItemIds = Set(Self.allSetupItemIds)
                        } else {
                            selectedSetupItemIds = []
                        }
                    }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(localization.format(CI.setupAllLabel, selectedItemsCount, allItemsCount))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Text(LocalizedStringKey(CI.setupAllHelper))
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .toggleStyle(SwitchToggleStyle(tint: Theme.accent))
                .padding(12)
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
            }

            ForEach(Self.setupGroups) { group in
                VStack(alignment: .leading, spacing: 10) {
                    Text(group.name)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 6)

                    VStack(spacing: 8) {
                        ForEach(group.items) { item in
                            setupItemRow(item)
                        }
                    }
                }
                .padding(14)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
                .opacity(selectAllChosen ? 0.7 : 1)
            }

            Divider()
                .background(Theme.stroke)

            VStack(alignment: .leading, spacing: 6) {
                intakeLabel(CI.setupTimingLabel)
                VStack(spacing: 6) {
                    radioRow(label: CI.urgencyExploring, value: "exploring", binding: $urgency)
                    radioRow(label: CI.urgencyTwoWeeks, value: "two_weeks", binding: $urgency)
                    radioRow(label: CI.urgencyAsap, value: "asap", binding: $urgency)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                intakeLabel(CI.notesLabel)
                TextEditor(text: $additionalNotes)
                    .frame(minHeight: 80)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textPrimary)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
            }
        }
    }

    // MARK: - Step 4: Package

    private var step4: some View {
        VStack(spacing: 12) {
            ForEach(Self.packages) { pkg in
                packageCard(pkg)
            }
            Text(LocalizedStringKey(CI.packageDisclaimer))
                .font(.system(size: 11))
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
                .padding(.top, 4)
        }
    }

    @ViewBuilder
    private func packageCard(_ pkg: ConsultingPackage) -> some View {
        let selected = packageSelected == pkg.id
        Button { packageSelected = pkg.id } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        if pkg.popular {
                            Text(LocalizedStringKey(CI.mostPopularBadge))
                                .font(.system(size: 9, weight: .bold))
                                .tracking(0.8)
                                .foregroundStyle(Theme.accent)
                        }
                        Text(LocalizedStringKey(pkg.name))
                            .font(.system(size: 16, weight: .heavy))
                            .foregroundStyle(Theme.textPrimary)
                        Text(LocalizedStringKey(pkg.forWho))
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(localization.formatCurrency(Double(pkg.price), fractionDigits: 0))
                            .font(.system(size: 20, weight: .heavy))
                            .foregroundStyle(selected ? Theme.accent : Theme.textPrimary)
                        Text(LocalizedStringKey(pkg.timeline))
                            .font(.system(size: 10))
                            .foregroundStyle(Theme.textTertiary)
                    }
                }

                Divider().background(Theme.stroke)

                VStack(alignment: .leading, spacing: 5) {
                    ForEach(pkg.features, id: \.self) { feature in
                        HStack(alignment: .top, spacing: 6) {
                            if feature.hasPrefix("Everything") {
                                Text(LocalizedStringKey(feature))
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(Theme.accent)
                            } else {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(Theme.success)
                                    .frame(width: 14)
                                    .padding(.top, 1)
                                Text(LocalizedStringKey(feature))
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                    }
                }
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(selected ? Theme.accent.opacity(0.06) : Theme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(selected ? Theme.accent : Theme.stroke,
                                  lineWidth: selected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Submitted view

    private var submittedView: some View {
        VStack(spacing: 20) {
            Spacer(minLength: 60)
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 64))
                .foregroundStyle(Theme.success)
            Text(LocalizedStringKey(CI.submittedHeader))
                .font(.system(size: 22, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            VStack(spacing: 10) {
                Text(LocalizedStringKey(CI.submittedCopy))
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 8) {
                    nextStepRow(n: 1, text: CI.submittedStep1)
                    nextStepRow(n: 2, text: CI.submittedStep2)
                    nextStepRow(n: 3, text: CI.submittedStep3)
                    nextStepRow(n: 4, text: CI.submittedStep4)
                }
                .padding(16)
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal, 20)
            }

            Button { dismiss() } label: {
                Text("common.done")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .padding(.horizontal, 32)

            Spacer()
        }
    }

    private func nextStepRow(n: Int, text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(Theme.accent, in: Circle())
            Text(LocalizedStringKey(text))
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
        }
    }

    // MARK: - Helpers

    private func intakeLabel(_ text: String) -> some View {
        Text(LocalizedStringKey(text))
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(Theme.textTertiary)
            .textCase(.uppercase)
    }

    @ViewBuilder
    private func intakeField(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            intakeLabel(label)
            content()
        }
    }

    private func radioRow(label: String, value: String, binding: Binding<String>) -> some View {
        Button { binding.wrappedValue = value } label: {
            HStack {
                Text(LocalizedStringKey(label))
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                if binding.wrappedValue == value {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Theme.accent)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(
                binding.wrappedValue == value ? Theme.accent.opacity(0.09) : Theme.surfaceElevated,
                in: RoundedRectangle(cornerRadius: 10)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(binding.wrappedValue == value ? Theme.accent.opacity(0.4) : Theme.stroke,
                                  lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Step 5: Confirmation

    private var step5: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(LocalizedStringKey(CI.sectionInfoTitle))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text("\(contactFirstName) \(contactLastName)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                Text(contactEmail)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                Text(phone)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                if !referralSource.isEmpty {
                    Text(localization.format(CI.summaryHeard, referralLabel(referralSource)))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .cardStyle()

            VStack(alignment: .leading, spacing: 6) {
                Text(LocalizedStringKey(CI.sectionBusinessTitle))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(localization.format(CI.summarySkill, skillDescription))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                Text(localization.format(CI.summaryMarket, targetMarket))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                Text(localization.format(CI.summaryCountry, Self.countryName(operatingCountry)))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                Text(localization.format(CI.summaryRegion, operatingState))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                if !currentPhase.isEmpty, let id = Int(currentPhase),
                   let phase = Self.businessPhases.first(where: { $0.id == id }) {
                    Text(localization.format(CI.summaryPhase, phase.id, phase.name))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .cardStyle()

            VStack(alignment: .leading, spacing: 6) {
                Text(LocalizedStringKey(CI.sectionPackageTitle))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                if let pkg = Self.packages.first(where: { $0.id == packageSelected }) {
                    Text(localization.format(CI.summaryPackage, pkg.name, pkg.price))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }
                Text(localization.format(CI.summaryUrgency, urgencyLabel))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                Text(localization.format(CI.summaryItems, setupItemsSummary))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .cardStyle()

            Text(LocalizedStringKey(CI.summaryNext))
                .font(.system(size: 11))
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.leading)
        }
    }

    private func setupItemRow(_ item: SetupItem) -> some View {
        let isOn = selectedSetupItemIds.contains(item.id)
        return Button {
            guard !selectAllChosen else { return }
            if isOn { selectedSetupItemIds.remove(item.id) }
            else { selectedSetupItemIds.insert(item.id) }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(isOn ? Theme.accent : Theme.textTertiary)
                Text(LocalizedStringKey(item.label))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
        .disabled(selectAllChosen)
    }

    private var skillDescription: String {
        if skillSelection == "__other__" { return customSkill }
        return skillSelection
    }

    private var urgencyLabel: String {
        switch urgency {
        case "exploring": return localization.localized("consulting.intake.urgency.exploring")
        case "two_weeks": return localization.localized("consulting.intake.urgency.two_weeks")
        case "asap": return localization.localized("consulting.intake.urgency.asap")
        default: return localization.localized("—")
        }
    }

    private var setupItemsSummary: String {
        if selectAllChosen { return localization.localized("consulting.intake.confirmation.all_items") }
        let ids = Array(selectedSetupItemIds)
        let labels = ids.compactMap { Self.setupItemLabelById[$0] }
        let localizedLabels = labels.map { localization.localized($0) }.sorted()
        if localizedLabels.isEmpty { return localization.localized("—") }
        if localizedLabels.count <= 5 { return localizedLabels.joined(separator: ", ") }
        return localization.format("%d items (first 5): %@", localizedLabels.count, localizedLabels.prefix(5).joined(separator: ", "))
    }

    private func referralLabel(_ value: String) -> String {
        if let label = referralOptions.first(where: { $0.value == value })?.label {
            return localization.localized(label)
        }
        return value
    }

    // MARK: - Submit

    private func submit() async {
        isSubmitting = true
        submitError = nil
        defer { isSubmitting = false }

        let skill = skillSelection == "__other__" ? customSkill : skillSelection
        let selectedItems = Array(selectedSetupItemIds)
        let pkg = Self.packages.first { $0.id == packageSelected }

        struct Req: Encodable {
            let email: String
            let first_name: String
            let last_name: String
            let phone: String
            let referral_source: String
            let skill_description: String
            let target_market: String
            let has_revenue: String
            let business_name_decided: Bool
            let business_name: String?
            let operating_country: String
            let operating_state: String
            let setup_items_selected: [String]
            let select_all_chosen: Bool
            let current_phase: Int?
            let additional_notes: String?
            let urgency: String
            let package_selected: String
            let package_price: Int
        }
        // Matches server response from `POST /api/consulting/business-launch/submit`.
        struct Resp: Decodable {
            let success: Bool?
            // Production returns a UUID string (older versions were numeric IDs).
            let requestId: String?
            let message: String?
        }

        let body = Req(
            email: contactEmail,
            first_name: contactFirstName,
            last_name: contactLastName,
            phone: phone,
            referral_source: referralSource,
            skill_description: skill,
            target_market: targetMarket,
            has_revenue: hasRevenue,
            business_name_decided: businessNameDecided == "yes",
            business_name: businessNameDecided == "yes" ? businessName : nil,
            operating_country: operatingCountry,
            operating_state: operatingState,
            setup_items_selected: selectedItems,
            select_all_chosen: selectAllChosen,
            current_phase: currentPhase.isEmpty ? nil : Int(currentPhase),
            additional_notes: additionalNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil : additionalNotes,
            urgency: urgency,
            package_selected: packageSelected,
            package_price: pkg?.price ?? 0
        )

        do {
            let resp = try await AuthAPIClient.shared.request(
                "/api/consulting/business-launch/submit",
                method: .POST,
                body: body,
                requiresAuth: auth.user != nil,
                as: Resp.self
            )
            if resp.success != true {
                submitError = resp.message ?? localization.localized(CI.submitError)
                return
            }
            withAnimation { submitted = true }
        } catch let modErr as ContentModerator.Error {
            if case .blocked(let reason) = modErr { submitError = reason }
        } catch let apiErr as APIError {
            submitError = apiErr.errorDescription ?? localization.localized(CI.submitError)
        } catch {
            submitError = (error as? LocalizedError)?.errorDescription ?? localization.localized(CI.submitError)
        }
    }

    // MARK: - Static data

    struct SetupItem: Identifiable { let id: String; let label: String }
    struct SetupGroup: Identifiable { let id: String; let name: String; let items: [SetupItem] }

    /// Mirrors the website's consulting intake setup items (5/client/src/pages/ConsultingIntakePage.jsx + 5/client/src/locales/en.json).
    static let setupGroups: [SetupGroup] = [
        .init(id: "groupBusinessFormation", name: "Business Formation", items: [
            .init(id: "llc_filing", label: "LLC or Business Entity Filing"),
            .init(id: "ein_registration", label: "EIN (Federal Tax ID) Registration"),
            .init(id: "business_address", label: "Business Mailing Address Setup"),
            .init(id: "operating_docs", label: "Operating Documents Folder (organized digital records)"),
        ]),
        .init(id: "groupDigitalIdentity", name: "Digital Identity", items: [
            .init(id: "domain_registration", label: "Domain Name Registration"),
            .init(id: "business_email", label: "Professional Email (e.g. you@yourbusiness.com)"),
            .init(id: "business_phone", label: "Dedicated Business Phone Number"),
            .init(id: "logo_branding", label: "Logo & Basic Brand Kit (colors, fonts, simple logo)"),
        ]),
        .init(id: "groupOnlinePresence", name: "Online Presence", items: [
            .init(id: "website_build", label: "Website Build (homepage, services, about, contact)"),
            .init(id: "contact_form", label: "Contact Form & Lead Capture"),
            .init(id: "google_business", label: "Google Business Profile Setup"),
            .init(id: "social_media", label: "Social Media Handle Reservation"),
        ]),
        .init(id: "groupBusinessOperations", name: "Business Operations", items: [
            .init(id: "payment_processor", label: "Payment Processor Setup (Stripe, Square, or PayPal)"),
            .init(id: "scheduling_system", label: "Online Scheduling System (booking page)"),
            .init(id: "client_intake", label: "Client Intake Form & Workflow"),
            .init(id: "invoice_templates", label: "Invoice & Proposal Templates"),
            .init(id: "bookkeeping_system", label: "Basic Bookkeeping Starter System"),
        ]),
        .init(id: "groupLaunchSupport", name: "Launch Support", items: [
            .init(id: "outreach_templates", label: "First Client Outreach Templates"),
            .init(id: "referral_system", label: "Referral Request System"),
            .init(id: "online_listings", label: "Online Business Listings Setup"),
            .init(id: "launch_support", label: "Post-Launch 30-Day Support"),
        ]),
        .init(id: "groupAiResearchTools", name: "AI & Research Tools", items: [
            .init(id: "ai_market_research", label: "AI Market Research"),
            .init(id: "ai_competitor_analysis", label: "AI Competitor Analysis"),
            .init(id: "ai_content_creation", label: "AI Content Creation"),
            .init(id: "ai_business_plan", label: "AI Business Plan"),
            .init(id: "ai_pricing_strategy", label: "AI Pricing Strategy"),
        ]),
        .init(id: "groupStrategyPlanning", name: "Strategy & Planning", items: [
            .init(id: "business_strategy", label: "Business Strategy Session"),
            .init(id: "market_positioning", label: "Market Positioning"),
            .init(id: "niche_definition", label: "Niche Definition"),
            .init(id: "service_package_design", label: "Service Package Design"),
            .init(id: "growth_roadmap", label: "Growth Roadmap"),
        ]),
        .init(id: "groupMarketingContent", name: "Marketing & Content", items: [
            .init(id: "email_marketing_setup", label: "Email Marketing Setup"),
            .init(id: "social_content_plan", label: "Social Media Content Plan"),
            .init(id: "sales_pitch_dev", label: "Sales Pitch Development"),
            .init(id: "website_copy", label: "Website Copy Writing"),
            .init(id: "marketing_materials", label: "Marketing Materials"),
        ]),
        .init(id: "groupOperationsAutomation", name: "Operations & Automation", items: [
            .init(id: "workflow_automation", label: "Workflow Automation"),
            .init(id: "client_followup", label: "Client Follow-up System"),
            .init(id: "lead_qualification", label: "Lead Qualification Process"),
            .init(id: "database_organization", label: "Database Organization"),
            .init(id: "document_template_lib", label: "Document Template Library"),
        ]),
        .init(id: "groupFinancialBusiness", name: "Financial & Business", items: [
            .init(id: "pricing_calculator", label: "Pricing Calculator"),
            .init(id: "expense_tracking", label: "Expense Tracking System"),
            .init(id: "financial_dashboard", label: "Financial Dashboard"),
            .init(id: "tax_planning_guide", label: "Tax Planning Guide"),
            .init(id: "profit_margin_analysis", label: "Profit Margin Analysis"),
        ]),
        .init(id: "groupCustomerSuccess", name: "Customer Success", items: [
            .init(id: "customer_onboarding", label: "Customer Onboarding Process"),
            .init(id: "customer_retention", label: "Customer Retention Strategy"),
            .init(id: "feedback_system", label: "Feedback System Setup"),
            .init(id: "case_study_dev", label: "Case Study Development"),
        ]),
        .init(id: "groupInfrastructureHosting", name: "Infrastructure & Hosting", items: [
            .init(id: "cloud_server_setup", label: "Cloud Server Setup"),
            .init(id: "coolify_deployment", label: "Coolify Deployment"),
            .init(id: "cloudflare_config", label: "Cloudflare Configuration"),
            .init(id: "ssl_tls_setup", label: "SSL/TLS Certificate Setup"),
            .init(id: "server_monitoring", label: "Server Monitoring & Alerts"),
        ]),
        .init(id: "groupDatabaseData", name: "Database & Data Management", items: [
            .init(id: "postgres_setup", label: "PostgreSQL Database Setup"),
            .init(id: "database_optimization", label: "Database Optimization"),
            .init(id: "data_backup_recovery", label: "Data Backup & Recovery"),
            .init(id: "data_migration", label: "Data Migration"),
        ]),
        .init(id: "groupWebAppDev", name: "Web Application Development", items: [
            .init(id: "frontend_framework", label: "Frontend Framework Setup"),
            .init(id: "backend_api_dev", label: "Backend API Development"),
            .init(id: "fullstack_app_build", label: "Full-Stack Application Build"),
            .init(id: "api_integration", label: "API Integration"),
            .init(id: "perf_optimization", label: "Performance Optimization"),
        ]),
        .init(id: "groupDevOps", name: "DevOps & Automation", items: [
            .init(id: "cicd_pipeline", label: "CI/CD Pipeline Setup"),
            .init(id: "docker_containerization", label: "Docker Containerization"),
            .init(id: "infrastructure_as_code", label: "Infrastructure as Code"),
            .init(id: "automated_backups", label: "Automated Backups"),
        ]),
        .init(id: "groupSecurityCompliance", name: "Security & Compliance", items: [
            .init(id: "security_audit", label: "Security Audit & Hardening"),
            .init(id: "user_auth_setup", label: "User Authentication Setup"),
            .init(id: "gdpr_compliance", label: "Data Privacy & GDPR Compliance"),
        ]),
        .init(id: "groupIntegrationsAutomation", name: "Integrations & Automation", items: [
            .init(id: "webhook_api_automation", label: "Webhook & API Automation"),
            .init(id: "email_sms_integration", label: "Email & SMS Integration"),
        ]),
        .init(id: "groupCustomSolutions", name: "Custom Solutions", items: [
            .init(id: "custom_saas_dev", label: "Custom SaaS Development"),
            .init(id: "legacy_modernization", label: "Legacy System Modernization"),
        ]),
    ]

    static let setupItemLabelById: [String: String] = {
        var dict: [String: String] = [:]
        for group in setupGroups {
            for item in group.items { dict[item.id] = item.label }
        }
        return dict
    }()

    static let allSetupItemIds: [String] = setupGroups.flatMap { $0.items.map(\.id) }

    static let countryCodes: [String] = NSLocale.isoCountryCodes.sorted()
    static func countryName(_ code: String) -> String {
        Locale.current.localizedString(forRegionCode: code) ?? code
    }

    // Mirrors the website `SKILL_OPTIONS` list from 5/client/src/pages/ConsultingIntakePage.jsx.
    static let skillOptionsWebsite: [String] = [
        "Landscaping", "Lawn Mowing", "Tree Trimming", "Snow Removal",
        "Cleaning", "Deep Cleaning", "Pressure Washing", "Window Cleaning", "Carpet Cleaning",
        "Painting", "Interior Painting", "Exterior Painting", "Cabinet Painting", "Deck Staining",
        "Home Repair", "Drywall Repair", "Tile & Grout", "Fixture Installation", "Handyman",
        "Electrical", "Panel Upgrades", "EV Charger Install", "Lighting Installation",
        "Plumbing", "Leak Repair", "Drain Cleaning", "Water Heater",
        "HVAC", "AC Repair", "Furnace Service", "Duct Cleaning",
        "Carpentry", "Custom Cabinetry", "Deck Building", "Trim & Molding",
        "Roofing", "Roof Repair", "Roof Replacement", "Gutter Install",
        "Flooring", "Hardwood Installation", "Tile Installation", "Carpet Install",
        "Concrete", "Driveway Pour", "Patio Slab", "Stamped Concrete",
        "Welding", "MIG Welding", "Metal Fabrication", "Custom Metalwork",
        "Moving", "Packing & Unpacking", "Junk Removal", "Furniture Assembly",
        "Pest Control", "Rodent Control", "Termite Treatment",
        "Auto", "Mobile Mechanic", "Mobile Detailing", "Oil Change",
        "Appliance Repair", "Washer & Dryer Repair", "Refrigerator Repair",
        "Security", "Security Camera Install", "Smart Lock Install",
        "Pet Care", "Pet Sitting", "Dog Walking",
        "Tutoring", "Elder Care Assistance", "Home Organization",
        "Bookkeeping", "Accounting", "Tax Preparation",
        "Graphic Design", "Logo Design", "Brand Identity",
        "Web Design", "Web Development", "App Development",
        "Digital Marketing", "Social Media Management", "SEO",
        "Photography", "Videography", "Video Editing",
        "Copywriting", "Content Writing", "Ghostwriting",
        "Virtual Assistant", "Data Entry", "Customer Service",
        "Event Planning", "Catering", "Personal Chef",
        "Fitness Training", "Life Coaching", "Business Coaching",
        "Real Estate", "Property Management", "Interior Design",
        "IT Support", "Network Setup", "Cybersecurity",
    ]

    struct ConsultingPackage: Identifiable {
        let id: String
        let name: String
        let price: Int
        let timeline: String
        let forWho: String
        let features: [String]
        let popular: Bool
    }

    static let packages: [ConsultingPackage] = [
        ConsultingPackage(
            id: "initial", name: "Initial Consultation", price: 100,
            timeline: "Up to 2 hours",
            forWho: "Explore whether a program is right for you",
            features: [
                "Strategy deep-dive call (up to 2 hours)",
                "Business assessment & opportunity audit",
                "Implementation roadmap & timeline",
                "Custom recommendation for next steps",
                "Q&A on your specific situation",
            ], popular: false),
        ConsultingPackage(
            id: "foundation", name: "Business Foundation", price: 750,
            timeline: "1–2 weeks",
            forWho: "Just need the legal and identity layer set up",
            features: [
                "Business name guidance",
                "Domain registration",
                "Professional email setup",
                "Business phone number",
                "Business address setup",
                "LLC filing guidance + EIN support",
                "Organized documents folder",
            ], popular: false),
        ConsultingPackage(
            id: "launch", name: "Business Launch", price: 1_500,
            timeline: "2–3 weeks",
            forWho: "Want a fully operational business presence",
            features: [
                "Everything in Foundation plus:",
                "Logo & basic brand kit",
                "4-page website (Home, Services, About, Contact)",
                "Contact form & lead capture",
                "Online scheduling setup",
                "Payment processor setup",
                "Invoice template",
                "Launch checklist & go-live review",
            ], popular: true),
        ConsultingPackage(
            id: "accelerator", name: "Business Accelerator", price: 3_000,
            timeline: "3–4 weeks",
            forWho: "Want everything done and a system to grow",
            features: [
                "Everything in Launch plus:",
                "Google Business Profile setup",
                "Social media handle reservation",
                "Client intake workflow",
                "Bookkeeping starter system",
                "Referral request system",
                "Online listings setup",
                "30-day post-launch check-in call",
                "First client outreach templates",
            ], popular: false),
    ]

    // Mirrors the website's `consulting.intake.businessPhases.phase1..phase25` names (en.json).
    struct BusinessPhase: Identifiable { let id: Int; let name: String }
    static let businessPhases: [BusinessPhase] = [
        .init(id: 1, name: "Skill Clarity"),
        .init(id: 2, name: "Offer Selection"),
        .init(id: 3, name: "Customer Definition"),
        .init(id: 4, name: "Pricing Setup"),
        .init(id: 5, name: "Business Name Decision"),
        .init(id: 6, name: "Domain Registration"),
        .init(id: 7, name: "Brand Starter Kit"),
        .init(id: 8, name: "Business Email Setup"),
        .init(id: 9, name: "Phone Number Setup"),
        .init(id: 10, name: "Business Address Setup"),
        .init(id: 11, name: "LLC or Entity Filing"),
        .init(id: 12, name: "EIN Registration"),
        .init(id: 13, name: "Operating Docs Folder"),
        .init(id: 14, name: "Business Bank Account"),
        .init(id: 15, name: "Payment Processor Setup"),
        .init(id: 16, name: "Accounting Starter System"),
        .init(id: 17, name: "Website Launch"),
        .init(id: 18, name: "Contact Form & Lead Capture"),
        .init(id: 19, name: "Scheduling System"),
        .init(id: 20, name: "Service Agreement Templates"),
        .init(id: 21, name: "Client Intake Workflow"),
        .init(id: 22, name: "Social Proof Setup"),
        .init(id: 23, name: "Google Business & Online Listings"),
        .init(id: 24, name: "Launch Outreach System"),
        .init(id: 25, name: "First Client Operating System"),
    ]
}

// MARK: - FlowLayout (wrapping chip grid)

private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 0
        var height: CGFloat = 0
        var x: CGFloat = 0
        var rowHeight: CGFloat = 0

        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > width && x > 0 {
                height += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        height += rowHeight
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX && x > bounds.minX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - TextField style helper

private extension View {
    func intakeFieldStyle() -> some View {
        self
            .font(.system(size: 14))
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 12).padding(.vertical, 12)
            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}
