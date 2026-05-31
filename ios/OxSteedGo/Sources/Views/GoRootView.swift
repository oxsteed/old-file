import SwiftUI

struct GoRootView: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        @Bindable var store = store

        ZStack(alignment: .bottom) {
            NavigationStack {
                Group {
                    switch store.selectedTab {
                    case .today:
                        TodayView()
                    case .hire:
                        HireView()
                    case .shop:
                        ShopView()
                    case .inbox:
                        InboxView()
                    case .profile:
                        ProfileView()
                    }
                }
            }

            GoTabBar(selection: $store.selectedTab, language: store.appLanguage)
        }
        .background(GoTheme.background.ignoresSafeArea())
        .environment(\.layoutDirection,
            store.appLanguage == .arabic ? .rightToLeft : .leftToRight
        )
        .task {
            await store.restoreSession()
        }
    }
}

private struct GoTabBar: View {
    @Binding var selection: GoTab
    let language: GoLanguage

    var body: some View {
        HStack(spacing: 0) {
            ForEach(GoTab.allCases) { tab in
                Button {
                    withAnimation(.snappy(duration: 0.22)) {
                        selection = tab
                    }
                } label: {
                    VStack(spacing: 5) {
                        Image(systemName: tab.symbolName)
                            .font(.system(size: 18, weight: .semibold))
                            .symbolVariant(selection == tab ? .fill : .none)
                        Text(tab.localizedTitle(language))
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .foregroundStyle(selection == tab ? GoTheme.amber : Color.white.opacity(0.62))
                    .background {
                        if selection == tab {
                            RoundedRectangle(cornerRadius: 24, style: .continuous)
                                .fill(
                                    LinearGradient(
                                        colors: [GoTheme.amber.opacity(0.22), GoTheme.amber.opacity(0.08)],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                .matchedGeometryEffect(id: "selected-tab", in: namespace)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(6)
        .background(GoTheme.deepNavy.opacity(0.94), in: Capsule())
        .overlay(Capsule().stroke(GoTheme.border, lineWidth: 1))
        .padding(.horizontal, 18)
        .padding(.bottom, 12)
        .shadow(color: .black.opacity(0.42), radius: 22, x: 0, y: 12)
    }

    @Namespace private var namespace
}

#Preview {
    GoRootView()
        .environment(GoStore())
}
