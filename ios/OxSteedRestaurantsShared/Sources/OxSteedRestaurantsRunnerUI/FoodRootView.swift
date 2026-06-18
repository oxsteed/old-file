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

    var accent: Color {
        switch self {
        case .customerOrdering: return FoodTheme.flame
        case .ownerManager: return FoodTheme.blue
        case .posCounter: return FoodTheme.basil
        case .kitchenDisplay: return FoodTheme.coral
        case .kioskQueue: return FoodTheme.grape
        case .crewTraining: return FoodTheme.teal
        case .inventoryReceiving: return FoodTheme.flame
        case .deliveryRunner: return FoodTheme.basil
        }
    }

    /// Short name shown in the dedicated-app dark header.
    var shortTitle: String {
        switch self {
        case .customerOrdering: return "Restaurants"
        case .ownerManager: return "Manager"
        case .posCounter: return "POS"
        case .kitchenDisplay: return "Kitchen"
        case .kioskQueue: return "Display"
        case .crewTraining: return "Crew"
        case .inventoryReceiving: return "Inventory"
        case .deliveryRunner: return "Runner"
        }
    }

    /// Subtitle under the short title in the dedicated-app header.
    var shellSubtitle: String {
        switch self {
        case .customerOrdering: return "Customer Ordering"
        case .ownerManager: return "Owner Control Center"
        case .posCounter: return "Counter Ordering"
        case .kitchenDisplay: return "Kitchen Display"
        case .kioskQueue: return "Kiosk + Queue Board"
        case .crewTraining: return "Training + SOPs"
        case .inventoryReceiving: return "Stock + Suppliers"
        case .deliveryRunner: return "Delivery + Logistics"
        }
    }

    var operatorLabel: String {
        switch self {
        case .customerOrdering: return "Guest-facing growth"
        case .ownerManager: return "Operator command center"
        case .posCounter: return "Counter execution"
        case .kitchenDisplay: return "Back-of-house execution"
        case .kioskQueue: return "Public in-store flow"
        case .crewTraining: return "Training discipline"
        case .inventoryReceiving: return "Cost control"
        case .deliveryRunner: return "Last-mile execution"
        }
    }

    var brandPromise: String {
        switch self {
        case .customerOrdering:
            return "Each restaurant keeps its own voice, menu, and promotions while OxSteed supplies the ordering engine."
        case .ownerManager:
            return "Independent operators get franchise-grade visibility without handing their identity to a marketplace."
        case .posCounter:
            return "Walk-in guests should feel the same speed and consistency they expect from a national chain."
        case .kitchenDisplay:
            return "Kitchen staff need one unmistakable next action per ticket, not a cluttered dashboard."
        case .kioskQueue:
            return "The dining room should broadcast confidence: order here, watch progress, pick up fast."
        case .crewTraining:
            return "Independent crews deserve the same repeatable SOP and onboarding rhythm big brands use."
        case .inventoryReceiving:
            return "Operators need stock truth early enough to avoid waste, outs, and surprise margin loss."
        case .deliveryRunner:
            return "Runners need the next stop, the proof rule, and the escalation path without digging."
        }
    }

    var primaryMoments: [FoodWorkspaceMoment] {
        switch self {
        case .customerOrdering:
            return [
                FoodWorkspaceMoment(label: "Discover", title: "Show nearby brands fast", detail: "Discovery and offers should beat blank-list anxiety in the first screen.", icon: "sparkles"),
                FoodWorkspaceMoment(label: "Order", title: "Keep checkout momentum visible", detail: "A live cart and clear fulfillment choice should follow the guest while browsing.", icon: "cart.fill"),
                FoodWorkspaceMoment(label: "Track", title: "Explain what happens next", detail: "Status needs to read like a guided journey, not raw queue data.", icon: "clock.badge.checkmark")
            ]
        case .ownerManager:
            return [
                FoodWorkspaceMoment(label: "Today", title: "Surface the few issues that matter", detail: "Leaders should spot revenue risk, labor risk, and service blockers immediately.", icon: "chart.line.uptrend.xyaxis"),
                FoodWorkspaceMoment(label: "Act", title: "Move from alert to fix in one tap", detail: "Menus, checklists, staffing, and help requests should be adjacent to the problem.", icon: "bolt.badge.clock"),
                FoodWorkspaceMoment(label: "Scale", title: "Compare locations without losing brand control", detail: "Multi-unit visibility should still feel like independent restaurants inside one network.", icon: "building.2.crop.circle")
            ]
        case .posCounter:
            return [
                FoodWorkspaceMoment(label: "Speed", title: "Build a ticket with almost no thinking", detail: "Big tappable products, clear modifiers, and visible totals keep the line moving.", icon: "hand.tap.fill"),
                FoodWorkspaceMoment(label: "Collect", title: "Show payment state without ambiguity", detail: "Cashiers need to know what was paid, comped, or still open at a glance.", icon: "creditcard.fill"),
                FoodWorkspaceMoment(label: "Send", title: "Get the kitchen the right ticket", detail: "Modifiers, notes, and fulfillment type must be impossible to miss.", icon: "paperplane.fill")
            ]
        case .kitchenDisplay:
            return [
                FoodWorkspaceMoment(label: "See", title: "Sort work by what is on fire now", detail: "The board should make delayed, new, and ready tickets visually obvious.", icon: "flame.fill"),
                FoodWorkspaceMoment(label: "Move", title: "Advance status with one deliberate action", detail: "Large, low-error controls matter more than secondary analytics mid-rush.", icon: "arrow.right.circle.fill"),
                FoodWorkspaceMoment(label: "Finish", title: "Protect handoff accuracy", detail: "Pickup context and notes need to stay attached until the ticket leaves the line.", icon: "checkmark.seal.fill")
            ]
        case .kioskQueue:
            return [
                FoodWorkspaceMoment(label: "Order", title: "Let guests self-serve confidently", detail: "Language, menu cards, and checkout cues should work from across the counter.", icon: "rectangle.and.hand.point.up.left.fill"),
                FoodWorkspaceMoment(label: "Wait", title: "Show progress publicly", detail: "Preparing and ready states need to be legible from a distance in noisy rooms.", icon: "list.number"),
                FoodWorkspaceMoment(label: "Reset", title: "Return the screen to ready mode automatically", detail: "The device should always be prepared for the next guest without staff babysitting.", icon: "arrow.counterclockwise.circle.fill")
            ]
        case .crewTraining:
            return [
                FoodWorkspaceMoment(label: "Learn", title: "Turn onboarding into a daily habit", detail: "Lessons, SOPs, and quizzes should feel actionable, not buried in admin UI.", icon: "book.closed.fill"),
                FoodWorkspaceMoment(label: "Check", title: "Tie training to live shift readiness", detail: "Opening, closing, and food-safety work should sit beside completion state.", icon: "checklist.checked"),
                FoodWorkspaceMoment(label: "Earn", title: "Make progress visible", detail: "Badges and scores reinforce consistency the way large chains do.", icon: "rosette")
            ]
        case .inventoryReceiving:
            return [
                FoodWorkspaceMoment(label: "Count", title: "Catch low stock before service", detail: "Par gaps and ingredient risk should rise above routine counts.", icon: "shippingbox.fill"),
                FoodWorkspaceMoment(label: "Receive", title: "Log deliveries where they happen", detail: "Receiving should take seconds so teams actually keep it accurate.", icon: "tray.full.fill"),
                FoodWorkspaceMoment(label: "Protect", title: "Track waste and supplier issues together", detail: "Cost leakage becomes obvious when waste, requests, and issues share one loop.", icon: "exclamationmark.triangle.fill")
            ]
        case .deliveryRunner:
            return [
                FoodWorkspaceMoment(label: "Route", title: "Make the next stop unmistakable", detail: "Assigned work should read like a route, not a list of cards to decipher.", icon: "map.fill"),
                FoodWorkspaceMoment(label: "Confirm", title: "Capture proof without slowing handoff", detail: "Photos, notes, and cash collection rules should be one motion away.", icon: "camera.fill"),
                FoodWorkspaceMoment(label: "Escalate", title: "Report issues while still in the field", detail: "Runners need a fast path for delays, customer contact rules, and failed deliveries.", icon: "exclamationmark.bubble.fill")
            ]
        }
    }
}

struct FoodWorkspaceMoment: Identifiable {
    let id = UUID()
    let label: String
    let title: String
    let detail: String
    let icon: String
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

    private var isDedicatedRoleApp: Bool {
        runtime.allowedWorkspaces.count == 1
    }
    private var shellContextLine: String? {
        guard let restaurant = store.activeRestaurant else { return nil }
        return "\(restaurant.displayName) · Today"
    }

    private var shellLiveState: FoodLiveState {
        store.activeRestaurant == nil ? .syncing : .live
    }

    @ViewBuilder
    private var workspaceContent: some View {
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

    var body: some View {
        Group {
            if isDedicatedRoleApp {
                FoodRoleAppShell(
                    appName: runtime.appName,
                    roleTitle: workspace.shortTitle,
                    roleSubtitle: workspace.shellSubtitle,
                    accent: workspace.accent,
                    logoURL: store.activeRestaurant?.logoUrl,
                    contextLine: shellContextLine,
                    liveState: shellLiveState
                ) {
                    ScrollView {
                        workspaceContent
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

                            workspaceContent
                        }
                        .padding(16)
                    }
                }
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
    @EnvironmentObject private var store: FoodStore
    let appName: String
    let workspace: FoodWorkspace

    // Restaurant-first identity: the storefront leads, OxSteed is the network.
    private var restaurantName: String? {
        let name = store.activeRestaurant?.displayName ?? ""
        return name.isEmpty ? nil : name
    }
    private var brandAccent: Color {
        if let r = store.activeRestaurant { return FoodTheme.accent(for: "\(r.id)") }
        return workspace.accent
    }
    private var liveState: FoodLiveState {
        store.activeRestaurant == nil ? .syncing : .live
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Brand + role row — answers "whose restaurant" and "which surface".
            HStack(alignment: .center, spacing: 13) {
                FoodBrandMark(name: restaurantName ?? appName, accent: brandAccent, size: 48)

                VStack(alignment: .leading, spacing: 3) {
                    Text(restaurantName ?? appName)
                        .font(.system(size: 22, weight: .black, design: .rounded))
                        .foregroundStyle(FoodTheme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    HStack(spacing: 6) {
                        Image(systemName: workspace.icon)
                            .font(.system(size: 11, weight: .bold))
                        Text(workspace.title.uppercased())
                            .font(.foodMicro)
                            .lineLimit(1)
                    }
                    .foregroundStyle(brandAccent)
                }

                Spacer(minLength: 8)

                FoodLiveBadge(state: liveState)
            }

            // One line on what this surface is for — operational, not marketing.
            Text(workspace.subtitle)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FoodTheme.inkSoft)
                .fixedSize(horizontal: false, vertical: true)

            FoodNetworkFootnote(leading: workspace.operatorLabel)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.xl, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            brandAccent.opacity(0.22),
                            FoodTheme.surface,
                            FoodTheme.surface
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.xl, style: .continuous)
                .stroke(brandAccent.opacity(0.20), lineWidth: 1)
        )
        .foodShadow(.medium)
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
                        FoodModeCard(
                            title: item.title,
                            detail: item.subtitle,
                            icon: item.icon,
                            tint: item.accent,
                            isSelected: workspace == item
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct CustomerWorkspaceView: View {
    @State private var tab = CustomerSubworkspace.discover

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WorkspaceSectionHeader(
                title: "Customer ordering app",
                subtitle: "Discovery, menu browsing, cart, and order tracking for pickup and dine-in."
            )
            Picker("Customer workspace", selection: $tab) {
                ForEach(CustomerSubworkspace.allCases) { item in
                    Text(item.title).tag(item)
                }
            }
            .pickerStyle(.segmented)

            switch tab {
            case .discover:
                DiscoverView()
            case .order:
                OrderView()
            case .track:
                TrackView()
            }
        }
    }
}

private enum CustomerSubworkspace: String, CaseIterable, Identifiable {
    case discover
    case order
    case track

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
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
    @State private var tab = RunnerSubworkspace.dispatch
    @State private var proofNotes: [UUID: String] = [:]
    @State private var issueNotes: [UUID: String] = [:]
    @State private var paymentAmounts: [UUID: String] = [:]
    @State private var paymentNotes: [UUID: String] = [:]
    @State private var draftOrderReference = ""
    @State private var draftStopName = ""
    @State private var draftTaskType = "Delivery"
    @State private var draftRouteWindow = ""
    @State private var draftContactRule = ""
    @State private var draftRequiresProof = true
    @State private var draftCashCollectionRequired = false
    @State private var draftNotes = ""
    @State private var newRuleTitle = ""
    @State private var newRuleDetail = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !FoodAppShell.isDedicated {
                HStack(spacing: 12) {
                    FoodOperationalStat(label: "Assigned", value: "\(store.assignedRunnerTasks.count)", detail: "Open tasks on the route", tint: FoodTheme.basil)
                    FoodOperationalStat(label: "Proof", value: "\(store.proofPendingTasks.count)", detail: "Stops pending proof", tint: FoodTheme.saffron)
                    FoodOperationalStat(label: "Issues", value: "\(store.runnerTasks.filter { $0.status.lowercased().contains("issue") || $0.status.lowercased().contains("failed") }.count)", detail: "Tasks needing escalation", tint: FoodTheme.coral)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(RunnerSubworkspace.allCases) { item in
                            Button {
                                withAnimation(.spring(response: 0.25, dampingFraction: 0.9)) {
                                    tab = item
                                }
                            } label: {
                                FoodModeCard(title: item.title, detail: item.detail, icon: item.icon, tint: FoodTheme.basil, isSelected: tab == item)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            switch tab {
            case .dispatch:
                VStack(alignment: .leading, spacing: 12) {
                    if let next = store.assignedRunnerTasks.first {
                        runnerNextStopCard(next)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Create runner task")
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        TextField("Order reference", text: $draftOrderReference)
                            .textFieldStyle(.roundedBorder)
                        TextField("Stop name", text: $draftStopName)
                            .textFieldStyle(.roundedBorder)
                        Picker("Task type", selection: $draftTaskType) {
                            Text("Delivery").tag("Delivery")
                            Text("Customer pickup").tag("Customer pickup")
                            Text("Catering").tag("Catering")
                            Text("Logistics").tag("Logistics")
                            Text("Supplier return").tag("Supplier return")
                        }
                        .pickerStyle(.segmented)
                        TextField("Route window", text: $draftRouteWindow)
                            .textFieldStyle(.roundedBorder)
                        TextField("Contact rule", text: $draftContactRule)
                            .textFieldStyle(.roundedBorder)
                        TextField("Notes", text: $draftNotes, axis: .vertical)
                            .lineLimit(2...4)
                            .textFieldStyle(.roundedBorder)
                        Toggle("Proof required", isOn: $draftRequiresProof)
                        Toggle("Cash collection required", isOn: $draftCashCollectionRequired)
                        Button("Create runner task") {
                            Task {
                                let created = await store.createRunnerTask(
                                    orderReference: draftOrderReference,
                                    stopName: draftStopName,
                                    taskType: draftTaskType,
                                    routeWindow: draftRouteWindow,
                                    customerContactRule: draftContactRule,
                                    requiresProof: draftRequiresProof,
                                    cashCollectionRequired: draftCashCollectionRequired,
                                    notes: draftNotes
                                )
                                guard created else { return }
                                draftOrderReference = ""
                                draftStopName = ""
                                draftTaskType = "Delivery"
                                draftRouteWindow = ""
                                draftContactRule = ""
                                draftRequiresProof = true
                                draftCashCollectionRequired = false
                                draftNotes = ""
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(FoodTheme.flame)
                    }
                    .foodCard(padding: 16)

                    Text("Assigned tasks")
                        .font(.system(size: 22, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    ForEach(store.runnerTasks) { task in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(task.orderReference)
                                        .font(.system(size: 17, weight: .black))
                                        .foregroundStyle(FoodTheme.ink)
                                    Text(task.stopName)
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundStyle(FoodTheme.ink)
                                }
                                Spacer()
                                Text(task.status)
                                    .font(.system(size: 11, weight: .black))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(FoodTheme.blue)
                                    .clipShape(Capsule())
                            }
                            Text("\(task.taskType) · \(task.routeWindow)")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(FoodTheme.flame)
                            Text(task.notes)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                            HStack(spacing: 8) {
                                Button("Pickup") {
                                    store.confirmRunnerPickup(task)
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(FoodTheme.flame)

                                Button("Advance") {
                                    store.advanceRunnerTask(task)
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        .foodCard(padding: 16)
                    }
                }
            case .route:
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Today's route")
                            .font(.system(size: 22, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        ForEach(Array(store.assignedRunnerTasks.enumerated()), id: \.element.id) { index, task in
                            HStack(alignment: .top, spacing: 12) {
                                ZStack {
                                    Circle()
                                        .fill(index == 0 ? FoodTheme.blue : FoodTheme.surfaceRaised)
                                    Text("\(index + 1)")
                                        .font(.system(size: 14, weight: .black))
                                        .foregroundStyle(index == 0 ? .white : FoodTheme.ink)
                                }
                                .frame(width: 34, height: 34)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(task.stopName)
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundStyle(FoodTheme.ink)
                                    Text("\(task.orderReference) · \(task.routeWindow)")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(index == 0 ? FoodTheme.blue : FoodTheme.muted)
                                    Text(task.customerContactRule)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(FoodTheme.muted)
                                        .lineLimit(2)
                                }
                                Spacer(minLength: 0)
                                if index == 0 {
                                    Text("NEXT")
                                        .font(.foodMicro)
                                        .foregroundStyle(FoodTheme.blue)
                                }
                            }
                            .foodCard(padding: 14)
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Shared contact rules")
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        TextField("Rule title", text: $newRuleTitle)
                            .textFieldStyle(.roundedBorder)
                        TextField("Guidance for runners", text: $newRuleDetail, axis: .vertical)
                            .lineLimit(2...4)
                            .textFieldStyle(.roundedBorder)
                        Button("Add contact rule") {
                            Task {
                                let created = await store.createRunnerContactRule(
                                    title: newRuleTitle,
                                    detail: newRuleDetail
                                )
                                guard created else { return }
                                newRuleTitle = ""
                                newRuleDetail = ""
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(FoodTheme.blue)
                    }
                    .foodCard(padding: 16)

                    Text("Route + contact rules")
                        .font(.system(size: 22, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    ForEach(store.runnerTasks) { task in
                        VStack(alignment: .leading, spacing: 8) {
                            Text("\(task.orderReference) · \(task.stopName)")
                                .font(.system(size: 16, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Text("Route window: \(task.routeWindow)")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(FoodTheme.blue)
                            Text(task.customerContactRule)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }
                        .foodCard(padding: 15)
                    }

                    Text("Shared contact rules")
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    ForEach(store.runnerContactRules) { rule in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(rule.title)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(FoodTheme.ink)
                            Text(rule.detail)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                        }
                        .foodCard(padding: 14)
                    }
                }
            case .proof:
                VStack(alignment: .leading, spacing: 12) {
                    Text("Proof of delivery")
                        .font(.system(size: 22, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    ForEach(store.runnerTasks.filter(\.requiresProof)) { task in
                        VStack(alignment: .leading, spacing: 10) {
                            Text("\(task.orderReference) · \(task.stopName)")
                                .font(.system(size: 16, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Text(task.notes)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FoodTheme.muted)
                            TextField("Photo, signature, or handoff note", text: binding(for: task.id, in: $proofNotes))
                                .textFieldStyle(.roundedBorder)
                            Button("Log Proof + Complete") {
                                store.logRunnerProof(task, proofNote: proofNotes[task.id, default: ""])
                                proofNotes[task.id] = ""
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(FoodTheme.basil)
                        }
                        .foodCard(padding: 16)
                    }

                    if !store.runnerProofs.isEmpty {
                        Text("Recent proof log")
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        ForEach(store.runnerProofs) { proof in
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(proof.orderReference) · \(proof.method)")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(FoodTheme.ink)
                                Text(proof.stopName)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(FoodTheme.blue)
                                Text(proof.note)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(FoodTheme.muted)
                            }
                            .foodCard(padding: 14)
                        }
                    }
                }
            case .issues:
                VStack(alignment: .leading, spacing: 12) {
                    Text("Issues + payment notes")
                        .font(.system(size: 22, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    ForEach(store.runnerTasks) { task in
                        VStack(alignment: .leading, spacing: 10) {
                            Text("\(task.orderReference) · \(task.stopName)")
                                .font(.system(size: 16, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            TextField("Issue note", text: binding(for: task.id, in: $issueNotes))
                                .textFieldStyle(.roundedBorder)
                            Button("Report Issue") {
                                store.reportRunnerIssue(task, note: issueNotes[task.id, default: ""])
                                issueNotes[task.id] = ""
                            }
                            .buttonStyle(.bordered)

                            if task.cashCollectionRequired {
                                TextField("Cash / payment amount", text: binding(for: task.id, in: $paymentAmounts))
                                    .keyboardType(.decimalPad)
                                    .textFieldStyle(.roundedBorder)
                                TextField("Payment note", text: binding(for: task.id, in: $paymentNotes))
                                    .textFieldStyle(.roundedBorder)
                                Button("Save Payment Note") {
                                    store.addRunnerPaymentNote(
                                        task,
                                        amountText: paymentAmounts[task.id, default: ""],
                                        note: paymentNotes[task.id, default: ""]
                                    )
                                    paymentAmounts[task.id] = ""
                                    paymentNotes[task.id] = ""
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(FoodTheme.saffron)
                            }
                        }
                        .foodCard(padding: 16)
                    }

                    if !store.runnerIssueReports.isEmpty {
                        Text("Recent issue reports")
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        ForEach(store.runnerIssueReports) { report in
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(report.orderReference) · \(report.severity)")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(FoodTheme.ink)
                                Text(report.stopName)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(FoodTheme.blue)
                                Text(report.note)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(FoodTheme.muted)
                            }
                            .foodCard(padding: 14)
                        }
                    }

                    if !store.runnerPaymentNotes.isEmpty {
                        Text("Payment notes")
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        ForEach(store.runnerPaymentNotes) { note in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(note.orderReference)
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(FoodTheme.ink)
                                Text("$\(note.amount, specifier: "%.2f")")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(FoodTheme.saffron)
                                Text(note.note)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(FoodTheme.muted)
                            }
                            .foodCard(padding: 14)
                        }
                    }
                }
            }
        }
        .foodDedicatedTabBar(
            selection: $tab,
            accent: FoodTheme.basil,
            items: RunnerSubworkspace.allCases.map {
                FoodTabDescriptor(id: $0, title: $0.tabBarTitle, icon: $0.icon)
            }
        )
    }

    private func runnerNextStopCard(_ task: FoodRunnerTask) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if FoodAppShell.isDedicated {
                Text("Current assignment")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
            }
            HStack {
                Text("NEXT STOP")
                    .font(.foodMicro)
                    .foregroundStyle(FoodTheme.basil)
                Spacer()
                if task.requiresProof {
                    FoodPill(text: "Proof required", systemImage: "camera.fill", tint: FoodTheme.saffron)
                }
                if task.cashCollectionRequired {
                    FoodPill(text: "Collect cash", systemImage: "banknote.fill", tint: FoodTheme.flame)
                }
            }

            HStack(alignment: .top, spacing: 14) {
                ZStack {
                    Circle()
                        .fill(FoodTheme.blue.opacity(0.16))
                    Image(systemName: "location.fill")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(FoodTheme.blue)
                }
                .frame(width: 54, height: 54)

                VStack(alignment: .leading, spacing: 5) {
                    Text(task.stopName)
                        .font(.system(size: 24, weight: .black, design: .rounded))
                        .foregroundStyle(FoodTheme.ink)
                    Text("\(task.orderReference) · \(task.taskType)")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(FoodTheme.flame)
                    Text("Window: \(task.routeWindow)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(FoodTheme.blue)
                    if !task.customerContactRule.isEmpty {
                        Text(task.customerContactRule)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    if !task.notes.isEmpty {
                        Text(task.notes)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                }
            }

            HStack(spacing: 10) {
                Button("Confirm pickup") {
                    store.confirmRunnerPickup(task)
                }
                .buttonStyle(PrimaryActionButtonStyle(tint: FoodTheme.flame, fullWidth: false))

                Button("Advance stop") {
                    store.advanceRunnerTask(task)
                }
                .buttonStyle(SecondaryActionButtonStyle(tint: FoodTheme.blue, fullWidth: false))
            }
        }
        .foodCard(padding: 18)
    }

    private func runnerMetricCard(title: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .black))
                .foregroundStyle(FoodTheme.flame)
            Text(value)
                .font(.system(size: 34, weight: .black))
                .foregroundStyle(FoodTheme.ink)
            Text(detail)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(FoodTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foodCard(padding: 16)
    }

    private func binding(for id: UUID, in dictionary: Binding<[UUID: String]>) -> Binding<String> {
        Binding(
            get: { dictionary.wrappedValue[id, default: ""] },
            set: { dictionary.wrappedValue[id] = $0 }
        )
    }
}

private enum RunnerSubworkspace: String, CaseIterable, Identifiable {
    case dispatch
    case route
    case proof
    case issues

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dispatch: return "Dispatch"
        case .route: return "Route"
        case .proof: return "Proof"
        case .issues: return "Issues"
        }
    }

    var icon: String {
        switch self {
        case .dispatch: return "tray.and.arrow.up.fill"
        case .route: return "map.fill"
        case .proof: return "camera.fill"
        case .issues: return "exclamationmark.bubble.fill"
        }
    }

    var tabBarTitle: String {
        switch self {
        case .dispatch: return "Run"
        case .route: return "Map"
        case .proof: return "Proof"
        case .issues: return "Issues"
        }
    }

    var detail: String {
        switch self {
        case .dispatch: return "Create and assign stops with contact rules."
        case .route: return "See the next stop and route guidance."
        case .proof: return "Capture proof, cash, and completion notes."
        case .issues: return "Escalate delays, failures, and exceptions."
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
                            Text("Order ahead or in store. Pay at the counter.")
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
                }
                .foodCard(padding: 16)

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
    let restaurant: FoodRestaurant
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                RemoteFoodImage(restaurant.coverPhotoUrl, icon: "takeoutbag.and.cup.and.straw.fill", tint: FoodTheme.accent(for: restaurant.id))
                    .frame(width: 62, height: 62)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

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
            .foodCard()
        }
        .buttonStyle(.plain)
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

                        Picker("Fulfillment", selection: $store.fulfillment) {
                            Text("Pickup").tag("pickup")
                            Text("Dine In").tag("dine_in")
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
                        Text("Pick a restaurant first")
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        Text("Find one on the Discover tab, then build your order here.")
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
                RemoteFoodImage(item.imageUrl, icon: "fork.knife")
                    .frame(width: 58, height: 58)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .saturation(item.isAvailable ? 1 : 0)
                    .opacity(item.isAvailable ? 1 : 0.55)
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
                                    Text("Required")
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
                        Text("Quantity")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(FoodTheme.ink)
                        Spacer()
                        Stepper("\(quantity)", value: $quantity, in: 1...99)
                            .fixedSize()
                    }
                    .foodCard(padding: 14)

                    TextField("Special instructions (optional)", text: $instructions, axis: .vertical)
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
                        Text("Add to order · \(foodMoney(unitTotal * quantity, currency: item.currencyCode))")
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
                    Button("Cancel") { dismiss() }
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
                Label("Your order", systemImage: "bag.fill")
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Spacer()
                Text(foodMoney(store.cartTotalCents, currency: store.selectedRestaurant?.currencyCode ?? "USD"))
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(FoodTheme.flame)
            }

            if store.cart.isEmpty {
                Text("Add items to start an order.")
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

                Label("You pay at the restaurant when you pick up.", systemImage: "banknote.fill")
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
                        Label("Place order", systemImage: "paperplane.fill")
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
                Text("Order placed!")
                    .font(.system(size: 28, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Text("Your number")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FoodTheme.muted)
                Text("#\(order.queueNumber)")
                    .font(.system(size: 88, weight: .black))
                    .foregroundStyle(FoodTheme.flame)
                Text("Pay at the counter and watch for your number on the board.")
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
                        Label("Watch the queue", systemImage: "list.number")
                            .font(.system(size: 15, weight: .bold))
                    }
                    .buttonStyle(.bordered)
                }
                Spacer()
                Button {
                    store.lastPlacedOrder = nil
                } label: {
                    Text("Done")
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
            column("Preparing", numbers: store.queueBoard?.preparing ?? [], color: FoodTheme.saffron)
            column("Now ready", numbers: store.queueBoard?.ready ?? [], color: FoodTheme.basil)
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
                Text("None yet")
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
                Text("Track")
                    .font(.system(size: 30, weight: .black))
                    .foregroundStyle(FoodTheme.ink)

                if let active = activeOrder {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("#\(active.queueNumber)")
                                .font(.system(size: 34, weight: .black))
                                .foregroundStyle(FoodTheme.flame)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(active.restaurantName ?? "Your order")
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
                    Text("Place an order and your live queue number will show up here.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
                        .frame(maxWidth: .infinity)
                        .foodCard(padding: 22)
                }

                if store.isSignedIn {
                    Text("Order history")
                        .font(.system(size: 20, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    if store.myOrders.isEmpty {
                        Text("No past orders yet.")
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
                    Text("Sign in on the Merchant tab to keep your order history.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)
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
    @State private var agreementName = ""
    @State private var termsAgreed = false
    @State private var working = false

    private var canSubmit: Bool {
        !email.isEmpty && !password.isEmpty && termsAgreed && Self.isValidFullName(agreementName)
    }

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
            TextField("Full name (must match account)", text: $agreementName)
                .textFieldStyle(.roundedBorder)
            Toggle("I agree to the Terms of Service and Privacy Policy", isOn: $termsAgreed)
                .font(.system(size: 13, weight: .medium))
            Button {
                working = true
                Task {
                    if await store.signIn(email: email, password: password, agreementName: agreementName) {
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
            .disabled(working || !canSubmit)
        }
        .foodCard(padding: 16)
    }

    private static func isValidFullName(_ name: String) -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let words = trimmed.split(whereSeparator: { $0.isWhitespace })
        return trimmed.count >= 5 && words.count >= 2
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
