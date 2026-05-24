import SwiftUI

struct CapabilityModuleCard: View {
    let module: CapabilityModule

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                ZStack {
                    Circle()
                        .fill(module.domain.tint.opacity(0.18))
                    Image(systemName: module.domain.tab.symbolName)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(module.domain.tint)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 6) {
                    Text(module.domain.title)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(module.domain.tint)
                    Text(module.title)
                        .font(.title3.bold())
                        .foregroundStyle(.primary)
                    Text(module.summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(.tertiary)
            }

            HStack {
                Label(module.status, systemImage: "mappin.and.ellipse")
                Spacer()
                Text("\(module.actions.count) actions")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .padding()
        .background(AppTheme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(module.domain.tint.opacity(0.16), lineWidth: 1)
        )
    }
}
