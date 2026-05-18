import SwiftUI

enum AppTheme {
    static let background = LinearGradient(
        colors: [Color(.systemBackground), Color.orange.opacity(0.08), Color(.secondarySystemBackground)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let card = Color(.secondarySystemGroupedBackground)
}

struct HeroHeader: View {
    let eyebrow: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.orange)
                Text(eyebrow.uppercased())
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }

            Text(title)
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)

            Text(subtitle)
                .font(.body)
                .foregroundStyle(.secondary)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AudienceHero: View {
    let audience: Audience

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: audience.symbol)
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(.orange)
            Text(audience.title)
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
            Text(audience.subtitle)
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

struct SectionHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

struct FeatureCard: View {
    let feature: OxSteedFeature

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: feature.symbol)
                .font(.title2)
                .foregroundStyle(color(for: feature.tintName))
            Text(feature.title)
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
            Text(feature.summary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(5)
        }
        .frame(maxWidth: .infinity, minHeight: 184, alignment: .topLeading)
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

struct WideFeatureCard: View {
    @EnvironmentObject private var router: OxSteedRouter
    let feature: OxSteedFeature

    var body: some View {
        Button {
            router.open(feature.route)
        } label: {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: feature.symbol)
                    .font(.title2)
                    .foregroundStyle(color(for: feature.tintName))
                    .frame(width: 34)

                VStack(alignment: .leading, spacing: 6) {
                    Text(feature.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text(feature.summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct WorkflowCard: View {
    let workflow: OxSteedWorkflow
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label(workflow.eyebrow, systemImage: workflow.symbol)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.orange)
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.secondary)
                }
                Text(workflow.title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.primary)
                Text(workflow.body)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct TrustSignalCard: View {
    let signal: TrustSignal

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: signal.symbol)
                .font(.title2)
                .foregroundStyle(.orange)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 6) {
                Text(signal.title)
                    .font(.headline)
                Text(signal.body)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

struct PrimaryButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .tint(.orange)
    }
}

struct SecondaryButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
    }
}

struct NativeEmptyState: View {
    let title: String
    let message: String
    let systemImage: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.largeTitle)
                .foregroundStyle(.orange)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 150)
        .padding(20)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private func color(for name: String) -> Color {
    switch name {
    case "blue": return .blue
    case "green": return .green
    case "purple": return .purple
    default: return .orange
    }
}
