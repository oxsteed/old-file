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
                            NavigationLink {
                                AccountRegistrationNativeView()
                            } label: {
                                Label("Create account", systemImage: "person.badge.plus")
                                    .frame(maxWidth: .infinity, minHeight: 50)
                            }
                            .buttonStyle(.bordered)
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

struct AccountRegistrationNativeView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var role = "customer"
    @State private var acceptedTerms = false

    var body: some View {
        Form {
            Section("Account") {
                TextField("First name", text: $firstName)
                    .textContentType(.givenName)
                TextField("Last name", text: $lastName)
                    .textContentType(.familyName)
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Phone (optional)", text: $phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                SecureField("Password", text: $password)
                    .textContentType(.newPassword)
                Picker("Role", selection: $role) {
                    Text("Customer").tag("customer")
                    Text("Helper").tag("helper")
                }
            }

            Section {
                Toggle("I agree to the OxSteed terms and privacy policy.", isOn: $acceptedTerms)
                if let error = session.errorMessage {
                    Text(error)
                        .foregroundStyle(.red)
                }
                Button(session.isWorking ? "Creating..." : "Create native account") {
                    Task { await create() }
                }
                .disabled(session.isWorking || !acceptedTerms || firstName.trimmed.isEmpty || lastName.trimmed.isEmpty || email.trimmed.isEmpty || password.count < 8)
            } footer: {
                Text("The app creates a real OxSteed account and signs you in for native jobs, bookings, messages, and calendar actions.")
            }
        }
        .navigationTitle("Create Account")
    }

    private func create() async {
        await session.register(RegistrationSubmission(
            email: email.trimmed,
            password: password,
            first_name: firstName.trimmed,
            last_name: lastName.trimmed,
            phone: phone.trimmed.nilIfBlank,
            role: role,
            language: "en"
        ))
    }
}

private extension String {
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var nilIfBlank: String? {
        let value = trimmed
        return value.isEmpty ? nil : value
    }
}
