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

    var body: some View {
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
        .navigationTitle("Calendar")
        .task {
            guard session.isSignedIn else { return }
            do { appointments = try await OxSteedAPIClient.shared.appointments() }
            catch { statusMessage = "Could not load appointments." }
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
                            BusinessRow(business: business)
                        }
                    }
                }

                Section("Managed businesses") {
                    if managed.isEmpty {
                        Text("No managed businesses found.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(managed) { business in
                            BusinessRow(business: business)
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
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
