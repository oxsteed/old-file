import Foundation

struct GenericMutationResponse: Decodable {
    let id: Int?
    let success: Bool?
    let message: String?
    let reference: String?

    var displayText: String {
        if let reference {
            return "Created \(reference)"
        }
        if let id {
            return "Created record #\(id)"
        }
        if let message, !message.isEmpty {
            return message
        }
        if success == true {
            return "Request completed."
        }
        return "The server accepted the request."
    }
}

struct JobDraftRequest: Encodable {
    var title: String
    var description: String
    var categoryName: String
    var budgetType: String
    var budgetMin: String?
    var budgetMax: String?
    var urgency: String
    var siteAccess: String
    var locationAddress: String?
    var locationCity: String
    var locationState: String?
    var locationZip: String?
    var locationCountry: String
}

struct MarketplaceSearchQuery: Encodable {
    var query: String
    var category: String?
    var sort: String?
    var skillId: String?
}

struct ConversationDraftRequest: Encodable {
    var recipientId: String
    var message: String
    var context: String
}

struct LogisticsSourcingRequestDraft: Encodable {
    var title: String
    var description: String
    var laneId: String?
    var quantity: String
    var unit: String
    var targetPriceUsd: String?
    var destinationCity: String
    var destinationCountry: String
}

struct TranslationDraftRequest: Encodable {
    var text: String
    var sourceLocale: String?
    var targetLocale: String
}

struct NativeEndpointPreview: Identifiable {
    let id = UUID()
    let method: String
    let path: String
    let note: String
}
