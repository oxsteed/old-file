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
    // the order attached to their history. Customer/kiosk apps can optionally
    // start a hosted online-checkout flow for the created order.

    func paymentConfig() async throws -> FoodPaymentConfigResponse {
        try await request("/api/food/payment-config", requiresAuth: false)
    }

    func trackedOrder(trackingToken: String) async throws -> FoodOrder {
        let response: OrderEnvelope = try await request(
            "/api/food/orders/track/\(trackingToken)",
            requiresAuth: false
        )
        return response.order
    }

    func createOrder(
        restaurantId: Int64,
        lines: [CartLine],
        fulfillment: String,
        tableLabel: String?,
        guestName: String?,
        token: String?,
        orderSource: String = "mobile",
        paymentMode: String = "pay_at_counter",
        clientOrderId: String? = nil,
        discountCode: String? = nil,
        deliveryAddress: FoodDeliveryAddress? = nil,
        loyaltyPointsToRedeem: Int? = nil
    ) async throws -> FoodCreateOrderResponse {
        struct OrderItem: Encodable {
            let menuItemId: Int64
            let quantity: Int
            let modifierIds: [Int64]
            let specialInstructions: String?
        }
        struct Body: Encodable {
            let fulfillmentType: String
            let orderSource: String
            let paymentMode: String
            let tableLabel: String?
            let guestName: String?
            let items: [OrderItem]
            let clientOrderId: String?
            let discountCode: String?
            let deliveryAddress: FoodDeliveryAddress?
            let loyaltyPointsToRedeem: Int?

            enum CodingKeys: String, CodingKey {
                case fulfillmentType, orderSource, paymentMode, tableLabel, guestName, items
                case clientOrderId = "client_order_id"
                case discountCode = "discount_code"
                case deliveryAddress = "delivery_address"
                case loyaltyPointsToRedeem = "loyalty_points_to_redeem"
            }
        }
        let body = Body(
            fulfillmentType: fulfillment,
            orderSource: orderSource,
            paymentMode: paymentMode,
            tableLabel: tableLabel,
            guestName: guestName,
            items: lines.map {
                OrderItem(
                    menuItemId: $0.item.id,
                    quantity: $0.quantity,
                    modifierIds: $0.modifiers.map(\.id),
                    specialInstructions: $0.specialInstructions.isEmpty ? nil : $0.specialInstructions
                )
            },
            clientOrderId: clientOrderId,
            discountCode: discountCode,
            deliveryAddress: deliveryAddress,
            loyaltyPointsToRedeem: loyaltyPointsToRedeem
        )
        let envelope: FoodCreateOrderEnvelope = try await request(
            "/api/food/restaurants/\(restaurantId)/orders",
            method: "POST",
            body: body,
            token: token,
            requiresAuth: false
        )
        return FoodCreateOrderResponse(order: envelope.order, payment: envelope.payment, trackingToken: envelope.trackingToken)
    }

    func createPendingOrder(_ pending: FoodPendingOrder, token: String?) async throws -> FoodCreateOrderResponse {
        struct OrderItem: Encodable {
            let menuItemId: Int64
            let quantity: Int
            let modifierIds: [Int64]
            let specialInstructions: String?
        }
        struct Body: Encodable {
            let fulfillmentType: String
            let orderSource: String
            let paymentMode: String
            let tableLabel: String?
            let guestName: String?
            let discountCode: String?
            let discountLabel: String?
            let discountCents: Int
            let loyaltyPointsToRedeem: Int?
            let items: [OrderItem]
            let clientOrderId: String

            enum CodingKeys: String, CodingKey {
                case fulfillmentType, orderSource, paymentMode, tableLabel, guestName, items
                case discountCode, discountLabel, discountCents
                case clientOrderId = "client_order_id"
                case loyaltyPointsToRedeem = "loyalty_points_to_redeem"
            }
        }
        let body = Body(
            fulfillmentType: pending.fulfillment,
            orderSource: pending.orderSource,
            paymentMode: pending.paymentMode,
            tableLabel: pending.tableLabel,
            guestName: pending.guestName,
            discountCode: pending.discountCode,
            discountLabel: pending.discountLabel,
            discountCents: max(0, pending.discountCents),
            loyaltyPointsToRedeem: pending.loyaltyPointsToRedeem,
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
        let envelope: FoodCreateOrderEnvelope = try await request(
            "/api/food/restaurants/\(pending.restaurantId)/orders",
            method: "POST",
            body: body,
            token: token,
            requiresAuth: false
        )
        return FoodCreateOrderResponse(order: envelope.order, payment: envelope.payment, trackingToken: envelope.trackingToken)
    }

    func myOrders(token: String) async throws -> [FoodOrder] {
        let response: OrdersEnvelope = try await request("/api/food/my/orders", token: token)
        return response.orders
    }

    func order(id: Int64, token: String) async throws -> FoodOrder {
        let response: OrderEnvelope = try await request("/api/food/orders/\(id)", token: token)
        return response.order
    }

    func submitOrderReview(
        orderId: Int64,
        rating: Int,
        body: String?,
        trackingToken: String? = nil,
        token: String? = nil
    ) async throws {
        struct Body: Encodable {
            let rating: Int
            let body: String?
            let trackingToken: String?

            enum CodingKeys: String, CodingKey {
                case rating, body
                case trackingToken = "tracking_token"
            }
        }
        struct Response: Decodable { let review: FoodOrderReview }
        let _: Response = try await request(
            "/api/food/orders/\(orderId)/review",
            method: "POST",
            body: Body(rating: rating, body: body, trackingToken: trackingToken),
            token: token,
            requiresAuth: false
        )
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

    // MARK: - Customer profile

    func customerProfile(restaurantId: Int64? = nil, token: String) async throws -> FoodCustomerProfileResponse {
        var query: [URLQueryItem] = []
        if let restaurantId {
            query.append(URLQueryItem(name: "restaurantId", value: String(restaurantId)))
        }
        let response: FoodCustomerProfileEnvelope = try await request(
            "/api/food/customer/profile",
            query: query,
            token: token
        )
        return response.profile
    }

    func updateCustomerProfile(
        preferredLanguage: String? = nil,
        notificationsEnabled: Bool? = nil,
        token: String
    ) async throws -> FoodCustomerProfileResponse {
        struct Body: Encodable {
            let preferredLanguage: String?
            let notificationsEnabled: Bool?
        }
        let response: FoodCustomerProfileEnvelope = try await request(
            "/api/food/customer/profile",
            method: "PATCH",
            body: Body(preferredLanguage: preferredLanguage, notificationsEnabled: notificationsEnabled),
            token: token
        )
        return response.profile
    }

    func toggleFavoriteRestaurant(restaurantId: Int64, token: String) async throws -> FoodCustomerFavoriteToggleResponse {
        try await request(
            "/api/food/customer/favorites/\(restaurantId)/toggle",
            method: "POST",
            body: EmptyBody(),
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

struct FoodPaymentConfigResponse: Decodable {
    let payments: FoodPaymentsConfig
}

struct FoodPaymentsConfig: Decodable {
    let onlineCheckoutAvailable: Bool
    let mode: String
}

struct FoodCreateOrderEnvelope: Decodable {
    let order: FoodOrder
    let payment: FoodOrderPaymentResponse?
    let trackingToken: String?
}

struct FoodCreateOrderResponse {
    let order: FoodOrder
    let payment: FoodOrderPaymentResponse?
    let trackingToken: String?
}

struct FoodOrderPaymentResponse: Decodable {
    let mode: String
    let status: String
    let checkoutUrl: String?
    let checkoutSessionId: String?
    let expiresAt: Date?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case mode
        case status
        case checkoutUrl
        case checkoutSessionId
        case expiresAt
        case error
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = c.flexString(.mode) ?? "in_store_only"
        status = c.flexString(.status) ?? "unpaid"
        checkoutUrl = c.flexString(.checkoutUrl)
        checkoutSessionId = c.flexString(.checkoutSessionId)
        expiresAt = c.flexDateIfPresent(.expiresAt)
        error = c.flexString(.error)
    }
}

struct FoodCustomerProfileEnvelope: Decodable {
    let profile: FoodCustomerProfileResponse
}

struct FoodCustomerProfileResponse: Decodable {
    let preferredLanguage: String?
    let notificationsEnabled: Bool?
    let favoriteRestaurantIds: [Int64]
    let reorderTemplates: [FoodCustomerReorderTemplateResponse]
    let loyaltySummary: FoodCustomerLoyaltySummaryResponse?
    let offers: [FoodCustomerOfferResponse]

    enum CodingKeys: String, CodingKey {
        case preferredLanguage
        case notificationsEnabled
        case favoriteRestaurantIds
        case reorderTemplates
        case loyaltySummary
        case offers
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        preferredLanguage = c.flexString(.preferredLanguage)
        notificationsEnabled = try? c.decode(Bool.self, forKey: .notificationsEnabled)
        favoriteRestaurantIds = (try? c.decode([FlexibleInt64].self, forKey: .favoriteRestaurantIds).map(\.value)) ?? []
        reorderTemplates = (try? c.decode([FoodCustomerReorderTemplateResponse].self, forKey: .reorderTemplates)) ?? []
        loyaltySummary = try? c.decode(FoodCustomerLoyaltySummaryResponse.self, forKey: .loyaltySummary)
        offers = (try? c.decode([FoodCustomerOfferResponse].self, forKey: .offers)) ?? []
    }
}

struct FoodCustomerFavoriteToggleResponse: Decodable {
    let favorited: Bool
    let favoriteRestaurantIds: [Int64]

    enum CodingKeys: String, CodingKey {
        case favorited
        case favoriteRestaurantIds
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        favorited = c.flexBool(.favorited, default: false)
        favoriteRestaurantIds = (try? c.decode([FlexibleInt64].self, forKey: .favoriteRestaurantIds).map(\.value)) ?? []
    }
}

struct FoodCustomerReorderTemplateResponse: Decodable {
    let id: String
    let restaurantId: Int64
    let restaurantName: String
    let currencyCode: String
    let fulfillmentType: String
    let createdAt: Date?
    let lines: [FoodCustomerReorderLineResponse]

    enum CodingKeys: String, CodingKey {
        case id
        case restaurantId
        case restaurantName
        case currencyCode
        case fulfillmentType
        case createdAt
        case lines
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flexString(.id) ?? UUID().uuidString
        restaurantId = try c.flexInt64(.restaurantId)
        restaurantName = c.flexString(.restaurantName) ?? "Restaurant"
        currencyCode = c.flexString(.currencyCode) ?? "USD"
        fulfillmentType = c.flexString(.fulfillmentType) ?? "pickup"
        createdAt = c.flexDateIfPresent(.createdAt)
        lines = (try? c.decode([FoodCustomerReorderLineResponse].self, forKey: .lines)) ?? []
    }
}

struct FoodCustomerReorderLineResponse: Decodable {
    let menuItemId: Int64
    let itemName: String
    let quantity: Int
    let modifierIds: [Int64]
    let specialInstructions: String

    enum CodingKeys: String, CodingKey {
        case menuItemId
        case itemName
        case quantity
        case modifierIds
        case specialInstructions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        menuItemId = try c.flexInt64(.menuItemId)
        itemName = c.flexString(.itemName) ?? "Item"
        quantity = c.flexInt(.quantity, default: 1)
        modifierIds = (try? c.decode([FlexibleInt64].self, forKey: .modifierIds).map(\.value)) ?? []
        specialInstructions = c.flexString(.specialInstructions) ?? ""
    }
}

struct FoodCustomerLoyaltySummaryResponse: Decodable {
    let points: Int
    let tierName: String
    let rewardSummary: String

    enum CodingKeys: String, CodingKey {
        case points
        case tierName
        case rewardSummary
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        points = c.flexInt(.points, default: 0)
        tierName = c.flexString(.tierName) ?? "New"
        rewardSummary = c.flexString(.rewardSummary) ?? ""
    }
}

struct FoodCustomerOfferResponse: Decodable {
    let id: String
    let title: String
    let detail: String
    let code: String

    enum CodingKeys: String, CodingKey {
        case id, title, detail, code
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flexString(.id) ?? UUID().uuidString
        title = c.flexString(.title) ?? "Offer"
        detail = c.flexString(.detail) ?? ""
        code = c.flexString(.code) ?? ""
    }
}

private struct FlexibleInt64: Decodable {
    let value: Int64

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let intValue = try? container.decode(Int64.self) {
            value = intValue
        } else if let stringValue = try? container.decode(String.self), let parsed = Int64(stringValue) {
            value = parsed
        } else if let doubleValue = try? container.decode(Double.self) {
            value = Int64(doubleValue)
        } else {
            throw DecodingError.typeMismatch(
                Int64.self,
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Expected a numeric id")
            )
        }
    }
}

private struct EmptyBody: Encodable {}

struct AnyEncodable: Encodable {
    private let encodeBody: (Encoder) throws -> Void

    init(_ value: Encodable) {
        self.encodeBody = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeBody(encoder)
    }
}
