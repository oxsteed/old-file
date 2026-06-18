import MapKit
import SwiftUI

enum FoodWorkspace: String, CaseIterable, Identifiable {
    case customerOrdering
    case ownerManager
    case posCounter
    case kitchenDisplay
    case kioskQueue
    case crewTraining
    case inventoryReceiving
    case deliveryRunner

    var id: String { rawValue }

    var title: String {
        switch self {
        case .customerOrdering: return "Customer Ordering"
        case .ownerManager: return "Owner / Manager"
        case .posCounter: return "POS / Counter"
        case .kitchenDisplay: return "Kitchen Display"
        case .kioskQueue: return "Kiosk + Queue"
        case .crewTraining: return "Crew Training + SOP"
        case .inventoryReceiving: return "Inventory + Receiving"
        case .deliveryRunner: return "Delivery / Runner"
        }
    }

    var subtitle: String {
        switch self {
        case .customerOrdering: return "Discovery, ordering, and live order tracking."
        case .ownerManager: return "Control center for menus, alerts, and growth."
        case .posCounter: return "Fast walk-in order entry and kitchen dispatch."
        case .kitchenDisplay: return "Prep flow, timing, and ticket accuracy."
        case .kioskQueue: return "Self-ordering and public queue visibility."
        case .crewTraining: return "Onboarding, SOPs, and shift checklists."
        case .inventoryReceiving: return "Counts, suppliers, and low-stock discipline."
        case .deliveryRunner: return "Runner tasks, handoff, and proof workflows."
        }
    }

    var icon: String {
        switch self {
        case .customerOrdering: return "takeoutbag.and.cup.and.straw.fill"
        case .ownerManager: return "chart.line.uptrend.xyaxis.circle.fill"
        case .posCounter: return "creditcard.and.123"
        case .kitchenDisplay: return "flame.fill"
        case .kioskQueue: return "rectangle.portrait.on.rectangle.portrait.angled.fill"
        case .crewTraining: return "checklist.checked"
        case .inventoryReceiving: return "shippingbox.fill"
        case .deliveryRunner: return "bicycle.circle.fill"
        }
    }

    var badge: String {
        switch self {
        case .customerOrdering, .ownerManager, .posCounter, .kitchenDisplay, .kioskQueue:
            return "Live"
        case .crewTraining, .inventoryReceiving, .deliveryRunner:
            return "Foundation"
        }
    }
}

struct FoodRuntimeConfig {
    let appName: String
    let allowedWorkspaces: [FoodWorkspace]
    let defaultWorkspace: FoodWorkspace

    static let current = FoodRuntimeConfig(bundle: .main)

    init(bundle: Bundle) {
        appName = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? "OxSteed Restaurants"

        let allowedRaw = bundle.object(forInfoDictionaryKey: "OX_ALLOWED_WORKSPACES") as? [String] ?? []
        let parsedAllowed = allowedRaw.compactMap(FoodWorkspace.init(rawValue:))
        allowedWorkspaces = parsedAllowed.isEmpty ? FoodWorkspace.allCases : parsedAllowed

        if
            let raw = bundle.object(forInfoDictionaryKey: "OX_DEFAULT_WORKSPACE") as? String,
            let parsed = FoodWorkspace(rawValue: raw),
            allowedWorkspaces.contains(parsed)
        {
            defaultWorkspace = parsed
        } else {
            defaultWorkspace = allowedWorkspaces.first ?? .customerOrdering
        }
    }
}

struct FoodRootView: View {
    @EnvironmentObject private var store: FoodStore
    @AppStorage("ox.food.workspace") private var workspaceRawValue = FoodWorkspace.customerOrdering.rawValue
    private let runtime = FoodRuntimeConfig.current

    private var workspace: FoodWorkspace {
        get {
            let parsed = FoodWorkspace(rawValue: workspaceRawValue) ?? runtime.defaultWorkspace
            return runtime.allowedWorkspaces.contains(parsed) ? parsed : runtime.defaultWorkspace
        }
        nonmutating set { workspaceRawValue = newValue.rawValue }
    }

    private var isDedicatedCustomerApp: Bool {
        runtime.allowedWorkspaces == [.customerOrdering]
    }

    var body: some View {
        Group {
            if isDedicatedCustomerApp {
                FoodRoleAppShell(
                    appName: "OxSteed",
                    roleTitle: "Restaurants",
                    roleSubtitle: "Customer Ordering",
                    accent: FoodTheme.flame,
                    logoURL: store.selectedRestaurant?.logoUrl ?? store.restaurants.first?.logoUrl,
                    contextLine: CustomerDaypart.current.greeting(store.customerLanguage),
                    liveState: .live
                ) {
                    ScrollView {
                        CustomerWorkspaceView()
                            .padding(.horizontal, 16)
                            .padding(.bottom, 8)
                            .foodDedicatedScrollPadding()
                    }
                }
            } else {
                ZStack {
                    FoodTheme.background.ignoresSafeArea()

                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            FoodWorkspaceHero(appName: runtime.appName, workspace: workspace)
                            if runtime.allowedWorkspaces.count > 1 {
                                FoodWorkspaceRail(
                                    workspaces: runtime.allowedWorkspaces,
                                    workspace: Binding(
                                        get: { workspace },
                                        set: { workspace = $0 }
                                    )
                                )
                            }

                            switch workspace {
                            case .customerOrdering:
                                CustomerWorkspaceView()
                            case .ownerManager:
                                OwnerManagerWorkspaceView()
                            case .posCounter:
                                POSCounterWorkspaceView()
                            case .kitchenDisplay:
                                KitchenDisplayWorkspaceView()
                            case .kioskQueue:
                                KioskQueueWorkspaceView()
                            case .crewTraining:
                                CrewTrainingWorkspaceView()
                            case .inventoryReceiving:
                                InventoryReceivingWorkspaceView()
                            case .deliveryRunner:
                                DeliveryRunnerWorkspaceView()
                            }
                        }
                        .padding(16)
                    }
                }
            }
        }
        .task {
            await store.loadRestaurants()
            store.refreshPendingOfflineOrders()
            await store.replayPendingOfflineOrders()
        }
        .onAppear {
            if !runtime.allowedWorkspaces.contains(workspace) {
                workspace = runtime.defaultWorkspace
            }
        }
        .fullScreenCover(item: confirmationBinding) { order in
            OrderConfirmationView(order: order)
        }
        .overlay(alignment: .bottom) {
            if let message = store.message {
                Text(message)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(FoodTheme.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(FoodTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(FoodTheme.line))
                    .padding(.bottom, 92)
                    .padding(.horizontal, 16)
                    .onTapGesture { store.message = nil }
            }
        }
    }

    private var confirmationBinding: Binding<FoodOrder?> {
        Binding(
            get: { store.lastPlacedOrder },
            set: { store.lastPlacedOrder = $0 }
        )
    }
}

private struct CustomerAppHero: View {
    @EnvironmentObject private var store: FoodStore
    @State private var animateAtmosphere = false
    let appName: String

    private var daypart: CustomerDaypart {
        .current
    }

    private var highlightedRestaurant: FoodRestaurant? {
        store.selectedRestaurant ?? store.favoriteRestaurants.first ?? store.restaurants.first
    }

    private var campaignMessages: [CustomerCampaignMessage] {
        [
            CustomerCampaignMessage(
                title: daypart.campaignTitle(store.customerLanguage),
                detail: daypart.campaignDetail(store.customerLanguage),
                icon: "bolt.fill"
            ),
            CustomerCampaignMessage(
                title: customerText(store.customerLanguage, "Rewards are live", "Tus recompensas estan activas", "Vos recompenses sont actives", "Rekonpans ou yo aktif"),
                detail: "\(store.loyaltySummary.points) " + customerText(store.customerLanguage, "points ready to turn into your next order.", "puntos listos para tu proximo pedido.", "points prets pour votre prochaine commande.", "pwen pare pou pwochen komann ou."),
                icon: "gift.fill"
            ),
            CustomerCampaignMessage(
                title: customerText(store.customerLanguage, "Order like a regular", "Pide como cliente habitual", "Commandez comme un habitue", "Komann tankou yon kliyan regilye"),
                detail: customerText(store.customerLanguage, "Favorites and one-tap reorders keep the nightly food run moving.", "Favoritos y reordenes rapidos mantienen el ritmo de la noche.", "Favoris et recommandations rapides gardent le rythme du soir.", "Favori ak rekòmann rapid kenbe vitès aswè a."),
                icon: "heart.fill"
            )
        ]
    }

    private var heroGradient: LinearGradient {
        LinearGradient(
            colors: daypart.gradientColors,
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(FoodTheme.basil)
                            .frame(width: 8, height: 8)
                        Text(daypart.badge(store.customerLanguage))
                            .font(.system(size: 12, weight: .black))
                            .textCase(.uppercase)
                            .tracking(1)
                            .foregroundStyle(.white.opacity(0.82))
                    }

                    Text(appName.replacingOccurrences(of: " Customer", with: ""))
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white.opacity(0.82))

                    Text(daypart.heroTitle(store.customerLanguage))
                    .font(.system(size: 38, weight: .black))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(daypart.heroDetail(store.customerLanguage))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.8))
                    .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 8) {
                    Label(customerText(store.customerLanguage, "Ready", "Listo", "Pret", "Pare"), systemImage: "checkmark.shield.fill")
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.white.opacity(0.14))
                        .clipShape(Capsule())

                    Text("\(max(store.favoriteRestaurants.count, 0))")
                        .font(.system(size: 30, weight: .black))
                        .foregroundStyle(.white)
                    Text(customerText(store.customerLanguage, "saved spots", "favoritos", "favoris", "favori"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.72))
                }
            }

            HStack(spacing: 10) {
                CustomerHeroBadge(
                    icon: "clock.badge.checkmark.fill",
                    label: daypart.readinessLabel(store.customerLanguage)
                )
                CustomerHeroBadge(
                    icon: "creditcard.trianglebadge.exclamationmark",
                    label: store.onlineCheckoutAvailable
                        ? customerText(store.customerLanguage, "Secure checkout", "Pago seguro", "Paiement securise", "Peman sekirize")
                        : customerText(store.customerLanguage, "Counter pay", "Pago en local", "Paiement sur place", "Peye sou plas")
                )
                CustomerHeroBadge(
                    icon: "heart.circle.fill",
                    label: customerText(store.customerLanguage, "Saved reorders", "Repetidos guardados", "Recommandes enregistrees", "Rekomann sove")
                )
            }

            CustomerCampaignTicker(messages: campaignMessages, style: .hero)

            HStack(spacing: 12) {
                CustomerHeroMetric(
                    eyebrow: customerText(store.customerLanguage, "Restaurants", "Restaurantes", "Restaurants", "Restoran"),
                    value: "\(store.restaurants.count)",
                    detail: customerText(store.customerLanguage, "available now", "disponibles", "disponibles", "disponib")
                )
                CustomerHeroMetric(
                    eyebrow: customerText(store.customerLanguage, "Perks", "Beneficios", "Avantages", "Avantaj"),
                    value: "\(store.loyaltySummary.points)",
                    detail: customerText(store.customerLanguage, "loyalty points", "puntos", "points", "pwen")
                )
            }

            if let restaurant = highlightedRestaurant {
                VStack(alignment: .leading, spacing: 8) {
                    Text(daypart.featuredLabel(store.customerLanguage))
                        .font(.system(size: 12, weight: .black))
                        .textCase(.uppercase)
                        .tracking(1)
                        .foregroundStyle(.white.opacity(0.7))
                    HStack(alignment: .center, spacing: 12) {
                        CustomerDishMotif(
                            palette: cuisinePalette(for: restaurant),
                            kind: .plate,
                            size: 58,
                            foreground: .white
                        )

                        VStack(alignment: .leading, spacing: 4) {
                            Text(restaurant.displayName)
                                .font(.system(size: 18, weight: .black))
                                .foregroundStyle(.white)
                            Text(restaurant.cuisineTags.isEmpty ? restaurant.locationLine : restaurant.cuisineTags.joined(separator: " • "))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.8))
                        }
                        Spacer()
                        Text("\(restaurant.prepTimeMin) min")
                            .font(.system(size: 13, weight: .black))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(.white.opacity(0.14))
                            .clipShape(Capsule())
                    }
                }
                .padding(16)
                .background(.white.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
        }
        .padding(22)
        .background(heroGradient)
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .overlay(alignment: .topTrailing) {
            CustomerBrandIllustration(style: .hero, animate: animateAtmosphere)
                .allowsHitTesting(false)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
        .onAppear {
            withAnimation(.easeInOut(duration: 4).repeatForever(autoreverses: true)) {
                animateAtmosphere = true
            }
        }
    }
}

private struct CustomerCampaignMessage: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let icon: String
}

private enum CustomerDaypart {
    case breakfast
    case lunch
    case afternoon
    case dinner
    case lateNight

    static var current: Self {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<11: return .breakfast
        case 11..<14: return .lunch
        case 14..<17: return .afternoon
        case 17..<22: return .dinner
        default: return .lateNight
        }
    }

    func greeting(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "Good morning", "Buenos dias", "Bonjour", "Bonjou")
        case .lunch, .afternoon:
            return customerText(language, "Good afternoon", "Buenas tardes", "Bon apres-midi", "Bon apremidi")
        case .dinner:
            return customerText(language, "Good evening", "Buenas noches", "Bonsoir", "Bon aswe")
        case .lateNight:
            return customerText(language, "Late-night run", "Pedido nocturno", "Commande tardive", "Komann lannuit")
        }
    }

    func badge(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "Breakfast ordering", "Pedidos de desayuno", "Commande petit-dejeuner", "Komann dejene")
        case .lunch:
            return customerText(language, "Lunch ordering", "Pedidos de almuerzo", "Commande dejeuner", "Komann midi")
        case .afternoon:
            return customerText(language, "Afternoon ordering", "Pedidos de tarde", "Commande apres-midi", "Komann apremidi")
        case .dinner:
            return customerText(language, "Dinner ordering", "Pedidos de cena", "Commande diner", "Komann dine")
        case .lateNight:
            return customerText(language, "Late-night ordering", "Pedidos nocturnos", "Commande tardive", "Komann lannuit")
        }
    }

    func heroTitle(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "Breakfast, handled.", "Desayuno, resuelto.", "Petit-dejeuner gere.", "Dejene, regle.")
        case .lunch:
            return customerText(language, "Lunch without the drift.", "Almuerzo sin perder tiempo.", "Dejeuner sans perdre de temps.", "Manje midi san pèdi tan.")
        case .afternoon:
            return customerText(language, "The next meal, faster.", "La proxima comida, mas rapido.", "Le prochain repas, plus vite.", "Pwochen repa a, pi vit.")
        case .dinner:
            return customerText(language, "Order dinner faster.", "Pide la cena mas rapido.", "Commandez le diner plus vite.", "Komann dine w pi vit.")
        case .lateNight:
            return customerText(language, "Late-night cravings, covered.", "Los antojos de noche, cubiertos.", "Les envies de nuit, gerees.", "Anvi lannuit yo, regle.")
        }
    }

    func heroDetail(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "Coffee runs, quick bites, and secure checkout built for the morning rush.", "Cafe, bocados rapidos y pago seguro pensados para la manana.", "Cafe, encas rapides et paiement securise pour le rythme du matin.", "Kafe, ti manje rapid, ak peman sekirize pou ritm maten an.")
        case .lunch:
            return customerText(language, "Quick picks, saved spots, and checkout tuned for the midday break.", "Selecciones rapidas, favoritos y pago pensados para el almuerzo.", "Selections rapides, favoris et paiement pour la pause de midi.", "Chwa rapid, favori, ak peman pou repo midi a.")
        case .afternoon:
            return customerText(language, "Saved spots, snacks, and one-tap reorder built for the in-between hours.", "Favoritos, snacks y reorden rapido para las horas intermedias.", "Favoris, encas et re-commandes rapides pour l'apres-midi.", "Favori, ti manje, ak rekòmann rapid pou lè apremidi yo.")
        case .dinner:
            return customerText(language, "Quick picks, saved spots, and secure checkout built for the nightly food run.", "Selecciones rapidas, favoritos y pago seguro para resolver la comida de la noche.", "Selections rapides, favoris et paiement securise pour gerer le diner du soir.", "Chwa rapid, favori, ak peman sekirize pou ede w regle manje aswè a.")
        case .lateNight:
            return customerText(language, "Reliable spots, favorites, and fast checkout ready for the late run.", "Lugares fiables, favoritos y pago rapido listos para la noche.", "Adresses fiables, favoris et paiement rapide pour la fin de soiree.", "Bon kote serye, favori, ak peman rapid pare pou lannuit.")
        }
    }

    func readinessLabel(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "Morning-ready", "Listo esta manana", "Pret ce matin", "Pare pou maten an")
        case .lunch:
            return customerText(language, "Lunch-ready", "Listo al mediodia", "Pret ce midi", "Pare pou midi")
        case .afternoon:
            return customerText(language, "Afternoon-ready", "Listo esta tarde", "Pret cet apres-midi", "Pare pou apremidi")
        case .dinner:
            return customerText(language, "Tonight-ready", "Listo esta noche", "Pret ce soir", "Pare pou aswè a")
        case .lateNight:
            return customerText(language, "Night-ready", "Listo esta noche", "Pret cette nuit", "Pare pou lannuit")
        }
    }

    func featuredLabel(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "Featured this morning", "Destacado esta manana", "A la une ce matin", "An vedèt maten an")
        case .lunch:
            return customerText(language, "Featured for lunch", "Destacado para almuerzo", "A la une pour dejeuner", "An vedèt pou midi")
        case .afternoon:
            return customerText(language, "Featured this afternoon", "Destacado esta tarde", "A la une cet apres-midi", "An vedèt apremidi a")
        case .dinner:
            return customerText(language, "Featured tonight", "Destacado de hoy", "A la une ce soir", "An vedèt aswè a")
        case .lateNight:
            return customerText(language, "Featured late-night", "Destacado de noche", "A la une tard ce soir", "An vedèt lannuit")
        }
    }

    func discoverTitle(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "What looks good this morning?", "Que se te antoja esta manana?", "Qu'est-ce qui vous tente ce matin ?", "Kisa ki bon pou maten an?")
        case .lunch:
            return customerText(language, "What's good for lunch?", "Que se ve bien para almorzar?", "Qu'est-ce qui marche pour le dejeuner ?", "Kisa ki bon pou midi?")
        case .afternoon:
            return customerText(language, "What's worth the next break?", "Que vale la proxima pausa?", "Qu'est-ce qui vaut la prochaine pause ?", "Kisa ki vo pwochen poz la?")
        case .dinner:
            return customerText(language, "Find tonight's order", "Encuentra tu pedido de hoy", "Trouvez votre commande ce soir", "Jwenn komann aswè a")
        case .lateNight:
            return customerText(language, "Find the late-night fix", "Encuentra el pedido de noche", "Trouvez la commande de fin de soiree", "Jwenn sa pou lannuit")
        }
    }

    func discoverDetail(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "Search by restaurant or cuisine, save the dependable morning spots, and reorder fast.", "Busca por restaurante o cocina, guarda los lugares fiables de la manana y repite rapido.", "Recherchez par restaurant ou cuisine, enregistrez les bonnes adresses du matin et recommandez vite.", "Chèche pa restoran oswa kalite manje, sove bon kote serye pou maten an, epi rekomanse vit.")
        case .lunch:
            return customerText(language, "Search by restaurant or cuisine, save your lunch regulars, and jump into a faster reorder.", "Busca por restaurante o cocina, guarda tus favoritos de almuerzo y vuelve a pedir mas rapido.", "Recherchez par restaurant ou cuisine, gardez vos adresses du midi et recommandez plus vite.", "Chèche pa restoran oswa kalite manje, sove favori midi ou yo, epi rekomanse pi vit.")
        case .afternoon:
            return customerText(language, "Search by restaurant or cuisine, save your snack stops, and keep the day moving.", "Busca por restaurante o cocina, guarda tus paradas de snack y sigue con el dia.", "Recherchez par restaurant ou cuisine, gardez vos pauses gourmandes et poursuivez la journee.", "Chèche pa restoran oswa kalite manje, sove ti kote ou pase yo, epi kontinye jounen an.")
        case .dinner:
            return customerText(language, "Search by restaurant or cuisine, save your go-to spots, and jump into a faster reorder.", "Busca por restaurante o cocina, guarda tus lugares favoritos y vuelve a pedir mas rapido.", "Recherchez par restaurant ou cuisine, enregistrez vos favoris et recommandez plus vite.", "Chèche pa restoran oswa kalite manje, sove kote ou renmen yo, epi rekomanse pi vit.")
        case .lateNight:
            return customerText(language, "Search by restaurant or cuisine, save your reliable spots, and order fast while it's still open.", "Busca por restaurante o cocina, guarda tus sitios fiables y pide rapido mientras sigan abiertos.", "Recherchez par restaurant ou cuisine, gardez vos adresses fiables et commandez vite tant que c'est ouvert.", "Chèche pa restoran oswa kalite manje, sove bon kote serye yo, epi komann vit pandan yo louvri toujou.")
        }
    }

    func spotlightTitle(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "Picked for this morning", "Elegidos para esta manana", "Choisis pour ce matin", "Chwazi pou maten an")
        case .lunch:
            return customerText(language, "Picked for lunch", "Elegidos para almuerzo", "Choisis pour dejeuner", "Chwazi pou midi")
        case .afternoon:
            return customerText(language, "Picked for this afternoon", "Elegidos para esta tarde", "Choisis pour cet apres-midi", "Chwazi pou apremidi a")
        case .dinner:
            return customerText(language, "Picked for tonight", "Elegidos para hoy", "Choisis pour ce soir", "Chwazi pou aswè a")
        case .lateNight:
            return customerText(language, "Picked for late-night", "Elegidos para la noche", "Choisis pour tard ce soir", "Chwazi pou lannuit")
        }
    }

    func campaignTitle(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "Morning's fastest route", "La ruta mas rapida de la manana", "Le trajet le plus rapide du matin", "Wout maten ki pi rapid la")
        case .lunch:
            return customerText(language, "Lunch without drift", "Almuerzo sin perder tiempo", "Le dejeuner sans detour", "Midi san pèdi tan")
        case .afternoon:
            return customerText(language, "Keep the day moving", "Mantén el dia en marcha", "Gardez la journee en mouvement", "Kenbe jounen an an mouvman")
        case .dinner:
            return customerText(language, "Tonight's fastest route", "La ruta mas rapida de hoy", "Le trajet le plus rapide ce soir", "Wout ki pi rapid aswè a")
        case .lateNight:
            return customerText(language, "Late-night, simplified", "La noche, simplificada", "La nuit, simplifiee", "Lannuit, senplifye")
        }
    }

    func campaignDetail(_ language: FoodCustomerLanguage) -> String {
        switch self {
        case .breakfast:
            return customerText(language, "Coffee runs, quick bites, and checkout are lined up for a fast start.", "Cafe, bocados rapidos y pago listos para empezar bien.", "Cafe, encas rapides et paiement prets pour bien commencer.", "Kafe, ti manje rapid, ak peman yo pare pou yon bon demaraj.")
        case .lunch:
            return customerText(language, "Quick picks, saved spots, and checkout are lined up for a fast lunch run.", "Selecciones, favoritos y pago ya estan listos para un almuerzo rapido.", "Selections, favoris et paiement sont prets pour un dejeuner rapide.", "Chwa rapid, favori, ak peman yo pare pou yon midi rapid.")
        case .afternoon:
            return customerText(language, "Snacks, favorites, and one-tap reorders are ready for the next break.", "Snacks, favoritos y reordenes rapidos listos para la proxima pausa.", "Encas, favoris et re-commandes rapides sont prets pour la prochaine pause.", "Ti manje, favori, ak rekòmann rapid yo pare pou pwochen poz la.")
        case .dinner:
            return customerText(language, "Quick picks, saved spots, and checkout are lined up for a fast dinner run.", "Las selecciones, favoritos y el pago ya estan listos para una cena rapida.", "Selections, favoris et paiement sont prets pour un diner plus rapide.", "Chwa rapid, favori, ak peman yo pare pou yon dine rapid.")
        case .lateNight:
            return customerText(language, "Reliable spots, favorites, and checkout are lined up before places close.", "Sitios fiables, favoritos y pago listos antes del cierre.", "Adresses fiables, favoris et paiement prets avant la fermeture.", "Bon kote serye, favori, ak peman yo pare anvan yo fèmen.")
        }
    }

    var gradientColors: [Color] {
        switch self {
        case .breakfast:
            return [Color(red: 0.97, green: 0.63, blue: 0.24), Color(red: 0.53, green: 0.26, blue: 0.15)]
        case .lunch:
            return [Color(red: 0.14, green: 0.53, blue: 0.38), Color(red: 0.12, green: 0.25, blue: 0.36)]
        case .afternoon:
            return [Color(red: 0.91, green: 0.53, blue: 0.16), Color(red: 0.47, green: 0.22, blue: 0.36)]
        case .dinner:
            return [FoodTheme.flameDeep, FoodTheme.blue]
        case .lateNight:
            return [Color(red: 0.11, green: 0.13, blue: 0.28), Color(red: 0.27, green: 0.11, blue: 0.33)]
        }
    }

    var surfaceTint: Color {
        switch self {
        case .breakfast:
            return Color(red: 1.00, green: 0.88, blue: 0.70)
        case .lunch:
            return Color(red: 0.77, green: 0.92, blue: 0.82)
        case .afternoon:
            return Color(red: 1.00, green: 0.83, blue: 0.69)
        case .dinner:
            return FoodTheme.flameSoft
        case .lateNight:
            return Color(red: 0.72, green: 0.74, blue: 0.96)
        }
    }
}

private enum CustomerCampaignTickerStyle {
    case hero
    case surface
}

private struct CustomerCampaignTicker: View {
    let messages: [CustomerCampaignMessage]
    let style: CustomerCampaignTickerStyle

    var body: some View {
        TimelineView(.periodic(from: .now, by: 3)) { context in
            if let activeMessage = activeMessage(at: context.date) {
                let activeIndex = activeIndexValue(at: context.date)
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(iconBackground)
                        Image(systemName: activeMessage.icon)
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(iconForeground)
                    }
                    .frame(width: 52, height: 52)

                    VStack(alignment: .leading, spacing: 6) {
                        Text(activeMessage.title)
                            .font(.system(size: 16, weight: .black))
                            .foregroundStyle(primaryText)
                        Text(activeMessage.detail)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(secondaryText)
                            .fixedSize(horizontal: false, vertical: true)

                        HStack(spacing: 6) {
                            ForEach(Array(messages.enumerated()), id: \.offset) { index, _ in
                                Capsule()
                                    .fill(index == activeIndex ? primaryText.opacity(style == .hero ? 0.95 : 0.9) : secondaryText.opacity(0.28))
                                    .frame(width: index == activeIndex ? 28 : 10, height: 6)
                            }
                        }
                        .padding(.top, 2)
                    }

                    Spacer(minLength: 0)
                }
                .padding(16)
                .background(cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(borderColor, lineWidth: 1)
                )
            }
        }
    }

    private var cardBackground: some ShapeStyle {
        switch style {
        case .hero:
            return AnyShapeStyle(.white.opacity(0.10))
        case .surface:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [FoodTheme.surface, FoodTheme.surfaceRaised.opacity(0.96)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        }
    }

    private var borderColor: Color {
        switch style {
        case .hero:
            return .white.opacity(0.08)
        case .surface:
            return FoodTheme.line
        }
    }

    private var iconBackground: Color {
        switch style {
        case .hero:
            return .white.opacity(0.14)
        case .surface:
            return FoodTheme.flameSoft
        }
    }

    private var iconForeground: Color {
        switch style {
        case .hero:
            return .white
        case .surface:
            return FoodTheme.flame
        }
    }

    private var primaryText: Color {
        switch style {
        case .hero:
            return .white
        case .surface:
            return FoodTheme.ink
        }
    }

    private var secondaryText: Color {
        switch style {
        case .hero:
            return .white.opacity(0.8)
        case .surface:
            return FoodTheme.muted
        }
    }

    private func activeIndexValue(at date: Date) -> Int {
        guard !messages.isEmpty else { return 0 }
        return Int(date.timeIntervalSinceReferenceDate / 3).quotientAndRemainder(dividingBy: messages.count).remainder
    }

    private func activeMessage(at date: Date) -> CustomerCampaignMessage? {
        guard !messages.isEmpty else { return nil }
        return messages[activeIndexValue(at: date)]
    }
}

private struct CustomerHeroBadge: View {
    let icon: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .bold))
            Text(label)
                .font(.system(size: 11, weight: .black))
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.white.opacity(0.12))
        .clipShape(Capsule())
    }
}

private struct CustomerHeroMetric: View {
    let eyebrow: String
    let value: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(eyebrow)
                .font(.system(size: 11, weight: .black))
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(.white.opacity(0.68))
            Text(value)
                .font(.system(size: 24, weight: .black))
                .foregroundStyle(.white)
            Text(detail)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.78))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.white.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private struct FoodWorkspaceHero: View {
    let appName: String
    let workspace: FoodWorkspace

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(appName)
                        .font(.system(size: 32, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Text("Eight specialized front-end experiences. One shared restaurant backend and OxSteed ID.")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                }
                Spacer()
                Label(workspace.badge, systemImage: "checkmark.seal.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(FoodTheme.basil)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(FoodTheme.surfaceRaised)
                    .clipShape(Capsule())
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(workspace.title)
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Text(workspace.subtitle)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
            }
        }
        .foodCard(padding: 18)
    }
}

private struct FoodWorkspaceRail: View {
    let workspaces: [FoodWorkspace]
    @Binding var workspace: FoodWorkspace

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(workspaces) { item in
                    Button {
                        withAnimation(.spring(response: 0.25, dampingFraction: 0.88)) {
                            workspace = item
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Image(systemName: item.icon)
                                    .font(.system(size: 18, weight: .bold))
                                Spacer()
                                Text(item.badge.uppercased())
                                    .font(.system(size: 10, weight: .black))
                            }
                            Text(item.title)
                                .font(.system(size: 15, weight: .black))
                                .multilineTextAlignment(.leading)
                            Text(item.subtitle)
                                .font(.system(size: 12, weight: .medium))
                                .multilineTextAlignment(.leading)
                                .lineLimit(3)
                        }
                        .foregroundStyle(workspace == item ? .white : FoodTheme.ink)
                        .frame(width: 190, alignment: .leading)
                        .padding(14)
                        .background(workspace == item ? FoodTheme.flame : FoodTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(workspace == item ? FoodTheme.flame : FoodTheme.line)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct CustomerWorkspaceView: View {
    @EnvironmentObject private var store: FoodStore
    @AppStorage("ox.food.customerSubworkspace") private var tabRawValue = CustomerSubworkspace.discover.rawValue

    private var tab: CustomerSubworkspace {
        get { CustomerSubworkspace(rawValue: tabRawValue) ?? .discover }
        nonmutating set { tabRawValue = newValue.rawValue }
    }

    private var liveOrderLabel: String {
        if let order = store.lastPlacedOrder {
            return order.status.replacingOccurrences(of: "_", with: " ").capitalized
        }
        if let active = store.myOrders.first(where: \.isActive) {
            return "#\(active.queueNumber) " + active.status.replacingOccurrences(of: "_", with: " ").capitalized
        }
        return customerText(store.customerLanguage, "Nothing live", "Nada en vivo", "Rien en direct", "Pa gen anyen an dirèk")
    }

    private var featuredActionTitle: String {
        switch tab {
        case .discover:
            return customerText(store.customerLanguage, "Jump into ordering", "Ir a pedir", "Passer a la commande", "Ale komann")
        case .order:
            return customerText(store.customerLanguage, "Finish this basket", "Terminar este pedido", "Finaliser ce panier", "Fini panyen sa a")
        case .track:
            return customerText(store.customerLanguage, "Watch your number", "Seguir tu numero", "Suivre votre numero", "Gade nimewo ou")
        case .perks:
            return customerText(store.customerLanguage, "Use your perks", "Usar beneficios", "Utiliser vos avantages", "Sèvi ak rekonpans ou")
        }
    }

    private var featuredActionSubtitle: String {
        switch tab {
        case .discover:
            return customerText(store.customerLanguage, "Curated picks, quick starts, and your saved spots are all ready below.", "Las selecciones, accesos rapidos y favoritos ya estan listos abajo.", "Les selections, raccourcis et favoris sont prets juste en dessous.", "Chwa yo, aksè rapid yo, ak favori yo deja pare anba a.")
        case .order:
            return customerText(store.customerLanguage, "Your cart stays visible while you customize and check out.", "Tu carrito sigue visible mientras personalizas y pagas.", "Votre panier reste visible pendant la personnalisation et le paiement.", "Panyen ou rete vizib pandan w ap pèsonalize epi peye.")
        case .track:
            return customerText(store.customerLanguage, "Stay with the live queue, payment state, and handoff timing in one place.", "Sigue la fila en vivo, el pago y la entrega en un solo lugar.", "Suivez la file, le paiement et le moment du retrait au meme endroit.", "Swiv liy an dirèk, peman an, ak moman retrè a nan yon sèl kote.")
        case .perks:
            return customerText(store.customerLanguage, "Rewards, offers, and one-tap reorders are lined up for your next meal.", "Recompensas, ofertas y reordenes rapidos estan listos para tu proxima comida.", "Recompenses, offres et re-commandes rapides sont pretes pour votre prochain repas.", "Rekonpans, òf, ak rekòmann rapid yo pare pou pwochen repa ou.")
        }
    }

    private var tabBinding: Binding<CustomerSubworkspace> {
        Binding(
            get: { CustomerSubworkspace(rawValue: tabRawValue) ?? .discover },
            set: { tabRawValue = $0.rawValue }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !FoodAppShell.isDedicated {
                CustomerCommandCenter(
                    tab: tab,
                    language: store.customerLanguage,
                    featuredActionTitle: featuredActionTitle,
                    featuredActionSubtitle: featuredActionSubtitle,
                    cartCount: store.cartItemCount,
                    liveOrderLabel: liveOrderLabel,
                    action: { selected in
                        withAnimation(.spring(response: 0.25, dampingFraction: 0.88)) {
                            tab = selected
                        }
                    }
                )
            } else if tab == .discover {
                VStack(alignment: .leading, spacing: 6) {
                    Text(CustomerDaypart.current.greeting(store.customerLanguage))
                        .font(.system(size: 28, weight: .black, design: .rounded))
                        .foregroundStyle(FoodTheme.ink)
                    Text(customerText(store.customerLanguage, "What would you like today?", "Que te gustaria hoy?", "Que souhaitez-vous aujourd'hui?", "Kisa ou ta renmen jodi a?"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                }
            }

            ZStack {
                switch tab {
                case .discover:
                    DiscoverView {
                        tab = .order
                    }
                case .order:
                    OrderView()
                case .track:
                    TrackView()
                case .perks:
                    CustomerPerksView {
                        tab = .order
                    }
                }
            }
            .id(tab)
            .transition(.asymmetric(insertion: .opacity.combined(with: .move(edge: .trailing)),
                                    removal: .opacity.combined(with: .move(edge: .leading))))
            .animation(.spring(response: 0.32, dampingFraction: 0.9), value: tab)
        }
        .foodDedicatedTabBar(
            selection: tabBinding,
            accent: FoodTheme.flame,
            items: CustomerSubworkspace.allCases.map {
                FoodTabDescriptor(id: $0, title: $0.tabBarTitle, icon: $0.icon)
            }
        )
    }
}

private struct CustomerCommandCenter: View {
    let tab: CustomerSubworkspace
    let language: FoodCustomerLanguage
    let featuredActionTitle: String
    let featuredActionSubtitle: String
    let cartCount: Int
    let liveOrderLabel: String
    let action: (CustomerSubworkspace) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(customerText(
                        language,
                        "Order your way",
                        "Pide a tu manera",
                        "Commandez a votre facon",
                        "Komann fason pa ou"
                    ))
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(.white)

                    Text(customerText(
                        language,
                        "One branded flow for discovering, ordering, tracking, and rewards.",
                        "Un flujo de marca para descubrir, pedir, seguir y recompensas.",
                        "Un parcours de marque pour decouvrir, commander, suivre et profiter des recompenses.",
                        "Yon sèl koule mak pou dekouvri, komann, swiv, ak rekonpans."
                    ))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.76))
                }

                Spacer(minLength: 0)

                Text(tab.title.uppercased())
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.white.opacity(0.12))
                    .clipShape(Capsule())
            }

            CustomerShellFeatureCard(
                title: featuredActionTitle,
                subtitle: featuredActionSubtitle,
                actionLabel: tab == .discover
                    ? customerText(language, "See picks", "Ver selecciones", "Voir les choix", "Gade chwa yo")
                    : customerText(language, "Stay here", "Seguir aqui", "Rester ici", "Rete isit la"),
                icon: tab.icon
            )

            HStack(spacing: 12) {
                CustomerWorkspacePulseCard(
                    eyebrow: customerText(language, "Cart", "Carrito", "Panier", "Panyen"),
                    value: "\(cartCount)",
                    detail: customerText(language, "items ready", "articulos listos", "articles prets", "atik pare"),
                    tone: FoodTheme.flame
                )
                CustomerWorkspacePulseCard(
                    eyebrow: customerText(language, "Live", "En vivo", "En direct", "An dirèk"),
                    value: liveOrderLabel,
                    detail: customerText(language, "tracking status", "estado de seguimiento", "etat du suivi", "eta swivi"),
                    tone: FoodTheme.blue
                )
            }

            CustomerWorkspaceDock(selectedTab: tab, language: language, action: action)
        }
        .padding(20)
        .background(
            LinearGradient(
                colors: [FoodTheme.flameDeep, FoodTheme.blue],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 32, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 32, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct CustomerWorkspaceDock: View {
    let selectedTab: CustomerSubworkspace
    let language: FoodCustomerLanguage
    let action: (CustomerSubworkspace) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(customerText(language, "Your flow", "Tu flujo", "Votre parcours", "Parcours ou"))
                    .font(.system(size: 11, weight: .black))
                    .textCase(.uppercase)
                    .tracking(1)
                    .foregroundStyle(.white.opacity(0.72))
                Spacer()
                Text(customerText(language, "Tap to switch", "Toca para cambiar", "Touchez pour changer", "Peze pou chanje"))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white.opacity(0.62))
            }

            HStack(spacing: 10) {
                ForEach(CustomerSubworkspace.allCases) { item in
                    Button {
                        action(item)
                    } label: {
                        VStack(spacing: 8) {
                            ZStack {
                                Circle()
                                    .fill(selectedTab == item ? .white.opacity(0.20) : .white.opacity(0.10))
                                Image(systemName: item.icon)
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                            .frame(width: 42, height: 42)

                            Text(item.title)
                                .font(.system(size: 12, weight: .black))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(selectedTab == item ? .white.opacity(0.12) : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .stroke(selectedTab == item ? .white.opacity(0.14) : .white.opacity(0.05), lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(10)
            .background(.white.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
    }
}

private enum CustomerSubworkspace: String, CaseIterable, Identifiable {
    case discover
    case order
    case track
    case perks

    var id: String { rawValue }
    var title: String {
        switch self {
        case .discover: return "Discover"
        case .order: return "Order"
        case .track: return "Track"
        case .perks: return "Perks"
        }
    }
    var icon: String {
        switch self {
        case .discover: return "sparkles"
        case .order: return "bag.fill"
        case .track: return "figure.walk.motion"
        case .perks: return "gift.fill"
        }
    }

    var tabBarTitle: String {
        switch self {
        case .discover: return "Home"
        case .order: return "Menu"
        case .track: return "Orders"
        case .perks: return "Rewards"
        }
    }

    func subtitle(for language: FoodCustomerLanguage) -> String {
        switch self {
        case .discover:
            return customerText(language, "Browse spots and quick picks", "Explora y entra rapido", "Explorez et entrez vite", "Browse epi antre vit")
        case .order:
            return customerText(language, "Customize and check out", "Personaliza y paga", "Personnalisez et payez", "Pèsonalize epi peye")
        case .track:
            return customerText(language, "Follow live queue updates", "Sigue la fila en vivo", "Suivez la file en direct", "Swiv liy an dirèk")
        case .perks:
            return customerText(language, "Rewards, offers, and reorders", "Recompensas y ofertas", "Recompenses et offres", "Rekonpans ak òf")
        }
    }
}

private struct CustomerWorkspacePulseCard: View {
    let eyebrow: String
    let value: String
    let detail: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(eyebrow)
                .font(.system(size: 11, weight: .black))
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(tone)
            Text(value)
                .font(.system(size: 18, weight: .black))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(detail)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.68))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.white.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.white.opacity(0.06), lineWidth: 1)
        )
    }
}

private struct CustomerShellFeatureCard: View {
    let title: String
    let subtitle: String
    let actionLabel: String
    let icon: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            CustomerDishMotif(
                palette: CustomerCuisinePalette(primary: FoodTheme.flame, secondary: FoodTheme.blue, accent: FoodTheme.flameSoft, icon: icon),
                kind: .reward,
                size: 58,
                foreground: .white
            )

            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.76))
                HStack(spacing: 6) {
                    Text(actionLabel)
                        .font(.system(size: 12, weight: .black))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 11, weight: .black))
                }
                .foregroundStyle(FoodTheme.flameSoft)
                .padding(.top, 2)
            }

            Spacer(minLength: 0)
        }
        .padding(18)
        .background(.white.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(.white.opacity(0.06), lineWidth: 1)
        )
    }
}

private struct OwnerManagerWorkspaceView: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WorkspaceSectionHeader(
                title: "Owner / manager app",
                subtitle: "Live operations, menu control, growth signals, and shift-readiness alerts."
            )
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(store.managerKPIs) { kpi in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(kpi.title.uppercased())
                                .font(.system(size: 11, weight: .black))
                                .foregroundStyle(managerColor(kpi.color))
                            Text(kpi.value)
                                .font(.system(size: 28, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Text(kpi.detail)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }
                        .frame(width: 160, alignment: .leading)
                        .foodCard(padding: 14)
                    }
                }
            }

            if !store.managerAlerts.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Operational alerts")
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    ForEach(store.managerAlerts) { alert in
                        HStack(alignment: .top, spacing: 10) {
                            Circle()
                                .fill(managerColor(alert.tone))
                                .frame(width: 10, height: 10)
                                .padding(.top, 5)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(alert.title)
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(FoodTheme.ink)
                                Text(alert.detail)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(FoodTheme.muted)
                            }
                        }
                        .foodCard(padding: 14)
                    }
                }
            }

            MerchantView()
        }
    }
}

private struct POSCounterWorkspaceView: View {
    @EnvironmentObject private var store: FoodStore

    private var menuItems: [FoodMenuItem] {
        let liveItems = store.menu.flatMap(\.items)
        return liveItems.isEmpty ? [FoodSampleData.menuItem] : liveItems
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WorkspaceSectionHeader(
                title: "POS / counter app",
                subtitle: "Fast walk-in order entry, payment-state tracking, and immediate kitchen dispatch."
            )

            if let restaurant = store.activeRestaurant {
                VStack(alignment: .leading, spacing: 8) {
                    Text(restaurant.displayName)
                        .font(.system(size: 20, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Text("Use the current restaurant menu to create dine-in or pickup orders.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                    Button("Load this menu into POS") {
                        Task { await store.select(restaurant) }
                    }
                    .buttonStyle(.bordered)
                }
                .foodCard(padding: 16)
            }

            VStack(alignment: .leading, spacing: 10) {
                Picker("Fulfillment", selection: $store.counterFulfillment) {
                    Text("Dine In").tag("dine_in")
                    Text("Pickup").tag("pickup")
                }
                .pickerStyle(.segmented)
                TextField("Guest or ticket name", text: $store.counterGuestName)
                    .textFieldStyle(.roundedBorder)
                if store.counterFulfillment == "dine_in" {
                    TextField("Table number", text: $store.counterTableLabel)
                        .textFieldStyle(.roundedBorder)
                }
            }
            .foodCard(padding: 16)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(menuItems) { item in
                    Button {
                        store.addCounterLine(item)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.name)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(FoodTheme.ink)
                            Text(foodMoney(item.priceCents, currency: item.currencyCode))
                                .font(.system(size: 13, weight: .black))
                                .foregroundStyle(FoodTheme.basil)
                            Text(item.description ?? "Quick-add counter favorite")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                                .lineLimit(2)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .foodCard(padding: 14)
                    }
                    .buttonStyle(.plain)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Counter ticket", systemImage: "receipt")
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Spacer()
                    Text(foodMoney(store.counterCartTotalCents, currency: store.activeRestaurant?.currencyCode ?? "USD"))
                        .font(.system(size: 16, weight: .black))
                        .foregroundStyle(FoodTheme.flame)
                }
                if store.counterCart.isEmpty {
                    Text("Tap menu items to build a walk-in order.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                } else {
                    ForEach(store.counterCart) { line in
                        HStack {
                            Text("\(line.quantity)x \(line.item.name)")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(FoodTheme.ink)
                            Spacer()
                            Text(foodMoney(line.lineTotalCents, currency: line.item.currencyCode))
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(FoodTheme.ink)
                            Button {
                                store.removeCounterLine(line)
                            } label: {
                                Image(systemName: "trash")
                                    .foregroundStyle(FoodTheme.muted)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Button {
                        Task { await store.submitCounterOrder() }
                    } label: {
                        HStack {
                            if store.isSubmittingCounterOrder {
                                ProgressView().controlSize(.small).tint(.white)
                            }
                            Text("Send to kitchen")
                                .font(.system(size: 16, weight: .black))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(FoodTheme.flame)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .disabled(store.isSubmittingCounterOrder)
                }
            }
            .foodCard(padding: 16)
        }
    }
}

private struct KitchenDisplayWorkspaceView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WorkspaceSectionHeader(
                title: "Kitchen display app",
                subtitle: "Dedicated prep board with live ticket movement and fullscreen kitchen mode."
            )
            KitchenDisplayView()
                .frame(minHeight: 640)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

private struct KioskQueueWorkspaceView: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WorkspaceSectionHeader(
                title: "Kiosk + queue display app",
                subtitle: "Self-ordering mode for guests and a public-ready queue board for the dining room."
            )
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Kiosk flow", systemImage: "hand.tap.fill")
                        .font(.system(size: 17, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Text("Use the customer ordering workspace for the menu flow, then lock the iPad to this workspace for self-service ordering.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                }
                .foodCard(padding: 14)

                VStack(alignment: .leading, spacing: 8) {
                    Label("Queue board", systemImage: "list.number")
                        .font(.system(size: 17, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Text("Ready for wall-mount display with large queue numbers and 5-second polling.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                }
                .foodCard(padding: 14)
            }

            if let restaurant = store.activeRestaurant {
                QueueBoardLive(restaurantId: restaurant.id)
            }
        }
    }
}

private struct CrewTrainingWorkspaceView: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WorkspaceSectionHeader(
                title: "Crew training + SOP app",
                subtitle: "Role-based onboarding, SOP reinforcement, and opening-shift readiness."
            )
            VStack(alignment: .leading, spacing: 10) {
                Text("Assigned training")
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                ForEach(store.crewTraining) { module in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(module.title)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(FoodTheme.ink)
                            Text("\(module.role) · \(module.durationMinutes) min")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }
                        Spacer()
                        Text(module.isComplete ? "Complete" : "Due")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(module.isComplete ? FoodTheme.basil : FoodTheme.saffron)
                            .clipShape(Capsule())
                    }
                    .foodCard(padding: 14)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Opening checklist")
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                ForEach(store.openingChecklist) { item in
                    HStack {
                        Image(systemName: item.isComplete ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(item.isComplete ? FoodTheme.basil : FoodTheme.muted)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(FoodTheme.ink)
                            Text(item.station)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }
                    }
                    .foodCard(padding: 14)
                }
            }
        }
    }
}

private struct InventoryReceivingWorkspaceView: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WorkspaceSectionHeader(
                title: "Inventory + supplier receiving app",
                subtitle: "Par levels, receiving discipline, and visibility into stock risk before service."
            )
            VStack(alignment: .leading, spacing: 10) {
                Text("Inventory snapshot")
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                ForEach(store.inventoryItems) { item in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.name)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(FoodTheme.ink)
                            Text("Supplier: \(item.supplier)")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            Text("\(Int(item.stockLevel)) \(item.unit)")
                                .font(.system(size: 15, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Text("Par \(Int(item.parLevel))")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(item.stockLevel <= item.parLevel ? FoodTheme.saffron : FoodTheme.basil)
                        }
                    }
                    .foodCard(padding: 14)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Receiving windows")
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                ForEach(store.receivingTasks) { task in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(task.supplier)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(FoodTheme.ink)
                        Text(task.etaWindow)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(FoodTheme.blue)
                        Text(task.notes)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    .foodCard(padding: 14)
                }
            }
        }
    }
}

private struct DeliveryRunnerWorkspaceView: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WorkspaceSectionHeader(
                title: "Delivery / runner app",
                subtitle: "Assigned handoffs, routing discipline, and issue capture for real-world fulfillment."
            )
            ForEach(store.runnerTasks) { task in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "location.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(FoodTheme.flame)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(task.stopName)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(FoodTheme.ink)
                        Text("\(task.taskType) · \(task.status)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(FoodTheme.blue)
                        Text(task.notes)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    Spacer()
                }
                .foodCard(padding: 14)
            }
        }
    }
}

private struct CustomerPerksView: View {
    @EnvironmentObject private var store: FoodStore
    var startReorder: () -> Void

    private var loyaltyProgress: CustomerLoyaltyProgress {
        CustomerLoyaltyProgress(summary: store.loyaltySummary)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(customerText(store.customerLanguage, "OxSteed Rewards", "OxSteed Rewards", "OxSteed Rewards", "OxSteed Rewards"))
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white.opacity(0.82))
                        Text(customerText(store.customerLanguage, "Earn dinner perks.", "Gana beneficios para tu cena.", "Gagnez des avantages pour le diner.", "Ranmase avantaj pou dine ou."))
                            .font(.system(size: 30, weight: .black))
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(store.loyaltySummary.rewardSummary)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(.white.opacity(0.82))
                    }
                    Spacer()
                    CustomerBrandIllustration(style: .emptyState, animate: true)
                        .frame(width: 88, height: 88)
                }

                HStack(spacing: 12) {
                    CustomerHeroMetric(
                        eyebrow: customerText(store.customerLanguage, "Tier", "Nivel", "Niveau", "Nivo"),
                        value: store.loyaltySummary.tierName,
                        detail: customerText(store.customerLanguage, "current status", "estado actual", "statut actuel", "eta aktyèl")
                    )
                    CustomerHeroMetric(
                        eyebrow: customerText(store.customerLanguage, "Points", "Puntos", "Points", "Pwen"),
                        value: "\(store.loyaltySummary.points)",
                        detail: customerText(store.customerLanguage, "available now", "disponibles", "disponibles", "disponib")
                    )
                }
            }
            .padding(22)
            .background(
                LinearGradient(
                    colors: [FoodTheme.flameDeep, FoodTheme.blue],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))

            PerksMomentumCard(progress: loyaltyProgress, language: store.customerLanguage)

            HStack(spacing: 12) {
                PerksStatCard(
                    title: customerText(store.customerLanguage, "Offers", "Ofertas", "Offres", "Òf"),
                    value: "\(store.customerOffers.count)",
                    detail: customerText(store.customerLanguage, "live now", "activas", "actives", "aktif")
                )
                PerksStatCard(
                    title: customerText(store.customerLanguage, "Favorites", "Favoritos", "Favoris", "Favori"),
                    value: "\(store.favoriteRestaurants.count)",
                    detail: customerText(store.customerLanguage, "saved spots", "guardados", "enregistres", "sove")
                )
            }

            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(customerText(store.customerLanguage, "Offers and rewards", "Ofertas y recompensas", "Offres et recompenses", "Of ak rekonpans"))
                        .font(.system(size: 20, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Text(customerText(store.customerLanguage, "Priority deals lined up for your next order.", "Promociones listas para tu proximo pedido.", "Offres prioritaires pour votre prochaine commande.", "Bon òf ki pare pou pwochen komann ou."))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                }
                ForEach(store.customerOffers) { offer in
                    PerksOfferCard(offer: offer)
                }
            }

            if !store.favoriteRestaurants.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(customerText(store.customerLanguage, "Favorite restaurants", "Restaurantes favoritos", "Restaurants favoris", "Restoran pi renmen"))
                            .font(.system(size: 20, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        Spacer()
                        Text(customerText(store.customerLanguage, "Jump back in", "Vuelve rapido", "Retour rapide", "Tounen rapid"))
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(store.favoriteRestaurants) { restaurant in
                                Button {
                                    Task {
                                        await store.select(restaurant)
                                        startReorder()
                                    }
                                } label: {
                                    FavoriteRestaurantPerkCard(restaurant: restaurant)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }

            if !store.recentCustomerOrders.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(customerText(store.customerLanguage, "Reorder", "Volver a pedir", "Commander a nouveau", "Komanse menm komann lan"))
                            .font(.system(size: 20, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        Text(customerText(store.customerLanguage, "Bring back proven orders in one tap.", "Trae de vuelta pedidos seguros con un toque.", "Relancez vos commandes preferees en un geste.", "Relanse bon komann ou yo ak yon sèl peze."))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    ForEach(store.recentCustomerOrders) { template in
                        ReorderPerkCard(template: template, language: store.customerLanguage) {
                            Task {
                                if await store.loadReorderTemplate(template) {
                                    startReorder()
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct CustomerLoyaltyProgress {
    let points: Int
    let tierName: String
    let rewardSummary: String
    let nextRewardPoints: Int?
    let currentTierFloor: Int
    let nextTierPoints: Int?
    let nextTierName: String?

    init(summary: FoodCustomerLoyaltySummary) {
        points = summary.points
        tierName = summary.tierName
        rewardSummary = summary.rewardSummary
        nextRewardPoints = CustomerLoyaltyProgress.extractFirstNumber(from: summary.rewardSummary)

        let normalizedTier = summary.tierName.lowercased()
        switch normalizedTier {
        case let value where value.contains("regular"):
            currentTierFloor = 0
            nextTierPoints = 250
            nextTierName = "Block Favorite"
        case let value where value.contains("favorite"):
            currentTierFloor = 250
            nextTierPoints = 500
            nextTierName = "City Insider"
        case let value where value.contains("insider"):
            currentTierFloor = 500
            nextTierPoints = 900
            nextTierName = "VIP Table"
        case let value where value.contains("vip"):
            currentTierFloor = 900
            nextTierPoints = nil
            nextTierName = nil
        default:
            currentTierFloor = 0
            nextTierPoints = 250
            nextTierName = "Block Favorite"
        }
    }

    var tierProgress: Double {
        guard let nextTierPoints else { return 1 }
        let span = max(nextTierPoints - currentTierFloor, 1)
        return min(max(Double(points - currentTierFloor) / Double(span), 0), 1)
    }

    var rewardProgress: Double {
        guard let nextRewardPoints, nextRewardPoints > 0 else { return 1 }
        return min(max(Double(points) / Double(points + nextRewardPoints), 0), 1)
    }

    private static func extractFirstNumber(from text: String) -> Int? {
        guard let range = text.range(of: #"\d+"#, options: .regularExpression) else { return nil }
        return Int(text[range])
    }
}

private struct PerksMomentumCard: View {
    let progress: CustomerLoyaltyProgress
    let language: FoodCustomerLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(customerText(language, "Keep the streak moving", "Mantén el ritmo", "Gardez le rythme", "Kenbe vitès la"))
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Text(customerText(language, "Your next reward and tier are close enough to feel real.", "Tu proxima recompensa y nivel ya se sienten alcanzables.", "Votre prochaine recompense et votre prochain niveau semblent proches.", "Pwochen rekonpans ou ak pwochen nivo ou yo ase pre pou w santi yo reyèl."))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
            }

            HStack(spacing: 12) {
                PerksProgressStat(
                    title: customerText(language, "Next reward", "Proxima recompensa", "Prochaine recompense", "Pwochen rekonpans"),
                    value: progress.nextRewardPoints.map { "\($0)" } ?? customerText(language, "Ready", "Lista", "Prete", "Pare"),
                    detail: progress.nextRewardPoints.map { _ in
                        customerText(language, "points left", "puntos faltantes", "points restants", "pwen ki rete")
                    } ?? customerText(language, "available now", "disponible ahora", "disponible maintenant", "disponib kounye a")
                )
                PerksProgressStat(
                    title: customerText(language, "Next tier", "Proximo nivel", "Prochain niveau", "Pwochen nivo"),
                    value: progress.nextTierName ?? customerText(language, "Top tier", "Nivel maximo", "Niveau max", "Nivo siprèm"),
                    detail: progress.nextTierPoints.map {
                        "\(max($0 - progress.points, 0)) " + customerText(language, "points to go", "puntos restantes", "points restants", "pwen ki rete")
                    } ?? customerText(language, "you're there", "ya llegaste", "vous y etes", "ou rive la")
                )
            }

            VStack(alignment: .leading, spacing: 12) {
                PerksProgressBar(
                    title: customerText(language, "Reward progress", "Progreso de recompensa", "Progression recompense", "Pwogrè rekonpans"),
                    progress: progress.rewardProgress,
                    leading: "\(progress.points)",
                    trailing: progress.nextRewardPoints.map { "+\($0)" } ?? customerText(language, "Now", "Ahora", "Maintenant", "Kounye a"),
                    tint: FoodTheme.flame
                )

                PerksProgressBar(
                    title: customerText(language, "Tier progress", "Progreso de nivel", "Progression niveau", "Pwogrè nivo"),
                    progress: progress.tierProgress,
                    leading: progress.tierName,
                    trailing: progress.nextTierName ?? customerText(language, "Top tier", "Nivel maximo", "Niveau max", "Nivo siprèm"),
                    tint: FoodTheme.blue
                )
            }
        }
        .foodCard(padding: 18)
    }
}

private struct PerksProgressStat: View {
    let title: String
    let value: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .black))
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(FoodTheme.flame)
            Text(value)
                .font(.system(size: 20, weight: .black))
                .foregroundStyle(FoodTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(detail)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(FoodTheme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct PerksProgressBar: View {
    let title: String
    let progress: Double
    let leading: String
    let trailing: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(FoodTheme.ink)
                Spacer()
                Text("\(Int(progress * 100))%")
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(tint)
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(FoodTheme.surfaceRaised)
                    Capsule()
                        .fill(tint)
                        .frame(width: max(proxy.size.width * progress, 18))
                }
            }
            .frame(height: 12)

            HStack {
                Text(leading)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FoodTheme.muted)
                Spacer()
                Text(trailing)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FoodTheme.muted)
            }
        }
    }
}

private struct PerksStatCard: View {
    let title: String
    let value: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .black))
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(FoodTheme.flame)
            Text(value)
                .font(.system(size: 26, weight: .black))
                .foregroundStyle(FoodTheme.ink)
            Text(detail)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foodCard(padding: 16)
    }
}

private struct PerksOfferCard: View {
    let offer: FoodCustomerOffer

    private var palette: CustomerCuisinePalette {
        cuisinePalette(for: offer.title)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(offer.title)
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Text(offer.detail)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                }
                Spacer()
                VStack(spacing: 8) {
                    CustomerDishMotif(
                        palette: palette,
                        kind: .reward,
                        size: 48,
                        foreground: .white
                    )

                    Text(offer.code)
                        .font(.system(size: 11, weight: .black))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(.white.opacity(0.14))
                        .clipShape(Capsule())
                }
            }

            HStack {
                Label("Reward ready", systemImage: "sparkles")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                Spacer()
                Text("Use at checkout")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.82))
            }
        }
        .padding(16)
        .background(
            LinearGradient(
                colors: [palette.primary, palette.secondary],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct FavoriteRestaurantPerkCard: View {
    let restaurant: FoodRestaurant

    private var palette: CustomerCuisinePalette {
        cuisinePalette(for: restaurant)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                CustomerDishMotif(
                    palette: palette,
                    kind: .plate,
                    size: 44,
                    foreground: .white
                )
                Spacer()
                Text("\(restaurant.prepTimeMin) min")
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(.white)
            }
            Text(restaurant.displayName)
                .font(.system(size: 18, weight: .black))
                .foregroundStyle(.white)
                .lineLimit(2)
            Text(restaurant.cuisineTags.isEmpty ? restaurant.locationLine : restaurant.cuisineTags.joined(separator: " • "))
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.82))
                .lineLimit(2)
            HStack {
                Text("Open favorite")
                    .font(.system(size: 13, weight: .black))
                    .foregroundStyle(.white)
                Spacer()
                Image(systemName: "arrow.right")
                    .foregroundStyle(.white)
            }
        }
        .frame(width: 220, alignment: .leading)
        .padding(16)
        .background(
            LinearGradient(
                colors: [palette.primary, palette.secondary],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct ReorderPerkCard: View {
    let template: FoodReorderTemplate
    let language: FoodCustomerLanguage
    let action: () -> Void

    private var palette: CustomerCuisinePalette {
        cuisinePalette(for: template.restaurantName)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(template.restaurantName)
                        .font(.system(size: 17, weight: .black))
                        .foregroundStyle(.white)
                    Text(compactOrderTimestamp(template.createdAt))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.78))
                }
                Spacer()
                CustomerDishMotif(
                    palette: palette,
                    kind: .reward,
                    size: 42,
                    foreground: .white
                )
            }

            Text(template.lines.map { "\($0.quantity)x \($0.itemName)" }.joined(separator: ", "))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.82))
                .lineLimit(3)

            HStack {
                Text(template.fulfillmentType.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(.white.opacity(0.14))
                    .clipShape(Capsule())
                Spacer()
                Button(customerText(language, "Load order", "Cargar pedido", "Charger la commande", "Chaje komann"), action: action)
                    .buttonStyle(.borderedProminent)
                    .tint(.white)
                    .foregroundStyle(palette.secondary)
            }
        }
        .padding(16)
        .background(
            LinearGradient(
                colors: [palette.secondary, palette.primary],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct WorkspaceSectionHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 24, weight: .black))
                .foregroundStyle(FoodTheme.ink)
            Text(subtitle)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
        }
    }
}

private func customerText(_ language: FoodCustomerLanguage, _ english: String, _ spanish: String, _ french: String, _ haitianCreole: String) -> String {
    switch language {
    case .english:
        return english
    case .spanish:
        return spanish
    case .french:
        return french
    case .haitianCreole:
        return haitianCreole
    }
}

private func managerColor(_ name: String) -> Color {
    switch name {
    case "flame", "warning":
        return FoodTheme.flame
    case "basil":
        return FoodTheme.basil
    case "blue":
        return FoodTheme.blue
    case "critical":
        return .red
    default:
        return FoodTheme.saffron
    }
}

// MARK: - Discover

struct DiscoverView: View {
    @EnvironmentObject private var store: FoodStore
    @State private var camera = MapCameraPosition.automatic
    @State private var selectedCuisine = "All"
    var openOrder: (() -> Void)? = nil

    private var daypart: CustomerDaypart {
        .current
    }

    private var cuisineOptions: [String] {
        let tags = Set(store.restaurants.flatMap(\.cuisineTags).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
        return ["All"] + tags.sorted()
    }

    private var filteredRestaurants: [FoodRestaurant] {
        guard selectedCuisine != "All" else { return store.restaurants }
        return store.restaurants.filter { restaurant in
            restaurant.cuisineTags.contains { $0.caseInsensitiveCompare(selectedCuisine) == .orderedSame }
        }
    }

    private var featuredRestaurants: [FoodRestaurant] {
        Array(filteredRestaurants.prefix(3))
    }

    private var spotlightRestaurants: [FoodRestaurant] {
        Array(filteredRestaurants.prefix(2))
    }

    private var fastLaneCount: Int {
        filteredRestaurants.filter { $0.prepTimeMin <= 20 && $0.acceptsOnlineOrders }.count
    }

    private var campaignPromos: [DiscoverCampaignPromo] {
        let all = filteredRestaurants.isEmpty ? store.restaurants : filteredRestaurants
        return [
            DiscoverCampaignPromo(
                title: customerText(store.customerLanguage, "Comfort run", "Ruta comfort", "Selection comfort", "Chwa comfort"),
                subtitle: customerText(store.customerLanguage, "Warm, quick, and easy crowd-pleasers.", "Caliente, rapido y facil para todos.", "Chaud, rapide et facile pour tout le monde.", "Cho, rapid, epi fasil pou tout moun."),
                fallbackCuisine: all.first?.cuisineTags.first ?? "All",
                icon: "takeoutbag.and.cup.and.straw.fill"
            ),
            DiscoverCampaignPromo(
                title: customerText(store.customerLanguage, "Coffee + bite", "Cafe + snack", "Cafe + snack", "Kafe + ti manje"),
                subtitle: customerText(store.customerLanguage, "Fast stops for a drink and something small.", "Paradas rapidas para beber y picar algo.", "Arrets rapides pour une boisson et un encas.", "Arè rapid pou bwè ak yon ti manje."),
                fallbackCuisine: store.restaurants.flatMap(\.cuisineTags).first(where: { $0.localizedCaseInsensitiveContains("Coffee") }) ?? "All",
                icon: "cup.and.saucer.fill"
            ),
            DiscoverCampaignPromo(
                title: customerText(store.customerLanguage, "Big order night", "Noche de gran pedido", "Soiree grosse commande", "Swa gwo komann"),
                subtitle: customerText(store.customerLanguage, "Pick reliable favorites for the whole group.", "Elige favoritos seguros para todo el grupo.", "Choisissez des valeurs sures pour tout le groupe.", "Chwazi bon favori serye pou tout gwoup la."),
                fallbackCuisine: all.dropFirst().first?.cuisineTags.first ?? "All",
                icon: "person.3.fill"
            )
        ]
    }

    private var liveMoments: [CustomerCampaignMessage] {
        [
            CustomerCampaignMessage(
                title: daypart.campaignTitle(store.customerLanguage),
                detail: customerText(store.customerLanguage, "Jump from curated picks to checkout without losing your place.", "Pasa de selecciones curadas a pagar sin perder tu progreso.", "Passez des choix proposes au paiement sans perdre votre progression.", "Soti nan chwa yo rive nan peman an san pèdi plas ou."),
                icon: "takeoutbag.and.cup.and.straw.fill"
            ),
            CustomerCampaignMessage(
                title: customerText(store.customerLanguage, "Favor the dependable spots", "Guarda los lugares fiables", "Gardez les adresses fiables", "Sove bon kote serye yo"),
                detail: customerText(store.customerLanguage, "Saved restaurants and reorders are tuned for the nightly repeat run.", "Los guardados y reordenes estan listos para la repeticion de la noche.", "Les favoris et re-commandes sont prets pour le rituel du soir.", "Favori ak rekòmann yo pare pou repa aswè repete yo."),
                icon: "heart.fill"
            ),
            CustomerCampaignMessage(
                title: customerText(store.customerLanguage, "Track it live", "Siguelo en vivo", "Suivez-le en direct", "Swiv li an dirèk"),
                detail: customerText(store.customerLanguage, "Queue changes, checkout state, and pickup timing stay in one flow.", "La fila, el pago y el retiro se quedan en un solo flujo.", "La file, le paiement et le retrait restent dans le meme flux.", "Liy la, peman an, ak retrè a rete nan menm kou a."),
                icon: "figure.walk.motion"
            )
        ]
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(daypart.discoverTitle(store.customerLanguage))
                                .font(.system(size: 28, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Text(daypart.discoverDetail(store.customerLanguage))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                        }
                        Spacer()
                        ZStack {
                            Circle()
                                .fill(FoodTheme.flameSoft)
                            Image(systemName: "takeoutbag.and.cup.and.straw.fill")
                                .font(.system(size: 26, weight: .bold))
                                .foregroundStyle(FoodTheme.flame)
                        }
                        .frame(width: 58, height: 58)
                    }

                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(FoodTheme.muted)
                        TextField("Search restaurants, food, cuisine", text: $store.searchText)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.search)
                            .onSubmit { Task { await store.loadRestaurants() } }
                        if store.isLoading {
                            ProgressView()
                                .controlSize(.small)
                        } else if !store.searchText.isEmpty {
                            Button {
                                store.searchText = ""
                                Task { await store.loadRestaurants() }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(FoodTheme.muted)
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 14)
                    .background(FoodTheme.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(cuisineOptions, id: \.self) { cuisine in
                                Button {
                                    withAnimation(.spring(response: 0.25, dampingFraction: 0.88)) {
                                        selectedCuisine = cuisine
                                    }
                                } label: {
                                    Text(cuisine == "All"
                                         ? customerText(store.customerLanguage, "All", "Todo", "Tout", "Tout")
                                         : cuisine)
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundStyle(selectedCuisine == cuisine ? .white : FoodTheme.ink)
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 10)
                                        .background(selectedCuisine == cuisine ? FoodTheme.flame : FoodTheme.surfaceRaised)
                                        .clipShape(Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    HStack(spacing: 10) {
                        Picker("Language", selection: $store.customerLanguage) {
                            ForEach(FoodCustomerLanguage.allCases) { language in
                                Text(language.label).tag(language)
                            }
                        }
                        .pickerStyle(.menu)
                        .font(.system(size: 13, weight: .bold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(FoodTheme.surfaceRaised)
                        .clipShape(Capsule())

                        Toggle(isOn: $store.customerNotificationsEnabled) {
                            Text(customerText(store.customerLanguage, "Order alerts", "Alertas", "Alertes", "Alèt"))
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(FoodTheme.ink)
                        }
                        .toggleStyle(.switch)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(FoodTheme.surfaceRaised)
                        .clipShape(Capsule())
                        Spacer(minLength: 0)
                    }
                }
                .padding(20)
                .background(
                    LinearGradient(
                        colors: [FoodTheme.surface, daypart.surfaceTint.opacity(0.88)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .stroke(FoodTheme.line, lineWidth: 1)
                )

                CustomerCampaignTicker(messages: liveMoments, style: .surface)

                HStack(spacing: 12) {
                    DiscoverSignalCard(
                        title: customerText(store.customerLanguage, "Open now", "Abiertos", "Ouverts", "Louvri"),
                        value: "\(filteredRestaurants.filter(\.acceptsOnlineOrders).count)",
                        detail: customerText(store.customerLanguage, "ready for ordering", "listos para pedir", "prets a commander", "pare pou komann"),
                        tone: FoodTheme.flame
                    )
                    DiscoverSignalCard(
                        title: customerText(store.customerLanguage, "Fast lane", "Rapidos", "Rapides", "Rapid"),
                        value: "\(fastLaneCount)",
                        detail: customerText(store.customerLanguage, "20 min or less", "20 min o menos", "20 min ou moins", "20 min oswa mwens"),
                        tone: FoodTheme.blue
                    )
                }

                if !featuredRestaurants.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(customerText(store.customerLanguage, "Quick picks", "Selecciones rapidas", "Choix rapides", "Chwa rapid"))
                                    .font(.system(size: 20, weight: .black))
                                    .foregroundStyle(FoodTheme.ink)
                                Text(customerText(store.customerLanguage, "Fast ways into what people usually order next.", "Entradas rapidas a lo que la gente suele pedir.", "Acces rapides a ce que les clients commandent le plus.", "Fason rapid pou antre nan sa moun konn komann apre."))
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(FoodTheme.muted)
                            }
                            Spacer()
                            Text(selectedCuisine == "All" ? "All" : selectedCuisine)
                                .font(.system(size: 12, weight: .black))
                                .foregroundStyle(FoodTheme.flame)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .background(FoodTheme.flameSoft)
                                .clipShape(Capsule())
                        }

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(featuredRestaurants) { restaurant in
                                    Button {
                                        Task {
                                            await store.select(restaurant)
                                            openOrder?()
                                        }
                                    } label: {
                                        QuickPickCard(restaurant: restaurant)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }

                if !campaignPromos.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(customerText(store.customerLanguage, "Tonight's lineup", "La seleccion de esta noche", "La selection de ce soir", "Seleksyon aswè a"))
                                .font(.system(size: 20, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Text(customerText(store.customerLanguage, "Fast starting points designed like a real ordering campaign.", "Puntos de partida rapidos pensados como una campana real de pedidos.", "Des points d'entree rapides penses comme une vraie campagne de commande.", "Pwen depa rapid ki fèt tankou yon vrè kanpay komann."))
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(campaignPromos) { promo in
                                    Button {
                                        withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
                                            selectedCuisine = cuisineOptions.contains(promo.fallbackCuisine) ? promo.fallbackCuisine : "All"
                                        }
                                    } label: {
                                        DiscoverCampaignCard(promo: promo)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }

                if !spotlightRestaurants.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(daypart.spotlightTitle(store.customerLanguage))
                                .font(.system(size: 20, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Text(customerText(store.customerLanguage, "Editorial-style picks that feel like a campaign, not a directory.", "Selecciones con estilo editorial que se sienten como campana, no como directorio.", "Selections au style editorial qui ressemblent a une campagne, pas a un annuaire.", "Chwa ak stil editoryal ki sanble ak yon kanpay, pa ak yon anyè."))
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }

                        VStack(spacing: 12) {
                            ForEach(Array(spotlightRestaurants.enumerated()), id: \.element.id) { index, restaurant in
                                Button {
                                    Task {
                                        await store.select(restaurant)
                                        openOrder?()
                                    }
                                } label: {
                                    DiscoverSpotlightCard(
                                        restaurant: restaurant,
                                        position: index + 1,
                                        language: store.customerLanguage
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                if !store.favoriteRestaurants.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(customerText(store.customerLanguage, "Favorites", "Favoritos", "Favoris", "Favori"))
                                .font(.system(size: 18, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Spacer()
                            Text(customerText(store.customerLanguage, "Tap to reorder", "Toca para pedir", "Touchez pour commander", "Peze pou komann"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(FoodTheme.muted)
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(store.favoriteRestaurants) { restaurant in
                                    Button {
                                        Task {
                                            await store.select(restaurant)
                                            openOrder?()
                                        }
                                    } label: {
                                        VStack(alignment: .leading, spacing: 4) {
                                            HStack {
                                                ZStack {
                                                    Circle()
                                                        .fill(FoodTheme.flameSoft)
                                                    Image(systemName: "heart.fill")
                                                        .foregroundStyle(FoodTheme.flame)
                                                }
                                                .frame(width: 34, height: 34)
                                                Spacer()
                                                Text("\(restaurant.prepTimeMin) min")
                                                    .font(.system(size: 11, weight: .black))
                                                    .foregroundStyle(FoodTheme.ink)
                                            }
                                            Text(restaurant.displayName)
                                                .font(.system(size: 16, weight: .bold))
                                                .foregroundStyle(FoodTheme.ink)
                                            Text(restaurant.cuisineTags.isEmpty ? restaurant.locationLine : restaurant.cuisineTags.joined(separator: " • "))
                                                .font(.system(size: 12, weight: .medium))
                                                .foregroundStyle(FoodTheme.muted)
                                        }
                                        .frame(width: 210, alignment: .leading)
                                        .foodCard(padding: 16)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }

                Map(position: $camera) {
                    ForEach(filteredRestaurants) { restaurant in
                        if let coordinate = restaurant.coordinate {
                            Marker(restaurant.displayName, systemImage: "fork.knife", coordinate: coordinate)
                                .tint(FoodTheme.flame)
                        }
                    }
                }
                .frame(height: 240)
                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                .overlay(alignment: .topLeading) {
                    Label("Restaurants on OxSteed Restaurants", systemImage: "location.fill")
                        .font(.system(size: 13, weight: .bold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(.thinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .padding(14)
                }

                if store.restaurants.isEmpty && !store.isLoading {
                    VStack(spacing: 8) {
                        CustomerBrandIllustration(style: .emptyState, animate: true)
                            .frame(width: 104, height: 104)
                        Text(store.discoverLoadFailed
                            ? customerText(store.customerLanguage, "Could not load restaurants", "No se pudieron cargar restaurantes", "Impossible de charger les restaurants", "Pa t kapab chaje restoran yo")
                            : customerText(store.customerLanguage, "No restaurants found", "No se encontraron restaurantes", "Aucun restaurant trouve", "Pa gen restoran"))
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(FoodTheme.ink)
                        Text(store.discoverLoadFailed
                            ? customerText(store.customerLanguage, "Check your connection and try again.", "Revisa tu conexion e intenta de nuevo.", "Verifiez votre connexion et reessayez.", "Verifye koneksyon ou epi eseye ankò.")
                            : customerText(store.customerLanguage, "Try a different search, or add your own restaurant from the Merchant tab.", "Prueba otra busqueda o agrega tu restaurante desde Merchant.", "Essayez une autre recherche ou ajoutez votre restaurant via Merchant.", "Eseye yon lòt rechèch oswa ajoute restoran ou nan Merchant."))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                            .multilineTextAlignment(.center)
                        Button("Retry") { Task { await store.loadRestaurants() } }
                            .buttonStyle(.bordered)
                    }
                    .frame(maxWidth: .infinity)
                    .foodCard(padding: 24)
                }

                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(customerText(store.customerLanguage, "Popular near you", "Popular cerca de ti", "Populaire pres de vous", "Popile toupre ou"))
                            .font(.system(size: 22, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        Text(customerText(store.customerLanguage, "Fast pickup, dine-in options, and favorites worth repeating.", "Recogida rapida, opciones para comer y favoritos para repetir.", "Retrait rapide, options sur place et favoris a recommander.", "Pran rapid, opsyon manje sou plas, ak favori ki vo repete."))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    Spacer()
                    Text("\(filteredRestaurants.count)")
                        .font(.system(size: 28, weight: .black))
                        .foregroundStyle(FoodTheme.flame)
                }

                VStack(spacing: 14) {
                    ForEach(Array(filteredRestaurants.enumerated()), id: \.element.id) { index, restaurant in
                        RestaurantCard(restaurant: restaurant, rank: index + 1) {
                            Task {
                                await store.select(restaurant)
                                openOrder?()
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
        }
    }
}

private struct DiscoverSignalCard: View {
    let title: String
    let value: String
    let detail: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11, weight: .black))
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(tone)
            Text(value)
                .font(.system(size: 28, weight: .black))
                .foregroundStyle(FoodTheme.ink)
            Text(detail)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foodCard(padding: 16)
    }
}

private struct CustomerCuisinePalette {
    let primary: Color
    let secondary: Color
    let accent: Color
    let icon: String
}

private func cuisinePalette(for restaurant: FoodRestaurant) -> CustomerCuisinePalette {
    cuisinePalette(for: restaurant.cuisineTags.first ?? restaurant.displayName)
}

private func cuisinePalette(for cuisineSeed: String) -> CustomerCuisinePalette {
    let seed = cuisineSeed.lowercased()
    if seed.contains("coffee") || seed.contains("cafe") || seed.contains("bakery") {
        return CustomerCuisinePalette(primary: FoodTheme.saffron, secondary: FoodTheme.flameDeep, accent: Color(red: 0.49, green: 0.32, blue: 0.18), icon: "cup.and.saucer.fill")
    }
    if seed.contains("pizza") || seed.contains("ital") || seed.contains("pasta") {
        return CustomerCuisinePalette(primary: FoodTheme.flame, secondary: Color(red: 0.53, green: 0.11, blue: 0.08), accent: Color(red: 0.96, green: 0.77, blue: 0.49), icon: "flame.fill")
    }
    if seed.contains("burger") || seed.contains("bbq") || seed.contains("grill") {
        return CustomerCuisinePalette(primary: FoodTheme.flameDeep, secondary: Color(red: 0.20, green: 0.08, blue: 0.06), accent: FoodTheme.flame, icon: "takeoutbag.and.cup.and.straw.fill")
    }
    if seed.contains("sushi") || seed.contains("ramen") || seed.contains("japan") {
        return CustomerCuisinePalette(primary: FoodTheme.blue, secondary: Color(red: 0.10, green: 0.16, blue: 0.31), accent: Color(red: 0.81, green: 0.90, blue: 1.00), icon: "fish.fill")
    }
    if seed.contains("mex") || seed.contains("taco") {
        return CustomerCuisinePalette(primary: Color(red: 0.91, green: 0.45, blue: 0.08), secondary: Color(red: 0.30, green: 0.42, blue: 0.11), accent: Color(red: 0.99, green: 0.84, blue: 0.36), icon: "sun.max.fill")
    }
    if seed.contains("vegan") || seed.contains("salad") || seed.contains("healthy") {
        return CustomerCuisinePalette(primary: FoodTheme.basil, secondary: Color(red: 0.08, green: 0.27, blue: 0.18), accent: Color(red: 0.77, green: 0.93, blue: 0.76), icon: "leaf.fill")
    }
    if seed.contains("dessert") || seed.contains("ice cream") || seed.contains("sweet") {
        return CustomerCuisinePalette(primary: Color(red: 0.89, green: 0.41, blue: 0.57), secondary: Color(red: 0.43, green: 0.18, blue: 0.35), accent: Color(red: 1.00, green: 0.84, blue: 0.89), icon: "birthday.cake.fill")
    }
    return CustomerCuisinePalette(primary: FoodTheme.flameDeep, secondary: FoodTheme.blue, accent: FoodTheme.flameSoft, icon: "fork.knife.circle.fill")
}

private struct QuickPickCard: View {
    @State private var animateCard = false
    let restaurant: FoodRestaurant

    private var palette: CustomerCuisinePalette {
        cuisinePalette(for: restaurant)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(restaurant.cuisineTags.first ?? "Featured")
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(.white.opacity(0.76))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(.white.opacity(0.12))
                    .clipShape(Capsule())
                Spacer()
                Text("\(restaurant.prepTimeMin) min")
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(.white)
            }

            Spacer(minLength: 8)

            CustomerDishMotif(
                palette: palette,
                kind: .stacked,
                size: 62,
                foreground: .white
            )

            VStack(alignment: .leading, spacing: 6) {
                Text(restaurant.displayName)
                    .font(.system(size: 21, weight: .black))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                Text(restaurant.description ?? restaurant.locationLine)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.8))
                    .lineLimit(3)
            }

            HStack {
                Text("Open menu")
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(.white)
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: 250, height: 220, alignment: .leading)
        .padding(18)
        .background(
            LinearGradient(
                colors: [palette.primary, palette.secondary],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(alignment: .bottomTrailing) {
            ZStack {
                Circle()
                    .fill(.white.opacity(0.10))
                    .frame(width: 110, height: 110)
                    .offset(x: animateCard ? 8 : 24, y: animateCard ? 6 : 18)
                Circle()
                    .fill(.white.opacity(0.08))
                    .frame(width: 54, height: 54)
                    .offset(x: animateCard ? -10 : 12, y: animateCard ? -6 : 10)
            }
            .blur(radius: 1)
        }
        .shadow(color: FoodTheme.flameDeep.opacity(0.16), radius: 18, x: 0, y: 10)
        .onAppear {
            withAnimation(.easeInOut(duration: 3.2).repeatForever(autoreverses: true)) {
                animateCard = true
            }
        }
    }
}

private enum CustomerBrandIllustrationStyle {
    case hero
    case emptyState
    case tracking
}

private enum CustomerDishMotifKind {
    case plate
    case stacked
    case reward
}

private struct CustomerDishMotif: View {
    @State private var animate = false
    let palette: CustomerCuisinePalette
    let kind: CustomerDishMotifKind
    let size: CGFloat
    let foreground: Color

    private var backdropOpacity: Double {
        foreground == .white ? 0.12 : 0.18
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(foreground.opacity(backdropOpacity))
                .frame(width: size, height: size)

            Circle()
                .stroke(foreground.opacity(0.16), lineWidth: max(size * 0.04, 1))
                .frame(width: size * 0.92, height: size * 0.92)

            switch kind {
            case .plate:
                ZStack {
                    Ellipse()
                        .fill(foreground.opacity(0.95))
                        .frame(width: size * 0.62, height: size * 0.26)
                        .offset(y: size * 0.16)

                    RoundedRectangle(cornerRadius: size * 0.16, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [palette.primary, palette.secondary],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: size * 0.48, height: size * 0.30)
                        .rotationEffect(.degrees(animate ? -7 : 9))
                        .offset(y: size * 0.02)

                    Capsule()
                        .fill(palette.accent)
                        .frame(width: size * 0.12, height: size * 0.30)
                        .rotationEffect(.degrees(28))
                        .offset(x: size * 0.18, y: -size * 0.12)
                }

            case .stacked:
                ZStack {
                    RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [palette.secondary, palette.primary],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: size * 0.48, height: size * 0.42)
                        .offset(y: size * 0.06)

                    RoundedRectangle(cornerRadius: size * 0.14, style: .continuous)
                        .fill(foreground.opacity(0.94))
                        .frame(width: size * 0.34, height: size * 0.16)
                        .offset(y: -size * 0.16)

                    Capsule()
                        .stroke(foreground.opacity(0.92), lineWidth: max(size * 0.028, 1))
                        .frame(width: size * 0.16, height: size * 0.11)
                        .offset(y: -size * 0.24)
                }

            case .reward:
                ZStack {
                    RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [palette.primary, palette.secondary],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: size * 0.54, height: size * 0.36)
                        .rotationEffect(.degrees(-8))

                    Capsule()
                        .fill(foreground.opacity(0.94))
                        .frame(width: size * 0.28, height: size * 0.08)
                        .offset(y: -size * 0.04)

                    Circle()
                        .fill(palette.accent)
                        .frame(width: size * 0.18, height: size * 0.18)
                        .offset(x: size * 0.18, y: size * 0.16)
                }
            }

            Circle()
                .fill(palette.accent.opacity(0.95))
                .frame(width: size * 0.14, height: size * 0.14)
                .offset(x: -size * 0.22, y: -size * 0.20)

            Circle()
                .fill(foreground.opacity(0.84))
                .frame(width: size * 0.08, height: size * 0.08)
                .offset(x: size * 0.24, y: -size * 0.18)
        }
        .frame(width: size, height: size)
        .onAppear {
            withAnimation(.easeInOut(duration: 3.2).repeatForever(autoreverses: true)) {
                animate = true
            }
        }
    }
}

private struct CustomerBrandIllustration: View {
    let style: CustomerBrandIllustrationStyle
    var animate: Bool

    private var motifKind: CustomerDishMotifKind {
        switch style {
        case .hero: return .plate
        case .emptyState: return .stacked
        case .tracking: return .reward
        }
    }

    private var palette: CustomerCuisinePalette {
        switch style {
        case .hero:
            return CustomerCuisinePalette(primary: FoodTheme.flame, secondary: FoodTheme.blue, accent: FoodTheme.flameSoft, icon: "fork.knife.circle.fill")
        case .emptyState:
            return CustomerCuisinePalette(primary: FoodTheme.saffron, secondary: FoodTheme.flameDeep, accent: FoodTheme.flameSoft, icon: "takeoutbag.and.cup.and.straw.fill")
        case .tracking:
            return CustomerCuisinePalette(primary: FoodTheme.blue, secondary: FoodTheme.flameDeep, accent: Color(red: 0.81, green: 0.90, blue: 1.00), icon: "location.fill")
        }
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(style == .hero ? .white.opacity(0.10) : palette.accent.opacity(0.22))
                .scaleEffect(animate ? 1.04 : 0.92)
                .blur(radius: style == .hero ? 2 : 0)

            Circle()
                .fill(style == .hero ? FoodTheme.flameSoft : .white.opacity(0.96))
                .frame(width: style == .hero ? 112 : 72, height: style == .hero ? 112 : 72)
                .offset(x: animate ? 10 : -4, y: animate ? 8 : -8)
                .opacity(style == .hero ? 0.95 : 1)

            CustomerDishMotif(
                palette: palette,
                kind: motifKind,
                size: style == .hero ? 94 : 66,
                foreground: style == .hero ? .white : FoodTheme.surface
            )
            .rotationEffect(.degrees(animate ? 8 : -6))

            VStack(spacing: 8) {
                Capsule()
                    .fill(style == .hero ? .white.opacity(0.82) : palette.primary.opacity(0.88))
                    .frame(width: style == .hero ? 24 : 18, height: 6)
                Capsule()
                    .fill(style == .hero ? .white.opacity(0.55) : palette.accent.opacity(0.92))
                    .frame(width: style == .hero ? 16 : 12, height: 6)
                Capsule()
                    .fill(style == .hero ? .white.opacity(0.32) : palette.secondary.opacity(0.84))
                    .frame(width: style == .hero ? 10 : 8, height: 6)
            }
            .offset(x: animate ? 32 : 18, y: animate ? -26 : -18)
        }
        .animation(.easeInOut(duration: 3.2).repeatForever(autoreverses: true), value: animate)
    }
}

private struct DiscoverCampaignPromo: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let fallbackCuisine: String
    let icon: String
}

private struct DiscoverCampaignCard: View {
    let promo: DiscoverCampaignPromo

    private var palette: CustomerCuisinePalette {
        cuisinePalette(for: promo.fallbackCuisine)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack {
                CustomerDishMotif(
                    palette: palette,
                    kind: .reward,
                    size: 52,
                    foreground: .white
                )
            }
            .frame(width: 52, height: 52)

            Spacer(minLength: 0)

            Text(promo.title)
                .font(.system(size: 20, weight: .black))
                .foregroundStyle(.white)

            Text(promo.subtitle)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.82))
                .lineLimit(3)

            HStack {
                Text(promo.fallbackCuisine == "All" ? "Browse all" : promo.fallbackCuisine)
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(.white)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 13, weight: .black))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: 210, height: 184, alignment: .leading)
        .padding(18)
        .background(
            LinearGradient(
                colors: [palette.primary, palette.secondary],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

private struct DiscoverSpotlightCard: View {
    let restaurant: FoodRestaurant
    let position: Int
    let language: FoodCustomerLanguage

    private var palette: CustomerCuisinePalette {
        cuisinePalette(for: restaurant)
    }

    private var cuisineLabel: String {
        if restaurant.cuisineTags.isEmpty {
            return customerText(language, "House favorite", "Favorito de la casa", "Favori de la maison", "Favori kay la")
        }
        return restaurant.cuisineTags.prefix(2).joined(separator: " • ")
    }

    private var pickupLabel: String {
        restaurant.acceptsOnlineOrders
            ? customerText(language, "Open for ordering", "Abierto para pedir", "Ouvert a la commande", "Louvri pou komann")
            : customerText(language, "Browse menu", "Ver menu", "Voir le menu", "Gade meni")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 10) {
                    Text("#\(position)")
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(.white.opacity(0.14))
                        .clipShape(Capsule())
                    Text(cuisineLabel)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white.opacity(0.82))
                        .lineLimit(1)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(restaurant.displayName)
                        .font(.system(size: 24, weight: .black))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    Text(restaurant.description ?? restaurant.locationLine)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.82))
                        .lineLimit(3)
                }

                HStack(spacing: 10) {
                    DiscoverSpotlightPill(icon: "clock.fill", label: "\(restaurant.prepTimeMin) min")
                    if let distanceKm = restaurant.distanceKm {
                        DiscoverSpotlightPill(icon: "location.fill", label: String(format: "%.1f km", distanceKm))
                    }
                }

                HStack {
                    Text(pickupLabel)
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(.white)
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 15, weight: .black))
                        .foregroundStyle(.white)
                }
            }

            Spacer(minLength: 0)

            VStack(spacing: 12) {
                CustomerDishMotif(
                    palette: palette,
                    kind: .plate,
                    size: 92,
                    foreground: .white
                )
                Text(customerText(language, "Tonight", "Hoy", "Ce soir", "Aswè a"))
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(.white.opacity(0.78))
                    .textCase(.uppercase)
                    .tracking(1)
            }
        }
        .padding(20)
        .background(
            LinearGradient(
                colors: position == 1
                    ? [palette.primary, palette.secondary]
                    : [palette.secondary, palette.primary],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct DiscoverSpotlightPill: View {
    let icon: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .bold))
            Text(label)
                .font(.system(size: 11, weight: .bold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.white.opacity(0.14))
        .clipShape(Capsule())
    }
}

private struct RestaurantCard: View {
    @EnvironmentObject private var store: FoodStore
    let restaurant: FoodRestaurant
    let rank: Int
    var action: () -> Void

    private var palette: CustomerCuisinePalette {
        cuisinePalette(for: restaurant)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) {
                            Text("#\(rank)")
                                .font(.system(size: 10, weight: .black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 6)
                                .background(.white.opacity(0.16))
                                .clipShape(Capsule())
                            Text(restaurant.status.replacingOccurrences(of: "_", with: " ").uppercased())
                                .font(.system(size: 10, weight: .black))
                                .foregroundStyle(.white.opacity(0.86))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 6)
                                .background(.white.opacity(0.12))
                                .clipShape(Capsule())
                        }

                        Text(restaurant.displayName)
                            .font(.system(size: 24, weight: .black))
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)

                        Text(restaurant.description ?? (restaurant.locationLine.isEmpty ? "Ready for ordering on OxSteed Restaurants." : restaurant.locationLine))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white.opacity(0.82))
                            .lineLimit(3)
                    }

                    Spacer(minLength: 0)

                    Button {
                        store.toggleFavorite(restaurant)
                    } label: {
                        Image(systemName: store.isFavorite(restaurant) ? "heart.fill" : "heart")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 42, height: 42)
                            .background(.white.opacity(0.14))
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                }

                HStack(spacing: 8) {
                    if !restaurant.cuisineTags.isEmpty {
                        DiscoverSpotlightPill(icon: palette.icon, label: restaurant.cuisineTags.prefix(2).joined(separator: " • "))
                    }
                    if restaurant.reviewCount > 0 {
                        DiscoverSpotlightPill(
                            icon: "star.fill",
                            label: String(format: "%.1f (%d)", restaurant.avgRating, restaurant.reviewCount)
                        )
                    }
                    if restaurant.isVerified {
                        DiscoverSpotlightPill(icon: "checkmark.seal.fill", label: "Verified")
                    }
                    if let hoursMessage = restaurant.hoursMessage, !hoursMessage.isEmpty {
                        DiscoverSpotlightPill(
                            icon: (restaurant.isOpen ?? true) ? "door.left.hand.open" : "moon.fill",
                            label: hoursMessage
                        )
                    }
                    DiscoverSpotlightPill(icon: "clock.fill", label: "\(restaurant.prepTimeMin) min")
                    if let distanceKm = restaurant.distanceKm {
                        DiscoverSpotlightPill(icon: "location.fill", label: String(format: "%.1f km", distanceKm))
                    }
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: 168, alignment: .topLeading)
            .background(
                ZStack {
                    // Real cover photography — falls back to an on-brand
                    // gradient + icon when the restaurant has no photo.
                    RemoteFoodImage(restaurant.coverPhotoUrl, icon: palette.icon, tint: palette.primary)
                    LinearGradient(
                        colors: [palette.primary.opacity(0.52), Color.black.opacity(0.58)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
            )
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    RestaurantFactPill(
                        icon: restaurant.acceptsOnlineOrders ? "bolt.fill" : "book.fill",
                        label: restaurant.acceptsOnlineOrders
                            ? customerText(store.customerLanguage, "Ready to order", "Listo para pedir", "Pret a commander", "Pare pou komann")
                            : customerText(store.customerLanguage, "Browse menu", "Ver menu", "Voir le menu", "Gade meni")
                    )
                    RestaurantFactPill(
                        icon: "sparkles",
                        label: rank == 1
                            ? customerText(store.customerLanguage, "Top pick", "Top", "Top", "Top")
                            : customerText(store.customerLanguage, "Popular tonight", "Popular hoy", "Populaire ce soir", "Popilè aswè a")
                    )
                }

                Button(action: action) {
                    HStack(spacing: 12) {
                        Text(customerText(store.customerLanguage, "View menu", "Ver menu", "Voir le menu", "Gade meni"))
                            .font(.system(size: 15, weight: .black))
                            .foregroundStyle(.white)
                        Spacer()
                        Image(systemName: "arrow.right")
                            .font(.system(size: 14, weight: .black))
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(palette.primary)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 18)
        }
        .background(
            LinearGradient(
                colors: [FoodTheme.surface, FoodTheme.surfaceRaised.opacity(0.92)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .stroke(FoodTheme.line, lineWidth: 1)
        )
    }
}

private struct RestaurantFactPill: View {
    let icon: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .bold))
            Text(label)
                .font(.system(size: 11, weight: .bold))
        }
        .foregroundStyle(FoodTheme.ink)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(FoodTheme.surfaceRaised)
        .clipShape(Capsule())
    }
}

// MARK: - Order

struct OrderView: View {
    @EnvironmentObject private var store: FoodStore
    @State private var configuringItem: FoodMenuItem?
    @State private var selectedSectionId: Int64?
    private let cartAnchor = "customer-cart-panel"

    private var menuSections: [FoodMenuSection] {
        store.menu.filter { !$0.items.isEmpty }
    }

    private var featuredItems: [FeaturedMenuEntry] {
        Array(
            menuSections.flatMap { section in
                section.items
                    .filter(\.isAvailable)
                    .prefix(2)
                    .map { FeaturedMenuEntry(section: section, item: $0) }
            }
            .prefix(6)
        )
    }

    private func menuAnchor(for sectionId: Int64) -> String {
        "customer-menu-section-\(sectionId)"
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let restaurant = store.selectedRestaurant {
                        CustomerOrderHero(restaurant: restaurant)

                        VStack(alignment: .leading, spacing: 14) {
                            CustomerStepHeader(
                                eyebrow: customerText(store.customerLanguage, "Step 1", "Paso 1", "Etape 1", "Etap 1"),
                                title: customerText(store.customerLanguage, "Choose how you'll order", "Elige como pedir", "Choisissez votre mode de commande", "Chwazi kijan w ap komann")
                            )

                            Picker("Fulfillment", selection: $store.fulfillment) {
                                Text(customerText(store.customerLanguage, "Pickup", "Recoger", "A emporter", "Pran")).tag("pickup")
                                Text(customerText(store.customerLanguage, "Dine In", "Comer aqui", "Sur place", "Manje la")).tag("dine_in")
                            }
                            .pickerStyle(.segmented)

                            if store.onlineCheckoutAvailable {
                                Picker("Payment", selection: $store.customerPaymentMode) {
                                    Text(customerText(store.customerLanguage, "Pay now", "Pagar ahora", "Payer maintenant", "Peye kounye a")).tag("pay_now")
                                    Text(customerText(store.customerLanguage, "Pay at counter", "Pagar en mostrador", "Payer au comptoir", "Peye nan kontwa")).tag("pay_at_counter")
                                }
                                .pickerStyle(.segmented)
                            }

                            HStack(spacing: 10) {
                                CustomerOrderModeCard(
                                    title: customerText(store.customerLanguage, "Fulfillment", "Entrega", "Retrait", "Resevwa"),
                                    value: store.fulfillment == "dine_in"
                                        ? customerText(store.customerLanguage, "Dine in", "Comer aqui", "Sur place", "Manje la")
                                        : customerText(store.customerLanguage, "Pickup", "Recoger", "A emporter", "Pran"),
                                    icon: store.fulfillment == "dine_in" ? "fork.knife" : "bag.fill"
                                )

                                CustomerOrderModeCard(
                                    title: customerText(store.customerLanguage, "Payment", "Pago", "Paiement", "Peman"),
                                    value: store.onlineCheckoutAvailable && store.customerPaymentMode == "pay_now"
                                        ? customerText(store.customerLanguage, "Secure checkout", "Pago seguro", "Paiement securise", "Peman sekirize")
                                        : customerText(store.customerLanguage, "At restaurant", "En el local", "Au restaurant", "Nan restoran an"),
                                    icon: store.onlineCheckoutAvailable && store.customerPaymentMode == "pay_now" ? "creditcard.fill" : "banknote.fill"
                                )
                            }

                            if store.fulfillment == "dine_in" {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(customerText(store.customerLanguage, "Table details", "Mesa", "Table", "Tab"))
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundStyle(FoodTheme.ink)
                                    TextField("Table number (optional)", text: $store.tableLabel)
                                        .textFieldStyle(.roundedBorder)
                                }
                            }
                            if !store.isSignedIn {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(customerText(store.customerLanguage, "Guest label", "Nombre", "Nom client", "Non kliyan"))
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundStyle(FoodTheme.ink)
                                    TextField("Your name (shown to the kitchen)", text: $store.guestName)
                                        .textFieldStyle(.roundedBorder)
                                }
                            }
                        }
                        .foodCard(padding: 18)

                        if !restaurant.acceptsOnlineOrders {
                            Label("This restaurant is not taking app orders right now.", systemImage: "moon.zzz.fill")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(FoodTheme.saffron)
                                .foodCard()
                        }

                        CustomerStepHeader(
                            eyebrow: customerText(store.customerLanguage, "Step 2", "Paso 2", "Etape 2", "Etap 2"),
                            title: customerText(store.customerLanguage, "Build your order", "Arma tu pedido", "Composez votre commande", "Prepare komann ou")
                        )

                        if !menuSections.isEmpty {
                            MenuSectionRail(
                                sections: menuSections,
                                selectedSectionId: selectedSectionId ?? menuSections.first?.id
                            ) { section in
                                selectedSectionId = section.id
                                withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) {
                                    proxy.scrollTo(menuAnchor(for: section.id), anchor: .top)
                                }
                            }

                            if !featuredItems.isEmpty {
                                VStack(alignment: .leading, spacing: 12) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(customerText(store.customerLanguage, "Signature picks", "Selecciones destacadas", "Selections signatures", "Chwa siyati"))
                                            .font(.system(size: 20, weight: .black))
                                            .foregroundStyle(FoodTheme.ink)
                                        Text(customerText(store.customerLanguage, "A faster, merchandised way into the items most likely to convert.", "Una via mas rapida y comercial para entrar en los productos que mas convierten.", "Une entree plus rapide et plus merchandisee vers les articles les plus convaincants.", "Yon fason pi rapid ak plis mache pou antre nan atik ki gen plis chans fè moun komann."))
                                            .font(.system(size: 13, weight: .medium))
                                            .foregroundStyle(FoodTheme.muted)
                                    }

                                    ScrollView(.horizontal, showsIndicators: false) {
                                        HStack(spacing: 12) {
                                            ForEach(featuredItems) { entry in
                                                Button {
                                                    selectedSectionId = entry.section.id
                                                    configuringItem = entry.item
                                                } label: {
                                                    FeaturedMenuCard(entry: entry)
                                                }
                                                .buttonStyle(.plain)
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        ForEach(menuSections) { section in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(section.name)
                                            .font(.system(size: 20, weight: .black))
                                            .foregroundStyle(FoodTheme.ink)
                                        if let description = section.description, !description.isEmpty {
                                            Text(description)
                                                .font(.system(size: 12, weight: .medium))
                                                .foregroundStyle(FoodTheme.muted)
                                                .lineLimit(2)
                                        }
                                    }
                                    Spacer()
                                    Text("\(section.items.count)")
                                        .font(.system(size: 12, weight: .black))
                                        .foregroundStyle(FoodTheme.muted)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(FoodTheme.surfaceRaised)
                                        .clipShape(Capsule())
                                }
                                ForEach(section.items) { item in
                                    MenuItemRow(item: item, sectionName: section.name) {
                                        configuringItem = item
                                    }
                                }
                            }
                            .id(menuAnchor(for: section.id))
                        }

                        if menuSections.isEmpty {
                            Text("This restaurant is still building its menu.")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                                .frame(maxWidth: .infinity)
                                .foodCard(padding: 20)
                        }

                        CustomerStepHeader(
                            eyebrow: customerText(store.customerLanguage, "Step 3", "Paso 3", "Etape 3", "Etap 3"),
                            title: customerText(store.customerLanguage, "Review before sending", "Revisa antes de enviar", "Verifiez avant d'envoyer", "Revize anvan voye")
                        )
                        CartPanel()
                            .id(cartAnchor)
                    } else {
                        VStack(spacing: 10) {
                            CustomerBrandIllustration(style: .emptyState, animate: true)
                                .frame(width: 96, height: 96)
                            Text(customerText(store.customerLanguage, "Pick a restaurant first", "Elige un restaurante primero", "Choisissez d'abord un restaurant", "Chwazi yon restoran anvan"))
                                .font(.system(size: 24, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Text(customerText(store.customerLanguage, "Find one on the Discover tab, then build your order here.", "Busca uno en Descubrir y luego arma tu pedido aqui.", "Trouvez-en un dans Decouvrir, puis composez votre commande ici.", "Jwenn youn nan Dekouvri, epi prepare komann ou isit la."))
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                        .foodCard(padding: 30)
                        .padding(.top, 40)
                    }
                }
            }
            .padding(16)
            .safeAreaInset(edge: .bottom) {
                if store.selectedRestaurant != nil && !store.cart.isEmpty {
                    OrderMiniCartDock {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
                            proxy.scrollTo(cartAnchor, anchor: .bottom)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                }
            }
        }
        .sheet(item: $configuringItem) { item in
            MenuItemSheet(item: item)
        }
        .onAppear {
            if selectedSectionId == nil {
                selectedSectionId = menuSections.first?.id
            }
        }
        .onChange(of: menuSections.map(\.id)) { _, ids in
            if !ids.contains(selectedSectionId ?? -1) {
                selectedSectionId = ids.first
            }
        }
    }
}

private struct FeaturedMenuEntry: Identifiable {
    let section: FoodMenuSection
    let item: FoodMenuItem

    var id: Int64 { item.id }
}

private struct MenuSectionRail: View {
    let sections: [FoodMenuSection]
    let selectedSectionId: Int64?
    let action: (FoodMenuSection) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Menu flow")
                    .font(.system(size: 12, weight: .black))
                    .textCase(.uppercase)
                    .tracking(1)
                    .foregroundStyle(FoodTheme.flame)
                Spacer()
                Text("\(sections.count) sections")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(FoodTheme.muted)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(sections) { section in
                        Button {
                            action(section)
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(section.name)
                                    .font(.system(size: 14, weight: .black))
                                    .foregroundStyle(selectedSectionId == section.id ? .white : FoodTheme.ink)
                                    .lineLimit(1)
                                Text("\(section.items.count) items")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(selectedSectionId == section.id ? .white.opacity(0.76) : FoodTheme.muted)
                            }
                            .frame(width: 136, alignment: .leading)
                            .padding(14)
                            .background(selectedSectionId == section.id ? FoodTheme.flame : FoodTheme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 20, style: .continuous)
                                    .stroke(selectedSectionId == section.id ? FoodTheme.flame.opacity(0.2) : FoodTheme.line, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

private struct FeaturedMenuCard: View {
    let entry: FeaturedMenuEntry

    private var palette: CustomerCuisinePalette {
        cuisinePalette(for: "\(entry.section.name) \(entry.item.name)")
    }

    private var itemBadge: String {
        if !entry.item.tags.isEmpty {
            return entry.item.tags.prefix(2).joined(separator: " • ")
        }
        if !entry.item.modifierGroups.isEmpty {
            return "Customizable"
        }
        return "Fast favorite"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                CustomerDishMotif(
                    palette: palette,
                    kind: .plate,
                    size: 54,
                    foreground: .white
                )
                Spacer()
                Text(entry.section.name)
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(.white.opacity(0.86))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(.white.opacity(0.12))
                    .clipShape(Capsule())
            }

            Spacer(minLength: 0)

            Text(entry.item.name)
                .font(.system(size: 20, weight: .black))
                .foregroundStyle(.white)
                .lineLimit(2)

            Text(entry.item.description ?? "Open the item sheet to customize and add it to your order.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.82))
                .lineLimit(3)

            HStack {
                Text(itemBadge)
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(.white.opacity(0.12))
                    .clipShape(Capsule())
                Spacer()
                Text(foodMoney(entry.item.priceCents, currency: entry.item.currencyCode))
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: 240, height: 220, alignment: .leading)
        .padding(18)
        .background(
            LinearGradient(
                colors: [palette.primary, palette.secondary],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct MenuItemRow: View {
    let item: FoodMenuItem
    let sectionName: String
    var configure: () -> Void

    private var palette: CustomerCuisinePalette {
        cuisinePalette(for: "\(sectionName) \(item.name)")
    }

    private var itemHighlights: [String] {
        var highlights = Array(item.tags.prefix(2))
        if !item.modifierGroups.isEmpty {
            highlights.append("Customizable")
        }
        if highlights.isEmpty {
            highlights.append(item.isAvailable ? "Popular choice" : "Unavailable")
        }
        return highlights
    }

    var body: some View {
        Button(action: configure) {
            HStack(alignment: .top, spacing: 14) {
                RemoteFoodImage(urlString: item.imageUrl) {
                    CustomerDishMotif(
                        palette: palette,
                        kind: item.modifierGroups.isEmpty ? .plate : .stacked,
                        size: 66,
                        foreground: item.isAvailable ? .white : FoodTheme.surface
                    )
                }
                .frame(width: 66, height: 66)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .saturation(item.isAvailable ? 1 : 0)
                .opacity(item.isAvailable ? 1 : 0.55)

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text(item.name)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(FoodTheme.ink)
                        if !item.isAvailable {
                            Text("SOLD OUT")
                                .font(.system(size: 10, weight: .black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(FoodTheme.muted)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                    }
                    if let description = item.description {
                        Text(description)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                            .lineLimit(2)
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(itemHighlights, id: \.self) { highlight in
                                Text(highlight)
                                    .font(.system(size: 10, weight: .black))
                                    .foregroundStyle(item.isAvailable ? palette.primary : FoodTheme.muted)
                                    .padding(.horizontal, 9)
                                    .padding(.vertical, 6)
                                    .background(item.isAvailable ? palette.accent.opacity(0.22) : FoodTheme.surfaceRaised)
                                    .clipShape(Capsule())
                            }
                        }
                    }
                    HStack(spacing: 10) {
                        Text(foodMoney(item.priceCents, currency: item.currencyCode))
                            .font(.system(size: 15, weight: .black))
                            .foregroundStyle(item.isAvailable ? FoodTheme.basil : FoodTheme.muted)
                    }
                }
                Spacer()
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(item.isAvailable ? palette.accent.opacity(0.28) : FoodTheme.surfaceRaised)
                    Image(systemName: item.isAvailable ? "plus" : "minus")
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(item.isAvailable ? palette.primary : FoodTheme.muted)
                }
                .frame(width: 50, height: 50)
            }
            .padding(16)
            .background(
                LinearGradient(
                    colors: [FoodTheme.surface, item.isAvailable ? palette.accent.opacity(0.08) : FoodTheme.surface],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(FoodTheme.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(!item.isAvailable)
    }
}

/// Item configurator: size/topping option groups, quantity, and notes -
/// the McDonald's "make it a meal" step.
private struct MenuItemSheet: View {
    @EnvironmentObject private var store: FoodStore
    @Environment(\.dismiss) private var dismiss
    let item: FoodMenuItem

    @State private var quantity = 1
    @State private var selected: [Int64: Set<Int64>] = [:]
    @State private var instructions = ""

    private var selectedModifiers: [FoodModifier] {
        item.modifierGroups.flatMap { group in
            group.options.filter { selected[group.id]?.contains($0.id) == true }
        }
    }
    private var unitTotal: Int {
        item.priceCents + selectedModifiers.reduce(0) { $0 + $1.priceDeltaCents }
    }
    private var missingRequired: Bool {
        item.modifierGroups.contains { group in
            group.isRequired && (selected[group.id]?.count ?? 0) < max(1, group.minSelect)
        }
    }
    private var selectedModifierCount: Int {
        selected.values.reduce(0) { $0 + $1.count }
    }
    private var totalPriceLabel: String {
        foodMoney(unitTotal * quantity, currency: item.currencyCode)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(alignment: .top, spacing: 16) {
                            RemoteFoodImage(urlString: item.imageUrl) {
                                CustomerBrandIllustration(style: .hero, animate: true)
                            }
                            .frame(width: 82, height: 82)
                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                            VStack(alignment: .leading, spacing: 10) {
                                Text(item.name)
                                    .font(.system(size: 28, weight: .black))
                                    .foregroundStyle(FoodTheme.ink)

                                Text(item.description ?? customerText(
                                    store.customerLanguage,
                                    "Build it your way before it goes to the kitchen.",
                                    "Personalizalo antes de enviarlo a cocina.",
                                    "Personnalisez-le avant l'envoi en cuisine.",
                                    "Pèsonalize li anvan li ale nan kwizin nan."
                                ))
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)

                                HStack(spacing: 10) {
                                    Label(totalPriceLabel, systemImage: "flame.fill")
                                        .font(.system(size: 12, weight: .black))
                                        .foregroundStyle(FoodTheme.flame)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 8)
                                        .background(FoodTheme.flameSoft)
                                        .clipShape(Capsule())

                                    if selectedModifierCount > 0 {
                                        Label("\(selectedModifierCount) " + customerText(store.customerLanguage, "choices", "opciones", "choix", "chwa"), systemImage: "slider.horizontal.3")
                                            .font(.system(size: 12, weight: .black))
                                            .foregroundStyle(FoodTheme.blue)
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 8)
                                            .background(FoodTheme.blue.opacity(0.12))
                                            .clipShape(Capsule())
                                    }
                                }
                            }
                        }
                        if !item.allergens.isEmpty {
                            Label(item.allergens.joined(separator: ", "), systemImage: "exclamationmark.triangle.fill")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(FoodTheme.saffron)
                        }
                    }
                    .foodCard(padding: 20)

                    ForEach(item.modifierGroups) { group in
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(group.name)
                                        .font(.system(size: 18, weight: .black))
                                        .foregroundStyle(FoodTheme.ink)
                                    Text(modifierPrompt(for: group))
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(FoodTheme.muted)
                                }
                                Spacer()
                                if group.isRequired {
                                    Text(customerText(store.customerLanguage, "Required", "Obligatorio", "Obligatoire", "Obligatwa"))
                                        .font(.system(size: 11, weight: .black))
                                        .foregroundStyle(FoodTheme.flame)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 7)
                                        .background(FoodTheme.flameSoft)
                                        .clipShape(Capsule())
                                }
                            }
                            ForEach(group.options.filter(\.isAvailable)) { option in
                                Button {
                                    toggle(group: group, option: option)
                                } label: {
                                    HStack(spacing: 12) {
                                        ZStack {
                                            Circle()
                                                .fill(isSelected(option, in: group) ? FoodTheme.flame : FoodTheme.surfaceRaised)
                                            Image(systemName: isSelected(option, in: group)
                                                  ? "checkmark"
                                                  : (group.maxSelect == 1 ? "circle" : "plus"))
                                                .font(.system(size: 12, weight: .black))
                                                .foregroundStyle(isSelected(option, in: group) ? .white : FoodTheme.muted)
                                        }
                                        .frame(width: 28, height: 28)

                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(option.name)
                                                .foregroundStyle(FoodTheme.ink)
                                            Text(isSelected(option, in: group)
                                                 ? customerText(store.customerLanguage, "Added to your order", "Agregado a tu pedido", "Ajoute a votre commande", "Ajoute nan komann ou")
                                                 : customerText(store.customerLanguage, "Tap to include", "Toca para incluir", "Touchez pour ajouter", "Peze pou mete l"))
                                                .font(.system(size: 11, weight: .medium))
                                                .foregroundStyle(FoodTheme.muted)
                                        }
                                        Spacer()
                                        if option.priceDeltaCents != 0 {
                                            Text("+\(foodMoney(option.priceDeltaCents, currency: item.currencyCode))")
                                                .foregroundStyle(isSelected(option, in: group) ? FoodTheme.flame : FoodTheme.muted)
                                        }
                                    }
                                    .font(.system(size: 14, weight: .semibold))
                                    .padding(14)
                                    .background(isSelected(option, in: group) ? FoodTheme.flameSoft : FoodTheme.surfaceRaised)
                                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                                            .stroke(isSelected(option, in: group) ? FoodTheme.flame.opacity(0.35) : FoodTheme.line, lineWidth: 1)
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .foodCard(padding: 16)
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        Text(customerText(store.customerLanguage, "Quantity", "Cantidad", "Quantite", "Kantite"))
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        HStack(spacing: 16) {
                            quantityButton(systemName: "minus", disabled: quantity == 1) {
                                quantity -= 1
                            }
                            Text("\(quantity)")
                                .font(.system(size: 28, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                                .frame(minWidth: 48)
                            quantityButton(systemName: "plus", disabled: quantity == 99) {
                                quantity += 1
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 4) {
                                Text(customerText(store.customerLanguage, "Current total", "Total actual", "Total actuel", "Total aktyel"))
                                    .font(.system(size: 11, weight: .black))
                                    .textCase(.uppercase)
                                    .tracking(1)
                                    .foregroundStyle(FoodTheme.muted)
                                Text(totalPriceLabel)
                                    .font(.system(size: 22, weight: .black))
                                    .foregroundStyle(FoodTheme.flame)
                            }
                        }
                    }
                    .foodCard(padding: 18)

                    VStack(alignment: .leading, spacing: 12) {
                        Text(customerText(store.customerLanguage, "Special instructions", "Instrucciones especiales", "Instructions speciales", "Enstriksyon espesyal"))
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        TextField(customerText(store.customerLanguage, "Optional note for the kitchen", "Nota opcional para cocina", "Note optionnelle pour la cuisine", "Nòt opsyonèl pou kwizin nan"), text: $instructions, axis: .vertical)
                            .textFieldStyle(.roundedBorder)
                            .lineLimit(3...5)
                        Text(customerText(store.customerLanguage, "Keep it short and clear so the team can move fast.", "Mantenlo corto y claro para que el equipo avance rapido.", "Restez bref et clair pour aider l'equipe a aller vite.", "Kenbe li kout ak klè pou ekip la ka avanse vit."))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    .foodCard(padding: 18)
                }
                .padding(16)
                .padding(.bottom, 110)
            }
            .background(FoodTheme.background)
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 10) {
                    if missingRequired {
                        Text(customerText(store.customerLanguage, "Select every required option to continue.", "Selecciona todas las opciones obligatorias para continuar.", "Choisissez toutes les options obligatoires pour continuer.", "Chwazi tout opsyon obligatwa yo pou kontinye."))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(FoodTheme.saffron)
                    }

                    Button {
                        store.addToCart(CartLine(
                            item: item,
                            quantity: quantity,
                            modifiers: selectedModifiers,
                            specialInstructions: instructions.trimmingCharacters(in: .whitespacesAndNewlines)
                        ))
                        dismiss()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(customerText(store.customerLanguage, "Add to order", "Agregar al pedido", "Ajouter a la commande", "Ajoute nan komann"))
                                    .font(.system(size: 16, weight: .black))
                                Text("\(quantity)x \(item.name)")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(.white.opacity(0.82))
                                    .lineLimit(1)
                            }
                            Spacer()
                            Text(totalPriceLabel)
                                .font(.system(size: 18, weight: .black))
                            Image(systemName: "arrow.up.forward.circle.fill")
                                .font(.system(size: 22, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 16)
                        .background(missingRequired ? FoodTheme.muted : FoodTheme.flame)
                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(missingRequired)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 10)
                .background(.ultraThinMaterial)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(customerText(store.customerLanguage, "Cancel", "Cancelar", "Annuler", "Anile")) { dismiss() }
                }
            }
        }
    }

    private func isSelected(_ option: FoodModifier, in group: FoodModifierGroup) -> Bool {
        selected[group.id]?.contains(option.id) == true
    }

    private func modifierPrompt(for group: FoodModifierGroup) -> String {
        if group.maxSelect == 1 {
            return customerText(
                store.customerLanguage,
                "Choose 1 option",
                "Elige 1 opcion",
                "Choisissez 1 option",
                "Chwazi 1 opsyon"
            )
        }
        let range = customerText(
            store.customerLanguage,
            "Choose up to \(group.maxSelect)",
            "Elige hasta \(group.maxSelect)",
            "Choisissez jusqu'a \(group.maxSelect)",
            "Chwazi jiska \(group.maxSelect)"
        )
        if group.minSelect > 0 {
            return range + " · " + customerText(
                store.customerLanguage,
                "minimum \(group.minSelect)",
                "minimo \(group.minSelect)",
                "minimum \(group.minSelect)",
                "omwen \(group.minSelect)"
            )
        }
        return range
    }

    private func quantityButton(systemName: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .black))
                .foregroundStyle(disabled ? FoodTheme.muted : .white)
                .frame(width: 42, height: 42)
                .background(disabled ? FoodTheme.surfaceRaised : FoodTheme.flame)
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private func toggle(group: FoodModifierGroup, option: FoodModifier) {
        var current = selected[group.id] ?? []
        if current.contains(option.id) {
            current.remove(option.id)
        } else {
            if group.maxSelect == 1 { current.removeAll() }
            guard current.count < group.maxSelect else { return }
            current.insert(option.id)
        }
        selected[group.id] = current
    }
}

private struct CartPanel: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Label(customerText(store.customerLanguage, "Your order", "Tu pedido", "Votre commande", "Komann ou"), systemImage: "bag.fill")
                        .font(.system(size: 20, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Text(customerText(store.customerLanguage, "Final review before checkout", "Revision final antes de pagar", "Revision finale avant paiement", "Dènye revizyon anvan peman"))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                }
                Spacer()
                Text(foodMoney(store.cartTotalCents, currency: store.selectedRestaurant?.currencyCode ?? "USD"))
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(FoodTheme.flame)
            }

            if store.cart.isEmpty {
                Text(customerText(store.customerLanguage, "Add items to start an order.", "Agrega articulos para empezar un pedido.", "Ajoutez des articles pour commencer une commande.", "Ajoute atik pou komanse yon komann."))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
            } else {
                ForEach(store.cart) { line in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(line.quantity)x \(line.item.name)")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(FoodTheme.ink)
                            if !line.modifierSummary.isEmpty {
                                Text(line.modifierSummary)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(FoodTheme.muted)
                            }
                        }
                        Spacer()
                        Text(foodMoney(line.lineTotalCents, currency: line.item.currencyCode))
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(FoodTheme.ink)
                        Button {
                            store.removeCartLine(line)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(FoodTheme.muted)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(customerText(store.customerLanguage, "Items", "Articulos", "Articles", "Atik"))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                        Spacer()
                        Text("\(store.cartItemCount)")
                            .font(.system(size: 13, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                    }
                    HStack {
                        Text(customerText(store.customerLanguage, "Payment", "Pago", "Paiement", "Peman"))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                        Spacer()
                        Text(paymentLabel)
                            .font(.system(size: 13, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                    }
                    HStack {
                        Text(customerText(store.customerLanguage, "Fulfillment", "Entrega", "Retrait", "Resevwa"))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                        Spacer()
                        Text(store.fulfillment == "dine_in"
                             ? customerText(store.customerLanguage, "Dine in", "Comer aqui", "Sur place", "Manje la")
                             : customerText(store.customerLanguage, "Pickup", "Recoger", "A emporter", "Pran"))
                            .font(.system(size: 13, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                    }
                }
                .padding(14)
                .background(FoodTheme.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                Label(paymentSupportCopy, systemImage: store.onlineCheckoutAvailable && store.customerPaymentMode == "pay_now" ? "creditcard.fill" : "banknote.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(store.onlineCheckoutAvailable && store.customerPaymentMode == "pay_now" ? FoodTheme.blue : FoodTheme.saffron)

                Button {
                    Task { await store.submitOrder() }
                } label: {
                    HStack {
                        if store.isPlacingOrder {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        }
                        Label(primaryCTA, systemImage: store.onlineCheckoutAvailable && store.customerPaymentMode == "pay_now" ? "creditcard.fill" : "paperplane.fill")
                    }
                    .font(.system(size: 16, weight: .black))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FoodTheme.flame)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(store.isPlacingOrder)
            }
        }
        .foodCard(padding: 16)
    }

    private var primaryCTA: String {
        if store.onlineCheckoutAvailable && store.customerPaymentMode == "pay_now" {
            return customerText(store.customerLanguage, "Continue to secure checkout", "Continuar al pago seguro", "Continuer vers le paiement securise", "Kontinye nan peman sekirize")
        }
        return customerText(store.customerLanguage, "Place order", "Hacer pedido", "Passer la commande", "Voye komann")
    }

    private var paymentLabel: String {
        if store.onlineCheckoutAvailable && store.customerPaymentMode == "pay_now" {
            return customerText(store.customerLanguage, "Secure checkout", "Pago seguro", "Paiement securise", "Peman sekirize")
        }
        return customerText(store.customerLanguage, "Pay at restaurant", "Pagar en el local", "Payer au restaurant", "Peye nan restoran an")
    }

    private var paymentSupportCopy: String {
        if store.onlineCheckoutAvailable && store.customerPaymentMode == "pay_now" {
            return customerText(store.customerLanguage, "You'll review and complete payment in secure checkout after placing this order.", "Revisaras y completaras el pago en el pago seguro despues de enviar el pedido.", "Vous finaliserez le paiement dans le paiement securise apres avoir envoye la commande.", "W ap revize epi fini peman an nan peman sekirize apre ou fin voye komann lan.")
        }
        return customerText(store.customerLanguage, "You pay at the restaurant when you pick up.", "Pagas en el restaurante al recoger.", "Vous payez au restaurant lors du retrait.", "Ou peye nan restoran an lè w ap pran l.")
    }
}

private struct OrderMiniCartDock: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(customerText(store.customerLanguage, "Review order", "Revisar pedido", "Verifier la commande", "Revize komann"))
                        .font(.system(size: 16, weight: .black))
                        .foregroundStyle(.white)
                    Text("\(store.cartItemCount) " + customerText(store.customerLanguage, "items", "articulos", "articles", "atik"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.82))
                }
                Spacer()
                Text(foodMoney(store.cartTotalCents, currency: store.selectedRestaurant?.currencyCode ?? "USD"))
                    .font(.system(size: 16, weight: .black))
                    .foregroundStyle(.white)
                Image(systemName: "arrow.down.circle.fill")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(FoodTheme.flame)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .shadow(color: FoodTheme.flameDeep.opacity(0.22), radius: 16, x: 0, y: 10)
        }
        .buttonStyle(.plain)
    }

    let action: () -> Void
}

// MARK: - Order confirmation (the big number screen)

struct OrderConfirmationView: View {
    @EnvironmentObject private var store: FoodStore
    @Environment(\.openURL) private var openURL
    let order: FoodOrder
    @State private var watchingQueue = false

    var body: some View {
        ZStack {
            FoodTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 18) {
                    VStack(alignment: .leading, spacing: 18) {
                        HStack {
                            Label(customerText(store.customerLanguage, "Confirmed", "Confirmado", "Confirmee", "Konfime"), systemImage: "checkmark.seal.fill")
                                .font(.system(size: 13, weight: .black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(.white.opacity(0.16))
                                .clipShape(Capsule())
                            Spacer()
                            Text(foodMoney(order.totalCents, currency: order.currencyCode))
                                .font(.system(size: 22, weight: .black))
                                .foregroundStyle(.white)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text(customerText(store.customerLanguage, "Order placed!", "Pedido realizado", "Commande passee", "Komann pase"))
                                .font(.system(size: 30, weight: .black))
                                .foregroundStyle(.white)
                            Text(confirmationDetail)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(.white.opacity(0.82))
                        }

                        HStack(alignment: .center, spacing: 16) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(customerText(store.customerLanguage, "Queue number", "Numero", "Numero", "Nimewo"))
                                    .font(.system(size: 12, weight: .black))
                                    .textCase(.uppercase)
                                    .tracking(1)
                                    .foregroundStyle(.white.opacity(0.7))
                                Text("#\(order.queueNumber)")
                                    .font(.system(size: 64, weight: .black))
                                    .foregroundStyle(.white)
                            }
                            Spacer()
                            VStack(alignment: .leading, spacing: 10) {
                                CustomerConfirmationStat(
                                    title: customerText(store.customerLanguage, "Payment", "Pago", "Paiement", "Peman"),
                                    value: order.paymentStatus.replacingOccurrences(of: "_", with: " ").capitalized
                                )
                                CustomerConfirmationStat(
                                    title: customerText(store.customerLanguage, "Fulfillment", "Entrega", "Retrait", "Resevwa"),
                                    value: order.fulfillmentType.replacingOccurrences(of: "_", with: " ").capitalized
                                )
                            }
                        }
                    }
                    .padding(22)
                    .background(FoodTheme.heroGradient)
                    .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
                    .overlay(alignment: .topTrailing) {
                        CustomerBrandIllustration(style: .hero, animate: true)
                            .frame(width: 120, height: 120)
                            .opacity(0.92)
                            .padding(.trailing, 14)
                            .padding(.top, 10)
                            .allowsHitTesting(false)
                    }

                    OrderProgressCard(order: order, language: store.customerLanguage)

                    VStack(alignment: .leading, spacing: 12) {
                        Text(customerText(store.customerLanguage, "What's next", "Que sigue", "La suite", "Sa k ap vini"))
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        ConfirmationTimelineRow(
                            icon: "paperplane.fill",
                            title: customerText(store.customerLanguage, "Order sent", "Pedido enviado", "Commande envoyee", "Komann voye"),
                            detail: customerText(store.customerLanguage, "The restaurant has your ticket and queue number.", "El restaurante ya tiene tu ticket y numero.", "Le restaurant a recu votre ticket et votre numero.", "Restoran an deja resevwa tikè ak nimewo ou.")
                        )
                        ConfirmationTimelineRow(
                            icon: store.lastPlacedOrderPayment?.status == "requires_payment" ? "creditcard.fill" : "fork.knife",
                            title: store.lastPlacedOrderPayment?.status == "requires_payment"
                                ? customerText(store.customerLanguage, "Finish payment", "Finaliza el pago", "Terminez le paiement", "Fini peman an")
                                : customerText(store.customerLanguage, "Head to the restaurant", "Ve al restaurante", "Rendez-vous au restaurant", "Ale nan restoran an"),
                            detail: confirmationTimelineDetail
                        )
                    }
                    .foodCard(padding: 18)

                    HStack(spacing: 12) {
                        ConfirmationSupportCard(
                            icon: "bell.badge.fill",
                            title: customerText(store.customerLanguage, "Stay ready", "Mantente listo", "Restez pret", "Rete pare"),
                            detail: customerText(store.customerLanguage, "Keep alerts on so the app can flag when your number moves.", "Mantén las alertas activas para saber cuando tu numero cambie.", "Gardez les alertes actives pour suivre votre numero.", "Kenbe alèt yo limen pou wè lè nimewo ou avanse.")
                        )
                        ConfirmationSupportCard(
                            icon: "location.fill",
                            title: customerText(store.customerLanguage, "Pickup plan", "Plan de retiro", "Plan de retrait", "Plan retrè"),
                            detail: order.fulfillmentType == "dine_in"
                                ? customerText(store.customerLanguage, "Your team will hand off when the board shows ready.", "El equipo te lo entregara cuando la pantalla marque listo.", "L'equipe vous servira quand l'ecran affichera pret.", "Ekip la ap remèt ou li lè tablo a montre li pare.")
                                : customerText(store.customerLanguage, "Head over when your number reaches ready on the board.", "Ve cuando tu numero llegue a listo en la pantalla.", "Dirigez-vous au restaurant quand votre numero passe a pret.", "Ale pran li lè nimewo ou rive sou pare nan tablo a.")
                        )
                    }

                    if let checkoutURL = store.lastPlacedOrderPayment?.checkoutUrl,
                       store.lastPlacedOrderPayment?.status == "requires_payment",
                       let url = URL(string: checkoutURL) {
                        Button {
                            openURL(url)
                        } label: {
                            Label(customerText(store.customerLanguage, "Open secure checkout", "Abrir pago seguro", "Ouvrir le paiement securise", "Louvri peman sekirize"), systemImage: "creditcard.fill")
                                .font(.system(size: 16, weight: .black))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(FoodTheme.flame)
                                .foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(customerText(store.customerLanguage, "Live queue", "Fila en vivo", "File en direct", "Liy an dirèk"))
                                .font(.system(size: 18, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Spacer()
                            Button(watchingQueue
                                   ? customerText(store.customerLanguage, "Hide", "Ocultar", "Masquer", "Kache")
                                   : customerText(store.customerLanguage, "Watch", "Ver", "Voir", "Gade")) {
                                watchingQueue.toggle()
                            }
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(FoodTheme.flame)
                        }

                        if watchingQueue {
                            QueueBoardLive(restaurantId: order.restaurantId, highlight: order.queueNumber)
                        } else {
                            Text(customerText(store.customerLanguage, "Open the queue board to watch your number move from preparing to ready.", "Abre la fila para ver tu numero pasar de preparando a listo.", "Ouvrez la file pour suivre votre numero de preparation a pret.", "Louvri tablo liy la pou gade nimewo ou pase soti nan preparasyon rive pare."))
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }
                    }
                    .foodCard(padding: 18)

                    Button {
                        store.lastPlacedOrder = nil
                        store.lastPlacedOrderPayment = nil
                        store.lastPlacedOrderTrackingToken = nil
                    } label: {
                        Text(customerText(store.customerLanguage, "Done", "Listo", "Termine", "Fini"))
                            .font(.system(size: 16, weight: .black))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(FoodTheme.surface)
                            .foregroundStyle(FoodTheme.ink)
                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .stroke(FoodTheme.line, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
                .padding(16)
            }
        }
        .task(id: store.lastPlacedOrderTrackingToken) {
            while !Task.isCancelled, store.lastPlacedOrderTrackingToken != nil {
                await store.refreshPlacedOrderIfNeeded()
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            }
        }
    }

    private var confirmationDetail: String {
        if store.lastPlacedOrderPayment?.status == "requires_payment" {
            return customerText(
                store.customerLanguage,
                "Complete secure checkout now, then watch for your number on the board.",
                "Completa el pago seguro ahora y luego mira tu numero en la pantalla.",
                "Terminez le paiement securise maintenant puis surveillez votre numero sur l'ecran.",
                "Fini peman sekirize a kounye a epi gade nimewo ou sou tablo a."
            )
        }
        return customerText(
            store.customerLanguage,
            "Pay at the counter and watch for your number on the board.",
            "Paga en el mostrador y mira tu numero en la pantalla.",
            "Payez au comptoir et surveillez votre numero sur l'ecran.",
            "Peye nan kontwa a epi gade nimewo ou sou tablo a."
        )
    }

    private var confirmationTimelineDetail: String {
        if store.lastPlacedOrderPayment?.status == "requires_payment" {
            return customerText(
                store.customerLanguage,
                "Complete secure checkout, then return here to keep tracking your order.",
                "Completa el pago seguro y vuelve aqui para seguir tu pedido.",
                "Terminez le paiement securise puis revenez ici pour suivre votre commande.",
                "Fini peman sekirize a epi tounen isit la pou kontinye swiv komann ou."
            )
        }
        return customerText(
            store.customerLanguage,
            "Pay at pickup or dine-in handoff, then watch for your queue number.",
            "Paga al recoger o al llegar a la mesa y luego sigue tu numero.",
            "Payez au retrait ou sur place puis surveillez votre numero.",
            "Peye lè w ap pran li oswa sou plas epi gade nimewo ou."
        )
    }
}

/// Live "Preparing / Now ready" numbers, polled from the public queue board.
struct QueueBoardLive: View {
    @EnvironmentObject private var store: FoodStore
    let restaurantId: Int64
    var highlight: Int?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            column(customerText(store.customerLanguage, "Preparing", "Preparando", "Preparation", "Ap prepare"), numbers: store.queueBoard?.preparing ?? [], color: FoodTheme.saffron)
            column(customerText(store.customerLanguage, "Now ready", "Listo ahora", "Pret maintenant", "Pare kounye a"), numbers: store.queueBoard?.ready ?? [], color: FoodTheme.basil)
        }
        .task(id: restaurantId) {
            await RestaurantDisplayRefresh.run(restaurantId: restaurantId) {
                await store.refreshQueueBoard(restaurantId: restaurantId)
            }
        }
    }

    private func column(_ title: String, numbers: [Int], color: Color) -> some View {
        VStack(spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 12, weight: .black))
                .foregroundStyle(color)
            if numbers.isEmpty {
                Text(customerText(store.customerLanguage, "None yet", "Aun no", "Rien pour l'instant", "Poko gen anyen"))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
            }
            ForEach(numbers, id: \.self) { number in
                Text("#\(number)")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(number == highlight ? .white : FoodTheme.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(number == highlight ? color : FoodTheme.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .frame(maxWidth: .infinity)
        .foodCard(padding: 12)
    }
}

// MARK: - Track

struct TrackView: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                TrackingHubHero(
                    language: store.customerLanguage,
                    activeOrder: activeOrder,
                    notificationsEnabled: store.customerNotificationsEnabled,
                    historyCount: store.myOrders.count
                )

                if let active = activeOrder {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(customerText(store.customerLanguage, "Live order", "Pedido en vivo", "Commande en direct", "Komann an dirèk"))
                                    .font(.system(size: 12, weight: .black))
                                    .textCase(.uppercase)
                                    .tracking(1)
                                    .foregroundStyle(.white.opacity(0.72))
                                Text(active.restaurantName ?? customerText(store.customerLanguage, "Your order", "Tu pedido", "Votre commande", "Komann ou"))
                                    .font(.system(size: 24, weight: .black))
                                    .foregroundStyle(.white)
                                Text(trackStatusCopy(for: active))
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(.white.opacity(0.82))
                            }
                            Spacer()
                            Text("#\(active.queueNumber)")
                                .font(.system(size: 40, weight: .black))
                                .foregroundStyle(.white)
                        }

                        HStack(spacing: 12) {
                            TrackingPill(icon: "shippingbox.fill", label: active.fulfillmentType.replacingOccurrences(of: "_", with: " ").capitalized)
                            TrackingPill(icon: "creditcard.fill", label: active.paymentStatus.replacingOccurrences(of: "_", with: " ").capitalized)
                            TrackingPill(icon: "dollarsign.circle.fill", label: foodMoney(active.totalCents, currency: active.currencyCode))
                        }

                        if let createdAt = active.createdAt {
                            Text(customerText(store.customerLanguage, "Placed", "Realizado", "Passee", "Pase") + " " + compactOrderTimestamp(createdAt))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.78))
                        }
                    }
                    .padding(20)
                    .background(
                        LinearGradient(
                            colors: [statusColor(active.status), FoodTheme.flameDeep],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))

                    OrderProgressCard(order: active, language: store.customerLanguage)

                    if active.status == "completed" && !active.hasReview {
                        OrderReviewPromptCard(order: active, language: store.customerLanguage)
                            .environmentObject(store)
                    }

                    HStack(spacing: 12) {
                        TrackingSnapshotCard(
                            title: customerText(store.customerLanguage, "Queue", "Fila", "File", "Liy"),
                            value: "#\(active.queueNumber)",
                            detail: customerText(store.customerLanguage, "watch this number", "sigue este numero", "surveillez ce numero", "gade nimewo sa a"),
                            icon: "number.circle.fill",
                            tone: FoodTheme.flame
                        )
                        TrackingSnapshotCard(
                            title: customerText(store.customerLanguage, "Status", "Estado", "Statut", "Eta"),
                            value: active.status.replacingOccurrences(of: "_", with: " ").capitalized,
                            detail: customerText(store.customerLanguage, "current stage", "etapa actual", "etape actuelle", "etap aktyel"),
                            icon: "waveform.path.ecg",
                            tone: statusColor(active.status)
                        )
                    }

                    QueueBoardLive(restaurantId: active.restaurantId, highlight: active.queueNumber)
                        .padding(.top, -4)
                } else {
                    VStack(spacing: 10) {
                        CustomerBrandIllustration(style: .tracking, animate: true)
                            .frame(width: 96, height: 96)
                        Text(customerText(store.customerLanguage, "Nothing live right now", "Nada en vivo por ahora", "Rien en direct pour l'instant", "Pa gen anyen an dirèk pou kounye a"))
                            .font(.system(size: 20, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        Text(customerText(store.customerLanguage, "Place an order and your queue number will appear here with live status updates.", "Haz un pedido y tu numero aparecera aqui con actualizaciones en vivo.", "Passez une commande et votre numero apparaitra ici avec un suivi en direct.", "Fè yon komann epi nimewo ou ap parèt isit la ak mizajou an dirèk."))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 22)
                    .foodCard(padding: 22)
                }

                if store.isSignedIn {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(customerText(store.customerLanguage, "Order history", "Historial de pedidos", "Historique des commandes", "Istwa komann"))
                                .font(.system(size: 20, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Spacer()
                            Text("\(store.myOrders.count)")
                                .font(.system(size: 13, weight: .black))
                                .foregroundStyle(FoodTheme.muted)
                        }

                        if store.myOrders.isEmpty {
                            Text(customerText(store.customerLanguage, "No past orders yet.", "Todavia no hay pedidos anteriores.", "Pas encore de commandes precedentes.", "Poko gen ansyen komann."))
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }
                        ForEach(store.myOrders) { order in
                            TrackingHistoryCard(order: order)
                        }
                    }
                } else {
                    Text(customerText(store.customerLanguage, "Sign in on the Merchant tab to keep your order history.", "Inicia sesion para guardar tu historial de pedidos.", "Connectez-vous pour conserver votre historique de commandes.", "Konekte pou konsève istwa komann ou."))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                }

                if !store.recentCustomerOrders.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(customerText(store.customerLanguage, "Quick reorder", "Repetir rapido", "Recommande rapide", "Refè komann rapid"))
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        ForEach(store.recentCustomerOrders.prefix(3)) { template in
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(template.restaurantName)
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundStyle(FoodTheme.ink)
                                    Text(template.lines.map { "\($0.quantity)x \($0.itemName)" }.joined(separator: ", "))
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(FoodTheme.muted)
                                        .lineLimit(2)
                                }
                                Spacer()
                                Button(customerText(store.customerLanguage, "Load", "Cargar", "Charger", "Chaje")) {
                                    Task { _ = await store.loadReorderTemplate(template) }
                                }
                                .buttonStyle(.borderedProminent)
                            }
                            .foodCard(padding: 14)
                        }
                    }
                }
            }
            .padding(16)
        }
        .task { await store.loadMyOrders() }
        .refreshable { await store.loadMyOrders() }
        .task(id: activeTrackKey) {
            guard let order = activeOrder, order.isActive || order.status == "completed" else { return }
            await RestaurantDisplayRefresh.run(restaurantId: order.restaurantId, intervalSeconds: 4) {
                if store.lastPlacedOrderTrackingToken != nil {
                    await store.refreshPlacedOrderIfNeeded()
                }
                if store.isSignedIn {
                    await store.loadMyOrders()
                }
            }
        }
    }

    private var activeTrackKey: String {
        guard let order = activeOrder else { return "none" }
        return "\(order.id)-\(order.status)-\(order.hasReview)"
    }

    private var activeOrder: FoodOrder? {
        if let placed = store.lastPlacedOrder { return placed }
        return store.myOrders.first(where: \.isActive)
    }

    private func trackStatusCopy(for order: FoodOrder) -> String {
        switch order.status {
        case "received", "accepted":
            return customerText(store.customerLanguage, "The restaurant has your order and is getting it into the queue.", "El restaurante ya recibio tu pedido y lo esta poniendo en la fila.", "Le restaurant a bien recu votre commande et la place dans la file.", "Restoran an resevwa komann ou epi l ap mete l nan liy la.")
        case "preparing":
            return customerText(store.customerLanguage, "Your order is being prepared right now.", "Tu pedido se esta preparando ahora mismo.", "Votre commande est en cours de preparation.", "Y ap prepare komann ou kounye a.")
        case "ready":
            return customerText(store.customerLanguage, "Your order is ready for pickup or table handoff.", "Tu pedido ya esta listo para recoger o entregar a la mesa.", "Votre commande est prete pour le retrait ou le service a table.", "Komann ou pare pou pran oswa pote sou tab la.")
        case "completed":
            return customerText(store.customerLanguage, "This order has been completed.", "Este pedido ya fue completado.", "Cette commande est terminee.", "Komann sa a fini.")
        case "cancelled":
            return customerText(store.customerLanguage, "This order was cancelled.", "Este pedido fue cancelado.", "Cette commande a ete annulee.", "Komann sa a anile.")
        default:
            return order.status.capitalized
        }
    }
}

private struct TrackingHubHero: View {
    let language: FoodCustomerLanguage
    let activeOrder: FoodOrder?
    let notificationsEnabled: Bool
    let historyCount: Int

    private var statusTone: Color {
        guard let activeOrder else { return FoodTheme.blue }
        return statusColor(activeOrder.status)
    }

    private var liveStatusLabel: String {
        guard let activeOrder else {
            return customerText(language, "No live ticket", "Sin ticket en vivo", "Aucun ticket en direct", "Pa gen tikè an dirèk")
        }
        return activeOrder.status.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private var heroDetail: String {
        if let activeOrder {
            return customerText(
                language,
                "Queue #\(activeOrder.queueNumber), \(activeOrder.paymentStatus.replacingOccurrences(of: "_", with: " ")) payment, and handoff timing all stay in one branded place.",
                "Fila #\(activeOrder.queueNumber), pago \(activeOrder.paymentStatus.replacingOccurrences(of: "_", with: " ")), y entrega en un solo lugar de marca.",
                "File #\(activeOrder.queueNumber), paiement \(activeOrder.paymentStatus.replacingOccurrences(of: "_", with: " ")), et retrait dans un seul hub de marque.",
                "Liy #\(activeOrder.queueNumber), peman \(activeOrder.paymentStatus.replacingOccurrences(of: "_", with: " ")), ak retrè nan yon sèl espas mak."
            )
        }
        return customerText(
            language,
            "Live queue status, payment state, and reorder access stay ready the moment your next order starts moving.",
            "El estado en vivo, el pago y el acceso para repetir quedan listos en cuanto tu proximo pedido empiece a moverse.",
            "Le suivi en direct, le paiement et le re-achat restent prets des que votre prochaine commande demarre.",
            "Eta an dirèk, peman, ak rekòmann rete pare depi pwochen komann ou kòmanse deplase."
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(activeOrder == nil ? FoodTheme.basil : statusTone)
                            .frame(width: 8, height: 8)
                        Text(customerText(language, "Tracking hub", "Centro de seguimiento", "Hub de suivi", "Sant swivi"))
                            .font(.system(size: 12, weight: .black))
                            .textCase(.uppercase)
                            .tracking(1)
                            .foregroundStyle(.white.opacity(0.82))
                    }

                    Text(customerText(language, "Track every step", "Sigue cada paso", "Suivez chaque etape", "Swiv chak etap"))
                        .font(.system(size: 34, weight: .black))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(heroDetail)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.8))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                CustomerBrandIllustration(style: .tracking, animate: true)
                    .frame(width: 92, height: 92)
            }

            HStack(spacing: 10) {
                TrackingHeroPill(
                    icon: notificationsEnabled ? "bell.badge.fill" : "bell.slash.fill",
                    label: notificationsEnabled
                        ? customerText(language, "Alerts on", "Alertas activas", "Alertes actives", "Alèt limen")
                        : customerText(language, "Alerts off", "Alertas apagadas", "Alertes off", "Alèt etenn")
                )
                TrackingHeroPill(
                    icon: activeOrder == nil ? "waveform.path" : "waveform.path.ecg",
                    label: liveStatusLabel
                )
                TrackingHeroPill(
                    icon: "clock.arrow.circlepath",
                    label: "\(historyCount) " + customerText(language, "saved orders", "pedidos guardados", "commandes enregistrees", "komann sove")
                )
            }

            HStack(spacing: 12) {
                TrackingHeroMetric(
                    eyebrow: customerText(language, "Live", "En vivo", "En direct", "An dirèk"),
                    value: activeOrder.map { "#\($0.queueNumber)" } ?? customerText(language, "Idle", "En espera", "En attente", "An repo"),
                    detail: activeOrder == nil
                        ? customerText(language, "ready for the next order", "listo para el proximo pedido", "pret pour la prochaine commande", "pare pou pwochen komann")
                        : customerText(language, "queue number", "numero de fila", "numero de file", "nimewo liy")
                )
                TrackingHeroMetric(
                    eyebrow: customerText(language, "History", "Historial", "Historique", "Istwa"),
                    value: "\(historyCount)",
                    detail: customerText(language, "recent orders", "pedidos recientes", "commandes recentes", "komann resan")
                )
            }
        }
        .padding(22)
        .background(
            LinearGradient(
                colors: [FoodTheme.blue, FoodTheme.flameDeep],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct TrackingHeroPill: View {
    let icon: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .bold))
            Text(label)
                .font(.system(size: 11, weight: .black))
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.white.opacity(0.12))
        .clipShape(Capsule())
    }
}

private struct TrackingHeroMetric: View {
    let eyebrow: String
    let value: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(eyebrow)
                .font(.system(size: 11, weight: .black))
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(.white.opacity(0.7))
            Text(value)
                .font(.system(size: 22, weight: .black))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(detail)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.72))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.white.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

private struct CustomerOrderHero: View {
    @EnvironmentObject private var store: FoodStore
    let restaurant: FoodRestaurant

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text(restaurant.status.replacingOccurrences(of: "_", with: " ").uppercased())
                            .font(.system(size: 10, weight: .black))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                            .background(.white.opacity(0.16))
                            .clipShape(Capsule())
                        if !restaurant.cuisineTags.isEmpty {
                            Text(restaurant.cuisineTags.prefix(2).joined(separator: " • "))
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white.opacity(0.8))
                        }
                    }

                    Text(restaurant.displayName)
                        .font(.system(size: 30, weight: .black))
                        .foregroundStyle(.white)

                    Text(restaurant.description ?? "Choose your fulfillment, customize your items, and place your order in a few taps.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.82))
                }
                Spacer()
                Button {
                    store.toggleFavorite(restaurant)
                } label: {
                    Image(systemName: store.isFavorite(restaurant) ? "heart.fill" : "heart")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(.white.opacity(0.14))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 12) {
                CustomerHeroMetric(
                    eyebrow: customerText(store.customerLanguage, "Prep", "Tiempo", "Prep", "Preparasyon"),
                    value: "\(restaurant.prepTimeMin)",
                    detail: customerText(store.customerLanguage, "minutes", "minutos", "minutes", "minit")
                )
                CustomerHeroMetric(
                    eyebrow: customerText(store.customerLanguage, "Service", "Servicio", "Service", "Sèvis"),
                    value: restaurant.fulfillmentModes.contains("dine_in")
                        ? customerText(store.customerLanguage, "2", "2", "2", "2")
                        : customerText(store.customerLanguage, "1", "1", "1", "1"),
                    detail: restaurant.fulfillmentModes.contains("dine_in")
                        ? customerText(store.customerLanguage, "pickup + dine in", "recoger + comer", "retrait + sur place", "pran + manje la")
                        : customerText(store.customerLanguage, "pickup mode", "modo recoger", "mode retrait", "mòd pran")
                )
            }

            HStack {
                Button(store.isFavorite(restaurant)
                       ? customerText(store.customerLanguage, "Favorited", "Favorito", "Favori", "Favori")
                       : customerText(store.customerLanguage, "Add to favorites", "Agregar a favoritos", "Ajouter aux favoris", "Ajoute nan favori")) {
                    store.toggleFavorite(restaurant)
                }
                .buttonStyle(.borderedProminent)

                if let recent = store.recentCustomerOrders.first(where: { $0.restaurantId == restaurant.id }) {
                    Button(customerText(store.customerLanguage, "Reorder last", "Repetir ultimo", "Recommander", "Refe dènye komann")) {
                        Task { _ = await store.loadReorderTemplate(recent) }
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .padding(22)
        .background(FoodTheme.heroGradient)
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
    }
}

private struct CustomerStepHeader: View {
    let eyebrow: String
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(eyebrow)
                .font(.system(size: 11, weight: .black))
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(FoodTheme.flame)
            Text(title)
                .font(.system(size: 22, weight: .black))
                .foregroundStyle(FoodTheme.ink)
        }
    }
}

private struct CustomerOrderModeCard: View {
    let title: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(FoodTheme.flame)
                .frame(width: 34, height: 34)
                .background(FoodTheme.flameSoft)
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(FoodTheme.muted)
                Text(value)
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(FoodTheme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct CustomerConfirmationStat: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 11, weight: .black))
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(.white.opacity(0.68))
            Text(value)
                .font(.system(size: 14, weight: .black))
                .foregroundStyle(.white)
        }
    }
}

private struct OrderProgressCard: View {
    let order: FoodOrder
    let language: FoodCustomerLanguage

    private var stages: [OrderProgressStage] {
        [
            OrderProgressStage(
                title: customerText(language, "Received", "Recibido", "Recue", "Resevwa"),
                detail: customerText(language, "Ticket opened", "Ticket abierto", "Ticket ouvert", "Tikè louvri")
            ),
            OrderProgressStage(
                title: customerText(language, "Preparing", "Preparando", "Preparation", "Ap prepare"),
                detail: customerText(language, "Kitchen is moving", "La cocina trabaja", "La cuisine avance", "Kwizin nan ap travay")
            ),
            OrderProgressStage(
                title: customerText(language, "Ready", "Listo", "Pret", "Pare"),
                detail: customerText(language, "Pickup or handoff", "Retiro o entrega", "Retrait ou service", "Pran oswa remèt")
            )
        ]
    }

    private var currentIndex: Int {
        switch order.status {
        case "received", "accepted":
            return 0
        case "preparing":
            return 1
        case "ready", "completed":
            return 2
        default:
            return 0
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(customerText(language, "Order journey", "Recorrido del pedido", "Parcours de la commande", "Wout komann lan"))
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Text(customerText(language, "A clearer view of where your order is right now.", "Una vista mas clara de donde esta tu pedido ahora mismo.", "Une vue plus claire de l'etat de votre commande.", "Yon fason pi klè pou wè kote komann ou ye kounye a."))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                }
                Spacer()
                Text("#\(order.queueNumber)")
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(FoodTheme.flame)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(FoodTheme.flameSoft)
                    .clipShape(Capsule())
            }

            HStack(alignment: .top, spacing: 10) {
                ForEach(Array(stages.enumerated()), id: \.offset) { index, stage in
                    OrderProgressNode(
                        stage: stage,
                        state: index < currentIndex ? .completed : (index == currentIndex ? .current : .upcoming),
                        showsConnector: index < stages.count - 1
                    )
                }
            }
        }
        .foodCard(padding: 18)
    }
}

private struct OrderProgressStage {
    let title: String
    let detail: String
}

private enum OrderProgressState {
    case completed
    case current
    case upcoming
}

private struct OrderProgressNode: View {
    let stage: OrderProgressStage
    let state: OrderProgressState
    let showsConnector: Bool

    private var tone: Color {
        switch state {
        case .completed, .current:
            return FoodTheme.flame
        case .upcoming:
            return FoodTheme.muted
        }
    }

    private var circleFill: Color {
        switch state {
        case .completed, .current:
            return FoodTheme.flame
        case .upcoming:
            return FoodTheme.surfaceRaised
        }
    }

    private var symbol: String {
        switch state {
        case .completed:
            return "checkmark"
        case .current:
            return "circle.fill"
        case .upcoming:
            return "circle"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(circleFill)
                    Image(systemName: symbol)
                        .font(.system(size: 11, weight: .black))
                        .foregroundStyle(state == .upcoming ? FoodTheme.muted : .white)
                }
                .frame(width: 26, height: 26)

                if showsConnector {
                    Capsule()
                        .fill(state == .upcoming ? FoodTheme.line : FoodTheme.flame.opacity(0.35))
                        .frame(height: 4)
                }
            }

            Text(stage.title)
                .font(.system(size: 14, weight: .black))
                .foregroundStyle(state == .upcoming ? FoodTheme.ink : tone)
            Text(stage.detail)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ConfirmationSupportCard: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(FoodTheme.flame)
            Text(title)
                .font(.system(size: 16, weight: .black))
                .foregroundStyle(FoodTheme.ink)
            Text(detail)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foodCard(padding: 16)
    }
}

private struct ConfirmationTimelineRow: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(FoodTheme.flame)
                .frame(width: 32, height: 32)
                .background(FoodTheme.flameSoft)
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(FoodTheme.ink)
                Text(detail)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
            }
            Spacer()
        }
    }
}

private struct OrderReviewPromptCard: View {
    @EnvironmentObject private var store: FoodStore
    let order: FoodOrder
    let language: FoodCustomerLanguage

    @State private var rating = 5
    @State private var bodyText = ""
    @State private var isSubmitting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(customerText(language, "How was your order?", "Como estuvo tu pedido?", "Comment etait votre commande?", "Kijan komann ou te ye?"))
                .font(.system(size: 18, weight: .black))
                .foregroundStyle(FoodTheme.ink)
            Text(customerText(language, "Rate your experience to help other diners.", "Califica tu experiencia para ayudar a otros.", "Notez votre experience pour aider les autres.", "Evalye eksperyans ou pou ede lòt moun."))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(FoodTheme.muted)

            HStack(spacing: 10) {
                ForEach(1...5, id: \.self) { star in
                    Button {
                        rating = star
                    } label: {
                        Image(systemName: star <= rating ? "star.fill" : "star")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundStyle(star <= rating ? FoodTheme.saffron : FoodTheme.line)
                    }
                    .buttonStyle(.plain)
                }
            }

            TextField(
                customerText(language, "Optional comment", "Comentario opcional", "Commentaire optionnel", "Kòmantè opsyonèl"),
                text: $bodyText,
                axis: .vertical
            )
            .lineLimit(3...5)
            .padding(12)
            .background(FoodTheme.surfaceRaised)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            Button {
                guard !isSubmitting else { return }
                isSubmitting = true
                Task {
                    let ok = await store.submitOrderReview(orderId: order.id, rating: rating, body: bodyText)
                    isSubmitting = false
                    if !ok { return }
                }
            } label: {
                Text(isSubmitting
                    ? customerText(language, "Submitting...", "Enviando...", "Envoi...", "Ap voye...")
                    : customerText(language, "Submit review", "Enviar reseña", "Envoyer l'avis", "Voye revi"))
                    .font(.system(size: 15, weight: .black))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(FoodTheme.flame)
            .disabled(isSubmitting)
        }
        .foodCard(padding: 16)
    }
}

private struct TrackingSnapshotCard: View {
    let title: String
    let value: String
    let detail: String
    let icon: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(tone)
            Text(title)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(FoodTheme.muted)
            Text(value)
                .font(.system(size: 20, weight: .black))
                .foregroundStyle(FoodTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(detail)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foodCard(padding: 16)
    }
}

private struct TrackingMetricCard: View {
    let title: String
    let value: String
    let tone: Color
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(tone)
            Text(title)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(FoodTheme.muted)
            Text(value)
                .font(.system(size: 20, weight: .black))
                .foregroundStyle(FoodTheme.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foodCard(padding: 16)
    }
}

private struct TrackingPill: View {
    let icon: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .bold))
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.white.opacity(0.14))
        .clipShape(Capsule())
    }
}

private struct TrackingHistoryCard: View {
    @EnvironmentObject private var store: FoodStore
    let order: FoodOrder

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("#\(order.queueNumber)")
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(FoodTheme.flame)
                if let createdAt = order.createdAt {
                    Text(compactOrderTimestamp(createdAt))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(FoodTheme.muted)
                }
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(order.restaurantName ?? "Restaurant")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(FoodTheme.ink)
                Text(order.items.map { "\($0.quantity)x \($0.itemName)" }.joined(separator: ", "))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    RestaurantFactPill(icon: "shippingbox.fill", label: order.fulfillmentType.replacingOccurrences(of: "_", with: " ").capitalized)
                    RestaurantFactPill(icon: "creditcard.fill", label: order.paymentStatus.replacingOccurrences(of: "_", with: " ").capitalized)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(order.status.capitalized)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(statusColor(order.status))
                Text(foodMoney(order.totalCents, currency: order.currencyCode))
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
            }
        }
        .foodCard(padding: 16)
    }
}

// MARK: - Merchant

struct MerchantView: View {
    @EnvironmentObject private var store: FoodStore
    @State private var showKitchen = false
    @State private var showNewRestaurant = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Merchant")
                        .font(.system(size: 30, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Spacer()
                    if store.isSignedIn {
                        Button("Sign out") { store.signOut() }
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(FoodTheme.muted)
                    }
                }

                if !store.isSignedIn {
                    SignInCard()
                } else {
                    if store.merchantRestaurants.isEmpty && store.merchantLoaded {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("No restaurant yet")
                                .font(.system(size: 18, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Text("Create your restaurant, build the menu, and go live - customers worldwide can then find and order from you.")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                            Button("Add my restaurant") { showNewRestaurant = true }
                                .buttonStyle(.borderedProminent)
                        }
                        .foodCard(padding: 16)
                    }

                    if !store.merchantRestaurants.isEmpty {
                        restaurantPicker
                        if let restaurant = store.merchantSelection {
                            statusCard(restaurant)
                            MerchantOrdersCard(showKitchen: $showKitchen)
                            AddMenuItemCard()
                        }
                        Button("Add another restaurant") { showNewRestaurant = true }
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(FoodTheme.muted)
                    }
                }
            }
            .padding(16)
        }
        .task { await store.loadMerchant() }
        .refreshable { await store.loadMerchant() }
        .sheet(isPresented: $showNewRestaurant) {
            NewRestaurantSheet()
        }
        .fullScreenCover(isPresented: $showKitchen) {
            KitchenDisplayView()
        }
    }

    private var restaurantPicker: some View {
        Picker("Restaurant", selection: Binding(
            get: { store.merchantSelection?.id ?? 0 },
            set: { id in
                store.merchantSelection = store.merchantRestaurants.first { $0.id == id }
                Task { await store.loadMerchantOrders() }
            }
        )) {
            ForEach(store.merchantRestaurants) { restaurant in
                Text(restaurant.displayName).tag(restaurant.id)
            }
        }
        .pickerStyle(.menu)
        .foodCard()
    }

    private func statusCard(_ restaurant: FoodRestaurant) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(restaurant.displayName)
                    .font(.system(size: 17, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Text(restaurant.status == "active" ? "Live - customers can order" : "Not live yet (\(restaurant.status))")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(restaurant.status == "active" ? FoodTheme.basil : FoodTheme.saffron)
            }
            Spacer()
            if restaurant.status == "active" {
                Button("Pause") { Task { await store.setRestaurantStatus("paused") } }
                    .buttonStyle(.bordered)
            } else {
                Button("Go Live") { Task { await store.setRestaurantStatus("active") } }
                    .buttonStyle(.borderedProminent)
            }
        }
        .foodCard(padding: 16)
    }
}

private struct SignInCard: View {
    @EnvironmentObject private var store: FoodStore
    @State private var email = ""
    @State private var password = ""
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Sign in with OxSteed", systemImage: "person.crop.circle.fill")
                .font(.system(size: 18, weight: .black))
                .foregroundStyle(FoodTheme.ink)
            Text("Use your OxSteed account to run your restaurant or keep your order history.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
            TextField("Email", text: $email)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)
            Button {
                working = true
                Task {
                    if await store.signIn(email: email, password: password) {
                        await store.loadMerchant()
                        await store.loadMyOrders()
                    }
                    working = false
                }
            } label: {
                HStack {
                    if working { ProgressView().controlSize(.small) }
                    Text("Sign in")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(working || email.isEmpty || password.isEmpty)
        }
        .foodCard(padding: 16)
    }
}

private struct MerchantOrdersCard: View {
    @EnvironmentObject private var store: FoodStore
    @Binding var showKitchen: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Live orders", systemImage: "bell.badge.fill")
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Spacer()
                Button {
                    showKitchen = true
                } label: {
                    Label("Kitchen", systemImage: "flame.fill")
                        .font(.system(size: 13, weight: .bold))
                }
                .buttonStyle(.bordered)
            }

            if store.merchantOrders.isEmpty {
                Text("No active orders right now.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
            }

            ForEach(store.merchantOrders) { order in
                MerchantOrderRow(order: order)
            }
        }
        .foodCard(padding: 16)
        .task(id: store.merchantSelection?.id) {
            while !Task.isCancelled {
                await store.loadMerchantOrders()
                try? await Task.sleep(nanoseconds: 7_000_000_000)
            }
        }
    }
}

private struct MerchantOrderRow: View {
    @EnvironmentObject private var store: FoodStore
    let order: FoodOrder

    private var nextStatus: (String, String)? {
        switch order.status {
        case "received", "accepted": return ("Prep", "preparing")
        case "preparing": return ("Ready", "ready")
        case "ready": return ("Done", "completed")
        default: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("#\(order.queueNumber)")
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Text(order.guestName ?? order.fulfillmentType.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(FoodTheme.muted)
                Spacer()
                Text(order.status.uppercased())
                    .font(.system(size: 10, weight: .black))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(statusColor(order.status))
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            Text(order.items.map { "\($0.quantity)x \($0.itemName)" }.joined(separator: ", "))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
                .lineLimit(2)
            HStack(spacing: 8) {
                Text(foodMoney(order.totalCents, currency: order.currencyCode))
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                if order.paymentStatus == "paid" {
                    Text("PAID")
                        .font(.system(size: 10, weight: .black))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(FoodTheme.basil)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                } else {
                    Button("Mark paid") { Task { await store.markOrderPaid(order) } }
                        .font(.system(size: 12, weight: .bold))
                        .buttonStyle(.bordered)
                }
                Spacer()
                if let (label, status) = nextStatus {
                    Button(label) { Task { await store.updateOrderStatus(order, status: status) } }
                        .font(.system(size: 12, weight: .black))
                        .buttonStyle(.borderedProminent)
                }
                if order.isActive {
                    Button("Cancel") { Task { await store.updateOrderStatus(order, status: "cancelled") } }
                        .font(.system(size: 12, weight: .bold))
                        .buttonStyle(.bordered)
                        .tint(.red)
                }
            }
        }
        .padding(10)
        .background(FoodTheme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct AddMenuItemCard: View {
    @EnvironmentObject private var store: FoodStore
    @State private var name = ""
    @State private var price = ""
    @State private var category = ""
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Add menu item", systemImage: "menucard.fill")
                .font(.system(size: 18, weight: .black))
                .foregroundStyle(FoodTheme.ink)
            TextField("Item name", text: $name)
                .textFieldStyle(.roundedBorder)
            TextField("Price (e.g. 8.99)", text: $price)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
            TextField("New category (optional, e.g. Burgers)", text: $category)
                .textFieldStyle(.roundedBorder)
            Button {
                working = true
                Task {
                    if await store.addMenuItem(name: name, priceText: price, categoryName: category) {
                        name = ""
                        price = ""
                        category = ""
                    }
                    working = false
                }
            } label: {
                HStack {
                    if working { ProgressView().controlSize(.small) }
                    Text("Publish item")
                }
            }
            .buttonStyle(.bordered)
            .disabled(working || name.isEmpty || price.isEmpty)
        }
        .foodCard(padding: 16)
    }
}

private struct NewRestaurantSheet: View {
    @EnvironmentObject private var store: FoodStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var cuisine = ""
    @State private var city = ""
    @State private var country = "US"
    @State private var currency = "USD"
    @State private var working = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Restaurant") {
                    TextField("Name", text: $name)
                    TextField("Description", text: $description, axis: .vertical)
                    TextField("Cuisines (comma separated)", text: $cuisine)
                }
                Section("Location") {
                    TextField("City", text: $city)
                    TextField("Country (2 letters)", text: $country)
                    TextField("Currency", text: $currency)
                }
                Section {
                    Button {
                        working = true
                        Task {
                            if await store.publishRestaurant(
                                name: name, description: description, cuisine: cuisine,
                                city: city, country: country, currency: currency
                            ) {
                                dismiss()
                            }
                            working = false
                        }
                    } label: {
                        HStack {
                            if working { ProgressView().controlSize(.small) }
                            Text("Create restaurant")
                        }
                    }
                    .disabled(working || name.trimmingCharacters(in: .whitespaces).isEmpty)
                } footer: {
                    Text("Your restaurant starts as a draft. Build the menu, then press Go Live.")
                }
            }
            .navigationTitle("Add restaurant")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Kitchen display (fullscreen)

struct KitchenDisplayView: View {
    @EnvironmentObject private var store: FoodStore
    @Environment(\.dismiss) private var dismiss

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Kitchen Display")
                                .font(.system(size: 30, weight: .black))
                                .foregroundStyle(.white)
                            Text(store.merchantSelection?.displayName ?? "")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.gray)
                        }
                        Spacer()
                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 30))
                                .foregroundStyle(.gray)
                        }
                        .buttonStyle(.plain)
                    }

                    ForEach(kitchenColumns, id: \.title) { column in
                        VStack(alignment: .leading, spacing: 10) {
                            Text("\(column.title) (\(column.orders.count))")
                                .font(.system(size: 16, weight: .black))
                                .foregroundStyle(column.color)
                            if column.orders.isEmpty {
                                Text("Nothing here")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(.gray)
                            }
                            LazyVGrid(columns: columns, spacing: 12) {
                                ForEach(column.orders) { order in
                                    KitchenTicket(order: order)
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
        }
        .task(id: store.merchantSelection?.id) {
            while !Task.isCancelled {
                await store.loadMerchantOrders()
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    private var kitchenColumns: [(title: String, color: Color, orders: [FoodOrder])] {
        let sorted = store.merchantOrders.sorted { $0.queueNumber < $1.queueNumber }
        return [
            ("New", FoodTheme.saffron, sorted.filter { $0.status == "received" || $0.status == "accepted" }),
            ("Preparing", FoodTheme.flame, sorted.filter { $0.status == "preparing" }),
            ("Ready", FoodTheme.basil, sorted.filter { $0.status == "ready" }),
        ]
    }
}

private struct KitchenTicket: View {
    @EnvironmentObject private var store: FoodStore
    let order: FoodOrder

    private var advance: (String, String)? {
        switch order.status {
        case "received", "accepted": return ("Start", "preparing")
        case "preparing": return ("Ready", "ready")
        case "ready": return ("Done", "completed")
        default: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("#\(order.queueNumber)")
                    .font(.system(size: 28, weight: .black))
                    .foregroundStyle(.white)
                Spacer()
                Text(order.status.uppercased())
                    .font(.system(size: 10, weight: .black))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(statusColor(order.status))
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }

            Text(order.tableLabel ?? order.fulfillmentType.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.gray)

            ForEach(order.items) { item in
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(item.quantity)x \(item.itemName)")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                    if let note = item.specialInstructions, !note.isEmpty {
                        Text(note)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(FoodTheme.saffron)
                    }
                }
            }

            if let (label, status) = advance {
                Button {
                    Task { await store.updateOrderStatus(order, status: status) }
                } label: {
                    Text(label)
                        .font(.system(size: 14, weight: .black))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(statusColor(order.status))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .background(Color(white: 0.10))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(white: 0.22)))
    }
}

func statusColor(_ status: String) -> Color {
    switch status {
    case "received": return FoodTheme.saffron
    case "accepted": return FoodTheme.blue
    case "preparing": return FoodTheme.flame
    case "ready": return FoodTheme.basil
    case "completed": return FoodTheme.muted
    case "cancelled", "refunded": return .red
    default: return FoodTheme.muted
    }
}

func compactOrderTimestamp(_ date: Date) -> String {
    date.formatted(
        .dateTime
            .month(.abbreviated)
            .day()
            .hour(.defaultDigits(amPM: .abbreviated))
            .minute()
    )
}
