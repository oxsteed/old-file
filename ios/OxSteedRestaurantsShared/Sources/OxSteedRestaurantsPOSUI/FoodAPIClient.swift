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
        return URL(string: "https://api.oxsteed.com")!
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
        orderSource: String = "mobile",
        discountCode: String? = nil,
        discountLabel: String? = nil,
        discountCents: Int = 0,
        clientOrderId: String? = nil
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
            let discountCode: String?
            let discountLabel: String?
            let discountCents: Int
            let items: [OrderItem]
            let clientOrderId: String?

            enum CodingKeys: String, CodingKey {
                case fulfillmentType, orderSource, tableLabel, guestName, items
                case discountCode, discountLabel, discountCents
                case clientOrderId = "client_order_id"
            }
        }
        let body = Body(
            fulfillmentType: fulfillment,
            orderSource: orderSource,
            tableLabel: tableLabel,
            guestName: guestName,
            discountCode: discountCode,
            discountLabel: discountLabel,
            discountCents: max(0, discountCents),
            items: lines.map {
                OrderItem(
                    menuItemId: $0.item.id,
                    quantity: $0.quantity,
                    modifierIds: $0.modifiers.map(\.id),
                    specialInstructions: $0.specialInstructions.isEmpty ? nil : $0.specialInstructions
                )
            },
            clientOrderId: clientOrderId
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

    func createPendingOrder(_ pending: FoodPendingOrder, token: String?) async throws -> FoodOrder {
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
            let discountCode: String?
            let discountLabel: String?
            let discountCents: Int
            let items: [OrderItem]
            let clientOrderId: String

            enum CodingKeys: String, CodingKey {
                case fulfillmentType, orderSource, tableLabel, guestName, items
                case discountCode, discountLabel, discountCents
                case clientOrderId = "client_order_id"
            }
        }
        let body = Body(
            fulfillmentType: pending.fulfillment,
            orderSource: pending.orderSource,
            tableLabel: pending.tableLabel,
            guestName: pending.guestName,
            discountCode: pending.discountCode,
            discountLabel: pending.discountLabel,
            discountCents: max(0, pending.discountCents),
            items: pending.lines.map {
                OrderItem(
                    menuItemId: $0.menuItemId,
                    quantity: $0.quantity,
                    modifierIds: $0.modifierIds,
                    specialInstructions: $0.specialInstructions
                )
            },
            clientOrderId: pending.id
        )
        let envelope: OrderEnvelope = try await request(
            "/api/food/restaurants/\(pending.restaurantId)/orders",
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

    func posDiscounts(restaurantId: Int64, token: String) async throws -> [FoodPOSDiscountResponse] {
        let response: POSDiscountsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/pos/discounts",
            token: token
        )
        return response.discounts
    }

    func posReceiptEvents(restaurantId: Int64, token: String) async throws -> [FoodPOSReceiptEventResponse] {
        let response: POSReceiptEventsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/pos/receipt-events",
            token: token
        )
        return response.receiptEvents
    }

    func createPOSReceiptEvent(
        restaurantId: Int64,
        orderId: Int64,
        queueNumber: Int,
        guestName: String,
        totalCents: Int,
        paymentStatus: String,
        channel: String,
        token: String
    ) async throws -> FoodPOSReceiptEventResponse {
        struct Body: Encodable {
            let orderId: Int64
            let queueNumber: Int
            let guestName: String
            let totalCents: Int
            let paymentStatus: String
            let channel: String
        }
        let response: POSReceiptEventEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/pos/receipt-events",
            method: "POST",
            body: Body(
                orderId: orderId,
                queueNumber: queueNumber,
                guestName: guestName,
                totalCents: totalCents,
                paymentStatus: paymentStatus,
                channel: channel
            ),
            token: token
        )
        return response.receiptEvent
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

struct POSDiscountsEnvelope: Decodable {
    let discounts: [FoodPOSDiscountResponse]
}

struct FoodPOSDiscountResponse: Decodable {
    let code: String?
    let title: String
    let percentOff: Double

    enum CodingKeys: String, CodingKey {
        case code, title
        case percentOff = "percentOff"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = c.flexString(.code)
        title = c.flexString(.title) ?? "Discount"
        if let direct = try? c.decode(Double.self, forKey: .percentOff) {
            percentOff = direct
        } else if let raw = c.flexString(.percentOff), let parsed = Double(raw) {
            percentOff = parsed
        } else {
            percentOff = 0
        }
    }
}

struct POSReceiptEventsEnvelope: Decodable {
    let receiptEvents: [FoodPOSReceiptEventResponse]
}

struct POSReceiptEventEnvelope: Decodable {
    let receiptEvent: FoodPOSReceiptEventResponse
}

struct FoodPOSReceiptEventResponse: Decodable {
    let id: Int64
    let orderID: Int64
    let queueNumber: Int
    let guestName: String
    let totalCents: Int
    let paymentStatus: String
    let channel: String
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case orderID = "food_order_id"
        case queueNumber = "queue_number"
        case guestName = "guest_name"
        case totalCents = "total_cents"
        case paymentStatus = "payment_status"
        case channel
        case createdAt = "created_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        orderID = try c.flexInt64(.orderID)
        queueNumber = c.flexInt(.queueNumber, default: 0)
        guestName = c.flexString(.guestName) ?? "Walk-in"
        totalCents = c.flexInt(.totalCents, default: 0)
        paymentStatus = c.flexString(.paymentStatus) ?? "unpaid"
        channel = c.flexString(.channel) ?? "Counter"
        createdAt = c.flexDateIfPresent(.createdAt) ?? .now
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
