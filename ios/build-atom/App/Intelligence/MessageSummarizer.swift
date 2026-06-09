import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - MessageSummarizer
//
// Summarizes a conversation thread, detects unanswered customer questions,
// and drafts a suggested reply. Reduces missed communication and disputes.

struct MessageSummaryResult {
    /// 2-4 sentence summary of what the conversation is about
    var summary: String
    /// Questions from the other party that haven't been answered yet
    var unansweredQuestions: [String]
    /// A suggested reply that addresses open questions (empty if none)
    var suggestedReply: String
    /// Overall sentiment: "positive" | "neutral" | "tense"
    var sentiment: String
}

@available(iOS 26, *)


@Generable
private struct ThreadAnalysis: Codable {
    @Guide(description: "2-4 sentence summary of the conversation topic and current status")
    var summary: String

    @Guide(description: "Questions or requests from the other party that have not yet received a direct answer (empty array if all answered)")
    var unansweredQuestions: [String]

    @Guide(description: "A suggested reply that addresses open questions. Use a friendly, professional tone. Empty string if no reply is needed.")
    var suggestedReply: String

    @Guide(description: "Overall tone of the conversation: 'positive', 'neutral', or 'tense'")
    var sentiment: String
}

enum MessageSummarizer {

    /// Summarize a list of messages into a thread analysis.
    /// Messages should be passed as "Speaker: text" formatted strings.
    @MainActor
    static func summarize(
        messages: [APIMessage],
        currentUserName: String,
        otherPartyName: String
    ) async throws -> MessageSummaryResult {
        guard #available(iOS 26, *) else { throw OxAIError.unavailable }
        guard !messages.isEmpty else { throw OxAIError.parsingFailed }

        // Build a compact transcript (cap at last 40 messages to keep prompt small)
        let transcript = messages.suffix(40).map { msg in
            let speaker = (msg.sender_id == nil) ? otherPartyName : currentUserName
            return "\(speaker): \(msg.content)"
        }.joined(separator: "\n")

        let session = LanguageModelSession(instructions: """
            You are a communication assistant for OxSteed, a local services marketplace.
            Analyze a message thread between a customer and a helper.
            Identify what work is being discussed, any open questions, and the tone.
            Be concise and objective.
            """)

        let prompt = """
            Conversation between \(currentUserName) and \(otherPartyName):

            \(transcript)

            Analyze this thread.
            """

        do {
            let response = try await session.respond(to: prompt, generating: ThreadAnalysis.self)
            let a = response.content
            return MessageSummaryResult(
                summary: a.summary,
                unansweredQuestions: a.unansweredQuestions,
                suggestedReply: a.suggestedReply,
                sentiment: a.sentiment
            )
        } catch {
            throw OxAIError.modelError(error.localizedDescription)
        }
    }
}
