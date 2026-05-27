import SwiftUI

struct StatCard: View {
    let stat: DashboardStat

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(stat.tint.opacity(0.16))
                    .frame(width: 32, height: 32)
                Image(systemName: stat.icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(stat.tint)
            }
            Text(stat.value)
                .font(.system(.title3, design: .rounded, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(stat.label)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if let delta = stat.delta {
                Text(delta)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(stat.tint)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
