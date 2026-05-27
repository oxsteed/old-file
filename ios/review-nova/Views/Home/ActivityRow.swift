import SwiftUI

struct ActivityRow: View {
    let event: ActivityEvent

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(event.tint.opacity(0.16))
                    .frame(width: 36, height: 36)
                Image(systemName: event.icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(event.tint)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.subheadline.weight(.semibold))
                Text(event.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Text(event.time)
                .font(.caption.weight(.medium))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }
}

struct EmptyStateCard: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(OneTheme.accent)
                .padding(12)
                .background(OneTheme.accent.opacity(0.14), in: Circle())
            Text(title)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .background(Color(.secondarySystemGroupedBackground),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
