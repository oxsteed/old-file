import MapKit
import SwiftUI

enum FoodTab: Hashable {
    case discover
    case order
    case merchant
    case kitchen
}

struct FoodRootView: View {
    @EnvironmentObject private var store: FoodStore
    @State private var tab: FoodTab = .discover

    var body: some View {
        ZStack(alignment: .bottom) {
            FoodTheme.background.ignoresSafeArea()
            Group {
                switch tab {
                case .discover: DiscoverView(tab: $tab)
                case .order: OrderView()
                case .merchant: MerchantView()
                case .kitchen: KitchenView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.bottom, 78)

            FoodTabBar(tab: $tab)
        }
        .task { await store.loadRestaurants() }
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
}

private struct FoodTabBar: View {
    @Binding var tab: FoodTab

    var body: some View {
        HStack(spacing: 0) {
            button(.discover, "Discover", "map.fill")
            button(.order, "Order", "takeoutbag.and.cup.and.straw.fill")
            button(.merchant, "Merchant", "storefront.fill")
            button(.kitchen, "Kitchen", "flame.fill")
        }
        .padding(8)
        .background(FoodTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(FoodTheme.line))
        .shadow(color: .black.opacity(0.14), radius: 16, y: 8)
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private func button(_ value: FoodTab, _ title: String, _ icon: String) -> some View {
        Button {
            withAnimation(.spring(response: 0.25, dampingFraction: 0.88)) {
                tab = value
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .semibold))
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(tab == value ? FoodTheme.flame : FoodTheme.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(tab == value ? FoodTheme.flame.opacity(0.12) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct DiscoverView: View {
    @EnvironmentObject private var store: FoodStore
    @Binding var tab: FoodTab
    @State private var camera = MapCameraPosition.region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 25.7617, longitude: -80.1918),
            span: MKCoordinateSpan(latitudeDelta: 0.16, longitudeDelta: 0.16)
        )
    )

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("OxSteed Food")
                                .font(.system(size: 32, weight: .black))
                                .foregroundStyle(FoodTheme.ink)
                            Text("Order ahead, at the counter, or from a restaurant tablet.")
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
                    Label("Nearby restaurants", systemImage: "location.fill")
                        .font(.system(size: 13, weight: .bold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(FoodTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .padding(10)
                }

                VStack(spacing: 10) {
                    ForEach(store.restaurants) { restaurant in
                        RestaurantCard(restaurant: restaurant) {
                            Task {
                                await store.select(restaurant)
                                tab = .order
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
                    Text(restaurant.cuisineTags.joined(separator: " / "))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FoodTheme.basil)
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

struct OrderView: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(store.selectedRestaurant.displayName)
                        .font(.system(size: 28, weight: .black))
                        .foregroundStyle(FoodTheme.ink)
                    Text(store.selectedRestaurant.description ?? "Order from this restaurant.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(FoodTheme.muted)

                    Picker("Fulfillment", selection: $store.fulfillment) {
                        Text("Pickup").tag("pickup")
                        Text("Dine In").tag("dine_in")
                        Text("Kiosk").tag("kiosk")
                    }
                    .pickerStyle(.segmented)

                    if store.fulfillment != "pickup" {
                        TextField("Table, counter, or kiosk label", text: $store.tableLabel)
                            .textFieldStyle(.roundedBorder)
                    }
                }
                .foodCard(padding: 16)

                ForEach(store.menu) { section in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(section.name)
                            .font(.system(size: 20, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        ForEach(section.items) { item in
                            MenuItemRow(item: item) {
                                store.addToCart(item)
                            }
                        }
                    }
                }

                CartPanel()
            }
            .padding(16)
        }
    }
}

private struct MenuItemRow: View {
    let item: FoodMenuItem
    var add: () -> Void

    var body: some View {
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
                Text(foodMoney(item.priceCents, currency: item.currencyCode))
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(FoodTheme.basil)
            }
            Spacer()
            Button(action: add) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 30))
            }
            .buttonStyle(.plain)
            .foregroundStyle(item.isAvailable ? FoodTheme.flame : FoodTheme.muted)
            .disabled(!item.isAvailable)
        }
        .foodCard()
    }
}

private struct CartPanel: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Cart", systemImage: "bag.fill")
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Spacer()
                Text(foodMoney(store.cartTotalCents, currency: store.selectedRestaurant.currencyCode))
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(FoodTheme.flame)
            }

            if store.cart.isEmpty {
                Text("Add items to start an order.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
            } else {
                ForEach(store.cart) { line in
                    HStack {
                        Text("\(line.quantity)x \(line.item.name)")
                            .font(.system(size: 14, weight: .semibold))
                        Spacer()
                        Text(foodMoney(line.lineTotalCents, currency: line.item.currencyCode))
                            .font(.system(size: 14, weight: .bold))
                        Button {
                            store.removeCartLine(line)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(FoodTheme.muted)
                    }
                }
                Button {
                    Task { await store.submitOrder() }
                } label: {
                    Label("Send Order", systemImage: "paperplane.fill")
                        .font(.system(size: 16, weight: .black))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(FoodTheme.flame)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
        .foodCard(padding: 16)
    }
}

struct MerchantView: View {
    @EnvironmentObject private var store: FoodStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Merchant Console")
                    .font(.system(size: 30, weight: .black))
                    .foregroundStyle(FoodTheme.ink)

                VStack(alignment: .leading, spacing: 10) {
                    Label("Add Restaurant", systemImage: "storefront.fill")
                        .font(.system(size: 18, weight: .black))
                    TextField("Restaurant name", text: $store.draftRestaurantName)
                        .textFieldStyle(.roundedBorder)
                    TextField("Cuisine", text: $store.draftCuisine)
                        .textFieldStyle(.roundedBorder)
                    Button("Stage Restaurant") {
                        store.createDraftRestaurant()
                    }
                    .buttonStyle(.borderedProminent)
                }
                .foodCard(padding: 16)

                VStack(alignment: .leading, spacing: 10) {
                    Label("Menu Builder", systemImage: "menucard.fill")
                        .font(.system(size: 18, weight: .black))
                    TextField("Menu item", text: $store.draftMenuItemName)
                        .textFieldStyle(.roundedBorder)
                    TextField("Price in cents", text: $store.draftMenuItemPrice)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                    Button("Stage Menu Item") {
                        store.addDraftMenuItem()
                    }
                    .buttonStyle(.bordered)
                }
                .foodCard(padding: 16)

                QueueSummary(title: "Front Counter", statuses: ["received", "accepted"])
                QueueSummary(title: "In-Store Tablet", statuses: ["received", "preparing", "ready"])
            }
            .padding(16)
        }
    }
}

private struct QueueSummary: View {
    @EnvironmentObject private var store: FoodStore
    let title: String
    let statuses: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.system(size: 18, weight: .black))
                Spacer()
                Text("\(matching.count)")
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(FoodTheme.flame)
            }
            ForEach(matching.prefix(4)) { order in
                HStack {
                    Text("#\(order.queueNumber)")
                        .font(.system(size: 16, weight: .black))
                    Text(order.fulfillmentType.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(FoodTheme.muted)
                    Spacer()
                    Text(order.status.capitalized)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(statusColor(order.status))
                }
            }
        }
        .foodCard(padding: 16)
    }

    private var matching: [FoodOrder] {
        store.activeOrders.filter { statuses.contains($0.status) }
    }
}

struct KitchenView: View {
    @EnvironmentObject private var store: FoodStore

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Kitchen Display")
                            .font(.system(size: 30, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        Text("Oldest orders stay first; ready orders stay visible for handoff.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    Spacer()
                    Image(systemName: "display")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(FoodTheme.blue)
                }

                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(store.activeOrders.sorted(by: { $0.queueNumber < $1.queueNumber })) { order in
                        KitchenTicket(order: order)
                    }
                }
            }
            .padding(16)
        }
    }
}

private struct KitchenTicket: View {
    @EnvironmentObject private var store: FoodStore
    let order: FoodOrder

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("#\(order.queueNumber)")
                    .font(.system(size: 28, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Spacer()
                Text(order.status.uppercased())
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(statusColor(order.status))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            Text(order.tableLabel ?? order.fulfillmentType.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(FoodTheme.muted)

            ForEach(order.items ?? []) { item in
                Text("\(item.quantity)x \(item.itemName)")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FoodTheme.ink)
            }

            HStack {
                statusButton("Accept", "accepted")
                statusButton("Prep", "preparing")
                statusButton("Ready", "ready")
            }
        }
        .foodCard(padding: 14)
    }

    private func statusButton(_ title: String, _ status: String) -> some View {
        Button(title) {
            Task { await store.updateStatus(order, status: status) }
        }
        .font(.system(size: 12, weight: .black))
        .buttonStyle(.bordered)
        .disabled(order.status == status)
    }
}

private func statusColor(_ status: String) -> Color {
    switch status {
    case "received": return FoodTheme.saffron
    case "accepted": return FoodTheme.blue
    case "preparing": return FoodTheme.flame
    case "ready": return FoodTheme.basil
    case "completed": return FoodTheme.muted
    default: return FoodTheme.muted
    }
}
