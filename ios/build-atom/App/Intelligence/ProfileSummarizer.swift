import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - ProfileSummarizer
//
// Summarizes a helper's raw experience text into a short, trustworthy public bio
// and extracts searchable skill tags. Helps helpers who undersell themselves.

struct ProfileSummaryResult {
    /// Clean 2-3 sentence public bio
    var bio: String
    /// Extracted skill / capability tags (max 8)
    var skillTags: [String]
    /// Suggested headline (max 10 words)
    var headline: String
}

@available(iOS 26, *)


@Generable
private struct SummarizedProfile: Codable {
    @Guide(description: "A professional, trustworthy public bio: 2-3 sentences, third person, emphasizes reliability and skills. No superlatives.")
    var bio: String

    @Guide(description: "Up to 8 concrete skill or capability tags extracted from the text (e.g. 'Licensed plumber', 'Same-day availability', 'Bilingual Spanish/English')")
    var skillTags: [String]

    @Guide(description: "A punchy headline in 10 words or fewer (e.g. 'Licensed Electrician — 10 years residential & commercial')")
    var headline: String
}

enum ProfileSummarizer {

    @MainActor
    static func summarize(rawBio: String, services: [String] = []) async throws -> ProfileSummaryResult {
        guard #available(iOS 26, *) else { throw OxAIError.unavailable }

        let session = LanguageModelSession(instructions: """
            You are a professional copywriter for OxSteed, a local services marketplace.
            Your task is to polish a helper's profile to be clear, trustworthy, and appealing to customers.
            Never invent credentials not mentioned in the source text.
            Write in a warm but professional tone.
            """)

        var prompt = "Helper bio text: \"\(rawBio)\""
        if !services.isEmpty {
            prompt += "\nServices offered: \(services.joined(separator: ", "))"
        }

        do {
            let response = try await session.respond(to: prompt, generating: SummarizedProfile.self)
            let s = response.content
            return ProfileSummaryResult(
                bio: s.bio,
                skillTags: s.skillTags,
                headline: s.headline
            )
        } catch {
            throw OxAIError.modelError(error.localizedDescription)
        }
    }
}
