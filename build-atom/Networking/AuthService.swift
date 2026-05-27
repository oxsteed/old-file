import Foundation

enum AuthService {
    struct LoginRequest: Encodable { let email: String; let password: String }
    struct RegisterRequest: Encodable {
        let email: String
        let password: String
        let first_name: String
        let last_name: String
        let phone: String?
        let language: String?
    }
    struct SwitchRoleRequest: Encodable { let mode: String }
    struct UpdateProfileRequest: Encodable {
        let first_name: String?
        let last_name: String?
        let phone: String?
        let display_name_preference: String?
    }

    static func login(email: String, password: String) async throws -> AuthResponse {
        try await APIClient.shared.request(
            "/api/auth/login",
            method: .POST,
            body: LoginRequest(email: email, password: password),
            requiresAuth: false
        )
    }

    static func register(email: String, password: String, firstName: String, lastName: String,
                         phone: String?, language: String?) async throws -> AuthResponse {
        try await APIClient.shared.request(
            "/api/auth/register",
            method: .POST,
            body: RegisterRequest(email: email, password: password,
                                  first_name: firstName, last_name: lastName,
                                  phone: phone, language: language),
            requiresAuth: false
        )
    }

    static func me() async throws -> APIUser {
        try await APIClient.shared.request("/api/auth/me")
    }

    static func logout() async {
        _ = try? await APIClient.shared.requestVoid("/api/auth/logout", method: .POST)
    }

    static func switchRole(_ mode: String) async throws -> APIUser {
        struct Resp: Decodable { let user: APIUser }
        let r: Resp = try await APIClient.shared.request(
            "/api/auth/switch-role",
            method: .POST,
            body: SwitchRoleRequest(mode: mode)
        )
        return r.user
    }

    static func updateProfile(firstName: String? = nil, lastName: String? = nil,
                              phone: String? = nil, displayNamePreference: String? = nil) async throws -> APIUser {
        try await APIClient.shared.request(
            "/api/auth/profile",
            method: .PUT,
            body: UpdateProfileRequest(first_name: firstName,
                                       last_name: lastName,
                                       phone: phone,
                                       display_name_preference: displayNamePreference)
        )
    }
}
