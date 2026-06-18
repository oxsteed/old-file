import SwiftUI

// MARK: - Preferences

enum FoodOnboardingPreferences {
    private static func devicesKey(_ restaurantId: Int64) -> String {
        "ox.food.onboarding.devices.\(restaurantId)"
    }

    static func isDeviceSetupComplete(restaurantId: Int64) -> Bool {
        UserDefaults.standard.bool(forKey: devicesKey(restaurantId))
    }

    static func markDeviceSetupComplete(restaurantId: Int64) {
        UserDefaults.standard.set(true, forKey: devicesKey(restaurantId))
    }

    static func isKitchenHintDismissed() -> Bool {
        UserDefaults.standard.bool(forKey: "ox.food.onboarding.kitchenHintDismissed")
    }

    static func dismissKitchenHint() {
        UserDefaults.standard.set(true, forKey: "ox.food.onboarding.kitchenHintDismissed")
    }
}

// MARK: - Operating hours payload

struct FoodOperatingHoursPayload: Encodable {
    struct DayHours: Encodable {
        let open: String
        let close: String
    }

    let weekly: [String: DayHours]

    static func sameEveryDay(open: String, close: String) -> FoodOperatingHoursPayload {
        let day = DayHours(open: open, close: close)
        return FoodOperatingHoursPayload(weekly: [
            "mon": day, "tue": day, "wed": day, "thu": day,
            "fri": day, "sat": day, "sun": day,
        ])
    }
}

struct RestaurantPatch: Encodable {
    var description: String?
    var cuisineTags: [String]?
    var addressCity: String?
    var latitude: Double?
    var longitude: Double?
    var operatingHours: FoodOperatingHoursPayload?
    var acceptsInStoreOrders: Bool?
    var acceptsOnlineOrders: Bool?
    var status: String?

    enum CodingKeys: String, CodingKey {
        case description
        case cuisineTags
        case addressCity
        case latitude
        case longitude
        case operatingHours
        case acceptsInStoreOrders
        case acceptsOnlineOrders
        case status
    }
}

// MARK: - Owner onboarding wizard

enum FoodOwnerOnboardingStep: Int, CaseIterable, Identifiable {
    case welcome
    case createRestaurant
    case profile
    case location
    case hours
    case menu
    case publish
    case devices
    case complete

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .welcome: return "Welcome"
        case .createRestaurant: return "Your restaurant"
        case .profile: return "Profile"
        case .location: return "Location"
        case .hours: return "Hours"
        case .menu: return "Menu"
        case .publish: return "Go live"
        case .devices: return "Floor devices"
        case .complete: return "You're ready"
        }
    }
}

struct FoodOwnerOnboardingFlow: View {
    @EnvironmentObject private var store: FoodStore
    @Environment(\.dismiss) private var dismiss

    @State private var step: FoodOwnerOnboardingStep = .welcome
    @State private var working = false

    // Create / profile
    @State private var restaurantName = ""
    @State private var restaurantDescription = ""
    @State private var cuisineText = ""
    @State private var city = ""
    @State private var country = "US"
    @State private var currency = "USD"

    // Location coords
    @State private var latitudeText = ""
    @State private var longitudeText = ""

    // Hours
    @State private var openTime = "11:00"
    @State private var closeTime = "22:00"

    // Menu
    @State private var menuItemName = ""
    @State private var menuItemPrice = ""

    // Device checklist
    @State private var deviceKioskInstalled = false
    @State private var deviceKitchenInstalled = false
    @State private var deviceQueueDisplay = false
    @State private var deviceTestOrder = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    progressHeader
                    stepContent
                    navigationButtons
                }
                .padding(20)
            }
            .background(FoodTheme.background.ignoresSafeArea())
            .navigationTitle("Restaurant setup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Later") {
                        store.snoozeOwnerOnboarding()
                        dismiss()
                    }
                }
            }
            .task { await bootstrapStep() }
        }
    }

    private var progressHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(step.title)
                .font(.system(size: 28, weight: .black, design: .rounded))
                .foregroundStyle(FoodTheme.ink)
            if let restaurant = store.merchantSelection {
                Text(restaurant.displayName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(FoodTheme.muted)
            }
            if let progress = store.setupProgress, store.merchantSelection?.status != "active" {
                let done = progress.steps.filter { $0.id != "publish" && $0.complete }.count
                Text("\(done) of 4 setup steps complete")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FoodTheme.basil)
            }
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch step {
        case .welcome:
            welcomeStep
        case .createRestaurant:
            createRestaurantStep
        case .profile:
            profileStep
        case .location:
            locationStep
        case .hours:
            hoursStep
        case .menu:
            menuStep
        case .publish:
            publishStep
        case .devices:
            devicesStep
        case .complete:
            completeStep
        }
    }

    private var welcomeStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Set up your restaurant in a few minutes.")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(FoodTheme.ink)
            Text("You'll add your menu, go live, then connect the Kiosk and Kitchen apps so guests can order and cooks see tickets.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
            Label("Use the same OxSteed account on every staff device.", systemImage: "person.2.fill")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(FoodTheme.blue)
        }
        .foodCard(padding: 16)
    }

    private var createRestaurantStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Restaurant name", text: $restaurantName)
                .textFieldStyle(.roundedBorder)
            TextField("Short description", text: $restaurantDescription, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            TextField("Cuisines (comma separated)", text: $cuisineText)
                .textFieldStyle(.roundedBorder)
            TextField("City", text: $city)
                .textFieldStyle(.roundedBorder)
            HStack {
                TextField("Country", text: $country)
                    .textFieldStyle(.roundedBorder)
                TextField("Currency", text: $currency)
                    .textFieldStyle(.roundedBorder)
            }
        }
        .foodCard(padding: 16)
    }

    private var profileStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Help customers recognize you in Discover.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
            TextField("Description", text: $restaurantDescription, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            TextField("Cuisines (comma separated)", text: $cuisineText)
                .textFieldStyle(.roundedBorder)
        }
        .foodCard(padding: 16)
    }

    private var locationStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Set your city and map coordinates so nearby customers find you.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
            TextField("City", text: $city)
                .textFieldStyle(.roundedBorder)
            TextField("Latitude (e.g. 25.7617)", text: $latitudeText)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
            TextField("Longitude (e.g. -80.1918)", text: $longitudeText)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
        }
        .foodCard(padding: 16)
    }

    private var hoursStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Same hours every day for now — you can customize later in Settings.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
            TextField("Opens", text: $openTime)
                .textFieldStyle(.roundedBorder)
            TextField("Closes", text: $closeTime)
                .textFieldStyle(.roundedBorder)
        }
        .foodCard(padding: 16)
    }

    private var menuStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Add at least one item so guests can place an order.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
            if let count = store.setupProgress?.menuItemCount, count > 0 {
                Label("\(count) menu item(s) on your menu", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(FoodTheme.basil)
            }
            TextField("Item name", text: $menuItemName)
                .textFieldStyle(.roundedBorder)
            TextField("Price (e.g. 8.99)", text: $menuItemPrice)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
        }
        .foodCard(padding: 16)
    }

    private var publishStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            if store.setupProgress?.readyToPublish == true {
                Text("Everything is ready. Going live makes your restaurant visible to customers.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
                Button {
                    Task { await goLive() }
                } label: {
                    Label("Go live now", systemImage: "bolt.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(FoodTheme.basil)
                .disabled(working)
            } else {
                Text("Complete the previous steps before going live.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(FoodTheme.saffron)
                if let next = store.setupProgress?.nextStepId {
                    Text(hint(for: next))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                }
            }
        }
        .foodCard(padding: 16)
    }

    private var devicesStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Install these TestFlight apps on your in-store tablets:")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
            deviceRow(
                title: "OxSteed Restaurants Kiosk",
                detail: "Guest self-ordering + Queue tab for the waiting-area TV",
                isOn: $deviceKioskInstalled
            )
            deviceRow(
                title: "OxSteed Restaurants Kitchen",
                detail: "Sign in as staff — tickets appear in New → tap to Preparing → Ready",
                isOn: $deviceKitchenInstalled
            )
            deviceRow(
                title: "Queue display running",
                detail: "On Kiosk app, open the Queue tab on your dining-room tablet",
                isOn: $deviceQueueDisplay
            )
            deviceRow(
                title: "Test order completed",
                detail: "Place one order on Kiosk and advance it on Kitchen",
                isOn: $deviceTestOrder
            )
            Text("Restaurant ID for support: \(store.merchantSelection?.id ?? 0)")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
        }
        .foodCard(padding: 16)
    }

    private func deviceRow(title: String, detail: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(FoodTheme.ink)
                Text(detail)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
            }
        }
        .tint(FoodTheme.basil)
    }

    private var completeStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Your restaurant floor is configured.", systemImage: "party.popper.fill")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(FoodTheme.basil)
            Text("Guests can order from the Kiosk. Kitchen sees tickets. The queue board shows Preparing and Ready numbers.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
        }
        .foodCard(padding: 16)
    }

    private var navigationButtons: some View {
        HStack(spacing: 12) {
            if step != .welcome && step != .complete {
                Button("Back") { step = previousStep() }
                    .buttonStyle(.bordered)
            }
            Spacer()
            Button(primaryButtonTitle) {
                Task { await handlePrimaryAction() }
            }
            .buttonStyle(.borderedProminent)
            .tint(FoodTheme.flame)
            .disabled(working || !canAdvance)
        }
    }

    private var primaryButtonTitle: String {
        switch step {
        case .welcome: return "Get started"
        case .createRestaurant: return "Create restaurant"
        case .complete: return "Done"
        case .devices: return "Mark floor setup complete"
        default: return "Save & continue"
        }
    }

    private var canAdvance: Bool {
        switch step {
        case .createRestaurant:
            return !restaurantName.trimmingCharacters(in: .whitespaces).isEmpty
        case .menu:
            let hasItem = (store.setupProgress?.menuItemCount ?? 0) > 0
            return hasItem || (!menuItemName.isEmpty && !menuItemPrice.isEmpty)
        case .devices:
            return deviceKioskInstalled && deviceKitchenInstalled && deviceQueueDisplay && deviceTestOrder
        default:
            return true
        }
    }

    private func bootstrapStep() async {
        await store.loadMerchant()
        if store.merchantRestaurants.isEmpty {
            step = .welcome
            return
        }
        if let restaurant = store.merchantSelection {
            await store.loadSetupProgress(restaurantId: restaurant.id)
            restaurantDescription = restaurant.description ?? ""
            cuisineText = restaurant.cuisineTags.joined(separator: ", ")
            city = restaurant.addressCity ?? ""
        }
        step = initialStep()
    }

    private func initialStep() -> FoodOwnerOnboardingStep {
        if store.merchantRestaurants.isEmpty { return .welcome }
        guard let restaurant = store.merchantSelection else { return .createRestaurant }
        if restaurant.status != "active" {
            guard let next = store.setupProgress?.nextStepId else { return .publish }
            switch next {
            case "profile": return .profile
            case "location": return .location
            case "hours": return .hours
            case "menu": return .menu
            default: return .publish
            }
        }
        if !FoodOnboardingPreferences.isDeviceSetupComplete(restaurantId: restaurant.id) {
            return .devices
        }
        return .complete
    }

    private func previousStep() -> FoodOwnerOnboardingStep {
        FoodOwnerOnboardingStep(rawValue: max(0, step.rawValue - 1)) ?? .welcome
    }

    private func nextStep() -> FoodOwnerOnboardingStep {
        if step == .welcome && store.merchantRestaurants.isEmpty {
            return .createRestaurant
        }
        if step == .publish && store.merchantSelection?.status == "active" {
            return .devices
        }
        return FoodOwnerOnboardingStep(rawValue: min(FoodOwnerOnboardingStep.allCases.count - 1, step.rawValue + 1)) ?? .complete
    }

    private func handlePrimaryAction() async {
        working = true
        defer { working = false }

        switch step {
        case .welcome:
            step = store.merchantRestaurants.isEmpty ? .createRestaurant : initialStep()
        case .createRestaurant:
            if await store.publishRestaurant(
                name: restaurantName,
                description: restaurantDescription,
                cuisine: cuisineText,
                city: city,
                country: country,
                currency: currency
            ) {
                await store.loadSetupProgress(restaurantId: store.merchantSelection?.id ?? 0)
                step = .profile
            }
        case .profile:
            if await store.updateRestaurantProfile(
                description: restaurantDescription,
                cuisineTags: cuisineText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            ) {
                await refreshProgress()
                step = .location
            }
        case .location:
            let lat = Double(latitudeText.trimmingCharacters(in: .whitespaces))
            let lng = Double(longitudeText.trimmingCharacters(in: .whitespaces))
            if await store.updateRestaurantLocation(city: city, latitude: lat, longitude: lng) {
                await refreshProgress()
                step = .hours
            }
        case .hours:
            if await store.updateRestaurantHours(open: openTime, close: closeTime) {
                await refreshProgress()
                step = .menu
            }
        case .menu:
            if (store.setupProgress?.menuItemCount ?? 0) == 0 {
                guard await store.addMenuItem(name: menuItemName, priceText: menuItemPrice, categoryName: "Menu") else { return }
            }
            await refreshProgress()
            step = .publish
        case .publish:
            if store.merchantSelection?.status == "active" {
                step = .devices
            } else if store.setupProgress?.readyToPublish == true {
                await goLive()
            }
        case .devices:
            if let id = store.merchantSelection?.id {
                FoodOnboardingPreferences.markDeviceSetupComplete(restaurantId: id)
            }
            step = .complete
        case .complete:
            store.showOwnerOnboarding = false
            dismiss()
        }
    }

    private func goLive() async {
        await store.setRestaurantStatus("active")
        if store.merchantSelection?.status == "active" {
            step = .devices
        }
    }

    private func refreshProgress() async {
        if let id = store.merchantSelection?.id {
            await store.loadSetupProgress(restaurantId: id)
        }
    }

    private func hint(for stepId: String) -> String {
        switch stepId {
        case "profile": return "Add a description and cuisine tags."
        case "location": return "Set city and coordinates."
        case "hours": return "Configure operating hours."
        case "menu": return "Add at least one menu item."
        default: return "Complete remaining setup steps."
        }
    }
}
