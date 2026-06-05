import SwiftUI

// MARK: - Shared Feature UI

struct LoadErrorCard: View {
    let title: String
    let message: String
    let retryTitle: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Theme.danger.opacity(0.12))
                    .frame(width: 64, height: 64)
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(Theme.danger)
            }

            VStack(spacing: 5) {
                Text(title)
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                Text(message)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
            }

            Button(action: retry) {
                Label(retryTitle, systemImage: "arrow.clockwise")
                    .font(.system(size: 14, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .foregroundStyle(.white)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
        }
        .padding(22)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}
