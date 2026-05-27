import Foundation

enum CalendarService {
    static func appointments(role: String? = nil, status: String? = nil,
                             from: String? = nil, to: String? = nil) async throws -> [APIAppointment] {
        var q: [String: Any] = [:]
        if let role { q["role"] = role }
        if let status { q["status"] = status }
        if let from { q["from_date"] = from }
        if let to { q["to_date"] = to }
        return try await APIClient.shared.request("/api/calendar/appointments", query: q)
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
}

enum BookingsService {
    static func create(_ req: BookingCreateRequest) async throws -> APIBooking {
        try await APIClient.shared.request("/api/bookings", method: .POST, body: req)
    }
    static func mine() async throws -> [APIBooking] {
        try await APIClient.shared.request("/api/bookings")
    }
    static func incoming() async throws -> [APIBooking] {
        try await APIClient.shared.request("/api/bookings/incoming")
    }
    static func accept(_ id: String) async throws -> APIBooking {
        try await APIClient.shared.request("/api/bookings/\(id)/accept", method: .POST)
    }
    static func decline(_ id: String) async throws {
        try await APIClient.shared.requestVoid("/api/bookings/\(id)/decline", method: .POST)
    }
    static func cancel(_ id: String) async throws {
        try await APIClient.shared.requestVoid("/api/bookings/\(id)/cancel", method: .POST)
    }
}
