import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var router: OxSteedRouter
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HeroHeader(
                        eyebrow: "Account",
                        title: session.isSignedIn ? "You are signed in." : "Sign in to unlock native actions.",
                        subtitle: "A signed-in session lets the native app post jobs, load messages, show calendar items, and continue into protected OxSteed workflows."
                    )

                    if session.isSignedIn {
                        VStack(spacing: 12) {
                            PrimaryButton(title: "Open messages", systemImage: "message.fill") {
                                router.open(.messages)
                            }
                            SecondaryButton(title: "Sign out", systemImage: "rectangle.portrait.and.arrow.right") {
                                session.signOut()
                            }
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            TextField("Email", text: $email)
                                .keyboardType(.emailAddress)
                                .textContentType(.username)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .textFieldStyle(.roundedBorder)
                            SecureField("Password", text: $password)
                                .textContentType(.password)
                                .textFieldStyle(.roundedBorder)
                            TextField("Full name agreement signature", text: $name)
                                .textContentType(.name)
                                .textFieldStyle(.roundedBorder)

                            if let error = session.errorMessage {
                                Text(error)
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(.red)
                            }

                            PrimaryButton(title: session.isWorking ? "Signing in..." : "Sign in", systemImage: "person.crop.circle") {
                                Task {
                                    await session.signIn(email: email, password: password, agreementName: name)
                                }
                            }
                            SecondaryButton(title: "Create account", systemImage: "person.badge.plus") {
                                router.open(.registerCustomer)
                            }
                        }
                        .padding(16)
                        .background(AppTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    }
                }
                .padding(20)
            }
            .background(AppTheme.background)
            .navigationTitle("Account")
        }
    }
}
