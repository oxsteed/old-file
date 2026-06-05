import Foundation

enum AuthService {
    // NOTE: Auth endpoints live on `https://oxsteed.com/api` (web domain),
    // not the main API host (`https://api.oxsteed.com`).

    struct LoginRequest: Encodable {
        let email: String
        let password: String
        let termsAgreed: Bool
        let agreementName: String
        let rememberMe: Bool?
    }

    struct TwoFactorRequest: Encodable {
        let mfaToken: String
        let code: String
    }

    struct RegisterRequest: Encodable {
        let email: String
        let password: String
        let first_name: String
        let last_name: String
        let phone: String?
        let language: String?
        let role: String
        let ref: String?
    }
    struct SwitchRoleRequest: Encodable { let mode: String }
    struct UpdateProfileRequest: Encodable {
        let first_name: String?
        let last_name: String?
        let phone: String?
        let display_name_preference: String?
        let preferred_language: String?
    }

    struct LoginResponse: Decodable {
        let success: Bool?
        let user: APIUser?
        let accessToken: String?
        let refreshToken: String?
        let requiresTwoFactor: Bool?
        let mfaToken: String?
        let error: String?
    }

    struct MeResponse: Decodable { let user: APIUser }

    static func login(email: String,
                      password: String,
                      agreementName: String,
                      rememberMe: Bool) async throws -> LoginResponse {
        try await AuthAPIClient.shared.request(
            "/api/auth/login",
            method: .POST,
            body: LoginRequest(email: email,
                               password: password,
                               termsAgreed: true,
                               agreementName: agreementName,
                               rememberMe: rememberMe ? true : nil),
            requiresAuth: false
        )
    }

    static func login2FA(mfaToken: String, code: String) async throws -> LoginResponse {
        try await AuthAPIClient.shared.request(
            "/api/auth/login/2fa",
            method: .POST,
            body: TwoFactorRequest(mfaToken: mfaToken, code: code),
            requiresAuth: false
        )
    }

    struct RegisterResponse: Decodable {
        let user: APIUser
        let accessToken: String
        let refreshToken: String
        let expiresIn: Int?
        let success: Bool?
        let error: String?
    }

    static func register(email: String,
                         password: String,
                         firstName: String,
                         lastName: String,
                         phone: String?,
                         language: String?,
                         role: String,
                         ref: String? = nil) async throws -> RegisterResponse {
        try await AuthAPIClient.shared.request(
            "/api/auth/register",
            method: .POST,
            body: RegisterRequest(email: email, password: password,
                                  first_name: firstName, last_name: lastName,
                                  phone: phone, language: language,
                                  role: role, ref: ref),
            requiresAuth: false
        )
    }

    static func me() async throws -> APIUser {
        let r: MeResponse = try await AuthAPIClient.shared.request("/api/auth/me")
        return r.user
    }

    static func logout() async {
        struct Req: Encodable { let refreshToken: String? }
        _ = try? await AuthAPIClient.shared.requestVoid(
            "/api/auth/logout",
            method: .POST,
            body: Req(refreshToken: KeychainManager.shared.getRefreshToken())
        )
    }

    static func refresh(refreshToken: String) async throws -> (accessToken: String, refreshToken: String) {
        struct Req: Encodable { let refreshToken: String }
        struct Resp: Decodable { let accessToken: String; let refreshToken: String }
        let r: Resp = try await AuthAPIClient.shared.request(
            "/api/auth/refresh",
            method: .POST,
            body: Req(refreshToken: refreshToken),
            requiresAuth: false
        )
        return (r.accessToken, r.refreshToken)
    }

    static func forgotPassword(email: String) async throws {
        struct Req: Encodable { let email: String }
        try await AuthAPIClient.shared.requestVoid(
            "/api/auth/forgot-password",
            method: .POST,
            body: Req(email: email),
            requiresAuth: false
        )
    }

    static func requestEmailVerificationOTP(email: String) async throws {
        struct Req: Encodable { let email: String; let type: String }
        try await AuthAPIClient.shared.requestVoid(
            "/api/auth/otp/request",
            method: .POST,
            body: Req(email: email, type: "email_verification")
        )
    }

    static func verifyEmailOTP(email: String, otp: String) async throws {
        struct Req: Encodable { let email: String; let otp: String; let type: String }
        try await AuthAPIClient.shared.requestVoid(
            "/api/auth/otp/verify",
            method: .POST,
            body: Req(email: email, otp: otp, type: "email_verification")
        )
    }

    static func resetPassword(token: String, newPassword: String) async throws {
        struct Req: Encodable { let token: String; let password: String }
        try await AuthAPIClient.shared.requestVoid(
            "/api/auth/reset-password",
            method: .POST,
            body: Req(token: token, password: newPassword),
            requiresAuth: false
        )
    }

    static func switchRole(_ mode: String) async throws -> (user: APIUser, accessToken: String?, refreshToken: String?) {
        struct Resp: Decodable {
            let user: APIUser
            let accessToken: String?
            let refreshToken: String?
        }
        let r: Resp = try await APIClient.shared.request(
            "/api/auth/switch-role",
            method: .POST,
            body: SwitchRoleRequest(mode: mode)
        )
        return (r.user, r.accessToken, r.refreshToken)
    }

    static func updateProfile(
        firstName: String? = nil,
        lastName: String? = nil,
        phone: String? = nil,
        displayNamePreference: String? = nil,
        preferredLanguage: String? = nil
    ) async throws -> APIUser {
        struct UpdateProfileResponse: Decodable { let user: APIUser }

        let response: UpdateProfileResponse = try await APIClient.shared.request(
            "/api/auth/profile",
            method: .PUT,
            body: UpdateProfileRequest(first_name: firstName,
                                       last_name: lastName,
                                       phone: phone,
                                       display_name_preference: displayNamePreference,
                                       preferred_language: preferredLanguage)
        )
        return response.user
    }

    /// Permanently deletes the account and all associated personal data.
    /// Requires the literal confirmation string "DELETE MY ACCOUNT".
    /// The server blocks deletion if active jobs or pending payments exist.
    struct DeleteAccountRequest: Encodable { let confirmation: String }
    struct DeleteAccountResponse: Decodable { let success: Bool?; let message: String? }

    static func deleteAccount(confirmation: String = "DELETE MY ACCOUNT") async throws -> DeleteAccountResponse {
        try await APIClient.shared.request(
            "/api/privacy/delete-account",
            method: .DELETE,
            body: DeleteAccountRequest(confirmation: confirmation)
        )
    }
}
