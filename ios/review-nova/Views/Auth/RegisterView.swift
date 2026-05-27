import SwiftUI

struct RegisterView: View {
    @EnvironmentObject private var store: OneStore
    @Environment(\.dismiss) private var dismiss
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var selectedPersona: AppPersona = .customer
    @FocusState private var focused: Field?

    enum Field: Hashable { case firstName, lastName, email, password }

    var body: some View {
        ZStack {
            backgroundGradient
            ScrollView {
                VStack(spacing: 24) {
                    header
                    personaGrid
                    formFields
                    if let msg = store.authStatusMessage {
                        errorBanner(msg)
                    }
                    createButton
                    signInLink
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 48)
            }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
    }

    // MARK: - Background

    private var backgroundGradient: some View {
        LinearGradient(
            colors: [
                Color(red: 0.06, green: 0.18, blue: 0.22),
                Color(red: 0.10, green: 0.28, blue: 0.32),
                Color(red: 0.15, green: 0.35, blue: 0.30)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 8) {
            Text("Create Account")
                .font(.system(.largeTitle, design: .rounded, weight: .heavy))
                .foregroundStyle(.white)
                .padding(.top, 56)
            Text("Choose how you'll use OxSteed")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.6))
        }
    }

    // MARK: - Persona grid

    private var personaGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("I AM A…")
                .font(.caption.weight(.bold))
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.5))

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(AppPersona.allCases) { persona in
                    personaTile(persona)
                }
            }
        }
    }

    private func personaTile(_ persona: AppPersona) -> some View {
        let selected = selectedPersona == persona
        return Button {
            withAnimation(.spring(response: 0.3)) { selectedPersona = persona }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: persona.icon)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(selected ? .white : persona.tint)
                    .frame(width: 20)
                Text(persona.displayName)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(selected ? .white : .white.opacity(0.75))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer()
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                selected
                    ? persona.tint.opacity(0.85)
                    : .white.opacity(0.07),
                in: RoundedRectangle(cornerRadius: 14)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(selected ? persona.tint : .white.opacity(0.1), lineWidth: selected ? 0 : 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Form fields

    private var formFields: some View {
        VStack(spacing: 16) {
            HStack(spacing: 12) {
                nameField("First name", text: $firstName, field: .firstName, contentType: .givenName)
                nameField("Last name",  text: $lastName,  field: .lastName,  contentType: .familyName)
            }
            inputField("envelope.fill", "Email address",
                       text: $email, field: .email,
                       contentType: .emailAddress, keyboard: .emailAddress)
            inputField("lock.fill", "Password",
                       text: $password, field: .password,
                       contentType: .newPassword, keyboard: .default, secure: true)
        }
        .padding(20)
        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(.white.opacity(0.1), lineWidth: 1))
    }

    private func nameField(_ placeholder: String, text: Binding<String>, field: Field, contentType: UITextContentType) -> some View {
        TextField(placeholder, text: text)
            .textContentType(contentType)
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .foregroundStyle(.white)
            .focused($focused, equals: field)
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(.white.opacity(focused == field ? 0.12 : 0.06), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(focused == field ? OneTheme.accentSoft.opacity(0.5) : .white.opacity(0.1), lineWidth: 1))
            .animation(.easeInOut(duration: 0.15), value: focused)
    }

    private func inputField(
        _ icon: String, _ placeholder: String,
        text: Binding<String>, field: Field,
        contentType: UITextContentType, keyboard: UIKeyboardType,
        secure: Bool = false
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(OneTheme.accentSoft.opacity(0.8))
                .frame(width: 20)
            Group {
                if secure {
                    SecureField(placeholder, text: text)
                        .textContentType(contentType)
                } else {
                    TextField(placeholder, text: text)
                        .textContentType(contentType)
                        .keyboardType(keyboard)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                }
            }
            .foregroundStyle(.white)
            .focused($focused, equals: field)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(.white.opacity(focused == field ? 0.12 : 0.06), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(focused == field ? OneTheme.accentSoft.opacity(0.5) : .white.opacity(0.1), lineWidth: 1))
        .animation(.easeInOut(duration: 0.15), value: focused)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption.weight(.semibold))
            Text(message)
                .font(.caption.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.red.opacity(0.9))
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.red.opacity(0.3), lineWidth: 1))
    }

    // MARK: - Create button

    private var createButton: some View {
        Button {
            focused = nil
            Task { await store.register(email: email, password: password, firstName: firstName, lastName: lastName, persona: selectedPersona) }
        } label: {
            ZStack {
                if store.isAuthenticating {
                    ProgressView().tint(.white)
                } else {
                    HStack(spacing: 8) {
                        Image(systemName: "person.crop.circle.badge.plus")
                            .font(.headline)
                        Text("Create Account")
                            .font(.headline.weight(.bold))
                    }
                    .foregroundStyle(.white)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                canSubmit
                    ? LinearGradient(colors: [OneTheme.ember, OneTheme.ember.opacity(0.8)], startPoint: .leading, endPoint: .trailing)
                    : LinearGradient(colors: [.white.opacity(0.12), .white.opacity(0.12)], startPoint: .leading, endPoint: .trailing),
                in: RoundedRectangle(cornerRadius: 16)
            )
            .animation(.easeInOut(duration: 0.2), value: canSubmit)
        }
        .disabled(!canSubmit || store.isAuthenticating)
    }

    // MARK: - Sign in link

    private var signInLink: some View {
        HStack(spacing: 6) {
            Text("Already have an account?")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.5))
            Button("Sign in") { dismiss() }
                .font(.subheadline.weight(.bold))
                .foregroundStyle(OneTheme.accentSoft)
        }
    }

    // MARK: - Helpers

    private var canSubmit: Bool {
        !firstName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !lastName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

#Preview {
    RegisterView().environmentObject(OneStore())
}
