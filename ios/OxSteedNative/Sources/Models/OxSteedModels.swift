import Foundation
import SwiftUI

enum OxSteedTab: String, CaseIterable, Identifiable {
    case today
    case marketplace
    case work
    case logistics
    case business
    case account

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .marketplace: "Market"
        case .work: "Work"
        case .logistics: "Logistics"
        case .business: "Business"
        case .account: "Account"
        }
    }

    var symbolName: String {
        switch self {
        case .today: "sparkles"
        case .marketplace: "bag"
        case .work: "hammer"
        case .logistics: "shippingbox"
        case .business: "building.2"
        case .account: "person.crop.circle"
        }
    }
}

enum CapabilityDomain: String, CaseIterable, Identifiable {
    case customer
    case helper
    case marketplace
    case commerce
    case business
    case logistics
    case communications
    case consulting
    case learning
    case trust
    case internalWorkspaces
    case admin
    case account

    var id: String { rawValue }

    var title: String {
        switch self {
        case .customer: "Customer Jobs & Bookings"
        case .helper: "Helper Work Center"
        case .marketplace: "Product Marketplace"
        case .commerce: "Cart, Orders & Payments"
        case .business: "Business Hub"
        case .logistics: "Logistics Branch"
        case .communications: "Messages & Support"
        case .consulting: "Consulting & Launch"
        case .learning: "Learn Mode"
        case .trust: "Trust, Safety & Legal"
        case .internalWorkspaces: "Internal Workspaces"
        case .admin: "Admin & Super Admin"
        case .account: "Account & Settings"
        }
    }

    var tab: OxSteedTab {
        switch self {
        case .customer, .learning: .today
        case .marketplace, .commerce: .marketplace
        case .helper, .communications, .consulting: .work
        case .logistics, .internalWorkspaces, .admin: .logistics
        case .business: .business
        case .trust, .account: .account
        }
    }

    var tint: Color {
        switch self {
        case .customer: .orange
        case .helper: .teal
        case .marketplace: .green
        case .commerce: .mint
        case .business: .blue
        case .logistics: .indigo
        case .communications: .cyan
        case .consulting: .brown
        case .learning: .pink
        case .trust: .red
        case .internalWorkspaces: .purple
        case .admin: .gray
        case .account: .secondary
        }
    }

    var routeFamily: [String] {
        switch self {
        case .customer:
            ["/", "/post-job", "/my-jobs", "/my-bookings", "/planned-needs", "/calendar", "/car-care"]
        case .helper:
            ["/helpers", "/jobs", "/my-bids", "/dashboard/edit-profile", "/consultant-availability", "/promote"]
        case .marketplace:
            ["/products", "/tool-rentals", "/discover", "/helpers/:id", "/profile/:id"]
        case .commerce:
            ["/cart/:cartId", "/checkout/:cartId", "/orders", "/orders/:id", "/invoices", "/invoice/p/:token"]
        case .business:
            ["/business-hub", "/business/:businessId/workspace", "/business/:id", "/business/edit-profile", "/business/:businessId/*-intake"]
        case .logistics:
            ["/logistics", "/logistics/buyer", "/logistics/organizer", "/logistics/business-procurement", "/logistics/distributor", "/logistics/sourcing", "/logistics/orders", "/logistics/shipments", "/logistics/warehousing", "/logistics/distribution", "/logistics/finance"]
        case .communications:
            ["/messages", "/messages/:conversationId", "/helper/messages", "/support/escalation", "/support/agent"]
        case .consulting:
            ["/consulting", "/consulting-intake", "/business-launch-status", "/consulting/portal", "/consulting/contractor-dashboard"]
        case .learning:
            ["/learn", "/how-it-works", "/features"]
        case .trust:
            ["/verify-email", "/verify-identity", "/disputes", "/terms", "/privacy", "/security", "/legal/*"]
        case .internalWorkspaces:
            ["/internal/:workspace/login", "/internal/:workspace", "/logistics/operations", "/logistics/compliance-workspace", "/logistics/admin-control"]
        case .admin:
            ["/admin/*", "/admin/super/*", "/admin/logistics/*", "/admin/corporate/*", "/admin/support/*"]
        case .account:
            ["/login", "/join", "/settings", "/settings/2fa", "/settings/notifications", "/upgrade", "/templates"]
        }
    }
}

struct CapabilityAction: Identifiable, Hashable {
    let id: String
    let title: String
    let detail: String
    let endpointHint: String
    let requiresAuth: Bool
}

struct CapabilityModule: Identifiable, Hashable {
    let id: String
    let domain: CapabilityDomain
    let title: String
    let summary: String
    let primaryRoute: String
    let status: String
    let actions: [CapabilityAction]
}

struct DashboardSignal: Identifiable {
    let id = UUID()
    let label: String
    let value: String
    let note: String
    let symbolName: String
}
