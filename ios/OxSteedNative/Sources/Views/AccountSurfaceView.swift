import SwiftUI

struct AccountSurfaceView: View {
    @Environment(SessionStore.self) private var session
    @State private var apiBaseURL = "https://oxsteed.com/api"
    @State private var email = ""
    @State private var password = ""
    @State private var twoFactorCode = ""

    var body: some View {
        @Bindable var session = session

        Form {
            Section("API") {
                apiBaseURLField
                Button("Use API Base URL") {
                    session.configureBaseURL(apiBaseURL)
                }
            }

            Section("Session") {
                if let user = session.currentUser {
                    LabeledContent("Signed in", value: user.email)
                    LabeledContent("Mode", value: session.selectedMode)
                    Button("Sign Out", role: .destructive) {
                        session.signOut()
                    }
                } else {
                    emailField
                    SecureField("Password", text: $password)
                    twoFactorField
                    Button(session.isLoading ? "Signing In..." : "Sign In") {
                        Task {
                            await session.signIn(
                                email: email,
                                password: password,
                                twoFactorCode: twoFactorCode.isEmpty ? nil : twoFactorCode
                            )
                        }
                    }
                    .disabled(session.isLoading || email.isEmpty || password.isEmpty)
                }

                if let errorMessage = session.errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Account")
    }

    private var apiBaseURLField: some View {
        #if os(iOS)
        TextField("API base URL", text: $apiBaseURL)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
        #else
        TextField("API base URL", text: $apiBaseURL)
        #endif
    }

    private var emailField: some View {
        #if os(iOS)
        TextField("Email", text: $email)
            .textInputAutocapitalization(.never)
            .keyboardType(.emailAddress)
        #else
        TextField("Email", text: $email)
        #endif
    }

    private var twoFactorField: some View {
        #if os(iOS)
        TextField("2FA code, if required", text: $twoFactorCode)
            .keyboardType(.numberPad)
        #else
        TextField("2FA code, if required", text: $twoFactorCode)
        #endif
    }
}
