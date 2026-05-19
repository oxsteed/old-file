import SwiftUI

struct WorkflowsNativeView: View {
    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        PostJobNativeView()
                    } label: {
                        WorkflowRow(title: "Post a job", subtitle: "Create a real OxSteed job request from native fields.", systemImage: "square.and.pencil")
                    }
                    NavigationLink {
                        ProductsNativeView()
                    } label: {
                        WorkflowRow(title: "Buy products", subtitle: "Browse live marketplace products in SwiftUI.", systemImage: "bag.fill")
                    }
                    NavigationLink {
                        ToolsNativeView()
                    } label: {
                        WorkflowRow(title: "Rent tools", subtitle: "Browse tools and submit peer rental requests.", systemImage: "wrench.and.screwdriver.fill")
                    }
                    NavigationLink {
                        ConsultationNativeView()
                    } label: {
                        WorkflowRow(title: "Book consultation", subtitle: "Submit a business ascension consulting intake.", systemImage: "hammer.fill")
                    }
                } header: {
                    Text("Start")
                }

                Section {
                    NavigationLink {
                        MessagesNativeView()
                    } label: {
                        WorkflowRow(title: "Messages", subtitle: "Load your active OxSteed conversations.", systemImage: "message.fill")
                    }
                    NavigationLink {
                        CalendarNativeView()
                    } label: {
                        WorkflowRow(title: "Calendar", subtitle: "View upcoming appointments from your OxSteed account.", systemImage: "calendar")
                    }
                    NavigationLink {
                        HelpersNativeView()
                    } label: {
                        WorkflowRow(title: "Book services", subtitle: "Choose a helper or business, then continue to booking.", systemImage: "calendar.badge.plus")
                    }
                } header: {
                    Text("Manage")
                }

                Section {
                    NavigationLink {
                        BusinessHubNativeView()
                    } label: {
                        WorkflowRow(title: "Business Hub", subtitle: "Load owned and managed businesses natively.", systemImage: "building.columns.fill")
                    }
                    NavigationLink {
                        ConsultationNativeView()
                    } label: {
                        WorkflowRow(title: "Business support", subtitle: "Book consulting intake without leaving the app.", systemImage: "hammer.fill")
                    }
                } header: {
                    Text("Business")
                }
            }
            .navigationTitle("Work")
        }
    }
}

@MainActor
final class ToolsViewModel: ObservableObject {
    @Published var query = ""
    @Published var tools: [NativeToolRental] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            tools = try await OxSteedAPIClient.shared.tools(query: query)
        } catch {
            errorMessage = "Tool rentals are temporarily unavailable."
        }
        isLoading = false
    }
}

struct ToolsNativeView: View {
    @StateObject private var model = ToolsViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    TextField("Search tools", text: $model.query)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.search)
                        .onSubmit { Task { await model.load() } }
                    Button("Search") {
                        Task { await model.load() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
                }

                if model.isLoading {
                    ProgressView("Loading tools...")
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else if let error = model.errorMessage {
                    NativeEmptyState(title: "Tools paused", message: error, systemImage: "wrench.and.screwdriver.fill")
                } else {
                    ForEach(model.tools) { tool in
                        NavigationLink {
                            ToolDetailNativeView(toolId: tool.id.value, fallback: tool)
                        } label: {
                            ToolCard(tool: tool)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(20)
        }
        .background(AppTheme.background)
        .navigationTitle("Tool Rentals")
        .task {
            if model.tools.isEmpty { await model.load() }
        }
    }
}

private struct ToolCard: View {
    let tool: NativeToolRental

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Image(systemName: "wrench.and.screwdriver.fill")
                    .font(.title)
                    .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 4) {
                    Text(tool.name)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text([tool.category, tool.condition].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(toolRate(tool))
                    .font(.caption.bold())
                    .foregroundStyle(.orange)
            }
            Text(tool.description?.nilIfBlank ?? "Peer tool rental available through OxSteed.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Text([tool.locationCity, tool.locationState].compactMap { $0?.nilIfBlank }.joined(separator: ", "))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func toolRate(_ tool: NativeToolRental) -> String {
        if let value = tool.dailyRate?.value, value > 0 { return String(format: "$%.0f/day", value) }
        if let value = tool.hourlyRate?.value, value > 0 { return String(format: "$%.0f/hr", value) }
        return "Ask"
    }
}

struct ToolDetailNativeView: View {
    let toolId: String
    let fallback: NativeToolRental
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var router: OxSteedRouter
    @State private var tool: NativeToolRental?
    @State private var startDate = ""
    @State private var endDate = ""
    @State private var agreementAccepted = false
    @State private var isLoading = false
    @State private var isSubmitting = false
    @State private var statusMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                toolHero
                rentalTerms
                requestPanel
            }
            .padding(20)
        }
        .background(AppTheme.background)
        .navigationTitle("Rent Tool")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if tool == nil { await load() }
        }
        .onAppear {
            if startDate.isEmpty {
                startDate = Self.dateString(daysFromNow: 1)
                endDate = Self.dateString(daysFromNow: 2)
            }
        }
    }

    private var current: NativeToolRental { tool ?? fallback }

    private var toolHero: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let raw = current.imageURL, let url = URL(string: raw) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 140)
                }
                .frame(maxWidth: .infinity, maxHeight: 220)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                Image(systemName: "wrench.and.screwdriver.fill")
                    .font(.system(size: 54))
                    .foregroundStyle(.orange)
            }
            Text(current.category ?? "Tool rental")
                .font(.caption.bold())
                .foregroundStyle(.orange)
            Text(current.name)
                .font(.largeTitle.bold())
            Text(current.description?.nilIfBlank ?? "This peer-owned tool can be requested for rental dates.")
                .foregroundStyle(.secondary)
            Text([current.brand, current.model, current.condition].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var rentalTerms: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Rental terms")
                .font(.headline)
            Text(rateText)
                .font(.title3.bold())
            if current.requiresDeposit == true {
                Text("Deposit may be required: \(money(current.depositAmount?.value))")
                    .foregroundStyle(.secondary)
            }
            Text(current.ownerRules?.nilIfBlank ?? "Inspect the tool before use, follow owner rules, and return it clean and working.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var requestPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Request rental")
                .font(.headline)
            TextField("Start date (YYYY-MM-DD)", text: $startDate)
                .textFieldStyle(.roundedBorder)
            TextField("End date (YYYY-MM-DD)", text: $endDate)
                .textFieldStyle(.roundedBorder)
            Toggle("I accept the peer rental acknowledgement", isOn: $agreementAccepted)
            if !session.isSignedIn {
                Text("Sign in on the Account tab to request this rental.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            PrimaryButton(title: isSubmitting ? "Requesting..." : "Request rental", systemImage: "calendar.badge.plus") {
                Task { await submit() }
            }
            .disabled(!session.isSignedIn || !agreementAccepted || isSubmitting)
            SecondaryButton(title: "Full listing fallback", systemImage: "safari") {
                router.open(OxSteedRoute(id: "tool-\(toolId)", path: "/tool-rentals?openTool=\(toolId)"))
            }
            if let statusMessage {
                Text(statusMessage)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(statusMessage.contains("sent") ? .green : .secondary)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var rateText: String {
        if let value = current.dailyRate?.value, value > 0 { return String(format: "$%.2f per day", value) }
        if let value = current.hourlyRate?.value, value > 0 { return String(format: "$%.2f per hour", value) }
        return "Price by owner"
    }

    private func money(_ value: Double?) -> String {
        guard let value else { return "TBD" }
        return String(format: "$%.2f", value)
    }

    private func load() async {
        isLoading = true
        do {
            tool = try await OxSteedAPIClient.shared.toolDetail(id: toolId)
        } catch {
            statusMessage = "Full tool detail could not load. Showing browse data."
        }
        isLoading = false
    }

    private func submit() async {
        isSubmitting = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.bookTool(ToolBookingSubmission(
                toolId: toolId,
                startDate: startDate,
                endDate: endDate,
                renterAgreementAccepted: agreementAccepted
            ))
            statusMessage = "Rental request sent."
        } catch {
            statusMessage = "Could not request this rental. Check the dates and availability."
        }
        isSubmitting = false
    }

    private static func dateString(daysFromNow: Int) -> String {
        let date = Calendar.current.date(byAdding: .day, value: daysFromNow, to: Date()) ?? Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

private struct WorkflowRow: View {
    let title: String
    let subtitle: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(.orange)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}

struct PostJobNativeView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var title = ""
    @State private var description = ""
    @State private var category = "Home repair"
    @State private var city = ""
    @State private var state = ""
    @State private var budgetMin = ""
    @State private var budgetMax = ""
    @State private var urgency = "flexible"
    @State private var statusMessage: String?
    @State private var isSubmitting = false

    var body: some View {
        Form {
            Section("Job details") {
                TextField("Title", text: $title)
                TextField("Category", text: $category)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(5, reservesSpace: true)
                Picker("Urgency", selection: $urgency) {
                    Text("Flexible").tag("flexible")
                    Text("ASAP").tag("asap")
                    Text("This week").tag("this_week")
                }
            }
            Section("Location and budget") {
                TextField("City", text: $city)
                TextField("State", text: $state)
                TextField("Budget min", text: $budgetMin)
                    .keyboardType(.numberPad)
                TextField("Budget max", text: $budgetMax)
                    .keyboardType(.numberPad)
            }
            Section {
                if !session.isSignedIn {
                    Text("Sign in on the Account tab to publish this job natively.")
                        .foregroundStyle(.secondary)
                }
                Button(isSubmitting ? "Publishing..." : "Publish job") {
                    Task { await submit() }
                }
                .disabled(!session.isSignedIn || isSubmitting)
            }
            if let statusMessage {
                Section {
                    Text(statusMessage)
                }
            }
        }
        .navigationTitle("Post Job")
    }

    private func submit() async {
        isSubmitting = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.submitJob(JobSubmission(
                title: title,
                description: description,
                category_name: category,
                budget_type: "fixed",
                budget_min: Int(budgetMin),
                budget_max: Int(budgetMax),
                urgency: urgency,
                location_city: city,
                location_state: state.isEmpty ? nil : state,
                location_country: "US"
            ))
            statusMessage = "Job published successfully."
            title = ""; description = ""; city = ""; state = ""; budgetMin = ""; budgetMax = ""
        } catch {
            statusMessage = "Could not publish. Make sure the title is at least 10 characters and description is at least 50 characters."
        }
        isSubmitting = false
    }
}

@MainActor
final class ProductsViewModel: ObservableObject {
    @Published var products: [NativeProduct] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            products = try await OxSteedAPIClient.shared.products()
        } catch {
            errorMessage = "Products are temporarily unavailable."
        }
        isLoading = false
    }
}

struct ProductsNativeView: View {
    @StateObject private var model = ProductsViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if model.isLoading {
                    ProgressView("Loading products...")
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else if let error = model.errorMessage {
                    NativeEmptyState(title: "Products paused", message: error, systemImage: "bag.fill")
                } else {
                    ForEach(model.products) { product in
                        NavigationLink {
                            ProductDetailNativeView(productId: product.id.value, fallback: product)
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(product.category ?? "Marketplace")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.orange)
                                Text(product.name)
                                    .font(.headline)
                                    .foregroundStyle(.primary)
                                Text(product.description ?? "Useful products and supplies from the OxSteed marketplace.")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                                Text(price(product.priceCents))
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.primary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .background(AppTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(20)
        }
        .background(AppTheme.background)
        .navigationTitle("Products")
        .task {
            if model.products.isEmpty { await model.load() }
        }
    }

    private func price(_ cents: Int?) -> String {
        guard let cents else { return "Price available at checkout" }
        return String(format: "$%.2f", Double(cents) / 100)
    }
}

struct ProductDetailNativeView: View {
    let productId: String
    let fallback: NativeProduct
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var router: OxSteedRouter
    @State private var product: NativeProductDetail?
    @State private var quantity = 1
    @State private var isLoading = false
    @State private var isAdding = false
    @State private var statusMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if isLoading && product == nil {
                    ProgressView("Loading product...")
                        .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    productHero
                    productFacts
                    productSkills
                    cartPanel
                }

                if let statusMessage {
                    Text(statusMessage)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(statusMessage.contains("Added") ? .green : .secondary)
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(AppTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .padding(20)
        }
        .background(AppTheme.background)
        .navigationTitle("Product")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if product == nil { await load() }
        }
    }

    private var currentName: String { product?.name ?? fallback.name }
    private var currentDescription: String { product?.description?.nilIfBlank ?? fallback.description?.nilIfBlank ?? "Marketplace product details are available for OxSteed work." }

    private var productHero: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let raw = product?.productImageURL ?? fallback.productImageURL, let url = URL(string: raw) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 160)
                }
                .frame(maxWidth: .infinity, maxHeight: 220)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                Image(systemName: "bag.fill")
                    .font(.system(size: 54))
                    .foregroundStyle(.orange)
            }
            Text(product?.category ?? fallback.category ?? "Marketplace")
                .font(.caption.weight(.bold))
                .foregroundStyle(.orange)
            Text(currentName)
                .font(.largeTitle.bold())
            Text(currentDescription)
                .foregroundStyle(.secondary)
            Text(price(product?.priceCents ?? fallback.priceCents))
                .font(.title2.bold())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var productFacts: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 10)], spacing: 10) {
            ProductFact(title: "Rating", value: ratingText, systemImage: "star.fill")
            ProductFact(title: "Availability", value: product?.isAvailable == false ? "Paused" : "Available", systemImage: "checkmark.seal.fill")
            ProductFact(title: "In carts", value: "\(product?.inCartsCount ?? 0)", systemImage: "cart.fill")
            ProductFact(title: "Source", value: product?.source ?? "OxSteed", systemImage: "shippingbox.fill")
        }
    }

    private var productSkills: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Useful for")
                .font(.headline)
            let skills = product?.skills ?? []
            if skills.isEmpty {
                Text("Skill matching will appear here when this product is connected to work categories.")
                    .foregroundStyle(.secondary)
            } else {
                FlowTags(tags: skills.map(\.name))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var cartPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Cart")
                .font(.headline)
            Stepper("Quantity: \(quantity)", value: $quantity, in: 1...20)
            if !session.isSignedIn {
                Text("Sign in on the Account tab to create a cart natively.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            PrimaryButton(title: isAdding ? "Adding..." : "Add to native cart", systemImage: "cart.badge.plus") {
                Task { await addToCart() }
            }
            .disabled(!session.isSignedIn || isAdding)
            SecondaryButton(title: "Checkout fallback", systemImage: "creditcard.fill") {
                router.open(fallback.route)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var ratingText: String {
        let value = product?.avgRating?.value ?? fallback.avgRating?.value ?? 0
        return value > 0 ? String(format: "%.1f", value) : "New"
    }

    private func price(_ cents: Int?) -> String {
        guard let cents else { return "Price available at checkout" }
        return String(format: "$%.2f", Double(cents) / 100)
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            product = try await OxSteedAPIClient.shared.productDetail(id: productId)
        } catch {
            statusMessage = "Full product detail could not load. Showing browse data."
        }
        isLoading = false
    }

    private func addToCart() async {
        isAdding = true
        statusMessage = nil
        do {
            let cart = try await OxSteedAPIClient.shared.createCart(
                name: "Mobile cart - \(currentName)",
                description: "Created from the native iOS app."
            )
            _ = try await OxSteedAPIClient.shared.addProduct(productId: productId, toCart: cart.id.value, quantity: quantity)
            statusMessage = "Added to native cart."
        } catch {
            statusMessage = "Could not add this product to a cart yet."
        }
        isAdding = false
    }
}

struct ConsultationNativeView: View {
    @State private var email = ""
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var businessName = ""
    @State private var description = ""
    @State private var statusMessage: String?
    @State private var isSubmitting = false

    var body: some View {
        Form {
            Section("Contact") {
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                TextField("First name", text: $firstName)
                TextField("Last name", text: $lastName)
                TextField("Business name", text: $businessName)
            }
            Section("What do you need help with?") {
                TextField("Describe the business goal", text: $description, axis: .vertical)
                    .lineLimit(6, reservesSpace: true)
            }
            Section {
                Button(isSubmitting ? "Submitting..." : "Submit consultation request") {
                    Task { await submit() }
                }
                .disabled(isSubmitting)
            }
            if let statusMessage {
                Section {
                    Text(statusMessage)
                }
            }
        }
        .navigationTitle("Consultation")
    }

    private func submit() async {
        isSubmitting = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.submitConsultation(ConsultingSubmission(
                email: email,
                first_name: firstName,
                last_name: lastName,
                business_name: businessName.isEmpty ? nil : businessName,
                current_phase: 1,
                service_tier: "initial",
                areas_of_help: ["operational_systems", "pricing_strategy"],
                description: description,
                preferred_time_slot: "flexible"
            ))
            statusMessage = "Consultation request submitted."
            email = ""; firstName = ""; lastName = ""; businessName = ""; description = ""
        } catch {
            statusMessage = "Could not submit. Check required contact fields."
        }
        isSubmitting = false
    }
}

struct MessagesNativeView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var conversations: [ConversationItem] = []
    @State private var statusMessage: String?

    var body: some View {
        List {
            if !session.isSignedIn {
                Text("Sign in on the Account tab to load messages.")
            } else if conversations.isEmpty {
                Text(statusMessage ?? "No conversations loaded yet.")
            } else {
                ForEach(conversations) { conversation in
                    NavigationLink {
                        ConversationThreadNativeView(conversation: conversation)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(conversation.otherUserName ?? conversation.jobTitle ?? "Conversation")
                                Spacer()
                                if let unread = conversation.unreadCount, unread > 0 {
                                    Text("\(unread)")
                                        .font(.caption.bold())
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 7)
                                        .padding(.vertical, 3)
                                        .background(.orange)
                                        .clipShape(Capsule())
                                }
                            }
                            Text(conversation.lastMessage ?? "No recent message")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }
            }
        }
        .navigationTitle("Messages")
        .task {
            guard session.isSignedIn else { return }
            do { conversations = try await OxSteedAPIClient.shared.conversations() }
            catch { statusMessage = "Could not load conversations." }
        }
    }
}

struct ConversationThreadNativeView: View {
    let conversation: ConversationItem
    @State private var messages: [MessageItem] = []
    @State private var draft = ""
    @State private var isLoading = false
    @State private var isSending = false
    @State private var statusMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            List {
                if isLoading && messages.isEmpty {
                    ProgressView("Loading thread...")
                } else if messages.isEmpty {
                    Text(statusMessage ?? "No messages yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(messages) { message in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(message.senderName ?? "OxSteed user")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.orange)
                            Text(message.content)
                            if let created = message.createdAt {
                                Text(created)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }

            HStack(spacing: 10) {
                TextField("Message", text: $draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: isSending ? "hourglass" : "paperplane.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
            }
            .padding()
            .background(.bar)
        }
        .navigationTitle(conversation.otherUserName ?? conversation.jobTitle ?? "Thread")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if messages.isEmpty { await load() }
        }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            messages = try await OxSteedAPIClient.shared.conversationMessages(conversationId: conversation.id.value)
        } catch {
            statusMessage = "Could not load this message thread."
        }
        isLoading = false
    }

    private func send() async {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSending = true
        do {
            _ = try await OxSteedAPIClient.shared.sendMessage(conversationId: conversation.id.value, content: trimmed)
            draft = ""
            await load()
        } catch {
            statusMessage = "Could not send this message."
        }
        isSending = false
    }
}

struct CalendarNativeView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var appointments: [AppointmentItem] = []
    @State private var statusMessage: String?
    @State private var role = "customer"

    var body: some View {
        VStack {
            Picker("Calendar role", selection: $role) {
                Text("Customer").tag("customer")
                Text("Helper").tag("helper")
            }
            .pickerStyle(.segmented)
            .padding([.horizontal, .top])
            .onChange(of: role) {
                Task { await load() }
            }

            List {
                if !session.isSignedIn {
                    Text("Sign in on the Account tab to load calendar appointments.")
                } else if appointments.isEmpty {
                    Text(statusMessage ?? "No appointments loaded yet.")
                } else {
                    ForEach(appointments) { appointment in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(appointment.jobTitle ?? "Appointment")
                            Text([appointment.status, appointment.scheduledStartTime].compactMap { $0 }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Calendar")
        .task {
            guard session.isSignedIn else { return }
            if appointments.isEmpty { await load() }
        }
    }

    private func load() async {
        do {
            appointments = try await OxSteedAPIClient.shared.appointments(role: role)
            statusMessage = nil
        } catch {
            statusMessage = "Could not load appointments."
        }
    }
}

struct BusinessHubNativeView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var router: OxSteedRouter
    @State private var owned: [NativeBusiness] = []
    @State private var managed: [NativeBusiness] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            if !session.isSignedIn {
                Text("Sign in on the Account tab to load Business Hub natively.")
            } else if isLoading {
                ProgressView("Loading businesses...")
            } else {
                Section("Owned businesses") {
                    if owned.isEmpty {
                        Text("No owned businesses found.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(owned) { business in
                            NavigationLink {
                                BusinessWorkspaceNativeView(business: business)
                            } label: {
                                BusinessRow(business: business)
                            }
                        }
                    }
                }

                Section("Create") {
                    NavigationLink {
                        BusinessProfileEditorNativeView(mode: .create)
                    } label: {
                        WorkflowRow(title: "Add business", subtitle: "Create a Business Hub profile natively.", systemImage: "plus.circle.fill")
                    }
                }

                Section("Managed businesses") {
                    if managed.isEmpty {
                        Text("No managed businesses found.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(managed) { business in
                            NavigationLink {
                                BusinessWorkspaceNativeView(business: business)
                            } label: {
                                BusinessRow(business: business)
                            }
                        }
                    }
                }

                Section("Native tools") {
                    NavigationLink {
                        CalendarNativeView()
                    } label: {
                        WorkflowRow(title: "Calendar", subtitle: "Appointments and scheduling context.", systemImage: "calendar")
                    }
                    NavigationLink {
                        MessagesNativeView()
                    } label: {
                        WorkflowRow(title: "Messages", subtitle: "Customer and work conversations.", systemImage: "message.fill")
                    }
                    NavigationLink {
                        ProductsNativeView()
                    } label: {
                        WorkflowRow(title: "Products", subtitle: "Marketplace products and cart creation.", systemImage: "bag.fill")
                    }
                }

                Section {
                    Button {
                        router.open(.businessHub)
                    } label: {
                        WorkflowRow(title: "Full Business Hub fallback", subtitle: "Use only for tools not rebuilt natively yet.", systemImage: "safari")
                    }
                }
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Business Hub")
        .task {
            guard session.isSignedIn, owned.isEmpty && managed.isEmpty else { return }
            await load()
        }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            async let ownedBusinesses = OxSteedAPIClient.shared.businesses()
            async let managedBusinesses = OxSteedAPIClient.shared.managedBusinesses()
            owned = try await ownedBusinesses
            managed = try await managedBusinesses
        } catch {
            statusMessage = "Could not load Business Hub data."
        }
        isLoading = false
    }
}

struct BusinessWorkspaceNativeView: View {
    let business: NativeBusiness

    var body: some View {
        List {
            Section {
                BusinessRow(business: business)
            }
            Section("Native workspace") {
                NavigationLink {
                    BusinessCalendarNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Calendar", subtitle: "View upcoming appointments for this business.", systemImage: "calendar")
                }
                NavigationLink {
                    BusinessProfileEditorNativeView(mode: .edit(business))
                } label: {
                    WorkflowRow(title: "Profile studio", subtitle: "Edit public business copy, contact, and location.", systemImage: "building.2.fill")
                }
                NavigationLink {
                    BusinessServiceCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Add service", subtitle: "Create a bookable service without opening Business Hub web.", systemImage: "list.bullet.rectangle.fill")
                }
                NavigationLink {
                    BusinessInvoicesNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Invoices", subtitle: "List invoices and draft a simple invoice natively.", systemImage: "doc.text.fill")
                }
                NavigationLink {
                    BusinessRecurringBillingNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Recurring billing", subtitle: "Set up repeat charges or retainers for clients.", systemImage: "arrow.triangle.2.circlepath")
                }
                NavigationLink {
                    BusinessGoalsNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Revenue goals", subtitle: "Track monthly or quarterly growth targets.", systemImage: "target")
                }
                NavigationLink {
                    BusinessFinanceNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Finance command center", subtitle: "Review revenue, tax estimates, expenses, and schedule pressure.", systemImage: "chart.line.uptrend.xyaxis")
                }
                NavigationLink {
                    BusinessQuotesNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Quotes", subtitle: "Create estimates and send draft quotes from the app.", systemImage: "doc.badge.plus")
                }
                NavigationLink {
                    BusinessExpensesNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Expenses", subtitle: "Track business costs and category totals natively.", systemImage: "creditcard.fill")
                }
                NavigationLink {
                    BusinessLeadsNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Lead pipeline", subtitle: "Capture incoming opportunities and buying intent.", systemImage: "person.line.dotted.person.fill")
                }
                NavigationLink {
                    BusinessClientsNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Clients", subtitle: "View and add Business Hub CRM contacts.", systemImage: "person.2.fill")
                }
                NavigationLink {
                    BusinessProductsNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Business products", subtitle: "List and create products for this business.", systemImage: "shippingbox.fill")
                }
                NavigationLink {
                    BusinessPackagesNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Packages", subtitle: "Create prepaid service bundles and session packs.", systemImage: "rectangle.stack.badge.plus")
                }
                NavigationLink {
                    BusinessClientPackagesNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Client packages", subtitle: "Issue packages and redeem sessions natively.", systemImage: "checklist.checked")
                }
                NavigationLink {
                    BusinessProductPricingNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Product pricing", subtitle: "Manage native product promotions and volume rules.", systemImage: "tag.fill")
                }
                NavigationLink {
                    BusinessTeamNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Team", subtitle: "View members and invite managers or representatives.", systemImage: "person.crop.circle.badge.plus")
                }
            }
        }
        .navigationTitle("Business")
    }
}

struct BusinessFinanceNativeView: View {
    let business: NativeBusiness
    @State private var analytics: BusinessAnalyticsResponse?
    @State private var tax: BusinessTaxResponse?
    @State private var calendar: BusinessCalendarSummary?
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section("This month") {
                if isLoading {
                    ProgressView("Loading finance...")
                } else if let analytics {
                    LabeledContent("Revenue", value: money(analytics.mtd.revenue?.value))
                    LabeledContent("Expenses", value: money(analytics.mtd.expenses?.value))
                    LabeledContent("Profit", value: money(analytics.mtd.profit?.value))
                    LabeledContent("YTD profit", value: money(analytics.ytd.profit?.value))
                } else {
                    Text(statusMessage ?? "Finance data will appear here once loaded.")
                        .foregroundStyle(.secondary)
                }
            }
            if let analytics {
                Section("Receivables and work") {
                    LabeledContent("Outstanding", value: money(analytics.invoices.outstandingTotal?.value))
                    LabeledContent("Overdue", value: money(analytics.invoices.overdueTotal?.value))
                    LabeledContent("Sent invoices", value: "\(analytics.invoices.sent ?? 0)")
                    LabeledContent("Jobs completed", value: "\(analytics.jobs.completed6m ?? 0)")
                    LabeledContent("Average job value", value: money(analytics.jobs.avgValue?.value))
                }
                Section("Six month trend") {
                    ForEach(analytics.monthly) { month in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(month.month)
                                .font(.headline)
                            Text("Revenue \(money(month.revenue?.value)) - Expenses \(money(month.expenses?.value)) - Profit \(money(month.profit?.value))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Section("Calendar pressure") {
                if let calendar {
                    LabeledContent("Today", value: "\(calendar.todayCount ?? 0)")
                    LabeledContent("This week", value: "\(calendar.thisWeekCount ?? 0)")
                    LabeledContent("Next 24 hours", value: "\(calendar.next24hCount ?? 0)")
                    if let next = calendar.nextEventAt?.nilIfBlank {
                        LabeledContent("Next event", value: next)
                    }
                } else {
                    Text("No calendar summary loaded yet.")
                        .foregroundStyle(.secondary)
                }
            }
            Section("Estimated taxes") {
                if let tax {
                    if let rate = tax.taxRate?.value {
                        LabeledContent("Configured tax rate", value: "\(rate)%")
                    }
                    if tax.estimates.isEmpty {
                        Text("No estimates yet.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(tax.estimates.prefix(6)) { estimate in
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Q\(estimate.quarter ?? 0) \(estimate.taxYear ?? 0)")
                                    .font(.headline)
                                Text("Estimated tax \(money(estimate.estimatedTax?.value)) from net \(money(estimate.estimatedNetIncome?.value))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text([estimate.status, estimate.dueDate].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } else {
                    Text("Tax estimates will show after the business has finance data.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Finance")
        .task { if analytics == nil { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        async let analyticsLoad = OxSteedAPIClient.shared.businessAnalytics(businessId: business.id.value)
        async let taxLoad = OxSteedAPIClient.shared.businessTax(businessId: business.id.value)
        async let calendarLoad = OxSteedAPIClient.shared.businessCalendarSummary(businessId: business.id.value)
        do {
            analytics = try await analyticsLoad
            tax = try? await taxLoad
            calendar = try? await calendarLoad
        } catch {
            statusMessage = "Could not load finance data."
        }
        isLoading = false
    }
}

struct BusinessExpensesNativeView: View {
    let business: NativeBusiness
    @State private var expenses: [BusinessExpenseItem] = []
    @State private var summary: [BusinessExpenseSummary] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                NavigationLink {
                    BusinessExpenseCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Log expense", subtitle: "Add a deductible cost with date and category.", systemImage: "plus.circle.fill")
                }
            }
            if !summary.isEmpty {
                Section("Category totals") {
                    ForEach(summary) { item in
                        LabeledContent(item.category, value: centsMoney(item.totalCents))
                    }
                }
            }
            Section("Recent expenses") {
                if isLoading {
                    ProgressView("Loading expenses...")
                } else if expenses.isEmpty {
                    Text(statusMessage ?? "No expenses yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(expenses) { expense in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(expense.description?.nilIfBlank ?? expense.category ?? "Expense")
                                .font(.headline)
                            Text([expense.category, expense.expenseDate].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(centsMoney(expense.amountCents))
                                .font(.caption.bold())
                        }
                    }
                }
            }
        }
        .navigationTitle("Expenses")
        .task { if expenses.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            let response = try await OxSteedAPIClient.shared.businessExpenses(businessId: business.id.value)
            expenses = response.expenses
            summary = response.summary
        } catch {
            statusMessage = "Could not load expenses."
        }
        isLoading = false
    }
}

struct BusinessExpenseCreateNativeView: View {
    let business: NativeBusiness
    @State private var category = "Supplies"
    @State private var description = ""
    @State private var amount = ""
    @State private var expenseDate = ""
    @State private var notes = ""
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Expense") {
                TextField("Category", text: $category)
                TextField("Description", text: $description)
                TextField("Amount", text: $amount)
                    .keyboardType(.decimalPad)
                TextField("Date (YYYY-MM-DD)", text: $expenseDate)
                TextField("Notes", text: $notes, axis: .vertical)
                    .lineLimit(3, reservesSpace: true)
            }
            Section {
                Button(isSaving ? "Saving..." : "Save expense") {
                    Task { await create() }
                }
                .disabled(isSaving || category.trimmed.isEmpty || Double(amount) == nil || expenseDate.trimmed.isEmpty)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Log Expense")
    }

    private func create() async {
        guard let value = Double(amount) else {
            statusMessage = "Enter a valid amount."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessExpense(
                businessId: business.id.value,
                payload: BusinessExpenseSubmission(
                    category: category.trimmed,
                    description: description.trimmed.nilIfBlank,
                    amount_cents: Int((value * 100).rounded()),
                    expense_date: expenseDate.trimmed,
                    receipt_url: nil,
                    notes: notes.trimmed.nilIfBlank
                )
            )
            statusMessage = "Expense saved."
            description = ""; amount = ""; notes = ""
        } catch {
            statusMessage = "Could not save this expense."
        }
        isSaving = false
    }
}

struct BusinessQuotesNativeView: View {
    let business: NativeBusiness
    @State private var quotes: [BusinessQuoteItem] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                NavigationLink {
                    BusinessQuoteCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Create quote", subtitle: "Draft an estimate with a single line item.", systemImage: "plus.circle.fill")
                }
            }
            Section("Recent quotes") {
                if isLoading {
                    ProgressView("Loading quotes...")
                } else if quotes.isEmpty {
                    Text(statusMessage ?? "No quotes yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(quotes) { quote in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(quote.title?.nilIfBlank ?? "Quote")
                                .font(.headline)
                            Text([quote.clientName, quote.status, quote.validUntil].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            HStack {
                                Text(centsMoney(quote.totalCents))
                                    .font(.caption.bold())
                                Spacer()
                                if quote.status == "draft" {
                                    Button("Send") {
                                        Task { await send(quote) }
                                    }
                                    .font(.caption)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Quotes")
        .task { if quotes.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            quotes = try await OxSteedAPIClient.shared.businessQuotes(businessId: business.id.value).quotes
        } catch {
            statusMessage = "Could not load quotes."
        }
        isLoading = false
    }

    private func send(_ quote: BusinessQuoteItem) async {
        do {
            _ = try await OxSteedAPIClient.shared.sendBusinessQuote(businessId: business.id.value, quoteId: quote.id.value)
            await load()
        } catch {
            statusMessage = "Could not send this quote."
        }
    }
}

struct BusinessQuoteCreateNativeView: View {
    let business: NativeBusiness
    @State private var clientName = ""
    @State private var clientEmail = ""
    @State private var title = ""
    @State private var itemDescription = ""
    @State private var quantity = "1"
    @State private var unitPrice = ""
    @State private var taxRate = "0"
    @State private var validUntil = ""
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Client") {
                TextField("Client name", text: $clientName)
                TextField("Client email", text: $clientEmail)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
            }
            Section("Estimate") {
                TextField("Title", text: $title)
                TextField("Line item", text: $itemDescription)
                TextField("Quantity", text: $quantity)
                    .keyboardType(.decimalPad)
                TextField("Unit price", text: $unitPrice)
                    .keyboardType(.decimalPad)
                TextField("Tax rate percent", text: $taxRate)
                    .keyboardType(.decimalPad)
                TextField("Valid until (YYYY-MM-DD)", text: $validUntil)
            }
            Section {
                Button(isSaving ? "Creating..." : "Create quote") {
                    Task { await create() }
                }
                .disabled(isSaving || clientName.trimmed.isEmpty || title.trimmed.isEmpty || itemDescription.trimmed.isEmpty || Double(unitPrice) == nil)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Create Quote")
    }

    private func create() async {
        guard let qty = Double(quantity), let price = Double(unitPrice) else {
            statusMessage = "Enter a valid quantity and price."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessQuote(
                businessId: business.id.value,
                payload: BusinessQuoteSubmission(
                    client_name: clientName.trimmed,
                    client_email: clientEmail.trimmed.nilIfBlank,
                    title: title.trimmed,
                    line_items: [BusinessQuoteLineItem(description: itemDescription.trimmed, quantity: qty, unit_price_cents: Int((price * 100).rounded()))],
                    tax_rate: Double(taxRate) ?? 0,
                    valid_until: validUntil.trimmed.nilIfBlank
                )
            )
            statusMessage = "Quote created."
        } catch {
            statusMessage = "Could not create this quote."
        }
        isSaving = false
    }
}

struct BusinessLeadsNativeView: View {
    let business: NativeBusiness
    @State private var leads: [BusinessLeadItem] = []
    @State private var summary: [BusinessLeadSummary] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                NavigationLink {
                    BusinessLeadCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Capture lead", subtitle: "Add an incoming opportunity from a call, DM, or referral.", systemImage: "plus.circle.fill")
                }
            }
            if !summary.isEmpty {
                Section("Pipeline") {
                    ForEach(summary) { item in
                        LabeledContent(item.status.capitalized, value: item.count?.value ?? "0")
                    }
                }
            }
            Section("Leads") {
                if isLoading {
                    ProgressView("Loading leads...")
                } else if leads.isEmpty {
                    Text(statusMessage ?? "No leads yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(leads) { lead in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(lead.name)
                                .font(.headline)
                            Text([lead.serviceInterest, lead.status, lead.source].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text([lead.email, lead.phone].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            if let budget = lead.budgetCents {
                                Text("Budget \(centsMoney(budget))")
                                    .font(.caption.bold())
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Leads")
        .task { if leads.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            let response = try await OxSteedAPIClient.shared.businessLeads(businessId: business.id.value)
            leads = response.leads
            summary = response.summary
        } catch {
            statusMessage = "Could not load leads."
        }
        isLoading = false
    }
}

struct BusinessLeadCreateNativeView: View {
    let business: NativeBusiness
    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var serviceInterest = ""
    @State private var budget = ""
    @State private var notes = ""
    @State private var source = "native_app"
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Lead") {
                TextField("Name", text: $name)
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                TextField("Phone", text: $phone)
                    .keyboardType(.phonePad)
                TextField("Service interest", text: $serviceInterest)
                TextField("Budget", text: $budget)
                    .keyboardType(.decimalPad)
                TextField("Source", text: $source)
                TextField("Notes", text: $notes, axis: .vertical)
                    .lineLimit(4, reservesSpace: true)
            }
            Section {
                Button(isSaving ? "Saving..." : "Save lead") {
                    Task { await create() }
                }
                .disabled(isSaving || name.trimmed.isEmpty)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Capture Lead")
    }

    private func create() async {
        isSaving = true
        statusMessage = nil
        let cents = Double(budget).map { Int(($0 * 100).rounded()) }
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessLead(
                businessId: business.id.value,
                payload: BusinessLeadSubmission(
                    name: name.trimmed,
                    email: email.trimmed.nilIfBlank,
                    phone: phone.trimmed.nilIfBlank,
                    service_interest: serviceInterest.trimmed.nilIfBlank,
                    budget_cents: cents,
                    notes: notes.trimmed.nilIfBlank,
                    source: source.trimmed.nilIfBlank ?? "native_app"
                )
            )
            statusMessage = "Lead saved."
            name = ""; email = ""; phone = ""; serviceInterest = ""; budget = ""; notes = ""
        } catch {
            statusMessage = "Could not save this lead."
        }
        isSaving = false
    }
}

enum BusinessProfileEditorMode {
    case create
    case edit(NativeBusiness)
}

struct BusinessProfileEditorNativeView: View {
    let mode: BusinessProfileEditorMode
    @State private var businessName = ""
    @State private var businessType = ""
    @State private var headline = ""
    @State private var description = ""
    @State private var website = ""
    @State private var phone = ""
    @State private var street = ""
    @State private var city = ""
    @State private var state = ""
    @State private var zip = ""
    @State private var country = "US"
    @State private var radius = ""
    @State private var aiKnowledge = ""
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Identity") {
                TextField("Business name", text: $businessName)
                TextField("Business type", text: $businessType)
                TextField("Profile headline", text: $headline)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(5, reservesSpace: true)
            }
            Section("Contact") {
                TextField("Website", text: $website)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                TextField("Phone", text: $phone)
                    .keyboardType(.phonePad)
            }
            Section("Location") {
                TextField("Street", text: $street)
                TextField("City", text: $city)
                TextField("State", text: $state)
                TextField("Zip", text: $zip)
                TextField("Country", text: $country)
                TextField("Service radius miles", text: $radius)
                    .keyboardType(.decimalPad)
            }
            Section("AI profile context") {
                TextField("What should OxSteed know about this business?", text: $aiKnowledge, axis: .vertical)
                    .lineLimit(5, reservesSpace: true)
            }
            Section {
                if isLoading {
                    ProgressView("Loading profile...")
                }
                Button(isSaving ? "Saving..." : saveTitle) {
                    Task { await save() }
                }
                .disabled(isSaving || businessName.trimmed.isEmpty)
            }
            if let statusMessage {
                Section {
                    Text(statusMessage)
                }
            }
        }
        .navigationTitle(saveTitle)
        .task { await load() }
    }

    private var saveTitle: String {
        switch mode {
        case .create: return "Create Business"
        case .edit: return "Save Profile"
        }
    }

    private func load() async {
        guard case .edit(let business) = mode, businessName.isEmpty else { return }
        businessName = business.businessName
        businessType = business.businessType ?? ""
        description = business.description ?? ""
        website = business.website ?? ""
        phone = business.phone ?? ""
        city = business.addressCity ?? ""
        state = business.addressState ?? ""
        country = business.addressCountry ?? "US"
        isLoading = true
        do {
            let profile = try await OxSteedAPIClient.shared.businessProfileEdit(businessId: business.id.value)
            businessName = profile.businessName
            businessType = profile.businessType ?? ""
            headline = profile.profileHeadline ?? ""
            description = profile.description ?? ""
            website = profile.website ?? ""
            phone = profile.phone ?? ""
            street = profile.addressStreet ?? ""
            city = profile.addressCity ?? ""
            state = profile.addressState ?? ""
            zip = profile.addressZip ?? ""
            country = profile.addressCountry ?? "US"
            if let value = profile.serviceRadiusMiles?.value, value > 0 {
                radius = String(Int(value))
            }
            aiKnowledge = profile.aiKnowledge ?? ""
        } catch {
            statusMessage = "Could not load the full editor profile. Showing list data."
        }
        isLoading = false
    }

    private func save() async {
        isSaving = true
        statusMessage = nil
        let payload = BusinessProfileUpdate(
            business_name: businessName.trimmed,
            business_type: businessType.trimmed.nilIfBlank,
            description: description.trimmed.nilIfBlank,
            website: website.trimmed.nilIfBlank,
            phone: phone.trimmed.nilIfBlank,
            address_street: street.trimmed.nilIfBlank,
            address_city: city.trimmed.nilIfBlank,
            address_state: state.trimmed.nilIfBlank,
            address_zip: zip.trimmed.nilIfBlank,
            address_country: country.trimmed.nilIfBlank ?? "US",
            profile_headline: headline.trimmed.nilIfBlank,
            service_radius_miles: Double(radius),
            ai_knowledge: aiKnowledge.trimmed.nilIfBlank
        )
        do {
            switch mode {
            case .create:
                _ = try await OxSteedAPIClient.shared.createBusiness(payload)
                statusMessage = "Business created."
            case .edit(let business):
                _ = try await OxSteedAPIClient.shared.updateBusiness(id: business.id.value, payload: payload)
                statusMessage = "Business profile saved."
            }
        } catch {
            statusMessage = "Could not save this business profile."
        }
        isSaving = false
    }
}

struct BusinessServiceCreateNativeView: View {
    let business: NativeBusiness
    @State private var name = ""
    @State private var category = "General"
    @State private var description = ""
    @State private var price = ""
    @State private var priceUnit = "flat"
    @State private var duration = ""
    @State private var popular = false
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Service") {
                TextField("Name", text: $name)
                TextField("Category", text: $category)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(4, reservesSpace: true)
                TextField("Price", text: $price)
                    .keyboardType(.decimalPad)
                Picker("Price unit", selection: $priceUnit) {
                    Text("Flat").tag("flat")
                    Text("Hourly").tag("hourly")
                    Text("Starting at").tag("starting_at")
                }
                TextField("Duration", text: $duration)
                Toggle("Mark as popular", isOn: $popular)
            }
            Section {
                Button(isSaving ? "Creating..." : "Create service") {
                    Task { await create() }
                }
                .disabled(isSaving || name.trimmed.isEmpty || Double(price) == nil)
            }
            if let statusMessage {
                Section {
                    Text(statusMessage)
                }
            }
        }
        .navigationTitle("Add Service")
    }

    private func create() async {
        guard let amount = Double(price) else {
            statusMessage = "Enter a valid service price."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessService(
                businessId: business.id.value,
                payload: BusinessServiceSubmission(
                    name: name.trimmed,
                    description: description.trimmed.nilIfBlank,
                    price: amount,
                    price_unit: priceUnit,
                    duration: duration.trimmed.nilIfBlank,
                    popular: popular,
                    category: category.trimmed.nilIfBlank ?? "General"
                )
            )
            statusMessage = "Service created."
            name = ""; description = ""; price = ""; duration = ""; popular = false
        } catch {
            statusMessage = "Could not create this service."
        }
        isSaving = false
    }
}

struct BusinessInvoicesNativeView: View {
    let business: NativeBusiness
    @State private var invoices: [BusinessInvoiceItem] = []
    @State private var summary: BusinessInvoiceSummary?
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                NavigationLink {
                    BusinessInvoiceCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Create invoice", subtitle: "Draft a simple invoice with one line item.", systemImage: "plus.circle.fill")
                }
                if let summary {
                    Text("Outstanding: \(money(summary.outstandingTotal?.value))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Section("Recent invoices") {
                if isLoading {
                    ProgressView("Loading invoices...")
                } else if invoices.isEmpty {
                    Text(statusMessage ?? "No invoices yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(invoices) { invoice in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(invoice.invoiceNumber ?? "Invoice")
                                .font(.headline)
                            Text(invoice.clientName ?? "Client")
                            Text([invoice.status, invoice.dueDate].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(money(invoice.total?.value))
                                .font(.caption.bold())
                            HStack {
                                if invoice.status == "draft" {
                                    Button("Send") {
                                        Task { await send(invoice) }
                                    }
                                    .font(.caption)
                                }
                                if invoice.status != "paid" {
                                    Button("Mark paid") {
                                        Task { await markPaid(invoice) }
                                    }
                                    .font(.caption)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Invoices")
        .task { if invoices.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            let response = try await OxSteedAPIClient.shared.businessInvoices(businessId: business.id.value)
            invoices = response.invoices
            summary = response.summary
        } catch {
            statusMessage = "Could not load invoices."
        }
        isLoading = false
    }

    private func send(_ invoice: BusinessInvoiceItem) async {
        do {
            _ = try await OxSteedAPIClient.shared.sendBusinessInvoice(businessId: business.id.value, invoiceId: invoice.id.value)
            await load()
        } catch {
            statusMessage = "Could not send this invoice."
        }
    }

    private func markPaid(_ invoice: BusinessInvoiceItem) async {
        do {
            _ = try await OxSteedAPIClient.shared.markBusinessInvoicePaid(businessId: business.id.value, invoiceId: invoice.id.value, amount: invoice.total?.value)
            await load()
        } catch {
            statusMessage = "Could not mark this invoice paid."
        }
    }
}

struct BusinessRecurringBillingNativeView: View {
    let business: NativeBusiness
    @State private var plans: [BusinessRecurringBillingItem] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                NavigationLink {
                    BusinessRecurringBillingCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Add recurring plan", subtitle: "Create a monthly, weekly, or yearly billing record.", systemImage: "plus.circle.fill")
                }
            }
            Section("Plans") {
                if isLoading {
                    ProgressView("Loading recurring billing...")
                } else if plans.isEmpty {
                    Text(statusMessage ?? "No recurring billing plans yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(plans) { plan in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(plan.description?.nilIfBlank ?? "Recurring billing")
                                .font(.headline)
                            Text([plan.clientName, plan.clientEmail].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text([plan.frequency, plan.status, plan.nextBillingDate].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(centsMoney(plan.amountCents))
                                .font(.caption.bold())
                        }
                    }
                }
            }
        }
        .navigationTitle("Recurring")
        .task { if plans.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            plans = try await OxSteedAPIClient.shared.businessRecurringBilling(businessId: business.id.value)
        } catch {
            statusMessage = "Could not load recurring billing."
        }
        isLoading = false
    }
}

struct BusinessRecurringBillingCreateNativeView: View {
    let business: NativeBusiness
    @State private var description = ""
    @State private var amount = ""
    @State private var frequency = "monthly"
    @State private var startDate = ""
    @State private var customerId = ""
    @State private var notes = ""
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Plan") {
                TextField("Description", text: $description)
                TextField("Amount", text: $amount)
                    .keyboardType(.decimalPad)
                Picker("Frequency", selection: $frequency) {
                    Text("Weekly").tag("weekly")
                    Text("Monthly").tag("monthly")
                    Text("Quarterly").tag("quarterly")
                    Text("Yearly").tag("yearly")
                }
                TextField("Start date (YYYY-MM-DD)", text: $startDate)
                TextField("Customer ID (optional)", text: $customerId)
                TextField("Notes", text: $notes, axis: .vertical)
                    .lineLimit(3, reservesSpace: true)
            }
            Section {
                Button(isSaving ? "Creating..." : "Create recurring plan") {
                    Task { await create() }
                }
                .disabled(isSaving || Double(amount) == nil || startDate.trimmed.isEmpty)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Add Recurring")
    }

    private func create() async {
        guard let value = Double(amount) else {
            statusMessage = "Enter a valid amount."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessRecurringBilling(
                businessId: business.id.value,
                payload: BusinessRecurringBillingSubmission(
                    customer_id: customerId.trimmed.nilIfBlank,
                    description: description.trimmed.nilIfBlank,
                    amount_cents: Int((value * 100).rounded()),
                    frequency: frequency,
                    start_date: startDate.trimmed,
                    notes: notes.trimmed.nilIfBlank
                )
            )
            statusMessage = "Recurring plan created."
            description = ""; amount = ""; startDate = ""; customerId = ""; notes = ""
        } catch {
            statusMessage = "Could not create this recurring plan."
        }
        isSaving = false
    }
}

struct BusinessGoalsNativeView: View {
    let business: NativeBusiness
    @State private var goals: [BusinessGoalItem] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                NavigationLink {
                    BusinessGoalCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Add goal", subtitle: "Create a revenue, profit, jobs, or client target.", systemImage: "plus.circle.fill")
                }
            }
            Section("Goals") {
                if isLoading {
                    ProgressView("Loading goals...")
                } else if goals.isEmpty {
                    Text(statusMessage ?? "No goals yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(goals) { goal in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(goal.title)
                                .font(.headline)
                            Text([goal.goalType, goal.period, goal.periodEnd].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("\(money(goal.currentValue?.value)) of \(money(goal.targetValue?.value))")
                                .font(.caption.bold())
                            if goal.isCompleted == true {
                                Text("Completed")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.green)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Goals")
        .task { if goals.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            goals = try await OxSteedAPIClient.shared.businessGoals(businessId: business.id.value)
        } catch {
            statusMessage = "Could not load goals."
        }
        isLoading = false
    }
}

struct BusinessGoalCreateNativeView: View {
    let business: NativeBusiness
    @State private var title = ""
    @State private var goalType = "revenue"
    @State private var period = "monthly"
    @State private var targetValue = ""
    @State private var periodStart = ""
    @State private var periodEnd = ""
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Goal") {
                TextField("Title", text: $title)
                Picker("Type", selection: $goalType) {
                    Text("Revenue").tag("revenue")
                    Text("Profit").tag("profit")
                    Text("Jobs").tag("jobs")
                    Text("Clients").tag("clients")
                }
                Picker("Period", selection: $period) {
                    Text("Monthly").tag("monthly")
                    Text("Quarterly").tag("quarterly")
                    Text("Yearly").tag("yearly")
                }
                TextField("Target value", text: $targetValue)
                    .keyboardType(.decimalPad)
                TextField("Start date (YYYY-MM-DD)", text: $periodStart)
                TextField("End date (YYYY-MM-DD)", text: $periodEnd)
            }
            Section {
                Button(isSaving ? "Creating..." : "Create goal") {
                    Task { await create() }
                }
                .disabled(isSaving || title.trimmed.isEmpty || Double(targetValue) == nil)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Add Goal")
    }

    private func create() async {
        guard let target = Double(targetValue) else {
            statusMessage = "Enter a valid target."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessGoal(
                businessId: business.id.value,
                payload: BusinessGoalSubmission(
                    title: title.trimmed,
                    goal_type: goalType,
                    period: period,
                    target_value: target,
                    period_start: periodStart.trimmed.nilIfBlank,
                    period_end: periodEnd.trimmed.nilIfBlank
                )
            )
            statusMessage = "Goal created."
            title = ""; targetValue = ""; periodStart = ""; periodEnd = ""
        } catch {
            statusMessage = "Could not create this goal."
        }
        isSaving = false
    }
}

struct BusinessInvoiceCreateNativeView: View {
    let business: NativeBusiness
    @State private var clientName = ""
    @State private var clientEmail = ""
    @State private var itemDescription = ""
    @State private var quantity = "1"
    @State private var unitPrice = ""
    @State private var dueDate = ""
    @State private var taxRate = "0"
    @State private var notes = ""
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Client") {
                TextField("Client name", text: $clientName)
                TextField("Client email", text: $clientEmail)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                TextField("Due date (YYYY-MM-DD)", text: $dueDate)
            }
            Section("Line item") {
                TextField("Description", text: $itemDescription)
                TextField("Quantity", text: $quantity)
                    .keyboardType(.decimalPad)
                TextField("Unit price", text: $unitPrice)
                    .keyboardType(.decimalPad)
                TextField("Tax rate percent", text: $taxRate)
                    .keyboardType(.decimalPad)
                TextField("Notes", text: $notes, axis: .vertical)
                    .lineLimit(3, reservesSpace: true)
            }
            Section {
                Button(isSaving ? "Creating..." : "Create draft invoice") {
                    Task { await create() }
                }
                .disabled(isSaving || clientName.trimmed.isEmpty || itemDescription.trimmed.isEmpty || Double(unitPrice) == nil)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Create Invoice")
    }

    private func create() async {
        guard let qty = Double(quantity), let price = Double(unitPrice) else {
            statusMessage = "Enter a valid quantity and price."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessInvoice(
                businessId: business.id.value,
                payload: BusinessInvoiceSubmission(
                    client_name: clientName.trimmed,
                    client_email: clientEmail.trimmed.nilIfBlank,
                    client_company: nil,
                    due_date: dueDate.trimmed.nilIfBlank,
                    line_items: [BusinessInvoiceLineItem(description: itemDescription.trimmed, quantity: qty, unit_price: price)],
                    invoice_tax_rate: Double(taxRate) ?? 0,
                    notes: notes.trimmed.nilIfBlank,
                    status: "draft"
                )
            )
            statusMessage = "Draft invoice created."
        } catch {
            statusMessage = "Could not create this invoice."
        }
        isSaving = false
    }
}

struct BusinessClientsNativeView: View {
    let business: NativeBusiness
    @State private var clients: [BusinessClientItem] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                NavigationLink {
                    BusinessClientCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Add client", subtitle: "Create a Business Hub client record.", systemImage: "person.badge.plus")
                }
            }
            Section("Clients") {
                if isLoading {
                    ProgressView("Loading clients...")
                } else if clients.isEmpty {
                    Text(statusMessage ?? "No clients yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(clients) { client in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(client.displayName)
                                .font(.headline)
                            Text([client.email, client.phone].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text([client.status, client.city, client.state].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Clients")
        .task { if clients.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            clients = try await OxSteedAPIClient.shared.businessClients(businessId: business.id.value)
        } catch {
            statusMessage = "Could not load clients."
        }
        isLoading = false
    }
}

struct BusinessClientCreateNativeView: View {
    let business: NativeBusiness
    @State private var displayName = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var city = ""
    @State private var state = ""
    @State private var preferredContact = "email"
    @State private var notes = ""
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Client") {
                TextField("Name", text: $displayName)
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                TextField("Phone", text: $phone)
                    .keyboardType(.phonePad)
                TextField("City", text: $city)
                TextField("State", text: $state)
                Picker("Preferred contact", selection: $preferredContact) {
                    Text("Email").tag("email")
                    Text("Phone").tag("phone")
                    Text("SMS").tag("sms")
                }
                TextField("Internal notes", text: $notes, axis: .vertical)
                    .lineLimit(4, reservesSpace: true)
            }
            Section {
                Button(isSaving ? "Adding..." : "Add client") {
                    Task { await create() }
                }
                .disabled(isSaving || displayName.trimmed.isEmpty)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Add Client")
    }

    private func create() async {
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessClient(
                businessId: business.id.value,
                payload: BusinessClientSubmission(
                    display_name: displayName.trimmed,
                    email: email.trimmed.nilIfBlank,
                    phone: phone.trimmed.nilIfBlank,
                    city: city.trimmed.nilIfBlank,
                    state: state.trimmed.nilIfBlank,
                    status: "active",
                    preferred_contact: preferredContact,
                    internal_notes: notes.trimmed.nilIfBlank,
                    tags: []
                )
            )
            statusMessage = "Client added."
        } catch {
            statusMessage = "Could not add this client."
        }
        isSaving = false
    }
}

struct BusinessProductsNativeView: View {
    let business: NativeBusiness
    @State private var products: [BusinessProductItem] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                NavigationLink {
                    BusinessProductCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Add product", subtitle: "Create a business product listing.", systemImage: "plus.circle.fill")
                }
                NavigationLink {
                    BusinessLowStockNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Low stock", subtitle: "Review variants that need attention.", systemImage: "exclamationmark.triangle.fill")
                }
            }
            Section("Products") {
                if isLoading {
                    ProgressView("Loading products...")
                } else if products.isEmpty {
                    Text(statusMessage ?? "No products yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(products) { product in
                        NavigationLink {
                            BusinessProductDetailNativeView(business: business, product: product)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(product.name)
                                    .font(.headline)
                                Text([product.category, product.sku].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text([money(product.price?.value), "Stock \(product.totalStock ?? 0)"].joined(separator: " - "))
                                    .font(.caption.bold())
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Products")
        .task { if products.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            products = try await OxSteedAPIClient.shared.businessProducts(businessId: business.id.value)
        } catch {
            statusMessage = "Could not load products."
        }
        isLoading = false
    }
}

struct BusinessProductDetailNativeView: View {
    let business: NativeBusiness
    let product: BusinessProductItem
    @State private var detail: BusinessProductDetail?
    @State private var quantityChange = ""
    @State private var adjustmentReason = "Manual adjustment"
    @State private var selectedVariantId = ""
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section("Product") {
                Text(detail?.name ?? product.name)
                    .font(.headline)
                Text([detail?.category ?? product.category, detail?.sku ?? product.sku].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(money(detail?.price?.value ?? product.price?.value))
                    .font(.caption.bold())
                if let description = detail?.description?.nilIfBlank {
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                NavigationLink {
                    BusinessProductVariantCreateNativeView(business: business, product: product)
                } label: {
                    WorkflowRow(title: "Add variant", subtitle: "Create a size, option, or stock-keeping variant.", systemImage: "plus.square.on.square")
                }
                NavigationLink {
                    BusinessBulkPricingNativeView(business: business, product: product)
                } label: {
                    WorkflowRow(title: "Bulk pricing", subtitle: "Set quantity discount tiers for this product.", systemImage: "square.stack.3d.up.fill")
                }
            }
            Section("Variants") {
                if isLoading {
                    ProgressView("Loading variants...")
                } else if variants.isEmpty {
                    Text(statusMessage ?? "No variants yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(variants) { variant in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(variant.name ?? "Variant")
                                .font(.headline)
                            Text([variant.sku, "Stock \(variant.stock ?? 0)", "Reorder \(variant.reorderLevel ?? 0)"].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let adjustment = variant.priceAdjustment?.value, adjustment != 0 {
                                Text("Price adjustment \(money(adjustment))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            if !variants.isEmpty {
                Section("Adjust inventory") {
                    Picker("Variant", selection: $selectedVariantId) {
                        ForEach(variants) { variant in
                            Text(variant.name ?? variant.sku ?? "Variant").tag(variant.id.value)
                        }
                    }
                    TextField("Quantity change (+5 or -2)", text: $quantityChange)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("Reason", text: $adjustmentReason)
                    Button(isSaving ? "Saving..." : "Save inventory change") {
                        Task { await adjustInventory() }
                    }
                    .disabled(isSaving || selectedVariantId.isEmpty || Int(quantityChange) == nil)
                }
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Product")
        .task { await load() }
        .refreshable { await load() }
    }

    private var variants: [BusinessProductVariant] {
        detail?.variants ?? []
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            detail = try await OxSteedAPIClient.shared.businessProductDetail(businessId: business.id.value, productId: product.id.value)
            if selectedVariantId.isEmpty, let first = detail?.variants.first {
                selectedVariantId = first.id.value
            }
        } catch {
            statusMessage = "Could not load product details."
        }
        isLoading = false
    }

    private func adjustInventory() async {
        guard let change = Int(quantityChange) else {
            statusMessage = "Enter a valid quantity change."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.adjustBusinessProductInventory(
                businessId: business.id.value,
                productId: product.id.value,
                variantId: selectedVariantId,
                payload: BusinessInventoryAdjustmentSubmission(quantityChange: change, reason: adjustmentReason.trimmed)
            )
            quantityChange = ""
            statusMessage = "Inventory updated."
            await load()
        } catch {
            statusMessage = "Could not update inventory."
        }
        isSaving = false
    }
}

struct BusinessProductVariantCreateNativeView: View {
    let business: NativeBusiness
    let product: BusinessProductItem
    @State private var name = ""
    @State private var sku = ""
    @State private var priceAdjustment = "0"
    @State private var stock = "0"
    @State private var reorderLevel = "10"
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Variant") {
                TextField("Variant name", text: $name)
                TextField("SKU", text: $sku)
                    .textInputAutocapitalization(.characters)
                TextField("Price adjustment", text: $priceAdjustment)
                    .keyboardType(.decimalPad)
                TextField("Starting stock", text: $stock)
                    .keyboardType(.numberPad)
                TextField("Reorder level", text: $reorderLevel)
                    .keyboardType(.numberPad)
            }
            Section {
                Button(isSaving ? "Creating..." : "Create variant") {
                    Task { await create() }
                }
                .disabled(isSaving || name.trimmed.isEmpty || sku.trimmed.isEmpty || Double(priceAdjustment) == nil || Int(stock) == nil || Int(reorderLevel) == nil)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Add Variant")
    }

    private func create() async {
        guard let adjustment = Double(priceAdjustment), let startingStock = Int(stock), let reorder = Int(reorderLevel) else {
            statusMessage = "Enter valid stock and pricing values."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessProductVariant(
                businessId: business.id.value,
                productId: product.id.value,
                payload: BusinessProductVariantSubmission(
                    variantName: name.trimmed,
                    sku: sku.trimmed,
                    priceAdjustment: adjustment,
                    stock: startingStock,
                    reorderLevel: reorder
                )
            )
            statusMessage = "Variant created."
        } catch {
            statusMessage = "Could not create this variant."
        }
        isSaving = false
    }
}

struct BusinessLowStockNativeView: View {
    let business: NativeBusiness
    @State private var alerts: [BusinessLowStockItem] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section("Alerts") {
                if isLoading {
                    ProgressView("Loading low-stock alerts...")
                } else if alerts.isEmpty {
                    Text(statusMessage ?? "No low-stock variants right now.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(alerts) { alert in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(alert.productName)
                                .font(.headline)
                            Text([alert.variantName, alert.sku, alert.category].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("Stock \(alert.currentStock) - Reorder at \(alert.reorderLevel)")
                                .font(.caption.bold())
                                .foregroundStyle(.orange)
                        }
                    }
                }
            }
        }
        .navigationTitle("Low Stock")
        .task { if alerts.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            alerts = try await OxSteedAPIClient.shared.businessLowStockAlerts(businessId: business.id.value)
        } catch {
            statusMessage = "Could not load low-stock alerts."
        }
        isLoading = false
    }
}

struct BusinessBulkPricingNativeView: View {
    let business: NativeBusiness
    let product: BusinessProductItem
    @State private var tiers: [BusinessBulkPricingTier] = []
    @State private var minQuantityOne = "5"
    @State private var discountOne = "10"
    @State private var minQuantityTwo = "10"
    @State private var discountTwo = "15"
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Current tiers") {
                if isLoading {
                    ProgressView("Loading tiers...")
                } else if tiers.isEmpty {
                    Text(statusMessage ?? "No bulk pricing tiers yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(tiers) { tier in
                        Text("\(tier.minQuantity)+ units - \(String(format: "%.1f", tier.discountPercent))% off")
                    }
                }
            }
            Section("Replace tiers") {
                TextField("First minimum quantity", text: $minQuantityOne)
                    .keyboardType(.numberPad)
                TextField("First discount percent", text: $discountOne)
                    .keyboardType(.decimalPad)
                TextField("Second minimum quantity", text: $minQuantityTwo)
                    .keyboardType(.numberPad)
                TextField("Second discount percent", text: $discountTwo)
                    .keyboardType(.decimalPad)
                Button(isSaving ? "Saving..." : "Save tiers") {
                    Task { await save() }
                }
                .disabled(isSaving || parsedTiers.isEmpty)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Bulk Pricing")
        .task { if tiers.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private var parsedTiers: [BusinessBulkPricingTier] {
        [
            (Int(minQuantityOne), Double(discountOne)),
            (Int(minQuantityTwo), Double(discountTwo))
        ]
        .compactMap { quantity, discount in
            guard let quantity, let discount, quantity > 0, discount > 0 else { return nil }
            return BusinessBulkPricingTier(minQuantity: quantity, discountPercent: discount)
        }
        .sorted { $0.minQuantity < $1.minQuantity }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            tiers = try await OxSteedAPIClient.shared.businessBulkPricingTiers(businessId: business.id.value, productId: product.id.value)
            if let first = tiers.first {
                minQuantityOne = "\(first.minQuantity)"
                discountOne = String(format: "%.1f", first.discountPercent)
            }
            if tiers.count > 1 {
                minQuantityTwo = "\(tiers[1].minQuantity)"
                discountTwo = String(format: "%.1f", tiers[1].discountPercent)
            }
        } catch {
            statusMessage = "Could not load bulk pricing tiers."
        }
        isLoading = false
    }

    private func save() async {
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.setBusinessBulkPricingTiers(businessId: business.id.value, productId: product.id.value, tiers: parsedTiers)
            statusMessage = "Bulk pricing tiers saved."
            await load()
        } catch {
            statusMessage = "Could not save bulk pricing tiers."
        }
        isSaving = false
    }
}

struct BusinessProductCreateNativeView: View {
    let business: NativeBusiness
    @State private var name = ""
    @State private var category = "General"
    @State private var description = ""
    @State private var price = ""
    @State private var cost = ""
    @State private var sku = ""
    @State private var isActive = true
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Product") {
                TextField("Name", text: $name)
                TextField("Category", text: $category)
                TextField("SKU", text: $sku)
                    .textInputAutocapitalization(.characters)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(4, reservesSpace: true)
                TextField("Price", text: $price)
                    .keyboardType(.decimalPad)
                TextField("Cost (optional)", text: $cost)
                    .keyboardType(.decimalPad)
                Toggle("Active listing", isOn: $isActive)
            }
            Section {
                Button(isSaving ? "Creating..." : "Create product") {
                    Task { await create() }
                }
                .disabled(isSaving || name.trimmed.isEmpty || category.trimmed.isEmpty || sku.trimmed.isEmpty || Double(price) == nil)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Add Product")
    }

    private func create() async {
        guard let amount = Double(price) else {
            statusMessage = "Enter a valid product price."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessProduct(
                businessId: business.id.value,
                payload: BusinessProductSubmission(
                    name: name.trimmed,
                    description: description.trimmed.nilIfBlank,
                    category: category.trimmed,
                    price: amount,
                    cost: Double(cost),
                    sku: sku.trimmed,
                    isActive: isActive
                )
            )
            statusMessage = "Product created."
        } catch {
            statusMessage = "Could not create this product. SKU must be unique."
        }
        isSaving = false
    }
}

struct BusinessPackagesNativeView: View {
    let business: NativeBusiness
    @State private var packages: [BusinessServicePackage] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                NavigationLink {
                    BusinessPackageCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Add package", subtitle: "Create a prepaid service bundle.", systemImage: "plus.circle.fill")
                }
            }
            Section("Packages") {
                if isLoading {
                    ProgressView("Loading packages...")
                } else if packages.isEmpty {
                    Text(statusMessage ?? "No packages yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(packages) { package in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(package.name)
                                .font(.headline)
                            Text(package.description ?? "Service package")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text([packageMoney(package.priceCents), "\(package.totalSessions ?? 1) session(s)", validityText(package.validityDays)].compactMap { $0.nilIfBlank }.joined(separator: " - "))
                                .font(.caption.bold())
                        }
                    }
                }
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Packages")
        .task { if packages.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            packages = try await OxSteedAPIClient.shared.businessServicePackages(businessId: business.id.value)
        } catch {
            statusMessage = "Could not load packages."
        }
        isLoading = false
    }

    private func packageMoney(_ cents: Int?) -> String {
        guard let cents else { return "TBD" }
        return money(Double(cents) / 100)
    }

    private func validityText(_ days: Int?) -> String {
        guard let days, days > 0 else { return "No expiry" }
        return "\(days) days"
    }
}

struct BusinessPackageCreateNativeView: View {
    let business: NativeBusiness
    @State private var name = ""
    @State private var description = ""
    @State private var price = ""
    @State private var totalSessions = "1"
    @State private var validityDays = ""
    @State private var sortOrder = "0"
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Package") {
                TextField("Package name", text: $name)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(4, reservesSpace: true)
                TextField("Price", text: $price)
                    .keyboardType(.decimalPad)
                TextField("Total sessions", text: $totalSessions)
                    .keyboardType(.numberPad)
                TextField("Validity days (optional)", text: $validityDays)
                    .keyboardType(.numberPad)
                TextField("Sort order", text: $sortOrder)
                    .keyboardType(.numberPad)
            }
            Section {
                Button(isSaving ? "Creating..." : "Create package") {
                    Task { await create() }
                }
                .disabled(isSaving || name.trimmed.isEmpty || Double(price) == nil || Int(totalSessions) == nil)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Add Package")
    }

    private func create() async {
        guard let amount = Double(price), let sessions = Int(totalSessions) else {
            statusMessage = "Enter a valid package price and session count."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessServicePackage(
                businessId: business.id.value,
                payload: BusinessServicePackageSubmission(
                    name: name.trimmed,
                    description: description.trimmed.nilIfBlank,
                    services: [],
                    total_sessions: sessions,
                    price_cents: Int((amount * 100).rounded()),
                    validity_days: Int(validityDays),
                    sort_order: Int(sortOrder) ?? 0
                )
            )
            statusMessage = "Package created."
        } catch {
            statusMessage = "Could not create this package."
        }
        isSaving = false
    }
}

struct BusinessClientPackagesNativeView: View {
    let business: NativeBusiness
    @State private var clientPackages: [BusinessClientPackage] = []
    @State private var clients: [BusinessClientItem] = []
    @State private var packages: [BusinessServicePackage] = []
    @State private var selectedCustomerId = ""
    @State private var selectedPackageId = ""
    @State private var paidAmount = ""
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var redeemingId: String?
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section("Issue package") {
                if linkedClients.isEmpty {
                    Text("Add or link a client to an OxSteed customer account before issuing a package.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Picker("Client", selection: $selectedCustomerId) {
                        ForEach(linkedClients) { client in
                            Text(client.displayName).tag(client.customerId?.value ?? "")
                        }
                    }
                }
                if packages.isEmpty {
                    Text("Create a package first.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Picker("Package", selection: $selectedPackageId) {
                        ForEach(packages) { package in
                            Text(package.name).tag(package.id.value)
                        }
                    }
                }
                TextField("Paid amount (optional)", text: $paidAmount)
                    .keyboardType(.decimalPad)
                Button(isSaving ? "Issuing..." : "Issue package") {
                    Task { await issue() }
                }
                .disabled(isSaving || selectedCustomerId.isEmpty || selectedPackageId.isEmpty)
            }
            Section("Active client packages") {
                if isLoading {
                    ProgressView("Loading client packages...")
                } else if clientPackages.isEmpty {
                    Text(statusMessage ?? "No client packages yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(clientPackages) { package in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(package.packageName ?? "Client package")
                                .font(.headline)
                            Text(package.customerName ?? "Customer")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text([package.status, sessionText(package), paidText(package.paidCents)].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption.bold())
                            Button(redeemingId == package.id.value ? "Redeeming..." : "Redeem session") {
                                Task { await redeem(package) }
                            }
                            .disabled(redeemingId != nil || (package.sessionsRemaining ?? 0) <= 0 || package.status != "active")
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Client Packages")
        .task { if clientPackages.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private var linkedClients: [BusinessClientItem] {
        clients.filter { $0.customerId?.value.nilIfBlank != nil }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            async let loadedClientPackages = OxSteedAPIClient.shared.businessClientPackages(businessId: business.id.value)
            async let loadedClients = OxSteedAPIClient.shared.businessClients(businessId: business.id.value)
            async let loadedPackages = OxSteedAPIClient.shared.businessServicePackages(businessId: business.id.value)
            clientPackages = try await loadedClientPackages
            clients = try await loadedClients
            packages = try await loadedPackages
            if selectedCustomerId.isEmpty {
                selectedCustomerId = linkedClients.first?.customerId?.value ?? ""
            }
            if selectedPackageId.isEmpty {
                selectedPackageId = packages.first?.id.value ?? ""
            }
        } catch {
            statusMessage = "Could not load client package data."
        }
        isLoading = false
    }

    private func issue() async {
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.issueBusinessClientPackage(
                businessId: business.id.value,
                payload: BusinessClientPackageIssueSubmission(
                    customer_id: selectedCustomerId,
                    package_id: selectedPackageId,
                    paid_cents: paidCents
                )
            )
            paidAmount = ""
            statusMessage = "Package issued."
            await load()
        } catch {
            statusMessage = "Could not issue this package."
        }
        isSaving = false
    }

    private func redeem(_ package: BusinessClientPackage) async {
        redeemingId = package.id.value
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.redeemBusinessClientPackage(businessId: business.id.value, clientPackageId: package.id.value)
            statusMessage = "Session redeemed."
            await load()
        } catch {
            statusMessage = "Could not redeem this session."
        }
        redeemingId = nil
    }

    private var paidCents: Int? {
        guard let amount = Double(paidAmount) else { return nil }
        return Int((amount * 100).rounded())
    }

    private func sessionText(_ package: BusinessClientPackage) -> String {
        "\(package.sessionsRemaining ?? 0) left, \(package.sessionsUsed ?? 0) used"
    }

    private func paidText(_ cents: Int?) -> String {
        guard let cents else { return "No payment recorded" }
        return money(Double(cents) / 100)
    }
}

struct BusinessProductPricingNativeView: View {
    let business: NativeBusiness
    @State private var rules: [BusinessProductPricingRule] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                NavigationLink {
                    BusinessProductPricingCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Add pricing rule", subtitle: "Create a product promotion or volume discount.", systemImage: "plus.circle.fill")
                }
            }
            Section("Rules") {
                if isLoading {
                    ProgressView("Loading pricing rules...")
                } else if rules.isEmpty {
                    Text(statusMessage ?? "No product pricing rules yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(rules) { rule in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(rule.name)
                                .font(.headline)
                            Text([rule.type, rule.appliesToType, rule.isActive == false ? "Inactive" : "Active"].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let description = rule.description?.nilIfBlank {
                                Text(description)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Product Pricing")
        .task { if rules.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            rules = try await OxSteedAPIClient.shared.businessProductPricingRules(businessId: business.id.value)
        } catch {
            statusMessage = "Could not load product pricing rules."
        }
        isLoading = false
    }
}

struct BusinessProductPricingCreateNativeView: View {
    let business: NativeBusiness
    @State private var name = ""
    @State private var description = ""
    @State private var type = "promotion"
    @State private var appliesToType = "all"
    @State private var adjustmentType = "percentage"
    @State private var adjustmentValue = ""
    @State private var minQuantity = ""
    @State private var priority = "50"
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Rule") {
                TextField("Rule name", text: $name)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(3, reservesSpace: true)
                Picker("Rule type", selection: $type) {
                    Text("Promotion").tag("promotion")
                    Text("Volume").tag("volume")
                    Text("Seasonal").tag("seasonal")
                    Text("Segment").tag("segment")
                    Text("Bundle").tag("bundle")
                }
                Picker("Applies to", selection: $appliesToType) {
                    Text("All products").tag("all")
                    Text("Product").tag("product")
                    Text("Category").tag("category")
                }
                TextField("Priority 1-100", text: $priority)
                    .keyboardType(.numberPad)
            }
            Section("Adjustment") {
                Picker("Adjustment type", selection: $adjustmentType) {
                    Text("Percent off").tag("percentage")
                    Text("Fixed amount off").tag("fixed")
                    Text("Multiplier").tag("multiplier")
                }
                TextField("Adjustment value", text: $adjustmentValue)
                    .keyboardType(.decimalPad)
                TextField("Minimum quantity (optional)", text: $minQuantity)
                    .keyboardType(.numberPad)
            }
            Section {
                Button(isSaving ? "Creating..." : "Create pricing rule") {
                    Task { await create() }
                }
                .disabled(isSaving || name.trimmed.isEmpty || Double(adjustmentValue) == nil || Int(priority) == nil)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Add Pricing Rule")
    }

    private func create() async {
        guard let value = Double(adjustmentValue), let priorityValue = Int(priority) else {
            statusMessage = "Enter a valid adjustment and priority."
            return
        }
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessProductPricingRule(
                businessId: business.id.value,
                payload: BusinessProductPricingRuleSubmission(
                    name: name.trimmed,
                    type: type,
                    description: description.trimmed.nilIfBlank,
                    priority: priorityValue,
                    appliesToType: appliesToType,
                    appliesTo: nil,
                    conditions: ProductPricingConditions(minQuantity: Int(minQuantity)),
                    adjustment: ProductPricingAdjustment(type: adjustmentType, value: value)
                )
            )
            statusMessage = "Pricing rule created."
        } catch {
            statusMessage = "Could not create this pricing rule."
        }
        isSaving = false
    }
}

struct BusinessTeamNativeView: View {
    let business: NativeBusiness
    @State private var members: [BusinessMemberItem] = []
    @State private var inviteEmail = ""
    @State private var inviteRole = "representative"
    @State private var isLoading = false
    @State private var isInviting = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section("Invite") {
                TextField("Email", text: $inviteEmail)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                Picker("Role", selection: $inviteRole) {
                    Text("Representative").tag("representative")
                    Text("Manager").tag("manager")
                }
                Button(isInviting ? "Inviting..." : "Send invite") {
                    Task { await invite() }
                }
                .disabled(isInviting || inviteEmail.trimmed.isEmpty)
            }
            Section("Members") {
                if isLoading {
                    ProgressView("Loading team...")
                } else if members.isEmpty {
                    Text(statusMessage ?? "No members yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(members) { member in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(memberName(member))
                                .font(.headline)
                            Text([member.role, member.status].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Team")
        .task { if members.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func memberName(_ member: BusinessMemberItem) -> String {
        let name = [member.firstName, member.lastName].compactMap { $0?.nilIfBlank }.joined(separator: " ")
        return name.nilIfBlank ?? member.memberEmail ?? member.inviteEmail ?? "Team member"
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            members = try await OxSteedAPIClient.shared.businessMembers(businessId: business.id.value)
        } catch {
            statusMessage = "Could not load team."
        }
        isLoading = false
    }

    private func invite() async {
        isInviting = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.inviteBusinessMember(
                businessId: business.id.value,
                payload: BusinessMemberInviteSubmission(email: inviteEmail.trimmed, role: inviteRole)
            )
            inviteEmail = ""
            statusMessage = "Invite sent."
            await load()
        } catch {
            statusMessage = "Could not send this invite. Owners can invite team members."
        }
        isInviting = false
    }
}

struct BusinessCalendarNativeView: View {
    let business: NativeBusiness
    @State private var appointments: [BusinessAppointmentItem] = []
    @State private var isLoading = false
    @State private var statusMessage: String?

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(business.businessName)
                        .font(.headline)
                    Text([business.businessType, business.activeTemplate, business.role].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                NavigationLink {
                    BusinessCalendarEventCreateNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Add internal event", subtitle: "Block time, add follow-up work, or create a staff reminder.", systemImage: "calendar.badge.plus")
                }
            }

            Section("Appointments") {
                if isLoading {
                    ProgressView("Loading appointments...")
                } else if appointments.isEmpty {
                    Text(statusMessage ?? "No business appointments loaded.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(appointments) { appointment in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(appointment.serviceName ?? "Appointment")
                                .font(.headline)
                            Text(appointment.customerName ?? "Customer")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text([appointment.status, appointment.startTime].compactMap { $0 }.joined(separator: " - "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Business Calendar")
        .task {
            if appointments.isEmpty { await load() }
        }
        .refreshable {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        statusMessage = nil
        do {
            appointments = try await OxSteedAPIClient.shared.businessAppointments(businessId: business.id.value)
        } catch {
            statusMessage = "Could not load this business calendar."
        }
        isLoading = false
    }
}

struct BusinessCalendarEventCreateNativeView: View {
    let business: NativeBusiness
    @State private var title = ""
    @State private var description = ""
    @State private var location = ""
    @State private var category = "other"
    @State private var startsAt = ""
    @State private var endsAt = ""
    @State private var allDay = false
    @State private var remindMinutes = "60"
    @State private var recurrence = "none"
    @State private var isSaving = false
    @State private var statusMessage: String?

    var body: some View {
        Form {
            Section("Event") {
                TextField("Title", text: $title)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(3, reservesSpace: true)
                TextField("Location", text: $location)
                Picker("Category", selection: $category) {
                    Text("Other").tag("other")
                    Text("Team meeting").tag("team_meeting")
                    Text("Admin").tag("admin")
                    Text("Site visit").tag("site_visit")
                    Text("Inspection").tag("inspection")
                    Text("Training").tag("training")
                    Text("Time off").tag("time_off")
                }
                Toggle("All day", isOn: $allDay)
            }
            Section("Time") {
                TextField("Starts at (ISO or date time)", text: $startsAt)
                TextField("Ends at (ISO or date time)", text: $endsAt)
                TextField("Reminder minutes", text: $remindMinutes)
                    .keyboardType(.numberPad)
                Picker("Repeat", selection: $recurrence) {
                    Text("None").tag("none")
                    Text("Daily").tag("daily")
                    Text("Weekly").tag("weekly")
                    Text("Monthly").tag("monthly")
                }
            }
            Section {
                Button(isSaving ? "Creating..." : "Create event") {
                    Task { await create() }
                }
                .disabled(isSaving || title.trimmed.isEmpty || startsAt.trimmed.isEmpty || endsAt.trimmed.isEmpty)
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("Add Event")
    }

    private func create() async {
        isSaving = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.createBusinessCalendarEvent(
                businessId: business.id.value,
                payload: BusinessCalendarEventSubmission(
                    title: title.trimmed,
                    description: description.trimmed.nilIfBlank,
                    location: location.trimmed.nilIfBlank,
                    category: category,
                    starts_at: startsAt.trimmed,
                    ends_at: endsAt.trimmed,
                    all_day: allDay,
                    status: "scheduled",
                    remind_minutes: Int(remindMinutes),
                    recurrence: recurrence
                )
            )
            statusMessage = "Event created."
            title = ""; description = ""; location = ""; startsAt = ""; endsAt = ""
        } catch {
            statusMessage = "Could not create this event. Use a full ISO date like 2026-05-19T14:00:00-04:00."
        }
        isSaving = false
    }
}

private func money(_ value: Double?) -> String {
    guard let value else { return "TBD" }
    return String(format: "$%.2f", value)
}

private func centsMoney(_ value: Int?) -> String {
    guard let value else { return "$0.00" }
    return String(format: "$%.2f", Double(value) / 100)
}

private struct BusinessRow: View {
    let business: NativeBusiness

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(business.businessName)
                    .font(.headline)
                Spacer()
                if business.isPrimary == true {
                    Text("Primary")
                        .font(.caption.bold())
                        .foregroundStyle(.orange)
                }
            }
            Text([business.businessType, business.activeTemplate, business.role].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text([business.addressCity, business.addressState, business.addressCountry].compactMap { $0?.nilIfBlank }.joined(separator: ", "))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct ProductFact: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: systemImage)
                .foregroundStyle(.orange)
            Text(value)
                .font(.headline)
                .lineLimit(2)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct FlowTags: View {
    let tags: [String]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(tags, id: \.self) { tag in
                Text(tag)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.orange.opacity(0.12))
                    .clipShape(Capsule())
            }
        }
    }
}

private extension String {
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
