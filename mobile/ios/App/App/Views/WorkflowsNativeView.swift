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
                    BusinessTeamNativeView(business: business)
                } label: {
                    WorkflowRow(title: "Team", subtitle: "View members and invite managers or representatives.", systemImage: "person.crop.circle.badge.plus")
                }
            }
        }
        .navigationTitle("Business")
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
            }
            Section("Products") {
                if isLoading {
                    ProgressView("Loading products...")
                } else if products.isEmpty {
                    Text(statusMessage ?? "No products yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(products) { product in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(product.name)
                                .font(.headline)
                            Text([product.category, product.sku].compactMap { $0?.nilIfBlank }.joined(separator: " - "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(money(product.price?.value))
                                .font(.caption.bold())
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

private func money(_ value: Double?) -> String {
    guard let value else { return "TBD" }
    return String(format: "$%.2f", value)
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
