import SwiftUI

struct NativeWorkspaceView: View {
    let module: CapabilityModule

    var body: some View {
        Group {
            switch module.domain {
            case .customer:
                CustomerNativeWorkspace(module: module)
            case .marketplace, .commerce:
                MarketplaceNativeWorkspace(module: module)
            case .logistics:
                LogisticsNativeWorkspace(module: module)
            case .communications:
                MessagesNativeWorkspace(module: module)
            case .consulting:
                ConsultingNativeWorkspace(module: module)
            case .business:
                BusinessNativeWorkspace(module: module)
            case .helper:
                HelperNativeWorkspace(module: module)
            case .learning:
                LearnNativeWorkspace(module: module)
            case .trust:
                TrustNativeWorkspace(module: module)
            case .internalWorkspaces, .admin:
                InternalNativeWorkspace(module: module)
            case .account:
                AccountSurfaceView()
            }
        }
        .navigationTitle(module.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private struct CustomerNativeWorkspace: View {
    let module: CapabilityModule

    @Environment(SessionStore.self) private var session
    @State private var store = NativeWorkspaceStore()
    @State private var readStore = NativeReadStore()
    @State private var draft = JobDraftRequest(
        title: "",
        description: "",
        categoryName: "",
        budgetType: "open",
        budgetMin: nil,
        budgetMax: nil,
        urgency: "flexible",
        siteAccess: "easy",
        locationAddress: nil,
        locationCity: "",
        locationState: nil,
        locationZip: nil,
        locationCountry: "US"
    )

    var body: some View {
        NativeFormScaffold(module: module, store: store) {
            MobileFeedSection(state: readStore.mobileFeed) {
                Task {
                    await readStore.loadMobileFeed(using: session.apiClient)
                }
            }

            Section("Post Job") {
                TextField("Title, at least 10 characters", text: $draft.title)
                TextField("Category", text: $draft.categoryName)
                TextField("City", text: $draft.locationCity)
                TextField("State", text: Binding($draft.locationState, replacingNilWith: ""))
                TextField("ZIP", text: Binding($draft.locationZip, replacingNilWith: ""))
                TextField("Country", text: $draft.locationCountry)
                Picker("Budget", selection: $draft.budgetType) {
                    Text("Open").tag("open")
                    Text("Fixed").tag("fixed")
                    Text("Hourly").tag("hourly")
                }
                Picker("Urgency", selection: $draft.urgency) {
                    Text("Flexible").tag("flexible")
                    Text("Soon").tag("soon")
                    Text("ASAP").tag("asap")
                }
                TextField("Describe the job in detail", text: $draft.description, axis: .vertical)
                    .lineLimit(4...8)
                Button(store.isSubmitting ? "Posting..." : "Post Native Job") {
                    Task {
                        await store.submitJobDraft(draft, using: session.apiClient)
                    }
                }
                .disabled(store.isSubmitting || !session.isAuthenticated || draft.title.count < 10 || draft.description.count < 50 || draft.locationCity.isEmpty)
            }
        }
        .task {
            guard session.isAuthenticated else { return }
            await readStore.loadMobileFeed(using: session.apiClient)
        }
    }
}

private struct MarketplaceNativeWorkspace: View {
    let module: CapabilityModule

    @Environment(SessionStore.self) private var session
    @State private var readStore = NativeReadStore()
    @State private var query = MarketplaceSearchQuery(query: "", category: nil, sort: "relevance", skillId: nil)

    var body: some View {
        NativePreviewScaffold(
            module: module,
            previews: [
                .init(method: "GET", path: "/api/marketplace/products?query=\(query.query)", note: "Skill-aware product browse/search should hydrate native product cards."),
                .init(method: "GET", path: "/api/marketplace/products/recommended", note: "Logged-in helpers get product recommendations from their skill profile."),
                .init(method: "POST", path: "/api/cart-checkout/:cartId/payment-intent", note: "Checkout should use native Stripe PaymentSheet before confirm.")
            ]
        ) {
            Section("Search Draft") {
                TextField("Search products, tools, or supplies", text: $query.query)
                TextField("Category", text: Binding($query.category, replacingNilWith: ""))
                TextField("Skill ID", text: Binding($query.skillId, replacingNilWith: ""))
                Picker("Sort", selection: $query.sort) {
                    Text("Relevance").tag(Optional("relevance"))
                    Text("Rating").tag(Optional("rating"))
                    Text("Newest").tag(Optional("newest"))
                    Text("Price").tag(Optional("price_asc"))
                }
                Button("Load Products") {
                    Task {
                        await readStore.loadMarketplaceProducts(query: query, using: session.apiClient)
                    }
                }
            }

            ProductListSection(state: readStore.marketplaceProducts) {
                Task {
                    await readStore.loadMarketplaceProducts(query: query, using: session.apiClient)
                }
            }
        }
        .task {
            await readStore.loadMarketplaceProducts(query: query, using: session.apiClient)
        }
    }
}

private struct LogisticsNativeWorkspace: View {
    let module: CapabilityModule

    @Environment(SessionStore.self) private var session
    @State private var store = NativeWorkspaceStore()
    @State private var readStore = NativeReadStore()
    @State private var draft = LogisticsSourcingRequestDraft(
        title: "",
        description: "",
        laneId: nil,
        quantity: "1",
        unit: "case",
        targetPriceUsd: nil,
        destinationCity: "",
        destinationCountry: "US"
    )

    var body: some View {
        NativeFormScaffold(module: module, store: store) {
            LogisticsRequestSection(state: readStore.logisticsRequests) {
                Task {
                    await readStore.loadLogisticsRequests(using: session.apiClient)
                }
            }

            Section("Sourcing Request") {
                TextField("Request title", text: $draft.title)
                TextField("Description", text: $draft.description, axis: .vertical)
                    .lineLimit(3...6)
                TextField("Lane ID, optional", text: Binding($draft.laneId, replacingNilWith: ""))
                TextField("Quantity", text: $draft.quantity)
                TextField("Unit", text: $draft.unit)
                TextField("Target price USD", text: Binding($draft.targetPriceUsd, replacingNilWith: ""))
                TextField("Destination city", text: $draft.destinationCity)
                TextField("Destination country", text: $draft.destinationCountry)
                Button(store.isSubmitting ? "Submitting..." : "Create Sourcing Request") {
                    Task {
                        await store.submitLogisticsRequest(draft, using: session.apiClient)
                    }
                }
                .disabled(store.isSubmitting || !session.isAuthenticated || draft.title.isEmpty || draft.description.isEmpty || draft.destinationCity.isEmpty)
            }
        }
        .task {
            guard session.isAuthenticated else { return }
            await readStore.loadLogisticsRequests(using: session.apiClient)
        }
    }
}

private struct MessagesNativeWorkspace: View {
    let module: CapabilityModule

    @Environment(SessionStore.self) private var session
    @State private var readStore = NativeReadStore()
    @State private var draft = ConversationDraftRequest(recipientId: "", message: "", context: "general")

    var body: some View {
        NativePreviewScaffold(
            module: module,
            previews: [
                .init(method: "GET", path: "/api/messages/conversations", note: "Hydrate the native inbox with unread counts and latest-message metadata."),
                .init(method: "POST", path: "/api/messages/conversations/:id", note: "Send threaded messages and optimistic local echoes."),
                .init(method: "POST", path: "/api/messages/conversations/:id/attachments", note: "Attach photos/files from Photos, camera, or Files.")
            ]
        ) {
            Section("Message Draft") {
                TextField("Recipient user ID", text: $draft.recipientId)
                TextField("Context", text: $draft.context)
                TextField("Message", text: $draft.message, axis: .vertical)
                    .lineLimit(4...8)
            }

            ConversationListSection(state: readStore.conversations) {
                Task {
                    await readStore.loadConversations(using: session.apiClient)
                }
            }
        }
        .task {
            guard session.isAuthenticated else { return }
            await readStore.loadConversations(using: session.apiClient)
        }
    }
}

private struct ConsultingNativeWorkspace: View {
    let module: CapabilityModule

    var body: some View {
        NativePreviewScaffold(
            module: module,
            previews: [
                .init(method: "GET", path: "/api/consulting-payment/packages", note: "Load native package cards before intake/payment."),
                .init(method: "POST", path: "/api/consulting-payment/payment-intent", note: "Collect consulting payment with native Stripe."),
                .init(method: "GET", path: "/api/consulting-scheduling/consultants/:id/available-slots", note: "Render native slot picker for session booking."),
                .init(method: "GET", path: "/api/business-launch-status", note: "Search launch request status by applicant email.")
            ]
        )
    }
}

private struct BusinessNativeWorkspace: View {
    let module: CapabilityModule

    var body: some View {
        NativePreviewScaffold(
            module: module,
            previews: [
                .init(method: "GET", path: "/api/business/:businessId/workspace/mobile-summary", note: "Hydrate operator overview cards."),
                .init(method: "GET", path: "/api/businesses/:businessId/services", note: "Manage services and staff assignment."),
                .init(method: "GET", path: "/api/businesses/:businessId/appointments", note: "Schedule, reschedule, cancel, and add notes."),
                .init(method: "POST", path: "/api/businesses/:businessId/quotes", note: "Create/send quotes and convert to invoices.")
            ]
        )
    }
}

private struct HelperNativeWorkspace: View {
    let module: CapabilityModule

    var body: some View {
        NativePreviewScaffold(
            module: module,
            previews: [
                .init(method: "GET", path: "/api/jobs", note: "Find available jobs and bid."),
                .init(method: "GET", path: "/api/bookings/incoming", note: "Accept or decline booking requests."),
                .init(method: "GET", path: "/api/calendar/availability/mine", note: "Manage availability and blocks."),
                .init(method: "PUT", path: "/api/helper-profile/core", note: "Edit public helper profile.")
            ]
        )
    }
}

private struct LearnNativeWorkspace: View {
    let module: CapabilityModule

    var body: some View {
        NativePreviewScaffold(
            module: module,
            previews: [
                .init(method: "GET", path: "/api/learn", note: "Native repair/learning feed."),
                .init(method: "GET", path: "/api/marketplace/products/search", note: "Map lesson item lists to shopping/rental actions."),
                .init(method: "PUT", path: "/api/jobs/draft", note: "Convert lesson into hire-instead job draft.")
            ]
        )
    }
}

private struct TrustNativeWorkspace: View {
    let module: CapabilityModule

    var body: some View {
        NativePreviewScaffold(
            module: module,
            previews: [
                .init(method: "POST", path: "/api/verification/identity/session", note: "Start identity verification."),
                .init(method: "GET", path: "/api/verification/badges", note: "Show verification badges."),
                .init(method: "GET", path: "/api/disputes", note: "Native dispute center."),
                .init(method: "POST", path: "/api/legal-documents/:documentType/accept", note: "Record legal acceptance.")
            ]
        )
    }
}

private struct InternalNativeWorkspace: View {
    let module: CapabilityModule

    var body: some View {
        NativePreviewScaffold(
            module: module,
            previews: module.actions.map {
                NativeEndpointPreview(method: $0.endpointHint.split(separator: " ").first.map(String.init) ?? "GET", path: $0.endpointHint, note: $0.detail)
            }
        )
    }
}

private struct NativeFormScaffold<Content: View>: View {
    let module: CapabilityModule
    @Bindable var store: NativeWorkspaceStore
    @ViewBuilder var content: Content

    var body: some View {
        Form {
            nativeHeader
            content
            statusSection
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background.ignoresSafeArea())
    }

    private var nativeHeader: some View {
        Section {
            Text(module.summary)
                .foregroundStyle(.secondary)
            Text(module.primaryRoute)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(module.domain.tint)
        } header: {
            Text("Native Workspace")
        }
    }

    @ViewBuilder
    private var statusSection: some View {
        if let resultMessage = store.resultMessage {
            Section("Result") {
                Label(resultMessage, systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }
        }
        if let errorMessage = store.errorMessage {
            Section("Error") {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            }
        }
    }
}

private struct MobileFeedSection: View {
    let state: ResourceState<MobileFeed>
    let reload: () -> Void

    var body: some View {
        Section("Dashboard Feed") {
            switch state {
            case .idle:
                Button("Load Dashboard Feed", action: reload)
            case .loading:
                ProgressView("Loading dashboard")
            case .failed(let message):
                VStack(alignment: .leading, spacing: 8) {
                    Text(message)
                        .foregroundStyle(.red)
                    Button("Retry", action: reload)
                }
            case .loaded(let feed):
                if let summary = feed.summary {
                    NativeMetricStrip(items: [
                        ("Jobs", "\(summary.openJobs ?? 0)"),
                        ("Bookings", "\(summary.incomingBookingRequests ?? 0)"),
                        ("Messages", "\(summary.unreadMessages ?? 0)"),
                        ("Orders", "\(summary.totalOrders ?? 0)")
                    ])
                }

                if let jobs = feed.jobs?.mine, !jobs.isEmpty {
                    ForEach(jobs.prefix(4)) { job in
                        NativeListRow(
                            title: job.title ?? "Untitled job",
                            subtitle: [job.status, job.categoryName].compactMap { $0 }.joined(separator: " · "),
                            trailing: job.locationCity
                        )
                    }
                } else {
                    ContentUnavailableView("No customer jobs yet", systemImage: "hammer", description: Text("Post a job below when you are ready."))
                }
            }
        }
    }
}

private struct ProductListSection: View {
    let state: ResourceState<[MarketplaceProduct]>
    let reload: () -> Void

    var body: some View {
        Section("Products") {
            switch state {
            case .idle:
                Button("Load Products", action: reload)
            case .loading:
                ProgressView("Loading products")
            case .failed(let message):
                VStack(alignment: .leading, spacing: 8) {
                    Text(message)
                        .foregroundStyle(.red)
                    Button("Retry", action: reload)
                }
            case .loaded(let products):
                if products.isEmpty {
                    ContentUnavailableView("No products found", systemImage: "bag", description: Text("Try a broader query or browse without a search term."))
                } else {
                    ForEach(products.prefix(10)) { product in
                        NativeListRow(
                            title: product.name ?? "Unnamed product",
                            subtitle: [product.category, product.description].compactMap { $0 }.joined(separator: " · "),
                            trailing: product.priceText
                        )
                    }
                }
            }
        }
    }
}

private struct ConversationListSection: View {
    let state: ResourceState<[NativeConversation]>
    let reload: () -> Void

    var body: some View {
        Section("Inbox") {
            switch state {
            case .idle:
                Button("Load Inbox", action: reload)
            case .loading:
                ProgressView("Loading inbox")
            case .failed(let message):
                VStack(alignment: .leading, spacing: 8) {
                    Text(message)
                        .foregroundStyle(.red)
                    Button("Retry", action: reload)
                }
            case .loaded(let conversations):
                if conversations.isEmpty {
                    ContentUnavailableView("No conversations yet", systemImage: "bubble.left.and.bubble.right", description: Text("Messages from jobs, bookings, and support will appear here."))
                } else {
                    ForEach(conversations.prefix(10)) { conversation in
                        NativeListRow(
                            title: conversation.otherUserName ?? conversation.conversationBusinessName ?? conversation.helperBusinessName ?? "Conversation #\(conversation.id)",
                            subtitle: conversation.lastMessage ?? conversation.jobTitle ?? "No messages yet",
                            trailing: (conversation.unreadCount ?? 0) > 0 ? "\(conversation.unreadCount ?? 0) unread" : nil
                        )
                    }
                }
            }
        }
    }
}

private struct LogisticsRequestSection: View {
    let state: ResourceState<[LogisticsRequestSummary]>
    let reload: () -> Void

    var body: some View {
        Section("Recent Requests") {
            switch state {
            case .idle:
                Button("Load Requests", action: reload)
            case .loading:
                ProgressView("Loading requests")
            case .failed(let message):
                VStack(alignment: .leading, spacing: 8) {
                    Text(message)
                        .foregroundStyle(.red)
                    Button("Retry", action: reload)
                }
            case .loaded(let requests):
                if requests.isEmpty {
                    ContentUnavailableView("No logistics requests", systemImage: "shippingbox", description: Text("Create the first native sourcing request below."))
                } else {
                    ForEach(requests.prefix(8)) { request in
                        NativeListRow(
                            title: request.title ?? request.reference ?? "Request #\(request.id)",
                            subtitle: [request.status, request.description].compactMap { $0 }.joined(separator: " · "),
                            trailing: request.destinationCity
                        )
                    }
                }
            }
        }
    }
}

private struct NativeMetricStrip: View {
    let items: [(String, String)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 8)], spacing: 8) {
            ForEach(items, id: \.0) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.1)
                        .font(.title3.bold())
                    Text(item.0)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }
}

private struct NativeListRow: View {
    let title: String
    let subtitle: String
    let trailing: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.headline)
                    .lineLimit(2)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer()
            if let trailing, !trailing.isEmpty {
                Text(trailing)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
            }
        }
    }
}

private struct NativePreviewScaffold<Content: View>: View {
    let module: CapabilityModule
    let previews: [NativeEndpointPreview]
    @ViewBuilder var content: Content

    init(module: CapabilityModule, previews: [NativeEndpointPreview], @ViewBuilder content: () -> Content = { EmptyView() }) {
        self.module = module
        self.previews = previews
        self.content = content()
    }

    var body: some View {
        Form {
            Section("Native Workspace") {
                Text(module.summary)
                    .foregroundStyle(.secondary)
                Text("These contracts are ready to become typed screens as each backend payload is verified.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            content

            Section("Endpoint Plan") {
                ForEach(previews) { preview in
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(preview.method) \(preview.path)")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(module.domain.tint)
                        Text(preview.note)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background.ignoresSafeArea())
    }
}

private extension Binding where Value == String {
    init(_ source: Binding<String?>, replacingNilWith fallback: String) {
        self.init(
            get: { source.wrappedValue ?? fallback },
            set: { source.wrappedValue = $0.isEmpty ? nil : $0 }
        )
    }
}
