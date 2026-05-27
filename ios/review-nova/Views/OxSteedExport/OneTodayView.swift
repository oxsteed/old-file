import SwiftUI
import MapKit

// ─── Drop-in TodayView replacement for OxSteedOne ────────────────────────────
// To use: in OneRootView replace `TodayView()` with `OneTodayView()`
//
// Design: dark-navy hero card + stats grid + pulse card + urgency queue
//         + full existing feature cards preserved below the fold.

struct OneTodayView: View {
    @Environment(OneStore.self) private var store

    // ── preserved local state (unchanged from original TodayView) ───────────
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
    @State private var selectedJobPhotos: [UIImage] = []
    @State private var showJobPhotoPicker = false
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
            // ── NEW: beautiful hero section ──────────────────────────────────
            OneTodayHeroCard()
            OneTodayStatsGrid()
            OneTodayPulseCard()
            OneTodayUrgencySection()

            // ── Divider heading into detail features ─────────────────────────
            HStack {
                Text("Activity & Features")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.45))
                    .textCase(.uppercase)
                    .tracking(0.8)
                Rectangle()
                    .fill(.white.opacity(0.1))
                    .frame(height: 1)
            }
            .padding(.top, 4)

            // ── PRESERVED: sync / offline banner ────────────────────────────
            if !store.isNetworkAvailable || !store.pendingSyncChanges.isEmpty {
                GoCard {
                    HStack(spacing: 10) {
                        Image(systemName: store.isNetworkAvailable
                              ? "arrow.triangle.2.circlepath.circle.fill" : "wifi.slash")
                            .foregroundStyle(store.isNetworkAvailable ? OneTheme.amber : .red)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.isNetworkAvailable
                                 ? store.localized("sync.pending", fallback: "Sync Queue Pending")
                                 : store.localized("sync.offline", fallback: "Offline Mode"))
                                .font(.subheadline.weight(.semibold))
                            Text(store.isNetworkAvailable
                                 ? "\(store.pendingSyncChanges.count) change(s) waiting to sync."
                                 : store.localized("sync.offline_detail",
                                     fallback: "Changes saved locally, will sync when reconnected."))
                                .font(.caption)
                                .foregroundStyle(OneTheme.muted)
                        }
                        Spacer()
                        if store.isNetworkAvailable && !store.pendingSyncChanges.isEmpty {
                            Button(store.localized("sync.button", fallback: "Sync")) {
                                Task { await store.syncPendingChanges() }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
            }

            // ── PRESERVED: universal search ──────────────────────────────────
            GoCard {
                Text("Universal Search")
                    .font(.headline)
                TextField("Search jobs, helpers, tools, training, financing",
                          text: Binding(
                            get: { store.universalSearchQuery },
                            set: { store.universalSearchQuery = $0 }
                          ))
                    .padding(10)
                    .background(Color.white.opacity(0.08),
                                in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text("Saved search alerts and map overlays are next step.")
                    .font(.caption).foregroundStyle(OneTheme.muted)
            }

            if !store.universalSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                GoCard {
                    Text("Search Results").font(.headline)
                    if store.globalSearchResults.isEmpty {
                        Text("No matches found.")
                            .font(.caption).foregroundStyle(OneTheme.muted)
                    } else {
                        ForEach(store.globalSearchResults) { result in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(result.category) · \(result.title)")
                                    .font(.subheadline.weight(.semibold))
                                Text(result.detail)
                                    .font(.caption).foregroundStyle(OneTheme.muted)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }
            }

            // ── PRESERVED: customer transaction flow ─────────────────────────
            if store.activePersona == .customer {
                customerSyncBanner
                customerJobFlowSection
                customerServiceBookingSection
                customerToolRentalSection
            }

            // ── PRESERVED: saved alerts ──────────────────────────────────────
            GoCard {
                Text("Saved Search Alerts").font(.headline)
                HStack {
                    TextField("Create alert query", text: $newAlertQuery)
                        .padding(10)
                        .background(Color.white.opacity(0.08),
                                    in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Button("Add") {
                        store.addSavedAlert(newAlertQuery)
                        newAlertQuery = ""
                    }
                    .buttonStyle(GoAccentButtonStyle())
                }
                ForEach(store.savedSearchAlerts) { alert in
                    HStack {
                        Text(alert.query).font(.caption)
                        Spacer()
                        Toggle("", isOn: Binding(
                            get: { alert.enabled },
                            set: { _ in store.toggleSavedAlert(alert.id) }
                        ))
                        .labelsHidden()
                    }
                }
            }

            // ── PRESERVED: map view ──────────────────────────────────────────
            GoCard {
                Text("Map View").font(.headline)
                Map(position: $cameraPosition) {
                    ForEach(store.mapPoints) { point in
                        Annotation(point.title,
                                   coordinate: CLLocationCoordinate2D(
                                    latitude: point.latitude,
                                    longitude: point.longitude)) {
                            Circle().fill(OneTheme.amber).frame(width: 12, height: 12)
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

            // ── PRESERVED: trust & safety ────────────────────────────────────
            GoCard {
                Text("Trust & Safety").font(.headline)
                ForEach(store.verificationBadges) { badge in
                    HStack {
                        Text(badge.title).font(.subheadline)
                        Spacer()
                        Text(badge.verified ? "Verified" : "Pending")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(badge.verified ? .green : OneTheme.amber)
                    }
                }
                HStack {
                    Button(store.safetyTimerRunning ? "Stop Safety Timer" : "Start Safety Timer") {
                        if store.safetyTimerRunning { store.stopSafetyTimer() } else { store.startSafetyTimer() }
                    }
                    .buttonStyle(GoAccentButtonStyle())
                    Button("SOS") { store.triggerSOS() }
                        .buttonStyle(.borderedProminent).tint(.red)
                }
                if store.sosTriggered {
                    Text("SOS triggered: location + incident log queued.")
                        .font(.caption).foregroundStyle(.red)
                }
            }

            // ── PRESERVED: reviews ───────────────────────────────────────────
            GoCard {
                Text("Two-Way Reviews").font(.headline)
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
                    .background(Color.white.opacity(0.08),
                                in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button("Submit Review") {
                    store.addReview(fromRole: reviewFromRole, toRole: reviewToRole,
                                    rating: reviewRating, comment: reviewComment)
                    reviewComment = ""; reviewRating = 5
                }
                .buttonStyle(.borderedProminent)
                ForEach(store.reviews.prefix(4)) { review in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(review.fromRole) → \(review.toRole) · \(String(repeating: "★", count: review.rating))")
                            .font(.caption.weight(.semibold))
                        Text(review.comment).font(.caption).foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 3)
                }
            }

            // ── PRESERVED: helper job feed loading indicator ─────────────────
            if store.activePersona == .helper
                && store.isFetchingJobs
                && store.customerJobs.isEmpty {
                GoCard {
                    HStack {
                        ProgressView().padding(.trailing, 6)
                        Text("Loading jobs near you…")
                            .font(.subheadline).foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 4)
                }
            }

            // ── NEW: enhanced persona home sections ──────────────────────────
            OneTodayHomeSections()
        }
        .sheet(isPresented: Binding(
            get: { store.showBusinessPicker },
            set: { store.showBusinessPicker = $0 }
        )) { businessPickerSheet }
        .onAppear {
            store.refreshMapPointsForActivePersona()
            if store.activePersona == .customer {
                Task { await store.refreshCustomerTransactionData() }
            }
        }
    }

    // MARK: - Customer feature sub-sections

    private var customerSyncBanner: some View {
        GoCard {
            HStack {
                Text(store.localized("home.customer_job_posting",
                     fallback: "Customer Transactions")).font(.headline)
                Spacer()
                Button("Sync") {
                    Task { await store.refreshCustomerTransactionData() }
                }
                .disabled(store.isRefreshingCustomerData)
                .buttonStyle(.bordered)
            }
            if store.isRefreshingCustomerData {
                ProgressView("Syncing…").font(.caption)
            }
            if let last = store.lastCustomerSyncAt {
                Text("Last sync: \(last.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2).foregroundStyle(OneTheme.muted)
            }
        }
    }

    @ViewBuilder
    private var customerJobFlowSection: some View {
        if store.isFetchingJobs && store.customerJobs.isEmpty {
            GoCard {
                HStack {
                    ProgressView().padding(.trailing, 6)
                    Text("Loading your jobs…").font(.subheadline).foregroundStyle(OneTheme.muted)
                }
                .padding(.vertical, 4)
            }
        } else {
            customerJobPostingCard
            customerBidsCard
        }
    }

    @ViewBuilder
    private var customerServiceBookingSection: some View {
        if store.isCreatingBooking && store.customerServiceBookings.isEmpty {
            GoCard {
                HStack {
                    ProgressView().padding(.trailing, 6)
                    Text("Loading bookings…").font(.subheadline).foregroundStyle(OneTheme.muted)
                }
                .padding(.vertical, 4)
            }
        } else {
            customerServiceBookingCard
        }
    }

    @ViewBuilder
    private var customerToolRentalSection: some View {
        if store.isReservingTool && store.rentalTools.isEmpty {
            GoCard {
                HStack {
                    ProgressView().padding(.trailing, 6)
                    Text("Loading rental tools…").font(.subheadline).foregroundStyle(OneTheme.muted)
                }
                .padding(.vertical, 4)
            }
        } else {
            customerToolRentalCard
        }
    }

    // MARK: - Preserved customer cards (unchanged logic, same as original TodayView)

    private var customerJobPostingCard: some View {
        GoCard {
            Text(store.localized("home.customer_job_posting", fallback: "Customer Job Posting"))
                .font(.headline)
            TextField("Job title", text: $postTitle)
                .padding(10)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                Picker("Category", selection: $postCategory) {
                    Text("Plumbing").tag("Plumbing")
                    Text("Electrical").tag("Electrical")
                    Text("HVAC").tag("HVAC")
                    Text("Carpentry").tag("Carpentry")
                    Text("Cleaning").tag("Cleaning")
                }
                .pickerStyle(.menu)
                TextField("Location", text: $postLocation)
                    .padding(10)
                    .background(Color.white.opacity(0.08),
                                in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            TextField("Address", text: $postAddress)
                .padding(10)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            TextField("Describe the work", text: $postDetails, axis: .vertical)
                .lineLimit(2...4)
                .padding(10)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            if selectedJobPhotos.isEmpty {
                Button { showJobPhotoPicker = true } label: {
                    Label("Add Photos (up to 5)", systemImage: "photo.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            } else {
                PhotoThumbnailStrip(images: $selectedJobPhotos) { showJobPhotoPicker = true }
            }
            HStack {
                Button(store.localized("home.save_draft", fallback: "Save Draft")) {
                    store.saveCustomerJobDraft(
                        title: postTitle, category: postCategory,
                        locationQuery: postLocation, address: postAddress,
                        details: postDetails, photos: [])
                }
                .buttonStyle(.bordered)
                Spacer()
            }
            Button {
                Task {
                    await store.postCustomerJobServerFirst(
                        title: postTitle, category: postCategory,
                        locationQuery: postLocation, address: postAddress,
                        details: postDetails, photos: [], localImages: selectedJobPhotos)
                    postTitle = ""; postDetails = ""; selectedJobPhotos = []
                    if let first = store.customerJobs.first { selectedJobID = first.id }
                }
            } label: {
                if store.isUploadingImages {
                    Label("Uploading photos…", systemImage: "arrow.up.circle").frame(maxWidth: .infinity)
                } else if store.isSubmittingCustomerJob {
                    ProgressView("Publishing job…").frame(maxWidth: .infinity)
                } else {
                    Text(store.localized("home.publish_job", fallback: "Publish Job + Notify Helpers"))
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(store.isSubmittingCustomerJob || store.isUploadingImages)
            .buttonStyle(GoAccentButtonStyle())
            if store.isUploadingImages && store.uploadProgress > 0 {
                ProgressView(value: store.uploadProgress).tint(OneTheme.amber)
            }
            if let msg = store.customerJobFlowMessage {
                Text(msg).font(.caption).foregroundStyle(OneTheme.muted)
            }
            if let err = store.lastJobError {
                HStack {
                    Text(err).font(.caption).foregroundStyle(.red)
                    Spacer()
                    Button("Retry") {
                        Task {
                            await store.postCustomerJobServerFirst(
                                title: postTitle, category: postCategory,
                                locationQuery: postLocation, address: postAddress,
                                details: postDetails, photos: [], localImages: selectedJobPhotos)
                        }
                    }
                    .buttonStyle(.bordered)
                }
            }
            if !store.customerJobs.isEmpty {
                Divider().padding(.vertical, 4)
                ForEach(store.customerJobs.prefix(5)) { job in
                    JobRow(job: job, store: store)
                }
                if store.hasMoreJobs {
                    Button(store.isLoadingMoreJobs ? "Loading..." :
                           store.localized("home.load_more_jobs", fallback: "Load More Jobs")) {
                        Task { await store.loadMoreCustomerJobs() }
                    }
                    .disabled(store.isLoadingMoreJobs)
                    .buttonStyle(.bordered)
                }
            }
        }
        .sheet(isPresented: $showJobPhotoPicker) {
            PhotoPicker(selectedImages: $selectedJobPhotos, maxSelection: 5)
        }
    }

    private var customerBidsCard: some View {
        GoCard {
            Text(store.localized("home.bids_comparison", fallback: "Bids + Comparison")).font(.headline)
            if store.customerJobs.isEmpty {
                Text("Post a job to start receiving bids.")
                    .font(.caption).foregroundStyle(OneTheme.muted)
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
                    Text("Price ↑").tag("price_asc")
                    Text("Price ↓").tag("price_desc")
                    Text("Helper A→Z").tag("helper_asc")
                }
                .pickerStyle(.segmented)
                let jobID = selectedJobID ?? (store.customerJobs.first?.id ?? UUID())
                ForEach(store.sortedBids(for: jobID, sort: bidSort)) { bid in
                    BidRow(bid: bid, message: Binding(
                        get: { bidMessageByID[bid.id] ?? "" },
                        set: { bidMessageByID[bid.id] = $0 }
                    ), store: store)
                }
                if store.isFetchingBids {
                    ProgressView("Refreshing bids…").font(.caption)
                }
                if let err = store.lastBidError {
                    HStack {
                        Text(err).font(.caption).foregroundStyle(.red)
                        Spacer()
                        Button("Retry") { Task { await store.refreshCustomerTransactionData() } }
                            .buttonStyle(.bordered)
                    }
                }
            }
        }
    }

    private var customerServiceBookingCard: some View {
        GoCard {
            Text(store.localized("home.customer_service_booking",
                 fallback: "Customer Service Booking")).font(.headline)
            TextField("Search helpers", text: $helperSearch)
                .padding(10)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                Text("Min rating: \(String(format: "%.1f", helperMinRating))★").font(.caption)
                Slider(value: $helperMinRating, in: 3.5...5.0, step: 0.5)
            }
            let helpers = store.filteredHelpers(query: helperSearch, minRating: helperMinRating)
            Picker("Helper", selection: Binding(
                get: { selectedHelperID ?? helpers.first?.id ?? UUID() },
                set: { selectedHelperID = $0 }
            )) {
                ForEach(helpers) { h in
                    Text("\(h.name) · \(h.specialty) · ★\(String(format: "%.1f", h.rating))").tag(h.id)
                }
            }
            .pickerStyle(.menu)
            if let h = helpers.first(where: { $0.id == (selectedHelperID ?? helpers.first?.id) }) {
                Text("Availability: \(h.availableSlots.joined(separator: " · "))")
                    .font(.caption).foregroundStyle(OneTheme.muted)
            }
            TextField("Service type", text: $bookingServiceType)
                .padding(10)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            DatePicker("Date", selection: $bookingDate, displayedComponents: .date)
            TextField("Time slot", text: $bookingSlot)
                .padding(10)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Toggle("Payment authorization", isOn: $bookingPaymentAuthorized)
            if let msg = store.mobilePaymentStatusMessage {
                Text(msg).font(.caption)
                    .foregroundStyle(store.mobilePaymentsAvailable ? OneTheme.muted : .orange)
            }
            TextField("Pre-appointment message", text: $bookingPreMessage)
                .padding(10)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Button("Book Service") {
                if let hid = selectedHelperID ?? helpers.first?.id {
                    Task {
                        await store.createServiceBookingServerFirst(
                            helperID: hid, serviceType: bookingServiceType,
                            scheduledDate: bookingDate, slot: bookingSlot,
                            paymentAuthorized: bookingPaymentAuthorized,
                            preMessage: bookingPreMessage)
                    }
                    bookingPreMessage = ""
                }
            }
            .disabled(store.isCreatingBooking)
            .buttonStyle(GoAccentButtonStyle())
            if store.isCreatingBooking { ProgressView("Creating booking…").font(.caption) }
            ForEach(store.customerServiceBookings.prefix(3)) { booking in
                BookingRow(booking: booking, reviewRating: $bookingReviewRating,
                           reviewComment: $bookingReviewComment, store: store)
            }
            if store.hasMoreBookings {
                Button(store.isLoadingMoreBookings ? "Loading..." : "Load More Bookings") {
                    Task { await store.loadMoreBookings() }
                }
                .disabled(store.isLoadingMoreBookings).buttonStyle(.bordered)
            }
            if let err = store.lastBookingError {
                HStack {
                    Text(err).font(.caption).foregroundStyle(.red)
                    Spacer()
                    Button("Retry") { Task { await store.refreshCustomerTransactionData() } }
                        .buttonStyle(.bordered)
                }
            }
        }
    }

    private var customerToolRentalCard: some View {
        GoCard {
            Text(store.localized("home.tool_rental_flow", fallback: "Tool Rental Flow")).font(.headline)
            TextField("Search tool rentals", text: $toolSearch)
                .padding(10)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                Text("Max daily rate: $\(Int(toolMaxRate))").font(.caption)
                Slider(value: $toolMaxRate, in: 10...150, step: 5)
            }
            let tools = store.filteredTools(query: toolSearch, maxDailyRate: toolMaxRate)
            Picker("Tool", selection: Binding(
                get: { selectedToolID ?? tools.first?.id ?? UUID() },
                set: { selectedToolID = $0 }
            )) {
                ForEach(tools) { t in
                    Text("\(t.title) · $\(Int(t.dailyRate))/day").tag(t.id)
                }
            }
            .pickerStyle(.menu)
            if let t = tools.first(where: { $0.id == (selectedToolID ?? tools.first?.id) }) {
                Text("Terms: \(t.terms)").font(.caption).foregroundStyle(OneTheme.muted)
                Text("Available: \(t.availableSlots.joined(separator: " · "))")
                    .font(.caption2).foregroundStyle(OneTheme.muted)
            }
            TextField("Reservation slot", text: $toolSlot)
                .padding(10)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Toggle("Payment authorization", isOn: $toolPaymentAuthorized)
            Button("Reserve Tool") {
                if let tid = selectedToolID ?? tools.first?.id {
                    Task {
                        await store.reserveToolServerFirst(
                            toolID: tid, slot: toolSlot,
                            paymentAuthorized: toolPaymentAuthorized)
                    }
                    toolSlot = ""
                }
            }
            .disabled(store.isReservingTool)
            .buttonStyle(GoAccentButtonStyle())
            if store.isReservingTool { ProgressView("Reserving tool…").font(.caption) }
            ForEach(store.toolRentalReservations.prefix(3)) { res in
                RentalRow(reservation: res,
                          damageNote: Binding(
                            get: { damageNotes[res.id] ?? res.damageNotes },
                            set: { damageNotes[res.id] = $0 }
                          ),
                          store: store)
            }
            if store.hasMoreRentals {
                Button(store.isLoadingMoreRentals ? "Loading..." : "Load More Rentals") {
                    Task { await store.loadMoreRentals() }
                }
                .disabled(store.isLoadingMoreRentals).buttonStyle(.bordered)
            }
            if let err = store.lastToolError {
                HStack {
                    Text(err).font(.caption).foregroundStyle(.red)
                    Spacer()
                    Button("Retry") { Task { await store.refreshCustomerTransactionData() } }
                        .buttonStyle(.bordered)
                }
            }
        }
    }

    private var businessPickerSheet: some View {
        NavigationStack {
            List(store.availableBusinesses) { biz in
                Button { store.selectBusiness(biz) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(biz.name).font(.headline)
                        Text(biz.id).font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Select Business")
        }
    }
}

// MARK: - Extracted row sub-views (keep body short)

private struct JobRow: View {
    let job: CustomerJobPost
    let store: OneStore
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(job.title).font(.caption.weight(.semibold))
                    Text("\(job.category) · \(job.status.rawValue)")
                        .font(.caption2).foregroundStyle(OneTheme.muted)
                }
                Spacer()
                if job.status == .draft {
                    Button("Publish") { store.publishCustomerJob(job.id) }.buttonStyle(.bordered)
                } else {
                    Button("Start") { Task { await store.startCustomerJobServerFirst(job.id) } }
                        .disabled(store.isUpdatingJob).buttonStyle(.bordered)
                    Button("Complete") { Task { await store.completeCustomerJobServerFirst(job.id) } }
                        .disabled(store.isUpdatingJob).buttonStyle(.bordered)
                }
                Button("Cancel") { Task { await store.cancelCustomerJobServerFirst(job.id) } }
                    .disabled(store.isUpdatingJob).buttonStyle(.bordered)
            }
            if !job.photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(job.photos, id: \.self) { url in
                            AsyncImage(url: URL(string: url)) { phase in
                                switch phase {
                                case .success(let img): img.resizable().scaledToFill()
                                case .failure: Image(systemName: "photo").foregroundStyle(OneTheme.muted)
                                default: ProgressView()
                                }
                            }
                            .frame(width: 56, height: 56).clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
                }
            }
        }
    }
}

private struct BidRow: View {
    let bid: JobBid
    @Binding var message: String
    let store: OneStore
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(bid.helperName).font(.subheadline.weight(.semibold))
                Spacer()
                Text("$\(Int(bid.amount))").font(.subheadline.weight(.bold))
            }
            Text("\(bid.etaText) · \(bid.note)").font(.caption).foregroundStyle(OneTheme.muted)
            HStack {
                if bid.accepted {
                    Text("Accepted").font(.caption.weight(.bold)).foregroundStyle(.green)
                } else {
                    Button("Accept + Create Appointment") {
                        Task { await store.acceptBidServerFirst(bid.id) }
                    }
                    .disabled(store.bidAcceptanceInFlight.contains(bid.id))
                    .buttonStyle(.borderedProminent)
                }
                Button("Message") {
                    Task { await store.messageHelperForBidServerFirst(bid.id, content: message) }
                }
                .buttonStyle(.bordered)
            }
            TextField("Message helper", text: $message)
                .padding(8)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .padding(.vertical, 4)
    }
}

private struct BookingRow: View {
    let booking: CustomerServiceBooking
    @Binding var reviewRating: Int
    @Binding var reviewComment: String
    let store: OneStore
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(booking.helperName) · \(booking.serviceType)").font(.subheadline.weight(.semibold))
            Text("\(booking.scheduledSlot) · \(booking.status)").font(.caption).foregroundStyle(OneTheme.muted)
            Text("Payment: \(booking.paymentStatus ?? (booking.paymentAuthorized ? "authorized" : "pending"))")
                .font(.caption2).foregroundStyle(OneTheme.muted)
            TextField("Post-appointment message", text: Binding(
                get: { booking.postMessage },
                set: { store.setBookingPostMessage(booking.id, message: $0) }
            ))
            .padding(8)
            .background(Color.white.opacity(0.08),
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            HStack {
                if (booking.paymentStatus ?? "") == "requires_payment" && booking.paymentIntentID != nil {
                    Button("Confirm Payment") {
                        Task { await store.confirmBookingPaymentServerFirst(booking.id) }
                    }
                    .disabled(store.isUpdatingBooking || !store.mobilePaymentsAvailable)
                    .buttonStyle(.borderedProminent)
                }
                Button("Send Update") {
                    Task { await store.sendBookingMessageServerFirst(booking.id, content: booking.postMessage) }
                }
                .disabled(store.isUpdatingBooking).buttonStyle(.bordered)
                Button("Cancel") {
                    Task { await store.cancelServiceBookingServerFirst(booking.id) }
                }
                .disabled(store.isUpdatingBooking).buttonStyle(.bordered)
            }
            Stepper("Rating \(reviewRating)", value: $reviewRating, in: 1...5)
            Button("Submit Review") {
                store.submitBookingReview(booking.id, rating: reviewRating, comment: reviewComment)
                reviewComment = ""
            }
            TextField("Review note", text: $reviewComment)
                .padding(8)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .padding(.vertical, 4)
    }
}

private struct RentalRow: View {
    let reservation: ToolRentalReservation
    @Binding var damageNote: String
    let store: OneStore
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(reservation.toolTitle) · \(reservation.ownerName)").font(.subheadline.weight(.semibold))
            Text("Deposit: \(reservation.depositStatus) · Dispute: \(reservation.disputeStatus)")
                .font(.caption).foregroundStyle(OneTheme.muted)
            Text("Payment: \(reservation.paymentStatus ?? (reservation.paymentAuthorized ? "authorized" : "pending"))")
                .font(.caption2).foregroundStyle(OneTheme.muted)
            HStack {
                Button("Pickup") { store.confirmToolPickup(reservation.id) }.buttonStyle(.bordered)
                Button("Return") { store.confirmToolReturn(reservation.id) }.buttonStyle(.bordered)
                Button("Cancel") {
                    Task { await store.cancelToolReservationServerFirst(reservation.id) }
                }
                .disabled(store.isUpdatingTool).buttonStyle(.bordered)
                Button(reservation.disputeStatus == "Open" ? "Resolve Dispute" : "Open Dispute") {
                    if reservation.disputeStatus == "Open" {
                        store.setToolDispute(reservation.id, open: false)
                    } else {
                        let detail = damageNote.isEmpty ? "Customer opened a rental dispute." : damageNote
                        Task { await store.openToolDamageDisputeServerFirst(reservation.id, description: detail) }
                    }
                }
                .disabled(store.isUpdatingTool).buttonStyle(.bordered)
            }
            TextField("Damage assessment", text: $damageNote)
                .padding(8)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            Button("Save Damage Notes") {
                store.assessToolDamage(reservation.id, notes: damageNote)
            }
            .buttonStyle(.bordered)
        }
        .padding(.vertical, 4)
    }
}
