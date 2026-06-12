import Foundation

enum FoodAPIError: LocalizedError {
    case invalidURL
    case missingToken
    case server(Int)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "The OxSteed Food server URL is invalid."
        case .missingToken: return "Sign in with an OxSteed account before sending live merchant or order changes."
        case .server(let code): return "The server returned status \(code)."
        case .decoding(let message): return "The server response could not be read: \(message)"
        }
    }
}

actor FoodAPIClient {
    static let shared = FoodAPIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(session: URLSession = .shared) {
        self.session = session
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
        self.encoder = JSONEncoder()
    }

    private var baseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "OX_API_BASE_URL") as? String,
           let url = URL(string: raw),
           raw.hasPrefix("http") {
            return url
        }
        return URL(string: "https://api.oxsteed.com")!
    }

    func listRestaurants(search: String) async throws -> [FoodRestaurant] {
        var query: [URLQueryItem] = [URLQueryItem(name: "limit", value: "50")]
        if !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(URLQueryItem(name: "q", value: search))
        }
        let response: RestaurantsEnvelope = try await request("/api/food/restaurants", query: query, requiresAuth: false)
        return response.restaurants
    }

    func restaurantDetail(id: Int64) async throws -> RestaurantDetailEnvelope {
        try await request("/api/food/restaurants/\(id)", requiresAuth: false)
    }

    func createOrder(restaurantId: Int64, lines: [CartLine], fulfillment: String, tableLabel: String?, token: String?) async throws -> FoodOrder {
        struct OrderItem: Encodable {
            let menuItemId: Int64
            let quantity: Int
            let specialInstructions: String?
        }
        struct Body: Encodable {
            let fulfillmentType: String
            let orderSource: String
            let tableLabel: String?
            let items: [OrderItem]
        }
        let body = Body(
            fulfillmentType: fulfillment,
            orderSource: fulfillment == "kiosk" ? "kiosk" : "mobile",
            tableLabel: tableLabel,
            items: lines.map { OrderItem(menuItemId: $0.item.id, quantity: $0.quantity, specialInstructions: $0.specialInstructions.isEmpty ? nil : $0.specialInstructions) }
        )
        let envelope: OrderEnvelope = try await request("/api/food/restaurants/\(restaurantId)/orders", method: "POST", body: body, token: token)
        return envelope.order
    }

    func restaurantOrders(restaurantId: Int64, token: String?) async throws -> [FoodOrder] {
        let response: OrdersEnvelope = try await request("/api/food/restaurants/\(restaurantId)/orders", token: token)
        return response.orders
    }

    func updateOrderStatus(restaurantId: Int64, orderId: Int64, status: String, token: String?) async throws -> FoodOrder {
        struct Body: Encodable { let status: String }
        let response: OrderEnvelope = try await request(
            "/api/food/restaurants/\(restaurantId)/orders/\(orderId)/status",
            method: "PATCH",
            body: Body(status: status),
            token: token
        )
        return response.order
    }

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
        guard let http = response as? HTTPURLResponse else { throw FoodAPIError.server(-1) }
        guard (200...299).contains(http.statusCode) else { throw FoodAPIError.server(http.statusCode) }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw FoodAPIError.decoding(String(describing: error))
        }
    }
}

struct RestaurantsEnvelope: Decodable {
    let restaurants: [FoodRestaurant]
}

struct RestaurantDetailEnvelope: Decodable {
    let restaurant: FoodRestaurant
    let menu: [FoodMenuSection]
    let uncategorizedItems: [FoodMenuItem]
}

struct OrderEnvelope: Decodable {
    let order: FoodOrder
}

struct OrdersEnvelope: Decodable {
    let orders: [FoodOrder]
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
