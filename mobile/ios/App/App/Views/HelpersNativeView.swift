import SwiftUI

@MainActor
final class HelpersViewModel: ObservableObject {
    @Published var query = ""
    @Published var helpers: [NativeHelper] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            helpers = try await OxSteedAPIClient.shared.helpers(query: query)
        } catch {
            errorMessage = "Helper search is temporarily unavailable."
        }
        isLoading = false
    }
}

struct HelpersNativeView: View {
    @StateObject private var model = HelpersViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HeroHeader(
                        eyebrow: "Native helper directory",
                        title: "Compare local helpers in the app.",
                        subtitle: "OxSteed profiles carry service context, ratings, completed-work signals, verification, and booking paths."
                    )

                    HStack(spacing: 10) {
                        TextField("Search helpers", text: $model.query)
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
                        ProgressView("Loading helpers...")
                            .frame(maxWidth: .infinity, minHeight: 120)
                    } else if let error = model.errorMessage {
                        NativeEmptyState(title: "Directory paused", message: error, systemImage: "person.crop.circle.badge.exclamationmark")
                    } else {
                        VStack(spacing: 12) {
                            ForEach(model.helpers) { helper in
                                NavigationLink {
                                    HelperDetailNativeView(helperId: helper.id.value, fallback: helper)
                                } label: {
                                    HelperCard(helper: helper)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(AppTheme.background)
            .navigationTitle("Helpers")
            .task {
                if model.helpers.isEmpty {
                    await model.load()
                }
            }
        }
    }
}

private struct HelperCard: View {
    let helper: NativeHelper

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Image(systemName: "person.crop.circle.fill.badge.checkmark")
                    .font(.largeTitle)
                    .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 4) {
                    Text(helper.displayName)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text(location.isEmpty ? "Service area available on profile" : location)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(.tertiary)
            }

            Text(helper.summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.leading)
                .lineLimit(3)

            HStack(spacing: 10) {
                if let rating = helper.rating, rating > 0 {
                    Label("\(rating, specifier: "%.1f")", systemImage: "star.fill")
                }
                if let completed = helper.jobsCompleted, completed > 0 {
                    Label("\(completed) jobs", systemImage: "checkmark.circle.fill")
                }
                if helper.verified == true {
                    Label("Verified", systemImage: "shield.checkered")
                }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.orange)
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var location: String {
        [helper.city, helper.state].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: ", ")
    }
}

struct HelperDetailNativeView: View {
    let helperId: String
    let fallback: NativeHelper
    @EnvironmentObject private var router: OxSteedRouter
    @EnvironmentObject private var session: SessionStore
    @State private var profile: HelperProfileResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if isLoading && profile == nil {
                    ProgressView("Loading profile...")
                        .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    header
                    trustStrip
                    servicesSection
                    hoursSection
                    reviewsSection
                    actions
                }

                if let errorMessage {
                    NativeEmptyState(title: "Profile details paused", message: errorMessage, systemImage: "person.crop.circle.badge.exclamationmark")
                }
            }
            .padding(20)
        }
        .background(AppTheme.background)
        .navigationTitle(displayName)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if profile == nil { await load() }
        }
    }

    private var helper: HelperProfile? { profile?.helper }

    private var displayName: String {
        helper?.businessName?.nilIfBlank ?? helper?.ownerName?.nilIfBlank ?? fallback.displayName
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "person.crop.circle.fill.badge.checkmark")
                .font(.system(size: 58))
                .foregroundStyle(.orange)
            Text(displayName)
                .font(.largeTitle.bold())
            Text(helper?.tagline?.nilIfBlank ?? fallback.summary)
                .font(.headline)
                .foregroundStyle(.secondary)
            Text(helper?.bio?.nilIfBlank ?? fallback.bio?.nilIfBlank ?? "This OxSteed profile is available for local service requests.")
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var trustStrip: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 10)], spacing: 10) {
            MetricTile(title: "Rating", value: ratingText, systemImage: "star.fill")
            MetricTile(title: "Completed", value: "\(helper?.jobsCompleted ?? fallback.jobsCompleted ?? 0)", systemImage: "checkmark.circle.fill")
            MetricTile(title: "Response", value: helper?.responseTime ?? "Profile", systemImage: "clock.fill")
            MetricTile(title: "Trust", value: trustText, systemImage: "shield.checkered")
        }
    }

    private var servicesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Services", subtitle: "Native profile service menu")
            if let services = profile?.services, !services.isEmpty {
                ForEach(services) { service in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(service.name)
                                .font(.headline)
                            Spacer()
                            Text(servicePrice(service))
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.orange)
                        }
                        Text(service.description?.nilIfBlank ?? "Service details available during booking.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(14)
                    .background(AppTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            } else {
                Text("Service menu is not published yet.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var hoursSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Availability", subtitle: "Published service hours")
            ForEach(profile?.hours ?? []) { hour in
                HStack {
                    Text(hour.day)
                    Spacer()
                    Text(hour.closed == true ? "Closed" : "\(hour.open ?? "9:00 AM") - \(hour.close ?? "5:00 PM")")
                        .foregroundStyle(.secondary)
                }
                .font(.caption)
                .padding(.vertical, 2)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var reviewsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Reviews", subtitle: "Recent customer context")
            ForEach((profile?.reviews ?? []).prefix(3)) { review in
                VStack(alignment: .leading, spacing: 4) {
                    Text(review.authorName ?? "OxSteed customer")
                        .font(.subheadline.weight(.semibold))
                    Text(review.content?.nilIfBlank ?? "Verified service review.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(12)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    private var actions: some View {
        VStack(spacing: 10) {
            if session.isSignedIn {
                NavigationLink {
                    ServiceBookingRequestNativeView(helperId: helperId, defaultService: profile?.services.first?.name ?? fallback.displayName)
                } label: {
                    Label("Request service", systemImage: "calendar.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
            } else {
                Text("Sign in on the Account tab to request service natively.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            SecondaryButton(title: "Open full web profile", systemImage: "safari") {
                router.open(fallback.route)
            }
        }
    }

    private var ratingText: String {
        if let value = helper?.rating?.value, value > 0 { return String(format: "%.1f", value) }
        if let value = fallback.rating, value > 0 { return String(format: "%.1f", value) }
        return "New"
    }

    private var trustText: String {
        if helper?.hasLicense == true { return "Licensed" }
        if helper?.hasInsurance == true { return "Insured" }
        if helper?.verified == true || fallback.verified == true { return "Verified" }
        return "Profile"
    }

    private func servicePrice(_ service: HelperService) -> String {
        guard let value = service.price?.value, value > 0 else { return "Ask" }
        return String(format: "$%.0f %@", value, service.priceUnit ?? "")
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            profile = try await OxSteedAPIClient.shared.helperProfile(id: helperId)
        } catch {
            errorMessage = "Could not load the full native profile. You can still use the booking action."
        }
        isLoading = false
    }
}

struct ServiceBookingRequestNativeView: View {
    let helperId: String
    let defaultService: String
    @State private var serviceName: String
    @State private var requestedDate = ""
    @State private var startTime = "09:00"
    @State private var endTime = "10:00"
    @State private var location = ""
    @State private var description = ""
    @State private var statusMessage: String?
    @State private var isSubmitting = false

    init(helperId: String, defaultService: String) {
        self.helperId = helperId
        self.defaultService = defaultService
        _serviceName = State(initialValue: defaultService)
    }

    var body: some View {
        Form {
            Section("Service") {
                TextField("Service name", text: $serviceName)
                TextField("Date (YYYY-MM-DD)", text: $requestedDate)
                    .textContentType(.none)
                TextField("Start time (HH:MM)", text: $startTime)
                TextField("End time (HH:MM)", text: $endTime)
            }
            Section("Where and what") {
                TextField("Service location", text: $location, axis: .vertical)
                    .lineLimit(2, reservesSpace: true)
                TextField("Describe the work", text: $description, axis: .vertical)
                    .lineLimit(5, reservesSpace: true)
            }
            Section {
                Button(isSubmitting ? "Submitting..." : "Send booking request") {
                    Task { await submit() }
                }
                .disabled(isSubmitting)
                Text("This creates a real OxSteed booking request. Payment can be handled later if the helper accepts.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let statusMessage {
                Section {
                    Text(statusMessage)
                }
            }
        }
        .navigationTitle("Request Service")
        .onAppear {
            if requestedDate.isEmpty {
                requestedDate = Self.defaultDate()
            }
        }
    }

    private func submit() async {
        isSubmitting = true
        statusMessage = nil
        do {
            _ = try await OxSteedAPIClient.shared.submitBookingRequest(BookingRequestSubmission(
                helperId: helperId,
                businessId: nil,
                serviceName: serviceName,
                requestedDate: requestedDate,
                requestedStartTime: startTime,
                requestedEndTime: endTime,
                serviceLocation: location,
                description: description,
                confirmationHours: 24
            ))
            statusMessage = "Booking request sent."
            description = ""
        } catch {
            statusMessage = "Could not send booking request. Check the date, time, and work description."
        }
        isSubmitting = false
    }

    private static func defaultDate() -> String {
        let date = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

private struct MetricTile: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: systemImage)
                .foregroundStyle(.orange)
            Text(value)
                .font(.headline)
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

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
