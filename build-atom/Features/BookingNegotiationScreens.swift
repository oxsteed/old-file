import SwiftUI

// MARK: - Counter-Propose Booking

/// Helper-side sheet: suggest an alternative date/time for an incoming booking.
struct CounterProposeSheet: View {
    let bookingId: String
    /// Display name of the other party (customer or helper), shown in the header.
    var partyName: String = "the customer"
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var localization: LocalizationManager

    @State private var date       = Date().addingTimeInterval(86_400)   // tomorrow
    @State private var startTime  = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var endTime    = Calendar.current.date(bySettingHour: 10, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var message    = ""
    @State private var isLoading  = false
    @State private var lastError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Explanation
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.system(size: 22))
                            .foregroundStyle(Theme.accent)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Suggest a different time")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Theme.textPrimary)
                            Text(localization.format("counter_propose.notification", localization.localized(partyName)))
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .cardStyle()

                    // Date
                    VStack(alignment: .leading, spacing: 6) {
                        fieldLabel("Proposed Date")
                        DatePicker("", selection: $date, in: Date()..., displayedComponents: [.date])
                            .datePickerStyle(.compact)
                            .labelsHidden()
                            .foregroundStyle(Theme.textPrimary)
                            .padding(.horizontal, 12).padding(.vertical, 10)
                            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    // Start / End time
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            fieldLabel("Start")
                            DatePicker("", selection: $startTime, displayedComponents: [.hourAndMinute])
                                .datePickerStyle(.compact).labelsHidden()
                                .foregroundStyle(Theme.textPrimary)
                                .padding(10)
                                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            fieldLabel("End")
                            DatePicker("", selection: $endTime, displayedComponents: [.hourAndMinute])
                                .datePickerStyle(.compact).labelsHidden()
                                .foregroundStyle(Theme.textPrimary)
                                .padding(10)
                                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                        }
                    }

                    // Optional note
                    VStack(alignment: .leading, spacing: 6) {
                        fieldLabel("Note (optional)")
                        TextField("e.g. I have another job until noon", text: $message, axis: .vertical)
                            .lineLimit(3, reservesSpace: true)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textPrimary)
                            .padding(12)
                            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                    }

                    if let lastError {
                        Text(lastError).font(.system(size: 12))
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button { Task { await submit() } } label: {
                        HStack(spacing: 8) {
                            if isLoading { ProgressView().tint(.white).scaleEffect(0.85) }
                            else { Image(systemName: "paperplane.fill").font(.system(size: 13)) }
                            Text("Send Suggestion")
                                .font(.system(size: 15, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)
                    .disabled(isLoading)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Counter-Propose")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(LocalizedStringKey(text))
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Theme.textTertiary)
            .textCase(.uppercase)
    }

    private func submit() async {
        isLoading = true; lastError = nil
        defer { isLoading = false }
        do {
            try await BookingsService.counterPropose(
                bookingId: bookingId,
                date: isoDay(date),
                startTime: hhmm(startTime),
                endTime: hhmm(endTime),
                message: message.isEmpty ? nil : message
            )
            dismiss()
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func isoDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale   = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale   = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}

/// Customer-side row showing a pending counter-proposal with Accept / Decline actions.
struct CounterProposalBannerView: View {
    let booking: APIBooking
    var onResolved: (() -> Void)? = nil
    @EnvironmentObject private var localization: LocalizationManager
    @State private var isAccepting  = false
    @State private var isDeclining  = false
    @State private var resolved     = false

    var body: some View {
        if resolved { EmptyView() }
        else if let counter = booking.counter_proposed_at, !counter.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Label("Helper suggested a new time", systemImage: "calendar.badge.clock")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.warning)

                if let d = booking.counter_date { Text(localization.format("Date: %@", d)).font(.system(size: 13)).foregroundStyle(Theme.textPrimary) }
                if let s = booking.counter_start_time, let e = booking.counter_end_time {
                    Text(localization.format("Time: %@ – %@", s, e)).font(.system(size: 13)).foregroundStyle(Theme.textPrimary)
                }
                if let msg = booking.counter_message, !msg.isEmpty {
                    Text("\"\(msg)\"").font(.system(size: 12, design: .serif)).foregroundStyle(Theme.textSecondary)
                }

                HStack(spacing: 10) {
                    Button { Task { await respond(accept: true) } } label: {
                        HStack(spacing: 5) {
                            if isAccepting { ProgressView().tint(.white).scaleEffect(0.75) }
                            else { Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)) }
                            Text("Accept").font(.system(size: 13, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18).padding(.vertical, 9)
                        .background(Theme.success, in: Capsule())
                    }
                    .buttonStyle(.plain).disabled(isAccepting || isDeclining)

                    Button { Task { await respond(accept: false) } } label: {
                        HStack(spacing: 5) {
                            if isDeclining { ProgressView().tint(Theme.danger).scaleEffect(0.75) }
                            else { Image(systemName: "xmark").font(.system(size: 12, weight: .bold)) }
                            Text("Decline").font(.system(size: 13, weight: .bold))
                        }
                        .foregroundStyle(Theme.danger)
                        .padding(.horizontal, 18).padding(.vertical, 9)
                        .background(Theme.danger.opacity(0.10), in: Capsule())
                        .overlay(Capsule().strokeBorder(Theme.danger.opacity(0.3), lineWidth: 1))
                    }
                    .buttonStyle(.plain).disabled(isAccepting || isDeclining)
                }
            }
            .padding(14)
            .background(Theme.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.warning.opacity(0.25), lineWidth: 1))
        }
    }

    private func respond(accept: Bool) async {
        if accept { isAccepting = true } else { isDeclining = true }
        defer { isAccepting = false; isDeclining = false }
        _ = try? await BookingsService.respondToCounterPropose(bookingId: booking.id, accept: accept)
        resolved = true
        onResolved?()
    }
}

// MARK: - BookingsService extension (counter-propose)

extension BookingsService {
    struct CounterProposeRequest: Encodable {
        let counter_date: String
        let counter_start_time: String
        let counter_end_time: String
        let counter_message: String?
    }
    struct CounterProposeResponse: Decodable {
        let booking: APIBooking?
        let message: String?
    }

    static func counterPropose(bookingId: String,
                                date: String,
                                startTime: String,
                                endTime: String,
                                message: String?) async throws {
        let req = CounterProposeRequest(counter_date: date,
                                        counter_start_time: startTime,
                                        counter_end_time: endTime,
                                        counter_message: message)
        let _: CounterProposeResponse = try await APIClient.shared.request(
            "/api/bookings/\(bookingId)/counter-propose",
            method: .POST,
            body: req
        )
    }

    static func respondToCounterPropose(bookingId: String, accept: Bool) async throws {
        struct Req: Encodable { let action: String }
        let _: CounterProposeResponse = try await APIClient.shared.request(
            "/api/bookings/\(bookingId)/counter-propose/respond",
            method: .POST,
            body: Req(action: accept ? "accept" : "decline")
        )
    }
}

// Note: counter_propose fields are declared directly on APIBooking in APIModels.swift
