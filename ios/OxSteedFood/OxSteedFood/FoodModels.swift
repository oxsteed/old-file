import Foundation
import CoreLocation

struct FoodRestaurant: Identifiable, Codable, Hashable {
    let id: Int64
    let businessId: Int64?
    var displayName: String
    var description: String?
    var cuisineTags: [String]
    var coverPhotoUrl: String?
    var logoUrl: String?
    var addressCity: String?
    var addressState: String?
    var addressCountry: String
    var latitude: Double?
    var longitude: Double?
    var currencyCode: String
    var fulfillmentModes: [String]
    var acceptsOnlineOrders: Bool
    var acceptsInStoreOrders: Bool
    var kitchenDisplayEnabled: Bool
    var prepTimeMin: Int
    var distanceKm: Double?

    var coordinate: CLLocationCoordinate2D? {
        guard let latitude, let longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var locationLine: String {
        [addressCity, addressState, addressCountry].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    enum CodingKeys: String, CodingKey {
        case id
        case businessId = "business_id"
        case displayName = "display_name"
        case description
        case cuisineTags = "cuisine_tags"
        case coverPhotoUrl = "cover_photo_url"
        case logoUrl = "logo_url"
        case addressCity = "address_city"
        case addressState = "address_state"
        case addressCountry = "address_country"
        case latitude
        case longitude
        case currencyCode = "currency_code"
        case fulfillmentModes = "fulfillment_modes"
        case acceptsOnlineOrders = "accepts_online_orders"
        case acceptsInStoreOrders = "accepts_in_store_orders"
        case kitchenDisplayEnabled = "kitchen_display_enabled"
        case prepTimeMin = "prep_time_min"
        case distanceKm = "distance_km"
    }
}

struct FoodMenuSection: Identifiable, Codable, Hashable {
    let id: Int64
    var name: String
    var description: String?
    var items: [FoodMenuItem]
}

struct FoodMenuItem: Identifiable, Codable, Hashable {
    let id: Int64
    var categoryId: Int64?
    var name: String
    var description: String?
    var imageUrl: String?
    var priceCents: Int
    var currencyCode: String
    var isAvailable: Bool
    var tags: [String]
    var allergens: [String]
    var modifierGroups: [FoodModifierGroup]

    enum CodingKeys: String, CodingKey {
        case id
        case categoryId = "category_id"
        case name
        case description
        case imageUrl = "image_url"
        case priceCents = "price_cents"
        case currencyCode = "currency_code"
        case isAvailable = "is_available"
        case tags
        case allergens
        case modifierGroups
    }
}

struct FoodModifierGroup: Identifiable, Codable, Hashable {
    let id: Int64
    var name: String
    var minSelect: Int
    var maxSelect: Int
    var isRequired: Bool
    var options: [FoodModifier]
}

struct FoodModifier: Identifiable, Codable, Hashable {
    let id: Int64
    var name: String
    var priceDeltaCents: Int
    var isAvailable: Bool
}

struct FoodOrder: Identifiable, Codable, Hashable {
    let id: Int64
    var restaurantId: Int64
    var status: String
    var fulfillmentType: String
    var orderSource: String
    var paymentStatus: String
    var queueNumber: Int
    var totalCents: Int
    var currencyCode: String
    var tableLabel: String?
    var guestName: String?
    var createdAt: Date?
    var promisedAt: Date?
    var items: [FoodOrderLine]?

    enum CodingKeys: String, CodingKey {
        case id
        case restaurantId = "restaurant_id"
        case status
        case fulfillmentType = "fulfillment_type"
        case orderSource = "order_source"
        case paymentStatus = "payment_status"
        case queueNumber = "queue_number"
        case totalCents = "total_cents"
        case currencyCode = "currency_code"
        case tableLabel = "table_label"
        case guestName = "guest_name"
        case createdAt = "created_at"
        case promisedAt = "promised_at"
        case items
    }
}

struct FoodOrderLine: Identifiable, Codable, Hashable {
    let id: Int64
    var itemName: String
    var quantity: Int
    var lineTotalCents: Int
    var specialInstructions: String?
}

struct CartLine: Identifiable, Hashable {
    let id = UUID()
    var item: FoodMenuItem
    var quantity: Int = 1
    var specialInstructions: String = ""

    var lineTotalCents: Int { item.priceCents * quantity }
}

func foodMoney(_ cents: Int, currency: String = "USD") -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = currency
    return formatter.string(from: NSNumber(value: Double(cents) / 100.0)) ?? "$\(cents / 100)"
}
