import SwiftUI

// MARK: - ConsultantPipelineView

struct ConsultantPipelineView: View {
    @StateObject private var store = ConsultingStore.shared
    @EnvironmentObject private var localization: LocalizationManager
    @State private var filterStatus: String = "all"
    @State private var editingReferral: ConsultingReferral? = nil

    private let statusColors: [String: Color] = [
        "assigned":             .gray,
        "intro_pending":        Color(hex: "#f59e0b"), // amber
        "intro_sent":           Color(hex: "#3b82f6"), // blue
        "discovery_scheduled":  Color(hex: "#6366f1"), // indigo
        "proposal_sent":        Color(hex: "#8b5cf6"), // purple
        "engaged":              Color(hex: "#f97316"), // orange
        "won":                  Color(hex: "#22c55e"), // green
        "lost":                 Color(hex: "#ef4444"), // red
        "completed":            Color(hex: "#10b981"), // emerald
        "paused":               Color(hex: "#64748b"), // slate
    ]

    private func color(for status: String) -> Color {
        statusColors[status] ?? .gray
    }

    private func label(for status: String) -> String {
        let key = "consulting.status.\(status)"
        let localized = localization.localized(key)
        if localized != key { return localized }
        return localization.localized(status.replacingOccurrences(of: "_", with: " ").capitalized)
    }

    private var filtered: [ConsultingReferral] {
        guard filterStatus != "all" else { return store.referrals }
        return store.referrals.filter { $0.assignmentStatus == filterStatus }
    }

    private func fmtCents(_ c: Int?) -> String {
        guard let c, c > 0 else { return "—" }
        let d = Double(c) / 100.0
        if d >= 1_000 {
            return localization.format("%@K", localization.formatNumber(d / 1_000, fractionDigits: 1))
        }
        return localization.formatCurrency(d, fractionDigits: 0)
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 18) {

                    // ── Summary bar ─────────────────────────────────────────
                    if let s = store.summary {
                        HStack(spacing: 0) {
                            pipelineChip(
                                value: "\(s.activeCount)",
                                label: localization.localized(L10n.ConsultingPipelineKey.active),
                                color: Theme.accent
                            )
                            Divider().frame(height: 32).background(Theme.stroke)
                            pipelineChip(
                                value: "\(s.wonCount)",
                                label: localization.localized(L10n.ConsultingPipelineKey.won),
                                color: Theme.success
                            )
                            Divider().frame(height: 32).background(Theme.stroke)
                            pipelineChip(
                                value: fmtCents(s.pipelineCents),
                                label: localization.localized(L10n.ConsultingPipelineKey.pipeline),
                                color: Theme.pillarPersonal
                            )
                        }
                        .padding(.vertical, 12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                    }

                    // ── Status filter pills ──────────────────────────────────
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            filterPill(id: "all", label: localization.localized("consulting.filter.all"))
                            ForEach(["assigned", "intro_pending", "discovery_scheduled",
                                     "proposal_sent", "engaged", "won", "lost"], id: \.self) { st in
                                filterPill(id: st, label: label(for: st))
                            }
                        }
                        .padding(.horizontal, 2)
                    }

                    // ── Referral list ────────────────────────────────────────
                    if store.isLoading && store.referrals.isEmpty {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 120)
                    } else if filtered.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "person.badge.plus")
                                .font(.system(size: 32))
                                .foregroundStyle(Theme.textSecondary)
                            Text(
                                filterStatus == "all"
                                ? localization.localized("consulting.empty.no_referrals_yet")
                                : localization.format("consulting.empty.none_with_status", label(for: filterStatus))
                            )
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 100)
                    } else {
                        VStack(spacing: 10) {
                            ForEach(filtered) { referral in
                                referralCard(referral)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
        }
        .navigationTitle(localization.localized(L10n.ConsultingPipelineKey.referralPipeline))
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.load() }
        .refreshable { await store.load(force: true) }
        .sheet(item: $editingReferral) { ref in
            ReferralEditSheet(referral: ref, store: store, validStatuses: store.validStatuses)
        }
    }

    // MARK: - Sub-views

    @ViewBuilder
    private func pipelineChip(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(color)
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func filterPill(id: String, label: String) -> some View {
        Button { filterStatus = id } label: {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(filterStatus == id ? .white : Theme.textSecondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(filterStatus == id ? Theme.accent : Theme.surface,
                            in: Capsule())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func referralCard(_ r: ConsultingReferral) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(r.displayName)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    if let biz = r.business_name, !biz.isEmpty {
                        Text(biz)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                Spacer()
                statusBadge(r.assignmentStatus)
            }

            if let desc = r.skill_description, !desc.isEmpty {
                Text(desc)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }

            HStack(spacing: 12) {
                if let pkg = r.package_selected, !pkg.isEmpty {
                    Label(pkg, systemImage: "shippingbox.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                if let share = r.estimated_consultant_share_cents, share > 0 {
                    Label(fmtCents(share), systemImage: "dollarsign.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.success)
                }
                Spacer()
                Button {
                    editingReferral = r
                } label: {
                            Text(localization.localized(L10n.ConsultingPipelineKey.update))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Theme.accent.opacity(0.12), in: Capsule())
                }
                .buttonStyle(.plain)
            }

            if let note = r.consultant_status_notes, !note.isEmpty {
                Text(localization.format(L10n.ConsultingPipelineKey.noteFormat, note))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.background, in: RoundedRectangle(cornerRadius: 8))
            }

            if let fu = r.consultant_follow_up_at {
                Label(localization.format(L10n.ConsultingPipelineKey.followUpDateFormat, formattedDate(fu)), systemImage: "calendar.badge.clock")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(hex: "#f59e0b"))
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder
    private func statusBadge(_ status: String) -> some View {
        Text(label(for: status))
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(color(for: status), in: Capsule())
    }

    private func formattedDate(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) {
            return localization.formatDate(d, dateStyle: .medium, timeStyle: .none)
        }
        return iso.prefix(10).description
    }
}

// MARK: - ReferralEditSheet

struct ReferralEditSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var localization: LocalizationManager
    @ObservedObject var store: ConsultingStore

    let referral: ConsultingReferral
    let validStatuses: [String]

    @State private var selectedStatus: String
    @State private var notes: String
    @State private var followUpDate: Date = Date()
    @State private var hasFollowUp = false
    @State private var isSaving = false

    init(referral: ConsultingReferral, store: ConsultingStore, validStatuses: [String]) {
        self.referral = referral
        _store = ObservedObject(wrappedValue: store)
        self.validStatuses = validStatuses
        _selectedStatus = State(initialValue: referral.assignmentStatus)
        _notes = State(initialValue: referral.consultant_status_notes ?? "")
    }

private func label(for status: String) -> String {
        let capitalized = status.replacingOccurrences(of: "_", with: " ").capitalized
        let key = "consulting.status.\(status)"
        let localized = localization.localized(key)
        if localized != key { return localized }
        return localization.localized(capitalized)
    }

    var body: some View {
        NavigationView {
            ZStack {
                Theme.background.ignoresSafeArea()
                Form {
                    Section(localization.localized(L10n.ConsultingPipelineKey.client)) {
                        Text(referral.displayName)
                            .font(.system(size: 15, weight: .semibold))
                        if let biz = referral.business_name, !biz.isEmpty {
                            Text(biz).foregroundStyle(Theme.textSecondary)
                        }
                    }

                    Section(localization.localized(L10n.ConsultingPipelineKey.status)) {
                        Picker(localization.localized(L10n.ConsultingPipelineKey.status), selection: $selectedStatus) {
                            ForEach(validStatuses.isEmpty
                                ? ["assigned","intro_pending","intro_sent","discovery_scheduled",
                                   "proposal_sent","engaged","won","lost","completed","paused"]
                                : validStatuses, id: \.self) { st in
                                Text(label(for: st)).tag(st)
                            }
                        }
                        .pickerStyle(.menu)
                    }

                    Section(localization.localized(L10n.ConsultingPipelineKey.notes)) {
                        TextEditor(text: $notes)
                            .frame(minHeight: 80)
                    }

                    Section {
                        Toggle(localization.localized(L10n.ConsultingPipelineKey.setFollowUpDate), isOn: $hasFollowUp)
                        if hasFollowUp {
                            DatePicker(localization.localized(L10n.ConsultingPipelineKey.followUp), selection: $followUpDate, displayedComponents: .date)
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
        .navigationTitle(localization.localized(L10n.ConsultingPipelineKey.updateReferral))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(LocalizedStringKey(L10n.CommonKey.cancel)) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            isSaving = true
                            let fuStr: String? = hasFollowUp
                                ? ISO8601DateFormatter().string(from: followUpDate)
                                : nil
                            await store.updateReferral(
                                id: referral.id,
                                status: selectedStatus,
                                notes: notes.isEmpty ? nil : notes,
                                followUpAt: fuStr
                            )
                            isSaving = false
                            dismiss()
                        }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text(localization.localized(L10n.CommonKey.save)).bold()
                        }
                    }
                    .disabled(isSaving)
                }
            }
        }
    }
}

// MARK: - Color hex helper (local if not already in codebase)

private extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: h).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8)  & 0xFF) / 255
        let b = Double(int         & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}
