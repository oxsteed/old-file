import Foundation

enum FoodAPIError: LocalizedError {
    case invalidURL
    case missingToken
    case unauthorized
    case server(Int, String?)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "The OxSteed Food server URL is invalid."
        case .missingToken: return "Sign in with your OxSteed account first."
        case .unauthorized: return "Your session expired. Please sign in again."
        case .server(let code, let message): return message ?? "The server returned status \(code)."
        case .decoding(let message): return "The server response could not be read: \(message)"
        }
    }
}

actor FoodAPIClient {
    static let shared = FoodAPIClient()

    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(session: URLSession = .shared) {
        self.session = session
    }

    private var baseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "OX_API_BASE_URL") as? String,
           let url = URL(string: raw),
           raw.hasPrefix("http") {
            return url
        }
        return URL(string: "https://oxsteed.com")!
    }

    // MARK: - Auth

    func login(email: String, password: String, agreementName: String) async throws -> FoodAuthSession {
        struct Body: Encodable {
            let email: String
            let password: String
            let termsAgreed: Bool
            let agreementName: String
        }
        return try await request(
            "/api/auth/login",
            method: "POST",
            body: Body(
                email: email,
                password: password,
                termsAgreed: true,
                agreementName: agreementName
            ),
            requiresAuth: false
        )
    }

    func refresh(refreshToken: String) async throws -> FoodAuthSession {
        struct Body: Encodable { let refreshToken: String }
        return try await request("/api/auth/refresh", method: "POST", body: Body(refreshToken: refreshToken), requiresAuth: false)
    }

    // MARK: - Discovery (public)

    func listRestaurants(search: String, latitude: Double? = nil, longitude: Double? = nil) async throws -> [FoodRestaurant] {
        var query: [URLQueryItem] = [URLQueryItem(name: "limit", value: "50")]
        let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { query.append(URLQueryItem(name: "q", value: trimmed)) }
        if let latitude, let longitude {
            query.append(URLQueryItem(name: "lat", value: String(latitude)))
            query.append(URLQueryItem(name: "lng", value: String(longitude)))
        }
        let response: RestaurantsEnvelope = try await request("/api/food/restaurants", query: query, requiresAuth: false)
        return response.restaurants
    }

    func restaurantDetail(id: Int64) async throws -> RestaurantDetailEnvelope {
        try await request("/api/food/restaurants/\(id)", requiresAuth: false)
    }

    func queueBoard(restaurantId: Int64) async throws -> FoodQueueBoard {
        try await request("/api/food/restaurants/\(restaurantId)/queue-board", requiresAuth: false)
    }

    // MARK: - Ordering
    // Guests can order (the route is optional-auth); signed-in customers get
    // the order attached to their history. Payment always happens in store.

    func createOrder(
        restaurantId: Int64,
        lines: [CartLine],
        fulfillment: String,
        tableLabel: String?,
        guestName: String?,
        token: String?,
        orderSource: String = "mobile"
    ) async throws -> FoodOrder {
        struct OrderItem: Encodable {
            let menuItemId: Int64
            let quantity: Int
            let modifierIds: [Int64]
            let specialInstructions: String?
        }
        struct Body: Encodable {
            let fulfillmentType: String
            let orderSource: String
            let tableLabel: String?
            let guestName: String?
            let items: [OrderItem]
        }
        let body = Body(
            fulfillmentType: fulfillment,
            orderSource: orderSource,
            tableLabel: tableLabel,
            guestName: guestName,
            items: lines.map {
                OrderItem(
                    menuItemId: $0.item.id,
                    quantity: $0.quantity,
                    modifierIds: $0.modifiers.map(\.id),
                    specialInstructions: $0.specialInstructions.isEmpty ? nil : $0.specialInstructions
                )
            }
        )
        let envelope: OrderEnvelope = try await request(
            "/api/food/restaurants/\(restaurantId)/orders",
            method: "POST",
            body: body,
            token: token,
            requiresAuth: false
        )
        return envelope.order
    }

    func myOrders(token: String) async throws -> [FoodOrder] {
        let response: OrdersEnvelope = try await request("/api/food/my/orders", token: token)
        return response.orders
    }

    func order(id: Int64, token: String) async throws -> FoodOrder {
        let response: OrderEnvelope = try await request("/api/food/orders/\(id)", token: token)
        return response.order
    }

    // MARK: - Merchant

    func myRestaurants(token: String) async throws -> [FoodRestaurant] {
        let response: RestaurantsEnvelope = try await request("/api/food/my/restaurants", token: token)
        return response.restaurants
    }

    func createRestaurant(
        name: String,
        description: String?,
        cuisineTags: [String],
        city: String?,
        country: String,
        currency: String,
        latitude: Double?,
        longitude: Double?,
        token: String
    ) async throws -> FoodRestaurant {
        struct Body: Encodable {
            let displayName: String
            let description: String?
            let cuisineTags: [String]
            let addressCity: String?
            let addressCountry: String
            let currencyCode: String
            let latitude: Double?
            let longitude: Double?
        }
        let envelope: RestaurantEnvelope = try await request(
            "/api/food/restaurants",
            method: "POST",
            body: Body(
                displayName: name,
                description: description,
                cuisineTags: cuisineTags,
                addressCity: city,
                addressCountry: country,
                currencyCode: currency,
                latitude: latitude,
                longitude: longitude
            ),
            token: token
        )
        return envelope.restaurant
    }

    func updateRestaurantStatus(restaurantId: Int64, status: String, token: String) async throws -> FoodRestaurant {
        struct Body: Encodable { let status: String }
        let envelope: RestaurantEnvelope = try await request(
            "/api/food/restaurants/\(restaurantId)",
            method: "PATCH",
            body: Body(status: status),
            token: token
        )
        return envelope.restaurant
    }

    func createCategory(restaurantId: Int64, name: String, token: String) async throws -> Int64 {
        struct Body: Encodable { let name: String }
        struct Envelope: Decodable {
            let category: Category
            struct Category: Decodable {
                let id: Int64
                enum CodingKeys: String, CodingKey { case id }
                init(from decoder: Decoder) throws {
                    let c = try decoder.container(keyedBy: CodingKeys.self)
                    id = try c.flexInt64(.id)
                }
            }
        }
        let envelope: Envelope = try await request(
            "/api/food/restaurants/\(restaurantId)/categories",
            method: "POST",
            body: Body(name: name),
            token: token
        )
        return envelope.category.id
    }

    func createMenuItem(
        restaurantId: Int64,
        name: String,
        priceCents: Int,
        categoryId: Int64?,
        description: String?,
        token: String
    ) async throws -> FoodMenuItem {
        struct Body: Encodable {
            let name: String
            let priceCents: Int
            let categoryId: Int64?
            let description: String?
        }
        struct Envelope: Decodable { let item: FoodMenuItem }
        let envelope: Envelope = try await request(
            "/api/food/restaurants/\(restaurantId)/menu-items",
            method: "POST",
            body: Body(name: name, priceCents: priceCents, categoryId: categoryId, description: description),
            token: token
        )
        return envelope.item
    }

    func restaurantOrders(restaurantId: Int64, activeOnly: Bool, token: String) async throws -> [FoodOrder] {
        var query: [URLQueryItem] = []
        if activeOnly { query.append(URLQueryItem(name: "active", value: "1")) }
        let response: OrdersEnvelope = try await request(
            "/api/food/restaurants/\(restaurantId)/orders",
            query: query,
            token: token
        )
        return response.orders
    }

    func updateOrderStatus(restaurantId: Int64, orderId: Int64, status: String, token: String) async throws -> FoodOrder {
        struct Body: Encodable { let status: String }
        let response: OrderEnvelope = try await request(
            "/api/food/restaurants/\(restaurantId)/orders/\(orderId)/status",
            method: "PATCH",
            body: Body(status: status),
            token: token
        )
        return response.order
    }

    func updateOrderPayment(restaurantId: Int64, orderId: Int64, paymentStatus: String, token: String) async throws -> FoodOrder {
        struct Body: Encodable { let paymentStatus: String }
        let response: OrderEnvelope = try await request(
            "/api/food/restaurants/\(restaurantId)/orders/\(orderId)/payment",
            method: "PATCH",
            body: Body(paymentStatus: paymentStatus),
            token: token
        )
        return response.order
    }

    // MARK: - Runner operations

    func runnerDashboard(restaurantId: Int64, token: String) async throws -> RunnerDashboardEnvelope {
        try await request("/api/restaurants/\(restaurantId)/runner/dashboard", token: token)
    }

    func createRunnerTask(
        restaurantId: Int64,
        orderReference: String,
        stopName: String,
        taskType: String,
        routeWindow: String?,
        customerContactRule: String?,
        requiresProof: Bool,
        cashCollectionRequired: Bool,
        notes: String?,
        token: String
    ) async throws -> RunnerTaskEnvelope {
        struct Body: Encodable {
            let orderReference: String
            let stopName: String
            let taskType: String
            let routeWindow: String?
            let customerContactRule: String?
            let requiresProof: Bool
            let cashCollectionRequired: Bool
            let notes: String?
        }
        return try await request(
            "/api/restaurants/\(restaurantId)/runner/tasks",
            method: "POST",
            body: Body(
                orderReference: orderReference,
                stopName: stopName,
                taskType: taskType,
                routeWindow: routeWindow,
                customerContactRule: customerContactRule,
                requiresProof: requiresProof,
                cashCollectionRequired: cashCollectionRequired,
                notes: notes
            ),
            token: token
        )
    }

    func createRunnerContactRule(
        restaurantId: Int64,
        title: String,
        detail: String,
        token: String
    ) async throws -> RunnerContactRuleEnvelope {
        struct Body: Encodable {
            let title: String
            let detail: String
        }
        return try await request(
            "/api/restaurants/\(restaurantId)/runner/contact-rules",
            method: "POST",
            body: Body(title: title, detail: detail),
            token: token
        )
    }

    func updateRunnerTaskStatus(restaurantId: Int64, taskId: Int64, status: String, token: String) async throws -> RunnerTaskEnvelope {
        struct Body: Encodable { let status: String }
        return try await request(
            "/api/restaurants/\(restaurantId)/runner/tasks/\(taskId)/status",
            method: "PATCH",
            body: Body(status: status),
            token: token
        )
    }

    func logRunnerProof(restaurantId: Int64, taskId: Int64, note: String, token: String) async throws -> RunnerProofEnvelope {
        struct Body: Encodable {
            let method: String
            let note: String
        }
        return try await request(
            "/api/restaurants/\(restaurantId)/runner/tasks/\(taskId)/proofs",
            method: "POST",
            body: Body(method: "Photo / signature", note: note),
            token: token
        )
    }

    func reportRunnerIssue(restaurantId: Int64, taskId: Int64, note: String, token: String) async throws -> RunnerIssueEnvelope {
        struct Body: Encodable {
            let severity: String
            let note: String
        }
        return try await request(
            "/api/restaurants/\(restaurantId)/runner/tasks/\(taskId)/issues",
            method: "POST",
            body: Body(severity: "Needs follow-up", note: note),
            token: token
        )
    }

    func logRunnerPaymentNote(restaurantId: Int64, taskId: Int64, amount: Double, note: String, token: String) async throws -> RunnerPaymentNoteEnvelope {
        struct Body: Encodable {
            let amount: Double
            let note: String
        }
        return try await request(
            "/api/restaurants/\(restaurantId)/runner/tasks/\(taskId)/payment-notes",
            method: "POST",
            body: Body(amount: amount, note: note),
            token: token
        )
    }

    // MARK: - Core request

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        body: Encodable? = nil,
        token: String? = nil,
        requiresAuth: Bool = true
    ) async throws -> T {
        guard let resolved = URL(string: path, relativeTo: baseURL),
              var components = URLComponents(url: resolved.absoluteURL, resolvingAgainstBaseURL: false) else {
            throw FoodAPIError.invalidURL
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw FoodAPIError.invalidURL }

        var request = URLRequest(url: url, timeoutInterval: 30)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if requiresAuth {
            guard let token, !token.isEmpty else { throw FoodAPIError.missingToken }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw FoodAPIError.server(-1, nil) }
        if http.statusCode == 401 { throw FoodAPIError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            throw FoodAPIError.server(http.statusCode, Self.serverMessage(from: data))
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw FoodAPIError.decoding(String(describing: error))
        }
    }

    /// Pull a human-readable message out of the API's error JSON shapes
    /// ({ error: { message } } or { message }).
    private static func serverMessage(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if let error = object["error"] as? String { return error }
        if let error = object["error"] as? [String: Any], let message = error["message"] as? String { return message }
        if let message = object["message"] as? String { return message }
        if let code = object["code"] as? String { return code.replacingOccurrences(of: "_", with: " ") }
        return nil
    }
}

struct RestaurantsEnvelope: Decodable {
    let restaurants: [FoodRestaurant]
}

struct RestaurantEnvelope: Decodable {
    let restaurant: FoodRestaurant
}

struct RestaurantDetailEnvelope: Decodable {
    let restaurant: FoodRestaurant
    let menu: [FoodMenuSection]
    let uncategorizedItems: [FoodMenuItem]

    enum CodingKeys: String, CodingKey { case restaurant, menu, uncategorizedItems }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        restaurant = try c.decode(FoodRestaurant.self, forKey: .restaurant)
        menu = (try? c.decode([FoodMenuSection].self, forKey: .menu)) ?? []
        uncategorizedItems = (try? c.decode([FoodMenuItem].self, forKey: .uncategorizedItems)) ?? []
    }
}

struct OrderEnvelope: Decodable {
    let order: FoodOrder
}

struct OrdersEnvelope: Decodable {
    let orders: [FoodOrder]
}

struct RunnerDashboardEnvelope: Decodable {
    let tasks: [RunnerTaskResponse]
    let contactRules: [RunnerContactRuleResponse]
    let proofs: [RunnerProofResponse]
    let issues: [RunnerIssueResponse]
    let paymentNotes: [RunnerPaymentNoteResponse]
}

struct RunnerTaskEnvelope: Decodable {
    let task: RunnerTaskResponse
}

struct RunnerContactRuleEnvelope: Decodable {
    let contactRule: RunnerContactRuleResponse
}

struct RunnerProofEnvelope: Decodable {
    let proof: RunnerProofResponse
}

struct RunnerIssueEnvelope: Decodable {
    let issue: RunnerIssueResponse
}

struct RunnerPaymentNoteEnvelope: Decodable {
    let paymentNote: RunnerPaymentNoteResponse
}

struct RunnerTaskResponse: Decodable {
    let id: Int64
    let orderReference: String
    let stopName: String
    let taskType: String
    let status: String
    let routeWindow: String?
    let customerContactRule: String?
    let requiresProof: Bool
    let cashCollectionRequired: Bool
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case id, status, notes
        case orderReference = "order_reference"
        case stopName = "stop_name"
        case taskType = "task_type"
        case routeWindow = "route_window"
        case customerContactRule = "customer_contact_rule"
        case requiresProof = "requires_proof"
        case cashCollectionRequired = "cash_collection_required"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        orderReference = try c.decode(String.self, forKey: .orderReference)
        stopName = try c.decode(String.self, forKey: .stopName)
        taskType = try c.decode(String.self, forKey: .taskType)
        status = try c.decode(String.self, forKey: .status)
        routeWindow = try c.decodeIfPresent(String.self, forKey: .routeWindow)
        customerContactRule = try c.decodeIfPresent(String.self, forKey: .customerContactRule)
        requiresProof = (try? c.decode(Bool.self, forKey: .requiresProof)) ?? false
        cashCollectionRequired = (try? c.decode(Bool.self, forKey: .cashCollectionRequired)) ?? false
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
    }
}

struct RunnerContactRuleResponse: Decodable {
    let id: Int64
    let title: String
    let detail: String

    enum CodingKeys: String, CodingKey { case id, title, detail }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        title = try c.decode(String.self, forKey: .title)
        detail = try c.decode(String.self, forKey: .detail)
    }
}

struct RunnerProofResponse: Decodable {
    let id: Int64
    let orderReference: String
    let stopName: String
    let method: String
    let note: String?

    enum CodingKeys: String, CodingKey {
        case id, method, note
        case orderReference = "order_reference"
        case stopName = "stop_name"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        orderReference = try c.decode(String.self, forKey: .orderReference)
        stopName = try c.decode(String.self, forKey: .stopName)
        method = try c.decode(String.self, forKey: .method)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }
}

struct RunnerIssueResponse: Decodable {
    let id: Int64
    let orderReference: String
    let stopName: String
    let severity: String
    let note: String

    enum CodingKeys: String, CodingKey {
        case id, severity, note
        case orderReference = "order_reference"
        case stopName = "stop_name"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        orderReference = try c.decode(String.self, forKey: .orderReference)
        stopName = try c.decode(String.self, forKey: .stopName)
        severity = try c.decode(String.self, forKey: .severity)
        note = try c.decode(String.self, forKey: .note)
    }
}

struct RunnerPaymentNoteResponse: Decodable {
    let id: Int64
    let orderReference: String
    let amount: Double
    let note: String?

    enum CodingKeys: String, CodingKey {
        case id, amount, note
        case orderReference = "order_reference"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        orderReference = try c.decode(String.self, forKey: .orderReference)
        amount = try c.decodeFlexibleDouble(forKey: .amount)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }
}

struct AnyEncodable: Encodable {
    private let encodeBody: (Encoder) throws -> Void

    init(_ value: Encodable) {
        self.encodeBody = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeBody(encoder)
    }
}

private extension KeyedDecodingContainer {
    func decodeFlexibleDouble(forKey key: Key) throws -> Double {
        if let value = try? decode(Double.self, forKey: key) { return value }
        if let value = try? decode(Int.self, forKey: key) { return Double(value) }
        if let value = try? decode(String.self, forKey: key), let parsed = Double(value) { return parsed }
        throw DecodingError.typeMismatch(
            Double.self,
            DecodingError.Context(codingPath: codingPath + [key], debugDescription: "Expected a numeric value")
        )
    }
}
