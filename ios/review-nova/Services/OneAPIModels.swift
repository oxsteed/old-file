import Foundation

// MARK: - Auth models (mirrors OxSteedOne's OneAPIModels.swift)

struct OneAuthUser: Codable {
    let id: String?
    let email: String?
    let defaultMode: String?

    private enum CodingKeys: String, CodingKey {
        case id, email, defaultMode
    }

    init(id: String?, email: String?, defaultMode: String?) {
        self.id = id; self.email = email; self.defaultMode = defaultMode
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let intID = try c.decodeIfPresent(Int.self, forKey: .id) {
            id = String(intID)
        } else {
            id = try c.decodeIfPresent(String.self, forKey: .id)
        }
        email = try c.decodeIfPresent(String.self, forKey: .email)
        defaultMode = try c.decodeIfPresent(String.self, forKey: .defaultMode)
    }
}

struct OneSavedSession: Codable {
    let token: String
    let user: OneAuthUser?
}

struct OneAuthResponse: Decodable {
    let accessToken: String?
    let refreshToken: String?
    let token: String?
    let user: OneAuthUser?

    private enum CodingKeys: String, CodingKey {
        case accessToken, refreshToken, token, user
        case access_token, refresh_token, data, result
    }

    private struct Payload: Decodable {
        let accessToken: String?
        let refreshToken: String?
        let token: String?
        let user: OneAuthUser?
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let direct = (
            access: (try? c.decodeIfPresent(String.self, forKey: .accessToken)) ?? (try? c.decodeIfPresent(String.self, forKey: .access_token)),
            refresh: (try? c.decodeIfPresent(String.self, forKey: .refreshToken)) ?? (try? c.decodeIfPresent(String.self, forKey: .refresh_token)),
            token: try? c.decodeIfPresent(String.self, forKey: .token),
            user: try? c.decodeIfPresent(OneAuthUser.self, forKey: .user)
        )
        let wrapped = (try? c.decodeIfPresent(Payload.self, forKey: .data)) ?? (try? c.decodeIfPresent(Payload.self, forKey: .result))
        accessToken  = direct.access  ?? wrapped?.accessToken  ?? wrapped?.token
        refreshToken = direct.refresh ?? wrapped?.refreshToken
        token        = direct.token
        user         = direct.user    ?? wrapped?.user
    }
}

struct OneLoginRequest: Encodable {
    let email: String
    let password: String
    let termsAgreed: Bool
    let agreementName: String
}

struct OneRegisterRequest: Encodable {
    let email: String
    let password: String
    let firstName: String
    let lastName: String
    let role: String
}

struct OneRefreshRequest: Encodable {
    let refreshToken: String
}

struct OneLogoutRequest: Encodable {
    let refreshToken: String
}

struct OneGenericSuccessResponse: Decodable {
    let success: Bool?
    let message: String?
}

// MARK: - Profile

struct OneUserProfileResponse: Decodable {
    let id: String?
    let email: String?
    let firstName: String?
    let lastName: String?
    let displayName: String?
    let defaultMode: String?
    let avatarUrl: String?
}


