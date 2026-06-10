import Foundation

// MARK: - Team & Access models
//
// Mirrors the web team-roles system (business_members + access codes / "Vortex")
// so a business in the iOS app can have managers, representatives, employees,
// and support agents — not just a single owner.
//
// NOTE: APIClient decodes with `.useDefaultKeys`, so these property names must
// match the server JSON keys exactly (snake_case).

/// Assignable team roles (owner is implicit — the business creator).
enum TeamRole: String, CaseIterable, Identifiable {
    case manager
    case representative
    case employee
    case support_agent

    var id: String { rawValue }

    var label: String {
        switch self {
        case .manager:       return "Manager"
        case .representative: return "Representative"
        case .employee:      return "Employee"
        case .support_agent: return "Support Agent"
        }
    }

    static func label(for raw: String) -> String {
        TeamRole(rawValue: raw)?.label
            ?? raw.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

/// The caller's own role + effective permissions on a business.
struct BusinessMembershipMe: Decodable, Equatable {
    let business_id: Int
    let business_name: String?
    let role: String
    let membership_id: Int?
    let permissions: [String]

    var isOwner: Bool { role == "owner" }

    /// Owners implicitly hold every permission.
    func can(_ permission: String) -> Bool {
        isOwner || permissions.contains(permission)
    }
}

/// A row in the business team roster.
struct BusinessMember: Decodable, Identifiable, Equatable {
    let id: Int
    let business_id: Int?
    let member_id: String?
    let role: String
    let status: String?
    let invite_email: String?
    let first_name: String?
    let last_name: String?
    let user_email: String?
    let profile_photo_url: String?
    let permissions: [String]?

    var isPending: Bool { (status ?? "") == "pending" }

    var displayName: String {
        let name = [first_name, last_name]
            .compactMap { $0 }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
        if !name.isEmpty { return name }
        return user_email ?? invite_email ?? "Member"
    }
}

/// A reusable, shareable access code tied to a role ("Vortex code").
struct BusinessAccessCode: Decodable, Identifiable, Equatable {
    let id: Int
    let code: String
    let role: String
    let label: String?
    let max_uses: Int?
    let uses: Int?
    let requires_approval: Bool?
    let expires_at: String?
    let is_active: Bool?
}

/// Preview of a code before the user commits to joining.
struct VortexPreview: Decodable, Equatable {
    let business_id: Int
    let business_name: String
    let role: String
    let label: String?
    let requires_approval: Bool
}

/// Result of redeeming a code.
struct VortexRedeemResult: Decodable, Equatable {
    let business_id: Int
    let status: String?
    let role: String?
    let membership_id: Int?
}

// MARK: - Service

enum TeamService {

    // ── Membership ──────────────────────────────────────────────────────────
    static func myMembership(businessId: Int) async throws -> BusinessMembershipMe {
        try await APIClient.shared.request("/api/businesses/\(businessId)/me")
    }

    static func memberships(businessId: Int) async throws -> [BusinessMember] {
        struct Resp: Decodable { let data: [BusinessMember] }
        let r: Resp = try await APIClient.shared.request("/api/businesses/\(businessId)/memberships")
        return r.data
    }

    /// Owner-only: change a member's role.
    static func changeRole(businessId: Int, membershipId: Int, role: String) async throws {
        struct Req: Encodable { let role: String }
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/memberships/\(membershipId)/role",
            method: .PATCH, body: Req(role: role)
        )
    }

    static func approve(businessId: Int, membershipId: Int) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/memberships/\(membershipId)/approve", method: .POST
        )
    }

    static func deny(businessId: Int, membershipId: Int) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/memberships/\(membershipId)/deny", method: .POST
        )
    }

    // ── Access codes (Vortex) ──────────────────────────────────────────────
    static func accessCodes(businessId: Int) async throws -> [BusinessAccessCode] {
        struct Resp: Decodable { let data: [BusinessAccessCode] }
        let r: Resp = try await APIClient.shared.request("/api/businesses/\(businessId)/access-codes")
        return r.data
    }

    static func createAccessCode(businessId: Int,
                                 role: String,
                                 label: String?,
                                 maxUses: Int?,
                                 expiresInDays: Int?,
                                 requiresApproval: Bool) async throws -> BusinessAccessCode {
        struct Req: Encodable {
            let role: String
            let label: String?
            let max_uses: Int?
            let expires_in_days: Int?
            let requires_approval: Bool
        }
        struct Resp: Decodable { let data: BusinessAccessCode }
        let r: Resp = try await APIClient.shared.request(
            "/api/businesses/\(businessId)/access-codes",
            method: .POST,
            body: Req(role: role, label: label, max_uses: maxUses,
                      expires_in_days: expiresInDays, requires_approval: requiresApproval)
        )
        return r.data
    }

    static func revokeAccessCode(businessId: Int, codeId: Int) async throws {
        try await APIClient.shared.requestVoid(
            "/api/businesses/\(businessId)/access-codes/\(codeId)", method: .DELETE
        )
    }

    // ── Vortex redemption (top-level entry point) ───────────────────────────
    static func previewCode(_ code: String) async throws -> VortexPreview {
        struct Req: Encodable { let code: String }
        struct Resp: Decodable { let data: VortexPreview }
        let r: Resp = try await APIClient.shared.request(
            "/api/vortex/preview", method: .POST, body: Req(code: code)
        )
        return r.data
    }

    static func redeemCode(_ code: String) async throws -> VortexRedeemResult {
        struct Req: Encodable { let code: String }
        struct Resp: Decodable { let data: VortexRedeemResult }
        let r: Resp = try await APIClient.shared.request(
            "/api/vortex/redeem", method: .POST, body: Req(code: code)
        )
        return r.data
    }
}
