import Foundation

struct FoodPendingOrderLine: Codable, Hashable {
    let menuItemId: Int64
    let quantity: Int
    let modifierIds: [Int64]
    let specialInstructions: String?
}

struct FoodPendingOrder: Codable, Identifiable, Hashable {
    let id: String
    let restaurantId: Int64
    var restaurantName: String?
    let lines: [FoodPendingOrderLine]
    let fulfillment: String
    let tableLabel: String?
    let guestName: String?
    let orderSource: String
    let paymentMode: String
    let discountCode: String?
    let discountLabel: String?
    let discountCents: Int
    let loyaltyPointsToRedeem: Int?
    let createdAt: Date
    var attemptCount: Int
}

enum FoodOfflineOrderQueue {
    private static let storageKey = "ox.food.pendingOrders"
    private static let maxAttempts = 8

    static func load() -> [FoodPendingOrder] {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else { return [] }
        return (try? JSONDecoder.food.decode([FoodPendingOrder].self, from: data)) ?? []
    }

    static func save(_ orders: [FoodPendingOrder]) {
        guard let data = try? JSONEncoder.food.encode(orders) else { return }
        UserDefaults.standard.set(data, forKey: storageKey)
    }

    static func enqueue(
        id: String,
        restaurant: FoodRestaurant,
        lines: [CartLine],
        fulfillment: String,
        tableLabel: String?,
        guestName: String?,
        orderSource: String,
        paymentMode: String,
        discountCode: String? = nil,
        discountLabel: String? = nil,
        discountCents: Int = 0,
        loyaltyPointsToRedeem: Int? = nil
    ) -> FoodPendingOrder {
        let pending = FoodPendingOrder(
            id: id,
            restaurantId: restaurant.id,
            restaurantName: restaurant.displayName,
            lines: lines.map {
                FoodPendingOrderLine(
                    menuItemId: $0.item.id,
                    quantity: $0.quantity,
                    modifierIds: $0.modifiers.map(\.id),
                    specialInstructions: $0.specialInstructions.isEmpty ? nil : $0.specialInstructions
                )
            },
            fulfillment: fulfillment,
            tableLabel: tableLabel,
            guestName: guestName,
            orderSource: orderSource,
            paymentMode: paymentMode,
            discountCode: discountCode,
            discountLabel: discountLabel,
            discountCents: discountCents,
            loyaltyPointsToRedeem: loyaltyPointsToRedeem,
            createdAt: Date(),
            attemptCount: 0
        )
        var all = load()
        if !all.contains(where: { $0.id == pending.id }) {
            all.insert(pending, at: 0)
            save(all)
        }
        return pending
    }

    static func remove(id: String) {
        save(load().filter { $0.id != id })
    }

    static func bumpAttempt(id: String) {
        var all = load()
        guard let index = all.firstIndex(where: { $0.id == id }) else { return }
        all[index].attemptCount += 1
        if all[index].attemptCount >= maxAttempts {
            all.remove(at: index)
        }
        save(all)
    }

    static func isNetworkFailure(_ error: Error) -> Bool {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut,
                 .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .dataNotAllowed:
                return true
            default:
                return false
            }
        }
        if case FoodAPIError.server(let code, _) = error {
            return code == 408 || code == 429 || code >= 502
        }
        return false
    }
}

private extension JSONDecoder {
    static let food: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

private extension JSONEncoder {
    static let food: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}
