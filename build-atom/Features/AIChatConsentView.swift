import SwiftUI

// MARK: - AI Chat Consent

/// Shown before the user's first interaction with AI-powered chat (support chat,
/// profile chat, etc.). Required by Apple App Store guideline 5.1.2(i) (November 2025):
/// apps must clearly disclose third-party AI usage and obtain explicit permission
/// before sending personal data to an external AI provider.
///
/// Consent is persisted in UserDefaults under "ox.ai.chat_consent_granted".
/// Once granted, this sheet is never shown again unless the user revokes consent
/// from Privacy settings.
struct AIChatConsentView: View {
    var onAccept: () -> Void
    var onDecline: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(Theme.accent.opacity(0.15))
                        .frame(width: 72, height: 72)
                    Image(systemName: "sparkles")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                }
                .padding(.top, 32)

                Text("AI-Powered Chat")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)

                Text("Before you continue, here's how this works.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            // Data disclosure
            VStack(alignment: .leading, spacing: 14) {
                disclosureRow(
                    icon: "person.fill",
                    title: "What's sent",
                    detail: "Your message and basic account context (your role, the page you're on). No payment details or passwords are ever sent."
                )
                disclosureRow(
                    icon: "building.2.fill",
                    title: "Who processes it",
                    detail: "Messages are processed by OpenAI (GPT-4o) via OpenRouter. Neither company stores your messages beyond their standard retention policy."
                )
                disclosureRow(
                    icon: "hand.raised.fill",
                    title: "Your control",
                    detail: "You can turn off AI chat at any time from Settings → Privacy. Regular (non-AI) messaging between users is unaffected."
                )
            }
            .padding(24)
            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 18))
            .padding(.horizontal, 20)
            .padding(.top, 24)

            Spacer()

            // Actions
            VStack(spacing: 10) {
                Button {
                    onAccept()
                } label: {
                    Text("I understand, continue")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }

                Button {
                    onDecline()
                } label: {
                    Text("No thanks")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .background(Theme.background.ignoresSafeArea())
    }

    private func disclosureRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 32, height: 32)
                .background(Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Consent manager

/// Single source of truth for AI chat consent state.
/// Use `AIChatConsent.isGranted` to gate any AI chat call.
/// Use `AIChatConsent.grant()` / `AIChatConsent.revoke()` to change it.
enum AIChatConsent {
    private static let key = "ox.ai.chat_consent_granted"

    static var isGranted: Bool {
        UserDefaults.standard.bool(forKey: key)
    }

    static func grant() {
        UserDefaults.standard.set(true, forKey: key)
    }

    static func revoke() {
        UserDefaults.standard.set(false, forKey: key)
    }
}

// MARK: - Consent-gated view modifier

/// Wraps any view that triggers AI chat. Shows the consent sheet on first use;
/// calls `action` immediately on subsequent uses.
///
/// Usage:
///   Button("Ask AI") { triggerAIChat() }
///     .aiChatConsentGated(isPresented: $showConsent, onGranted: triggerAIChat)
extension View {
    func aiChatConsentGated(
        isPresented: Binding<Bool>,
        onGranted: @escaping () -> Void
    ) -> some View {
        self.sheet(isPresented: isPresented) {
            AIChatConsentView(
                onAccept: {
                    AIChatConsent.grant()
                    isPresented.wrappedValue = false
                    onGranted()
                },
                onDecline: {
                    isPresented.wrappedValue = false
                }
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationBackground(Theme.background)
        }
    }
}

#Preview {
    AIChatConsentView(onAccept: {}, onDecline: {})
        .preferredColorScheme(.dark)
}
