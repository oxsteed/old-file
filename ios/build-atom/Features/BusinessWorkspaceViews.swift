import SwiftUI

struct BusinessProductsView: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore
    @EnvironmentObject private var localization: LocalizationManager

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
                                    Text(product.category ?? localization.localized("Uncategorized"))
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                Text(product.price.map { localization.formatCurrency($0, fractionDigits: 0) } ?? "—")
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
            Text(LocalizedStringKey(title)).font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textTertiary)
            Text(value).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textPrimary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Theme.surfaceElevated, in: Capsule())
    }
}

struct BusinessLeadsView: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore
    @EnvironmentObject private var localization: LocalizationManager

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
                                Text(lead.name ?? localization.localized("Lead"))
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                Text(localizedLeadStatus(lead.status))
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.accent)
                            }
                            Text(lead.service_interest ?? localization.localized("Interest not set"))
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

    private func localizedLeadStatus(_ status: String?) -> String {
        switch status?.lowercased() {
        case "new": return localization.localized("workspace.lead_status.new")
        case "contacted": return localization.localized("workspace.lead_status.contacted")
        case "qualified": return localization.localized("workspace.lead_status.qualified")
        case "won": return localization.localized("workspace.lead_status.won")
        case "lost": return localization.localized("workspace.lead_status.lost")
        default:
            return status?.replacingOccurrences(of: "_", with: " ").capitalized ?? localization.localized("workspace.lead_status.new")
        }
    }
}

struct BusinessHealthAlertsView: View {
    @EnvironmentObject var workspace: BusinessWorkspaceStore
    @EnvironmentObject private var localization: LocalizationManager

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
                                Text(alert.title ?? localization.localized("Alert"))
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                Text(localizedSeverity(alert.severity))
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

    private func localizedSeverity(_ severity: String?) -> String {
        switch severity?.lowercased() {
        case "info": return localization.localized("workspace.alert_severity.info")
        case "warning": return localization.localized("workspace.alert_severity.warning")
        case "critical": return localization.localized("workspace.alert_severity.critical")
        default:
            return severity?.replacingOccurrences(of: "_", with: " ").capitalized ?? localization.localized("workspace.alert_severity.info")
        }
    }
}
