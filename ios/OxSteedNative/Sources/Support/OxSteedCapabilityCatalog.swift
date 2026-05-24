import Foundation

enum OxSteedCapabilityCatalog {
    static let modules: [CapabilityModule] = [
        CapabilityModule(
            id: "customer-core",
            domain: .customer,
            title: "Customer Command Center",
            summary: "Native home for posting jobs, tracking bookings, planned needs, calendars, house/car care, and mode-aware dashboard actions.",
            primaryRoute: "/dashboard",
            status: "Native shell ready",
            actions: [
                .init(id: "post-job", title: "Post a job", detail: "Create scoped job requests with media, category, budget, urgency, and location.", endpointHint: "POST /api/jobs", requiresAuth: true),
                .init(id: "my-jobs", title: "Manage my jobs", detail: "View drafts, active jobs, bids, assignments, start/complete/close/cancel actions.", endpointHint: "GET /api/jobs/me/list", requiresAuth: true),
                .init(id: "bookings", title: "Bookings & reschedule", detail: "See appointments, request reschedules, add accepted bookings to device calendar.", endpointHint: "GET /api/mobile/feed", requiresAuth: true),
                .init(id: "planned-needs", title: "Planned needs", detail: "Create future maintenance needs and convert them into job drafts.", endpointHint: "GET/POST /api/planned-needs", requiresAuth: true)
            ]
        ),
        CapabilityModule(
            id: "helper-core",
            domain: .helper,
            title: "Helper Work Center",
            summary: "Native helper dashboard for job discovery, bids, incoming bookings, availability, profile, gallery, services, policies, earnings, and Connect onboarding.",
            primaryRoute: "/helper-dashboard",
            status: "Native contract seeded from RN phase 3",
            actions: [
                .init(id: "available-jobs", title: "Find jobs and bid", detail: "Filter available work, inspect job detail, and submit bids.", endpointHint: "GET /api/jobs, POST /api/bids", requiresAuth: true),
                .init(id: "incoming-bookings", title: "Accept booking requests", detail: "Accept or decline incoming booking requests from customers.", endpointHint: "GET /api/bookings/incoming", requiresAuth: true),
                .init(id: "availability", title: "Manage availability", detail: "Block unavailable time and maintain agenda/availability templates.", endpointHint: "GET/POST /api/calendar/availability/mine", requiresAuth: true),
                .init(id: "profile", title: "Edit helper profile", detail: "Update core profile, services, FAQs, policies, cover photo, QR code, and gallery.", endpointHint: "GET/PUT /api/helper-profile/*", requiresAuth: true)
            ]
        ),
        CapabilityModule(
            id: "marketplace-products",
            domain: .marketplace,
            title: "Marketplace Discovery",
            summary: "Native product/helper/tool discovery with skill-aware product browsing, product details, tool rentals, helper profiles, and public search.",
            primaryRoute: "/products",
            status: "Capability parity map ready",
            actions: [
                .init(id: "browse-products", title: "Browse products by skill", detail: "Use the same skill-aware marketplace contracts as the website.", endpointHint: "GET /api/marketplace/products", requiresAuth: false),
                .init(id: "recommended-products", title: "Recommended products", detail: "Surface helper-skill recommendations when no filter is active.", endpointHint: "GET /api/marketplace/products/recommended", requiresAuth: true),
                .init(id: "tool-rentals", title: "Tool rentals", detail: "Browse rentable tools and drill into rental details.", endpointHint: "GET /api/tool-rentals", requiresAuth: false),
                .init(id: "helper-directory", title: "Helper directory", detail: "Search helper/business profiles and start booking or messaging.", endpointHint: "GET /api/helpers", requiresAuth: false)
            ]
        ),
        CapabilityModule(
            id: "commerce",
            domain: .commerce,
            title: "Checkout, Orders & Payments",
            summary: "Native shopping-list, cart, checkout, invoices, Stripe PaymentSheet, order history, public invoice, and payment-status surfaces.",
            primaryRoute: "/orders",
            status: "Requires Stripe native wiring",
            actions: [
                .init(id: "cart", title: "Cart and shared carts", detail: "Open owned carts, shared carts, and shopping-list checkout paths.", endpointHint: "GET /api/carts/:cartId", requiresAuth: true),
                .init(id: "checkout", title: "Checkout", detail: "Create and confirm payment intents for marketplace purchases.", endpointHint: "POST /api/cart-checkout/:cartId/payment-intent", requiresAuth: true),
                .init(id: "orders", title: "Order history", detail: "Track order detail, status, and post-purchase actions.", endpointHint: "GET /api/orders", requiresAuth: true),
                .init(id: "invoices", title: "Invoices and payments", detail: "View invoices and pay eligible balances with native Stripe PaymentSheet.", endpointHint: "POST /api/mobile/invoices/:invoiceId/payment-intent", requiresAuth: true)
            ]
        ),
        CapabilityModule(
            id: "business-hub",
            domain: .business,
            title: "Business Hub",
            summary: "Native owner/operator workspace for businesses, services, staff, appointments, quotes, products, intake requests, recurring billing, health alerts, and launch operations.",
            primaryRoute: "/business-hub",
            status: "Broad backend route coverage identified",
            actions: [
                .init(id: "business-summary", title: "Business summary", detail: "Load mobile business summary and active memberships.", endpointHint: "GET /api/business/:businessId/workspace/mobile-summary", requiresAuth: true),
                .init(id: "services", title: "Services and appointments", detail: "Manage services, staff assignment, availability, appointment status, notes, cancellation, and rescheduling.", endpointHint: "GET/POST /api/businesses/:businessId/services", requiresAuth: true),
                .init(id: "quotes", title: "Quotes and invoices", detail: "Create quotes, send them, and convert accepted quotes to invoices.", endpointHint: "POST /api/businesses/:businessId/quotes", requiresAuth: true),
                .init(id: "intakes", title: "Vertical intake work", detail: "Handle maintenance, trades, beauty, creative, professional, and continuity intake flows.", endpointHint: "POST /api/*-operations/public/:businessId/intakes", requiresAuth: false)
            ]
        ),
        CapabilityModule(
            id: "logistics",
            domain: .logistics,
            title: "Logistics Branch",
            summary: "Native buyer, organizer, business procurement, distributor/reseller, sourcing, orders, shipments, warehouse, compliance, finance, operations, and admin-control branch.",
            primaryRoute: "/logistics",
            status: "High priority native module",
            actions: [
                .init(id: "buyer", title: "Buyer dashboard", detail: "Track sourcing requests, campaigns, orders, shipments, finance, and favorites.", endpointHint: "GET /api/logistics/*", requiresAuth: true),
                .init(id: "procurement", title: "Business procurement", detail: "Plan recurring procurement, approvals, procurement memberships, and activation.", endpointHint: "POST /api/logistics/recurring-procurement", requiresAuth: true),
                .init(id: "operations", title: "Operations workspace", detail: "Run sourcing ops, organizer approvals, shipment ops, warehouse ops, allocations, and disputes.", endpointHint: "GET /api/admin/logistics/*", requiresAuth: true),
                .init(id: "compliance", title: "Compliance workspace", detail: "Review customs, restrictions, compliance gates, and manual review queues.", endpointHint: "GET /api/admin/logistics/compliance-review", requiresAuth: true)
            ]
        ),
        CapabilityModule(
            id: "communications",
            domain: .communications,
            title: "Messages & Support",
            summary: "Native inbox, threaded conversations, attachments, helper guest inquiries, business support, escalation, support agent portal, typing/read cues, and notifications.",
            primaryRoute: "/messages",
            status: "Native messaging path exists in RN, SwiftUI parity shell added",
            actions: [
                .init(id: "conversation-list", title: "Conversation inbox", detail: "Load customer/helper/business conversation lists and unread counts.", endpointHint: "GET /api/messages/conversations", requiresAuth: true),
                .init(id: "thread", title: "Threaded chat", detail: "Send messages, attachments, and typing indicators.", endpointHint: "POST /api/messages/conversations/:id", requiresAuth: true),
                .init(id: "support-escalation", title: "Support escalation", detail: "Route urgent customer issues into live chat or ticket fallback.", endpointHint: "POST /api/support/escalations", requiresAuth: false),
                .init(id: "push", title: "Push notifications", detail: "Register APNs tokens and route notification opens to the correct native destination.", endpointHint: "POST /api/mobile/push-token", requiresAuth: true)
            ]
        ),
        CapabilityModule(
            id: "consulting",
            domain: .consulting,
            title: "Consulting & Launch",
            summary: "Native consulting intake, payment, scheduling, session portal, contractor dashboard, feedback, business launch status, and franchise application surfaces.",
            primaryRoute: "/consulting",
            status: "Needs scheduling/payment detail screens",
            actions: [
                .init(id: "consulting-intake", title: "Consulting intake", detail: "Collect consulting request details and package intent.", endpointHint: "POST /api/consulting", requiresAuth: false),
                .init(id: "consulting-payments", title: "Consulting payment", detail: "Create and confirm consulting payment intents.", endpointHint: "POST /api/consulting-payment/payment-intent", requiresAuth: true),
                .init(id: "scheduling", title: "Consulting schedule", detail: "Find slots, set consultant availability, and book sessions.", endpointHint: "GET /api/consulting-scheduling/consultants/:id/available-slots", requiresAuth: true),
                .init(id: "launch-status", title: "Launch status", detail: "Search and inspect business launch requests and next steps.", endpointHint: "GET /api/business-launch/status", requiresAuth: false)
            ]
        ),
        CapabilityModule(
            id: "learn-mode",
            domain: .learning,
            title: "Learn Mode",
            summary: "Native useful-video and written-guide discovery with skills, products, rental handoffs, job-post handoffs, and creator prompts.",
            primaryRoute: "/learn",
            status: "Native feed shell ready",
            actions: [
                .init(id: "lesson-feed", title: "Lesson feed", detail: "Browse task-based lesson cards and fallback written guides.", endpointHint: "GET /api/learn", requiresAuth: false),
                .init(id: "shop-items", title: "Shoppable skill items", detail: "Connect tutorial item lists to marketplace and rentals.", endpointHint: "GET /api/marketplace/products/search", requiresAuth: false),
                .init(id: "hire-instead", title: "Hire instead", detail: "Turn a lesson into a post-job draft when users do not want to DIY.", endpointHint: "PUT /api/jobs/draft", requiresAuth: true)
            ]
        ),
        CapabilityModule(
            id: "trust-safety",
            domain: .trust,
            title: "Trust, Safety & Legal",
            summary: "Native verification, disputes, enforcement, legal acceptance, privacy/security, arbitration, escrow policy, and accessibility center.",
            primaryRoute: "/verify-identity",
            status: "Security-sensitive flows need device testing",
            actions: [
                .init(id: "identity", title: "Identity verification", detail: "Create identity sessions and display verification status/badges.", endpointHint: "POST /api/verification/identity/session", requiresAuth: true),
                .init(id: "background-check", title: "Background checks", detail: "Initiate and track Checkr-style background checks.", endpointHint: "POST /api/verification/background-check", requiresAuth: true),
                .init(id: "disputes", title: "Dispute center", detail: "Open disputes, inspect detail, add evidence, and track resolution.", endpointHint: "GET /api/disputes", requiresAuth: true),
                .init(id: "legal", title: "Legal documents", detail: "Display legal docs and record user acceptances.", endpointHint: "POST /api/legal-documents/:documentType/accept", requiresAuth: true)
            ]
        ),
        CapabilityModule(
            id: "internal-workspaces",
            domain: .internalWorkspaces,
            title: "Internal Employee Workspaces",
            summary: "Native employee login/dashboard for Finance, HR, Legal, Technology, Executive, Data, Marketing, Corporate Ops, and logistics branch operations/compliance.",
            primaryRoute: "/internal/:workspace",
            status: "Two-step internal auth shell needed next",
            actions: [
                .init(id: "department-login", title: "Department access gate", detail: "Internal name/security-key challenge before normal account auth.", endpointHint: "POST /api/internal-workspaces/:workspace/access", requiresAuth: false),
                .init(id: "department-dashboard", title: "Department dashboard", detail: "Show department playbooks, permissions, and assigned work.", endpointHint: "GET /api/internal-workspaces/:workspace", requiresAuth: true),
                .init(id: "logistics-gate", title: "Logistics internal access", detail: "Support Operations, Compliance, and Admin Control route-bound sessions.", endpointHint: "POST /api/logistics/internal-access/verify", requiresAuth: false)
            ]
        ),
        CapabilityModule(
            id: "admin-super-admin",
            domain: .admin,
            title: "Admin & Super Admin",
            summary: "Native control plane for users, jobs, moderation, disputes, markets, skills, support, businesses, payments, templates, corporate roles, logistics admin, audit, pricing, permissions, and one-truth review.",
            primaryRoute: "/admin",
            status: "Use role-gated native surfaces, not public tabs",
            actions: [
                .init(id: "admin-dashboard", title: "Admin dashboard", detail: "Operational overview plus search, reports, moderation, users, jobs, businesses, and support.", endpointHint: "GET /api/admin/*", requiresAuth: true),
                .init(id: "super-control", title: "Super admin control", detail: "Pricing, fees, permissions, user creation, regions, audit, one-truth, franchises, and access gates.", endpointHint: "GET /api/admin/super/*", requiresAuth: true),
                .init(id: "corporate", title: "Corporate departments", detail: "Manage departments, titles, assignments, permissions, and org chart.", endpointHint: "GET /api/corporate-roles/*", requiresAuth: true),
                .init(id: "logistics-admin", title: "Logistics admin", detail: "Manage lanes, suppliers, quotes, campaigns, POs, shipments, warehouses, pricing, restrictions, and control.", endpointHint: "GET /api/admin/logistics/*", requiresAuth: true)
            ]
        ),
        CapabilityModule(
            id: "account-settings",
            domain: .account,
            title: "Account, Modes & Settings",
            summary: "Native auth, mode switching, 2FA, notifications, language, payment policies, upgrades, templates, consent, and account recovery.",
            primaryRoute: "/settings",
            status: "Session and API client implemented",
            actions: [
                .init(id: "auth", title: "Login and registration", detail: "Support customer/helper/join flows, forgot/reset password, 2FA validation, and email verification.", endpointHint: "POST /api/auth/login", requiresAuth: false),
                .init(id: "modes", title: "Mode switching", detail: "Switch account modes and route to the right native workspace.", endpointHint: "PATCH /api/auth/me/default-mode", requiresAuth: true),
                .init(id: "settings", title: "Settings", detail: "Manage notifications, 2FA, language, payment policies, templates, and upgrades.", endpointHint: "GET /api/settings", requiresAuth: true),
                .init(id: "consent", title: "Consent and recovery", detail: "Accept required consent and use access-gate recovery paths.", endpointHint: "POST /api/consent/accept", requiresAuth: true)
            ]
        )
    ]
}
