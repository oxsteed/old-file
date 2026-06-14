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

    var body: some View {
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
        .task { await store.loadRestaurants() }
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
    @State private var tab = CustomerSubworkspace.discover

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WorkspaceSectionHeader(
                title: customerText(
                    store.customerLanguage,
                    "Customer ordering app",
                    "App de pedidos para clientes",
                    "App de commande client",
                    "Aplikasyon kliyan pou komann"
                ),
                subtitle: customerText(
                    store.customerLanguage,
                    "Discovery, menu browsing, cart, and order tracking for pickup and dine-in.",
                    "Descubrimiento, menu, carrito y seguimiento de pedidos para recoger o comer en el local.",
                    "Decouverte, menu, panier et suivi des commandes a emporter ou sur place.",
                    "Dekouvri restoran, gade meni, panier, ak swiv komann pou pran oswa manje sou plas."
                )
            )
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(CustomerSubworkspace.allCases) { item in
                        Button {
                            withAnimation(.spring(response: 0.25, dampingFraction: 0.88)) {
                                tab = item
                            }
                        } label: {
                            Text(item.title)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(tab == item ? .white : FoodTheme.ink)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .background(tab == item ? FoodTheme.flame : FoodTheme.surface)
                                .clipShape(Capsule())
                                .overlay(Capsule().stroke(tab == item ? FoodTheme.flame : FoodTheme.line))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

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

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(customerText(store.customerLanguage, "Loyalty", "Lealtad", "Fidelite", "Fidelite"))
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        Text(store.loyaltySummary.tierName)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(FoodTheme.flame)
                    }
                    Spacer()
                    Text("\(store.loyaltySummary.points) pts")
                        .font(.system(size: 24, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                }
                Text(store.loyaltySummary.rewardSummary)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
            }
            .foodCard(padding: 16)

            VStack(alignment: .leading, spacing: 10) {
                Text(customerText(store.customerLanguage, "Offers and rewards", "Ofertas y recompensas", "Offres et recompenses", "Of ak rekonpans"))
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                ForEach(store.customerOffers) { offer in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(offer.title)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(FoodTheme.ink)
                            Spacer()
                            Text(offer.code)
                                .font(.system(size: 11, weight: .black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 5)
                                .background(FoodTheme.flame)
                                .clipShape(Capsule())
                        }
                        Text(offer.detail)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    .foodCard(padding: 14)
                }
            }

            if !store.favoriteRestaurants.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text(customerText(store.customerLanguage, "Favorite restaurants", "Restaurantes favoritos", "Restaurants favoris", "Restoran pi renmen"))
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    ForEach(store.favoriteRestaurants) { restaurant in
                        Button {
                            Task {
                                await store.select(restaurant)
                                startReorder()
                            }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(restaurant.displayName)
                                        .font(.system(size: 15, weight: .bold))
                                        .foregroundStyle(FoodTheme.ink)
                                    Text(restaurant.locationLine)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(FoodTheme.muted)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundStyle(FoodTheme.muted)
                            }
                            .foodCard(padding: 14)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if !store.recentCustomerOrders.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text(customerText(store.customerLanguage, "Reorder", "Volver a pedir", "Commander a nouveau", "Komanse menm komann lan"))
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    ForEach(store.recentCustomerOrders) { template in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(template.restaurantName)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(FoodTheme.ink)
                            Text(template.lines.map { "\($0.quantity)x \($0.itemName)" }.joined(separator: ", "))
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                                .lineLimit(2)
                            Button(customerText(store.customerLanguage, "Load order", "Cargar pedido", "Charger la commande", "Chaje komann")) {
                                Task {
                                    if await store.loadReorderTemplate(template) {
                                        startReorder()
                                    }
                                }
                            }
                            .buttonStyle(.bordered)
                        }
                        .foodCard(padding: 14)
                    }
                }
            }
        }
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
    var openOrder: (() -> Void)? = nil

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("OxSteed Restaurants")
                                .font(.system(size: 30, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                            Text(customerText(store.customerLanguage, "Order ahead or in store. Pay at the counter.", "Pide con anticipacion o en el local. Paga en el mostrador.", "Commandez a l'avance ou sur place. Paiement au comptoir.", "Komannde davans oswa sou plas. Peye nan kontwa a."))
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }
                        Spacer()
                        Image(systemName: "fork.knife.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(FoodTheme.flame)
                    }

                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(FoodTheme.muted)
                        TextField("Search restaurants, food, cuisine", text: $store.searchText)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.search)
                            .onSubmit { Task { await store.loadRestaurants() } }
                        if store.isLoading {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }
                    .padding(12)
                    .background(FoodTheme.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                    HStack(spacing: 12) {
                        Picker("Language", selection: $store.customerLanguage) {
                            ForEach(FoodCustomerLanguage.allCases) { language in
                                Text(language.label).tag(language)
                            }
                        }
                        .pickerStyle(.menu)

                        Toggle(
                            customerText(store.customerLanguage, "Alerts", "Alertas", "Alertes", "Alèt"),
                            isOn: $store.customerNotificationsEnabled
                        )
                        .toggleStyle(.switch)
                        .font(.system(size: 12, weight: .semibold))
                    }
                }
                .foodCard(padding: 16)

                if !store.favoriteRestaurants.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(customerText(store.customerLanguage, "Favorites", "Favoritos", "Favoris", "Favori"))
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
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
                                            Text(restaurant.displayName)
                                                .font(.system(size: 14, weight: .bold))
                                                .foregroundStyle(FoodTheme.ink)
                                            Text(restaurant.locationLine)
                                                .font(.system(size: 11, weight: .medium))
                                                .foregroundStyle(FoodTheme.muted)
                                        }
                                        .frame(width: 180, alignment: .leading)
                                        .foodCard(padding: 14)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }

                Map(position: $camera) {
                    ForEach(store.restaurants) { restaurant in
                        if let coordinate = restaurant.coordinate {
                            Marker(restaurant.displayName, systemImage: "fork.knife", coordinate: coordinate)
                                .tint(FoodTheme.flame)
                        }
                    }
                }
                .frame(height: 240)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(alignment: .topLeading) {
                    Label("Restaurants on OxSteed Restaurants", systemImage: "location.fill")
                        .font(.system(size: 13, weight: .bold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(FoodTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .padding(10)
                }

                if store.restaurants.isEmpty && !store.isLoading {
                    VStack(spacing: 8) {
                        Image(systemName: "fork.knife")
                            .font(.system(size: 30))
                            .foregroundStyle(FoodTheme.muted)
                        Text("No restaurants found")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(FoodTheme.ink)
                        Text("Try a different search, or add your own restaurant from the Merchant tab.")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                            .multilineTextAlignment(.center)
                        Button("Retry") { Task { await store.loadRestaurants() } }
                            .buttonStyle(.bordered)
                    }
                    .frame(maxWidth: .infinity)
                    .foodCard(padding: 24)
                }

                VStack(spacing: 10) {
                    ForEach(store.restaurants) { restaurant in
                        RestaurantCard(restaurant: restaurant) {
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

private struct RestaurantCard: View {
    @EnvironmentObject private var store: FoodStore
    let restaurant: FoodRestaurant
    var action: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: action) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(FoodTheme.flame.opacity(0.14))
                        Image(systemName: "takeoutbag.and.cup.and.straw.fill")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundStyle(FoodTheme.flame)
                    }
                    .frame(width: 62, height: 62)

                    VStack(alignment: .leading, spacing: 5) {
                        Text(restaurant.displayName)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(FoodTheme.ink)
                        if !restaurant.cuisineTags.isEmpty {
                            Text(restaurant.cuisineTags.joined(separator: " / "))
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FoodTheme.basil)
                        }
                        Text(restaurant.locationLine.isEmpty ? "Global restaurant" : restaurant.locationLine)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 5) {
                        Text("\(restaurant.prepTimeMin)m")
                            .font(.system(size: 14, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        if let distanceKm = restaurant.distanceKm {
                            Text(String(format: "%.1f km", distanceKm))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(FoodTheme.muted)
                        }
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(FoodTheme.muted)
                    }
                }
            }
            .buttonStyle(.plain)
            Button {
                store.toggleFavorite(restaurant)
            } label: {
                Image(systemName: store.isFavorite(restaurant) ? "heart.fill" : "heart")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(store.isFavorite(restaurant) ? FoodTheme.flame : FoodTheme.muted)
                    .frame(width: 34)
            }
            .buttonStyle(.plain)
        }
        .foodCard()
    }
}

// MARK: - Order

struct OrderView: View {
    @EnvironmentObject private var store: FoodStore
    @State private var configuringItem: FoodMenuItem?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let restaurant = store.selectedRestaurant {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(restaurant.displayName)
                            .font(.system(size: 28, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        Text(restaurant.description ?? "Order from this restaurant. Payment happens at the counter.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)

                        HStack {
                            Button(store.isFavorite(restaurant)
                                   ? customerText(store.customerLanguage, "Favorited", "Favorito", "Favori", "Favori")
                                   : customerText(store.customerLanguage, "Add to favorites", "Agregar a favoritos", "Ajouter aux favoris", "Ajoute nan favori")) {
                                store.toggleFavorite(restaurant)
                            }
                            .buttonStyle(.bordered)

                            if let recent = store.recentCustomerOrders.first(where: { $0.restaurantId == restaurant.id }) {
                                Button(customerText(store.customerLanguage, "Reorder last", "Repetir ultimo", "Recommander", "Refe dènye komann")) {
                                    Task { _ = await store.loadReorderTemplate(recent) }
                                }
                                .buttonStyle(.bordered)
                            }
                        }

                        Picker("Fulfillment", selection: $store.fulfillment) {
                            Text(customerText(store.customerLanguage, "Pickup", "Recoger", "A emporter", "Pran")).tag("pickup")
                            Text(customerText(store.customerLanguage, "Dine In", "Comer aqui", "Sur place", "Manje la")).tag("dine_in")
                        }
                        .pickerStyle(.segmented)

                        if store.fulfillment == "dine_in" {
                            TextField("Table number (optional)", text: $store.tableLabel)
                                .textFieldStyle(.roundedBorder)
                        }
                        if !store.isSignedIn {
                            TextField("Your name (shown to the kitchen)", text: $store.guestName)
                                .textFieldStyle(.roundedBorder)
                        }
                    }
                    .foodCard(padding: 16)

                    if !restaurant.acceptsOnlineOrders {
                        Label("This restaurant is not taking app orders right now.", systemImage: "moon.zzz.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(FoodTheme.saffron)
                            .foodCard()
                    }

                    ForEach(store.menu) { section in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(section.name)
                                .font(.system(size: 20, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            ForEach(section.items) { item in
                                MenuItemRow(item: item) {
                                    configuringItem = item
                                }
                            }
                        }
                    }

                    if store.menu.isEmpty {
                        Text("This restaurant is still building its menu.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                            .frame(maxWidth: .infinity)
                            .foodCard(padding: 20)
                    }

                    CartPanel()
                } else {
                    VStack(spacing: 10) {
                        Image(systemName: "map")
                            .font(.system(size: 34))
                            .foregroundStyle(FoodTheme.muted)
                        Text(customerText(store.customerLanguage, "Pick a restaurant first", "Elige un restaurante primero", "Choisissez d'abord un restaurant", "Chwazi yon restoran anvan"))
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        Text(customerText(store.customerLanguage, "Find one on the Discover tab, then build your order here.", "Busca uno en Descubrir y luego arma tu pedido aqui.", "Trouvez-en un dans Decouvrir, puis composez votre commande ici.", "Jwenn youn nan Dekouvri, epi prepare komann ou isit la."))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .foodCard(padding: 28)
                    .padding(.top, 40)
                }
            }
            .padding(16)
        }
        .sheet(item: $configuringItem) { item in
            MenuItemSheet(item: item)
        }
    }
}

private struct MenuItemRow: View {
    let item: FoodMenuItem
    var configure: () -> Void

    var body: some View {
        Button(action: configure) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(item.name)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(FoodTheme.ink)
                    if let description = item.description {
                        Text(description)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                            .lineLimit(2)
                    }
                    HStack(spacing: 8) {
                        Text(foodMoney(item.priceCents, currency: item.currencyCode))
                            .font(.system(size: 14, weight: .black))
                            .foregroundStyle(FoodTheme.basil)
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
                }
                Spacer()
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(item.isAvailable ? FoodTheme.flame : FoodTheme.muted)
            }
            .foodCard()
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

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let description = item.description {
                        Text(description)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    if !item.allergens.isEmpty {
                        Label(item.allergens.joined(separator: ", "), systemImage: "exclamationmark.triangle.fill")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(FoodTheme.saffron)
                    }

                    ForEach(item.modifierGroups) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(group.name)
                                    .font(.system(size: 16, weight: .black))
                                    .foregroundStyle(FoodTheme.ink)
                                if group.isRequired {
                                    Text(customerText(store.customerLanguage, "Required", "Obligatorio", "Obligatoire", "Obligatwa"))
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(FoodTheme.flame)
                                }
                            }
                            ForEach(group.options.filter(\.isAvailable)) { option in
                                Button {
                                    toggle(group: group, option: option)
                                } label: {
                                    HStack {
                                        Image(systemName: selected[group.id]?.contains(option.id) == true
                                              ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(FoodTheme.flame)
                                        Text(option.name)
                                            .foregroundStyle(FoodTheme.ink)
                                        Spacer()
                                        if option.priceDeltaCents != 0 {
                                            Text("+\(foodMoney(option.priceDeltaCents, currency: item.currencyCode))")
                                                .foregroundStyle(FoodTheme.muted)
                                        }
                                    }
                                    .font(.system(size: 14, weight: .semibold))
                                    .padding(10)
                                    .background(FoodTheme.surfaceRaised)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .foodCard(padding: 14)
                    }

                    HStack {
                        Text(customerText(store.customerLanguage, "Quantity", "Cantidad", "Quantite", "Kantite"))
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(FoodTheme.ink)
                        Spacer()
                        Stepper("\(quantity)", value: $quantity, in: 1...99)
                            .fixedSize()
                    }
                    .foodCard(padding: 14)

                    TextField(customerText(store.customerLanguage, "Special instructions (optional)", "Instrucciones especiales (opcional)", "Instructions speciales (optionnel)", "Enstriksyon espesyal (opsyonel)"), text: $instructions, axis: .vertical)
                        .textFieldStyle(.roundedBorder)

                    Button {
                        store.addToCart(CartLine(
                            item: item,
                            quantity: quantity,
                            modifiers: selectedModifiers,
                            specialInstructions: instructions.trimmingCharacters(in: .whitespacesAndNewlines)
                        ))
                        dismiss()
                    } label: {
                        Text("\(customerText(store.customerLanguage, "Add to order", "Agregar al pedido", "Ajouter a la commande", "Ajoute nan komann")) · \(foodMoney(unitTotal * quantity, currency: item.currencyCode))")
                            .font(.system(size: 16, weight: .black))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .background(missingRequired ? FoodTheme.muted : FoodTheme.flame)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .disabled(missingRequired)
                }
                .padding(16)
            }
            .background(FoodTheme.background)
            .navigationTitle(item.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(customerText(store.customerLanguage, "Cancel", "Cancelar", "Annuler", "Anile")) { dismiss() }
                }
            }
        }
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
                Label(customerText(store.customerLanguage, "Your order", "Tu pedido", "Votre commande", "Komann ou"), systemImage: "bag.fill")
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Spacer()
                Text(foodMoney(store.cartTotalCents, currency: store.selectedRestaurant?.currencyCode ?? "USD"))
                    .font(.system(size: 18, weight: .black))
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

                Label(customerText(store.customerLanguage, "You pay at the restaurant when you pick up.", "Pagas en el restaurante al recoger.", "Vous payez au restaurant lors du retrait.", "Ou peye nan restoran an lè w ap pran l."), systemImage: "banknote.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FoodTheme.saffron)

                Button {
                    Task { await store.submitOrder() }
                } label: {
                    HStack {
                        if store.isPlacingOrder {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        }
                        Label(customerText(store.customerLanguage, "Place order", "Hacer pedido", "Passer la commande", "Voye komann"), systemImage: "paperplane.fill")
                    }
                    .font(.system(size: 16, weight: .black))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(FoodTheme.flame)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .disabled(store.isPlacingOrder)
            }
        }
        .foodCard(padding: 16)
    }
}

// MARK: - Order confirmation (the big number screen)

struct OrderConfirmationView: View {
    @EnvironmentObject private var store: FoodStore
    let order: FoodOrder
    @State private var watchingQueue = false

    var body: some View {
        ZStack {
            FoodTheme.background.ignoresSafeArea()
            VStack(spacing: 18) {
                Spacer()
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(FoodTheme.basil)
                Text(customerText(store.customerLanguage, "Order placed!", "Pedido realizado", "Commande passee", "Komann pase"))
                    .font(.system(size: 28, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Text(customerText(store.customerLanguage, "Your number", "Tu numero", "Votre numero", "Nimewo ou"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FoodTheme.muted)
                Text("#\(order.queueNumber)")
                    .font(.system(size: 88, weight: .black))
                    .foregroundStyle(FoodTheme.flame)
                Text(customerText(store.customerLanguage, "Pay at the counter and watch for your number on the board.", "Paga en el mostrador y mira tu numero en la pantalla.", "Payez au comptoir et surveillez votre numero sur l'ecran.", "Peye nan kontwa a epi gade nimewo ou sou tablo a."))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 30)
                Text("Total \(foodMoney(order.totalCents, currency: order.currencyCode))")
                    .font(.system(size: 17, weight: .black))
                    .foregroundStyle(FoodTheme.ink)

                if watchingQueue {
                    QueueBoardLive(restaurantId: order.restaurantId, highlight: order.queueNumber)
                        .frame(maxHeight: 200)
                        .padding(.horizontal, 16)
                } else {
                    Button {
                        watchingQueue = true
                    } label: {
                        Label(customerText(store.customerLanguage, "Watch the queue", "Ver la fila", "Voir la file", "Gade liy la"), systemImage: "list.number")
                            .font(.system(size: 15, weight: .bold))
                    }
                    .buttonStyle(.bordered)
                }
                Spacer()
                Button {
                    store.lastPlacedOrder = nil
                } label: {
                    Text(customerText(store.customerLanguage, "Done", "Listo", "Termine", "Fini"))
                        .font(.system(size: 16, weight: .black))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(FoodTheme.flame)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.bottom, 18)
            }
        }
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
            while !Task.isCancelled {
                await store.refreshQueueBoard(restaurantId: restaurantId)
                try? await Task.sleep(nanoseconds: 5_000_000_000)
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
                Text(customerText(store.customerLanguage, "Track", "Seguir", "Suivi", "Swiv"))
                    .font(.system(size: 30, weight: .black))
                    .foregroundStyle(FoodTheme.ink)

                HStack {
                    Label(
                        customerText(store.customerLanguage, "Notifications", "Notificaciones", "Notifications", "Notifikasyon"),
                        systemImage: store.customerNotificationsEnabled ? "bell.badge.fill" : "bell.slash.fill"
                    )
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(store.customerNotificationsEnabled ? FoodTheme.basil : FoodTheme.muted)
                    Spacer()
                    if store.customerNotificationsEnabled {
                        Text(customerText(store.customerLanguage, "Order alerts on", "Alertas activas", "Alertes actives", "Alèt aktive"))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                }
                .foodCard(padding: 14)

                if let active = activeOrder {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("#\(active.queueNumber)")
                                .font(.system(size: 34, weight: .black))
                                .foregroundStyle(FoodTheme.flame)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(active.restaurantName ?? customerText(store.customerLanguage, "Your order", "Tu pedido", "Votre commande", "Komann ou"))
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(FoodTheme.ink)
                                Text(active.status.capitalized)
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(statusColor(active.status))
                            }
                            Spacer()
                            Text(foodMoney(active.totalCents, currency: active.currencyCode))
                                .font(.system(size: 15, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                        }
                        QueueBoardLive(restaurantId: active.restaurantId, highlight: active.queueNumber)
                    }
                    .foodCard(padding: 16)
                } else {
                    Text(customerText(store.customerLanguage, "Place an order and your live queue number will show up here.", "Haz un pedido y tu numero en vivo aparecera aqui.", "Passez une commande et votre numero apparaitra ici.", "Fè yon komann epi nimewo an dirèk ou ap parèt isit la."))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                        .frame(maxWidth: .infinity)
                        .foodCard(padding: 22)
                }

                if store.isSignedIn {
                    Text(customerText(store.customerLanguage, "Order history", "Historial de pedidos", "Historique des commandes", "Istwa komann"))
                        .font(.system(size: 20, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    if store.myOrders.isEmpty {
                        Text(customerText(store.customerLanguage, "No past orders yet.", "Todavia no hay pedidos anteriores.", "Pas encore de commandes precedentes.", "Poko gen ansyen komann."))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    ForEach(store.myOrders) { order in
                        HStack {
                            Text("#\(order.queueNumber)")
                                .font(.system(size: 17, weight: .black))
                                .foregroundStyle(FoodTheme.flame)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(order.restaurantName ?? "Restaurant")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(FoodTheme.ink)
                                Text(order.items.map { "\($0.quantity)x \($0.itemName)" }.joined(separator: ", "))
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(FoodTheme.muted)
                                    .lineLimit(1)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(order.status.capitalized)
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(statusColor(order.status))
                                Text(foodMoney(order.totalCents, currency: order.currencyCode))
                                    .font(.system(size: 13, weight: .black))
                                    .foregroundStyle(FoodTheme.ink)
                            }
                        }
                        .foodCard()
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
                                .buttonStyle(.bordered)
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
    }

    private var activeOrder: FoodOrder? {
        if let placed = store.lastPlacedOrder { return placed }
        return store.myOrders.first(where: \.isActive)
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
