import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - DocumentAnalyzer
//
// Analyzes text extracted from an uploaded credential document (license, insurance
// certificate, government ID description) and returns structured metadata.
// Helps helpers understand what they've uploaded and flags any obvious issues.

struct DocumentAnalysisResult {
    /// Classified document type
    var documentType: DocumentType
    /// Key fields extracted (e.g. name, expiry, license number)
    var extractedFields: [String: String]
    /// Whether the document appears to be expired
    var isExpired: Bool
    /// Plain-English explanation of what was found
    var explanation: String
    /// Issues or warnings (empty if document looks fine)
    var warnings: [String]

    enum DocumentType: String {
        case driversLicense   = "Driver's License"
        case governmentID     = "Government ID"
        case tradeLicense     = "Trade License"
        case insuranceCert    = "Insurance Certificate"
        case backgroundCheck  = "Background Check"
        case businessLicense  = "Business License"
        case certification    = "Professional Certification"
        case unknown          = "Unknown Document"
    }
}

@available(iOS 26, *)


@Generable
private struct AnalyzedDocument: Codable {
    @Guide(description: "Document type: 'drivers_license', 'government_id', 'trade_license', 'insurance_cert', 'background_check', 'business_license', 'certification', or 'unknown'")
    var documentType: String

    @Guide(description: "Key fields extracted from the document as a JSON string with key-value pairs (e.g. '{\"name\": \"John Smith\", \"expiry\": \"2026-03-15\"}')")
    var extractedFieldsJSON: String

    @Guide(description: "True if the document contains an expiry date that has already passed")
    var isExpired: Bool

    @Guide(description: "A plain-English 1-2 sentence explanation of what the document appears to be and its status")
    var explanation: String

    @Guide(description: "Issues or warnings the user should be aware of (empty array if none)")
    var warnings: [String]
}

enum DocumentAnalyzer {

    /// Analyze text content extracted from a credential document.
    /// Pass OCR output or a user-provided description of the document.
    @MainActor
    static func analyze(documentText: String, documentHint: String? = nil) async throws -> DocumentAnalysisResult {
        guard #available(iOS 26, *) else { throw OxAIError.unavailable }

        let session = LanguageModelSession(instructions: """
            You are a document verification assistant for OxSteed, a local services marketplace.
            You help helpers understand what credential documents they've uploaded and flag issues.
            Be factual. Do not invent information not present in the text.
            Today's date for expiry checking: \(ISO8601DateFormatter().string(from: Date())).
            """)

        var prompt = "Document text:\n\(documentText.prefix(2000))"
        if let hint = documentHint {
            prompt += "\nUser indicated this is: \(hint)"
        }

        do {
            let response = try await session.respond(to: prompt, generating: AnalyzedDocument.self)
            let a = response.content
            let docType = documentTypeFromString(a.documentType)
            return DocumentAnalysisResult(
                documentType: docType,
                extractedFields: (try? JSONSerialization.jsonObject(with: Data(a.extractedFieldsJSON.utf8)) as? [String: String]) ?? [:],
                isExpired: a.isExpired,
                explanation: a.explanation,
                warnings: a.warnings
            )
        } catch {
            throw OxAIError.modelError(error.localizedDescription)
        }
    }

    private static func documentTypeFromString(_ raw: String) -> DocumentAnalysisResult.DocumentType {
        switch raw.lowercased() {
        case "drivers_license":  return .driversLicense
        case "government_id":    return .governmentID
        case "trade_license":    return .tradeLicense
        case "insurance_cert":   return .insuranceCert
        case "background_check": return .backgroundCheck
        case "business_license": return .businessLicense
        case "certification":    return .certification
        default:                 return .unknown
        }
    }
}
