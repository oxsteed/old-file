import Foundation

enum Audience: String, CaseIterable, Identifiable {
    case customer
    case helper
    case business

    var id: String { rawValue }

    var title: String {
        switch self {
        case .customer: return "Customers"
        case .helper: return "Helpers"
        case .business: return "Businesses"
        }
    }

    var subtitle: String {
        switch self {
        case .customer: return "Find, book, message, and pay local help."
        case .helper: return "Find work, build trust, and manage bids."
        case .business: return "Run a service business from one operating hub."
        }
    }

    var symbol: String {
        switch self {
        case .customer: return "house.and.flag"
        case .helper: return "wrench.and.screwdriver"
        case .business: return "building.2"
        }
    }
}

struct OxSteedFeature: Identifiable {
    let id: String
    let title: String
    let summary: String
    let symbol: String
    let tintName: String
    let route: OxSteedRoute
}

struct OxSteedWorkflow: Identifiable {
    let id: String
    let eyebrow: String
    let title: String
    let body: String
    let symbol: String
    let route: OxSteedRoute
}

struct TrustSignal: Identifiable {
    let id: String
    let title: String
    let body: String
    let symbol: String
}

struct OxSteedRoute: Identifiable, Hashable {
    let id: String
    let path: String

    var url: URL {
        URL(string: "https://oxsteed.com\(path)")!
    }

    static let home = OxSteedRoute(id: "home", path: "/")
    static let helpers = OxSteedRoute(id: "helpers", path: "/helpers")
    static let jobs = OxSteedRoute(id: "jobs", path: "/jobs")
    static let postJob = OxSteedRoute(id: "post-job", path: "/post-job")
    static let messages = OxSteedRoute(id: "messages", path: "/messages")
    static let calendar = OxSteedRoute(id: "calendar", path: "/calendar")
    static let businessHub = OxSteedRoute(id: "business-hub", path: "/business-hub")
    static let consulting = OxSteedRoute(id: "consulting", path: "/consulting-intake")
    static let plannedNeeds = OxSteedRoute(id: "planned-needs", path: "/planned-needs")
    static let toolRentals = OxSteedRoute(id: "tool-rentals", path: "/tool-rentals")
    static let products = OxSteedRoute(id: "products", path: "/products")
    static let login = OxSteedRoute(id: "login", path: "/login")
    static let registerCustomer = OxSteedRoute(id: "register-customer", path: "/register/customer")
    static let registerHelper = OxSteedRoute(id: "register-helper", path: "/register/helper")
}

enum OxSteedContent {
    static let pillars: [OxSteedFeature] = [
        OxSteedFeature(
            id: "local-help",
            title: "Local help marketplace",
            summary: "Search nearby helpers, compare public profiles, and request service without losing context.",
            symbol: "magnifyingglass.circle.fill",
            tintName: "orange",
            route: .helpers
        ),
        OxSteedFeature(
            id: "jobs-bids",
            title: "Jobs, bids, and bookings",
            summary: "Customers post work, helpers bid or accept direct booking requests, and both sides keep the schedule aligned.",
            symbol: "calendar.badge.clock",
            tintName: "blue",
            route: .postJob
        ),
        OxSteedFeature(
            id: "messages-money",
            title: "Messages and money trail",
            summary: "Work conversations, invoices, payment records, and disputes stay attached to the actual job.",
            symbol: "message.badge.waveform.fill",
            tintName: "green",
            route: .messages
        ),
        OxSteedFeature(
            id: "business-hub",
            title: "Business Hub",
            summary: "Small service businesses get profiles, calendars, services, teams, templates, quotes, clients, and analytics.",
            symbol: "chart.line.uptrend.xyaxis.circle.fill",
            tintName: "purple",
            route: .businessHub
        )
    ]

    static let customerWorkflows: [OxSteedWorkflow] = [
        OxSteedWorkflow(id: "find", eyebrow: "Discover", title: "Find trusted help", body: "Browse helpers, business profiles, services, tool rentals, and local products.", symbol: "person.crop.circle.badge.checkmark", route: .helpers),
        OxSteedWorkflow(id: "post", eyebrow: "Request", title: "Post a job", body: "Describe the work once, collect bids, and choose the person who fits the scope.", symbol: "square.and.pencil", route: .postJob),
        OxSteedWorkflow(id: "plan", eyebrow: "Plan", title: "Track future needs", body: "Use planned needs, home care, car care, and calendar reminders before small tasks become emergencies.", symbol: "target", route: .plannedNeeds)
    ]

    static let helperWorkflows: [OxSteedWorkflow] = [
        OxSteedWorkflow(id: "browse", eyebrow: "Earn", title: "Browse nearby jobs", body: "Find work by category, distance, urgency, and fit, then submit bids from your phone.", symbol: "briefcase.fill", route: .jobs),
        OxSteedWorkflow(id: "profile", eyebrow: "Trust", title: "Build a real profile", body: "Show services, gallery work, pricing context, reviews, QR links, and profile templates.", symbol: "person.text.rectangle", route: .registerHelper),
        OxSteedWorkflow(id: "schedule", eyebrow: "Operate", title: "Keep work moving", body: "Use messages, calendar, invoices, and reminders to reduce missed expectations.", symbol: "clock.badge.checkmark", route: .calendar)
    ]

    static let businessWorkflows: [OxSteedWorkflow] = [
        OxSteedWorkflow(id: "hub", eyebrow: "Command center", title: "Run Business Hub", body: "Manage services, appointments, clients, quotes, products, invoices, team access, and analytics.", symbol: "building.columns.fill", route: .businessHub),
        OxSteedWorkflow(id: "verticals", eyebrow: "Templates", title: "Use industry workspaces", body: "Property, trades, beauty, creative, professional, and continuity templates unlock focused operating systems.", symbol: "rectangle.3.group.fill", route: .businessHub),
        OxSteedWorkflow(id: "launch", eyebrow: "Launch", title: "Get business support", body: "Use consulting intake and launch status tools to turn skills into a packaged service business.", symbol: "hammer.fill", route: .consulting)
    ]

    static let trustSignals: [TrustSignal] = [
        TrustSignal(id: "profiles", title: "Profile context", body: "Service details, galleries, templates, QR links, and public reputation help users choose with more confidence.", symbol: "checkmark.seal.fill"),
        TrustSignal(id: "records", title: "Work records", body: "Messages, booking details, invoices, and disputes stay connected to the job or order.", symbol: "doc.text.magnifyingglass"),
        TrustSignal(id: "notifications", title: "Mobile alerts", body: "Push notifications can route people back into bids, bookings, messages, reminders, and business operations.", symbol: "bell.badge.fill")
    ]
}
