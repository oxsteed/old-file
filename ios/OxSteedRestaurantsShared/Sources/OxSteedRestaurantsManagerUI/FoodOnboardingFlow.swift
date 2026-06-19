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

// MARK: - Journey steps

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

    /// Short label on the journey spine.
    var spineLabel: String {
        switch self {
        case .welcome: return "Start"
        case .createRestaurant: return "Name"
        case .profile: return "Story"
        case .location: return "Place"
        case .hours: return "Hours"
        case .menu: return "Menu"
        case .publish: return "Live"
        case .devices: return "Floor"
        case .complete: return "Go"
        }
    }

    var icon: String {
        switch self {
        case .welcome: return "sparkles"
        case .createRestaurant: return "storefront.fill"
        case .profile: return "text.quote"
        case .location: return "mappin.and.ellipse"
        case .hours: return "clock.badge.checkmark"
        case .menu: return "fork.knife"
        case .publish: return "bolt.horizontal.fill"
        case .devices: return "ipad.and.iphone"
        case .complete: return "seal.fill"
        }
    }

    var accent: Color {
        switch self {
        case .welcome: return FoodTheme.flame
        case .createRestaurant: return FoodTheme.ember
        case .profile: return FoodTheme.grape
        case .location: return FoodTheme.blue
        case .hours: return FoodTheme.saffron
        case .menu: return FoodTheme.basil
        case .publish: return FoodTheme.flame
        case .devices: return FoodTheme.teal
        case .complete: return FoodTheme.basil
        }
    }

    var headline: String {
        switch self {
        case .welcome: return "Run the room."
        case .createRestaurant: return "What are we opening?"
        case .profile: return "Tell guests who you are."
        case .location: return "Put yourself on the map."
        case .hours: return "When do doors open?"
        case .menu: return "Plate something real."
        case .publish: return "Flip the sign to OPEN."
        case .devices: return "Wire the floor."
        case .complete: return "You're in service."
        }
    }

    var subhead: String {
        switch self {
        case .welcome:
            return "One guided path from empty kitchen to a live floor — kiosk, tickets, queue board, all talking."
        case .createRestaurant:
            return "Start with a name. Everything else can grow from here."
        case .profile:
            return "A line of personality goes a long way in Discover."
        case .location:
            return "City plus coordinates help nearby hungry people find you."
        case .hours:
            return "Set a rhythm for now — fine-tune per day later."
        case .menu:
            return "One honest item is enough to run your first real order."
        case .publish:
            return "Going live is the moment customers can actually find you."
        case .devices:
            return "Four checkboxes between you and a full service loop."
        case .complete:
            return "Guests order. Kitchen fires. The board tells the story."
        }
    }

    /// Steps shown on the horizontal journey (excludes terminal states).
    static var journeySteps: [FoodOwnerOnboardingStep] {
        [.welcome, .createRestaurant, .profile, .location, .hours, .menu, .publish, .devices]
    }
}

// MARK: - Owner onboarding — "Opening Night"

struct FoodOwnerOnboardingFlow: View {
    @EnvironmentObject private var store: FoodStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    @State private var step: FoodOwnerOnboardingStep = .welcome
    @State private var working = false
    @State private var appeared = false

    @State private var restaurantName = ""
    @State private var restaurantDescription = ""
    @State private var cuisineText = ""
    @State private var city = ""
    @State private var country = "US"
    @State private var currency = "USD"
    @State private var latitudeText = ""
    @State private var longitudeText = ""
    @State private var openTime = "11:00"
    @State private var closeTime = "22:00"
    @State private var menuItemName = ""
    @State private var menuItemPrice = ""

    @State private var deviceKioskInstalled = false
    @State private var deviceKitchenInstalled = false
    @State private var deviceQueueDisplay = false
    @State private var deviceTestOrder = false

    var body: some View {
        ZStack {
            OnboardingCanvas(accent: step.accent)
            VStack(spacing: 0) {
                topBar
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: FoodTheme.Space.xl) {
                        if step != .complete {
                            OnboardingJourneySpine(current: step)
                        }
                        sceneHero
                        stepContent
                            .id(step)
                            .transition(.asymmetric(
                                insertion: .opacity.combined(with: .move(edge: .trailing)),
                                removal: .opacity.combined(with: .move(edge: .leading))
                            ))
                    }
                    .padding(.horizontal, FoodTheme.Space.xl)
                    .padding(.bottom, 120)
                }
            }
            VStack {
                Spacer()
                bottomBar
            }
        }
        .preferredColorScheme(.dark)
        .task { await bootstrapStep() }
        .onAppear {
            withAnimation(.easeOut(duration: 0.55)) { appeared = true }
        }
    }

    // MARK: Chrome

    private var topBar: some View {
        HStack {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(FoodTheme.flame.opacity(0.2))
                        .frame(width: 36, height: 36)
                    Image(systemName: "flame.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(FoodTheme.flame)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text("Opening Night")
                        .font(.foodMicro)
                        .foregroundStyle(FoodTheme.shellMuted)
                    Text("OxSteed Restaurants")
                        .font(.foodCallout)
                        .foregroundStyle(FoodTheme.shellInk)
                }
            }
            Spacer()
            Button("Not now") {
                store.snoozeOwnerOnboarding()
                dismiss()
            }
            .font(.foodCaption)
            .foregroundStyle(FoodTheme.shellMuted)
        }
        .padding(.horizontal, FoodTheme.Space.xl)
        .padding(.vertical, FoodTheme.Space.lg)
    }

    private var sceneHero: some View {
        VStack(alignment: .leading, spacing: FoodTheme.Space.md) {
            ZStack {
                Circle()
                    .fill(step.accent.opacity(0.18))
                    .frame(width: 64, height: 64)
                    .blur(radius: 2)
                Image(systemName: step.icon)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(step.accent)
                    .symbolEffect(.bounce, value: step)
            }
            Text(step.headline)
                .font(.foodDisplay)
                .foregroundStyle(FoodTheme.shellInk)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 12)
            Text(step.subhead)
                .font(.foodBody)
                .foregroundStyle(FoodTheme.shellMuted)
                .fixedSize(horizontal: false, vertical: true)
            if let restaurant = store.merchantSelection, step != .welcome && step != .createRestaurant {
                HStack(spacing: 8) {
                    FoodBrandMark(name: restaurant.displayName, logoURL: restaurant.logoUrl, accent: step.accent, size: 32)
                    Text(restaurant.displayName)
                        .font(.foodCallout)
                        .foregroundStyle(FoodTheme.shellInk.opacity(0.9))
                }
                .padding(.top, 4)
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.82), value: step)
    }

    @ViewBuilder
    private var stepContent: some View {
        switch step {
        case .welcome: welcomeScene
        case .createRestaurant: formCard { createFields }
        case .profile: formCard { profileFields }
        case .location: formCard { locationFields }
        case .hours: formCard { hoursFields }
        case .menu: formCard { menuFields }
        case .publish: publishScene
        case .devices: devicesScene
        case .complete: completeScene
        }
    }

    private var bottomBar: some View {
        VStack(spacing: FoodTheme.Space.sm) {
            if working {
                ProgressView()
                    .tint(step.accent)
            }
            HStack(spacing: FoodTheme.Space.md) {
                if canGoBack {
                    Button("Back") { goBack() }
                        .buttonStyle(SecondaryActionButtonStyle(tint: FoodTheme.shellMuted, fullWidth: false))
                }
                Button(primaryButtonTitle) {
                    Task { await handlePrimaryAction() }
                }
                .buttonStyle(PrimaryActionButtonStyle(tint: step.accent))
                .disabled(working || !canAdvance)
            }
        }
        .padding(.horizontal, FoodTheme.Space.xl)
        .padding(.vertical, FoodTheme.Space.lg)
        .background(
            LinearGradient(
                colors: [FoodTheme.shellNavy.opacity(0), FoodTheme.shellNavy.opacity(0.92), FoodTheme.shellNavy],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        )
    }

    // MARK: Scenes

    private var welcomeScene: some View {
        VStack(alignment: .leading, spacing: FoodTheme.Space.lg) {
            HStack(spacing: FoodTheme.Space.md) {
                welcomeChip(icon: "rectangle.portrait.on.rectangle.portrait.angled", label: "Kiosk orders", tint: FoodTheme.grape)
                welcomeChip(icon: "flame.fill", label: "Kitchen tickets", tint: FoodTheme.coral)
            }
            welcomeChip(icon: "tv.fill", label: "Queue on the wall", tint: FoodTheme.blue)
            Text("Same OxSteed account on every tablet. No duplicate logins, no mystery.")
                .font(.foodCaption)
                .foregroundStyle(FoodTheme.faint)
        }
    }

    private func welcomeChip(icon: String, label: String, tint: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .background(tint.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            Text(label)
                .font(.foodCallout)
                .foregroundStyle(FoodTheme.shellInk.opacity(0.88))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FoodTheme.surface.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous)
                .stroke(Color.white.opacity(0.06), lineWidth: 1)
        )
    }

    private var publishScene: some View {
        VStack(spacing: FoodTheme.Space.xl) {
            ZStack {
                RoundedRectangle(cornerRadius: FoodTheme.Radius.xl, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: store.setupProgress?.readyToPublish == true
                                ? [FoodTheme.basil.opacity(0.35), FoodTheme.shellNavy]
                                : [FoodTheme.saffron.opacity(0.2), FoodTheme.shellNavy],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(height: 140)
                VStack(spacing: 8) {
                    Text(store.setupProgress?.readyToPublish == true ? "OPEN" : "CLOSED")
                        .font(.system(size: 44, weight: .black, design: .rounded))
                        .foregroundStyle(store.setupProgress?.readyToPublish == true ? FoodTheme.basil : FoodTheme.saffron)
                    Text(store.setupProgress?.readyToPublish == true ? "Ready for guests" : "Still setting up")
                        .font(.foodCaption)
                        .foregroundStyle(FoodTheme.shellMuted)
                }
            }
            if store.setupProgress?.readyToPublish != true, let next = store.setupProgress?.nextStepId {
                Text(hint(for: next))
                    .font(.foodBody)
                    .foregroundStyle(FoodTheme.saffron)
            }
        }
    }

    private var devicesScene: some View {
        VStack(spacing: FoodTheme.Space.md) {
            deviceCard(
                title: "Kiosk at the counter",
                detail: "Guests order without an account",
                icon: "hand.tap.fill",
                isOn: $deviceKioskInstalled
            )
            deviceCard(
                title: "Kitchen on the line",
                detail: "Tickets land in New — tap to advance",
                icon: "flame.fill",
                isOn: $deviceKitchenInstalled
            )
            deviceCard(
                title: "Queue on the wall",
                detail: "Kiosk → Queue tab faces the dining room",
                icon: "list.number",
                isOn: $deviceQueueDisplay
            )
            deviceCard(
                title: "One test order",
                detail: "Kiosk → Kitchen → board, end to end",
                icon: "arrow.triangle.2.circlepath",
                isOn: $deviceTestOrder
            )
            Text("ID \(store.merchantSelection?.id ?? 0) · keep handy for support")
                .font(.foodMicro)
                .foregroundStyle(FoodTheme.faint)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func deviceCard(title: String, detail: String, icon: String, isOn: Binding<Bool>) -> some View {
        Button {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.72)) {
                isOn.wrappedValue.toggle()
            }
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(isOn.wrappedValue ? FoodTheme.basil.opacity(0.22) : FoodTheme.surfaceRaised.opacity(0.6))
                        .frame(width: 48, height: 48)
                    Image(systemName: isOn.wrappedValue ? "checkmark" : icon)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(isOn.wrappedValue ? FoodTheme.basil : FoodTheme.shellMuted)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.foodSubhead)
                        .foregroundStyle(FoodTheme.shellInk)
                    Text(detail)
                        .font(.foodCaption)
                        .foregroundStyle(FoodTheme.shellMuted)
                }
                Spacer()
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                    .fill(isOn.wrappedValue ? FoodTheme.basil.opacity(0.08) : Color.white.opacity(0.04))
            )
            .overlay(
                RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                    .stroke(isOn.wrappedValue ? FoodTheme.basil.opacity(0.45) : Color.white.opacity(0.07), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var completeScene: some View {
        VStack(spacing: FoodTheme.Space.xl) {
            ZStack {
                Circle()
                    .fill(FoodTheme.basil.opacity(0.15))
                    .frame(width: 120, height: 120)
                    .blur(radius: 8)
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 56, weight: .bold))
                    .foregroundStyle(FoodTheme.basil)
            }
            .frame(maxWidth: .infinity)
            VStack(spacing: 8) {
                Text("First service is yours.")
                    .font(.foodTitle)
                    .foregroundStyle(FoodTheme.shellInk)
                Text("Come back to Manager anytime for menus, pauses, and reports.")
                    .font(.foodBody)
                    .foregroundStyle(FoodTheme.shellMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.vertical, FoodTheme.Space.xxl)
    }

    // MARK: Forms

    private func formCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: FoodTheme.Space.md) {
            content()
        }
        .padding(FoodTheme.Space.lg)
        .background(Color.white.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.xl, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.xl, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private var createFields: some View {
        Group {
            OnboardingField("Restaurant name", text: $restaurantName, accent: step.accent)
            OnboardingField("Short description", text: $restaurantDescription, accent: step.accent, axis: .vertical)
            OnboardingField("Cuisines · comma separated", text: $cuisineText, accent: step.accent)
            OnboardingField("City", text: $city, accent: step.accent)
            HStack(spacing: FoodTheme.Space.md) {
                OnboardingField("Country", text: $country, accent: step.accent)
                OnboardingField("Currency", text: $currency, accent: step.accent)
            }
        }
    }

    private var profileFields: some View {
        Group {
            OnboardingField("What makes this place yours?", text: $restaurantDescription, accent: step.accent, axis: .vertical)
            OnboardingField("Cuisine tags", text: $cuisineText, accent: step.accent)
        }
    }

    private var locationFields: some View {
        Group {
            OnboardingField("City", text: $city, accent: step.accent)
            OnboardingField("Latitude", text: $latitudeText, accent: step.accent, keyboard: .decimalPad)
            OnboardingField("Longitude", text: $longitudeText, accent: step.accent, keyboard: .decimalPad)
        }
    }

    private var hoursFields: some View {
        Group {
            HStack(spacing: FoodTheme.Space.md) {
                OnboardingField("Opens", text: $openTime, accent: step.accent)
                OnboardingField("Closes", text: $closeTime, accent: step.accent)
            }
            Text("Every day for now — you can split weekdays later.")
                .font(.foodMicro)
                .foregroundStyle(FoodTheme.faint)
        }
    }

    private var menuFields: some View {
        Group {
            if let count = store.setupProgress?.menuItemCount, count > 0 {
                FoodPill(text: "\(count) item\(count == 1 ? "" : "s") already live", systemImage: "checkmark", tint: FoodTheme.basil, filled: true)
            }
            OnboardingField("Dish name", text: $menuItemName, accent: step.accent)
            OnboardingField("Price · e.g. 8.99", text: $menuItemPrice, accent: step.accent, keyboard: .decimalPad)
            if !menuItemName.isEmpty, let price = Double(menuItemPrice.replacingOccurrences(of: ",", with: ".")) {
                menuPreview(name: menuItemName, price: price)
            }
        }
    }

    private func menuPreview(name: String, price: Double) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Preview")
                    .font(.foodMicro)
                    .foregroundStyle(FoodTheme.faint)
                Text(name)
                    .font(.foodSubhead)
                    .foregroundStyle(FoodTheme.shellInk)
            }
            Spacer()
            Text(String(format: "$%.2f", price))
                .font(.foodPrice)
                .foregroundStyle(FoodTheme.basil)
        }
        .padding(14)
        .background(FoodTheme.basil.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous))
    }

    // MARK: Navigation state

    private var canGoBack: Bool {
        step != .welcome && step != .complete
    }

    private var primaryButtonTitle: String {
        switch step {
        case .welcome: return "Begin opening night"
        case .createRestaurant: return "Create restaurant"
        case .publish: return store.setupProgress?.readyToPublish == true ? "Go live" : "Continue"
        case .devices: return "Floor is ready"
        case .complete: return "Enter Manager"
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
        case .publish:
            return store.setupProgress?.readyToPublish == true || store.merchantSelection?.status == "active"
        default:
            return true
        }
    }

    private func goBack() {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.86)) {
            step = previousStep()
        }
    }

    private func advance(to next: FoodOwnerOnboardingStep) {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.86)) {
            step = next
        }
    }

    // MARK: Logic (unchanged)

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

    private func handlePrimaryAction() async {
        working = true
        defer { working = false }

        switch step {
        case .welcome:
            advance(to: store.merchantRestaurants.isEmpty ? .createRestaurant : initialStep())
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
                advance(to: .profile)
            }
        case .profile:
            if await store.updateRestaurantProfile(
                description: restaurantDescription,
                cuisineTags: cuisineText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            ) {
                await refreshProgress()
                advance(to: .location)
            }
        case .location:
            let lat = Double(latitudeText.trimmingCharacters(in: .whitespaces))
            let lng = Double(longitudeText.trimmingCharacters(in: .whitespaces))
            if await store.updateRestaurantLocation(city: city, latitude: lat, longitude: lng) {
                await refreshProgress()
                advance(to: .hours)
            }
        case .hours:
            if await store.updateRestaurantHours(open: openTime, close: closeTime) {
                await refreshProgress()
                advance(to: .menu)
            }
        case .menu:
            if (store.setupProgress?.menuItemCount ?? 0) == 0 {
                guard await store.addMenuItem(name: menuItemName, priceText: menuItemPrice, categoryName: "Menu") else { return }
            }
            await refreshProgress()
            advance(to: .publish)
        case .publish:
            if store.merchantSelection?.status == "active" {
                advance(to: .devices)
            } else if store.setupProgress?.readyToPublish == true {
                await goLive()
            }
        case .devices:
            if let id = store.merchantSelection?.id {
                FoodOnboardingPreferences.markDeviceSetupComplete(restaurantId: id)
            }
            advance(to: .complete)
        case .complete:
            store.showOwnerOnboarding = false
            dismiss()
        }
    }

    private func goLive() async {
        await store.setRestaurantStatus("active")
        if store.merchantSelection?.status == "active" {
            advance(to: .devices)
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

// MARK: - Onboarding components

private struct OnboardingCanvas: View {
    let accent: Color

    var body: some View {
        ZStack {
            FoodTheme.shellNavy.ignoresSafeArea()
            RadialGradient(
                colors: [accent.opacity(0.22), FoodTheme.shellNavy.opacity(0)],
                center: .topTrailing,
                startRadius: 20,
                endRadius: 340
            )
            .ignoresSafeArea()
            RadialGradient(
                colors: [FoodTheme.flame.opacity(0.12), .clear],
                center: .bottomLeading,
                startRadius: 10,
                endRadius: 280
            )
            .ignoresSafeArea()
        }
    }
}

private struct OnboardingJourneySpine: View {
    let current: FoodOwnerOnboardingStep

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(FoodOwnerOnboardingStep.journeySteps) { item in
                    let active = item.rawValue <= current.rawValue
                    let isCurrent = item == current
                    VStack(spacing: 6) {
                        ZStack {
                            Circle()
                                .fill(isCurrent ? item.accent : (active ? item.accent.opacity(0.25) : Color.white.opacity(0.06)))
                                .frame(width: isCurrent ? 34 : 28, height: isCurrent ? 34 : 28)
                            if active && !isCurrent {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 10, weight: .black))
                                    .foregroundStyle(item.accent)
                            } else {
                                Image(systemName: item.icon)
                                    .font(.system(size: isCurrent ? 13 : 11, weight: .bold))
                                    .foregroundStyle(isCurrent ? Color.white : FoodTheme.faint)
                            }
                        }
                        Text(item.spineLabel)
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(isCurrent ? item.accent : FoodTheme.faint)
                    }
                    .animation(.spring(response: 0.35, dampingFraction: 0.8), value: current)
                }
            }
            .padding(.vertical, 4)
        }
    }
}

private struct OnboardingField: View {
    let label: String
    @Binding var text: String
    var accent: Color = FoodTheme.flame
    var axis: Axis = .horizontal
    var keyboard: UIKeyboardType = .default
    @FocusState private var focused: Bool

    init(
        _ label: String,
        text: Binding<String>,
        accent: Color = FoodTheme.flame,
        axis: Axis = .horizontal,
        keyboard: UIKeyboardType = .default
    ) {
        self.label = label
        self._text = text
        self.accent = accent
        self.axis = axis
        self.keyboard = keyboard
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.foodMicro)
                .foregroundStyle(FoodTheme.faint)
            Group {
                if axis == .vertical {
                    TextField(label, text: $text, axis: .vertical)
                        .lineLimit(3...6)
                } else {
                    TextField(label, text: $text)
                }
            }
            .font(.foodBody)
            .foregroundStyle(FoodTheme.shellInk)
            .keyboardType(keyboard)
            .focused($focused)
            .padding(14)
            .background(FoodTheme.surfaceSunken.opacity(0.85))
            .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous)
                    .stroke(focused ? accent.opacity(0.75) : Color.white.opacity(0.08), lineWidth: focused ? 2 : 1)
            )
        }
    }
}
