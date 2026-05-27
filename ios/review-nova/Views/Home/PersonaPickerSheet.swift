import SwiftUI

struct PersonaPickerSheet: View {
    @EnvironmentObject private var store: OneStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(AppPersona.allCases) { persona in
                        Button {
                            store.activePersona = persona
                            dismiss()
                        } label: {
                            PersonaRow(persona: persona,
                                       isActive: persona == store.activePersona)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("Switch persona")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct PersonaRow: View {
    let persona: AppPersona
    let isActive: Bool

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(persona.tint.opacity(0.18))
                    .frame(width: 46, height: 46)
                Image(systemName: persona.icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(persona.tint)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(persona.displayName)
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                Text(persona.tagline)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: isActive ? "checkmark.circle.fill" : "chevron.right")
                .font(.headline)
                .foregroundStyle(isActive ? AnyShapeStyle(persona.tint) : AnyShapeStyle(HierarchicalShapeStyle.tertiary))
        }
        .padding(14)
        .background(
            Color(.secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(isActive ? persona.tint : .clear, lineWidth: 1.5)
        )
    }
}

#Preview {
    PersonaPickerSheet().environmentObject(OneStore())
}
