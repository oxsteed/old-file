import SwiftUI

struct BusinessProductsView: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if workspace.products.isEmpty {
                        Text("No products loaded yet.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 40)
                    }
                    ForEach(workspace.products) { product in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(product.name)
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(Theme.textPrimary)
                                    Text(product.category ?? "Uncategorized")
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                Text(product.price.map { "$\(Int($0))" } ?? "—")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(Theme.accent)
                            }
                            HStack(spacing: 8) {
                                label("Stock", "\(product.totalStock ?? 0)")
                                label("Variants", "\(product.variantCount ?? 0)")
                                label("Reviews", "\(product.reviewCount ?? 0)")
                            }
                        }
                        .cardStyle(padding: 12)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Products")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func label(_ title: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(title).font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textTertiary)
            Text(value).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textPrimary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Theme.surfaceElevated, in: Capsule())
    }
}

struct BusinessLeadsView: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if workspace.leads.isEmpty {
                        Text("No leads loaded yet.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 40)
                    }
                    ForEach(workspace.leads) { lead in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(lead.name ?? "Lead")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                Text((lead.status ?? "new").capitalized)
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.accent)
                            }
                            Text(lead.service_interest ?? "Interest not set")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                            if let note = lead.notes, !note.isEmpty {
                                Text(note)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textTertiary)
                                    .lineLimit(2)
                            }
                        }
                        .cardStyle(padding: 12)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Leads")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }
}

struct BusinessHealthAlertsView: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if workspace.healthAlerts.isEmpty {
                        Text("No active health alerts.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 40)
                    }
                    ForEach(workspace.healthAlerts) { alert in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(alert.title ?? "Alert")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                Text((alert.severity ?? "info").capitalized)
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.warning)
                            }
                            Text(alert.message ?? "")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                            if let actionURL = alert.action_url, !actionURL.isEmpty {
                                Text(actionURL)
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textTertiary)
                                    .lineLimit(1)
                            }
                        }
                        .cardStyle(padding: 12)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Health")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }
}
