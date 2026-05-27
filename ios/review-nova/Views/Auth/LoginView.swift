import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var store: OneStore
    @State private var email = ""
    @State private var password = ""
    @State private var agreementName = ""
    @State private var acceptedTerms = false
    @State private var showRegister = false
    @FocusState private var focused: Field?

    enum Field: Hashable { case email, password, name }

    var body: some View {
        ZStack {
            backgroundGradient
            ScrollView {
                VStack(spacing: 0) {
                    logoHeader
                    formCard
                    bottomLinks
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 48)
            }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .sheet(isPresented: $showRegister) {
            RegisterView()
        }
    }

    // MARK: - Background

    private var backgroundGradient: some View {
        LinearGradient(
            colors: [
                Color(red: 0.06, green: 0.18, blue: 0.22),
                Color(red: 0.08, green: 0.24, blue: 0.28),
                Color(red: 0.13, green: 0.32, blue: 0.30)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }

    // MARK: - Logo

    private var logoHeader: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(OneTheme.accent.opacity(0.22))
                    .frame(width: 80, height: 80)
                Text("OX")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundStyle(OneTheme.accentSoft)
            }
            .padding(.top, 56)

            Text("OxSteed")
                .font(.system(.largeTitle, design: .rounded, weight: .heavy))
                .foregroundStyle(.white)

            Text("Sign in to your account")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.6))
        }
        .padding(.bottom, 36)
    }

    // MARK: - Form Card

    private var formCard: some View {
        VStack(spacing: 20) {
            // Email
            inputField(
                icon: "envelope.fill",
                placeholder: "Email address",
                text: $email,
                contentType: .emailAddress,
                keyboardType: .emailAddress,
                field: .email
            )

            // Password
            secureField(
                icon: "lock.fill",
                placeholder: "Password",
                text: $password,
                field: .password
            )

            // Legal name
            inputField(
                icon: "person.text.rectangle.fill",
                placeholder: "Full legal name (first & last)",
                text: $agreementName,
                contentType: .name,
                keyboardType: .default,
                field: .name
            )

            // Terms toggle
            termsRow

            // Error
            if let msg = store.authStatusMessage {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold))
                    Text(msg)
                        .font(.caption.weight(.medium))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(.red.opacity(0.9))
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(.red.opacity(0.3), lineWidth: 1))
            }

            // Sign in button
            signInButton
        }
        .padding(24)
        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(.white.opacity(0.12), lineWidth: 1))
    }

    // MARK: - Input helpers

    private func inputField(
        icon: String,
        placeholder: String,
        text: Binding<String>,
        contentType: UITextContentType,
        keyboardType: UIKeyboardType,
        field: Field
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(OneTheme.accentSoft.opacity(0.8))
                .frame(width: 20)
            TextField(placeholder, text: text)
                .textContentType(contentType)
                .keyboardType(keyboardType)
                .autocorrectionDisabled()
                .textInputAutocapitalization(field == .name ? .words : .never)
                .foregroundStyle(.white)
                .focused($focused, equals: field)
                .submitLabel(field == .name ? .done : .next)
                .onSubmit { advanceFocus(from: field) }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(.white.opacity(focused == field ? 0.12 : 0.06), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(focused == field ? OneTheme.accentSoft.opacity(0.6) : .white.opacity(0.1), lineWidth: 1)
        )
        .animation(.easeInOut(duration: 0.15), value: focused)
    }

    private func secureField(
        icon: String,
        placeholder: String,
        text: Binding<String>,
        field: Field
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(OneTheme.accentSoft.opacity(0.8))
                .frame(width: 20)
            SecureField(placeholder, text: text)
                .textContentType(.password)
                .foregroundStyle(.white)
                .focused($focused, equals: field)
                .submitLabel(.next)
                .onSubmit { advanceFocus(from: field) }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(.white.opacity(focused == field ? 0.12 : 0.06), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(focused == field ? OneTheme.accentSoft.opacity(0.6) : .white.opacity(0.1), lineWidth: 1)
        )
        .animation(.easeInOut(duration: 0.15), value: focused)
    }

    private var termsRow: some View {
        Button {
            withAnimation(.spring(response: 0.3)) { acceptedTerms.toggle() }
        } label: {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(acceptedTerms ? OneTheme.accent : .white.opacity(0.08))
                        .frame(width: 22, height: 22)
                    if acceptedTerms {
                        Image(systemName: "checkmark")
                            .font(.caption2.weight(.heavy))
                            .foregroundStyle(.white)
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(.white.opacity(0.2), lineWidth: 1))

                Text("I agree to the **Terms of Service** and **Privacy Policy**")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.75))
                    .multilineTextAlignment(.leading)
                Spacer()
            }
        }
        .buttonStyle(.plain)
    }

    private var signInButton: some View {
        Button {
            focused = nil
            Task { await store.login(email: email, password: password, agreementName: agreementName, acceptedTerms: acceptedTerms) }
        } label: {
            ZStack {
                if store.isAuthenticating {
                    ProgressView().tint(.white)
                } else {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.right.circle.fill")
                            .font(.headline)
                        Text("Sign In")
                            .font(.headline.weight(.bold))
                    }
                    .foregroundStyle(.white)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                canSubmit
                    ? LinearGradient(colors: [OneTheme.accent, OneTheme.accentSoft.opacity(0.9)], startPoint: .leading, endPoint: .trailing)
                    : LinearGradient(colors: [.white.opacity(0.12), .white.opacity(0.12)], startPoint: .leading, endPoint: .trailing),
                in: RoundedRectangle(cornerRadius: 16)
            )
            .animation(.easeInOut(duration: 0.2), value: canSubmit)
        }
        .disabled(!canSubmit || store.isAuthenticating)
    }

    // MARK: - Bottom links

    private var bottomLinks: some View {
        VStack(spacing: 16) {
            Button("Forgot password?") {}
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white.opacity(0.55))
                .padding(.top, 20)

            HStack(spacing: 6) {
                Text("Don't have an account?")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.5))
                Button("Create one") { showRegister = true }
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(OneTheme.accentSoft)
            }
        }
    }

    // MARK: - Helpers

    private var canSubmit: Bool {
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let p = password.trimmingCharacters(in: .whitespacesAndNewlines)
        let n = agreementName.trimmingCharacters(in: .whitespacesAndNewlines)
        let nameParts = n.split(separator: " ").filter { !$0.isEmpty }
        return !e.isEmpty && !p.isEmpty && acceptedTerms && nameParts.count >= 2
    }

    private func advanceFocus(from field: Field) {
        switch field {
        case .email:    focused = .password
        case .password: focused = .name
        case .name:     focused = nil
        }
    }
}

#Preview {
    LoginView().environmentObject(OneStore())
}
