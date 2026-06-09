import Foundation

// MARK: - Content Moderator

/// Lightweight client-side content moderation.
///
/// Runs two layers before any user-generated content is submitted:
///   1. **Keyword blocklist** — immediate local check against a short hardcoded list.
///      Additions are also fetched from /api/moderation/blocklist on first launch and cached.
///   2. **Server flag** — posts the text to /api/moderation/flag for async ML review.
///      If flagging fails (offline / server error) the submit is still allowed;
///      the server will run its own moderation pipeline when it receives the content.
///
/// Usage:
///   ```swift
///   do {
///       try ContentModerator.checkLocal(text)          // throws if blocked locally
///       try await ContentModerator.flagRemote(text, context: "review")
///   } catch ContentModerator.Error.blocked(let reason) {
///       self.error = reason
///   }
///   ```
enum ContentModerator {

    // MARK: - Error type

    enum Error: Swift.Error {
        case blocked(String)   // human-readable reason for the UI
    }

    // MARK: - Blocklist cache

    /// Hard-coded seed — intentionally minimal to avoid shipping explicit slurs
    /// in the app binary. Server-provided blocklist is the primary source.
    private static let seedBlocklist: [String] = [
        "wire transfer only", "western union", "send gift card",
        "guaranteed income", "100% free money",
    ]

    private static let cacheKey = "ox.moderation.blocklist"
    private static var _cached: [String]?
    private static var remoteBlocklistEnabled = true
    private static var remoteFlagEnabled = true

    private static var blocklist: [String] {
        if let cached = _cached { return cached }
        if let data = UserDefaults.standard.data(forKey: cacheKey),
           let decoded = try? JSONDecoder().decode([String].self, from: data) {
            _cached = decoded
            return decoded
        }
        return seedBlocklist
    }

    // MARK: - Refresh blocklist from server

    /// Call once on app launch (fire-and-forget). Merges with seed list.
    static func refreshBlocklist() {
        guard remoteBlocklistEnabled else { return }
        Task {
            struct Resp: Decodable { let terms: [String] }
            do {
                let resp: Resp = try await APIClient.shared.request(
                    "/api/moderation/blocklist",
                    requiresAuth: false,
                    as: Resp.self
                )
                let merged = Array(Set(seedBlocklist + resp.terms))
                _cached = merged
                UserDefaults.standard.set(try? JSONEncoder().encode(merged), forKey: cacheKey)
            } catch APIError.notFound {
                remoteBlocklistEnabled = false
            } catch {
                // best effort
            }
        }
    }

    // MARK: - Local check

    /// Throws `ContentModerator.Error.blocked` if the text matches any blocked term.
    /// Case-insensitive whole-word matching (simple contains check for short phrases).
    static func checkLocal(_ text: String) throws {
        let lower = normalizeForModeration(text)
        for term in blocklist {
            let normalizedTerm = normalizeForModeration(term)
            if !normalizedTerm.isEmpty && lower.contains(normalizedTerm) {
                throw Error.blocked("Your message contains content that isn't allowed on OxSteed. Please revise before submitting.")
            }
        }
    }

    private static func normalizeForModeration(_ text: String) -> String {
        let folded = text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: .current)
        let mapped = folded
            .replacingOccurrences(of: "0", with: "o")
            .replacingOccurrences(of: "1", with: "i")
            .replacingOccurrences(of: "3", with: "e")
            .replacingOccurrences(of: "4", with: "a")
            .replacingOccurrences(of: "5", with: "s")
            .replacingOccurrences(of: "7", with: "t")
        return mapped.unicodeScalars
            .filter { CharacterSet.alphanumerics.contains($0) || $0 == " " }
            .map(String.init)
            .joined()
    }

    // MARK: - Remote flag (fire-and-forget, non-blocking)

    /// Sends the text to the server moderation endpoint for async ML review.
    /// `locale` is the BCP-47 code (e.g. "en", "es", "fr", "ar", "ht") so the
    /// server pipeline can select the right language model.
    /// Errors are silently swallowed — do not gate submission on this call.
    static func flagRemote(_ text: String, context: String, locale: String = "en") async {
        guard remoteFlagEnabled else { return }
        struct Req: Encodable { let text: String; let context: String; let locale: String }
        struct Resp: Decodable { let ok: Bool }
        do {
            let _: Resp = try await APIClient.shared.request(
                "/api/moderation/flag",
                method: .POST,
                body: Req(text: text, context: context, locale: locale),
                as: Resp.self
            )
        } catch APIError.notFound {
            remoteFlagEnabled = false
        } catch {
            // best effort
        }
    }

    // MARK: - Combined helper

    /// Runs local check first (throws on block), then flags remotely (fire-and-forget).
    /// Pass `locale` (BCP-47) so the server ML pipeline uses the right language model.
    /// Call this before any UGC submission.
    static func check(_ text: String, context: String, locale: String = "en") async throws {
        try checkLocal(text)
        await flagRemote(text, context: context, locale: locale)
    }
}
