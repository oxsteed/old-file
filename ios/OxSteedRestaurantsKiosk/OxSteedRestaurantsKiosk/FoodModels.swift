import Foundation
import CoreLocation

// MARK: - Tolerant JSON decoding
//
// node-postgres serializes BIGINT columns ("id", "restaurant_id", ...) as JSON
// strings ("42"), while the same values built inside SQL json_agg arrive as
// numbers (42). Timestamps carry fractional seconds that Foundation's stock
// .iso8601 strategy rejects. These helpers accept every shape the API emits,
// so live data decodes instead of silently falling back to demo content.

extension KeyedDecodingContainer {
    func flexInt64(_ key: Key) throws -> Int64 {
        if let value = try? decode(Int64.self, forKey: key) { return value }
        if let raw = try? decode(String.self, forKey: key), let value = Int64(raw) { return value }
        if let value = try? decode(Double.self, forKey: key) { return Int64(value) }
        throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "Expected an integer or numeric string")
    }

    func flexInt64IfPresent(_ key: Key) -> Int64? {
        if let value = try? decode(Int64.self, forKey: key) { return value }
        if let raw = try? decode(String.self, forKey: key) { return Int64(raw) }
        if let value = try? decode(Double.self, forKey: key) { return Int64(value) }
        return nil
    }

    func flexInt(_ key: Key, default fallback: Int = 0) -> Int {
        if let value = try? decode(Int.self, forKey: key) { return value }
        if let raw = try? decode(String.self, forKey: key), let value = Int(raw) { return value }
        if let value = try? decode(Double.self, forKey: key) { return Int(value) }
        return fallback
    }

    func flexDoubleIfPresent(_ key: Key) -> Double? {
        if let value = try? decode(Double.self, forKey: key) { return value }
        if let raw = try? decode(String.self, forKey: key) { return Double(raw) }
        return nil
    }

    func flexBool(_ key: Key, default fallback: Bool) -> Bool {
        if let value = try? decode(Bool.self, forKey: key) { return value }
        if let raw = try? decode(String.self, forKey: key) { return raw == "true" || raw == "t" || raw == "1" }
        if let value = try? decode(Int.self, forKey: key) { return value != 0 }
        return fallback
    }

    func flexString(_ key: Key) -> String? {
        if let value = try? decode(String.self, forKey: key) { return value }
        if let value = try? decode(Int64.self, forKey: key) { return String(value) }
        if let value = try? decode(Double.self, forKey: key) { return String(value) }
        return nil
    }

    func flexStringArray(_ key: Key) -> [String] {
        (try? decode([String].self, forKey: key)) ?? []
    }

    func flexDateIfPresent(_ key: Key) -> Date? {
        guard let raw = try? decode(String.self, forKey: key) else { return nil }
        return FoodDates.parse(raw)
    }
}

enum FoodDates {
    static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
    static func parse(_ raw: String) -> Date? {
        fractional.date(from: raw) ?? plain.date(from: raw)
    }
}

// MARK: - Restaurant

struct FoodRestaurant: Identifiable, Hashable {
    let id: Int64
    var businessId: Int64?
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
    var status: String

    var coordinate: CLLocationCoordinate2D? {
        guard let latitude, let longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var locationLine: String {
        [addressCity, addressState, addressCountry].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

extension FoodRestaurant: Decodable {
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
        case status
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        businessId = c.flexInt64IfPresent(.businessId)
        displayName = c.flexString(.displayName) ?? "Restaurant"
        description = c.flexString(.description)
        cuisineTags = c.flexStringArray(.cuisineTags)
        coverPhotoUrl = c.flexString(.coverPhotoUrl)
        logoUrl = c.flexString(.logoUrl)
        addressCity = c.flexString(.addressCity)
        addressState = c.flexString(.addressState)
        addressCountry = c.flexString(.addressCountry) ?? "US"
        latitude = c.flexDoubleIfPresent(.latitude)
        longitude = c.flexDoubleIfPresent(.longitude)
        currencyCode = c.flexString(.currencyCode) ?? "USD"
        fulfillmentModes = c.flexStringArray(.fulfillmentModes)
        acceptsOnlineOrders = c.flexBool(.acceptsOnlineOrders, default: true)
        acceptsInStoreOrders = c.flexBool(.acceptsInStoreOrders, default: true)
        kitchenDisplayEnabled = c.flexBool(.kitchenDisplayEnabled, default: true)
        prepTimeMin = c.flexInt(.prepTimeMin, default: 15)
        distanceKm = c.flexDoubleIfPresent(.distanceKm)
        // The public list endpoint omits status (it only returns active rows);
        // merchant endpoints include it.
        status = c.flexString(.status) ?? "active"
    }
}

// MARK: - Menu

struct FoodMenuSection: Identifiable, Hashable {
    let id: Int64
    var name: String
    var description: String?
    var items: [FoodMenuItem]
}

extension FoodMenuSection: Decodable {
    enum CodingKeys: String, CodingKey { case id, name, description, items }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        name = c.flexString(.name) ?? "Menu"
        description = c.flexString(.description)
        items = (try? c.decode([FoodMenuItem].self, forKey: .items)) ?? []
    }
}

struct FoodMenuItem: Identifiable, Hashable {
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
}

extension FoodMenuItem: Decodable {
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

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        categoryId = c.flexInt64IfPresent(.categoryId)
        name = c.flexString(.name) ?? "Item"
        description = c.flexString(.description)
        imageUrl = c.flexString(.imageUrl)
        priceCents = c.flexInt(.priceCents, default: 0)
        currencyCode = c.flexString(.currencyCode) ?? "USD"
        isAvailable = c.flexBool(.isAvailable, default: true)
        tags = c.flexStringArray(.tags)
        allergens = c.flexStringArray(.allergens)
        modifierGroups = (try? c.decode([FoodModifierGroup].self, forKey: .modifierGroups)) ?? []
    }
}

struct FoodModifierGroup: Identifiable, Hashable {
    let id: Int64
    var name: String
    var minSelect: Int
    var maxSelect: Int
    var isRequired: Bool
    var options: [FoodModifier]
}

extension FoodModifierGroup: Decodable {
    enum CodingKeys: String, CodingKey { case id, name, minSelect, maxSelect, isRequired, options }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        name = c.flexString(.name) ?? "Options"
        minSelect = c.flexInt(.minSelect, default: 0)
        maxSelect = max(c.flexInt(.maxSelect, default: 1), 1)
        isRequired = c.flexBool(.isRequired, default: false)
        options = (try? c.decode([FoodModifier].self, forKey: .options)) ?? []
    }
}

struct FoodModifier: Identifiable, Hashable {
    let id: Int64
    var name: String
    var priceDeltaCents: Int
    var isAvailable: Bool
}

extension FoodModifier: Decodable {
    enum CodingKeys: String, CodingKey { case id, name, priceDeltaCents, isAvailable }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        name = c.flexString(.name) ?? "Option"
        priceDeltaCents = c.flexInt(.priceDeltaCents, default: 0)
        isAvailable = c.flexBool(.isAvailable, default: true)
    }
}

// MARK: - Orders

struct FoodOrder: Identifiable, Hashable {
    let id: Int64
    var restaurantId: Int64
    var restaurantName: String?
    var status: String
    var fulfillmentType: String
    var orderSource: String
    var paymentStatus: String
    var queueNumber: Int
    var subtotalCents: Int
    var totalCents: Int
    var currencyCode: String
    var tableLabel: String?
    var guestName: String?
    var createdAt: Date?
    var promisedAt: Date?
    var items: [FoodOrderLine]

    var isActive: Bool {
        ["received", "accepted", "preparing", "ready"].contains(status)
    }
}

extension FoodOrder: Decodable {
    enum CodingKeys: String, CodingKey {
        case id
        case restaurantId = "restaurant_id"
        case restaurantName = "restaurant_name"
        case status
        case fulfillmentType = "fulfillment_type"
        case orderSource = "order_source"
        case paymentStatus = "payment_status"
        case queueNumber = "queue_number"
        case subtotalCents = "subtotal_cents"
        case totalCents = "total_cents"
        case currencyCode = "currency_code"
        case tableLabel = "table_label"
        case guestName = "guest_name"
        case createdAt = "created_at"
        case promisedAt = "promised_at"
        case items
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        restaurantId = (try? c.flexInt64(.restaurantId)) ?? 0
        restaurantName = c.flexString(.restaurantName)
        status = c.flexString(.status) ?? "received"
        fulfillmentType = c.flexString(.fulfillmentType) ?? "pickup"
        orderSource = c.flexString(.orderSource) ?? "mobile"
        paymentStatus = c.flexString(.paymentStatus) ?? "unpaid"
        queueNumber = c.flexInt(.queueNumber, default: 0)
        subtotalCents = c.flexInt(.subtotalCents, default: 0)
        totalCents = c.flexInt(.totalCents, default: 0)
        currencyCode = c.flexString(.currencyCode) ?? "USD"
        tableLabel = c.flexString(.tableLabel)
        guestName = c.flexString(.guestName)
        createdAt = c.flexDateIfPresent(.createdAt)
        promisedAt = c.flexDateIfPresent(.promisedAt)
        items = (try? c.decode([FoodOrderLine].self, forKey: .items)) ?? []
    }
}

struct FoodOrderLine: Identifiable, Hashable {
    let id: Int64
    var itemName: String
    var quantity: Int
    var lineTotalCents: Int
    var specialInstructions: String?
}

extension FoodOrderLine: Decodable {
    enum CodingKeys: String, CodingKey {
        case id, itemName, quantity, lineTotalCents, specialInstructions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        itemName = c.flexString(.itemName) ?? "Item"
        quantity = c.flexInt(.quantity, default: 1)
        lineTotalCents = c.flexInt(.lineTotalCents, default: 0)
        specialInstructions = c.flexString(.specialInstructions)
    }
}

// MARK: - Queue board ("now serving" wall display)

struct FoodQueueBoard: Hashable {
    struct Header: Hashable {
        var id: Int64
        var displayName: String
    }
    struct Entry: Hashable {
        var queueNumber: Int
        var guestLabel: String
        var fulfillmentType: String
        var promisedAt: Date?
    }
    var restaurant: Header
    var preparing: [Int]
    var ready: [Int]
    var preparingEntries: [Entry]
    var readyEntries: [Entry]
}

extension FoodQueueBoard: Decodable {
    enum CodingKeys: String, CodingKey { case restaurant, preparing, ready, preparingEntries, readyEntries }
    enum HeaderKeys: String, CodingKey {
        case id
        case displayName = "display_name"
    }
    enum EntryKeys: String, CodingKey {
        case queueNumber = "queueNumber"
        case guestLabel = "guestLabel"
        case fulfillmentType = "fulfillmentType"
        case promisedAt = "promisedAt"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let h = try c.nestedContainer(keyedBy: HeaderKeys.self, forKey: .restaurant)
        restaurant = Header(id: try h.flexInt64(.id), displayName: h.flexString(.displayName) ?? "Restaurant")
        preparing = (try? c.decode([Int].self, forKey: .preparing)) ?? []
        ready = (try? c.decode([Int].self, forKey: .ready)) ?? []
        preparingEntries = (try? c.decode([Entry].self, forKey: .preparingEntries)) ?? preparing.map {
            Entry(queueNumber: $0, guestLabel: "Guest", fulfillmentType: "pickup", promisedAt: nil)
        }
        readyEntries = (try? c.decode([Entry].self, forKey: .readyEntries)) ?? ready.map {
            Entry(queueNumber: $0, guestLabel: "Guest", fulfillmentType: "pickup", promisedAt: nil)
        }
    }
}

extension FoodQueueBoard.Entry: Decodable {
    private enum CodingKeys: String, CodingKey {
        case queueNumber = "queueNumber"
        case guestLabel = "guestLabel"
        case fulfillmentType = "fulfillmentType"
        case promisedAt = "promisedAt"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        queueNumber = c.flexInt(.queueNumber, default: 0)
        guestLabel = c.flexString(.guestLabel) ?? "Guest"
        fulfillmentType = c.flexString(.fulfillmentType) ?? "pickup"
        promisedAt = c.flexDateIfPresent(.promisedAt)
    }
}

// MARK: - Kiosk configuration

struct FoodKioskConfigResponse: Hashable {
    var restaurantID: Int64
    var preferredLanguage: String
    var lockedMode: Bool
    var autoResetSeconds: Int
    var updatedAt: Date?
}

extension FoodKioskConfigResponse: Decodable {
    enum CodingKeys: String, CodingKey {
        case restaurantID = "restaurant_id"
        case preferredLanguage = "preferred_language"
        case lockedMode = "locked_mode"
        case autoResetSeconds = "auto_reset_seconds"
        case updatedAt = "updated_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        restaurantID = try c.flexInt64(.restaurantID)
        preferredLanguage = c.flexString(.preferredLanguage) ?? "English"
        lockedMode = c.flexBool(.lockedMode, default: true)
        autoResetSeconds = c.flexInt(.autoResetSeconds, default: 8)
        updatedAt = c.flexDateIfPresent(.updatedAt)
    }
}

// MARK: - Auth

struct FoodAuthSession: Decodable {
    let accessToken: String?
    let refreshToken: String?
}

// MARK: - Cart

struct CartLine: Identifiable, Hashable {
    let id = UUID()
    var item: FoodMenuItem
    var quantity: Int = 1
    var modifiers: [FoodModifier] = []
    var specialInstructions: String = ""

    var unitTotalCents: Int {
        item.priceCents + modifiers.reduce(0) { $0 + $1.priceDeltaCents }
    }
    var lineTotalCents: Int { unitTotalCents * quantity }
    var modifierSummary: String {
        modifiers.map(\.name).joined(separator: ", ")
    }
}

func foodMoney(_ cents: Int, currency: String = "USD") -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = currency
    return formatter.string(from: NSNumber(value: Double(cents) / 100.0)) ?? "$\(cents / 100)"
}
