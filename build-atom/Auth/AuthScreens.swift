import SwiftUI

// MARK: - RootGate

/// Top-level branch: shows login when no session, otherwise the tabs.
struct RootGate: View {
    @EnvironmentObject var auth: AuthStore
    @State private var bootstrapped = false

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if !bootstrapped {
                ProgressView().tint(Theme.accent)
            } else if auth.user == nil {
                AuthLandingView()
            } else {
                RootShellView()
            }
        }
        .task {
            if !bootstrapped {
                await auth.bootstrap()
                bootstrapped = true
            }
        }
    }
}

// MARK: - Landing

struct AuthLandingView: View {
    @State private var mode: Mode = .login
    enum Mode { case login, register }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 12) {
                    ZStack {
                        Circle().fill(
                            LinearGradient(colors: [Theme.accent, Theme.accentDeep],
                                           startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                        Image(systemName: "scope")
                            .font(.system(size: 32, weight: .black))
                            .foregroundStyle(.white)
                    }
                    .frame(width: 72, height: 72)

                    Text("OxSteed")
                        .font(.system(size: 32, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text("Your personal operating system")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.top, 60)

                Picker("", selection: $mode) {
                    Text("Sign In").tag(Mode.login)
                    Text("Create Account").tag(Mode.register)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)

                Group {
                    if mode == .login { LoginForm() } else { RegisterForm() }
                }
                .padding(.horizontal, 20)

                Spacer(minLength: 40)
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }
}

// MARK: - Login

struct LoginForm: View {
    @EnvironmentObject var auth: AuthStore
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 14) {
            OxTextField(title: "Email", text: $email, keyboard: .emailAddress)
            OxTextField(title: "Password", text: $password, secure: true)

            if let err = auth.lastError {
                Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task { await auth.login(email: email, password: password) }
            } label: {
                HStack {
                    if auth.isLoading { ProgressView().tint(.white) }
                    Text("Sign In")
                        .font(.system(size: 15, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.white)
            }
            .disabled(auth.isLoading || email.isEmpty || password.isEmpty)
        }
        .cardStyle()
    }
}

// MARK: - Register

struct RegisterForm: View {
    @EnvironmentObject var auth: AuthStore
    @State private var first = ""
    @State private var last = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                OxTextField(title: "First name", text: $first)
                OxTextField(title: "Last name", text: $last)
            }
            OxTextField(title: "Email", text: $email, keyboard: .emailAddress)
            OxTextField(title: "Phone (optional)", text: $phone, keyboard: .phonePad)
            OxTextField(title: "Password (8+ chars)", text: $password, secure: true)

            if let err = auth.lastError {
                Text(err).font(.system(size: 12)).foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task {
                    await auth.register(email: email, password: password,
                                        firstName: first, lastName: last,
                                        phone: phone.isEmpty ? nil : phone)
                }
            } label: {
                HStack {
                    if auth.isLoading { ProgressView().tint(.white) }
                    Text("Create Account")
                        .font(.system(size: 15, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.white)
            }
            .disabled(auth.isLoading || email.isEmpty || password.count < 8 || first.isEmpty || last.isEmpty)
        }
        .cardStyle()
    }
}

// MARK: - Reusable text field

struct OxTextField: View {
    let title: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default
    var secure: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(Theme.textTertiary)
                .textCase(.uppercase)
            Group {
                if secure {
                    SecureField("", text: $text)
                } else {
                    TextField("", text: $text)
                        .keyboardType(keyboard)
                        .textInputAutocapitalization(keyboard == .emailAddress ? .never : .sentences)
                        .autocorrectionDisabled(keyboard == .emailAddress)
                }
            }
            .font(.system(size: 15))
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 12).padding(.vertical, 11)
            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
        }
    }
}
