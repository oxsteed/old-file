import SwiftUI

// MARK: - Subscribe To Helper Sheet

/// Customer-side sheet launched from HelperProfileView.
/// Lets the customer subscribe to a recurring service (e.g. "Weekly Lawn Care").
struct SubscribeToHelperSheet: View {
    let helper: APIHelper
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager

    @State private var serviceName    = ""
    @State private var frequency      = "weekly"
    @State private var preferredDay   = "Monday"
    @State private var preferredTime  = "09:00"
    @State private var notes          = ""
    @State private var isSubmitting   = false
    @State private var submitError: String?
    @State private var didSubscribe   = false

    private let frequencies   = ["weekly", "biweekly", "monthly"]
    private let days          = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
    private let timeOptions   = ["07:00","08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00"]

    var body: some View {
        NavigationStack {
            ScrollView {
                if didSubscribe {
                    successView
                } else {
                    formView
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("recurring.subscribe.nav_title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(didSubscribe ? LocalizedStringKey("common.done") : LocalizedStringKey("common.cancel")) { dismiss() }
                        .foregroundStyle(Theme.accent)
                }
            }
        }
    }

    // MARK: - Form

    private var formView: some View {
        VStack(spacing: 16) {
            // Helper card
            HStack(spacing: 12) {
                AsyncImage(url: URL(string: helper.avatar ?? "")) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "person.crop.circle.fill")
                        .font(.system(size: 24)).foregroundStyle(Theme.textTertiary)
                }
                .frame(width: 48, height: 48)
                .clipShape(Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(helper.displayName)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text("recurring.subscribe.subtitle")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
            }
            .cardStyle()

            // Service name
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("recurring.subscribe.field.service")
                TextField("recurring.subscribe.placeholder.service", text: $serviceName)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(12)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
            }

            // Frequency
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("recurring.subscribe.field.frequency")
                HStack(spacing: 8) {
                    ForEach(frequencies, id: \.self) { f in
                        Button { frequency = f } label: {
                            Text(LocalizedStringKey("recurring.frequency.\(f)"))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(frequency == f ? .white : Theme.textSecondary)
                                .padding(.horizontal, 16).padding(.vertical, 9)
                                .background(
                                    frequency == f ? Theme.accent : Theme.surfaceElevated,
                                    in: Capsule()
                                )
                                .overlay(
                                    Capsule().strokeBorder(
                                        frequency == f ? Theme.accent : Theme.stroke,
                                        lineWidth: 1
                                    )
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Preferred day
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("recurring.subscribe.field.preferred_day")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(days, id: \.self) { d in
                            Button { preferredDay = d } label: {
                                Text(LocalizedStringKey("day.short.\(d.lowercased())"))
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(preferredDay == d ? .white : Theme.textSecondary)
                                    .frame(width: 44, height: 36)
                                    .background(
                                        preferredDay == d ? Theme.accent : Theme.surfaceElevated,
                                        in: RoundedRectangle(cornerRadius: 10)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10).strokeBorder(
                                            preferredDay == d ? Theme.accent : Theme.stroke,
                                            lineWidth: 1
                                        )
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            // Preferred time
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("recurring.subscribe.field.preferred_time")
                Picker("", selection: $preferredTime) {
                    ForEach(timeOptions, id: \.self) { t in
                        Text(friendlyTime(t)).tag(t)
                    }
                }
                .pickerStyle(.wheel)
                .frame(height: 100)
                .clipped()
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
            }

            // Notes
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("recurring.subscribe.field.notes_optional")
                TextField("recurring.subscribe.placeholder.notes", text: $notes, axis: .vertical)
                    .lineLimit(3, reservesSpace: true)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(12)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
            }

            if let submitError {
                Text(submitError).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button { Task { await subscribe() } } label: {
                HStack(spacing: 8) {
                    if isSubmitting { ProgressView().tint(.white).scaleEffect(0.85) }
                    else { Image(systemName: "repeat.circle.fill").font(.system(size: 14)) }
                    Text("recurring.subscribe.action_subscribe").font(.system(size: 15, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(
                    serviceName.trimmingCharacters(in: .whitespaces).isEmpty
                        ? Theme.textTertiary : Theme.accent,
                    in: RoundedRectangle(cornerRadius: 14)
                )
            }
            .buttonStyle(.plain)
            .disabled(isSubmitting || serviceName.trimmingCharacters(in: .whitespaces).isEmpty)

            Text("recurring.subscribe.footer")
                .font(.system(size: 11))
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
        }
        .padding(20)
    }

    // MARK: - Success

    private var successView: some View {
        VStack(spacing: 22) {
            Spacer(minLength: 40)
            ZStack {
                Circle().fill(Theme.success.opacity(0.14)).frame(width: 90, height: 90)
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44, weight: .bold))
                    .foregroundStyle(Theme.success)
            }
            Text("recurring.subscribe.success.title")
                .font(.system(size: 24, weight: .heavy, design: .rounded))
                .foregroundStyle(Theme.textPrimary)
            Text(localization.format("recurring.subscribe.success.message_format", helper.displayName))
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)
            Button { dismiss() } label: {
                Text("common.done")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20)
            Spacer()
        }
    }

    // MARK: - Helpers

    private func fieldLabel(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Theme.textTertiary)
            .textCase(.uppercase)
    }

    private func friendlyTime(_ t: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        guard let d = f.date(from: t) else { return t }
        return localization.formatTime(d)
    }

    private func subscribe() async {
        isSubmitting = true
        submitError = nil
        defer { isSubmitting = false }
        do {
            let req = RecurringBookingsService.CreateRequest(
                helper_id: helper.id,
                service_name: serviceName.trimmingCharacters(in: .whitespaces),
                frequency: frequency,
                preferred_day: preferredDay,
                preferred_time: preferredTime,
                notes: notes.isEmpty ? nil : notes
            )
            _ = try await RecurringBookingsService.create(req)
            withAnimation { didSubscribe = true }
        } catch {
            submitError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - My Subscriptions View

/// Customer's list of active recurring service subscriptions.
/// Embedded in CustomerHome and accessible from the Bookings section.
struct MySubscriptionsView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var subscriptions: [APIRecurringBooking] = []
    @State private var isLoading = false
    @State private var loadError: String?
    @State private var confirmCancel: APIRecurringBooking?
    @State private var actionError: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && subscriptions.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let loadError, subscriptions.isEmpty {
                    VStack(spacing: 14) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundStyle(Theme.danger)
                        Text("recurring.my.error.load_failed")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                        Text(loadError)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 30)
                        Button {
                            Task { await load() }
                        } label: {
                            Label("common.retry", systemImage: "arrow.clockwise")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 18)
                                .padding(.vertical, 11)
                                .background(Theme.accent, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if subscriptions.isEmpty {
                    emptyState
                } else {
                    ScrollView {
                        VStack(spacing: 12) {
                            if let loadError {
                                Text(loadError)
                                    .font(.system(size: 12)).foregroundStyle(Theme.danger)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 20)
                            }
                            if let actionError {
                                Text(actionError)
                                    .font(.system(size: 12)).foregroundStyle(Theme.danger)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 20)
                            }
                            ForEach(subscriptions) { sub in
                                subscriptionRow(sub)
                                    .padding(.horizontal, 20)
                            }
                        }
                        .padding(.vertical, 16)
                    }
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("recurring.my.nav_title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .task { await load() }
        .alert("recurring.my.cancel_alert.title", isPresented: Binding(
            get: { confirmCancel != nil },
            set: { if !$0 { confirmCancel = nil } }
        )) {
            Button("recurring.my.cancel_alert.keep", role: .cancel) { confirmCancel = nil }
            Button("recurring.my.cancel_alert.confirm", role: .destructive) {
                if let sub = confirmCancel { Task { await cancel(sub) } }
            }
        } message: {
            Text("recurring.my.cancel_alert.message")
        }
    }

    // MARK: - Row

    private func subscriptionRow(_ sub: APIRecurringBooking) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(Theme.accent.opacity(0.12)).frame(width: 40, height: 40)
                    Image(systemName: "repeat.circle.fill")
                        .font(.system(size: 18)).foregroundStyle(Theme.accent)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(sub.service_name ?? "Service")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(sub.helper_name ?? "Helper")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                statusBadge(sub.status)
            }

            HStack(spacing: 16) {
                if let freq = sub.frequency {
                    infoChip(icon: "calendar", text: localization.localized("recurring.frequency.\(freq.lowercased())"))
                }
                if let day = sub.preferred_day {
                    infoChip(icon: "clock", text: "\(day)s")
                }
                if let next = sub.next_date {
                    infoChip(icon: "arrow.right.circle", text: localization.format("recurring.my.next_format", String(next.prefix(10))))
                }
            }

            // Actions
            HStack(spacing: 8) {
                if sub.status == "paused" {
                    actionChip("recurring.my.action.resume", icon: "play.fill", color: Theme.success) {
                        Task { await resume(sub) }
                    }
                } else if sub.status == "active" {
                    actionChip("recurring.my.action.pause", icon: "pause.fill", color: Theme.warning) {
                        Task { await pause(sub) }
                    }
                }
                if sub.status != "cancelled" {
                    actionChip("common.cancel", icon: "xmark", color: Theme.danger) {
                        confirmCancel = sub
                    }
                }
            }
        }
        .cardStyle()
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "repeat.circle")
                .font(.system(size: 40)).foregroundStyle(Theme.textTertiary)
            Text("recurring.my.empty.title")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            Text("recurring.my.empty.subtitle")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 30)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Helper views

    private func statusBadge(_ status: String?) -> some View {
        let (label, color): (LocalizedStringKey, Color) = {
            switch status {
            case "active":    return ("recurring.status.active", Theme.success)
            case "paused":    return ("recurring.status.paused", Theme.warning)
            case "cancelled": return ("recurring.status.cancelled", Theme.danger)
            default:          return ("recurring.status.unknown", Theme.textTertiary)
            }
        }()
        return Text(label)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(color.opacity(0.12), in: Capsule())
    }

    private func infoChip(icon: String, text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold))
            Text(text).font(.system(size: 11, weight: .medium))
        }
        .foregroundStyle(Theme.textSecondary)
    }

    private func actionChip(_ label: LocalizedStringKey, icon: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 10, weight: .bold))
                Text(label).font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(color)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(color.opacity(0.10), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.25), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func load() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            subscriptions = try await RecurringBookingsService.list()
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func cancel(_ sub: APIRecurringBooking) async {
        confirmCancel = nil
        do {
            try await RecurringBookingsService.cancel(id: sub.id)
            subscriptions = subscriptions.filter { $0.id != sub.id }
        } catch {
            actionError = localization.localized("recurring.my.error.cancel_failed")
        }
    }

    private func pause(_ sub: APIRecurringBooking) async {
        do {
            try await RecurringBookingsService.pause(id: sub.id)
            await load()
        } catch {
            actionError = localization.localized("recurring.my.error.pause_failed")
        }
    }

    private func resume(_ sub: APIRecurringBooking) async {
        do {
            try await RecurringBookingsService.resume(id: sub.id)
            await load()
        } catch {
            actionError = localization.localized("recurring.my.error.resume_failed")
        }
    }
}
