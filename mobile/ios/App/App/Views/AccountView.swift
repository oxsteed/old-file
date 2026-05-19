import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var router: OxSteedRouter
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var termsAgreed = false
    @State private var twoFactorCode = ""
    @State private var useBackupCode = false
    @State private var profilePhone = ""
    @State private var profileZip = ""
    @State private var displayNamePreference = "first_name"

    private var canSubmitLogin: Bool {
        !session.isWorking && termsAgreed && !email.trimmed.isEmpty && !password.isEmpty && !name.trimmed.isEmpty
    }

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
                            if let user = session.currentUser {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(user.displayName)
                                        .font(.headline)
                                    Text([user.email, user.role].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    if let onboarding = user.onboardingStep?.nilIfBlank {
                                        Text("Status: \(onboarding)")
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(.orange)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                                .background(AppTheme.card)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Profile basics")
                                        .font(.headline)
                                    TextField("Phone", text: $profilePhone)
                                        .keyboardType(.phonePad)
                                        .textContentType(.telephoneNumber)
                                        .textFieldStyle(.roundedBorder)
                                    TextField("ZIP / postal code", text: $profileZip)
                                        .textContentType(.postalCode)
                                        .textFieldStyle(.roundedBorder)
                                    Picker("Display name", selection: $displayNamePreference) {
                                        Text("First name").tag("first_name")
                                        Text("Full name").tag("full_name")
                                        Text("Business name").tag("business_name")
                                    }
                                    Button(session.isWorking ? "Saving..." : "Save profile") {
                                        Task {
                                            await session.updateProfile(phone: profilePhone, zipCode: profileZip, displayNamePreference: displayNamePreference)
                                        }
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .controlSize(.large)
                                    .tint(.orange)
                                    .disabled(session.isWorking)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                                .background(AppTheme.card)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Account actions")
                                        .font(.headline)
                                    if user.emailVerified != true {
                                        Button("Resend verification email") {
                                            Task { await session.resendVerificationEmail() }
                                        }
                                        .buttonStyle(.bordered)
                                    }
                                    if user.role == "customer" {
                                        Button("Switch to helper mode") {
                                            Task { await session.switchRole(to: "helper") }
                                        }
                                        .buttonStyle(.bordered)
                                    } else if user.role == "helper" || user.role == "helper_pro" || user.role == "broker" {
                                        Button("Switch to customer mode") {
                                            Task { await session.switchRole(to: "customer") }
                                        }
                                        .buttonStyle(.bordered)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                                .background(AppTheme.card)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                            if let error = session.errorMessage {
                                Text(error)
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(error.localizedCaseInsensitiveContains("sent") ? .green : .red)
                            }
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
                            VStack(alignment: .leading, spacing: 10) {
                                Toggle("I agree to OxSteed's Terms of Service and Privacy Policy.", isOn: $termsAgreed)
                                    .font(.footnote)
                                TextField("Full name agreement signature", text: $name)
                                    .textContentType(.name)
                                    .textFieldStyle(.roundedBorder)
                                Text("The website requires this same typed signature before sign-in. The native app sends it directly to OxSteed with your login request.")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(12)
                            .background(Color(.tertiarySystemGroupedBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                            if let error = session.errorMessage {
                                Text(error)
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(session.pendingMFAToken == nil ? .red : .orange)
                            }

                            if session.pendingMFAToken != nil {
                                VStack(alignment: .leading, spacing: 10) {
                                    TextField("Two-factor code", text: $twoFactorCode)
                                        .keyboardType(.numberPad)
                                        .textContentType(.oneTimeCode)
                                        .textFieldStyle(.roundedBorder)
                                    Toggle("Use backup code", isOn: $useBackupCode)
                                        .font(.footnote)
                                    Button(session.isWorking ? "Verifying..." : "Verify and sign in") {
                                        Task {
                                            await session.completeTwoFactor(code: twoFactorCode, isBackupCode: useBackupCode)
                                        }
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .controlSize(.large)
                                    .tint(.orange)
                                    .disabled(session.isWorking || twoFactorCode.trimmed.isEmpty)
                                }
                                .padding(12)
                                .background(Color(.tertiarySystemGroupedBackground))
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }

                            Button {
                                Task {
                                    await session.signIn(email: email, password: password, agreementName: name)
                                }
                            } label: {
                                Label(session.isWorking ? "Signing in..." : "Sign in", systemImage: "person.crop.circle")
                                    .frame(maxWidth: .infinity, minHeight: 52)
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                            .tint(.orange)
                            .disabled(!canSubmitLogin)

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
            .task {
                if session.isSignedIn && session.currentUser == nil {
                    await session.restoreSession()
                }
                syncProfileFields()
            }
            .onChange(of: session.currentUser?.id.value) {
                syncProfileFields()
            }
        }
    }

    private func syncProfileFields() {
        guard let user = session.currentUser else { return }
        profilePhone = user.phone ?? ""
        profileZip = user.zipCode ?? ""
        displayNamePreference = user.displayNamePreference ?? "first_name"
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
