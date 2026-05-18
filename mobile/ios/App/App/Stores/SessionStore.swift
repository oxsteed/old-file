import Foundation

@MainActor
final class SessionStore: ObservableObject {
    @Published var isSignedIn: Bool
    @Published var errorMessage: String?
    @Published var isWorking = false

    init() {
        isSignedIn = UserDefaults.standard.string(forKey: "oxsteedAccessToken") != nil
    }

    func signIn(email: String, password: String, agreementName: String) async {
        isWorking = true
        errorMessage = nil
        do {
            let response = try await OxSteedAPIClient.shared.login(
                email: email,
                password: password,
                agreementName: agreementName
            )
            if response.requiresTwoFactor == true {
                errorMessage = "This account uses two-factor authentication. Open web sign in to finish securely."
            } else if let accessToken = response.accessToken {
                UserDefaults.standard.set(accessToken, forKey: "oxsteedAccessToken")
                if let refreshToken = response.refreshToken {
                    UserDefaults.standard.set(refreshToken, forKey: "oxsteedRefreshToken")
                }
                isSignedIn = true
            } else {
                errorMessage = response.message ?? "Sign in failed."
            }
        } catch {
            errorMessage = "Sign in failed. Check your email and password."
        }
        isWorking = false
    }

    func signOut() {
        UserDefaults.standard.removeObject(forKey: "oxsteedAccessToken")
        UserDefaults.standard.removeObject(forKey: "oxsteedRefreshToken")
        isSignedIn = false
    }
}
