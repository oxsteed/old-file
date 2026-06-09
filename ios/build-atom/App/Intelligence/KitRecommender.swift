import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - KitRecommender
//
// Converts a job description into a suggested supply kit / checklist.
// Supports OxSteed's "task kits" concept: bundled tool + supply recommendations
// tied to a job category, without holding inventory.

struct KitRecommendation {
    /// Recommended tools the helper should bring
    var tools: [KitItem]
    /// Materials / supplies needed for the job
    var materials: [KitItem]
    /// Safety or compliance notes (e.g. "PPE required", "permit may be needed")
    var safetyNotes: [String]
    /// Estimated prep time in minutes before the job
    var estimatedPrepMinutes: Int
}

struct KitItem: Identifiable {
    let id = UUID()
    var name: String
    var quantity: String  // e.g. "1", "2 gallons", "as needed"
    var notes: String?    // optional clarification
}

@available(iOS 26, *)


@Generable
private struct RecommendedKit: Codable {
    @Guide(description: "Tool/equipment names, one per entry (e.g. 'Pipe wrench', 'Drill')")
    var toolNames: [String]

    @Guide(description: "Quantity for each tool, matching toolNames by index (e.g. '1', '2')")
    var toolQuantities: [String]

    @Guide(description: "Optional note for each tool, matching toolNames by index (empty string if none)")
    var toolNotes: [String]

    @Guide(description: "Material/supply names, one per entry (e.g. 'PVC pipe', 'Sandpaper')")
    var materialNames: [String]

    @Guide(description: "Quantity for each material, matching materialNames by index (e.g. '2 gallons', 'as needed')")
    var materialQuantities: [String]

    @Guide(description: "Optional note for each material, matching materialNames by index (empty string if none)")
    var materialNotes: [String]

    @Guide(description: "Safety requirements, permit considerations, or compliance notes (empty array if none)")
    var safetyNotes: [String]

    @Guide(description: "Estimated preparation time in minutes before arriving at the job site (0 if unknown)")
    var estimatedPrepMinutes: Int
}

enum KitRecommender {

    @MainActor
    static func recommend(
        jobTitle: String,
        jobDescription: String,
        category: String
    ) async throws -> KitRecommendation {
        guard #available(iOS 26, *) else { throw OxAIError.unavailable }

        let session = LanguageModelSession(instructions: """
            You are a tradesperson assistant for OxSteed, a local services marketplace.
            Given a job description, recommend what tools and materials a helper should bring.
            Be practical and specific. Use common tool/material names a tradesperson would recognize.
            Only recommend what is genuinely needed — don't pad the list.
            """)

        let prompt = """
            Job: \(jobTitle)
            Category: \(category)
            Description: \(jobDescription)

            What tools and materials should the helper bring?
            """

        do {
            let response = try await session.respond(to: prompt, generating: RecommendedKit.self)
            let k = response.content
            let tools = k.toolNames.enumerated().map { i, name in
                KitItem(
                    name: name,
                    quantity: k.toolQuantities.indices.contains(i) ? k.toolQuantities[i] : "1",
                    notes: (k.toolNotes.indices.contains(i) && !k.toolNotes[i].isEmpty) ? k.toolNotes[i] : nil
                )
            }
            let materials = k.materialNames.enumerated().map { i, name in
                KitItem(
                    name: name,
                    quantity: k.materialQuantities.indices.contains(i) ? k.materialQuantities[i] : "as needed",
                    notes: (k.materialNotes.indices.contains(i) && !k.materialNotes[i].isEmpty) ? k.materialNotes[i] : nil
                )
            }
            return KitRecommendation(
                tools: tools,
                materials: materials,
                safetyNotes: k.safetyNotes,
                estimatedPrepMinutes: k.estimatedPrepMinutes
            )
        } catch {
            throw OxAIError.modelError(error.localizedDescription)
        }
    }
}
