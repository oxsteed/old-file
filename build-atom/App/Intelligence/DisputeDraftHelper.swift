import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - DisputeDraftHelper
//
// Helps users draft refund requests, job issue reports, and resolution summaries.
// Support flows are repetitive, text-heavy, and emotionally charged —
// exactly where on-device summarization and rewriting help the most.

enum DisputeType: String, CaseIterable {
    case refundRequest    = "Refund Request"
    case workNotCompleted = "Work Not Completed"
    case poorQuality      = "Poor Quality of Work"
    case noShow           = "Helper No-Show"
    case overcharge       = "Overcharge / Billing Dispute"
    case safetyIssue      = "Safety Concern"
    case other            = "Other Issue"
}

struct DisputeDraftResult {
    /// Polished, professional draft ready to submit
    var draftText: String
    /// Suggested subject line
    var subjectLine: String
    /// Key supporting points the user should document (receipts, photos, etc.)
    var evidenceNeeded: [String]
    /// Recommended resolution path: "self-resolve" | "platform-mediation" | "escalate"
    var recommendedPath: String
}

@available(iOS 26, *)


@Generable
private struct DisputeDraft: Codable {
    @Guide(description: "A professional, factual dispute message. Avoid emotional language. State what happened, what was expected, and what resolution is requested. 100-200 words.")
    var draftText: String

    @Guide(description: "A concise subject line for the dispute (max 12 words)")
    var subjectLine: String

    @Guide(description: "Types of evidence or documentation the user should gather to support their case")
    var evidenceNeeded: [String]

    @Guide(description: "Recommended resolution path: 'self-resolve' (contact helper directly), 'platform-mediation' (involve OxSteed support), or 'escalate' (serious issue needing urgent attention)")
    var recommendedPath: String
}

enum DisputeDraftHelper {

    @MainActor
    static func draft(
        disputeType: DisputeType,
        jobTitle: String,
        userSituation: String,
        amountCents: Int? = nil
    ) async throws -> DisputeDraftResult {
        guard #available(iOS 26, *) else { throw OxAIError.unavailable }

        let session = LanguageModelSession(instructions: """
            You are a customer support writing assistant for OxSteed, a local services marketplace.
            Help users write clear, professional dispute messages.
            Be factual, calm, and specific. Do not exaggerate or add drama.
            The goal is a fair resolution for all parties.
            """)

        var prompt = """
            Dispute type: \(disputeType.rawValue)
            Job: \(jobTitle)
            User's situation: \(userSituation)
            """
        if let cents = amountCents, cents > 0 {
            prompt += "\nAmount in dispute: $\(cents / 100)"
        }
        prompt += "\n\nDraft a professional dispute message."

        do {
            let response = try await session.respond(to: prompt, generating: DisputeDraft.self)
            let d = response.content
            return DisputeDraftResult(
                draftText: d.draftText,
                subjectLine: d.subjectLine,
                evidenceNeeded: d.evidenceNeeded,
                recommendedPath: d.recommendedPath
            )
        } catch {
            throw OxAIError.modelError(error.localizedDescription)
        }
    }
}
