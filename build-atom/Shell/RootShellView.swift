import SwiftUI

enum AppTab: Hashable {
    case home, life, growth, learn
}

struct RootShellView: View {
    @State private var tab: AppTab = .home

    var body: some View {
        ZStack(alignment: .bottom) {
            Theme.background.ignoresSafeArea()

            Group {
                switch tab {
                case .home: HomeTabView()
                case .life: LifeTabView()
                case .growth: GrowthTabView()
                case .learn: LearnTabView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.bottom, 78)

            OxTabBar(selection: $tab)
        }
    }
}

private struct OxTabBar: View {
    @Binding var selection: AppTab

    var body: some View {
        HStack(spacing: 0) {
            tabButton(.home, label: L10n.tab(.home), icon: "square.grid.2x2.fill")
            tabButton(.life, label: L10n.tab(.life), icon: "heart.text.square.fill")
            tabButton(.growth, label: L10n.tab(.growth), icon: "arrow.up.right.circle.fill")
            tabButton(.learn, label: L10n.tab(.learn), icon: "graduationcap.fill")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(Theme.surface.opacity(0.95))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .strokeBorder(Theme.stroke, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.4), radius: 18, y: 8)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func tabButton(_ value: AppTab, label: LocalizedStringKey, icon: String) -> some View {
        let isSelected = selection == value
        return Button {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                selection = value
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                Text(label)
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(isSelected ? Theme.accent : Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(isSelected ? Theme.accentSoft : Color.clear)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    RootShellView().environmentObject(PersonaStore())
}
