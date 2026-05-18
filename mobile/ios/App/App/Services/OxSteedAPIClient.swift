import Foundation

final class OxSteedAPIClient {
    static let shared = OxSteedAPIClient()

    private let baseURL = URL(string: "https://oxsteed.com/api")!
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()

    func popularDiscover() async throws -> [DiscoverItem] {
        let response: DiscoverResponse = try await get("discover/popular", queryItems: [
            URLQueryItem(name: "limit", value: "16")
        ])
        return response.results
    }

    func searchDiscover(query: String) async throws -> [DiscoverItem] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return try await popularDiscover() }
        let response: DiscoverResponse = try await get("discover", queryItems: [
            URLQueryItem(name: "q", value: trimmed),
            URLQueryItem(name: "limit", value: "24")
        ])
        return response.results
    }

    func helpers(query: String = "") async throws -> [NativeHelper] {
        var items = [
            URLQueryItem(name: "limit", value: "12"),
            URLQueryItem(name: "sort", value: "best_match")
        ]
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            items.append(URLQueryItem(name: "query", value: trimmed))
        }
        let response: HelpersResponse = try await get("helpers", queryItems: items)
        return response.helpers + (response.businesses ?? [])
    }

    func jobs() async throws -> [NativeJob] {
        let response: JobsResponse = try await get("jobs", queryItems: [
            URLQueryItem(name: "limit", value: "15"),
            URLQueryItem(name: "sort", value: "newest")
        ])
        return response.jobs
    }

    func products() async throws -> [NativeProduct] {
        let response: ProductBrowseResponse = try await get("marketplace/products/browse", queryItems: [
            URLQueryItem(name: "limit", value: "12"),
            URLQueryItem(name: "sortBy", value: "newest")
        ])
        return response.data
    }

    func helperProfile(id: String) async throws -> HelperProfileResponse {
        try await get("helpers/\(id)/profile")
    }

    func jobDetail(id: String) async throws -> NativeJobDetail {
        try await get("jobs/\(id)")
    }

    func productDetail(id: String) async throws -> NativeProductDetail {
        let response: APIDataResponse<NativeProductDetail> = try await get("marketplace/products/\(id)")
        return response.data
    }

    func login(email: String, password: String, agreementName: String) async throws -> LoginResponse {
        try await post("auth/login", body: [
            "email": email,
            "password": password,
            "rememberMe": true,
            "termsAgreed": true,
            "agreementName": agreementName
        ], authenticated: false)
    }

    func submitConsultation(_ payload: ConsultingSubmission) async throws -> ConsultingResponse {
        try await postEncodable("consulting/submit", body: payload, authenticated: false)
    }

    func submitJob(_ payload: JobSubmission) async throws -> JobSubmissionResponse {
        try await postEncodable("jobs", body: payload, authenticated: true)
    }

    func submitBookingRequest(_ payload: BookingRequestSubmission) async throws -> BookingRequestResponse {
        try await postEncodable("bookings", body: payload, authenticated: true)
    }

    func conversations() async throws -> [ConversationItem] {
        try await get("messages/conversations", authenticated: true)
    }

    func conversationMessages(conversationId: String) async throws -> [MessageItem] {
        try await get("messages/conversations/\(conversationId)", queryItems: [
            URLQueryItem(name: "limit", value: "60")
        ], authenticated: true)
    }

    func sendMessage(conversationId: String, content: String) async throws -> MessageSendResponse {
        try await post("messages/conversations/\(conversationId)", body: [
            "content": content
        ], authenticated: true)
    }

    func appointments() async throws -> [AppointmentItem] {
        let response: AppointmentsResponse = try await get("calendar/appointments", queryItems: [
            URLQueryItem(name: "limit", value: "10")
        ], authenticated: true)
        return response.appointments
    }

    func appointments(role: String) async throws -> [AppointmentItem] {
        let response: AppointmentsResponse = try await get("calendar/appointments", queryItems: [
            URLQueryItem(name: "limit", value: "25"),
            URLQueryItem(name: "role", value: role)
        ], authenticated: true)
        return response.appointments
    }

    func businesses() async throws -> [NativeBusiness] {
        let response: BusinessListResponse = try await get("businesses", authenticated: true)
        return response.businesses
    }

    func managedBusinesses() async throws -> [NativeBusiness] {
        let response: BusinessListResponse = try await get("businesses/managed", authenticated: true)
        return response.businesses
    }

    func createCart(name: String, description: String?) async throws -> CartCreateResponse {
        try await post("carts", body: [
            "name": name,
            "description": description ?? ""
        ], authenticated: true)
    }

    func addProduct(productId: String, toCart cartId: String, quantity: Int) async throws -> CartItemResponse {
        try await post("carts/\(cartId)/items", body: [
            "productId": productId,
            "quantity": quantity
        ], authenticated: true)
    }

    func tools(query: String = "") async throws -> [NativeToolRental] {
        var items = [
            URLQueryItem(name: "limit", value: "20"),
            URLQueryItem(name: "sort", value: "newest")
        ]
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            items.append(URLQueryItem(name: "name", value: trimmed))
        }
        let response: ToolBrowseResponse = try await get("tool-rentals/browse", queryItems: items)
        return response.tools
    }

    func toolDetail(id: String) async throws -> NativeToolRental {
        let response: ToolDetailResponse = try await get("tool-rentals/public/\(id)")
        return response.tool
    }

    func bookTool(_ payload: ToolBookingSubmission) async throws -> ToolBookingResponse {
        try await postEncodable("tool-rentals/bookings", body: payload, authenticated: true)
    }

    func businessAppointments(businessId: String) async throws -> [BusinessAppointmentItem] {
        let response: BusinessAppointmentsResponse = try await get("businesses/\(businessId)/appointments", queryItems: [
            URLQueryItem(name: "limit", value: "25")
        ], authenticated: true)
        return response.appointments
    }

    private func get<T: Decodable>(_ path: String, queryItems: [URLQueryItem] = [], authenticated: Bool = false) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.queryItems = queryItems.isEmpty ? nil : queryItems

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authenticated, let token = UserDefaults.standard.string(forKey: "oxsteedAccessToken") {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = 20

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable>(_ path: String, body: [String: Any], authenticated: Bool) async throws -> T {
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await send(path, body: data, authenticated: authenticated)
    }

    private func postEncodable<T: Decodable, U: Encodable>(_ path: String, body: U, authenticated: Bool) async throws -> T {
        let data = try JSONEncoder().encode(body)
        return try await send(path, body: data, authenticated: authenticated)
    }

    private func send<T: Decodable>(_ path: String, body: Data, authenticated: Bool) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authenticated, let token = UserDefaults.standard.string(forKey: "oxsteedAccessToken") {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body
        request.timeoutInterval = 25

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(T.self, from: data)
    }
}
