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
    @Published var inventoryIngredientMappings = FoodInventorySampleData.ingredientMappings
    @Published var inventoryWasteLog = FoodInventorySampleData.wasteLog
    @Published var purchaseRequests = FoodInventorySampleData.purchaseRequests
    @Published var receivingLogs = FoodInventorySampleData.receivingLogs
    @Published var supplierIssues = FoodInventorySampleData.supplierIssues
    @Published var runnerTasks = FoodOperationsSampleData.runnerTasks

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
    var lowStockItems: [FoodInventoryItemSnapshot] {
        inventoryItems.filter { $0.stockLevel <= $0.parLevel }
    }
    var totalWasteUnits: Double {
        inventoryWasteLog.reduce(0) { $0 + $1.quantity }
    }
    var pendingPurchaseRequests: [FoodPurchaseRequest] {
        purchaseRequests.filter { $0.status != "Ordered" }
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
            await loadLiveInventory()
            merchantLoaded = true
        } catch {
            merchantLoaded = true
            message = error.localizedDescription
        }
    }

    func loadMerchantOrders() async {
        guard let restaurant = merchantSelection else { return }
        do {
            merchantOrders = try await authed {
                try await FoodAPIClient.shared.restaurantOrders(restaurantId: restaurant.id, activeOnly: true, token: $0)
            }
        } catch {
            // Polling feed; keep the previous list on transient failure.
        }
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
            }
        } else if order.isActive {
            merchantOrders.insert(order, at: 0)
        }
    }

    func adjustInventory(_ item: FoodInventoryItemSnapshot, delta: Double) {
        guard let index = inventoryItems.firstIndex(where: { $0.id == item.id }) else { return }
        if let restaurant = merchantSelection, let remoteID = item.remoteID, isSignedIn {
            Task {
                do {
                    let updated = try await authed {
                        try await FoodAPIClient.shared.adjustInventoryItem(
                            restaurantId: restaurant.id,
                            itemId: remoteID,
                            type: "correction",
                            delta: delta,
                            note: "Adjusted from Inventory app",
                            token: $0
                        )
                    }
                    inventoryItems[index].stockLevel = updated.quantity
                    message = "\(updated.name) adjusted to \(Int(updated.quantity)) \(updated.unit)."
                    await loadLiveInventory()
                } catch {
                    inventoryItems[index].stockLevel = max(0, inventoryItems[index].stockLevel + delta)
                    message = "\(inventoryItems[index].name) adjusted locally while sync is unavailable."
                }
            }
            return
        }
        inventoryItems[index].stockLevel = max(0, inventoryItems[index].stockLevel + delta)
        message = "\(inventoryItems[index].name) adjusted to \(Int(inventoryItems[index].stockLevel)) \(inventoryItems[index].unit)."
    }

    func createInventoryItem(
        name: String,
        quantityText: String,
        unit: String,
        parText: String,
        supplierName: String
    ) async -> Bool {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedUnit = unit.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSupplier = supplierName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            message = "Add an inventory item name."
            return false
        }
        guard let quantity = Double(quantityText), quantity >= 0 else {
            message = "Enter a valid opening quantity."
            return false
        }
        guard let parLevel = Double(parText), parLevel >= 0 else {
            message = "Enter a valid par level."
            return false
        }

        if let restaurant = merchantSelection, isSignedIn {
            do {
                let created = try await authed {
                    try await FoodAPIClient.shared.createInventoryItem(
                        restaurantId: restaurant.id,
                        name: trimmedName,
                        unit: trimmedUnit.isEmpty ? "ea" : trimmedUnit,
                        quantity: quantity,
                        lowStockThreshold: parLevel,
                        supplierName: trimmedSupplier.isEmpty ? nil : trimmedSupplier,
                        token: $0
                    )
                }
                inventoryItems.insert(Self.inventorySnapshot(from: created), at: 0)
                message = "\(created.name) added to inventory."
                return true
            } catch {
                message = error.localizedDescription
                return false
            }
        }

        inventoryItems.insert(
            FoodInventoryItemSnapshot(
                remoteID: nil,
                name: trimmedName,
                stockLevel: quantity,
                unit: trimmedUnit.isEmpty ? "ea" : trimmedUnit,
                parLevel: parLevel,
                supplier: trimmedSupplier.isEmpty ? "Unassigned" : trimmedSupplier
            ),
            at: 0
        )
        message = "\(trimmedName) added to inventory."
        return true
    }

    func updateInventoryItem(
        _ item: FoodInventoryItemSnapshot,
        name: String,
        unit: String,
        parText: String,
        supplierName: String
    ) async -> Bool {
        guard let index = inventoryItems.firstIndex(where: { $0.id == item.id }) else { return false }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedUnit = unit.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSupplier = supplierName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            message = "Add an inventory item name."
            return false
        }
        guard let parLevel = Double(parText), parLevel >= 0 else {
            message = "Enter a valid par level."
            return false
        }

        if let restaurant = merchantSelection, let remoteID = item.remoteID, isSignedIn {
            do {
                let updated = try await authed {
                    try await FoodAPIClient.shared.updateInventoryItem(
                        restaurantId: restaurant.id,
                        itemId: remoteID,
                        name: trimmedName,
                        unit: trimmedUnit.isEmpty ? "ea" : trimmedUnit,
                        lowStockThreshold: parLevel,
                        supplierName: trimmedSupplier.isEmpty ? nil : trimmedSupplier,
                        token: $0
                    )
                }
                inventoryItems[index] = Self.inventorySnapshot(from: updated, quantityOverride: inventoryItems[index].stockLevel)
                message = "\(updated.name) details updated."
                return true
            } catch {
                message = error.localizedDescription
                return false
            }
        }

        inventoryItems[index] = FoodInventoryItemSnapshot(
            remoteID: item.remoteID,
            name: trimmedName,
            stockLevel: inventoryItems[index].stockLevel,
            unit: trimmedUnit.isEmpty ? "ea" : trimmedUnit,
            parLevel: parLevel,
            supplier: trimmedSupplier.isEmpty ? "Unassigned" : trimmedSupplier
        )
        message = "\(trimmedName) details updated."
        return true
    }

    func deleteInventoryItem(_ item: FoodInventoryItemSnapshot) async -> Bool {
        guard let index = inventoryItems.firstIndex(where: { $0.id == item.id }) else { return false }

        if let restaurant = merchantSelection, let remoteID = item.remoteID, isSignedIn {
            do {
                try await authed {
                    try await FoodAPIClient.shared.deleteInventoryItem(
                        restaurantId: restaurant.id,
                        itemId: remoteID,
                        token: $0
                    )
                }
                inventoryItems.remove(at: index)
                message = "\(item.name) removed from inventory."
                return true
            } catch {
                message = error.localizedDescription
                return false
            }
        }

        inventoryItems.remove(at: index)
        message = "\(item.name) removed from inventory."
        return true
    }

    func logInventoryWaste(
        item: FoodInventoryItemSnapshot,
        quantityText: String,
        reason: String
    ) async -> Bool {
        guard let index = inventoryItems.firstIndex(where: { $0.id == item.id }) else { return false }
        let trimmedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let quantity = Double(quantityText), quantity > 0 else {
            message = "Enter a valid waste quantity."
            return false
        }
        guard !trimmedReason.isEmpty else {
            message = "Add a reason for the waste entry."
            return false
        }

        if let restaurant = merchantSelection, let remoteID = item.remoteID, isSignedIn {
            do {
                let updated = try await authed {
                    try await FoodAPIClient.shared.adjustInventoryItem(
                        restaurantId: restaurant.id,
                        itemId: remoteID,
                        type: "waste",
                        delta: quantity,
                        note: trimmedReason,
                        token: $0
                    )
                }
                inventoryItems[index].stockLevel = updated.quantity
                inventoryWasteLog.insert(
                    FoodWasteEntry(
                        ingredientName: item.name,
                        quantity: quantity,
                        unit: item.unit,
                        reason: trimmedReason
                    ),
                    at: 0
                )
                message = "Waste logged for \(item.name)."
                return true
            } catch {
                message = error.localizedDescription
                return false
            }
        }

        inventoryItems[index].stockLevel = max(0, inventoryItems[index].stockLevel - quantity)
        inventoryWasteLog.insert(
            FoodWasteEntry(
                ingredientName: item.name,
                quantity: quantity,
                unit: item.unit,
                reason: trimmedReason
            ),
            at: 0
        )
        message = "Waste logged for \(item.name)."
        return true
    }

    func markReceivingDelivered(_ task: FoodReceivingTask, receivedQuantity: String) {
        let value = Double(receivedQuantity) ?? 0
        if let restaurant = merchantSelection,
           isSignedIn,
           let matchedItem = inventoryItems.first(where: {
               $0.supplier == task.supplier && $0.remoteID != nil
           }),
           let remoteID = matchedItem.remoteID
        {
            Task {
                do {
                    _ = try await authed {
                        try await FoodAPIClient.shared.adjustInventoryItem(
                            restaurantId: restaurant.id,
                            itemId: remoteID,
                            type: value == 0 ? "correction" : "receive",
                            delta: value == 0 ? 0 : value,
                            note: task.notes,
                            token: $0
                        )
                    }
                    await loadLiveInventory()
                    message = value == 0 ? "Receiving issue logged for \(task.supplier)." : "\(task.supplier) delivery logged."
                } catch {
                    appendLocalReceivingLog(task: task, value: value)
                }
            }
            return
        }
        appendLocalReceivingLog(task: task, value: value)
    }

    func loadLiveInventory() async {
        guard let restaurant = merchantSelection, isSignedIn else { return }
        do {
            let items = try await authed {
                try await FoodAPIClient.shared.inventoryItems(restaurantId: restaurant.id, token: $0)
            }
            let adjustments = try await authed {
                try await FoodAPIClient.shared.inventoryAdjustments(restaurantId: restaurant.id, token: $0)
            }
            let requests = try await authed {
                try await FoodAPIClient.shared.purchaseRequests(restaurantId: restaurant.id, token: $0)
            }
            let issues = try await authed {
                try await FoodAPIClient.shared.supplierIssues(restaurantId: restaurant.id, token: $0)
            }
            var mappings = try await authed {
                try await FoodAPIClient.shared.inventoryMappings(restaurantId: restaurant.id, token: $0)
            }
            if mappings.isEmpty {
                mappings = try await authed {
                    try await FoodAPIClient.shared.bootstrapInventoryMappings(restaurantId: restaurant.id, token: $0)
                }
            }

            if !items.isEmpty {
                inventoryItems = items.map { Self.inventorySnapshot(from: $0) }
            }

            let receiveAdjustments = adjustments.filter { $0.adjustmentType == "receive" || $0.adjustmentType == "count" }
            if !receiveAdjustments.isEmpty {
                receivingLogs = receiveAdjustments.map { adjustment in
                    FoodReceivingLog(
                        supplier: inventoryItems.first(where: { $0.remoteID == adjustment.itemId })?.supplier ?? "Supplier",
                        itemName: adjustment.itemName,
                        expectedQuantity: adjustment.quantityAfter,
                        receivedQuantity: max(0, adjustment.quantityDelta),
                        status: adjustment.adjustmentType == "receive" ? "Received" : "Counted",
                        note: adjustment.note ?? "Logged from live inventory ledger."
                    )
                }
            }

            let wasteAdjustments = adjustments.filter { $0.adjustmentType == "waste" }
            if !wasteAdjustments.isEmpty {
                inventoryWasteLog = wasteAdjustments.map { adjustment in
                    FoodWasteEntry(
                        ingredientName: adjustment.itemName,
                        quantity: abs(adjustment.quantityDelta),
                        unit: inventoryItems.first(where: { $0.remoteID == adjustment.itemId })?.unit ?? "units",
                        reason: adjustment.note ?? "Logged waste"
                    )
                }
            }

            if !requests.isEmpty {
                purchaseRequests = requests.map {
                    FoodPurchaseRequest(
                        remoteID: $0.id,
                        itemName: $0.itemName,
                        requestedQuantity: $0.requestedQuantity,
                        unit: $0.unit,
                        status: $0.status.capitalized,
                        supplier: $0.supplierName ?? "Preferred vendor"
                    )
                }
                receivingTasks = requests
                    .filter { ["pending", "ordered"].contains($0.status) }
                    .map {
                        FoodReceivingTask(
                            supplier: $0.supplierName ?? "Preferred vendor",
                            etaWindow: $0.etaWindow ?? "Awaiting supplier confirmation",
                            notes: $0.note ?? "Expected \($0.requestedQuantity.formatted(.number.precision(.fractionLength(0...2)))) \($0.unit) of \($0.itemName)."
                        )
                    }
            }

            if !issues.isEmpty {
                supplierIssues = issues.map {
                    FoodSupplierIssue(
                        remoteID: $0.id,
                        supplier: $0.supplierName,
                        issue: $0.issue,
                        status: $0.status.capitalized
                    )
                }
            }

            if !mappings.isEmpty {
                inventoryIngredientMappings = mappings.map {
                    FoodIngredientMapping(
                        remoteID: $0.id,
                        ingredientName: $0.inventoryItemName,
                        menuItemName: $0.menuItemName,
                        usagePerItem: $0.usageLabel
                    )
                }
            }
        } catch {
            // Preserve existing sample-backed state when live inventory modules
            // are unavailable or migrations have not been run yet.
        }
    }

    private func appendLocalReceivingLog(task: FoodReceivingTask, value: Double) {
        receivingLogs.insert(
            FoodReceivingLog(
                supplier: task.supplier,
                itemName: task.notes.components(separatedBy: ".").first ?? "Delivery",
                expectedQuantity: value,
                receivedQuantity: value,
                status: value == 0 ? "Issue" : "Received",
                note: task.notes
            ),
            at: 0
        )
        message = value == 0 ? "Receiving issue logged for \(task.supplier)." : "\(task.supplier) delivery logged."
    }

    func addPurchaseRequest(itemName: String, quantityText: String) {
        let trimmedName = itemName.trimmingCharacters(in: .whitespacesAndNewlines)
        let quantity = Double(quantityText) ?? 0
        guard !trimmedName.isEmpty, quantity > 0 else {
            message = "Add an item name and quantity for the purchase request."
            return
        }
        if let restaurant = merchantSelection, isSignedIn {
            Task {
                do {
                    let request = try await authed {
                        try await FoodAPIClient.shared.createPurchaseRequest(
                            restaurantId: restaurant.id,
                            itemName: trimmedName,
                            requestedQuantity: quantity,
                            unit: "units",
                            supplierName: "Preferred vendor",
                            note: nil,
                            token: $0
                        )
                    }
                    purchaseRequests.insert(
                        FoodPurchaseRequest(
                            remoteID: request.id,
                            itemName: request.itemName,
                            requestedQuantity: request.requestedQuantity,
                            unit: request.unit,
                            status: request.status.capitalized,
                            supplier: request.supplierName ?? "Preferred vendor"
                        ),
                        at: 0
                    )
                    if ["pending", "ordered"].contains(request.status) {
                        receivingTasks.insert(
                            FoodReceivingTask(
                                supplier: request.supplierName ?? "Preferred vendor",
                                etaWindow: request.etaWindow ?? "Awaiting supplier confirmation",
                                notes: request.note ?? "Expected \(request.requestedQuantity.formatted(.number.precision(.fractionLength(0...2)))) \(request.unit) of \(request.itemName)."
                            ),
                            at: 0
                        )
                    }
                    message = "Purchase request created for \(trimmedName)."
                } catch {
                    message = error.localizedDescription
                }
            }
            return
        }
        purchaseRequests.insert(
            FoodPurchaseRequest(remoteID: nil, itemName: trimmedName, requestedQuantity: quantity, unit: "units", status: "Pending", supplier: "Preferred vendor"),
            at: 0
        )
        message = "Purchase request created for \(trimmedName)."
    }

    func updatePurchaseRequest(_ request: FoodPurchaseRequest, status: String) {
        guard let index = purchaseRequests.firstIndex(where: { $0.id == request.id }) else { return }
        guard let restaurant = merchantSelection, let remoteID = request.remoteID, isSignedIn else {
            purchaseRequests[index] = FoodPurchaseRequest(
                remoteID: request.remoteID,
                itemName: request.itemName,
                requestedQuantity: request.requestedQuantity,
                unit: request.unit,
                status: status.capitalized,
                supplier: request.supplier
            )
            message = "\(request.itemName) request marked \(status.replacingOccurrences(of: "_", with: " "))."
            return
        }

        Task {
            do {
                let updated = try await authed {
                    try await FoodAPIClient.shared.updatePurchaseRequest(
                        restaurantId: restaurant.id,
                        requestId: remoteID,
                        status: status,
                        token: $0
                    )
                }
                purchaseRequests[index] = FoodPurchaseRequest(
                    remoteID: updated.id,
                    itemName: updated.itemName,
                    requestedQuantity: updated.requestedQuantity,
                    unit: updated.unit,
                    status: updated.status.capitalized,
                    supplier: updated.supplierName ?? request.supplier
                )
                if status == "received" {
                    receivingTasks.removeAll { $0.supplier == request.supplier && $0.notes.contains(request.itemName) }
                }
                message = "\(updated.itemName) request marked \(updated.status.replacingOccurrences(of: "_", with: " "))."
            } catch {
                message = error.localizedDescription
            }
        }
    }

    func addSupplierIssue(supplierName: String, issueText: String) {
        let trimmedSupplier = supplierName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedIssue = issueText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSupplier.isEmpty, !trimmedIssue.isEmpty else {
            message = "Add a supplier and issue details."
            return
        }
        if let restaurant = merchantSelection, isSignedIn {
            Task {
                do {
                    let issue = try await authed {
                        try await FoodAPIClient.shared.createSupplierIssue(
                            restaurantId: restaurant.id,
                            supplierName: trimmedSupplier,
                            issue: trimmedIssue,
                            token: $0
                        )
                    }
                    supplierIssues.insert(
                        FoodSupplierIssue(
                            remoteID: issue.id,
                            supplier: issue.supplierName,
                            issue: issue.issue,
                            status: issue.status.capitalized
                        ),
                        at: 0
                    )
                    message = "Supplier issue logged for \(trimmedSupplier)."
                } catch {
                    message = error.localizedDescription
                }
            }
            return
        }
        supplierIssues.insert(
            FoodSupplierIssue(remoteID: nil, supplier: trimmedSupplier, issue: trimmedIssue, status: "Open"),
            at: 0
        )
        message = "Supplier issue logged for \(trimmedSupplier)."
    }

    func updateSupplierIssue(_ issue: FoodSupplierIssue, status: String) {
        guard let index = supplierIssues.firstIndex(where: { $0.id == issue.id }) else { return }
        guard let restaurant = merchantSelection, let remoteID = issue.remoteID, isSignedIn else {
            supplierIssues[index] = FoodSupplierIssue(
                remoteID: issue.remoteID,
                supplier: issue.supplier,
                issue: issue.issue,
                status: status.capitalized
            )
            message = "\(issue.supplier) issue marked \(status.replacingOccurrences(of: "_", with: " "))."
            return
        }

        Task {
            do {
                let updated = try await authed {
                    try await FoodAPIClient.shared.updateSupplierIssue(
                        restaurantId: restaurant.id,
                        issueId: remoteID,
                        status: status,
                        token: $0
                    )
                }
                supplierIssues[index] = FoodSupplierIssue(
                    remoteID: updated.id,
                    supplier: updated.supplierName,
                    issue: updated.issue,
                    status: updated.status.capitalized
                )
                message = "\(updated.supplierName) issue marked \(updated.status.replacingOccurrences(of: "_", with: " "))."
            } catch {
                message = error.localizedDescription
            }
        }
    }

    private static func inventorySnapshot(
        from item: RestaurantInventoryItemResponse,
        quantityOverride: Double? = nil
    ) -> FoodInventoryItemSnapshot {
        FoodInventoryItemSnapshot(
            remoteID: item.id,
            name: item.name,
            stockLevel: quantityOverride ?? item.quantity,
            unit: item.unit,
            parLevel: item.lowStockThreshold,
            supplier: item.supplierName ?? "Unassigned"
        )
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
    let remoteID: Int64?
    let name: String
    var stockLevel: Double
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

struct FoodIngredientMapping: Identifiable, Hashable {
    let id = UUID()
    let remoteID: Int64?
    let ingredientName: String
    let menuItemName: String
    let usagePerItem: String
}

struct FoodWasteEntry: Identifiable, Hashable {
    let id = UUID()
    let ingredientName: String
    let quantity: Double
    let unit: String
    let reason: String
}

struct FoodPurchaseRequest: Identifiable, Hashable {
    let id = UUID()
    let remoteID: Int64?
    let itemName: String
    let requestedQuantity: Double
    let unit: String
    let status: String
    let supplier: String
}

struct FoodReceivingLog: Identifiable, Hashable {
    let id = UUID()
    let supplier: String
    let itemName: String
    let expectedQuantity: Double
    let receivedQuantity: Double
    let status: String
    let note: String
}

struct FoodSupplierIssue: Identifiable, Hashable {
    let id = UUID()
    let remoteID: Int64?
    let supplier: String
    let issue: String
    let status: String
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
        FoodInventoryItemSnapshot(remoteID: nil, name: "Burger buns", stockLevel: 38, unit: "ea", parLevel: 48, supplier: "Metro Bake"),
        FoodInventoryItemSnapshot(remoteID: nil, name: "Ground beef", stockLevel: 22, unit: "lb", parLevel: 30, supplier: "Prime Supply"),
        FoodInventoryItemSnapshot(remoteID: nil, name: "Cold brew", stockLevel: 8, unit: "qt", parLevel: 6, supplier: "Ox Roasters"),
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

enum FoodInventorySampleData {
    static let ingredientMappings = [
        FoodIngredientMapping(remoteID: nil, ingredientName: "Burger buns", menuItemName: "Classic Ox Burger", usagePerItem: "1 bun"),
        FoodIngredientMapping(remoteID: nil, ingredientName: "Ground beef", menuItemName: "Classic Ox Burger", usagePerItem: "0.33 lb"),
        FoodIngredientMapping(remoteID: nil, ingredientName: "Cold brew concentrate", menuItemName: "Cold Brew", usagePerItem: "12 oz"),
    ]

    static let wasteLog = [
        FoodWasteEntry(ingredientName: "Lettuce", quantity: 3, unit: "heads", reason: "Temp variance"),
        FoodWasteEntry(ingredientName: "Fries", quantity: 2, unit: "bags", reason: "Overproduction"),
    ]

    static let purchaseRequests = [
        FoodPurchaseRequest(remoteID: nil, itemName: "Burger buns", requestedQuantity: 120, unit: "ea", status: "Pending", supplier: "Metro Bake"),
        FoodPurchaseRequest(remoteID: nil, itemName: "Cleaning sanitizer", requestedQuantity: 4, unit: "gal", status: "Ordered", supplier: "Ops Supply"),
    ]

    static let receivingLogs = [
        FoodReceivingLog(supplier: "Prime Supply", itemName: "Ground beef cases", expectedQuantity: 10, receivedQuantity: 9, status: "Variance", note: "One case short; credit pending."),
        FoodReceivingLog(supplier: "Metro Bake", itemName: "Burger buns", expectedQuantity: 180, receivedQuantity: 180, status: "Received", note: "On time and sealed."),
    ]

    static let supplierIssues = [
        FoodSupplierIssue(remoteID: nil, supplier: "Prime Supply", issue: "Protein case arrived short by one unit.", status: "Open"),
        FoodSupplierIssue(remoteID: nil, supplier: "Ops Supply", issue: "Cleaning wipes delayed to tomorrow.", status: "Monitoring"),
    ]
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
