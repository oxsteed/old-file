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
    @Published var closingChecklist = FoodCrewSampleData.closingChecklist
    @Published var cleaningProcedures = FoodCrewSampleData.cleaningProcedures
    @Published var foodSafetyProcedures = FoodCrewSampleData.foodSafetyProcedures
    @Published var crewBadges = FoodCrewSampleData.badges
    @Published var crewQuizResults = FoodCrewSampleData.quizResults
    @Published var crewSelectedRole = "Cashier"
    @Published var inventoryItems = FoodOperationsSampleData.inventoryItems
    @Published var receivingTasks = FoodOperationsSampleData.receivingTasks
    @Published var runnerTasks = FoodOperationsSampleData.runnerTasks
    @Published private var checklistTemplates: [FoodChecklistTemplateSnapshot] = []
    @Published private var checklistRunsByChecklistID: [Int64: RestaurantChecklistRunResponse] = [:]

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
    var crewCompletionRate: Int {
        guard !crewTraining.isEmpty else { return 0 }
        return Int((Double(crewTraining.filter(\.isComplete).count) / Double(crewTraining.count)) * 100)
    }
    var crewOutstandingModules: [FoodTrainingModule] {
        crewTraining.filter { !$0.isComplete }
    }
    var crewAverageQuizScore: Int {
        guard !crewQuizResults.isEmpty else { return 0 }
        let total = crewQuizResults.reduce(0) { $0 + $1.scorePercent }
        return total / crewQuizResults.count
    }
    var crewRoleModules: [FoodTrainingModule] {
        crewTraining.filter { $0.role == crewSelectedRole }
    }
    var crewRoles: [String] {
        Array(Set(crewTraining.map(\.role))).sorted()
    }
    var managerKPIs: [FoodManagerKPI] {
        let liveOrders = merchantOrders.filter(\.isActive).count
        let readyOrders = merchantOrders.filter { $0.status == "ready" }.count
        let paidOrders = merchantOrders.filter { $0.paymentStatus == "paid" }.count
        return [
            FoodManagerKPI(title: "Live orders", value: "\(liveOrders)", detail: "Queue across kitchen and counter", color: "flame"),
            FoodManagerKPI(title: "Ready now", value: "\(readyOrders)", detail: "Awaiting pickup or handoff", color: "basil"),
            FoodManagerKPI(title: "Paid", value: "\(paidOrders)", detail: "Marked paid at counter", color: "blue"),
            FoodManagerKPI(title: "Training", value: "\(crewCompletionRate)%", detail: "Crew completion this week", color: "saffron"),
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
        checklistTemplates = []
        checklistRunsByChecklistID = [:]
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
            await loadCrewOperations()
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

    func toggleTrainingModule(_ module: FoodTrainingModule) {
        if let restaurant = merchantSelection, isSignedIn, let remoteID = module.remoteID {
            Task {
                do {
                    let updated = try await authed {
                        try await FoodAPIClient.shared.updateCrewTrainingModule(
                            restaurantId: restaurant.id,
                            moduleId: remoteID,
                            isComplete: !module.isComplete,
                            token: $0
                        )
                    }
                    replaceCrewTrainingModule(updated)
                    message = updated.isComplete
                        ? "\(updated.title) marked complete."
                        : "\(updated.title) reopened for review."
                } catch {
                    message = error.localizedDescription
                }
            }
            return
        }
        guard let index = crewTraining.firstIndex(where: { $0.id == module.id }) else { return }
        crewTraining[index].isComplete.toggle()
        message = crewTraining[index].isComplete
            ? "\(crewTraining[index].title) marked complete."
            : "\(crewTraining[index].title) reopened for review."
    }

    func createCrewTrainingModule(title: String, role: String, durationMinutes: Int) async -> Bool {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedRole = role.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty, !trimmedRole.isEmpty else {
            message = "Add both a module title and a crew role."
            return false
        }

        if let restaurant = merchantSelection, isSignedIn {
            do {
                let created = try await authed {
                    try await FoodAPIClient.shared.createCrewTrainingModule(
                        restaurantId: restaurant.id,
                        title: trimmedTitle,
                        role: trimmedRole,
                        durationMinutes: durationMinutes,
                        token: $0
                    )
                }
                replaceCrewTrainingModule(created)
                message = "\(created.title) added to crew training."
                return true
            } catch {
                message = error.localizedDescription
                return false
            }
        }

        crewTraining.insert(
            FoodTrainingModule(
                remoteID: nil,
                title: trimmedTitle,
                role: trimmedRole,
                durationMinutes: durationMinutes,
                isComplete: false
            ),
            at: 0
        )
        message = "Training module drafted locally."
        return true
    }

    func createCrewQuizResult(title: String, scorePercent: Int, attempts: Int) async -> Bool {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            message = "Add a quiz title before saving the result."
            return false
        }
        let safeScore = max(0, min(100, scorePercent))
        let safeAttempts = max(1, attempts)
        let passed = safeScore >= 80

        if let restaurant = merchantSelection, isSignedIn {
            do {
                let created = try await authed {
                    try await FoodAPIClient.shared.createCrewQuizResult(
                        restaurantId: restaurant.id,
                        title: trimmedTitle,
                        scorePercent: safeScore,
                        attempts: safeAttempts,
                        passed: passed,
                        token: $0
                    )
                }
                crewQuizResults.insert(
                    FoodQuizResult(
                        remoteID: created.id,
                        title: created.title,
                        scorePercent: created.scorePercent,
                        attempts: created.attempts,
                        passed: created.passed
                    ),
                    at: 0
                )
                message = "Quiz result saved for \(created.title)."
                return true
            } catch {
                message = error.localizedDescription
                return false
            }
        }

        crewQuizResults.insert(
            FoodQuizResult(
                remoteID: nil,
                title: trimmedTitle,
                scorePercent: safeScore,
                attempts: safeAttempts,
                passed: passed
            ),
            at: 0
        )
        message = "Quiz result drafted locally."
        return true
    }

    func createCrewBadge(title: String, detail: String, awarded: Bool) async -> Bool {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDetail = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty, !trimmedDetail.isEmpty else {
            message = "Add both a badge title and detail."
            return false
        }

        if let restaurant = merchantSelection, isSignedIn {
            do {
                let created = try await authed {
                    try await FoodAPIClient.shared.upsertCrewBadge(
                        restaurantId: restaurant.id,
                        title: trimmedTitle,
                        detail: trimmedDetail,
                        awarded: awarded,
                        token: $0
                    )
                }
                crewBadges.insert(
                    FoodCrewBadge(
                        remoteID: created.id,
                        title: created.title,
                        detail: created.detail,
                        awarded: created.awarded
                    ),
                    at: 0
                )
                message = "Badge added for crew tracking."
                return true
            } catch {
                message = error.localizedDescription
                return false
            }
        }

        crewBadges.insert(
            FoodCrewBadge(
                remoteID: nil,
                title: trimmedTitle,
                detail: trimmedDetail,
                awarded: awarded
            ),
            at: 0
        )
        message = "Badge drafted locally."
        return true
    }

    func toggleChecklistItem(_ item: FoodChecklistItem, kind: FoodChecklistKind) {
        if isSignedIn, merchantSelection != nil, item.remoteChecklistID != nil {
            Task { await toggleChecklistItemLive(item, kind: kind) }
            return
        }
        switch kind {
        case .opening:
            guard let index = openingChecklist.firstIndex(where: { $0.id == item.id }) else { return }
            openingChecklist[index].isComplete.toggle()
        case .closing:
            guard let index = closingChecklist.firstIndex(where: { $0.id == item.id }) else { return }
            closingChecklist[index].isComplete.toggle()
        }
    }

    func loadCrewOperations() async {
        guard let restaurant = merchantSelection else { return }
        do {
            let templates = try await authed {
                try await FoodAPIClient.shared.checklistTemplates(restaurantId: restaurant.id, token: $0)
            }
            let sops = try await authed {
                try await FoodAPIClient.shared.listSops(restaurantId: restaurant.id, token: $0)
            }
            let runs = try await authed {
                try await FoodAPIClient.shared.checklistRuns(restaurantId: restaurant.id, token: $0)
            }
            var crewDashboard = try await authed {
                try await FoodAPIClient.shared.crewDashboard(restaurantId: restaurant.id, token: $0)
            }
            if crewDashboard.modules.isEmpty && crewDashboard.quizzes.isEmpty && crewDashboard.badges.isEmpty {
                crewDashboard = try await authed {
                    try await FoodAPIClient.shared.bootstrapCrewDefaults(restaurantId: restaurant.id, token: $0)
                }
            }

            var detailedRuns: [Int64: RestaurantChecklistRunResponse] = [:]
            for run in runs where run.status == "in_progress" {
                if let detail = try? await authed({
                    try await FoodAPIClient.shared.checklistRun(
                        restaurantId: restaurant.id,
                        runId: run.id,
                        token: $0
                    )
                }) {
                    detailedRuns[detail.checklistId] = detail
                }
            }

            checklistTemplates = templates.map {
                FoodChecklistTemplateSnapshot(
                    id: $0.id,
                    name: $0.name,
                    checklistType: $0.checklistType,
                    tasks: $0.tasks
                )
            }
            checklistRunsByChecklistID = detailedRuns
            applyCrewChecklists()
            applyCrewSOPs(sops)
            applyCrewTrainingDashboard(crewDashboard)
        } catch {
            // Keep the app usable with curated fallback content when the
            // operations API is not deployed for the current environment.
        }
    }

    private func applyCrewTrainingDashboard(_ dashboard: RestaurantCrewDashboardResponse) {
        if !dashboard.modules.isEmpty {
            crewTraining = dashboard.modules.map {
                FoodTrainingModule(
                    remoteID: $0.id,
                    title: $0.title,
                    role: $0.role,
                    durationMinutes: $0.durationMinutes,
                    isComplete: $0.isComplete
                )
            }
        }
        if !dashboard.quizzes.isEmpty {
            crewQuizResults = dashboard.quizzes.map {
                FoodQuizResult(
                    remoteID: $0.id,
                    title: $0.title,
                    scorePercent: $0.scorePercent,
                    attempts: $0.attempts,
                    passed: $0.passed
                )
            }
        }
        if !dashboard.badges.isEmpty {
            crewBadges = dashboard.badges.map {
                FoodCrewBadge(
                    remoteID: $0.id,
                    title: $0.title,
                    detail: $0.detail,
                    awarded: $0.awarded
                )
            }
        }
    }

    private func replaceCrewTrainingModule(_ module: RestaurantCrewTrainingModuleResponse) {
        let mapped = FoodTrainingModule(
            remoteID: module.id,
            title: module.title,
            role: module.role,
            durationMinutes: module.durationMinutes,
            isComplete: module.isComplete
        )
        if let index = crewTraining.firstIndex(where: { $0.remoteID == module.id }) {
            crewTraining[index] = mapped
        } else {
            crewTraining.insert(mapped, at: 0)
        }
    }

    private func applyCrewChecklists() {
        if let openingTemplate = checklistTemplates.first(where: { $0.checklistType == "opening" }) {
            openingChecklist = materializeChecklist(kind: .opening, template: openingTemplate)
        }
        if let closingTemplate = checklistTemplates.first(where: { $0.checklistType == "closing" }) {
            closingChecklist = materializeChecklist(kind: .closing, template: closingTemplate)
        }
    }

    private func materializeChecklist(kind: FoodChecklistKind, template: FoodChecklistTemplateSnapshot) -> [FoodChecklistItem] {
        if let liveRun = checklistRunsByChecklistID[template.id] {
            return liveRun.items.map {
                FoodChecklistItem(
                    remoteChecklistID: template.id,
                    remoteRunID: liveRun.id,
                    remoteRunItemID: $0.id,
                    title: $0.label,
                    station: template.name,
                    isComplete: $0.isDone
                )
            }
        }
        return template.tasks.map {
            FoodChecklistItem(
                remoteChecklistID: template.id,
                remoteRunID: nil,
                remoteRunItemID: nil,
                title: $0.label,
                station: template.name,
                isComplete: false
            )
        }
    }

    private func applyCrewSOPs(_ sops: [RestaurantSOPResponse]) {
        let liveDocuments = sops
            .filter(\.isPublished)
            .map {
                FoodSOPDocument(
                    remoteID: $0.id,
                    title: $0.title,
                    category: $0.category.replacingOccurrences(of: "_", with: " ").capitalized,
                    durationMinutes: max(5, min(20, ($0.body?.count ?? 120) / 90)),
                    summary: ($0.body?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                        ? $0.body!.trimmingCharacters(in: .whitespacesAndNewlines)
                        : "Version \($0.version) published for crew reference.")
                )
            }

        let cleaning = liveDocuments.filter { ["cleaning", "closing"].contains($0.category.lowercased().replacingOccurrences(of: " ", with: "_")) }
        if !cleaning.isEmpty {
            cleaningProcedures = cleaning
        }

        let safety = liveDocuments.filter { ["food_safety", "safety"].contains($0.category.lowercased().replacingOccurrences(of: " ", with: "_")) }
        if !safety.isEmpty {
            foodSafetyProcedures = safety
        }
    }

    private func toggleChecklistItemLive(_ item: FoodChecklistItem, kind: FoodChecklistKind) async {
        guard let restaurant = merchantSelection, let checklistID = item.remoteChecklistID else { return }
        do {
            let updatedRun: RestaurantChecklistRunResponse
            if let runID = item.remoteRunID, let runItemID = item.remoteRunItemID {
                updatedRun = try await authed {
                    try await FoodAPIClient.shared.toggleChecklistRunItem(
                        restaurantId: restaurant.id,
                        runId: runID,
                        itemId: runItemID,
                        isDone: !item.isComplete,
                        token: $0
                    )
                }
            } else {
                let newRun = try await authed {
                    try await FoodAPIClient.shared.startChecklistRun(
                        restaurantId: restaurant.id,
                        checklistId: checklistID,
                        token: $0
                    )
                }
                guard let createdItem = newRun.items.first(where: { $0.label == item.title }) ?? newRun.items.first else {
                    checklistRunsByChecklistID[checklistID] = newRun
                    applyCrewChecklists()
                    return
                }
                updatedRun = try await authed {
                    try await FoodAPIClient.shared.toggleChecklistRunItem(
                        restaurantId: restaurant.id,
                        runId: newRun.id,
                        itemId: createdItem.id,
                        isDone: true,
                        token: $0
                    )
                }
            }
            checklistRunsByChecklistID[checklistID] = updatedRun
            applyCrewChecklists()
            message = kind == .opening
                ? "Opening checklist synced."
                : "Closing checklist synced."
        } catch {
            message = error.localizedDescription
        }
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
    let remoteID: Int64?
    let title: String
    let role: String
    let durationMinutes: Int
    var isComplete: Bool
}

struct FoodChecklistItem: Identifiable, Hashable {
    let id = UUID()
    let remoteChecklistID: Int64?
    let remoteRunID: Int64?
    let remoteRunItemID: Int64?
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

enum FoodChecklistKind {
    case opening
    case closing
}

struct FoodSOPDocument: Identifiable, Hashable {
    let id = UUID()
    let remoteID: Int64?
    let title: String
    let category: String
    let durationMinutes: Int
    let summary: String
}

struct FoodChecklistTemplateSnapshot {
    let id: Int64
    let name: String
    let checklistType: String
    let tasks: [RestaurantChecklistTaskResponse]
}

struct FoodCrewBadge: Identifiable, Hashable {
    let id = UUID()
    let remoteID: Int64?
    let title: String
    let detail: String
    let awarded: Bool
}

struct FoodQuizResult: Identifiable, Hashable {
    let id = UUID()
    let remoteID: Int64?
    let title: String
    let scorePercent: Int
    let attempts: Int
    let passed: Bool
}

enum FoodOperationsSampleData {
    static let trainingModules = [
        FoodTrainingModule(remoteID: nil, title: "Opening line check", role: "Cashier", durationMinutes: 10, isComplete: true),
        FoodTrainingModule(remoteID: nil, title: "Allergen handoff protocol", role: "Kitchen", durationMinutes: 14, isComplete: false),
        FoodTrainingModule(remoteID: nil, title: "Refund and void policy", role: "Manager", durationMinutes: 8, isComplete: false),
        FoodTrainingModule(remoteID: nil, title: "Drive-thru greeting script", role: "Cashier", durationMinutes: 6, isComplete: false),
        FoodTrainingModule(remoteID: nil, title: "Expo packaging accuracy", role: "Kitchen", durationMinutes: 12, isComplete: true),
        FoodTrainingModule(remoteID: nil, title: "Guest recovery and escalation", role: "Manager", durationMinutes: 9, isComplete: true),
    ]

    static let openingChecklist = [
        FoodChecklistItem(remoteChecklistID: nil, remoteRunID: nil, remoteRunItemID: nil, title: "Hot hold verified above 135F", station: "Expo", isComplete: true),
        FoodChecklistItem(remoteChecklistID: nil, remoteRunID: nil, remoteRunItemID: nil, title: "Kiosk printer paper loaded", station: "Front counter", isComplete: false),
        FoodChecklistItem(remoteChecklistID: nil, remoteRunID: nil, remoteRunItemID: nil, title: "Queue board tested", station: "Dining room", isComplete: true),
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

enum FoodCrewSampleData {
    static let closingChecklist = [
        FoodChecklistItem(remoteChecklistID: nil, remoteRunID: nil, remoteRunItemID: nil, title: "Sanitize prep line and slicer", station: "Kitchen", isComplete: false),
        FoodChecklistItem(remoteChecklistID: nil, remoteRunID: nil, remoteRunItemID: nil, title: "Count register and lock drop bag", station: "Front counter", isComplete: true),
        FoodChecklistItem(remoteChecklistID: nil, remoteRunID: nil, remoteRunItemID: nil, title: "Mop lobby and restock condiments", station: "Dining room", isComplete: false),
    ]

    static let cleaningProcedures = [
        FoodSOPDocument(remoteID: nil, title: "Flat-top breakdown", category: "Cleaning", durationMinutes: 12, summary: "Scrape, cool, degrease, rinse, and sign off before close."),
        FoodSOPDocument(remoteID: nil, title: "Dining room sanitizer rotation", category: "Cleaning", durationMinutes: 8, summary: "Refresh buckets every 2 hours and label by station."),
    ]

    static let foodSafetyProcedures = [
        FoodSOPDocument(remoteID: nil, title: "Cold hold verification", category: "Food Safety", durationMinutes: 7, summary: "Check every cold unit below 41F and log corrective action."),
        FoodSOPDocument(remoteID: nil, title: "Allergen handoff standard", category: "Food Safety", durationMinutes: 10, summary: "Use marked packaging, verbal callout, and expo confirmation."),
    ]

    static let badges = [
        FoodCrewBadge(remoteID: nil, title: "Opening Certified", detail: "Can independently run pre-shift setup.", awarded: true),
        FoodCrewBadge(remoteID: nil, title: "Food Safety Ready", detail: "Passed sanitation and temp-control checks.", awarded: true),
        FoodCrewBadge(remoteID: nil, title: "Trainer Candidate", detail: "Eligible to coach new crew members.", awarded: false),
    ]

    static let quizResults = [
        FoodQuizResult(remoteID: nil, title: "Allergen protocol quiz", scorePercent: 92, attempts: 1, passed: true),
        FoodQuizResult(remoteID: nil, title: "Refund and void quiz", scorePercent: 78, attempts: 2, passed: false),
        FoodQuizResult(remoteID: nil, title: "Cleaning closeout quiz", scorePercent: 88, attempts: 1, passed: true),
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
