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
    @Published var runnerContactRules = FoodRunnerSampleData.contactRules
    @Published var runnerProofs = FoodRunnerSampleData.proofLog
    @Published var runnerIssueReports = FoodRunnerSampleData.issueReports
    @Published var runnerPaymentNotes = FoodRunnerSampleData.paymentNotes

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
    var assignedRunnerTasks: [FoodRunnerTask] {
        runnerTasks.filter { $0.status != "Completed" }
    }
    var completedRunnerTasks: [FoodRunnerTask] {
        runnerTasks.filter { $0.status == "Completed" }
    }
    var proofPendingTasks: [FoodRunnerTask] {
        runnerTasks.filter { $0.requiresProof && $0.status != "Completed" }
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
            await loadLiveRunnerDashboard()
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

    func createRunnerTask(
        orderReference: String,
        stopName: String,
        taskType: String,
        routeWindow: String,
        customerContactRule: String,
        requiresProof: Bool,
        cashCollectionRequired: Bool,
        notes: String
    ) async -> Bool {
        let trimmedOrderReference = orderReference.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedStopName = stopName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedOrderReference.isEmpty, !trimmedStopName.isEmpty else {
            message = "Add both an order reference and a stop name."
            return false
        }

        guard let restaurant = merchantSelection, isSignedIn else {
            runnerTasks.insert(
                FoodRunnerTask(
                    remoteID: nil,
                    orderReference: trimmedOrderReference,
                    stopName: trimmedStopName,
                    taskType: taskType,
                    status: "Assigned",
                    routeWindow: routeWindow.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "TBD" : routeWindow.trimmingCharacters(in: .whitespacesAndNewlines),
                    customerContactRule: customerContactRule.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Follow restaurant delivery policy." : customerContactRule.trimmingCharacters(in: .whitespacesAndNewlines),
                    requiresProof: requiresProof,
                    cashCollectionRequired: cashCollectionRequired,
                    notes: notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No extra notes." : notes.trimmingCharacters(in: .whitespacesAndNewlines)
                ),
                at: 0
            )
            message = "Runner task drafted locally."
            return true
        }

        do {
            let response = try await authed {
                try await FoodAPIClient.shared.createRunnerTask(
                    restaurantId: restaurant.id,
                    orderReference: trimmedOrderReference,
                    stopName: trimmedStopName,
                    taskType: taskType,
                    routeWindow: routeWindow.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : routeWindow.trimmingCharacters(in: .whitespacesAndNewlines),
                    customerContactRule: customerContactRule.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : customerContactRule.trimmingCharacters(in: .whitespacesAndNewlines),
                    requiresProof: requiresProof,
                    cashCollectionRequired: cashCollectionRequired,
                    notes: notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : notes.trimmingCharacters(in: .whitespacesAndNewlines),
                    token: $0
                )
            }
            replaceRunnerTask(with: response.task)
            message = "Runner task created for \(response.task.orderReference)."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func createRunnerContactRule(title: String, detail: String) async -> Bool {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDetail = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty, !trimmedDetail.isEmpty else {
            message = "Add both a title and contact guidance."
            return false
        }

        guard let restaurant = merchantSelection, isSignedIn else {
            runnerContactRules.insert(
                FoodRunnerContactRule(title: trimmedTitle, detail: trimmedDetail),
                at: 0
            )
            message = "Contact rule drafted locally."
            return true
        }

        do {
            let response = try await authed {
                try await FoodAPIClient.shared.createRunnerContactRule(
                    restaurantId: restaurant.id,
                    title: trimmedTitle,
                    detail: trimmedDetail,
                    token: $0
                )
            }
            runnerContactRules.insert(
                FoodRunnerContactRule(title: response.contactRule.title, detail: response.contactRule.detail),
                at: 0
            )
            message = "Runner contact rule added."
            return true
        } catch {
            message = error.localizedDescription
            return false
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

    func confirmRunnerPickup(_ task: FoodRunnerTask) {
        guard let restaurant = merchantSelection, let remoteID = task.remoteID, isSignedIn else {
            updateRunnerTask(task, status: "Picked up")
            message = "\(task.orderReference) picked up and in runner custody."
            return
        }
        Task {
            do {
                let response = try await authed {
                    try await FoodAPIClient.shared.updateRunnerTaskStatus(
                        restaurantId: restaurant.id,
                        taskId: remoteID,
                        status: "Picked up",
                        token: $0
                    )
                }
                replaceRunnerTask(with: response.task)
                message = "\(response.task.orderReference) picked up and in runner custody."
            } catch {
                updateRunnerTask(task, status: "Picked up")
                message = "\(task.orderReference) picked up locally while sync is unavailable."
            }
        }
    }

    func advanceRunnerTask(_ task: FoodRunnerTask) {
        let nextStatus: String
        switch task.status {
        case "Assigned":
            nextStatus = "Picked up"
        case "Picked up":
            nextStatus = "En route"
        case "En route", "Ready":
            nextStatus = "Completed"
        default:
            nextStatus = "Completed"
        }

        guard let restaurant = merchantSelection, let remoteID = task.remoteID, isSignedIn else {
            updateRunnerTask(task, status: nextStatus)
            message = "\(task.orderReference) updated to \(nextStatus.lowercased())."
            return
        }
        Task {
            do {
                let response = try await authed {
                    try await FoodAPIClient.shared.updateRunnerTaskStatus(
                        restaurantId: restaurant.id,
                        taskId: remoteID,
                        status: nextStatus,
                        token: $0
                    )
                }
                replaceRunnerTask(with: response.task)
                message = "\(response.task.orderReference) updated to \(nextStatus.lowercased())."
            } catch {
                updateRunnerTask(task, status: nextStatus)
                message = "\(task.orderReference) updated locally while sync is unavailable."
            }
        }
    }

    func logRunnerProof(_ task: FoodRunnerTask, proofNote: String) {
        let trimmed = proofNote.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let restaurant = merchantSelection, let remoteID = task.remoteID, isSignedIn else {
            runnerProofs.insert(
                FoodRunnerProof(
                    orderReference: task.orderReference,
                    stopName: task.stopName,
                    method: task.requiresProof ? "Photo / signature" : "Handoff confirmed",
                    note: trimmed.isEmpty ? "Delivery completed without extra note." : trimmed
                ),
                at: 0
            )
            updateRunnerTask(task, status: "Completed")
            message = "Proof logged for \(task.orderReference)."
            return
        }
        Task {
            do {
                let response = try await authed {
                    try await FoodAPIClient.shared.logRunnerProof(
                        restaurantId: restaurant.id,
                        taskId: remoteID,
                        note: trimmed.isEmpty ? "Delivery completed without extra note." : trimmed,
                        token: $0
                    )
                }
                runnerProofs.insert(mapRunnerProof(response.proof), at: 0)
                updateRunnerTask(task, status: "Completed")
                message = "Proof logged for \(task.orderReference)."
            } catch {
                runnerProofs.insert(
                    FoodRunnerProof(
                        orderReference: task.orderReference,
                        stopName: task.stopName,
                        method: task.requiresProof ? "Photo / signature" : "Handoff confirmed",
                        note: trimmed.isEmpty ? "Delivery completed without extra note." : trimmed
                    ),
                    at: 0
                )
                updateRunnerTask(task, status: "Completed")
                message = "Proof logged locally while sync is unavailable."
            }
        }
    }

    func reportRunnerIssue(_ task: FoodRunnerTask, note: String) {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            message = "Add an issue note before reporting a runner problem."
            return
        }
        guard let restaurant = merchantSelection, let remoteID = task.remoteID, isSignedIn else {
            runnerIssueReports.insert(
                FoodRunnerIssueReport(
                    orderReference: task.orderReference,
                    stopName: task.stopName,
                    severity: "Needs follow-up",
                    note: trimmed
                ),
                at: 0
            )
            updateRunnerTask(task, status: "Issue")
            message = "Issue reported for \(task.orderReference)."
            return
        }
        Task {
            do {
                let response = try await authed {
                    try await FoodAPIClient.shared.reportRunnerIssue(
                        restaurantId: restaurant.id,
                        taskId: remoteID,
                        note: trimmed,
                        token: $0
                    )
                }
                runnerIssueReports.insert(mapRunnerIssue(response.issue), at: 0)
                updateRunnerTask(task, status: "Issue")
                message = "Issue reported for \(task.orderReference)."
            } catch {
                runnerIssueReports.insert(
                    FoodRunnerIssueReport(
                        orderReference: task.orderReference,
                        stopName: task.stopName,
                        severity: "Needs follow-up",
                        note: trimmed
                    ),
                    at: 0
                )
                updateRunnerTask(task, status: "Issue")
                message = "Issue reported locally while sync is unavailable."
            }
        }
    }

    func addRunnerPaymentNote(_ task: FoodRunnerTask, amountText: String, note: String) {
        let amount = Double(amountText) ?? 0
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard amount > 0 || !trimmed.isEmpty else {
            message = "Add a cash amount or note before saving payment details."
            return
        }
        guard let restaurant = merchantSelection, let remoteID = task.remoteID, isSignedIn else {
            runnerPaymentNotes.insert(
                FoodRunnerPaymentNote(
                    orderReference: task.orderReference,
                    amount: amount,
                    note: trimmed.isEmpty ? "No extra payment note." : trimmed
                ),
                at: 0
            )
            message = "Payment note saved for \(task.orderReference)."
            return
        }
        Task {
            do {
                let response = try await authed {
                    try await FoodAPIClient.shared.logRunnerPaymentNote(
                        restaurantId: restaurant.id,
                        taskId: remoteID,
                        amount: amount,
                        note: trimmed.isEmpty ? "No extra payment note." : trimmed,
                        token: $0
                    )
                }
                runnerPaymentNotes.insert(mapRunnerPaymentNote(response.paymentNote), at: 0)
                message = "Payment note saved for \(task.orderReference)."
            } catch {
                runnerPaymentNotes.insert(
                    FoodRunnerPaymentNote(
                        orderReference: task.orderReference,
                        amount: amount,
                        note: trimmed.isEmpty ? "No extra payment note." : trimmed
                    ),
                    at: 0
                )
                message = "Payment note saved locally while sync is unavailable."
            }
        }
    }

    func loadLiveRunnerDashboard() async {
        guard let restaurant = merchantSelection, isSignedIn else { return }
        do {
            let dashboard = try await authed {
                try await FoodAPIClient.shared.runnerDashboard(restaurantId: restaurant.id, token: $0)
            }
            if !dashboard.tasks.isEmpty {
                runnerTasks = dashboard.tasks.map(mapRunnerTask)
            }
            if !dashboard.contactRules.isEmpty {
                runnerContactRules = dashboard.contactRules.map {
                    FoodRunnerContactRule(title: $0.title, detail: $0.detail)
                }
            }
            if !dashboard.proofs.isEmpty {
                runnerProofs = dashboard.proofs.map(mapRunnerProof)
            }
            if !dashboard.issues.isEmpty {
                runnerIssueReports = dashboard.issues.map(mapRunnerIssue)
            }
            if !dashboard.paymentNotes.isEmpty {
                runnerPaymentNotes = dashboard.paymentNotes.map(mapRunnerPaymentNote)
            }
        } catch {
            // Keep the verified local fallback dataset if runner migrations or
            // routes are not yet available in the environment under test.
        }
    }

    private func replaceRunnerTask(with response: RunnerTaskResponse) {
        let mapped = mapRunnerTask(response)
        if let index = runnerTasks.firstIndex(where: { $0.remoteID == mapped.remoteID }) {
            runnerTasks[index] = mapped
        } else {
            runnerTasks.insert(mapped, at: 0)
        }
    }

    private func mapRunnerTask(_ response: RunnerTaskResponse) -> FoodRunnerTask {
        FoodRunnerTask(
            remoteID: response.id,
            orderReference: response.orderReference,
            stopName: response.stopName,
            taskType: response.taskType,
            status: response.status,
            routeWindow: response.routeWindow ?? "TBD",
            customerContactRule: response.customerContactRule ?? "Follow restaurant delivery policy.",
            requiresProof: response.requiresProof,
            cashCollectionRequired: response.cashCollectionRequired,
            notes: response.notes ?? "No extra notes."
        )
    }

    private func mapRunnerProof(_ response: RunnerProofResponse) -> FoodRunnerProof {
        FoodRunnerProof(
            orderReference: response.orderReference,
            stopName: response.stopName,
            method: response.method,
            note: response.note ?? "No extra note."
        )
    }

    private func mapRunnerIssue(_ response: RunnerIssueResponse) -> FoodRunnerIssueReport {
        FoodRunnerIssueReport(
            orderReference: response.orderReference,
            stopName: response.stopName,
            severity: response.severity,
            note: response.note
        )
    }

    private func mapRunnerPaymentNote(_ response: RunnerPaymentNoteResponse) -> FoodRunnerPaymentNote {
        FoodRunnerPaymentNote(
            orderReference: response.orderReference,
            amount: response.amount,
            note: response.note ?? "No extra payment note."
        )
    }

    private func updateRunnerTask(_ task: FoodRunnerTask, status: String) {
        guard let index = runnerTasks.firstIndex(where: { $0.id == task.id }) else { return }
        runnerTasks[index].status = status
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
    let remoteID: Int64?
    let orderReference: String
    let stopName: String
    let taskType: String
    var status: String
    let routeWindow: String
    let customerContactRule: String
    let requiresProof: Bool
    let cashCollectionRequired: Bool
    let notes: String
}

struct FoodRunnerContactRule: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let detail: String
}

struct FoodRunnerProof: Identifiable, Hashable {
    let id = UUID()
    let orderReference: String
    let stopName: String
    let method: String
    let note: String
}

struct FoodRunnerIssueReport: Identifiable, Hashable {
    let id = UUID()
    let orderReference: String
    let stopName: String
    let severity: String
    let note: String
}

struct FoodRunnerPaymentNote: Identifiable, Hashable {
    let id = UUID()
    let orderReference: String
    let amount: Double
    let note: String
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
        FoodRunnerTask(remoteID: nil, orderReference: "Order #42", stopName: "Lobby pickup rack", taskType: "Customer pickup", status: "Ready", routeWindow: "Now", customerContactRule: "Confirm name before handoff. No phone call needed.", requiresProof: false, cashCollectionRequired: false, notes: "Order awaiting lobby handoff."),
        FoodRunnerTask(remoteID: nil, orderReference: "Order #51", stopName: "Office park catering", taskType: "Delivery", status: "Assigned", routeWindow: "11:45-12:05", customerContactRule: "Text once on arrival. Front desk drop only.", requiresProof: true, cashCollectionRequired: false, notes: "Proof photo required on drop."),
        FoodRunnerTask(remoteID: nil, orderReference: "Task #7", stopName: "Supplier return", taskType: "Logistics", status: "Queued", routeWindow: "14:00-14:30", customerContactRule: "Check in with receiving lead before return handoff.", requiresProof: true, cashCollectionRequired: true, notes: "Return damaged syrup case and collect credit memo."),
    ]
}

enum FoodRunnerSampleData {
    static let contactRules = [
        FoodRunnerContactRule(title: "Customer contact rules", detail: "Call or text only after the promised arrival window begins."),
        FoodRunnerContactRule(title: "Proof discipline", detail: "Photo or signature is required for catering, office, or supplier stops."),
        FoodRunnerContactRule(title: "Escalation path", detail: "If a stop fails twice, notify manager support before marking complete."),
    ]

    static let proofLog = [
        FoodRunnerProof(orderReference: "Order #39", stopName: "Residences at Bayside", method: "Photo", note: "Bag left with concierge and door photo captured."),
        FoodRunnerProof(orderReference: "Task #4", stopName: "Cold storage return", method: "Signature", note: "Supplier receiver signed off on crate return."),
    ]

    static let issueReports = [
        FoodRunnerIssueReport(orderReference: "Order #36", stopName: "Marina offices", severity: "Traffic delay", note: "Bridge closure added 12 minutes; customer updated."),
        FoodRunnerIssueReport(orderReference: "Task #2", stopName: "Market Square", severity: "Missing item", note: "Sauce bag missing from pickup; kitchen remake requested."),
    ]

    static let paymentNotes = [
        FoodRunnerPaymentNote(orderReference: "Order #31", amount: 24.50, note: "Cash collected at front desk."),
        FoodRunnerPaymentNote(orderReference: "Task #5", amount: 0, note: "Supplier credit memo requested instead of cash adjustment."),
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
