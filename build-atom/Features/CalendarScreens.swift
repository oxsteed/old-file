import SwiftUI

// MARK: - Calendar

struct CalendarView: View {
    @EnvironmentObject var cal: CalendarStore
    @State private var section: CalendarSection = .appointments
    @State private var busyBookingIds: Set<String> = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    Picker(LocalizedStringKey("picker.calendar_section"), selection: $section) {
                        ForEach(CalendarSection.allCases, id: \.self) { section in
                            Text(section.title).tag(section)
                        }
                    }
                    .pickerStyle(.segmented)

                    if cal.isLoading && cal.appointments.isEmpty && cal.bookingsIncoming.isEmpty && cal.bookingsMine.isEmpty {
                        ProgressView()
                            .tint(Theme.accent)
                            .padding(.top, 48)
                    } else if let error = cal.lastError,
                              cal.appointments.isEmpty,
                              cal.bookingsIncoming.isEmpty,
                              cal.bookingsMine.isEmpty {
                        LoadErrorCard(title: "Calendar could not load", message: error, retryTitle: "Try Again") {
                            Task { await cal.loadCalendarHome() }
                        }
                    } else {
                        sectionContent
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
        .task { await cal.loadCalendarHome() }
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch section {
        case .appointments:
            if cal.appointments.isEmpty {
                CalendarEmptyState(
                    icon: "calendar",
                    title: "No upcoming appointments",
                    message: "Accepted bookings and scheduled work will appear here."
                )
            } else {
                ForEach(cal.appointments) { appt in
                    AppointmentCalendarCard(appointment: appt)
                }
            }
        case .incoming:
            if cal.bookingsIncoming.isEmpty {
                CalendarEmptyState(
                    icon: "tray.fill",
                    title: "No incoming requests",
                    message: "New customer booking requests will appear here with accept and decline actions."
                )
            } else {
                ForEach(cal.bookingsIncoming) { booking in
                    BookingRequestCard(
                        booking: booking,
                        mode: .incoming,
                        isBusy: busyBookingIds.contains(booking.id),
                        onAccept: { Task { await performBookingAction(booking, action: .accept) } },
                        onDecline: { Task { await performBookingAction(booking, action: .decline) } },
                        onCancel: nil
                    )
                }
            }
        case .mine:
            if cal.bookingsMine.isEmpty {
                CalendarEmptyState(
                    icon: "clock.badge.checkmark",
                    title: "No requests sent",
                    message: "Bookings you request with helpers will appear here until they are accepted, declined, or cancelled."
                )
            } else {
                ForEach(cal.bookingsMine) { booking in
                    BookingRequestCard(
                        booking: booking,
                        mode: .mine,
                        isBusy: busyBookingIds.contains(booking.id),
                        onAccept: nil,
                        onDecline: nil,
                        onCancel: booking.canCustomerCancel ? { Task { await performBookingAction(booking, action: .cancel) } } : nil
                    )
                }
            }
        }
    }

    private func performBookingAction(_ booking: APIBooking, action: CalendarBookingAction) async {
        guard !busyBookingIds.contains(booking.id) else { return }
        busyBookingIds.insert(booking.id)
        defer { busyBookingIds.remove(booking.id) }

        switch action {
        case .accept:
            _ = await cal.acceptBooking(booking)
        case .decline:
            _ = await cal.declineBooking(booking, reason: "Declined in iOS calendar")
        case .cancel:
            _ = await cal.cancelBooking(booking)
        }
    }
}

private enum CalendarSection: CaseIterable {
    case appointments
    case incoming
    case mine

    var title: String {
        switch self {
        case .appointments: return "Appointments"
        case .incoming: return "Requests"
        case .mine: return "Sent"
        }
    }
}

private enum CalendarBookingAction {
    case accept
    case decline
    case cancel
}

private enum BookingRequestCardMode {
    case incoming
    case mine
}

private struct AppointmentCalendarCard: View {
    let appointment: APIAppointment

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "calendar.badge.clock")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 38, height: 38)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 11))

                VStack(alignment: .leading, spacing: 4) {
                    Text(appointment.service_title ?? appointment.job_title ?? "Appointment")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(appointment.subtitle)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer()
                CalendarStatusPill(text: appointment.status ?? "scheduled", color: Theme.accent)
            }
        }
        .cardStyle()
    }
}

private struct BookingRequestCard: View {
    let booking: APIBooking
    let mode: BookingRequestCardMode
    let isBusy: Bool
    let onAccept: (() -> Void)?
    let onDecline: (() -> Void)?
    let onCancel: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: mode == .incoming ? "person.crop.circle.badge.clock" : "paperplane.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(mode == .incoming ? Theme.success : Theme.accent)
                    .frame(width: 38, height: 38)
                    .background((mode == .incoming ? Theme.success : Theme.accent).opacity(0.14),
                                in: RoundedRectangle(cornerRadius: 11))

                VStack(alignment: .leading, spacing: 4) {
                    Text(booking.service_name ?? "Booking request")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(booking.subtitle(mode: mode))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer()
                CalendarStatusPill(text: booking.status ?? "pending", color: booking.statusColor)
            }

            if let description = booking.description?.trimmingCharacters(in: .whitespacesAndNewlines),
               !description.isEmpty {
                Text(description)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(3)
            }

            HStack(spacing: 8) {
                if isBusy {
                    ProgressView()
                        .tint(Theme.accent)
                        .frame(height: 34)
                } else {
                    if let onAccept {
                        Button(action: onAccept) {
                            Label("feature.accept", systemImage: "checkmark.circle.fill")
                                .calendarActionStyle(color: Theme.success, filled: true)
                        }
                        .buttonStyle(.plain)
                    }
                    if let onDecline {
                        Button(action: onDecline) {
                            Label("feature.decline", systemImage: "xmark.circle.fill")
                                .calendarActionStyle(color: Theme.danger, filled: false)
                        }
                        .buttonStyle(.plain)
                    }
                    if let onCancel {
                        Button(action: onCancel) {
                            Label("common.cancel", systemImage: "xmark.circle.fill")
                                .calendarActionStyle(color: Theme.danger, filled: false)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer()
            }
        }
        .cardStyle()
    }
}

private struct CalendarStatusPill: View {
    let text: String
    let color: Color
    @EnvironmentObject private var localization: LocalizationManager

    var body: some View {
        Text(localization.localized(text.replacingOccurrences(of: "_", with: " ").capitalized))
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(color.opacity(0.14), in: Capsule())
    }
}

private struct CalendarEmptyState: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(Theme.textTertiary)
                .frame(width: 66, height: 66)
                .background(Theme.surfaceElevated, in: Circle())
            Text(title)
                .font(.system(size: 18, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(2)
        }
        .frame(maxWidth: .infinity)
        .padding(22)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

private extension View {
    func calendarActionStyle(color: Color, filled: Bool) -> some View {
        self
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(filled ? .white : color)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(filled ? color : color.opacity(0.12), in: RoundedRectangle(cornerRadius: 11))
            .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(color.opacity(0.28), lineWidth: filled ? 0 : 1))
    }
}

private extension APIAppointment {
    var subtitle: String {
        let pieces = [scheduled_date, scheduled_start_at?.timeOnly, location]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return pieces.isEmpty ? "Scheduled appointment" : pieces.joined(separator: " · ")
    }
}

private extension APIBooking {
    var canCustomerCancel: Bool {
        let normalized = (status ?? "pending").lowercased()
        return normalized == "pending" || normalized == "accepted" || normalized == "expired"
    }

    var statusColor: Color {
        switch (status ?? "pending").lowercased() {
        case "accepted": return Theme.success
        case "declined", "cancelled", "accepted_cancelled": return Theme.danger
        case "expired": return Theme.warning
        default: return Theme.accent
        }
    }

    func subtitle(mode: BookingRequestCardMode) -> String {
        var pieces: [String] = []
        if mode == .incoming,
           let customer = customer_name?.trimmingCharacters(in: .whitespacesAndNewlines),
           !customer.isEmpty {
            pieces.append(customer)
        }
        let time = [requested_date, requested_start_time?.timeOnly, requested_end_time?.timeOnly]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if !time.isEmpty { pieces.append(time) }
        if let location = service_location?.trimmingCharacters(in: .whitespacesAndNewlines),
           !location.isEmpty {
            pieces.append(location)
        }
        return pieces.isEmpty ? "Booking request" : pieces.joined(separator: " · ")
    }
}

private extension String {
    var timeOnly: String {
        if contains("T") {
            return String(dropFirst(11).prefix(5))
        }
        if count >= 5 {
            return String(prefix(5))
        }
        return self
    }
}
