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
    @Published private(set) var pendingOfflineOrders: [FoodPendingOrder] = []

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
    @Published var counterCouponCode = ""
    @Published var counterDiscountCents = 0
    @Published var counterDiscountLabel: String?
    @Published var crewTraining = FoodOperationsSampleData.trainingModules
    @Published var openingChecklist = FoodOperationsSampleData.openingChecklist
    @Published var inventoryItems = FoodOperationsSampleData.inventoryItems
    @Published var receivingTasks = FoodOperationsSampleData.receivingTasks
    @Published var runnerTasks = FoodOperationsSampleData.runnerTasks
    @Published var posDiscounts = FoodPOSSampleData.discounts
    @Published var posRecentReceipts = FoodPOSSampleData.receipts
    @Published var posPermissions = FoodPOSSampleData.permissions
    @Published var posOrderHistory: [FoodOrder] = []
    @Published var isApplyingCoupon = false
    @Published var isSendingReceipt = false

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
        max(0, counterCartSubtotalCents - counterDiscountCents)
    }
    var counterCartSubtotalCents: Int {
        counterCart.reduce(0) { $0 + $1.lineTotalCents }
    }
    var counterCartItemCount: Int {
        counterCart.reduce(0) { $0 + $1.quantity }
    }
    var activeRestaurant: FoodRestaurant? {
        merchantSelection ?? selectedRestaurant ?? merchantRestaurants.first ?? restaurants.first ?? FoodSampleData.restaurant
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
    var posPaymentOrders: [FoodOrder] {
        let source = posOrderHistory.isEmpty ? merchantOrders : posOrderHistory
        return source.sorted { lhs, rhs in
            let leftDate = lhs.createdAt ?? .distantPast
            let rightDate = rhs.createdAt ?? .distantPast
            if leftDate == rightDate {
                return lhs.queueNumber > rhs.queueNumber
            }
            return leftDate > rightDate
        }
    }
    var posReceiptActivity: [FoodPOSReceiptEvent] {
        let liveEvents = posPaymentOrders.prefix(12).map { order in
            FoodPOSReceiptEvent(
                id: "order-\(order.id)-\(Int((order.createdAt ?? .distantPast).timeIntervalSince1970))",
                orderID: order.id,
                queueNumber: order.queueNumber,
                guestName: order.guestName ?? "Walk-in",
                totalCents: order.totalCents,
                paymentStatus: order.paymentStatus,
                channel: receiptChannel(for: order),
                sentAt: order.createdAt ?? Date.distantPast
            )
        }
        var seen = Set<String>()
        let merged = (posRecentReceipts + liveEvents).filter { event in
            let timestamp = Int(event.sentAt.timeIntervalSince1970)
            let key = "\(event.orderID)-\(event.channel)-\(event.paymentStatus)-\(timestamp)"
            return seen.insert(key).inserted
        }
        return merged.sorted { $0.sentAt > $1.sentAt }
    }

    // MARK: - Auth

    func signIn(email: String, password: String, agreementName: String) async -> Bool {
        do {
            let session = try await FoodAPIClient.shared.login(
                email: email,
                password: password,
                agreementName: agreementName.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            if session.requiresTwoFactor == true {
                message = "Two-factor authentication is enabled. Sign in at oxsteed.com first, then return here."
                return false
            }
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

    func addCounterLine(_ line: CartLine) {
        counterCart.append(line)
    }

    func removeCounterLine(_ line: CartLine) {
        counterCart.removeAll { $0.id == line.id }
    }

    /// Adjust a counter line quantity by +/- without re-opening the item sheet.
    /// Removing the last unit drops the line entirely.
    func adjustCounterLine(_ line: CartLine, by delta: Int) {
        guard let idx = counterCart.firstIndex(where: { $0.id == line.id }) else { return }
        let next = counterCart[idx].quantity + delta
        if next <= 0 {
            counterCart.remove(at: idx)
        } else {
            counterCart[idx].quantity = next
        }
    }

    func applyCounterDiscount(_ discount: FoodPOSDiscount) {
        let subtotal = counterCartSubtotalCents
        guard subtotal > 0 else {
            message = "Add menu items before applying a discount."
            return
        }
        counterDiscountCents = min(subtotal, Int((Double(subtotal) * discount.percentOff).rounded()))
        counterDiscountLabel = discount.code ?? discount.title
        message = "\(discount.title) applied to this ticket."
    }

    func applyCounterCoupon() async {
        let code = counterCouponCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !code.isEmpty else {
            message = "Enter a coupon code first."
            return
        }
        isApplyingCoupon = true
        defer { isApplyingCoupon = false }
        guard let discount = posDiscounts.first(where: { $0.code?.uppercased() == code }) else {
            message = "Coupon code not recognized for this restaurant."
            return
        }
        applyCounterDiscount(discount)
    }

    func clearCounterAdjustments() {
        counterCouponCode = ""
        counterDiscountCents = 0
        counterDiscountLabel = nil
    }

    func submitCounterOrder() async {
        guard let restaurant = activeRestaurant, !counterCart.isEmpty else { return }
        isSubmittingCounterOrder = true
        defer { isSubmittingCounterOrder = false }
        let submittedLines = counterCart
        let discountCode = counterCouponCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? nil
            : counterCouponCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let clientOrderId = UUID().uuidString
        do {
            let order = try await FoodAPIClient.shared.createOrder(
                restaurantId: restaurant.id,
                lines: submittedLines,
                fulfillment: counterFulfillment,
                tableLabel: counterFulfillment == "dine_in" && !counterTableLabel.isEmpty ? counterTableLabel : nil,
                guestName: counterGuestName.isEmpty ? "Walk-in" : counterGuestName,
                token: accessToken.isEmpty ? nil : accessToken,
                orderSource: "counter",
                discountCode: discountCode,
                discountLabel: counterDiscountLabel,
                discountCents: counterDiscountCents,
                clientOrderId: clientOrderId
            )
            FoodOfflineOrderQueue.remove(id: clientOrderId)
            refreshPendingOfflineOrders()
            counterCart.removeAll()
            counterGuestName = ""
            counterTableLabel = ""
            clearCounterAdjustments()
            lastCounterOrder = order
            posRecentReceipts.insert(
                FoodPOSReceiptEvent(
                    id: "counter-\(order.id)-\(Date().timeIntervalSince1970)",
                    orderID: order.id,
                    queueNumber: order.queueNumber,
                    guestName: order.guestName ?? "Walk-in",
                    totalCents: order.totalCents,
                    paymentStatus: order.paymentStatus,
                    channel: "Counter",
                    sentAt: Date()
                ),
                at: 0
            )
            message = "Counter order #\(order.queueNumber) sent to kitchen."
            if merchantSelection?.id == restaurant.id {
                merchantOrders.insert(order, at: 0)
            }
            mergePOSOrderRecord(order)
            await logPOSReceiptEvent(order: order, channel: "Counter")
        } catch {
            if FoodOfflineOrderQueue.isNetworkFailure(error) {
                _ = FoodOfflineOrderQueue.enqueue(
                    id: clientOrderId,
                    restaurant: restaurant,
                    lines: submittedLines,
                    fulfillment: counterFulfillment,
                    tableLabel: counterFulfillment == "dine_in" && !counterTableLabel.isEmpty ? counterTableLabel : nil,
                    guestName: counterGuestName.isEmpty ? "Walk-in" : counterGuestName,
                    orderSource: "counter",
                    paymentMode: "pay_at_counter",
                    discountCode: discountCode,
                    discountLabel: counterDiscountLabel,
                    discountCents: counterDiscountCents
                )
                refreshPendingOfflineOrders()
                counterCart.removeAll()
                counterGuestName = ""
                counterTableLabel = ""
                clearCounterAdjustments()
                message = "Offline — counter order saved and will send when connection returns."
            } else {
                message = "Counter order failed: \(error.localizedDescription)"
            }
        }
    }

    func refreshPendingOfflineOrders() {
        pendingOfflineOrders = FoodOfflineOrderQueue.load()
    }

    func replayPendingOfflineOrders() async {
        refreshPendingOfflineOrders()
        guard !pendingOfflineOrders.isEmpty else { return }
        for pending in pendingOfflineOrders {
            do {
                let order = try await FoodAPIClient.shared.createPendingOrder(
                    pending,
                    token: accessToken.isEmpty ? nil : accessToken
                )
                FoodOfflineOrderQueue.remove(id: pending.id)
                if lastCounterOrder == nil {
                    lastCounterOrder = order
                }
                message = "Offline counter order #\(order.queueNumber) sent."
            } catch {
                if !FoodOfflineOrderQueue.isNetworkFailure(error) {
                    FoodOfflineOrderQueue.bumpAttempt(id: pending.id)
                }
            }
        }
        refreshPendingOfflineOrders()
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
            await loadMerchantOrders()
            await loadPOSOrderHistory()
            await loadPOSConfig()
            await loadPOSReceiptEvents()
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

    func loadPOSOrderHistory() async {
        guard let restaurant = merchantSelection else { return }
        do {
            posOrderHistory = try await authed {
                try await FoodAPIClient.shared.restaurantOrders(restaurantId: restaurant.id, activeOnly: false, token: $0)
            }
        } catch {
            // Keep the last known order history on transient failures.
        }
    }

    func loadPOSConfig() async {
        guard let restaurant = merchantSelection else { return }
        do {
            let discounts = try await authed {
                try await FoodAPIClient.shared.posDiscounts(restaurantId: restaurant.id, token: $0)
            }
            posDiscounts = discounts.map {
                FoodPOSDiscount(title: $0.title, percentOff: $0.percentOff, code: $0.code)
            }
        } catch {
            // Keep seeded fallback catalog if the backend route is unavailable.
        }
    }

    func loadPOSReceiptEvents() async {
        guard let restaurant = merchantSelection else { return }
        do {
            let events = try await authed {
                try await FoodAPIClient.shared.posReceiptEvents(restaurantId: restaurant.id, token: $0)
            }
            posRecentReceipts = events.map(Self.mapReceiptEvent(from:))
        } catch {
            // Keep prior receipt activity on transient failures.
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
        await setOrderPaymentStatus(order, paymentStatus: "paid")
    }

    func setOrderPaymentStatus(_ order: FoodOrder, paymentStatus: String) async {
        guard let restaurant = merchantSelection else { return }
        do {
            let updated = try await authed {
                try await FoodAPIClient.shared.updateOrderPayment(
                    restaurantId: restaurant.id, orderId: order.id, paymentStatus: paymentStatus, token: $0
                )
            }
            replaceMerchantOrder(updated)
            mergePOSOrderRecord(updated)
            posRecentReceipts.insert(
                FoodPOSReceiptEvent(
                    id: "payment-\(updated.id)-\(Date().timeIntervalSince1970)",
                    orderID: updated.id,
                    queueNumber: updated.queueNumber,
                    guestName: updated.guestName ?? "Walk-in",
                    totalCents: updated.totalCents,
                    paymentStatus: paymentStatus,
                    channel: "Payment update",
                    sentAt: Date()
                ),
                at: 0
            )
            await logPOSReceiptEvent(order: updated, channel: "Payment update")
            message = "Order #\(updated.queueNumber) marked \(paymentStatus)."
        } catch {
            message = error.localizedDescription
        }
    }

    func sendReceipt(for order: FoodOrder, channel: String) async {
        isSendingReceipt = true
        defer { isSendingReceipt = false }
        posRecentReceipts.insert(
            FoodPOSReceiptEvent(
                id: "\(channel)-\(order.id)-\(Date().timeIntervalSince1970)",
                orderID: order.id,
                queueNumber: order.queueNumber,
                guestName: order.guestName ?? "Walk-in",
                totalCents: order.totalCents,
                paymentStatus: order.paymentStatus,
                channel: channel,
                sentAt: Date()
            ),
            at: 0
        )
        await logPOSReceiptEvent(order: order, channel: channel)
        message = "Receipt queued for \(channel.lowercased()) delivery."
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

    private func mergePOSOrderRecord(_ order: FoodOrder) {
        if let index = posOrderHistory.firstIndex(where: { $0.id == order.id }) {
            posOrderHistory[index] = order
        } else {
            posOrderHistory.insert(order, at: 0)
        }
    }

    private func receiptChannel(for order: FoodOrder) -> String {
        switch order.paymentStatus {
        case "paid":
            return "Counter"
        case "refunded":
            return "Refunded"
        default:
            return "Order record"
        }
    }

    private func logPOSReceiptEvent(order: FoodOrder, channel: String) async {
        guard let restaurant = merchantSelection else { return }
        do {
            let event = try await authed {
                try await FoodAPIClient.shared.createPOSReceiptEvent(
                    restaurantId: restaurant.id,
                    orderId: order.id,
                    queueNumber: order.queueNumber,
                    guestName: order.guestName ?? "Walk-in",
                    totalCents: order.totalCents,
                    paymentStatus: order.paymentStatus,
                    channel: channel,
                    token: $0
                )
            }
            posRecentReceipts.removeAll { $0.orderID == order.id && $0.channel == channel }
            posRecentReceipts.insert(Self.mapReceiptEvent(from: event), at: 0)
        } catch {
            // Keep the optimistic local event visible even if backend logging fails.
        }
    }

    private static func mapReceiptEvent(from response: FoodPOSReceiptEventResponse) -> FoodPOSReceiptEvent {
        FoodPOSReceiptEvent(
            id: "receipt-\(response.id)",
            orderID: response.orderID,
            queueNumber: response.queueNumber,
            guestName: response.guestName,
            totalCents: response.totalCents,
            paymentStatus: response.paymentStatus,
            channel: response.channel,
            sentAt: response.createdAt
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

struct FoodPOSDiscount: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let percentOff: Double
    let code: String?
}

struct FoodPOSReceiptEvent: Identifiable, Hashable {
    let id: String
    let orderID: Int64
    let queueNumber: Int
    let guestName: String
    let totalCents: Int
    let paymentStatus: String
    let channel: String
    let sentAt: Date
}

struct FoodPOSPermissions: Hashable {
    let canRefund: Bool
    let canMarkUnpaid: Bool
    let canComp: Bool
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

enum FoodPOSSampleData {
    static let discounts = [
        FoodPOSDiscount(title: "Welcome 10%", percentOff: 0.10, code: "WELCOME10"),
        FoodPOSDiscount(title: "Lunch 15%", percentOff: 0.15, code: "LUNCH15"),
        FoodPOSDiscount(title: "VIP 20%", percentOff: 0.20, code: "VIP20"),
    ]

    static let receipts = [
        FoodPOSReceiptEvent(id: "sample-41", orderID: 41, queueNumber: 41, guestName: "D. Smith", totalCents: 1899, paymentStatus: "paid", channel: "Printed", sentAt: Date().addingTimeInterval(-1800)),
        FoodPOSReceiptEvent(id: "sample-39", orderID: 39, queueNumber: 39, guestName: "Walk-in", totalCents: 1245, paymentStatus: "refunded", channel: "Email", sentAt: Date().addingTimeInterval(-5400)),
    ]

    static let permissions = FoodPOSPermissions(
        canRefund: true,
        canMarkUnpaid: true,
        canComp: true
    )
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
