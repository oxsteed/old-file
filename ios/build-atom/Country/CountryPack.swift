import SwiftUI

// MARK: - Country pack models (docs/oxsteed-pack-architecture.md §5)
//
// A country is a pack registered on the server, never a condition checked in
// code. This file is the ONLY place the app talks to /api/country-config;
// everything else consumes `CountryStore`.

struct APICountryListEntry: Decodable, Identifiable, Equatable {
    let code: String
    let name: String
    let flag_emoji: String?
    let status: String            // "active" | "coming_soon"
    let default_locale: String?
    let currency_code: String?
    let locales: [String]?

    var id: String { code }
    var isActive: Bool { status == "active" }
}

struct APICountryList: Decodable {
    let available: [APICountryListEntry]
    let coming_soon: [APICountryListEntry]
}

/// Full pack for an active country. Unknown keys are ignored so the server
/// can grow the pack without breaking older clients.
struct APICountryConfig: Decodable, Equatable {
    let code: String
    let name: String?
    let flag_emoji: String?
    let default_locale: String?
    let currency_code: String?
    let locales: [String]?
    let units: String?
    let enabled_personas: [String]?
    let payment_methods: [String]?
    let verification_provider: String?
    let address_scheme: String?
    let notification_channels: [String]?
    let connectivity_profile: String?
    let trust_model: String?
}

// MARK: - Service

enum CountryService {
    private struct ListWrapper: Decodable {
        let success: Bool
        let data: APICountryList?
    }
    private struct ConfigWrapper: Decodable {
        let success: Bool
        let data: APICountryConfig?
        let code: String?         // "country_coming_soon" when not active
    }

    static func listCountries() async throws -> APICountryList {
        let r: ListWrapper = try await APIClient.shared.request(
            "/api/country-config/countries", requiresAuth: false)
        return r.data ?? APICountryList(available: [], coming_soon: [])
    }

    /// Returns the pack for an active country, nil for coming_soon/unknown.
    static func config(for code: String) async throws -> APICountryConfig? {
        let r: ConfigWrapper = try await APIClient.shared.request(
            "/api/country-config", query: ["country": code], requiresAuth: false)
        return r.success ? r.data : nil
    }
}

// MARK: - Store

@MainActor
final class CountryStore: ObservableObject {
    static let storageKey = "ox.country.code"

    @Published var available: [APICountryListEntry] = []
    @Published var comingSoon: [APICountryListEntry] = []
    @Published var config: APICountryConfig?
    @Published var isLoading = false
    @Published private(set) var selectedCode: String

    init() {
        selectedCode = UserDefaults.standard.string(forKey: Self.storageKey) ?? "US"
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        if let list = try? await CountryService.listCountries() {
            available = list.available
            comingSoon = list.coming_soon
            // If the saved selection stopped being active server-side, fall
            // back to the first available country (US at launch).
            if !available.contains(where: { $0.code == selectedCode }),
               let first = available.first {
                selectedCode = first.code
                UserDefaults.standard.set(first.code, forKey: Self.storageKey)
            }
        }
        config = (try? await CountryService.config(for: selectedCode)) ?? nil
    }

    /// Select a country. Only `active` entries are selectable; coming-soon
    /// rows are rendered but inert (the whole point of the picker).
    func select(_ entry: APICountryListEntry) async {
        guard entry.isActive, entry.code != selectedCode else { return }
        selectedCode = entry.code
        UserDefaults.standard.set(entry.code, forKey: Self.storageKey)
        config = (try? await CountryService.config(for: entry.code)) ?? nil
    }

    /// Country veto over personas (precedence rule: country can veto, never
    /// redesign). Fails open: with no config loaded, every persona is enabled.
    func isPersonaEnabled(_ persona: Persona) -> Bool {
        guard let enabled = config?.enabled_personas, !enabled.isEmpty else { return true }
        return enabled.contains(persona.packId)
    }

    var selectedEntry: APICountryListEntry? {
        available.first { $0.code == selectedCode }
    }
}
