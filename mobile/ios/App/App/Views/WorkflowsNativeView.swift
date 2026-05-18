import SwiftUI

struct WorkflowsNativeView: View {
    @EnvironmentObject private var router: OxSteedRouter

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
                    Button {
                        router.open(.helpers)
                    } label: {
                        WorkflowRow(title: "Book services", subtitle: "Choose a helper or business, then continue to booking.", systemImage: "calendar.badge.plus")
                    }
                } header: {
                    Text("Manage")
                }

                Section {
                    ForEach(OxSteedContent.businessWorkflows) { workflow in
                        Button {
                            router.open(workflow.route)
                        } label: {
                            WorkflowRow(title: workflow.title, subtitle: workflow.body, systemImage: workflow.symbol)
                        }
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
    @EnvironmentObject private var router: OxSteedRouter

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
                        Button {
                            router.open(product.route)
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
                    VStack(alignment: .leading, spacing: 4) {
                        Text(conversation.otherUserName ?? conversation.jobTitle ?? "Conversation")
                        Text(conversation.lastMessage ?? "No recent message")
                            .font(.caption)
                            .foregroundStyle(.secondary)
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
