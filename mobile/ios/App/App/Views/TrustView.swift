import SwiftUI

struct TrustView: View {
    @EnvironmentObject private var router: OxSteedRouter

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HeroHeader(
                        eyebrow: "Trust and follow-through",
                        title: "OxSteed keeps the work record close to the work.",
                        subtitle: "Profiles, booking context, messages, invoices, notifications, and support records help local service relationships stay accountable."
                    )

                    VStack(spacing: 12) {
                        ForEach(OxSteedContent.trustSignals) { signal in
                            TrustSignalCard(signal: signal)
                        }
                    }

                    SectionHeader(title: "Mobile routes", subtitle: "These shortcuts open the live OxSteed systems for work that needs an account.")

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                        QuickLink(title: "Messages", symbol: "message.fill", route: .messages)
                        QuickLink(title: "Calendar", symbol: "calendar", route: .calendar)
                        QuickLink(title: "Tools", symbol: "wrench.and.screwdriver", route: .toolRentals)
                        QuickLink(title: "Products", symbol: "bag.fill", route: .products)
                    }
                }
                .padding(20)
            }
            .background(AppTheme.background)
            .navigationTitle("Trust")
        }
    }
}

private struct QuickLink: View {
    @EnvironmentObject private var router: OxSteedRouter
    let title: String
    let symbol: String
    let route: OxSteedRoute

    var body: some View {
        Button {
            router.open(route)
        } label: {
            Label(title, systemImage: symbol)
                .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
    }
}
