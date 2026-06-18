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

    // MARK: - Restaurant ops inventory

    func inventoryItems(restaurantId: Int64, token: String) async throws -> [RestaurantInventoryItemResponse] {
        let response: RestaurantInventoryItemsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/items",
            token: token
        )
        return response.items
    }

    func inventoryAdjustments(restaurantId: Int64, token: String) async throws -> [RestaurantInventoryAdjustmentResponse] {
        let response: RestaurantInventoryAdjustmentsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/adjustments",
            token: token
        )
        return response.adjustments
    }

    func createInventoryItem(
        restaurantId: Int64,
        name: String,
        unit: String,
        quantity: Double,
        lowStockThreshold: Double,
        supplierName: String?,
        token: String
    ) async throws -> RestaurantInventoryItemResponse {
        struct Body: Encodable {
            let name: String
            let unit: String
            let quantity: Double
            let lowStockThreshold: Double
            let supplierName: String?
        }
        let response: RestaurantInventoryItemEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/items",
            method: "POST",
            body: Body(
                name: name,
                unit: unit,
                quantity: quantity,
                lowStockThreshold: lowStockThreshold,
                supplierName: supplierName
            ),
            token: token
        )
        return response.item
    }

    func updateInventoryItem(
        restaurantId: Int64,
        itemId: Int64,
        name: String,
        unit: String,
        lowStockThreshold: Double,
        supplierName: String?,
        token: String
    ) async throws -> RestaurantInventoryItemResponse {
        struct Body: Encodable {
            let name: String
            let unit: String
            let lowStockThreshold: Double
            let supplierName: String?
        }
        let response: RestaurantInventoryItemEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/items/\(itemId)",
            method: "PATCH",
            body: Body(
                name: name,
                unit: unit,
                lowStockThreshold: lowStockThreshold,
                supplierName: supplierName
            ),
            token: token
        )
        return response.item
    }

    func deleteInventoryItem(restaurantId: Int64, itemId: Int64, token: String) async throws {
        _ = try await request(
            "/api/restaurants/\(restaurantId)/inventory/items/\(itemId)",
            method: "DELETE",
            token: token
        ) as EmptyResponse
    }

    func adjustInventoryItem(
        restaurantId: Int64,
        itemId: Int64,
        type: String,
        delta: Double? = nil,
        quantity: Double? = nil,
        note: String? = nil,
        token: String
    ) async throws -> RestaurantInventoryItemResponse {
        struct Body: Encodable {
            let type: String
            let delta: Double?
            let quantity: Double?
            let note: String?
        }
        let response: RestaurantInventoryItemEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/items/\(itemId)/adjust",
            method: "POST",
            body: Body(type: type, delta: delta, quantity: quantity, note: note),
            token: token
        )
        return response.item
    }

    func purchaseRequests(restaurantId: Int64, token: String) async throws -> [RestaurantInventoryPurchaseRequestResponse] {
        let response: RestaurantInventoryPurchaseRequestsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/purchase-requests",
            token: token
        )
        return response.requests
    }

    func createPurchaseRequest(
        restaurantId: Int64,
        itemName: String,
        requestedQuantity: Double,
        unit: String,
        supplierName: String?,
        note: String?,
        token: String
    ) async throws -> RestaurantInventoryPurchaseRequestResponse {
        struct Body: Encodable {
            let itemName: String
            let requestedQuantity: Double
            let unit: String
            let supplierName: String?
            let note: String?
        }
        let response: RestaurantInventoryPurchaseRequestEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/purchase-requests",
            method: "POST",
            body: Body(
                itemName: itemName,
                requestedQuantity: requestedQuantity,
                unit: unit,
                supplierName: supplierName,
                note: note
            ),
            token: token
        )
        return response.request
    }

    func updatePurchaseRequest(
        restaurantId: Int64,
        requestId: Int64,
        status: String,
        token: String
    ) async throws -> RestaurantInventoryPurchaseRequestResponse {
        struct Body: Encodable { let status: String }
        let response: RestaurantInventoryPurchaseRequestEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/purchase-requests/\(requestId)",
            method: "PATCH",
            body: Body(status: status),
            token: token
        )
        return response.request
    }

    func supplierIssues(restaurantId: Int64, token: String) async throws -> [RestaurantInventorySupplierIssueResponse] {
        let response: RestaurantInventorySupplierIssuesEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/supplier-issues",
            token: token
        )
        return response.issues
    }

    func inventoryMappings(restaurantId: Int64, token: String) async throws -> [RestaurantInventoryMappingResponse] {
        let response: RestaurantInventoryMappingsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/mappings",
            token: token
        )
        return response.mappings
    }

    func bootstrapInventoryMappings(restaurantId: Int64, token: String) async throws -> [RestaurantInventoryMappingResponse] {
        let response: RestaurantInventoryMappingsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/mappings/bootstrap-defaults",
            method: "POST",
            body: AnyEncodable(EmptyBody()),
            token: token
        )
        return response.mappings
    }

    func createSupplierIssue(
        restaurantId: Int64,
        supplierName: String,
        issue: String,
        relatedPurchaseRequestId: Int64? = nil,
        token: String
    ) async throws -> RestaurantInventorySupplierIssueResponse {
        struct Body: Encodable {
            let supplierName: String
            let issue: String
            let relatedPurchaseRequestId: Int64?
        }
        let response: RestaurantInventorySupplierIssueEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/supplier-issues",
            method: "POST",
            body: Body(
                supplierName: supplierName,
                issue: issue,
                relatedPurchaseRequestId: relatedPurchaseRequestId
            ),
            token: token
        )
        return response.issue
    }

    func updateSupplierIssue(
        restaurantId: Int64,
        issueId: Int64,
        status: String,
        token: String
    ) async throws -> RestaurantInventorySupplierIssueResponse {
        struct Body: Encodable { let status: String }
        let response: RestaurantInventorySupplierIssueEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/supplier-issues/\(issueId)",
            method: "PATCH",
            body: Body(status: status),
            token: token
        )
        return response.issue
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

struct RestaurantInventoryItemsEnvelope: Decodable {
    let items: [RestaurantInventoryItemResponse]
}

struct RestaurantInventoryItemEnvelope: Decodable {
    let item: RestaurantInventoryItemResponse
}

struct RestaurantInventoryAdjustmentsEnvelope: Decodable {
    let adjustments: [RestaurantInventoryAdjustmentResponse]
}

struct RestaurantInventoryPurchaseRequestsEnvelope: Decodable {
    let requests: [RestaurantInventoryPurchaseRequestResponse]
}

struct RestaurantInventoryPurchaseRequestEnvelope: Decodable {
    let request: RestaurantInventoryPurchaseRequestResponse
}

struct RestaurantInventorySupplierIssuesEnvelope: Decodable {
    let issues: [RestaurantInventorySupplierIssueResponse]
}

struct RestaurantInventorySupplierIssueEnvelope: Decodable {
    let issue: RestaurantInventorySupplierIssueResponse
}

struct RestaurantInventoryMappingsEnvelope: Decodable {
    let mappings: [RestaurantInventoryMappingResponse]
}

struct RestaurantInventoryItemResponse: Decodable {
    let id: Int64
    let name: String
    let unit: String
    let quantity: Double
    let lowStockThreshold: Double
    let supplierName: String?
    let isLow: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, unit, quantity, isLow = "is_low"
        case lowStockThreshold = "low_stock_threshold"
        case supplierName = "supplier_name"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        name = try c.decode(String.self, forKey: .name)
        unit = try c.decode(String.self, forKey: .unit)
        quantity = try c.decodeFlexibleDouble(forKey: .quantity)
        lowStockThreshold = try c.decodeFlexibleDouble(forKey: .lowStockThreshold)
        supplierName = try c.decodeIfPresent(String.self, forKey: .supplierName)
        isLow = (try? c.decode(Bool.self, forKey: .isLow)) ?? false
    }
}

struct RestaurantInventoryAdjustmentResponse: Decodable {
    let id: Int64
    let itemId: Int64?
    let itemName: String
    let adjustmentType: String
    let quantityDelta: Double
    let quantityAfter: Double
    let note: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, note
        case itemId = "item_id"
        case itemName = "item_name"
        case adjustmentType = "adjustment_type"
        case quantityDelta = "quantity_delta"
        case quantityAfter = "quantity_after"
        case createdAt = "created_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        itemId = try? c.flexInt64(.itemId)
        itemName = try c.decode(String.self, forKey: .itemName)
        adjustmentType = try c.decode(String.self, forKey: .adjustmentType)
        quantityDelta = try c.decodeFlexibleDouble(forKey: .quantityDelta)
        quantityAfter = try c.decodeFlexibleDouble(forKey: .quantityAfter)
        note = try c.decodeIfPresent(String.self, forKey: .note)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

struct RestaurantInventoryPurchaseRequestResponse: Decodable {
    let id: Int64
    let itemName: String
    let requestedQuantity: Double
    let unit: String
    let supplierName: String?
    let status: String
    let etaWindow: String?
    let note: String?

    enum CodingKeys: String, CodingKey {
        case id, unit, status, note
        case itemName = "item_name"
        case requestedQuantity = "requested_quantity"
        case supplierName = "supplier_name"
        case etaWindow = "eta_window"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        itemName = try c.decode(String.self, forKey: .itemName)
        requestedQuantity = try c.decodeFlexibleDouble(forKey: .requestedQuantity)
        unit = try c.decode(String.self, forKey: .unit)
        supplierName = try c.decodeIfPresent(String.self, forKey: .supplierName)
        status = try c.decode(String.self, forKey: .status)
        etaWindow = try c.decodeIfPresent(String.self, forKey: .etaWindow)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }
}

struct RestaurantInventorySupplierIssueResponse: Decodable {
    let id: Int64
    let supplierName: String
    let issue: String
    let status: String
    let relatedPurchaseRequestId: Int64?

    enum CodingKeys: String, CodingKey {
        case id, issue, status
        case supplierName = "supplier_name"
        case relatedPurchaseRequestId = "related_purchase_request_id"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        supplierName = try c.decode(String.self, forKey: .supplierName)
        issue = try c.decode(String.self, forKey: .issue)
        status = try c.decode(String.self, forKey: .status)
        relatedPurchaseRequestId = try? c.flexInt64(.relatedPurchaseRequestId)
    }
}

struct RestaurantInventoryMappingResponse: Decodable {
    let id: Int64
    let inventoryItemId: Int64
    let inventoryItemName: String
    let menuItemId: Int64
    let menuItemName: String
    let usageLabel: String

    enum CodingKeys: String, CodingKey {
        case id
        case inventoryItemId = "inventory_item_id"
        case inventoryItemName = "inventory_item_name"
        case menuItemId = "menu_item_id"
        case menuItemName = "menu_item_name"
        case usageLabel = "usage_label"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        inventoryItemId = try c.flexInt64(.inventoryItemId)
        inventoryItemName = try c.decode(String.self, forKey: .inventoryItemName)
        menuItemId = try c.flexInt64(.menuItemId)
        menuItemName = try c.decode(String.self, forKey: .menuItemName)
        usageLabel = try c.decode(String.self, forKey: .usageLabel)
    }
}

private struct EmptyBody: Encodable {}
private struct EmptyResponse: Decodable {}

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
