import SwiftUI
import MapKit

struct TodayView: View {
    @Environment(OneStore.self) private var store
    @State private var newAlertQuery = ""
    @State private var cameraPosition: MapCameraPosition = .automatic
    @State private var reviewFromRole = "Customer"
    @State private var reviewToRole = "Helper"
    @State private var reviewRating = 5
    @State private var reviewComment = ""
    @State private var postTitle = ""
    @State private var postCategory = "Plumbing"
    @State private var postLocation = ""
    @State private var postAddress = ""
    @State private var postDetails = ""
    @State private var postPhotos = ""
    @State private var selectedJobID: UUID?
    @State private var bidMessageByID: [UUID: String] = [:]
    @State private var bidSort = "price_asc"
    @State private var helperSearch = ""
    @State private var helperMinRating = 4.0
    @State private var selectedHelperID: UUID?
    @State private var bookingServiceType = "General Service"
    @State private var bookingDate = Date()
    @State private var bookingSlot = ""
    @State private var bookingPaymentAuthorized = true
    @State private var bookingPreMessage = ""
    @State private var bookingReviewRating = 5
    @State private var bookingReviewComment = ""
    @State private var toolSearch = ""
    @State private var toolMaxRate = 50.0
    @State private var selectedToolID: UUID?
    @State private var toolSlot = ""
    @State private var toolPaymentAuthorized = true
    @State private var damageNotes: [UUID: String] = [:]

    var body: some View {
        GoScreen(title: "Home", showsTitle: false) {
            header

            GoCard {
                Text("Universal Search")
                    .font(.headline)
                TextField("Search jobs, helpers, tools, training, financing", text: Binding(
                    get: { store.universalSearchQuery },
                    set: { store.universalSearchQuery = $0 }
                ))
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text("Saved search alerts and map overlays are next implementation step.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }

            if !store.universalSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                GoCard {
                    Text("Search Results")
                        .font(.headline)
                    if store.globalSearchResults.isEmpty {
                        Text("No matches found across Home, Life, Growth, and Learn.")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    } else {
                        ForEach(store.globalSearchResults) { result in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(result.category) · \(result.title)")
                                    .font(.subheadline.weight(.semibold))
                                Text(result.detail)
                                    .font(.caption)
                                    .foregroundStyle(OneTheme.muted)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }
            }

            GoCard {
                Text("Discovery Views")
                    .font(.headline)
                Text("Feed, Map, and List are unified by persona-aware search context.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                HStack {
                    labelPill("Feed")
                    labelPill("Map")
                    labelPill("List")
                    labelPill("Alerts")
                }
                Text("Saved alert example: plumber under $150 in Springfield")
                    .font(.caption2)
                    .foregroundStyle(OneTheme.muted)
            }

            if store.activePersona == .customer {
                GoCard {
                    HStack {
                        Text("Customer Transactions")
                            .font(.headline)
                        Spacer()
                        Button("Sync Live Data") {
                            Task { await store.refreshCustomerTransactionData() }
                        }
                        .disabled(store.isRefreshingCustomerData)
                        .buttonStyle(.bordered)
                    }
                    if store.isRefreshingCustomerData {
                        ProgressView("Syncing...")
                            .font(.caption)
                    }
                    Text("Refreshes jobs, bids, helpers, appointments, and rentals from app.oxsteed.com.")
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                }
                customerJobPostingCard
                customerBidsCard
                customerServiceBookingCard
                customerToolRentalCard
            }

            GoCard {
                Text("Saved Search Alerts")
                    .font(.headline)
                HStack {
                    TextField("Create alert query", text: $newAlertQuery)
                        .padding(10)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Button("Add") {
                        store.addSavedAlert(newAlertQuery)
                        newAlertQuery = ""
                    }
                    .buttonStyle(GoAccentButtonStyle())
                }
                ForEach(store.savedSearchAlerts) { alert in
                    HStack {
                        Text(alert.query)
                            .font(.caption)
                        Spacer()
                        Toggle("", isOn: Binding(
                            get: { alert.enabled },
                            set: { _ in store.toggleSavedAlert(alert.id) }
                        ))
                        .labelsHidden()
                    }
                }
            }

            GoCard {
                Text("Map View")
                    .font(.headline)
                Map(position: $cameraPosition) {
                    ForEach(store.mapPoints) { point in
                        Annotation(point.title, coordinate: CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)) {
                            Circle()
                                .fill(OneTheme.amber)
                                .frame(width: 12, height: 12)
                        }
                    }
                }
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                Button("Refresh Map for Active Persona") {
                    store.refreshMapPointsForActivePersona()
                }
                .buttonStyle(.bordered)
            }

            GoCard {
                Text("Trust & Safety")
                    .font(.headline)
                ForEach(store.verificationBadges) { badge in
                    HStack {
                        Text(badge.title)
                            .font(.subheadline)
                        Spacer()
                        Text(badge.verified ? "Verified" : "Pending")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(badge.verified ? .green : OneTheme.amber)
                    }
                }
                HStack {
                    Button(store.safetyTimerRunning ? "Stop Safety Timer" : "Start Safety Timer") {
                        if store.safetyTimerRunning {
                            store.stopSafetyTimer()
                        } else {
                            store.startSafetyTimer()
                        }
                    }
                    .buttonStyle(GoAccentButtonStyle())
                    Button("SOS") {
                        store.triggerSOS()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }
                if store.sosTriggered {
                    Text("SOS triggered: location + incident log queued.")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            GoCard {
                Text("Two-Way Reviews")
                    .font(.headline)
                Picker("From", selection: $reviewFromRole) {
                    Text("Customer").tag("Customer")
                    Text("Helper").tag("Helper")
                    Text("Business Owner").tag("Business Owner")
                }
                Picker("To", selection: $reviewToRole) {
                    Text("Customer").tag("Customer")
                    Text("Helper").tag("Helper")
                    Text("Business Owner").tag("Business Owner")
                }
                Stepper("Rating: \(reviewRating)", value: $reviewRating, in: 1...5)
                TextField("Review comment", text: $reviewComment)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button("Submit Review") {
                    store.addReview(fromRole: reviewFromRole, toRole: reviewToRole, rating: reviewRating, comment: reviewComment)
                    reviewComment = ""
                    reviewRating = 5
                }
                .buttonStyle(.borderedProminent)
                ForEach(store.reviews.prefix(4)) { review in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(review.fromRole) → \(review.toRole) · \(String(repeating: "★", count: review.rating))")
                            .font(.caption.weight(.semibold))
                        Text(review.comment)
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 3)
                }
            }

            VStack(alignment: .leading, spacing: 16) {
                ForEach(store.homeSections) { section in
                    GoCard {
                        Text(section.title)
                            .font(.headline)

                        ForEach(section.cards) { card in
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: card.symbolName)
                                    .foregroundStyle(OneTheme.amber)
                                    .frame(width: 26)
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(card.title)
                                            .font(.subheadline.weight(.semibold))
                                        Spacer()
                                        Text(masked(card.value))
                                            .font(.subheadline.weight(.bold))
                                    }
                                    Text(card.detail)
                                        .font(.caption)
                                        .foregroundStyle(OneTheme.muted)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
            .id(store.homeReloadToken)
        }
        .sheet(isPresented: Binding(
            get: { store.showBusinessPicker },
            set: { store.showBusinessPicker = $0 }
        )) {
            businessPickerSheet
        }
        .onAppear {
            store.refreshMapPointsForActivePersona()
            if store.activePersona == .customer {
                Task { await store.refreshCustomerTransactionData() }
            }
        }
    }

    private func masked(_ value: String) -> String {
        guard store.appPreferences.privacyMode else { return value }
        return String(repeating: "•", count: max(4, min(value.count, 10)))
    }

    private func labelPill(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(OneTheme.amber.opacity(0.18), in: Capsule())
    }

    private var header: some View {
        GoCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center, spacing: 12) {
                    OxSteedOneMark(size: 54)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("OxSteed One")
                            .font(.title2.weight(.bold))
                        Text("Run today. Build tomorrow.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(OneTheme.muted)
                    }
                    Spacer(minLength: 8)
                }

                Text("One account. Many personas. Home updates instantly.")
                    .font(.footnote)
                    .foregroundStyle(OneTheme.muted)

                HStack(spacing: 8) {
                    statusPill("Persona: \(store.personaContext.activePersona.label)")
                    if store.personaContext.activePersona == .businessOwner {
                        statusPill("Role: \(store.personaContext.businessSubRole.label)")
                    }
                }

                HStack(spacing: 10) {
                    Button("Profile & Settings") {
                        store.selectedTab = .profile
                    }
                    .buttonStyle(GoAccentButtonStyle())
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private func statusPill(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(OneTheme.amber)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(OneTheme.amber.opacity(0.14), in: Capsule())
    }

    private var businessPickerSheet: some View {
        NavigationStack {
            List(store.availableBusinesses) { business in
                Button {
                    store.selectBusiness(business)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(business.name)
                            .font(.headline)
                        Text(business.id)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Select Business")
        }
    }

    private var customerJobPostingCard: some View {
        GoCard {
            Text("Customer Job Posting")
                .font(.headline)
            TextField("Job title", text: $postTitle)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                Picker("Category", selection: $postCategory) {
                    Text("Plumbing").tag("Plumbing")
                    Text("Electrical").tag("Electrical")
                    Text("HVAC").tag("HVAC")
                    Text("Carpentry").tag("Carpentry")
                    Text("Cleaning").tag("Cleaning")
                }
                .pickerStyle(.menu)
                TextField("Location autocomplete", text: $postLocation)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            TextField("Address", text: $postAddress)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            TextField("Describe the work", text: $postDetails, axis: .vertical)
                .lineLimit(2...4)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            TextField("Photo file names (comma separated)", text: $postPhotos)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Text("Photos preview: \(postPhotos.isEmpty ? "none" : postPhotos)")
                .font(.caption)
                .foregroundStyle(OneTheme.muted)
            HStack {
                Button("Save Draft") {
                    let photos = postPhotos.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
                    store.saveCustomerJobDraft(
                        title: postTitle,
                        category: postCategory,
                        locationQuery: postLocation,
                        address: postAddress,
                        details: postDetails,
                        photos: photos
                    )
                }
                .buttonStyle(.bordered)
                Spacer()
            }
            Button("Publish Job + Notify Helpers") {
                let photos = postPhotos.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
                Task {
                    await store.postCustomerJobServerFirst(
                        title: postTitle,
                        category: postCategory,
                        locationQuery: postLocation,
                        address: postAddress,
                        details: postDetails,
                        photos: photos
                    )
                }
                postTitle = ""
                postDetails = ""
                postPhotos = ""
                if let first = store.customerJobs.first {
                    selectedJobID = first.id
                }
            }
            .disabled(store.isSubmittingCustomerJob)
            .buttonStyle(GoAccentButtonStyle())
            if store.isSubmittingCustomerJob {
                ProgressView("Publishing job...")
                    .font(.caption)
            }
            if let message = store.customerJobFlowMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }

            if !store.customerJobs.isEmpty {
                Divider().padding(.vertical, 4)
                ForEach(store.customerJobs.prefix(3)) { job in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(job.title).font(.caption.weight(.semibold))
                            Text("\(job.category) · \(job.status.rawValue)")
                                .font(.caption2)
                                .foregroundStyle(OneTheme.muted)
                        }
                        Spacer()
                        if job.status == .draft {
                            Button("Publish") { store.publishCustomerJob(job.id) }
                                .buttonStyle(.bordered)
                        } else {
                            Button("Start") { Task { await store.startCustomerJobServerFirst(job.id) } }
                                .buttonStyle(.bordered)
                            Button("Complete") { Task { await store.completeCustomerJobServerFirst(job.id) } }
                                .buttonStyle(.bordered)
                        }
                        Button("Cancel") { Task { await store.cancelCustomerJobServerFirst(job.id) } }
                            .buttonStyle(.bordered)
                    }
                }
            }
        }
    }

    private var customerBidsCard: some View {
        GoCard {
            Text("Bids + Comparison")
                .font(.headline)
            if store.customerJobs.isEmpty {
                Text("Post a job to start receiving bids.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            } else {
                Picker("Job", selection: Binding(
                    get: { selectedJobID ?? store.customerJobs.first?.id ?? UUID() },
                    set: { selectedJobID = $0 }
                )) {
                    ForEach(store.customerJobs) { job in
                        Text("\(job.title) · \(job.status.rawValue)").tag(job.id)
                    }
                }
                .pickerStyle(.menu)
                Picker("Sort", selection: $bidSort) {
                    Text("Price Low→High").tag("price_asc")
                    Text("Price High→Low").tag("price_desc")
                    Text("Helper A→Z").tag("helper_asc")
                }
                .pickerStyle(.segmented)

                ForEach(store.sortedBids(for: selectedJobID ?? store.customerJobs[0].id, sort: bidSort)) { bid in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(bid.helperName).font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("$\(Int(bid.amount))").font(.subheadline.weight(.bold))
                        }
                        Text("\(bid.etaText) · \(bid.note)")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                        HStack {
                            if bid.accepted {
                                Text("Accepted")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.green)
                            } else {
                                Button("Accept + Create Appointment") {
                                    Task { await store.acceptBidServerFirst(bid.id) }
                                }
                                .disabled(store.bidAcceptanceInFlight.contains(bid.id))
                                .buttonStyle(.borderedProminent)
                            }
                            Button("Message") {
                                Task {
                                    await store.messageHelperForBidServerFirst(
                                        bid.id,
                                        content: bidMessageByID[bid.id] ?? "Can you confirm scope and timeline?"
                                    )
                                }
                            }
                            .buttonStyle(.bordered)
                        }
                        TextField("Message helper", text: Binding(
                            get: { bidMessageByID[bid.id] ?? "" },
                            set: { bidMessageByID[bid.id] = $0 }
                        ))
                        .padding(8)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private var customerServiceBookingCard: some View {
        GoCard {
            Text("Customer Service Booking")
                .font(.headline)
            TextField("Search helpers", text: $helperSearch)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                Text("Min rating: \(String(format: "%.1f", helperMinRating))★")
                    .font(.caption)
                Slider(value: $helperMinRating, in: 3.5...5.0, step: 0.5)
            }
            let helpers = store.filteredHelpers(query: helperSearch, minRating: helperMinRating)
            Picker("Helper", selection: Binding(get: {
                selectedHelperID ?? helpers.first?.id ?? UUID()
            }, set: {
                selectedHelperID = $0
            })) {
                ForEach(helpers) { helper in
                    Text("\(helper.name) · \(helper.specialty) · ★\(String(format: "%.1f", helper.rating))").tag(helper.id)
                }
            }
            .pickerStyle(.menu)

            if let helper = helpers.first(where: { $0.id == (selectedHelperID ?? helpers.first?.id) }) {
                Text("Availability: \(helper.availableSlots.joined(separator: " · "))")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }
            TextField("Service type", text: $bookingServiceType)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            DatePicker("Date", selection: $bookingDate, displayedComponents: .date)
            TextField("Time slot", text: $bookingSlot)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Toggle("Payment authorization", isOn: $bookingPaymentAuthorized)
            TextField("Pre-appointment message", text: $bookingPreMessage)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Button("Book Service") {
                if let helperID = selectedHelperID ?? helpers.first?.id {
                    Task {
                        await store.createServiceBookingServerFirst(
                            helperID: helperID,
                            serviceType: bookingServiceType,
                            scheduledDate: bookingDate,
                            slot: bookingSlot,
                            paymentAuthorized: bookingPaymentAuthorized,
                            preMessage: bookingPreMessage
                        )
                    }
                    bookingPreMessage = ""
                }
            }
            .buttonStyle(GoAccentButtonStyle())

            ForEach(store.customerServiceBookings.prefix(3)) { booking in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(booking.helperName) · \(booking.serviceType)")
                        .font(.subheadline.weight(.semibold))
                    Text("\(booking.scheduledSlot) · \(booking.status)")
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                    TextField("Post-appointment message", text: Binding(
                        get: { booking.postMessage },
                        set: { store.setBookingPostMessage(booking.id, message: $0) }
                    ))
                    .padding(8)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    HStack {
                        Button("Send Update") {
                            Task {
                                await store.sendBookingMessageServerFirst(booking.id, content: booking.postMessage)
                            }
                        }
                        .buttonStyle(.bordered)
                        Button("Cancel Booking") {
                            Task { await store.cancelServiceBookingServerFirst(booking.id) }
                        }
                        .buttonStyle(.bordered)
                        Stepper("Rating \(bookingReviewRating)", value: $bookingReviewRating, in: 1...5)
                        Button("Submit Review") {
                            store.submitBookingReview(booking.id, rating: bookingReviewRating, comment: bookingReviewComment)
                            bookingReviewComment = ""
                        }
                    }
                    TextField("Review note", text: $bookingReviewComment)
                        .padding(8)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .padding(.vertical, 4)
            }
        }
    }

    private var customerToolRentalCard: some View {
        GoCard {
            Text("Tool Rental Flow")
                .font(.headline)
            TextField("Search tool rentals", text: $toolSearch)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                Text("Max daily rate: $\(Int(toolMaxRate))")
                    .font(.caption)
                Slider(value: $toolMaxRate, in: 10...150, step: 5)
            }
            let tools = store.filteredTools(query: toolSearch, maxDailyRate: toolMaxRate)
            Picker("Tool", selection: Binding(get: {
                selectedToolID ?? tools.first?.id ?? UUID()
            }, set: {
                selectedToolID = $0
            })) {
                ForEach(tools) { tool in
                    Text("\(tool.title) · $\(Int(tool.dailyRate))/day").tag(tool.id)
                }
            }
            .pickerStyle(.menu)
            if let tool = tools.first(where: { $0.id == (selectedToolID ?? tools.first?.id) }) {
                Text("Terms: \(tool.terms)")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                Text("Available: \(tool.availableSlots.joined(separator: " · "))")
                    .font(.caption2)
                    .foregroundStyle(OneTheme.muted)
            }
            TextField("Reservation slot", text: $toolSlot)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Toggle("Payment authorization", isOn: $toolPaymentAuthorized)
            Button("Reserve Tool") {
                if let toolID = selectedToolID ?? tools.first?.id {
                    Task { await store.reserveToolServerFirst(toolID: toolID, slot: toolSlot, paymentAuthorized: toolPaymentAuthorized) }
                    toolSlot = ""
                }
            }
            .buttonStyle(GoAccentButtonStyle())

            ForEach(store.toolRentalReservations.prefix(3)) { reservation in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(reservation.toolTitle) · \(reservation.ownerName)")
                        .font(.subheadline.weight(.semibold))
                    Text("Deposit: \(reservation.depositStatus) · Dispute: \(reservation.disputeStatus)")
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                    HStack {
                        Button("Pickup") { store.confirmToolPickup(reservation.id) }.buttonStyle(.bordered)
                        Button("Return") { store.confirmToolReturn(reservation.id) }.buttonStyle(.bordered)
                        Button("Cancel") {
                            Task { await store.cancelToolReservationServerFirst(reservation.id) }
                        }
                        .buttonStyle(.bordered)
                        Button(reservation.disputeStatus == "Open" ? "Resolve Dispute" : "Open Dispute") {
                            if reservation.disputeStatus == "Open" {
                                store.setToolDispute(reservation.id, open: false)
                            } else {
                                let detail = damageNotes[reservation.id] ?? reservation.damageNotes
                                Task { await store.openToolDamageDisputeServerFirst(reservation.id, description: detail.isEmpty ? "Customer opened a rental dispute." : detail) }
                            }
                        }
                        .buttonStyle(.bordered)
                    }
                    TextField("Damage assessment", text: Binding(
                        get: { damageNotes[reservation.id] ?? reservation.damageNotes },
                        set: { damageNotes[reservation.id] = $0 }
                    ))
                    .padding(8)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Button("Save Damage Notes") {
                        store.assessToolDamage(reservation.id, notes: damageNotes[reservation.id] ?? reservation.damageNotes)
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.vertical, 4)
            }
        }
    }
}
