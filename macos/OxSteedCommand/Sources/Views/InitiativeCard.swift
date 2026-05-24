import SwiftUI

struct InitiativeCard: View {
    let initiative: CommandInitiative

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(initiative.title)
                        .font(.title3.weight(.semibold))
                    Text(initiative.summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                StatusBadge(status: initiative.status)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Evidence")
                    .font(.headline)
                ForEach(initiative.evidence, id: \.self) { item in
                    BulletRow(text: item)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Next Moves")
                    .font(.headline)
                ForEach(initiative.nextMoves) { task in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(task.title)
                            .font(.subheadline.weight(.semibold))
                        Text(task.detail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Verification")
                    .font(.headline)
                ForEach(initiative.verification, id: \.self) { command in
                    Text(command)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
        .padding(20)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

private struct StatusBadge: View {
    let status: InitiativeStatus

    var body: some View {
        Text(status.label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(backgroundColor, in: Capsule())
            .foregroundStyle(foregroundColor)
    }

    private var backgroundColor: Color {
        switch status {
        case .complete:
            return Color.green.opacity(0.18)
        case .active:
            return Color.orange.opacity(0.20)
        case .watch:
            return Color.blue.opacity(0.18)
        }
    }

    private var foregroundColor: Color {
        switch status {
        case .complete:
            return .green
        case .active:
            return .orange
        case .watch:
            return .blue
        }
    }
}

private struct BulletRow: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(Color.accentColor)
                .frame(width: 6, height: 6)
                .padding(.top, 7)

            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}
