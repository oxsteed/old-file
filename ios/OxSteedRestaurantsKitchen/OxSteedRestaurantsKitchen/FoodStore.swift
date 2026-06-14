import Foundation

@MainActor
final class FoodStore: ObservableObject {

    // MARK: - Customer state

    @Published var restaurants: [FoodRestaurant] = []
    @Published var selectedRestaurant: FoodRestaurant?
    @Published var menu: [FoodMenuSection] = []
    @Published var cart: [CartLine] = []
    @Published var searchText = ""
    @Published var fulfillment = "pickup"
    @Published var tableLabel = ""
    @Published var guestName = ""
    @Published var isLoading = false
    @Published var isPlacingOrder = false
    @Published var message: String?

    /// Set right after a successful order; drives the confirmation screen.
    @Published var lastPlacedOrder: FoodOrder?
    @Published var myOrders: [FoodOrder] = []
    @Published var queueBoard: FoodQueueBoard?
    @Published var lastCounterOrder: FoodOrder?

    // MARK: - Merchant state

    @Published var merchantRestaurants: [FoodRestaurant] = []
    @Published var merchantSelection: FoodRestaurant?
    @Published var merchantOrders: [FoodOrder] = []
    @Published var merchantLoaded = false
    @Published var counterCart: [CartLine] = []
    @Published var counterFulfillment = "dine_in"
    @Published var counterGuestName = ""
    @Published var counterTableLabel = ""
    @Published var isSubmittingCounterOrder = false
    @Published var crewTraining = FoodOperationsSampleData.trainingModules
    @Published var openingChecklist = FoodOperationsSampleData.openingChecklist
    @Published var inventoryItems = FoodOperationsSampleData.inventoryItems
    @Published var receivingTasks = FoodOperationsSampleData.receivingTasks
    @Published var runnerTasks = FoodOperationsSampleData.runnerTasks
    @Published var kitchenConnectionStatus = "Sample mode"
    @Published var kitchenLastSyncAt: Date?
    @Published var kitchenFullscreenLocked = true
    @Published var kitchenSampleOrders = FoodKitchenSampleData.orders
    @Published var kitchenCompletedOrders = FoodKitchenSampleData.orders.filter { $0.status == "completed" }

    // MARK: - Auth state

    @Published var signedInEmail = UserDefaults.standard.string(forKey: "ox.food.email") ?? "" {
        didSet { UserDefaults.standard.set(signedInEmail, forKey: "ox.food.email") }
    }
    @Published private(set) var accessToken = UserDefaults.standard.string(forKey: "ox.food.accessToken") ?? "" {
        didSet { UserDefaults.standard.set(accessToken, forKey: "ox.food.accessToken") }
    }
    private var refreshToken = UserDefaults.standard.string(forKey: "ox.food.refreshToken") ?? "" {
        didSet { UserDefaults.standard.set(refreshToken, forKey: "ox.food.refreshToken") }
    }

    var isSignedIn: Bool { !refreshToken.isEmpty || !accessToken.isEmpty }

    var cartTotalCents: Int {
        cart.reduce(0) { $0 + $1.lineTotalCents }
    }
    var cartItemCount: Int {
        cart.reduce(0) { $0 + $1.quantity }
    }
    var counterCartTotalCents: Int {
        counterCart.reduce(0) { $0 + $1.lineTotalCents }
    }
    var counterCartItemCount: Int {
        counterCart.reduce(0) { $0 + $1.quantity }
    }
    var activeRestaurant: FoodRestaurant? {
        merchantSelection ?? selectedRestaurant ?? merchantRestaurants.first ?? restaurants.first ?? FoodSampleData.restaurant
    }
    var kitchenBoardOrders: [FoodOrder] {
        merchantOrders.isEmpty ? kitchenSampleOrders : (merchantOrders + kitchenCompletedOrders).uniquedByID()
    }
    var managerKPIs: [FoodManagerKPI] {
        let liveOrders = merchantOrders.filter(\.isActive).count
        let readyOrders = merchantOrders.filter { $0.status == "ready" }.count
        let paidOrders = merchantOrders.filter { $0.paymentStatus == "paid" }.count
        let completionRate = crewTraining.isEmpty
            ? 0
            : Int((Double(crewTraining.filter(\.isComplete).count) / Double(crewTraining.count)) * 100)
        return [
            FoodManagerKPI(title: "Live orders", value: "\(liveOrders)", detail: "Queue across kitchen and counter", color: "flame"),
            FoodManagerKPI(title: "Ready now", value: "\(readyOrders)", detail: "Awaiting pickup or handoff", color: "basil"),
            FoodManagerKPI(title: "Paid", value: "\(paidOrders)", detail: "Marked paid at counter", color: "blue"),
            FoodManagerKPI(title: "Training", value: "\(completionRate)%", detail: "Crew completion this week", color: "saffron"),
        ]
    }
    var managerAlerts: [FoodManagerAlert] {
        var alerts: [FoodManagerAlert] = []
        if merchantOrders.contains(where: { $0.status == "received" || $0.status == "accepted" }) {
            alerts.append(FoodManagerAlert(title: "Kitchen backlog building", detail: "Advance new tickets into prep within 3 minutes.", tone: "warning"))
        }
        if inventoryItems.contains(where: { $0.stockLevel <= $0.parLevel }) {
            alerts.append(FoodManagerAlert(title: "Inventory below par", detail: "Low-stock items need receiving or 86 updates.", tone: "critical"))
        }
        if crewTraining.contains(where: { !$0.isComplete }) {
            alerts.append(FoodManagerAlert(title: "Training assignments due", detail: "Crew SOP completions are below target before next shift.", tone: "info"))
        }
        return alerts
    }

    // MARK: - Auth

    func signIn(email: String, password: String) async -> Bool {
        do {
            let session = try await FoodAPIClient.shared.login(email: email, password: password)
            guard let access = session.accessToken, !access.isEmpty else {
                message = "This account needs extra verification. Sign in once in the main OxSteed app, then try again."
                return false
            }
            accessToken = access
            refreshToken = session.refreshToken ?? ""
            signedInEmail = email
            message = nil
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func signOut() {
        accessToken = ""
        refreshToken = ""
        signedInEmail = ""
        merchantRestaurants = []
        merchantSelection = nil
        merchantOrders = []
        merchantLoaded = false
        myOrders = []
    }

    /// Runs an authenticated call; on 401, refreshes the access token once and
    /// retries. Access tokens expire after 15 minutes, so this is what makes
    /// the app usable for more than one coffee break.
    private func authed<T>(_ operation: (String) async throws -> T) async throws -> T {
        do {
            return try await operation(accessToken)
        } catch FoodAPIError.unauthorized {
            guard !refreshToken.isEmpty else { throw FoodAPIError.unauthorized }
            let session = try await FoodAPIClient.shared.refresh(refreshToken: refreshToken)
            guard let access = session.accessToken, !access.isEmpty else { throw FoodAPIError.unauthorized }
            accessToken = access
            if let rotated = session.refreshToken, !rotated.isEmpty { refreshToken = rotated }
            return try await operation(accessToken)
        }
    }

    // MARK: - Discovery

    func loadRestaurants(latitude: Double? = nil, longitude: Double? = nil) async {
        isLoading = true
        defer { isLoading = false }
        do {
            restaurants = try await FoodAPIClient.shared.listRestaurants(
                search: searchText, latitude: latitude, longitude: longitude
            )
            if restaurants.isEmpty {
                restaurants = [FoodSampleData.restaurant]
            }
            message = nil
        } catch {
            restaurants = [FoodSampleData.restaurant]
            message = nil
        }
    }

    func select(_ restaurant: FoodRestaurant) async {
        selectedRestaurant = restaurant
        menu = []
        do {
            let detail = try await FoodAPIClient.shared.restaurantDetail(id: restaurant.id)
            selectedRestaurant = detail.restaurant
            var sections = detail.menu
            if !detail.uncategorizedItems.isEmpty {
                sections.append(FoodMenuSection(id: -1, name: "More items", description: nil, items: detail.uncategorizedItems))
            }
            menu = sections
        } catch {
            menu = [FoodMenuSection(id: 1, name: "Popular", description: "Ready for kiosk, counter, and mobile orders.", items: [FoodSampleData.menuItem])]
            message = nil
        }
    }

    // MARK: - Cart + ordering

    func addToCart(_ line: CartLine) {
        cart.append(line)
    }

    func removeCartLine(_ line: CartLine) {
        cart.removeAll { $0.id == line.id }
    }

    func submitOrder() async {
        guard let restaurant = selectedRestaurant, !cart.isEmpty else { return }
        isPlacingOrder = true
        defer { isPlacingOrder = false }
        do {
            let order = try await FoodAPIClient.shared.createOrder(
                restaurantId: restaurant.id,
                lines: cart,
                fulfillment: fulfillment,
                tableLabel: fulfillment == "dine_in" && !tableLabel.isEmpty ? tableLabel : nil,
                guestName: isSignedIn || guestName.isEmpty ? nil : guestName,
                token: accessToken.isEmpty ? nil : accessToken
            )
            cart.removeAll()
            lastPlacedOrder = order
            message = nil
        } catch {
            message = "Order failed: \(error.localizedDescription)"
        }
    }

    func addCounterLine(_ item: FoodMenuItem) {
        counterCart.append(CartLine(item: item, quantity: 1, modifiers: [], specialInstructions: ""))
    }

    func removeCounterLine(_ line: CartLine) {
        counterCart.removeAll { $0.id == line.id }
    }

    func submitCounterOrder() async {
        guard let restaurant = activeRestaurant, !counterCart.isEmpty else { return }
        isSubmittingCounterOrder = true
        defer { isSubmittingCounterOrder = false }
        do {
            let order = try await FoodAPIClient.shared.createOrder(
                restaurantId: restaurant.id,
                lines: counterCart,
                fulfillment: counterFulfillment,
                tableLabel: counterFulfillment == "dine_in" && !counterTableLabel.isEmpty ? counterTableLabel : nil,
                guestName: counterGuestName.isEmpty ? "Walk-in" : counterGuestName,
                token: accessToken.isEmpty ? nil : accessToken,
                orderSource: "counter"
            )
            counterCart.removeAll()
            counterGuestName = ""
            counterTableLabel = ""
            lastCounterOrder = order
            message = "Counter order #\(order.queueNumber) sent to kitchen."
            if merchantSelection?.id == restaurant.id {
                merchantOrders.insert(order, at: 0)
            }
        } catch {
            message = "Counter order failed: \(error.localizedDescription)"
        }
    }

    func loadMyOrders() async {
        guard isSignedIn else { return }
        do {
            myOrders = try await authed { try await FoodAPIClient.shared.myOrders(token: $0) }
        } catch {
            message = error.localizedDescription
        }
    }

    func refreshQueueBoard(restaurantId: Int64) async {
        do {
            queueBoard = try await FoodAPIClient.shared.queueBoard(restaurantId: restaurantId)
        } catch {
            // Queue board polls every few seconds; transient failures are fine.
        }
    }

    // MARK: - Merchant

    func loadMerchant() async {
        guard isSignedIn else { return }
        do {
            merchantRestaurants = try await authed { try await FoodAPIClient.shared.myRestaurants(token: $0) }
            if let current = merchantSelection, let kept = merchantRestaurants.first(where: { $0.id == current.id }) {
                merchantSelection = kept
            } else {
                merchantSelection = merchantRestaurants.first
            }
            merchantLoaded = true
        } catch {
            merchantLoaded = true
            message = error.localizedDescription
        }
    }

    func loadMerchantOrders() async {
        guard let restaurant = merchantSelection ?? activeRestaurant else {
            kitchenConnectionStatus = "Sample mode"
            kitchenLastSyncAt = Date()
            return
        }
        do {
            merchantOrders = try await authed {
                try await FoodAPIClient.shared.restaurantOrders(restaurantId: restaurant.id, activeOnly: true, token: $0)
            }
            kitchenConnectionStatus = "Live feed"
            kitchenLastSyncAt = Date()
        } catch {
            kitchenConnectionStatus = isSignedIn ? "Reconnecting" : "Sample mode"
            kitchenLastSyncAt = Date()
            if merchantOrders.isEmpty {
                merchantOrders = kitchenSampleOrders
            }
        }
    }

    func bootstrapKitchenBoard() async {
        if merchantSelection == nil, let restaurant = activeRestaurant {
            merchantSelection = restaurant
        }
        if isSignedIn {
            await loadMerchant()
        } else {
            kitchenConnectionStatus = "Sample mode"
            kitchenLastSyncAt = Date()
        }
        await loadMerchantOrders()
    }

    func publishRestaurant(name: String, description: String, cuisine: String, city: String, country: String, currency: String) async -> Bool {
        do {
            let restaurant = try await authed {
                try await FoodAPIClient.shared.createRestaurant(
                    name: name,
                    description: description.isEmpty ? nil : description,
                    cuisineTags: cuisine.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
                    city: city.isEmpty ? nil : city,
                    country: country.isEmpty ? "US" : country,
                    currency: currency.isEmpty ? "USD" : currency,
                    latitude: nil,
                    longitude: nil,
                    token: $0
                )
            }
            merchantRestaurants.insert(restaurant, at: 0)
            merchantSelection = restaurant
            message = "Restaurant created. Add menu items, then press Go Live."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func setRestaurantStatus(_ status: String) async {
        guard let restaurant = merchantSelection else { return }
        do {
            let updated = try await authed {
                try await FoodAPIClient.shared.updateRestaurantStatus(restaurantId: restaurant.id, status: status, token: $0)
            }
            merchantSelection = updated
            if let index = merchantRestaurants.firstIndex(where: { $0.id == updated.id }) {
                merchantRestaurants[index] = updated
            }
            message = status == "active" ? "\(updated.displayName) is live." : nil
        } catch {
            message = error.localizedDescription
        }
    }

    func addMenuItem(name: String, priceText: String, categoryName: String) async -> Bool {
        guard let restaurant = merchantSelection else { return false }
        guard let priceValue = Double(priceText.replacingOccurrences(of: ",", with: ".")), priceValue >= 0 else {
            message = "Enter the price as a number, like 8.99."
            return false
        }
        let priceCents = Int((priceValue * 100).rounded())
        do {
            var categoryId: Int64?
            let trimmedCategory = categoryName.trimmingCharacters(in: .whitespaces)
            if !trimmedCategory.isEmpty {
                categoryId = try await authed {
                    try await FoodAPIClient.shared.createCategory(restaurantId: restaurant.id, name: trimmedCategory, token: $0)
                }
            }
            _ = try await authed {
                try await FoodAPIClient.shared.createMenuItem(
                    restaurantId: restaurant.id,
                    name: name,
                    priceCents: priceCents,
                    categoryId: categoryId,
                    description: nil,
                    token: $0
                )
            }
            message = "\(name) added to the menu."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func updateOrderStatus(_ order: FoodOrder, status: String) async {
        guard let restaurant = merchantSelection else { return }
        do {
            let updated = try await authed {
                try await FoodAPIClient.shared.updateOrderStatus(
                    restaurantId: restaurant.id, orderId: order.id, status: status, token: $0
                )
            }
            replaceMerchantOrder(updated)
        } catch {
            message = error.localizedDescription
        }
    }

    func markOrderPaid(_ order: FoodOrder) async {
        guard let restaurant = merchantSelection else { return }
        do {
            let updated = try await authed {
                try await FoodAPIClient.shared.updateOrderPayment(
                    restaurantId: restaurant.id, orderId: order.id, paymentStatus: "paid", token: $0
                )
            }
            replaceMerchantOrder(updated)
        } catch {
            message = error.localizedDescription
        }
    }

    private func replaceMerchantOrder(_ order: FoodOrder) {
        if let index = merchantOrders.firstIndex(where: { $0.id == order.id }) {
            if order.isActive {
                merchantOrders[index] = order
            } else {
                merchantOrders.remove(at: index)
                kitchenCompletedOrders.insert(order, at: 0)
            }
        } else if order.isActive {
            merchantOrders.insert(order, at: 0)
        } else {
            kitchenCompletedOrders.insert(order, at: 0)
        }
        if order.status == "completed" {
            kitchenCompletedOrders.removeAll { $0.id == order.id }
            kitchenCompletedOrders.insert(order, at: 0)
        }
        kitchenCompletedOrders = Array(kitchenCompletedOrders.prefix(12))
    }
}

struct FoodManagerKPI: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let value: String
    let detail: String
    let color: String
}

struct FoodManagerAlert: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let detail: String
    let tone: String
}

struct FoodTrainingModule: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let role: String
    let durationMinutes: Int
    var isComplete: Bool
}

struct FoodChecklistItem: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let station: String
    var isComplete: Bool
}

struct FoodInventoryItemSnapshot: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let stockLevel: Double
    let unit: String
    let parLevel: Double
    let supplier: String
}

struct FoodReceivingTask: Identifiable, Hashable {
    let id = UUID()
    let supplier: String
    let etaWindow: String
    let notes: String
}

struct FoodRunnerTask: Identifiable, Hashable {
    let id = UUID()
    let stopName: String
    let taskType: String
    let status: String
    let notes: String
}

enum FoodOperationsSampleData {
    static let trainingModules = [
        FoodTrainingModule(title: "Opening line check", role: "Cashier", durationMinutes: 10, isComplete: true),
        FoodTrainingModule(title: "Allergen handoff protocol", role: "Kitchen", durationMinutes: 14, isComplete: false),
        FoodTrainingModule(title: "Refund and void policy", role: "Manager", durationMinutes: 8, isComplete: false),
    ]

    static let openingChecklist = [
        FoodChecklistItem(title: "Hot hold verified above 135F", station: "Expo", isComplete: true),
        FoodChecklistItem(title: "Kiosk printer paper loaded", station: "Front counter", isComplete: false),
        FoodChecklistItem(title: "Queue board tested", station: "Dining room", isComplete: true),
    ]

    static let inventoryItems = [
        FoodInventoryItemSnapshot(name: "Burger buns", stockLevel: 38, unit: "ea", parLevel: 48, supplier: "Metro Bake"),
        FoodInventoryItemSnapshot(name: "Ground beef", stockLevel: 22, unit: "lb", parLevel: 30, supplier: "Prime Supply"),
        FoodInventoryItemSnapshot(name: "Cold brew", stockLevel: 8, unit: "qt", parLevel: 6, supplier: "Ox Roasters"),
    ]

    static let receivingTasks = [
        FoodReceivingTask(supplier: "Prime Supply", etaWindow: "11:00-11:30", notes: "Confirm temp on protein cases."),
        FoodReceivingTask(supplier: "Metro Bake", etaWindow: "13:30-14:00", notes: "Short shipment pending from yesterday."),
    ]

    static let runnerTasks = [
        FoodRunnerTask(stopName: "Lobby pickup rack", taskType: "Customer pickup", status: "Ready", notes: "Order #42 awaiting handoff."),
        FoodRunnerTask(stopName: "Office park catering", taskType: "Delivery", status: "Assigned", notes: "Proof photo required on drop."),
        FoodRunnerTask(stopName: "Supplier return", taskType: "Logistics", status: "Queued", notes: "Return damaged syrup case."),
    ]
}

enum FoodKitchenSampleData {
    static let orders = [
        FoodOrder(
            id: 9001,
            restaurantId: 1,
            restaurantName: "Ox Burger Lab",
            status: "received",
            fulfillmentType: "pickup",
            orderSource: "counter",
            paymentStatus: "paid",
            queueNumber: 51,
            subtotalCents: 2498,
            totalCents: 2498,
            currencyCode: "USD",
            tableLabel: nil,
            guestName: "Erica",
            createdAt: Date().addingTimeInterval(-120),
            promisedAt: Date().addingTimeInterval(480),
            items: [
                FoodOrderLine(id: 1, itemName: "Classic Ox Burger - Double / No tomato", quantity: 1, lineTotalCents: 1149, specialInstructions: "Extra pickles"),
                FoodOrderLine(id: 2, itemName: "Fries - Large", quantity: 1, lineTotalCents: 499, specialInstructions: nil),
                FoodOrderLine(id: 3, itemName: "Cold Brew", quantity: 1, lineTotalCents: 850, specialInstructions: "No ice")
            ]
        ),
        FoodOrder(
            id: 9002,
            restaurantId: 1,
            restaurantName: "Ox Burger Lab",
            status: "preparing",
            fulfillmentType: "dine_in",
            orderSource: "kiosk",
            paymentStatus: "paid",
            queueNumber: 52,
            subtotalCents: 3298,
            totalCents: 3298,
            currencyCode: "USD",
            tableLabel: "Table 14",
            guestName: nil,
            createdAt: Date().addingTimeInterval(-760),
            promisedAt: Date().addingTimeInterval(-40),
            items: [
                FoodOrderLine(id: 4, itemName: "Signature Melt", quantity: 2, lineTotalCents: 2398, specialInstructions: "One no onions"),
                FoodOrderLine(id: 5, itemName: "Kids fries", quantity: 1, lineTotalCents: 450, specialInstructions: nil),
                FoodOrderLine(id: 6, itemName: "Shake - Vanilla", quantity: 1, lineTotalCents: 450, specialInstructions: nil)
            ]
        ),
        FoodOrder(
            id: 9004,
            restaurantId: 1,
            restaurantName: "Ox Burger Lab",
            status: "completed",
            fulfillmentType: "pickup",
            orderSource: "counter",
            paymentStatus: "paid",
            queueNumber: 50,
            subtotalCents: 1549,
            totalCents: 1549,
            currencyCode: "USD",
            tableLabel: nil,
            guestName: "Ava",
            createdAt: Date().addingTimeInterval(-900),
            promisedAt: Date().addingTimeInterval(-300),
            items: [
                FoodOrderLine(id: 10, itemName: "Veggie Burger", quantity: 1, lineTotalCents: 1049, specialInstructions: nil),
                FoodOrderLine(id: 11, itemName: "House soda", quantity: 1, lineTotalCents: 500, specialInstructions: nil)
            ]
        ),
        FoodOrder(
            id: 9003,
            restaurantId: 1,
            restaurantName: "Ox Burger Lab",
            status: "ready",
            fulfillmentType: "pickup",
            orderSource: "mobile",
            paymentStatus: "paid",
            queueNumber: 53,
            subtotalCents: 1899,
            totalCents: 1899,
            currencyCode: "USD",
            tableLabel: nil,
            guestName: "Pickup - Sam",
            createdAt: Date().addingTimeInterval(-420),
            promisedAt: Date().addingTimeInterval(60),
            items: [
                FoodOrderLine(id: 7, itemName: "Classic Ox Burger", quantity: 1, lineTotalCents: 899, specialInstructions: nil),
                FoodOrderLine(id: 8, itemName: "Onion rings", quantity: 1, lineTotalCents: 500, specialInstructions: "Crispy"),
                FoodOrderLine(id: 9, itemName: "Sweet tea", quantity: 1, lineTotalCents: 500, specialInstructions: nil)
            ]
        )
    ]
}

private extension Array where Element == FoodOrder {
    func uniquedByID() -> [FoodOrder] {
        var seen = Set<Int64>()
        return filter { seen.insert($0.id).inserted }
    }
}

/// Sample content for SwiftUI previews only. The live app never substitutes
/// this for real API data.
enum FoodSampleData {
    static let restaurant = FoodRestaurant(
        id: 1,
        businessId: 101,
        displayName: "Ox Burger Lab",
        description: "Fast pickup, kiosk ordering, and a live kitchen board.",
        cuisineTags: ["Burgers", "Coffee"],
        coverPhotoUrl: nil,
        logoUrl: nil,
        addressCity: "Miami",
        addressState: "FL",
        addressCountry: "US",
        latitude: 25.7617,
        longitude: -80.1918,
        currencyCode: "USD",
        fulfillmentModes: ["pickup", "dine_in", "kiosk"],
        acceptsOnlineOrders: true,
        acceptsInStoreOrders: true,
        kitchenDisplayEnabled: true,
        prepTimeMin: 12,
        distanceKm: 1.4,
        status: "active"
    )

    static let menuItem = FoodMenuItem(
        id: 11,
        categoryId: 1,
        name: "Classic Ox Burger",
        description: "Double patty, lettuce, tomato, house sauce.",
        imageUrl: nil,
        priceCents: 899,
        currencyCode: "USD",
        isAvailable: true,
        tags: ["Popular"],
        allergens: ["Dairy", "Gluten"],
        modifierGroups: [
            FoodModifierGroup(id: 1, name: "Size", minSelect: 1, maxSelect: 1, isRequired: true, options: [
                FoodModifier(id: 1, name: "Single", priceDeltaCents: 0, isAvailable: true),
                FoodModifier(id: 2, name: "Double", priceDeltaCents: 250, isAvailable: true),
            ])
        ]
    )
}
