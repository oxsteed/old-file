import Foundation

@MainActor
final class FoodStore: ObservableObject {
    @Published var restaurants: [FoodRestaurant] = FoodSampleData.restaurants
    @Published var selectedRestaurant: FoodRestaurant = FoodSampleData.restaurants[0]
    @Published var menu: [FoodMenuSection] = FoodSampleData.menu
    @Published var cart: [CartLine] = []
    @Published var activeOrders: [FoodOrder] = FoodSampleData.orders
    @Published var searchText = ""
    @Published var fulfillment = "pickup"
    @Published var tableLabel = ""
    @Published var isLoading = false
    @Published var message: String?

    @Published var draftRestaurantName = ""
    @Published var draftCuisine = "Fast casual"
    @Published var draftMenuItemName = ""
    @Published var draftMenuItemPrice = "1299"

    @Published var accessToken = UserDefaults.standard.string(forKey: "ox.food.accessToken") ?? "" {
        didSet { UserDefaults.standard.set(accessToken, forKey: "ox.food.accessToken") }
    }

    var cartTotalCents: Int {
        cart.reduce(0) { $0 + $1.lineTotalCents }
    }

    func loadRestaurants() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let live = try await FoodAPIClient.shared.listRestaurants(search: searchText)
            restaurants = live.isEmpty ? FoodSampleData.restaurants : live
            if !restaurants.contains(where: { $0.id == selectedRestaurant.id }) {
                selectedRestaurant = restaurants[0]
            }
            message = live.isEmpty ? "Showing sample restaurants until food tables are migrated." : nil
        } catch {
            restaurants = FoodSampleData.restaurants
            selectedRestaurant = restaurants[0]
            message = "Sample mode: \(error.localizedDescription)"
        }
    }

    func select(_ restaurant: FoodRestaurant) async {
        selectedRestaurant = restaurant
        do {
            let detail = try await FoodAPIClient.shared.restaurantDetail(id: restaurant.id)
            selectedRestaurant = detail.restaurant
            menu = detail.menu.isEmpty ? FoodSampleData.menu : detail.menu
        } catch {
            menu = FoodSampleData.menu
            message = "Sample menu loaded until this restaurant publishes a live menu."
        }
    }

    func addToCart(_ item: FoodMenuItem) {
        if let index = cart.firstIndex(where: { $0.item.id == item.id }) {
            cart[index].quantity += 1
        } else {
            cart.append(CartLine(item: item))
        }
    }

    func removeCartLine(_ line: CartLine) {
        cart.removeAll { $0.id == line.id }
    }

    func submitOrder() async {
        guard !cart.isEmpty else { return }
        do {
            let order = try await FoodAPIClient.shared.createOrder(
                restaurantId: selectedRestaurant.id,
                lines: cart,
                fulfillment: fulfillment,
                tableLabel: tableLabel.isEmpty ? nil : tableLabel,
                token: accessToken
            )
            activeOrders.insert(order, at: 0)
            cart.removeAll()
            message = "Order #\(order.queueNumber) sent to the kitchen."
        } catch {
            let sample = FoodSampleData.makeOrder(
                restaurantId: selectedRestaurant.id,
                queue: (activeOrders.map(\.queueNumber).max() ?? 200) + 1,
                total: cartTotalCents,
                fulfillment: fulfillment,
                tableLabel: tableLabel.isEmpty ? nil : tableLabel
            )
            activeOrders.insert(sample, at: 0)
            cart.removeAll()
            message = "Demo order #\(sample.queueNumber) created locally. Add an OxSteed auth token to post live orders."
        }
    }

    func updateStatus(_ order: FoodOrder, status: String) async {
        do {
            let updated = try await FoodAPIClient.shared.updateOrderStatus(
                restaurantId: order.restaurantId,
                orderId: order.id,
                status: status,
                token: accessToken
            )
            replaceOrder(updated)
        } catch {
            var local = order
            local.status = status
            replaceOrder(local)
            message = "Status updated locally. Live sync needs a signed-in merchant token."
        }
    }

    func createDraftRestaurant() {
        let next = FoodRestaurant(
            id: Int64((restaurants.map(\.id).max() ?? 10) + 1),
            businessId: nil,
            displayName: draftRestaurantName.isEmpty ? "New OxSteed Food Restaurant" : draftRestaurantName,
            description: "Accepting pickup, table, kiosk, and kitchen-display orders.",
            cuisineTags: [draftCuisine],
            coverPhotoUrl: nil,
            logoUrl: nil,
            addressCity: "Local",
            addressState: nil,
            addressCountry: "US",
            latitude: nil,
            longitude: nil,
            currencyCode: "USD",
            fulfillmentModes: ["pickup", "dine_in", "kiosk"],
            acceptsOnlineOrders: true,
            acceptsInStoreOrders: true,
            kitchenDisplayEnabled: true,
            prepTimeMin: 15,
            distanceKm: nil
        )
        restaurants.insert(next, at: 0)
        selectedRestaurant = next
        draftRestaurantName = ""
        message = "Draft restaurant staged. Live publishing uses POST /api/food/restaurants."
    }

    func addDraftMenuItem() {
        let cents = Int(draftMenuItemPrice) ?? 0
        let item = FoodMenuItem(
            id: Int64(Date().timeIntervalSince1970),
            categoryId: menu.first?.id,
            name: draftMenuItemName.isEmpty ? "New menu item" : draftMenuItemName,
            description: "Configured from the merchant tablet.",
            imageUrl: nil,
            priceCents: cents,
            currencyCode: selectedRestaurant.currencyCode,
            isAvailable: true,
            tags: ["New"],
            allergens: [],
            modifierGroups: []
        )
        if menu.isEmpty {
            menu = [FoodMenuSection(id: 1, name: "Menu", description: nil, items: [item])]
        } else {
            menu[0].items.append(item)
        }
        draftMenuItemName = ""
        message = "Menu item staged. Live publishing uses POST /api/food/restaurants/:id/menu-items."
    }

    private func replaceOrder(_ order: FoodOrder) {
        if let index = activeOrders.firstIndex(where: { $0.id == order.id }) {
            activeOrders[index] = order
        } else {
            activeOrders.insert(order, at: 0)
        }
    }
}

enum FoodSampleData {
    static let restaurants = [
        FoodRestaurant(
            id: 1,
            businessId: 101,
            displayName: "Ox Burger Lab",
            description: "Fast pickup, kiosk ordering, and a live kitchen board.",
            cuisineTags: ["Burgers", "Coffee", "Breakfast"],
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
            distanceKm: 1.4
        ),
        FoodRestaurant(
            id: 2,
            businessId: 102,
            displayName: "Lakou Bowl",
            description: "Island bowls, juices, and counter pickup.",
            cuisineTags: ["Caribbean", "Healthy"],
            coverPhotoUrl: nil,
            logoUrl: nil,
            addressCity: "Port-au-Prince",
            addressState: nil,
            addressCountry: "HT",
            latitude: 18.5944,
            longitude: -72.3074,
            currencyCode: "USD",
            fulfillmentModes: ["pickup", "dine_in"],
            acceptsOnlineOrders: true,
            acceptsInStoreOrders: true,
            kitchenDisplayEnabled: true,
            prepTimeMin: 18,
            distanceKm: nil
        )
    ]

    static let menu = [
        FoodMenuSection(id: 1, name: "Popular", description: "Best sellers", items: [
            FoodMenuItem(id: 11, categoryId: 1, name: "Classic Ox Burger", description: "Double patty, lettuce, tomato, house sauce.", imageUrl: nil, priceCents: 899, currencyCode: "USD", isAvailable: true, tags: ["Popular"], allergens: ["Dairy", "Gluten"], modifierGroups: []),
            FoodMenuItem(id: 12, categoryId: 1, name: "Crispy Chicken Meal", description: "Chicken sandwich, fries, and drink.", imageUrl: nil, priceCents: 1199, currencyCode: "USD", isAvailable: true, tags: ["Combo"], allergens: ["Gluten"], modifierGroups: []),
            FoodMenuItem(id: 13, categoryId: 1, name: "Plantain Breakfast Bowl", description: "Egg, avocado, greens, sweet plantains.", imageUrl: nil, priceCents: 1099, currencyCode: "USD", isAvailable: true, tags: ["Breakfast"], allergens: ["Egg"], modifierGroups: [])
        ]),
        FoodMenuSection(id: 2, name: "Drinks", description: nil, items: [
            FoodMenuItem(id: 21, categoryId: 2, name: "Iced Coffee", description: "Cold brew with milk or oat milk.", imageUrl: nil, priceCents: 399, currencyCode: "USD", isAvailable: true, tags: [], allergens: [], modifierGroups: []),
            FoodMenuItem(id: 22, categoryId: 2, name: "Mango Juice", description: "Fresh mango, lime, and mint.", imageUrl: nil, priceCents: 499, currencyCode: "USD", isAvailable: true, tags: ["Fresh"], allergens: [], modifierGroups: [])
        ])
    ]

    static let orders = [
        makeOrder(restaurantId: 1, queue: 201, total: 1798, fulfillment: "pickup", tableLabel: nil, status: "received"),
        makeOrder(restaurantId: 1, queue: 202, total: 1199, fulfillment: "dine_in", tableLabel: "Table 8", status: "preparing"),
        makeOrder(restaurantId: 1, queue: 203, total: 499, fulfillment: "kiosk", tableLabel: "Kiosk 2", status: "ready")
    ]

    static func makeOrder(
        restaurantId: Int64,
        queue: Int,
        total: Int,
        fulfillment: String,
        tableLabel: String?,
        status: String = "received"
    ) -> FoodOrder {
        FoodOrder(
            id: Int64(queue),
            restaurantId: restaurantId,
            status: status,
            fulfillmentType: fulfillment,
            orderSource: fulfillment == "kiosk" ? "kiosk" : "mobile",
            paymentStatus: "requires_payment",
            queueNumber: queue,
            totalCents: total,
            currencyCode: "USD",
            tableLabel: tableLabel,
            guestName: nil,
            createdAt: Date(),
            promisedAt: Calendar.current.date(byAdding: .minute, value: 12, to: Date()),
            items: [
                FoodOrderLine(id: Int64(queue * 10), itemName: "Classic Ox Burger", quantity: 2, lineTotalCents: total, specialInstructions: nil)
            ]
        )
    }
}
