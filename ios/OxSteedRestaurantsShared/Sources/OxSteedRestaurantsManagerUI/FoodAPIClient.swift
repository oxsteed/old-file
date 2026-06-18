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

    func login(email: String, password: String) async throws -> FoodAuthSession {
        struct Body: Encodable { let email: String; let password: String }
        return try await request("/api/auth/login", method: "POST", body: Body(email: email, password: password), requiresAuth: false)
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

    func fetchSetupProgress(restaurantId: Int64, token: String) async throws -> FoodSetupProgress {
        try await request("/api/food/restaurants/\(restaurantId)/setup-progress", token: token)
    }

    func listLocations(restaurantId: Int64, token: String) async throws -> [FoodRestaurantLocation] {
        struct Envelope: Decodable { let locations: [FoodRestaurantLocation] }
        let envelope: Envelope = try await request("/api/food/restaurants/\(restaurantId)/locations", token: token)
        return envelope.locations
    }

    func createLocation(
        restaurantId: Int64,
        name: String,
        city: String?,
        isPrimary: Bool,
        token: String
    ) async throws -> FoodRestaurantLocation {
        struct Body: Encodable {
            let name: String
            let addressCity: String?
            let isPrimary: Bool
            enum CodingKeys: String, CodingKey {
                case name
                case addressCity = "address_city"
                case isPrimary = "is_primary"
            }
        }
        struct Envelope: Decodable { let location: FoodRestaurantLocation }
        let envelope: Envelope = try await request(
            "/api/food/restaurants/\(restaurantId)/locations",
            method: "POST",
            body: Body(name: name, addressCity: city, isPrimary: isPrimary),
            token: token
        )
        return envelope.location
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

    func updateMenuItemAvailability(
        restaurantId: Int64,
        itemId: Int64,
        isAvailable: Bool,
        token: String
    ) async throws -> FoodMenuItem {
        struct Body: Encodable { let isAvailable: Bool }
        struct Envelope: Decodable { let item: FoodMenuItem }
        let envelope: Envelope = try await request(
            "/api/food/restaurants/\(restaurantId)/menu-items/\(itemId)",
            method: "PATCH",
            body: Body(isAvailable: isAvailable),
            token: token
        )
        return envelope.item
    }

    func updateMenuItem(
        restaurantId: Int64,
        itemId: Int64,
        name: String,
        description: String?,
        priceCents: Int,
        token: String
    ) async throws -> FoodMenuItem {
        struct Body: Encodable {
            let name: String
            let description: String?
            let priceCents: Int
        }
        struct Envelope: Decodable { let item: FoodMenuItem }
        let envelope: Envelope = try await request(
            "/api/food/restaurants/\(restaurantId)/menu-items/\(itemId)",
            method: "PATCH",
            body: Body(name: name, description: description, priceCents: priceCents),
            token: token
        )
        return envelope.item
    }

    func deleteMenuItem(restaurantId: Int64, itemId: Int64, token: String) async throws {
        _ = try await request(
            "/api/food/restaurants/\(restaurantId)/menu-items/\(itemId)",
            method: "DELETE",
            token: token
        ) as EmptyResponse
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

    // MARK: - Restaurant ops + manager dashboard support

    func checklistTemplates(restaurantId: Int64, token: String) async throws -> [RestaurantChecklistTemplateResponse] {
        let response: RestaurantChecklistTemplatesEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/checklists",
            token: token
        )
        return response.checklists
    }

    func createChecklist(
        restaurantId: Int64,
        name: String,
        checklistType: String,
        description: String?,
        tasks: [RestaurantChecklistTaskCreateBody],
        token: String
    ) async throws -> RestaurantChecklistTemplateResponse {
        struct Body: Encodable {
            let name: String
            let checklistType: String
            let description: String?
            let tasks: [RestaurantChecklistTaskCreateBody]
        }
        let response: RestaurantChecklistTemplateEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/checklists",
            method: "POST",
            body: Body(
                name: name,
                checklistType: checklistType,
                description: description,
                tasks: tasks
            ),
            token: token
        )
        return response.checklist
    }

    func checklistRuns(restaurantId: Int64, limit: Int = 20, token: String) async throws -> [RestaurantChecklistRunListItemResponse] {
        let response: RestaurantChecklistRunsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/checklist-runs",
            query: [URLQueryItem(name: "limit", value: String(limit))],
            token: token
        )
        return response.runs
    }

    func checklistRun(restaurantId: Int64, runId: Int64, token: String) async throws -> RestaurantChecklistRunResponse {
        let response: RestaurantChecklistRunEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/runs/\(runId)",
            token: token
        )
        return response.run
    }

    func listSops(restaurantId: Int64, token: String) async throws -> [RestaurantSOPResponse] {
        let response: RestaurantSOPsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/sops",
            token: token
        )
        return response.sops
    }

    func createSop(
        restaurantId: Int64,
        title: String,
        category: String,
        body: String,
        isPublished: Bool,
        token: String
    ) async throws -> RestaurantSOPResponse {
        struct Body: Encodable {
            let title: String
            let category: String
            let body: String
            let isPublished: Bool
        }
        let response: RestaurantSOPEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/sops",
            method: "POST",
            body: Body(
                title: title,
                category: category,
                body: body,
                isPublished: isPublished
            ),
            token: token
        )
        return response.sop
    }

    func businessMemberships(businessId: Int64, token: String) async throws -> [BusinessMembershipResponse] {
        let response: BusinessMembershipsEnvelope = try await request(
            "/api/businesses/\(businessId)/memberships",
            token: token
        )
        return response.data
    }

    func inviteBusinessMember(
        businessId: Int64,
        email: String,
        role: String,
        token: String
    ) async throws {
        struct Body: Encodable {
            let email: String
            let role: String
        }
        _ = try await request(
            "/api/businesses/\(businessId)/members",
            method: "POST",
            body: Body(email: email, role: role),
            token: token
        ) as EmptyResponse
    }

    func revokeBusinessMember(businessId: Int64, membershipId: Int64, token: String) async throws {
        _ = try await request(
            "/api/businesses/\(businessId)/members/\(membershipId)",
            method: "DELETE",
            token: token
        ) as EmptyResponse
    }

    func changeBusinessMembershipRole(
        businessId: Int64,
        membershipId: Int64,
        role: String,
        token: String
    ) async throws {
        struct Body: Encodable { let role: String }
        _ = try await request(
            "/api/businesses/\(businessId)/memberships/\(membershipId)/role",
            method: "PATCH",
            body: Body(role: role),
            token: token
        ) as EmptyResponse
    }

    func crewDashboard(restaurantId: Int64, token: String) async throws -> RestaurantCrewDashboardResponse {
        try await request("/api/restaurants/\(restaurantId)/crew/dashboard", token: token)
    }

    func bootstrapCrewDefaults(restaurantId: Int64, token: String) async throws -> RestaurantCrewDashboardResponse {
        try await request(
            "/api/restaurants/\(restaurantId)/crew/bootstrap-defaults",
            method: "POST",
            body: EmptyBody(),
            token: token
        )
    }

    func inventoryItems(restaurantId: Int64, token: String) async throws -> [RestaurantInventoryItemResponse] {
        let response: RestaurantInventoryItemsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/inventory/items",
            token: token
        )
        return response.items
    }

    func helpRequests(restaurantId: Int64, token: String) async throws -> [RestaurantHelpRequestResponse] {
        let response: RestaurantHelpRequestsEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/help-requests",
            token: token
        )
        return response.helpRequests
    }

    func createHelpRequest(
        restaurantId: Int64,
        title: String,
        detail: String,
        urgency: String,
        linkedLocation: String?,
        token: String
    ) async throws -> RestaurantHelpRequestResponse {
        struct Body: Encodable {
            let title: String
            let detail: String
            let urgency: String
            let linkedLocation: String?
        }
        let response: RestaurantHelpRequestEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/help-requests",
            method: "POST",
            body: Body(title: title, detail: detail, urgency: urgency, linkedLocation: linkedLocation),
            token: token
        )
        return response.helpRequest
    }

    func updateHelpRequest(
        restaurantId: Int64,
        helpRequestId: Int64,
        status: String,
        resolutionNote: String? = nil,
        token: String
    ) async throws -> RestaurantHelpRequestResponse {
        struct Body: Encodable {
            let status: String
            let resolutionNote: String?
        }
        let response: RestaurantHelpRequestEnvelope = try await request(
            "/api/restaurants/\(restaurantId)/help-requests/\(helpRequestId)",
            method: "PATCH",
            body: Body(status: status, resolutionNote: resolutionNote),
            token: token
        )
        return response.helpRequest
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
        if let error = object["error"] as? [String: Any], let message = error["message"] as? String { return message }
        if let message = object["message"] as? String { return message }
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

struct RestaurantChecklistTemplatesEnvelope: Decodable {
    let checklists: [RestaurantChecklistTemplateResponse]
}

struct RestaurantChecklistTemplateEnvelope: Decodable {
    let checklist: RestaurantChecklistTemplateResponse
}

struct RestaurantChecklistTemplateResponse: Decodable {
    let id: Int64
    let name: String
    let checklistType: String
    let description: String?
    let isActive: Bool
    let tasks: [RestaurantChecklistTaskResponse]

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case checklistType = "checklist_type"
        case description
        case isActive = "is_active"
        case tasks
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        name = c.flexString(.name) ?? "Checklist"
        checklistType = c.flexString(.checklistType) ?? "custom"
        description = c.flexString(.description)
        isActive = c.flexBool(.isActive, default: true)
        tasks = (try? c.decode([RestaurantChecklistTaskResponse].self, forKey: .tasks)) ?? []
    }
}

struct RestaurantChecklistTaskCreateBody: Encodable {
    let label: String
    let instructions: String?
    let requiresNote: Bool
}

struct RestaurantChecklistTaskResponse: Decodable {
    let id: Int64
    let label: String
    let instructions: String?
    let requiresNote: Bool
    let isActive: Bool
    let sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case label
        case instructions
        case requiresNote = "requires_note"
        case isActive = "is_active"
        case sortOrder = "sort_order"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        label = c.flexString(.label) ?? "Task"
        instructions = c.flexString(.instructions)
        requiresNote = c.flexBool(.requiresNote, default: false)
        isActive = c.flexBool(.isActive, default: true)
        sortOrder = c.flexInt(.sortOrder, default: 0)
    }
}

struct RestaurantChecklistRunsEnvelope: Decodable {
    let runs: [RestaurantChecklistRunListItemResponse]
}

struct RestaurantChecklistRunListItemResponse: Decodable {
    let id: Int64
    let checklistId: Int64
    let checklistName: String
    let checklistType: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case id
        case checklistId = "checklist_id"
        case checklistName = "checklist_name"
        case checklistType = "checklist_type"
        case status
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        checklistId = try c.flexInt64(.checklistId)
        checklistName = c.flexString(.checklistName) ?? "Checklist"
        checklistType = c.flexString(.checklistType) ?? "custom"
        status = c.flexString(.status) ?? "in_progress"
    }
}

struct RestaurantChecklistRunEnvelope: Decodable {
    let run: RestaurantChecklistRunResponse
}

struct RestaurantChecklistRunResponse: Decodable {
    let id: Int64
    let checklistId: Int64
    let status: String
    let items: [RestaurantChecklistRunItemResponse]

    enum CodingKeys: String, CodingKey {
        case id
        case checklistId = "checklist_id"
        case status
        case items
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        checklistId = try c.flexInt64(.checklistId)
        status = c.flexString(.status) ?? "in_progress"
        items = (try? c.decode([RestaurantChecklistRunItemResponse].self, forKey: .items)) ?? []
    }
}

struct RestaurantSOPsEnvelope: Decodable {
    let sops: [RestaurantSOPResponse]
}

struct RestaurantSOPEnvelope: Decodable {
    let sop: RestaurantSOPResponse
}

struct BusinessMembershipsEnvelope: Decodable {
    let data: [BusinessMembershipResponse]
}

struct RestaurantSOPResponse: Decodable {
    let id: Int64
    let title: String
    let category: String
    let body: String?
    let isPublished: Bool
    let version: Int

    enum CodingKeys: String, CodingKey {
        case id, title, category, body, version
        case isPublished = "is_published"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        title = c.flexString(.title) ?? "SOP"
        category = c.flexString(.category) ?? "general"
        body = c.flexString(.body)
        isPublished = c.flexBool(.isPublished, default: true)
        version = c.flexInt(.version, default: 1)
    }
}

struct BusinessMembershipResponse: Decodable {
    let id: Int64
    let memberId: String?
    let role: String
    let status: String
    let inviteEmail: String?
    let firstName: String?
    let lastName: String?
    let userEmail: String?
    let permissions: [String]

    enum CodingKeys: String, CodingKey {
        case id
        case memberId = "member_id"
        case role
        case status
        case inviteEmail = "invite_email"
        case firstName = "first_name"
        case lastName = "last_name"
        case userEmail = "user_email"
        case permissions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        memberId = try? c.decodeIfPresent(String.self, forKey: .memberId)
        role = c.flexString(.role) ?? "employee"
        status = c.flexString(.status) ?? "pending"
        inviteEmail = c.flexString(.inviteEmail)
        firstName = c.flexString(.firstName)
        lastName = c.flexString(.lastName)
        userEmail = c.flexString(.userEmail)
        permissions = (try? c.decode([String].self, forKey: .permissions)) ?? []
    }
}

private struct EmptyResponse: Decodable {}

struct RestaurantChecklistRunItemResponse: Decodable {
    let id: Int64
    let taskId: Int64?
    let label: String
    let note: String?
    let isDone: Bool
    let requiresNote: Bool
    let sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case taskId = "task_id"
        case label
        case note
        case isDone = "is_done"
        case requiresNote = "requires_note"
        case sortOrder = "sort_order"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        taskId = c.flexInt64IfPresent(.taskId)
        label = c.flexString(.label) ?? "Task"
        note = c.flexString(.note)
        isDone = c.flexBool(.isDone, default: false)
        requiresNote = c.flexBool(.requiresNote, default: false)
        sortOrder = c.flexInt(.sortOrder, default: 0)
    }
}

struct RestaurantCrewDashboardResponse: Decodable {
    let modules: [RestaurantCrewTrainingModuleResponse]
    let quizzes: [RestaurantCrewQuizResultResponse]
    let badges: [RestaurantCrewBadgeResponse]
}

struct RestaurantCrewTrainingModuleResponse: Decodable {
    let id: Int64
    let title: String
    let role: String
    let durationMinutes: Int
    let isComplete: Bool

    enum CodingKeys: String, CodingKey {
        case id, title, role
        case durationMinutes = "duration_minutes"
        case isComplete = "is_complete"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        title = c.flexString(.title) ?? "Training"
        role = c.flexString(.role) ?? "Crew"
        durationMinutes = c.flexInt(.durationMinutes, default: 0)
        isComplete = c.flexBool(.isComplete, default: false)
    }
}

struct RestaurantCrewQuizResultResponse: Decodable {
    let id: Int64
    let title: String
    let scorePercent: Int
    let attempts: Int
    let passed: Bool

    enum CodingKeys: String, CodingKey {
        case id, title, attempts, passed
        case scorePercent = "score_percent"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        title = c.flexString(.title) ?? "Quiz"
        scorePercent = c.flexInt(.scorePercent, default: 0)
        attempts = c.flexInt(.attempts, default: 0)
        passed = c.flexBool(.passed, default: false)
    }
}

struct RestaurantCrewBadgeResponse: Decodable {
    let id: Int64
    let title: String
    let detail: String
    let awarded: Bool

    enum CodingKeys: String, CodingKey {
        case id, title, detail, awarded
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        title = c.flexString(.title) ?? "Badge"
        detail = c.flexString(.detail) ?? ""
        awarded = c.flexBool(.awarded, default: false)
    }
}

struct RestaurantInventoryItemsEnvelope: Decodable {
    let items: [RestaurantInventoryItemResponse]
}

struct RestaurantHelpRequestsEnvelope: Decodable {
    let helpRequests: [RestaurantHelpRequestResponse]
}

struct RestaurantHelpRequestEnvelope: Decodable {
    let helpRequest: RestaurantHelpRequestResponse
}

struct RestaurantHelpRequestResponse: Decodable {
    let id: Int64
    let title: String
    let detail: String
    let urgency: String
    let status: String
    let linkedLocation: String?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, title, detail, urgency, status
        case linkedLocation = "linked_location"
        case createdAt = "created_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        title = c.flexString(.title) ?? "Help request"
        detail = c.flexString(.detail) ?? ""
        urgency = c.flexString(.urgency) ?? "High"
        status = c.flexString(.status) ?? "open"
        linkedLocation = c.flexString(.linkedLocation)
        if let date = try? c.decode(Date.self, forKey: .createdAt) {
            createdAt = date
        } else if let raw = c.flexString(.createdAt),
                  let parsed = ISO8601DateFormatter().date(from: raw) {
            createdAt = parsed
        } else {
            createdAt = .now
        }
    }
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
        case id, name, unit, quantity
        case isLow = "is_low"
        case lowStockThreshold = "low_stock_threshold"
        case supplierName = "supplier_name"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        name = c.flexString(.name) ?? "Inventory item"
        unit = c.flexString(.unit) ?? "ea"
        quantity = try c.decodeFlexibleDouble(forKey: .quantity)
        lowStockThreshold = try c.decodeFlexibleDouble(forKey: .lowStockThreshold)
        supplierName = c.flexString(.supplierName)
        isLow = c.flexBool(.isLow, default: false)
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
