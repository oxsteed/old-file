import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - JobIntakeParser
//
// Uses the on-device Foundation Models to turn a plain-language description
// ("my sink is leaking and I need help tonight") into structured PostJob fields.
// Falls back to empty/default values on iOS < 26 or unavailable devices.

// MARK: - Parsed result

struct JobIntakeResult {
    /// Suggested job title (brief, action-oriented)
    var title: String
    /// Best-match category from the standard list
    var category: String
    /// "low" | "medium" | "high"
    var urgency: String
    /// Estimated budget range low, in dollars (0 = unknown)
    var budgetMinDollars: Int
    /// Estimated budget range high, in dollars (0 = unknown)
    var budgetMaxDollars: Int
    /// Cleaned-up job description paragraph
    var description: String
    /// Tools or materials the helper may need to bring
    var suggestedTools: [String]
    /// Follow-up questions to clarify the job
    var clarifyingQuestions: [String]
}

@available(iOS 26, *)


@Generable
private struct ParsedJobFields: Codable {
    @Guide(description: "A short, action-oriented job title (max 8 words)")
    var title: String

    @Guide(description: "Best-fit category from: Plumbing, Electrical, Cleaning, Moving, Handyman, Yard Work, HVAC, Painting, Carpentry, Appliance Repair, Pest Control, Locksmith, General Labor, Other")
    var category: String

    @Guide(description: "Urgency level: 'low' (flexible timing), 'medium' (within a week), or 'high' (today or tomorrow)")
    var urgency: String

    @Guide(description: "Estimated budget lower bound in whole dollars (0 if unknown)")
    var budgetMin: Int

    @Guide(description: "Estimated budget upper bound in whole dollars (0 if unknown)")
    var budgetMax: Int

    @Guide(description: "Rewritten job description: clear, professional, 1-3 sentences")
    var description: String

    @Guide(description: "List of tools or materials the helper might need (empty if unknown)")
    var suggestedTools: [String]

    @Guide(description: "1-3 clarifying questions to ask the customer (empty if job is already clear)")
    var clarifyingQuestions: [String]
}

// MARK: - Parser

enum JobIntakeParser {

    /// Parse a freeform job description into structured fields.
    /// Returns a default result if Foundation Models are unavailable.
    @MainActor
    static func parse(_ userInput: String) async throws -> JobIntakeResult {
        guard !userInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw OxAIError.parsingFailed
        }

        if #available(iOS 26, *) {
            return try await parseWithAI(userInput)
        } else {
            throw OxAIError.unavailable
        }
    }

    @available(iOS 26, *)
    private static func parseWithAI(_ input: String) async throws -> JobIntakeResult {
        let session = LanguageModelSession(instructions: """
            You are an assistant for OxSteed, a local services marketplace.
            A customer has described a problem or task they need help with.
            Extract structured job information from their description.
            Be concise. Infer sensible defaults when details are missing.
            Categories available: Plumbing, Electrical, Cleaning, Moving, Handyman, \
            Yard Work, HVAC, Painting, Carpentry, Appliance Repair, Pest Control, \
            Locksmith, General Labor, Other.
            """)

        let prompt = "Customer described their need as: \"\(input)\"\n\nExtract the job fields."

        do {
            let response = try await session.respond(to: prompt, generating: ParsedJobFields.self)
            let f = response.content
            return JobIntakeResult(
                title: f.title,
                category: f.category,
                urgency: f.urgency,
                budgetMinDollars: f.budgetMin,
                budgetMaxDollars: f.budgetMax,
                description: f.description,
                suggestedTools: f.suggestedTools,
                clarifyingQuestions: f.clarifyingQuestions
            )
        } catch {
            throw OxAIError.modelError(error.localizedDescription)
        }
    }
}
