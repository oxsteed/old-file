import Foundation
import Observation

@Observable
final class SessionStore {
    var apiClient = OxSteedAPIClient()
    var currentUser: AuthenticatedUser?
    var isLoading = false
    var errorMessage: String?
    var selectedMode = "customer"

    var isAuthenticated: Bool {
        currentUser != nil && apiClient.authToken != nil
    }

    func configureBaseURL(_ urlString: String) {
        guard let url = URL(string: urlString) else {
            errorMessage = "That API base URL is not valid."
            return
        }
        apiClient.baseURL = url
    }

    @MainActor
    func signIn(email: String, password: String, twoFactorCode: String? = nil) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let request = LoginRequest(email: email, password: password, twoFactorCode: twoFactorCode)
            let response: AuthResponse = try await apiClient.post("/auth/login", body: request)

            if response.requiresTwoFactor == true {
                errorMessage = "Two-factor verification is required before this session can continue."
                return
            }

            apiClient.authToken = response.token
            apiClient.refreshToken = response.refreshToken
            currentUser = response.user
            selectedMode = response.user?.defaultMode ?? "customer"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() {
        apiClient.authToken = nil
        apiClient.refreshToken = nil
        currentUser = nil
        selectedMode = "customer"
    }
}
