import SwiftUI

enum AppTab: Hashable {
    case home, life, growth, learn
}

// MARK: - Deep-link destination

/// Resolved destination from a push notification tap or universal link.
enum AppDeepLink: Hashable {
    case conversation(id: String)
    case job(id: String)
    case bid(id: String)
    case notification                 // open notification centre
    case home                         // fallback
}

// MARK: - RootShellView

struct RootShellView: View {
    @State private var tab: AppTab = .home
    /// Pending deep-link set by push-tap handler; consumed by child views.
    @State private var pendingDeepLink: AppDeepLink?

    var body: some View {
        ZStack(alignment: .bottom) {
            Theme.background.ignoresSafeArea()

            Group {
                switch tab {
                case .home: HomeTabView(pendingDeepLink: $pendingDeepLink)
                case .life: LifeTabView()
                case .growth: GrowthTabView()
                case .learn: LearnTabView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.bottom, 78)

            OxTabBar(selection: $tab)
        }
        // Route push notification taps to the appropriate screen.
        .onReceive(NotificationCenter.default.publisher(for: .oxPushTapped)) { note in
            guard let info = note.userInfo else { return }
            handlePushTap(info)
        }
        // Allow any child view (e.g. Growth ladder steps) to switch tabs.
        .onReceive(NotificationCenter.default.publisher(for: .oxSwitchTab)) { note in
            guard let name = note.userInfo?["tab"] as? String else { return }
            withAnimation(.easeInOut(duration: 0.25)) {
                switch name {
                case "home":   tab = .home
                case "life":   tab = .life
                case "growth": tab = .growth
                case "learn":  tab = .learn
                default: break
                }
            }
        }
        // Handle oxsteed:// deep links (widgets, Spotlight, Handoff)
        .onOpenURL { url in
            handleDeepLink(url)
        }
    }

    // MARK: - Deep-link routing

    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "oxsteed" else { return }
        let host = url.host ?? ""
        let path = url.pathComponents.filter { $0 != "/" }

        switch host {
        case "widget":
            // oxsteed://widget/home, oxsteed://widget/post-job
            let action = path.first ?? "home"
            switch action {
            case "post-job":
                tab = .home
                NotificationCenter.default.post(name: .oxIntentTriggerPostJob, object: nil)
            case "life":
                tab = .life
            default:
                tab = .home
            }

        case "job":
            // oxsteed://job/<id>
            if let id = path.first, !id.isEmpty {
                pendingDeepLink = .job(id: id)
                tab = .home
            }

        case "conversation":
            // oxsteed://conversation/<id>
            if let id = path.first, !id.isEmpty {
                pendingDeepLink = .conversation(id: id)
                tab = .home
            }

        case "inbox":
            tab = .home
            NotificationCenter.default.post(name: .oxIntentTriggerInbox, object: nil)

        default:
            tab = .home
        }
    }

    // MARK: - Push routing

    private func handlePushTap(_ info: [AnyHashable: Any]) {
        let type   = info["type"]   as? String ?? ""
        let itemId = info["id"]     as? String ?? info["jobId"] as? String ?? ""

        switch type {
        case "message:new", "conversation":
            if !itemId.isEmpty {
                pendingDeepLink = .conversation(id: itemId)
            }
            tab = .home

        case "bid:received", "bid:accepted", "bid:rejected":
            if !itemId.isEmpty {
                pendingDeepLink = .bid(id: itemId)
            }
            tab = .home

        case "job:created", "job:updated", "job:completed", "job:cancelled":
            if !itemId.isEmpty {
                pendingDeepLink = .job(id: itemId)
            }
            tab = .home

        case "appointment:created", "appointment:updated", "appointment:cancelled":
            tab = .home  // Calendar lives on home

        case "notification:new":
            pendingDeepLink = .notification
            tab = .home

        default:
            tab = .home
        }
    }
}

extension Notification.Name {
    static let oxOpenConversation = Notification.Name("ox.open.conversation")
    static let oxOpenJob = Notification.Name("ox.open.job")
    static let oxOpenBid = Notification.Name("ox.open.bid")
}

private struct OxTabBar: View {
    @Binding var selection: AppTab
    @Environment(\.colorScheme) private var colorScheme

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
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.40 : 0.12), radius: 18, y: 8)
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
