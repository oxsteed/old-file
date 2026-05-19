import Foundation

@MainActor
final class SessionStore: ObservableObject {
    @Published var isSignedIn: Bool
    @Published var currentUser: AuthUser?
    @Published var errorMessage: String?
    @Published var isWorking = false
    @Published var pendingMFAToken: String?

    init() {
        isSignedIn = UserDefaults.standard.string(forKey: "oxsteedAccessToken") != nil
    }

    func signIn(email: String, password: String, agreementName: String) async {
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let signature = agreementName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty, !password.isEmpty, !signature.isEmpty else {
            errorMessage = "Enter your email, password, and typed agreement signature."
            return
        }

        isWorking = true
        errorMessage = nil
        pendingMFAToken = nil
        do {
            let response = try await OxSteedAPIClient.shared.login(
                email: normalizedEmail,
                password: password,
                agreementName: signature
            )
            if response.requiresTwoFactor == true {
                pendingMFAToken = response.mfaToken
                errorMessage = "Enter your two-factor code to finish signing in."
            } else {
                try await persistSession(from: response)
            }
        } catch {
            errorMessage = readableMessage(from: error, fallback: "Sign in failed. Check your email and password.")
        }
        isWorking = false
    }

    func completeTwoFactor(code: String, isBackupCode: Bool) async {
        guard let pendingMFAToken else {
            errorMessage = "Start sign in again before entering a two-factor code."
            return
        }
        let trimmedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCode.isEmpty else {
            errorMessage = "Enter your two-factor code."
            return
        }

        isWorking = true
        errorMessage = nil
        do {
            let response = try await OxSteedAPIClient.shared.completeTwoFactorLogin(
                mfaToken: pendingMFAToken,
                code: trimmedCode,
                isBackupCode: isBackupCode
            )
            try await persistSession(from: response)
            self.pendingMFAToken = nil
        } catch {
            errorMessage = readableMessage(from: error, fallback: "Could not verify that two-factor code.")
        }
        isWorking = false
    }

    func register(_ payload: RegistrationSubmission) async {
        isWorking = true
        errorMessage = nil
        do {
            let response = try await OxSteedAPIClient.shared.registerAccount(payload)
            try await persistSession(from: response)
        } catch {
            errorMessage = readableMessage(from: error, fallback: "Could not create this account. Check required fields or use a different email.")
        }
        isWorking = false
    }

    func restoreSession() async {
        guard UserDefaults.standard.string(forKey: "oxsteedAccessToken") != nil else {
            isSignedIn = false
            currentUser = nil
            return
        }
        do {
            currentUser = try await OxSteedAPIClient.shared.me()
            isSignedIn = true
        } catch {
            signOut()
            errorMessage = "Your session expired. Please sign in again."
        }
    }

    func updateProfile(phone: String, zipCode: String, displayNamePreference: String) async {
        isWorking = true
        errorMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.updateAuthProfile(AuthProfileUpdateSubmission(
                phone: phone.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank,
                zip_code: zipCode.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank,
                display_name_preference: displayNamePreference
            ))
            currentUser = try await OxSteedAPIClient.shared.me()
        } catch {
            errorMessage = readableMessage(from: error, fallback: "Could not update your profile.")
        }
        isWorking = false
    }

    func resendVerificationEmail() async {
        isWorking = true
        errorMessage = nil
        do {
            let response = try await OxSteedAPIClient.shared.resendVerificationEmail()
            errorMessage = response.message ?? "Verification email sent."
        } catch {
            errorMessage = readableMessage(from: error, fallback: "Could not send verification email.")
        }
        isWorking = false
    }

    func switchRole(to role: String) async {
        isWorking = true
        errorMessage = nil
        do {
            let response = try await OxSteedAPIClient.shared.switchRole(to: role)
            try await persistSession(from: response)
        } catch {
            errorMessage = readableMessage(from: error, fallback: "Could not switch account role.")
        }
        isWorking = false
    }

    func signOut() {
        UserDefaults.standard.removeObject(forKey: "oxsteedAccessToken")
        UserDefaults.standard.removeObject(forKey: "oxsteedRefreshToken")
        isSignedIn = false
        currentUser = nil
        pendingMFAToken = nil
    }

    private func persistSession(from response: LoginResponse) async throws {
        guard let accessToken = response.accessToken else {
            throw OxSteedAPIError(statusCode: 0, message: response.message ?? "Sign in did not return an access token.", code: nil, fields: nil)
        }
        UserDefaults.standard.set(accessToken, forKey: "oxsteedAccessToken")
        if let refreshToken = response.refreshToken {
            UserDefaults.standard.set(refreshToken, forKey: "oxsteedRefreshToken")
        }
        if let user = response.user {
            currentUser = user
        } else {
            currentUser = try await OxSteedAPIClient.shared.me()
        }
        isSignedIn = true
    }

    private func readableMessage(from error: Error, fallback: String) -> String {
        if let apiError = error as? OxSteedAPIError {
            if let field = apiError.fields?.values.first {
                return field
            }
            return apiError.message
        }
        return fallback
    }
}

private extension String {
    var nilIfBlank: String? {
        isEmpty ? nil : self
    }
}
