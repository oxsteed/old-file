import Foundation

enum CalendarService {
    private struct AppointmentsResponse: Decodable {
        let appointments: [APIAppointment]
    }

    private struct AvailabilityBlocksResponse: Decodable {
        let blocks: [AvailabilityBlock]
    }

    private struct RescheduleResponse: Decodable {
        let action: String?
    }

    static func appointments(role: String? = nil, status: String? = nil,
                             from: String? = nil, to: String? = nil) async throws -> [APIAppointment] {
        var q: [String: Any] = [:]
        if let role { q["role"] = role }
        if let status { q["status"] = status }
        if let from { q["from_date"] = from }
        if let to { q["to_date"] = to }
        let response: AppointmentsResponse = try await APIClient.shared.request("/api/calendar/appointments", query: q)
        return response.appointments
    }

    static func create(_ req: AppointmentCreateRequest) async throws -> APIAppointment {
        try await APIClient.shared.request("/api/calendar/appointments", method: .POST, body: req)
    }

    static func detail(_ id: String) async throws -> APIAppointment {
        try await APIClient.shared.request("/api/calendar/appointments/\(id)")
    }

    static func confirm(_ id: String) async throws -> APIAppointment {
        try await APIClient.shared.request("/api/calendar/appointments/\(id)/confirm", method: .POST)
    }

    static func cancel(_ id: String, reason: String) async throws {
        struct Req: Encodable { let reason: String }
        try await APIClient.shared.requestVoid("/api/calendar/appointments/\(id)/cancel", method: .POST, body: Req(reason: reason))
    }

    // MARK: - Reschedule requests

    static func requestReschedule(_ appointmentId: String,
                                  proposedDate: String,
                                  proposedStartTime: String,
                                  proposedEndTime: String,
                                  reason: String?) async throws -> RescheduleRequest {
        struct Req: Encodable {
            let proposed_start: String
            let proposed_end: String
            let message: String?
        }
        return try await APIClient.shared.request(
            "/api/calendar/appointments/\(appointmentId)/reschedule-request",
            method: .POST,
            body: Req(proposed_start: isoDateTime(date: proposedDate, time: proposedStartTime),
                      proposed_end: isoDateTime(date: proposedDate, time: proposedEndTime),
                      message: reason)
        )
    }

    static func respondToReschedule(_ appointmentId: String,
                                    requestId: String,
                                    status: String) async throws -> RescheduleRequest {
        struct Req: Encodable { let action: String }
        let action = ["accepted", "accept"].contains(status.lowercased()) ? "accept" : "decline"
        let response: RescheduleResponse = try await APIClient.shared.request(
            "/api/calendar/appointments/\(appointmentId)/reschedule-request/\(requestId)",
            method: .PUT,
            body: Req(action: action)
        )
        return RescheduleRequest(id: requestId,
                                 appointment_id: appointmentId,
                                 status: response.action ?? action,
                                 proposed_date: nil,
                                 proposed_start_time: nil,
                                 proposed_end_time: nil,
                                 reason: nil,
                                 created_at: nil)
    }

    // MARK: - iCal export

    static func icalData(_ appointmentId: String) async throws -> Data {
        try await APIClient.shared.rawData("/api/calendar/appointments/\(appointmentId)/ical", requiresAuth: true)
    }

    // MARK: - Availability blocks

    static func createAvailability(date: String,
                                   startTime: String,
                                   endTime: String,
                                   isAvailable: Bool = true,
                                   notes: String? = nil) async throws -> AvailabilityBlock {
        struct Req: Encodable {
            let start_time: String
            let end_time: String
            let type: String
            let notes: String?
        }
        return try await APIClient.shared.request(
            "/api/calendar/availability",
            method: .POST,
            body: Req(start_time: isoDateTime(date: date, time: startTime),
                      end_time: isoDateTime(date: date, time: endTime),
                      type: isAvailable ? "available" : "unavailable",
                      notes: notes)
        )
    }

    static func helperAvailabilityBlocks(_ helperId: String, fromDate: String, toDate: String) async throws -> [AvailabilityBlock] {
        let q: [String: Any] = ["from_date": fromDate, "to_date": toDate]
        let response: AvailabilityBlocksResponse = try await APIClient.shared.request("/api/calendar/availability/helpers/\(helperId)", query: q, requiresAuth: false)
        return response.blocks
    }

    private static func isoDateTime(date: String, time: String) -> String {
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .iso8601)
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = .current
        parser.dateFormat = "yyyy-MM-dd HH:mm"

        let normalizedTime = time.count == 5 ? time : String(time.prefix(5))
        guard let value = parser.date(from: "\(date) \(normalizedTime)") else {
            return "\(date)T\(normalizedTime):00"
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = .current
        return formatter.string(from: value)
    }
}

enum BookingsService {
    private struct APIEnvelope<T: Decodable>: Decodable {
        let data: T
    }

    static func create(_ req: BookingCreateRequest) async throws -> APIBooking {
        let envelope: APIEnvelope<APIBooking> = try await APIClient.shared.request("/api/bookings", method: .POST, body: req)
        return envelope.data
    }
    static func mine() async throws -> [APIBooking] {
        let envelope: APIEnvelope<[APIBooking]> = try await APIClient.shared.request("/api/bookings")
        return envelope.data
    }
    static func incoming() async throws -> [APIBooking] {
        let envelope: APIEnvelope<[APIBooking]> = try await APIClient.shared.request("/api/bookings/incoming")
        return envelope.data
    }
    static func accept(_ id: String) async throws -> APIBooking {
        let envelope: APIEnvelope<APIBooking> = try await APIClient.shared.request("/api/bookings/\(id)/accept", method: .POST)
        return envelope.data
    }
    static func decline(_ id: String, reason: String? = nil) async throws {
        struct Req: Encodable { let reason: String? }
        try await APIClient.shared.requestVoid(
            "/api/bookings/\(id)/decline",
            method: .POST,
            body: Req(reason: reason)
        )
    }
    static func cancel(_ id: String) async throws {
        try await APIClient.shared.requestVoid("/api/bookings/\(id)/cancel", method: .POST)
    }

    static func detail(_ id: String) async throws -> APIBooking {
        let envelope: APIEnvelope<APIBooking> = try await APIClient.shared.request("/api/bookings/\(id)")
        return envelope.data
    }

    static func helperAvailableSlots(_ helperId: String, fromDate: String, toDate: String) async throws -> AvailabilitySlotsResponse {
        let q: [String: Any] = ["date": fromDate]
        let envelope: APIEnvelope<AvailabilitySlotsResponse> = try await APIClient.shared.request("/api/bookings/helper/\(helperId)/available-slots", query: q, requiresAuth: false)
        return envelope.data
    }

    static func convertToJob(_ bookingId: String,
                             title: String,
                             description: String,
                             budgetMin: Int?,
                             budgetMax: Int?) async throws -> [String: AnyDecodable] {
        struct Req: Encodable {
            let title: String
            let description: String
            let budget_min: Int?
            let budget_max: Int?
        }
        return try await APIClient.shared.request(
            "/api/bookings/\(bookingId)/convert-to-job",
            method: .POST,
            body: Req(title: title, description: description, budget_min: budgetMin, budget_max: budgetMax)
        )
    }
}
