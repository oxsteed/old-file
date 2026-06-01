import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - PulseSummarizer
//
// Turns raw Pulse / Life financial data into plain-English summaries.
// Powers the "Ask Pulse" feature on the Life tab dashboard.

struct PulseSummaryResult {
    /// 2-3 sentence plain-English overview (e.g. "You've spent $1,240 this month…")
    var overview: String
    /// Top insight or trend worth highlighting
    var topInsight: String
    /// 1-3 actionable suggestions
    var suggestions: [String]
}

@available(iOS 26, *)


@Generable
private struct PulseAnalysis: Codable {
    @Guide(description: "2-3 sentence plain-English financial overview. Include specific numbers. Use 'you' and present tense.")
    var overview: String

    @Guide(description: "The single most important insight from the data (1 sentence)")
    var topInsight: String

    @Guide(description: "1-3 practical, actionable suggestions the user can act on this week")
    var suggestions: [String]
}

enum PulseSummarizer {

    @MainActor
    static func summarize(pulse: APILifePulse, summary: APILifeDashboardSummary?) async throws -> PulseSummaryResult {
        guard #available(iOS 26, *) else { throw OxAIError.unavailable }

        let session = LanguageModelSession(instructions: """
            You are a friendly personal finance coach inside OxSteed's Life tab.
            You have the user's financial Pulse data for the current period.
            Give honest, encouraging, specific insights — never generic advice.
            Use dollar amounts when available. Keep suggestions practical and short.
            """)

        // Build a compact financial snapshot for the model
        var dataLines: [String] = []
        if let score = pulse.pulse_score { dataLines.append("Pulse score: \(score)/100") }
        if let s = summary {
            if let income = s.finances?.total_income { dataLines.append("Total income: $\(Int(income))") }
            if let spend  = s.finances?.total_expenses { dataLines.append("Total spending: $\(Int(spend))") }
            if let net    = s.finances?.net { dataLines.append("Net: $\(Int(net))") }
            if let goals  = s.goals?.active { dataLines.append("Active goals: \(goals)") }
            if let done   = s.goals?.completed { dataLines.append("Goals completed: \(done)") }
            if let pct    = s.goals?.avg_progress { dataLines.append("Average goal progress: \(pct)%") }
            if let over   = s.home?.overdue { dataLines.append("Overdue home tasks: \(over)") }
        }

        let dataBlock = dataLines.isEmpty
            ? "No detailed data available yet."
            : dataLines.joined(separator: "\n")

        let prompt = """
            User's financial snapshot:
            \(dataBlock)

            Provide a summary, top insight, and suggestions.
            """

        do {
            let response = try await session.respond(to: prompt, generating: PulseAnalysis.self)
            let a = response.content
            return PulseSummaryResult(
                overview: a.overview,
                topInsight: a.topInsight,
                suggestions: a.suggestions
            )
        } catch {
            throw OxAIError.modelError(error.localizedDescription)
        }
    }
}

