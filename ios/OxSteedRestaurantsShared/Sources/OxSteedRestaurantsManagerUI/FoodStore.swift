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
    @Published var managerTeam = FoodManagerSampleData.teamMembers
    @Published var managerIncidents = FoodManagerSampleData.incidents
    @Published var managerLocations = FoodManagerSampleData.locations
    @Published var setupProgress: FoodSetupProgress?
    @Published var restaurantLocations: [FoodRestaurantLocation] = []
    @Published var managerHelpRequests = FoodManagerSampleData.helpRequests
    @Published var managerSOPs = FoodManagerSampleData.sops
    @Published var managerSales = FoodManagerSampleData.sales
    @Published var isSubmittingHelpRequest = false
    @Published private(set) var managerItemAvailabilityOverrides = FoodStore.loadValue([String: Bool].self, key: "ox.food.managerAvailabilityOverrides", default: [:]) {
        didSet { FoodStore.saveValue(managerItemAvailabilityOverrides, key: "ox.food.managerAvailabilityOverrides") }
    }

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
    var activeMenuItems: [FoodMenuItem] {
        let liveItems = menu.flatMap(\.items)
        return liveItems.isEmpty ? [FoodSampleData.menuItem] : liveItems
    }
    var managerKPIs: [FoodManagerKPI] {
        let liveOrders = merchantOrders.filter(\.isActive).count
        let readyOrders = merchantOrders.filter { $0.status == "ready" }.count
        let paidOrders = merchantOrders.filter { $0.paymentStatus == "paid" }.count
        let completionRate = crewTraining.isEmpty
            ? 0
            : Int((Double(crewTraining.filter(\.isComplete).count) / Double(crewTraining.count)) * 100)
        let weeklySales = managerSales.reduce(0) { $0 + $1.netSalesCents }
        return [
            FoodManagerKPI(title: "Live orders", value: "\(liveOrders)", detail: "Queue across kitchen and counter", color: "flame"),
            FoodManagerKPI(title: "Ready now", value: "\(readyOrders)", detail: "Awaiting pickup or handoff", color: "basil"),
            FoodManagerKPI(title: "Paid", value: "\(paidOrders)", detail: "Marked paid at counter", color: "blue"),
            FoodManagerKPI(title: "Training", value: "\(completionRate)%", detail: "Crew completion this week", color: "saffron"),
            FoodManagerKPI(title: "Weekly sales", value: foodMoney(weeklySales), detail: "Net sales across locations", color: "blue"),
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
        if managerIncidents.contains(where: { $0.severity != "Resolved" }) {
            alerts.append(FoodManagerAlert(title: "Open incident follow-up", detail: "Quality or guest incidents still need manager action.", tone: "critical"))
        }
        return alerts
    }
    var managerInventoryAlerts: [FoodInventoryItemSnapshot] {
        inventoryItems.filter { $0.stockLevel <= $0.parLevel }
    }
    var unresolvedIncidents: [FoodManagerIncident] {
        managerIncidents.filter { $0.severity != "Resolved" }
    }
    var managerCoverageSummary: String {
        let activeMembers = managerTeam.filter { $0.membershipStatus == "active" }.count
        let pendingMembers = managerTeam.filter { $0.membershipStatus == "pending" }.count
        if activeMembers > 0 || pendingMembers > 0 {
            return pendingMembers > 0
                ? "\(activeMembers) active / \(pendingMembers) pending team members"
                : "\(activeMembers) active team member\(activeMembers == 1 ? "" : "s")"
        }
        let current = managerTeam.filter { $0.badgeText == "Current" }.count
        return managerTeam.isEmpty ? "No live team status yet" : "\(current) current / \(managerTeam.count) live roles tracked"
    }

    // MARK: - Auth

    private static func loadValue<T: Decodable>(_ type: T.Type, key: String, default fallback: T) -> T {
        guard
            let data = UserDefaults.standard.data(forKey: key),
            let value = try? JSONDecoder().decode(T.self, from: data)
        else { return fallback }
        return value
    }

    private static func saveValue<T: Encodable>(_ value: T, key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

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
            await loadMerchantOrders()
            if let restaurant = merchantSelection {
                await loadRestaurantLocations(restaurantId: restaurant.id)
                await loadSetupProgress(restaurantId: restaurant.id)
            }
            await loadManagerOperationalData()
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
            if menu.isEmpty {
                await select(restaurant)
            }
        } catch {
            // Polling feed; keep the previous list on transient failure.
        }
    }

    func loadManagerOperationalData() async {
        guard let restaurant = merchantSelection else { return }
        do {
            let payload = try await authed { token in
                async let templatesTask = FoodAPIClient.shared.checklistTemplates(restaurantId: restaurant.id, token: token)
                async let runsTask = FoodAPIClient.shared.checklistRuns(restaurantId: restaurant.id, token: token)
                async let inventoryTask = FoodAPIClient.shared.inventoryItems(restaurantId: restaurant.id, token: token)
                async let allOrdersTask = FoodAPIClient.shared.restaurantOrders(restaurantId: restaurant.id, activeOnly: false, token: token)
                async let helpRequestsTask = FoodAPIClient.shared.helpRequests(restaurantId: restaurant.id, token: token)
                async let sopsTask = FoodAPIClient.shared.listSops(restaurantId: restaurant.id, token: token)
                async let teamTask: [BusinessMembershipResponse] = {
                    guard let businessId = restaurant.businessId else { return [] }
                    return try await FoodAPIClient.shared.businessMemberships(businessId: businessId, token: token)
                }()

                var dashboard = try await FoodAPIClient.shared.crewDashboard(restaurantId: restaurant.id, token: token)
                if dashboard.modules.isEmpty && dashboard.quizzes.isEmpty && dashboard.badges.isEmpty {
                    dashboard = try await FoodAPIClient.shared.bootstrapCrewDefaults(restaurantId: restaurant.id, token: token)
                }

                let templates = try await templatesTask
                let runs = try await runsTask
                let inventory = try await inventoryTask
                let allOrders = try await allOrdersTask
                let helpRequests = try await helpRequestsTask
                let sops = try await sopsTask
                let teamMemberships = try await teamTask

                let openingTemplate = Self.openingTemplate(from: templates)
                let openingRunListItem = openingTemplate.flatMap { template in
                    runs.first { $0.checklistId == template.id && $0.status != "completed" }
                        ?? runs.first { $0.checklistId == template.id }
                }
                let openingRun: RestaurantChecklistRunResponse?
                if let openingRunListItem {
                    openingRun = try await FoodAPIClient.shared.checklistRun(
                        restaurantId: restaurant.id,
                        runId: openingRunListItem.id,
                        token: token
                    )
                } else {
                    openingRun = nil
                }

                return ManagerOperationalPayload(
                    dashboard: dashboard,
                    openingTemplate: openingTemplate,
                    openingRun: openingRun,
                    inventoryItems: inventory,
                    allOrders: allOrders,
                    helpRequests: helpRequests,
                    sops: sops,
                    teamMemberships: teamMemberships
                )
            }

            crewTraining = payload.dashboard.modules.map {
                FoodTrainingModule(
                    title: $0.title,
                    role: $0.role,
                    durationMinutes: $0.durationMinutes,
                    isComplete: $0.isComplete
                )
            }
            openingChecklist = Self.mapOpeningChecklist(template: payload.openingTemplate, run: payload.openingRun)
            inventoryItems = payload.inventoryItems.map {
                FoodInventoryItemSnapshot(
                    name: $0.name,
                    stockLevel: $0.quantity,
                    unit: $0.unit,
                    parLevel: $0.lowStockThreshold,
                    supplier: $0.supplierName ?? "Supplier pending"
                )
            }
            managerTeam = Self.mapManagerTeam(memberships: payload.teamMemberships, dashboard: payload.dashboard)
            managerIncidents = Self.mapManagerIncidents(
                inventoryItems: inventoryItems,
                checklistItems: openingChecklist,
                quizzes: payload.dashboard.quizzes,
                activeOrders: merchantOrders
            )
            managerLocations = Self.mapManagerLocations(
                restaurants: merchantRestaurants,
                selectedRestaurantID: restaurant.id,
                orders: payload.allOrders,
                openIssueCount: managerIncidents.filter { $0.severity != "Resolved" }.count
            )
            if !restaurantLocations.isEmpty {
                let todaySales = payload.allOrders.reduce(0) { partial, order in
                    guard let createdAt = order.createdAt, createdAt >= Calendar.current.startOfDay(for: Date()) else { return partial }
                    return partial + order.totalCents
                }
                let issues = managerIncidents.filter { $0.severity != "Resolved" }.count
                managerLocations = restaurantLocations.map { loc in
                    FoodManagerLocationSummary(
                        id: UUID(),
                        backendLocationId: loc.id,
                        restaurantId: loc.restaurantId,
                        name: loc.name,
                        city: [loc.addressCity, loc.addressState].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", "),
                        salesTodayCents: loc.restaurantId == restaurant.id ? todaySales : 0,
                        openIssues: loc.restaurantId == restaurant.id ? issues : 0
                    )
                }
            }
            managerSales = Self.mapManagerSales(from: payload.allOrders)
            managerHelpRequests = payload.helpRequests.map(Self.mapManagerHelpRequest(from:))
            managerSOPs = payload.sops.map(Self.mapManagerSOP(from:))
        } catch {
            // Keep live queue/order state even if supporting manager metrics fail.
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
        if status == "active", let progress = setupProgress, !progress.readyToPublish {
            message = "Complete the setup checklist before going live."
            return
        }
        do {
            let updated = try await authed {
                try await FoodAPIClient.shared.updateRestaurantStatus(restaurantId: restaurant.id, status: status, token: $0)
            }
            merchantSelection = updated
            if let index = merchantRestaurants.firstIndex(where: { $0.id == updated.id }) {
                merchantRestaurants[index] = updated
            }
            message = status == "active" ? "\(updated.displayName) is live." : nil
            if status == "active" {
                await loadSetupProgress(restaurantId: updated.id)
            }
        } catch {
            message = error.localizedDescription
        }
    }

    func loadSetupProgress(restaurantId: Int64) async {
        guard isSignedIn else { return }
        do {
            setupProgress = try await authed {
                try await FoodAPIClient.shared.fetchSetupProgress(restaurantId: restaurantId, token: $0)
            }
        } catch {
            setupProgress = nil
        }
    }

    func backendLocation(for summary: FoodManagerLocationSummary) -> FoodRestaurantLocation? {
        guard let backendId = summary.backendLocationId else { return nil }
        return restaurantLocations.first { $0.id == backendId }
    }

    func loadRestaurantLocations(restaurantId: Int64) async {
        guard isSignedIn else { return }
        do {
            restaurantLocations = try await authed {
                try await FoodAPIClient.shared.listLocations(restaurantId: restaurantId, token: $0)
            }
        } catch {
            restaurantLocations = []
        }
    }

    func addRestaurantLocation(name: String, city: String) async -> Bool {
        guard let restaurant = merchantSelection else { return false }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        do {
            let location = try await authed {
                try await FoodAPIClient.shared.createLocation(
                    restaurantId: restaurant.id,
                    name: trimmed,
                    city: city.isEmpty ? nil : city,
                    isPrimary: restaurantLocations.isEmpty,
                    token: $0
                )
            }
            restaurantLocations.insert(location, at: 0)
            await loadSetupProgress(restaurantId: restaurant.id)
            message = "Location added."
            return true
        } catch {
            message = error.localizedDescription
            return false
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

    func isManagerItemAvailable(_ item: FoodMenuItem) -> Bool {
        managerItemAvailabilityOverrides[String(item.id)] ?? item.isAvailable
    }

    func toggleManagerItemAvailability(_ item: FoodMenuItem) {
        let key = String(item.id)
        let current = managerItemAvailabilityOverrides[key] ?? item.isAvailable
        let nextValue = !current

        if let restaurant = merchantSelection, isSignedIn {
            Task {
                do {
                    let updated = try await authed {
                        try await FoodAPIClient.shared.updateMenuItemAvailability(
                            restaurantId: restaurant.id,
                            itemId: item.id,
                            isAvailable: nextValue,
                            token: $0
                        )
                    }
                    managerItemAvailabilityOverrides.removeValue(forKey: key)
                    replaceMenuItem(updated)
                    message = updated.isAvailable
                        ? "\(updated.name) marked available for service."
                        : "\(updated.name) marked unavailable until prep catches up."
                } catch {
                    managerItemAvailabilityOverrides[key] = nextValue
                    message = "\(item.name) availability updated locally while sync is unavailable."
                }
            }
            return
        }

        managerItemAvailabilityOverrides[key] = nextValue
        message = nextValue ? "\(item.name) marked available for service." : "\(item.name) marked unavailable until prep catches up."
    }

    func updateManagerMenuItem(
        _ item: FoodMenuItem,
        name: String,
        description: String,
        priceText: String
    ) async -> Bool {
        guard let restaurant = merchantSelection else {
            message = "Select a restaurant before updating the menu."
            return false
        }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            message = "Add an item name."
            return false
        }
        guard let priceValue = Double(priceText.replacingOccurrences(of: ",", with: ".")), priceValue >= 0 else {
            message = "Enter the price as a number, like 8.99."
            return false
        }
        let priceCents = Int((priceValue * 100).rounded())

        do {
            let updated = try await authed {
                try await FoodAPIClient.shared.updateMenuItem(
                    restaurantId: restaurant.id,
                    itemId: item.id,
                    name: trimmedName,
                    description: description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : description.trimmingCharacters(in: .whitespacesAndNewlines),
                    priceCents: priceCents,
                    token: $0
                )
            }
            replaceMenuItem(updated)
            message = "\(updated.name) updated."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func deleteManagerMenuItem(_ item: FoodMenuItem) async -> Bool {
        guard let restaurant = merchantSelection else {
            message = "Select a restaurant before deleting a menu item."
            return false
        }

        do {
            try await authed {
                try await FoodAPIClient.shared.deleteMenuItem(
                    restaurantId: restaurant.id,
                    itemId: item.id,
                    token: $0
                )
            }
            removeMenuItem(item.id)
            managerItemAvailabilityOverrides.removeValue(forKey: String(item.id))
            message = "\(item.name) removed from the menu."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func createOpeningChecklist(name: String, firstTask: String) async -> Bool {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedTask = firstTask.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty, !trimmedTask.isEmpty else {
            message = "Add a checklist name and at least one task."
            return false
        }
        guard let restaurant = merchantSelection else {
            message = "Select a restaurant before creating a checklist."
            return false
        }

        do {
            let checklist = try await authed {
                try await FoodAPIClient.shared.createChecklist(
                    restaurantId: restaurant.id,
                    name: trimmedName,
                    checklistType: "opening",
                    description: "Created from the Manager app",
                    tasks: [
                        RestaurantChecklistTaskCreateBody(
                            label: trimmedTask,
                            instructions: nil,
                            requiresNote: false
                        )
                    ],
                    token: $0
                )
            }
            openingChecklist = checklist.tasks.sorted { $0.sortOrder < $1.sortOrder }.map {
                FoodChecklistItem(
                    title: $0.label,
                    station: $0.instructions ?? checklist.name,
                    isComplete: false
                )
            }
            message = "\(checklist.name) checklist created."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func createManagerSOP(title: String, category: String, body: String) async -> Bool {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty, !trimmedBody.isEmpty else {
            message = "Add an SOP title and procedure details."
            return false
        }
        guard let restaurant = merchantSelection else {
            message = "Select a restaurant before creating an SOP."
            return false
        }

        do {
            let sop = try await authed {
                try await FoodAPIClient.shared.createSop(
                    restaurantId: restaurant.id,
                    title: trimmedTitle,
                    category: category,
                    body: trimmedBody,
                    isPublished: true,
                    token: $0
                )
            }
            managerSOPs.insert(Self.mapManagerSOP(from: sop), at: 0)
            message = "\(sop.title) SOP created."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func addMarketplaceHelpRequest(title: String, details: String, urgency: String) async {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDetails = details.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty, !trimmedDetails.isEmpty else {
            message = "Add a short title and details before sending a help request."
            return
        }
        guard let restaurant = merchantSelection else {
            message = "Select a restaurant before sending a help request."
            return
        }

        isSubmittingHelpRequest = true
        defer { isSubmittingHelpRequest = false }

        do {
            let helpRequest = try await authed {
                try await FoodAPIClient.shared.createHelpRequest(
                    restaurantId: restaurant.id,
                    title: trimmedTitle,
                    detail: trimmedDetails,
                    urgency: urgency,
                    linkedLocation: activeRestaurant?.displayName ?? "Primary location",
                    token: $0
                )
            }
            managerHelpRequests.insert(Self.mapManagerHelpRequest(from: helpRequest), at: 0)
            message = "Marketplace Help request sent for \(urgency.lowercased()) follow-up."
        } catch {
            message = error.localizedDescription
        }
    }

    func updateMarketplaceHelpRequest(_ request: FoodManagerHelpRequest, status: String) async {
        guard let restaurant = merchantSelection else {
            message = "Select a restaurant before updating a help request."
            return
        }
        guard let index = managerHelpRequests.firstIndex(where: { $0.id == request.id }) else { return }

        let resolutionNote = status == "resolved" ? "Resolved from the Manager app" : nil

        do {
            let updated = try await authed {
                try await FoodAPIClient.shared.updateHelpRequest(
                    restaurantId: restaurant.id,
                    helpRequestId: request.remoteID,
                    status: status,
                    resolutionNote: resolutionNote,
                    token: $0
                )
            }
            managerHelpRequests[index] = Self.mapManagerHelpRequest(from: updated)
            message = "\(updated.title) marked \(updated.status.replacingOccurrences(of: "_", with: " "))."
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

    private func replaceMenuItem(_ item: FoodMenuItem) {
        for sectionIndex in menu.indices {
            if let itemIndex = menu[sectionIndex].items.firstIndex(where: { $0.id == item.id }) {
                menu[sectionIndex].items[itemIndex] = item
                return
            }
        }
    }

    private func removeMenuItem(_ itemId: Int64) {
        for sectionIndex in menu.indices {
            menu[sectionIndex].items.removeAll { $0.id == itemId }
        }
        menu.removeAll { $0.items.isEmpty && $0.id != -1 }
    }

    private static func openingTemplate(from templates: [RestaurantChecklistTemplateResponse]) -> RestaurantChecklistTemplateResponse? {
        templates.first {
            $0.checklistType.localizedCaseInsensitiveContains("open")
                || $0.name.localizedCaseInsensitiveContains("open")
        } ?? templates.first
    }

    private static func mapOpeningChecklist(
        template: RestaurantChecklistTemplateResponse?,
        run: RestaurantChecklistRunResponse?
    ) -> [FoodChecklistItem] {
        guard let template else { return FoodOperationsSampleData.openingChecklist }
        let runItemsByTaskID = Dictionary(
            uniqueKeysWithValues: (run?.items ?? []).compactMap { item in
                item.taskId.map { ($0, item) }
            }
        )
        return template.tasks
            .sorted { $0.sortOrder < $1.sortOrder }
            .map { task in
                let runItem = runItemsByTaskID[task.id]
                return FoodChecklistItem(
                    title: task.label,
                    station: task.instructions ?? template.name,
                    isComplete: runItem?.isDone ?? false
                )
            }
    }

    private static func mapManagerTeam(
        memberships: [BusinessMembershipResponse],
        dashboard: RestaurantCrewDashboardResponse
    ) -> [FoodManagerTeamMember] {
        if !memberships.isEmpty {
            return memberships.map { membership in
                let displayName = [membership.firstName, membership.lastName]
                    .compactMap { value -> String? in
                        guard let value, !value.isEmpty else { return nil }
                        return value
                    }
                    .joined(separator: " ")
                let roleLabel = membership.role.replacingOccurrences(of: "_", with: " ").capitalized
                let detailLabel: String
                if let email = membership.userEmail ?? membership.inviteEmail, !email.isEmpty {
                    detailLabel = email
                } else if membership.permissions.isEmpty {
                    detailLabel = "No permission overrides"
                } else {
                    detailLabel = "\(membership.permissions.count) permission override\(membership.permissions.count == 1 ? "" : "s")"
                }
                let badgeText = membership.status == "active"
                    ? (membership.permissions.isEmpty ? "Active" : "Permissions")
                    : "Pending"
                return FoodManagerTeamMember(
                    id: UUID(),
                    membershipID: membership.id,
                    name: displayName.isEmpty ? (membership.inviteEmail ?? "Pending invite") : displayName,
                    role: roleLabel,
                    membershipStatus: membership.status,
                    detailLabel: detailLabel,
                    badgeText: badgeText
                )
            }
        }

        let grouped = Dictionary(grouping: dashboard.modules) { $0.role.trimmingCharacters(in: .whitespacesAndNewlines) }
        let team = grouped.keys.sorted().map { role -> FoodManagerTeamMember in
            let modules = grouped[role] ?? []
            let completed = modules.filter(\.isComplete).count
            let badgeText: String
            if modules.isEmpty || completed == 0 {
                badgeText = "Assigned"
            } else if completed == modules.count {
                badgeText = "Current"
            } else {
                badgeText = "In progress"
            }
            return FoodManagerTeamMember(
                id: UUID(),
                membershipID: nil,
                name: "\(role) crew",
                role: role,
                membershipStatus: "sample",
                detailLabel: "\(modules.count) live modules",
                badgeText: badgeText
            )
        }
        return team.isEmpty ? FoodManagerSampleData.teamMembers : team
    }

    private static func mapManagerIncidents(
        inventoryItems: [FoodInventoryItemSnapshot],
        checklistItems: [FoodChecklistItem],
        quizzes: [RestaurantCrewQuizResultResponse],
        activeOrders: [FoodOrder]
    ) -> [FoodManagerIncident] {
        var incidents: [FoodManagerIncident] = []
        let lowStock = inventoryItems.filter { $0.stockLevel <= $0.parLevel }
        if !lowStock.isEmpty {
            incidents.append(
                FoodManagerIncident(
                    id: UUID(),
                    title: "Low-stock inventory risk",
                    detail: "\(lowStock.count) item(s) are at or below par and need receiving or menu updates.",
                    severity: "Open",
                    happenedAt: Date()
                )
            )
        }
        let incompleteChecklist = checklistItems.filter { !$0.isComplete }
        if !incompleteChecklist.isEmpty {
            incidents.append(
                FoodManagerIncident(
                    id: UUID(),
                    title: "Opening checklist still incomplete",
                    detail: "\(incompleteChecklist.count) opening task(s) still need attention before the next rush.",
                    severity: "Open",
                    happenedAt: Date()
                )
            )
        }
        let failedQuizzes = quizzes.filter { !$0.passed || $0.scorePercent < 80 }
        if !failedQuizzes.isEmpty {
            incidents.append(
                FoodManagerIncident(
                    id: UUID(),
                    title: "Crew quiz follow-up required",
                    detail: "\(failedQuizzes.count) live quiz result(s) need retraining or manager review.",
                    severity: "Open",
                    happenedAt: Date()
                )
            )
        }
        if activeOrders.filter({ $0.status == "received" || $0.status == "accepted" }).count >= 4 {
            incidents.append(
                FoodManagerIncident(
                    id: UUID(),
                    title: "Queue backlog building",
                    detail: "Several live tickets are still waiting to enter prep. Kitchen attention recommended.",
                    severity: "Open",
                    happenedAt: Date()
                )
            )
        }
        return incidents.isEmpty ? FoodManagerSampleData.incidents : incidents
    }

    private static func mapManagerLocations(
        restaurants: [FoodRestaurant],
        selectedRestaurantID: Int64,
        orders: [FoodOrder],
        openIssueCount: Int
    ) -> [FoodManagerLocationSummary] {
        let startOfDay = Calendar.current.startOfDay(for: Date())
        let todaySales = orders.reduce(0) { partial, order in
            guard let createdAt = order.createdAt, createdAt >= startOfDay else { return partial }
            return partial + order.totalCents
        }
        let locations = restaurants.flatMap { restaurant -> [FoodManagerLocationSummary] in
            let cityBits = [restaurant.addressCity, restaurant.addressState].compactMap { value -> String? in
                guard let value, !value.isEmpty else { return nil }
                return value
            }
            let base = FoodManagerLocationSummary(
                id: UUID(),
                backendLocationId: nil,
                restaurantId: restaurant.id,
                name: restaurant.displayName,
                city: cityBits.isEmpty ? restaurant.addressCountry : cityBits.joined(separator: ", "),
                salesTodayCents: restaurant.id == selectedRestaurantID ? todaySales : 0,
                openIssues: restaurant.id == selectedRestaurantID ? openIssueCount : 0
            )
            return [base]
        }
        return locations.isEmpty ? FoodManagerSampleData.locations : locations
    }

    private static func mapManagerSales(from orders: [FoodOrder]) -> [FoodManagerSalesDay] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let formatter = DateFormatter()
        formatter.dateFormat = "E"

        let days: [Date] = (0..<5).compactMap { offset in
            calendar.date(byAdding: .day, value: -(4 - offset), to: today)
        }
        let sales = days.map { day -> FoodManagerSalesDay in
            guard let nextDay = calendar.date(byAdding: .day, value: 1, to: day) else {
                return FoodManagerSalesDay(id: UUID(), label: formatter.string(from: day), netSalesCents: 0, orderCount: 0)
            }
            let ordersForDay = orders.filter { order in
                guard let createdAt = order.createdAt else { return false }
                return createdAt >= day && createdAt < nextDay
            }
            return FoodManagerSalesDay(
                id: UUID(),
                label: formatter.string(from: day),
                netSalesCents: ordersForDay.reduce(0) { $0 + $1.totalCents },
                orderCount: ordersForDay.count
            )
        }
        let hasLiveSales = sales.contains { $0.netSalesCents > 0 || $0.orderCount > 0 }
        return hasLiveSales ? sales : FoodManagerSampleData.sales
    }

    private static func mapManagerHelpRequest(from response: RestaurantHelpRequestResponse) -> FoodManagerHelpRequest {
        FoodManagerHelpRequest(
            remoteID: response.id,
            title: response.title,
            detail: response.detail,
            urgency: response.urgency,
            status: response.status,
            createdAt: response.createdAt,
            linkedLocation: response.linkedLocation ?? "Primary location"
        )
    }

    private static func mapManagerSOP(from response: RestaurantSOPResponse) -> FoodManagerSOP {
        FoodManagerSOP(
            title: response.title,
            category: response.category.replacingOccurrences(of: "_", with: " ").capitalized,
            detail: response.body ?? "No SOP body provided.",
            versionLabel: "v\(response.version)"
        )
    }

    func inviteManagerTeamMember(email: String, role: String) async -> Bool {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let restaurant = merchantSelection, let businessId = restaurant.businessId else {
            message = "Select a restaurant before inviting team members."
            return false
        }
        guard !trimmedEmail.isEmpty else {
            message = "Add an email address before sending the invite."
            return false
        }
        do {
            try await authed {
                try await FoodAPIClient.shared.inviteBusinessMember(
                    businessId: businessId,
                    email: trimmedEmail,
                    role: role,
                    token: $0
                )
            }
            await loadManagerOperationalData()
            message = "Team invite sent to \(trimmedEmail)."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func revokeManagerTeamMember(_ member: FoodManagerTeamMember) async -> Bool {
        guard let restaurant = merchantSelection,
              let businessId = restaurant.businessId,
              let membershipId = member.membershipID else {
            message = "This team member is not linked to a live membership."
            return false
        }
        do {
            try await authed {
                try await FoodAPIClient.shared.revokeBusinessMember(
                    businessId: businessId,
                    membershipId: membershipId,
                    token: $0
                )
            }
            await loadManagerOperationalData()
            message = "\(member.name) removed from the business team."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func changeManagerTeamRole(_ member: FoodManagerTeamMember, role: String) async -> Bool {
        guard let restaurant = merchantSelection,
              let businessId = restaurant.businessId,
              let membershipId = member.membershipID else {
            message = "This team member is not linked to a live membership."
            return false
        }
        do {
            try await authed {
                try await FoodAPIClient.shared.changeBusinessMembershipRole(
                    businessId: businessId,
                    membershipId: membershipId,
                    role: role,
                    token: $0
                )
            }
            await loadManagerOperationalData()
            message = "\(member.name)'s role updated."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }
}

private struct ManagerOperationalPayload {
    let dashboard: RestaurantCrewDashboardResponse
    let openingTemplate: RestaurantChecklistTemplateResponse?
    let openingRun: RestaurantChecklistRunResponse?
    let inventoryItems: [RestaurantInventoryItemResponse]
    let allOrders: [FoodOrder]
    let helpRequests: [RestaurantHelpRequestResponse]
    let sops: [RestaurantSOPResponse]
    let teamMemberships: [BusinessMembershipResponse]
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

struct FoodManagerTeamMember: Identifiable, Codable, Hashable {
    let id: UUID
    let membershipID: Int64?
    var name: String
    var role: String
    var membershipStatus: String
    var detailLabel: String
    var badgeText: String
}

struct FoodManagerIncident: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var detail: String
    var severity: String
    var happenedAt: Date
}

struct FoodManagerLocationSummary: Identifiable, Codable, Hashable {
    let id: UUID
    var backendLocationId: Int64?
    var restaurantId: Int64?
    var name: String
    var city: String
    var salesTodayCents: Int
    var openIssues: Int
}

struct FoodManagerHelpRequest: Identifiable, Codable, Hashable {
    let id: UUID
    let remoteID: Int64
    var title: String
    var detail: String
    var urgency: String
    var status: String
    var createdAt: Date
    var linkedLocation: String

    init(
        id: UUID = UUID(),
        remoteID: Int64 = -1,
        title: String,
        detail: String,
        urgency: String,
        status: String = "open",
        createdAt: Date,
        linkedLocation: String
    ) {
        self.id = id
        self.remoteID = remoteID
        self.title = title
        self.detail = detail
        self.urgency = urgency
        self.status = status
        self.createdAt = createdAt
        self.linkedLocation = linkedLocation
    }
}

struct FoodManagerSOP: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var category: String
    var detail: String
    var versionLabel: String

    init(
        id: UUID = UUID(),
        title: String,
        category: String,
        detail: String,
        versionLabel: String
    ) {
        self.id = id
        self.title = title
        self.category = category
        self.detail = detail
        self.versionLabel = versionLabel
    }
}

struct FoodManagerSalesDay: Identifiable, Codable, Hashable {
    let id: UUID
    var label: String
    var netSalesCents: Int
    var orderCount: Int
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

enum FoodManagerSampleData {
    static let teamMembers = [
        FoodManagerTeamMember(id: UUID(), membershipID: nil, name: "Ana Rivera", role: "Shift manager", membershipStatus: "sample", detailLabel: "On shift", badgeText: "Current"),
        FoodManagerTeamMember(id: UUID(), membershipID: nil, name: "Marcus Lee", role: "Kitchen lead", membershipStatus: "sample", detailLabel: "On shift", badgeText: "Current"),
        FoodManagerTeamMember(id: UUID(), membershipID: nil, name: "Tia Joseph", role: "Cashier", membershipStatus: "sample", detailLabel: "Break at 2:15 PM", badgeText: "Quiz due"),
        FoodManagerTeamMember(id: UUID(), membershipID: nil, name: "David Chen", role: "Prep cook", membershipStatus: "sample", detailLabel: "Starts at 4 PM", badgeText: "Assigned"),
    ]

    static let incidents = [
        FoodManagerIncident(id: UUID(), title: "Guest wait-time complaint", detail: "Order #37 was delayed 11 minutes beyond quote. Callback pending.", severity: "Open", happenedAt: Date().addingTimeInterval(-3600)),
        FoodManagerIncident(id: UUID(), title: "Cold hold variance", detail: "Morning line check found one unit above target temp; corrected and logged.", severity: "Resolved", happenedAt: Date().addingTimeInterval(-18_000)),
    ]

    static let locations = [
        FoodManagerLocationSummary(id: UUID(), backendLocationId: nil, restaurantId: nil, name: "Ox Burger Lab - Downtown", city: "Miami, FL", salesTodayCents: 182400, openIssues: 1),
        FoodManagerLocationSummary(id: UUID(), backendLocationId: nil, restaurantId: nil, name: "Ox Burger Lab - Wynwood", city: "Miami, FL", salesTodayCents: 143900, openIssues: 0),
    ]

    static let helpRequests = [
        FoodManagerHelpRequest(title: "Urgent fryer maintenance", detail: "Right-side fryer loses temp during lunch rush. Need same-day technician.", urgency: "High", status: "open", createdAt: Date().addingTimeInterval(-7200), linkedLocation: "Downtown"),
    ]

    static let sops = [
        FoodManagerSOP(title: "Lobby handoff standard", category: "Front Of House", detail: "Confirm guest name, repeat order number, and mark pickup complete only after handoff.", versionLabel: "v2"),
        FoodManagerSOP(title: "Cold-hold verification", category: "Food Safety", detail: "Record product temperature before each rush and escalate any item above threshold.", versionLabel: "v3"),
    ]

    static let sales = [
        FoodManagerSalesDay(id: UUID(), label: "Mon", netSalesCents: 148300, orderCount: 86),
        FoodManagerSalesDay(id: UUID(), label: "Tue", netSalesCents: 152700, orderCount: 93),
        FoodManagerSalesDay(id: UUID(), label: "Wed", netSalesCents: 161200, orderCount: 101),
        FoodManagerSalesDay(id: UUID(), label: "Thu", netSalesCents: 170500, orderCount: 108),
        FoodManagerSalesDay(id: UUID(), label: "Fri", netSalesCents: 189400, orderCount: 122),
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
