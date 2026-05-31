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
        GoScreen(title: store.localized("home.title", fallback: "Home"), showsTitle: false) {
            header
            if !store.isNetworkAvailable || !store.pendingSyncChanges.isEmpty {
                GoCard {
                    HStack(spacing: 10) {
                        Image(systemName: store.isNetworkAvailable ? "arrow.triangle.2.circlepath.circle.fill" : "wifi.slash")
                            .foregroundStyle(store.isNetworkAvailable ? OneTheme.amber : .red)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.isNetworkAvailable
                                 ? store.localized("sync.pending", fallback: "Sync Queue Pending")
                                 : store.localized("sync.offline", fallback: "Offline Mode"))
                                .font(.subheadline.weight(.semibold))
                            Text(store.isNetworkAvailable
                                 ? "\(store.pendingSyncChanges.count) " + store.localized("home.sync_pending_changes", fallback: "change(s) waiting to sync.")
                                 : store.localized("sync.offline_detail", fallback: "Changes are saved locally and will sync when connection returns."))
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

            GoCard {
                Text(store.localized("home.universal_search", fallback: "Universal Search"))
                    .font(.headline)
                TextField(store.localized("home.search_placeholder", fallback: "Search jobs, helpers, tools, training, financing"), text: Binding(
                    get: { store.universalSearchQuery },
                    set: { store.universalSearchQuery = $0 }
                ))
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text(store.localized("home.universal_search_note", fallback: "Saved search alerts and map overlays are next implementation step."))
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }

            if !store.universalSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                GoCard {
                    Text(store.localized("home.search_results", fallback: "Search Results"))
                        .font(.headline)
                    if store.globalSearchResults.isEmpty {
                        Text(store.localized("home.no_search_results", fallback: "No matches found across Home, Life, Growth, and Learn."))
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
                Text(store.localized("home.discovery_views", fallback: "Discovery Views"))
                    .font(.headline)
                Text(store.localized("home.discovery_description", fallback: "Feed, Map, and List are unified by persona-aware search context."))
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                HStack {
                    labelPill(store.localized("home.discovery_feed", fallback: "Feed"))
                    labelPill(store.localized("home.discovery_map", fallback: "Map"))
                    labelPill(store.localized("home.discovery_list", fallback: "List"))
                    labelPill(store.localized("home.discovery_alerts", fallback: "Alerts"))
                }
                Text(store.localized("home.saved_alert_example", fallback: "Saved alert example: plumber under $150 in Springfield"))
                    .font(.caption2)
                    .foregroundStyle(OneTheme.muted)
            }

            if store.activePersona == .customer {
                GoCard {
                    HStack {
                        Text(store.localized("home.customer_transactions", fallback: "Customer Transactions"))
                            .font(.headline)
                        Spacer()
                        Button(store.localized("home.sync_live_data", fallback: "Sync Live Data")) {
                            Task { await store.refreshCustomerTransactionData() }
                        }
                        .disabled(store.isRefreshingCustomerData)
                        .buttonStyle(.bordered)
                    }
                    if store.isRefreshingCustomerData {
                        ProgressView(store.localized("home.syncing", fallback: "Syncing..."))
                            .font(.caption)
                    }
                    if let last = store.lastCustomerSyncAt {
                        Text("\(store.localized("home.last_sync", fallback: "Last sync:")) \(last.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption2)
                            .foregroundStyle(OneTheme.muted)
                    }
                    Text("\(store.localized("home.refreshes_customer_data", fallback: "Refreshes jobs, bids, helpers, appointments, and rentals from")) \(store.resolvedAPIBaseURLString).")
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                }
                // Phase 1: show spinner on first-ever fetch; once cached data exists render immediately.
                if store.isFetchingJobs && store.customerJobs.isEmpty {
                    GoCard {
                        HStack {
                            ProgressView()
                                .padding(.trailing, 6)
                            Text(store.localized("home.loading_jobs", fallback: "Loading your jobs…"))
                                .font(.subheadline)
                                .foregroundStyle(OneTheme.muted)
                        }
                        .padding(.vertical, 4)
                    }
                } else {
                    customerJobPostingCard
                    customerBidsCard
                }
                if store.isCreatingBooking && store.customerServiceBookings.isEmpty {
                    GoCard {
                        HStack {
                            ProgressView()
                                .padding(.trailing, 6)
                            Text(store.localized("home.loading_bookings", fallback: "Loading bookings…"))
                                .font(.subheadline)
                                .foregroundStyle(OneTheme.muted)
                        }
                        .padding(.vertical, 4)
                    }
                } else {
                    customerServiceBookingCard
                }
                if store.isReservingTool && store.rentalTools.isEmpty {
                    GoCard {
                        HStack {
                            ProgressView()
                                .padding(.trailing, 6)
                            Text(store.localized("home.loading_rental_tools", fallback: "Loading rental tools…"))
                                .font(.subheadline)
                                .foregroundStyle(OneTheme.muted)
                        }
                        .padding(.vertical, 4)
                    }
                } else {
                    customerToolRentalCard
                }
            }

            GoCard {
                Text(store.localized("home.saved_search_alerts", fallback: "Saved Search Alerts"))
                    .font(.headline)
                HStack {
                    TextField(store.localized("home.create_alert_query", fallback: "Create alert query"), text: $newAlertQuery)
                        .padding(10)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Button(store.localized("home.add", fallback: "Add")) {
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
                Text(store.localized("home.map_view", fallback: "Map View"))
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
                Button(store.localized("home.refresh_map_for_active_persona", fallback: "Refresh Map for Active Persona")) {
                    store.refreshMapPointsForActivePersona()
                }
                .buttonStyle(.bordered)
            }

            GoCard {
                Text(store.localized("home.trust_and_safety", fallback: "Trust & Safety"))
                    .font(.headline)
                ForEach(store.verificationBadges) { badge in
                    HStack {
                        Text(badge.title)
                            .font(.subheadline)
                        Spacer()
                        Text(store.localized(badge.verified ? "home.verified" : "home.pending", fallback: badge.verified ? "Verified" : "Pending"))
                            .font(.caption.weight(.bold))
                            .foregroundStyle(badge.verified ? .green : OneTheme.amber)
                    }
                }
                HStack {
                    Button(store.safetyTimerRunning ? store.localized("home.stop_safety_timer", fallback: "Stop Safety Timer") : store.localized("home.start_safety_timer", fallback: "Start Safety Timer")) {
                        if store.safetyTimerRunning {
                            store.stopSafetyTimer()
                        } else {
                            store.startSafetyTimer()
                        }
                    }
                    .buttonStyle(GoAccentButtonStyle())
                    Button(store.localized("home.sos", fallback: "SOS")) {
                        store.triggerSOS()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }
                if store.sosTriggered {
                    Text(store.localized("home.sos_triggered", fallback: "SOS triggered: location + incident log queued."))
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            GoCard {
                Text(store.localized("home.two_way_reviews", fallback: "Two-Way Reviews"))
                    .font(.headline)
                Picker(store.localized("home.from", fallback: "From"), selection: $reviewFromRole) {
                    Text(store.localized("home.customer", fallback: "Customer")).tag("Customer")
                    Text(store.localized("home.helper", fallback: "Helper")).tag("Helper")
                    Text(store.localized("home.business_owner", fallback: "Business Owner")).tag("Business Owner")
                }
                Picker(store.localized("home.to", fallback: "To"), selection: $reviewToRole) {
                    Text(store.localized("home.customer", fallback: "Customer")).tag("Customer")
                    Text(store.localized("home.helper", fallback: "Helper")).tag("Helper")
                    Text(store.localized("home.business_owner", fallback: "Business Owner")).tag("Business Owner")
                }
                Stepper("\(store.localized("home.rating", fallback: "Rating")): \(reviewRating)", value: $reviewRating, in: 1...5)
                TextField(store.localized("home.review_comment", fallback: "Review comment"), text: $reviewComment)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button(store.localized("home.submit_review", fallback: "Submit Review")) {
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

            // Phase 1: show a loading indicator on the helper job feed while the first fetch runs.
                if store.activePersona == .helper && store.isFetchingJobs && store.customerJobs.isEmpty {
                GoCard {
                    HStack {
                        ProgressView()
                            .padding(.trailing, 6)
                        Text(store.localized("home.loading_jobs_near_you", fallback: "Loading jobs near you…"))
                            .font(.subheadline)
                            .foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 4)
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
                        Text(store.localized("home.run_today_build_tomorrow", fallback: "Run today. Build tomorrow."))
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(OneTheme.muted)
                    }
                    Spacer(minLength: 8)
                }

                Text(store.localized("home.one_account_many_personas", fallback: "One account. Many personas. Home updates instantly."))
                    .font(.footnote)
                    .foregroundStyle(OneTheme.muted)

                HStack(spacing: 8) {
                    statusPill("\(store.localized("home.persona", fallback: "Persona:")) \(store.personaContext.activePersona.label)")
                    if store.personaContext.activePersona == .businessOwner {
                        statusPill("\(store.localized("home.role", fallback: "Role:")) \(store.personaContext.businessSubRole.label)")
                    }
                }

            HStack(spacing: 10) {
                    Button(store.localized("home.profile_settings", fallback: "Profile & Settings")) {
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
            .navigationTitle(store.localized("home.select_business", fallback: "Select Business"))
        }
    }

    private var customerJobPostingCard: some View {
        GoCard {
            Text(store.localized("home.customer_job_posting", fallback: "Customer Job Posting"))
                .font(.headline)
            TextField(store.localized("home.job_title", fallback: "Job title"), text: $postTitle)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                Picker(store.localized("home.category", fallback: "Category"), selection: $postCategory) {
                    Text(store.localized("home.category_plumbing", fallback: "Plumbing")).tag("Plumbing")
                    Text(store.localized("home.category_electrical", fallback: "Electrical")).tag("Electrical")
                    Text(store.localized("home.category_hvac", fallback: "HVAC")).tag("HVAC")
                    Text(store.localized("home.category_carpentry", fallback: "Carpentry")).tag("Carpentry")
                    Text(store.localized("home.category_cleaning", fallback: "Cleaning")).tag("Cleaning")
                }
                .pickerStyle(.menu)
                TextField(store.localized("home.location_autocomplete", fallback: "Location autocomplete"), text: $postLocation)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            TextField(store.localized("home.address", fallback: "Address"), text: $postAddress)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            TextField(store.localized("home.describe_work", fallback: "Describe the work"), text: $postDetails, axis: .vertical)
                .lineLimit(2...4)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            // Photo picker
            if selectedJobPhotos.isEmpty {
                Button {
                    showJobPhotoPicker = true
                } label: {
                    Label(store.localized("home.add_photos", fallback: "Add Photos (up to 5)"), systemImage: "photo.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            } else {
                PhotoThumbnailStrip(images: $selectedJobPhotos) {
                    showJobPhotoPicker = true
                }
            }
            HStack {
                Button(store.localized("home.save_draft", fallback: "Save Draft")) {
                    store.saveCustomerJobDraft(
                        title: postTitle,
                        category: postCategory,
                        locationQuery: postLocation,
                        address: postAddress,
                        details: postDetails,
                        photos: []
                    )
                }
                .buttonStyle(.bordered)
                Spacer()
            }
            Button {
                Task {
                    await store.postCustomerJobServerFirst(
                        title: postTitle,
                        category: postCategory,
                        locationQuery: postLocation,
                        address: postAddress,
                        details: postDetails,
                        photos: [],
                        localImages: selectedJobPhotos
                    )
                    postTitle = ""
                    postDetails = ""
                    selectedJobPhotos = []
                    if let first = store.customerJobs.first {
                        selectedJobID = first.id
                    }
                }
            } label: {
                if store.isUploadingImages {
                    Label(store.localized("home.uploading_photos", fallback: "Uploading photos…"), systemImage: "arrow.up.circle")
                        .frame(maxWidth: .infinity)
                } else if store.isSubmittingCustomerJob {
                    ProgressView(store.localized("home.publishing_job", fallback: "Publishing job…")).frame(maxWidth: .infinity)
                } else {
                    Text(store.localized("home.publish_job", fallback: "Publish Job + Notify Helpers"))
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(store.isSubmittingCustomerJob || store.isUploadingImages)
            .buttonStyle(GoAccentButtonStyle())
            if store.isUploadingImages && store.uploadProgress > 0 {
                ProgressView(value: store.uploadProgress)
                    .tint(OneTheme.amber)
            }
            if let message = store.customerJobFlowMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }
            if let error = store.lastJobError {
                HStack {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                    Spacer()
                    Button(store.localized("home.retry", fallback: "Retry")) {
                        Task {
                            await store.postCustomerJobServerFirst(
                                title: postTitle,
                                category: postCategory,
                                locationQuery: postLocation,
                                address: postAddress,
                                details: postDetails,
                                photos: [],
                                localImages: selectedJobPhotos
                            )
                        }
                    }
                    .buttonStyle(.bordered)
                }
            }

            if !store.customerJobs.isEmpty {
                Divider().padding(.vertical, 4)
                ForEach(store.customerJobs.prefix(5)) { job in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(job.title).font(.caption.weight(.semibold))
                                Text("\(job.category) · \(job.status.rawValue)")
                                    .font(.caption2)
                                    .foregroundStyle(OneTheme.muted)
                            }
                            Spacer()
                            if job.status == .draft {
                                Button(store.localized("home.publish", fallback: "Publish")) { store.publishCustomerJob(job.id) }
                                    .buttonStyle(.bordered)
                            } else {
                                Button(store.localized("home.start", fallback: "Start")) { Task { await store.startCustomerJobServerFirst(job.id) } }
                                    .disabled(store.isUpdatingJob)
                                    .buttonStyle(.bordered)
                                Button(store.localized("home.complete", fallback: "Complete")) { Task { await store.completeCustomerJobServerFirst(job.id) } }
                                    .disabled(store.isUpdatingJob)
                                    .buttonStyle(.bordered)
                            }
                            Button(store.localized("home.cancel", fallback: "Cancel")) { Task { await store.cancelCustomerJobServerFirst(job.id) } }
                                .disabled(store.isUpdatingJob)
                                .buttonStyle(.bordered)
                        }
                        // Photo thumbnails for jobs that have uploaded photos
                        if !job.photos.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(job.photos, id: \.self) { photoURL in
                                        AsyncImage(url: URL(string: photoURL)) { phase in
                                            switch phase {
                                            case .success(let image):
                                                image.resizable().scaledToFill()
                                            case .failure:
                                                Image(systemName: "photo").foregroundStyle(OneTheme.muted)
                                            case .empty:
                                                ProgressView()
                                            @unknown default:
                                                EmptyView()
                                            }
                                        }
                                        .frame(width: 56, height: 56)
                                        .clipped()
                                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    }
                                }
                            }
                        }
                    }
                }
                if store.hasMoreJobs {
                Button(store.isLoadingMoreJobs ? store.localized("home.loading", fallback: "Loading...") : store.localized("home.load_more_jobs", fallback: "Load More Jobs")) {
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
            Text(store.localized("home.bids_comparison", fallback: "Bids + Comparison"))
                .font(.headline)
            if store.customerJobs.isEmpty {
                Text(store.localized("home.post_job_for_bids", fallback: "Post a job to start receiving bids."))
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            } else {
                Picker(store.localized("home.job_picker", fallback: "Job"), selection: Binding(
                    get: { selectedJobID ?? store.customerJobs.first?.id ?? UUID() },
                    set: { selectedJobID = $0 }
                )) {
                    ForEach(store.customerJobs) { job in
                        Text("\(job.title) · \(job.status.rawValue)").tag(job.id)
                    }
                }
                .pickerStyle(.menu)
                Picker(store.localized("home.sort", fallback: "Sort"), selection: $bidSort) {
                    Text(store.localized("home.price_low_to_high", fallback: "Price Low→High")).tag("price_asc")
                    Text(store.localized("home.price_high_to_low", fallback: "Price High→Low")).tag("price_desc")
                    Text(store.localized("home.helper_a_to_z", fallback: "Helper A→Z")).tag("helper_asc")
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
                                Text(store.localized("home.accepted", fallback: "Accepted"))
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.green)
                            } else {
                                Button(store.localized("home.accept_create_appointment", fallback: "Accept + Create Appointment")) {
                                    Task { await store.acceptBidServerFirst(bid.id) }
                                }
                                .disabled(store.bidAcceptanceInFlight.contains(bid.id))
                                .buttonStyle(.borderedProminent)
                            }
                                Button(store.localized("home.message", fallback: "Message")) {
                                    Task {
                                        await store.messageHelperForBidServerFirst(
                                            bid.id,
                                            content: bidMessageByID[bid.id] ?? store.localized("home.message_default_content", fallback: "Can you confirm scope and timeline?")
                                        )
                                    }
                                }
                                .buttonStyle(.bordered)
                        }
                        TextField(store.localized("home.message_helper", fallback: "Message helper"), text: Binding(
                            get: { bidMessageByID[bid.id] ?? "" },
                            set: { bidMessageByID[bid.id] = $0 }
                        ))
                        .padding(8)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .padding(.vertical, 4)
                }
                if store.isFetchingBids {
                    ProgressView(store.localized("home.refreshing_bids", fallback: "Refreshing bids..."))
                        .font(.caption)
                }
                if let error = store.lastBidError {
                    HStack {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                        Spacer()
                        Button(store.localized("home.retry_bid_sync", fallback: "Retry Bid Sync")) {
                            Task { await store.refreshCustomerTransactionData() }
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        }
    }

    private var customerServiceBookingCard: some View {
        GoCard {
            Text(store.localized("home.customer_service_booking", fallback: "Customer Service Booking"))
                .font(.headline)
            TextField(store.localized("home.search_helpers", fallback: "Search helpers"), text: $helperSearch)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                Text("\(store.localized("home.min_rating", fallback: "Min rating:")) \(String(format: "%.1f", helperMinRating))★")
                    .font(.caption)
                Slider(value: $helperMinRating, in: 3.5...5.0, step: 0.5)
            }
            let helpers = store.filteredHelpers(query: helperSearch, minRating: helperMinRating)
            Picker(store.localized("home.helper", fallback: "Helper"), selection: Binding(get: {
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
                Text("\(store.localized("home.availability", fallback: "Availability:")) \(helper.availableSlots.joined(separator: " · "))")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }
            TextField(store.localized("home.service_type", fallback: "Service type"), text: $bookingServiceType)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            DatePicker(store.localized("home.date", fallback: "Date"), selection: $bookingDate, displayedComponents: .date)
            TextField(store.localized("home.time_slot", fallback: "Time slot"), text: $bookingSlot)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Toggle(store.localized("home.payment_authorization", fallback: "Payment authorization"), isOn: $bookingPaymentAuthorized)
            if let paymentMessage = store.mobilePaymentStatusMessage {
                Text(paymentMessage)
                    .font(.caption)
                    .foregroundStyle(store.mobilePaymentsAvailable ? OneTheme.muted : .orange)
            }
            TextField(store.localized("home.pre_appointment_message", fallback: "Pre-appointment message"), text: $bookingPreMessage)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Button(store.localized("home.book_service", fallback: "Book Service")) {
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
            .disabled(store.isCreatingBooking)
            .buttonStyle(GoAccentButtonStyle())
            if store.isCreatingBooking {
                ProgressView(store.localized("home.creating_booking", fallback: "Creating booking..."))
                    .font(.caption)
            }

            ForEach(store.customerServiceBookings.prefix(3)) { booking in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(booking.helperName) · \(booking.serviceType)")
                        .font(.subheadline.weight(.semibold))
                    Text("\(booking.scheduledSlot) · \(booking.status)")
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                    Text("\(store.localized("home.payment_prefix", fallback: "Payment:")) \(booking.paymentStatus ?? (booking.paymentAuthorized ? store.localized("home.payment_authorized", fallback: "authorized") : store.localized("home.payment_pending", fallback: "pending")))")
                        .font(.caption2)
                        .foregroundStyle(OneTheme.muted)
                    TextField(store.localized("home.post_appointment_message", fallback: "Post-appointment message"), text: Binding(
                        get: { booking.postMessage },
                        set: { store.setBookingPostMessage(booking.id, message: $0) }
                    ))
                    .padding(8)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    HStack {
                        if (booking.paymentStatus ?? "") == "requires_payment" && booking.paymentIntentID != nil {
                            Button(store.localized("home.confirm_payment", fallback: "Confirm Payment")) {
                                Task { await store.confirmBookingPaymentServerFirst(booking.id) }
                            }
                            .disabled(store.isUpdatingBooking || !store.mobilePaymentsAvailable)
                            .buttonStyle(.borderedProminent)
                        }
                        Button(store.localized("home.send_update", fallback: "Send Update")) {
                            Task {
                                await store.sendBookingMessageServerFirst(booking.id, content: booking.postMessage)
                            }
                        }
                        .disabled(store.isUpdatingBooking)
                        .buttonStyle(.bordered)
                        Button(store.localized("home.cancel_booking", fallback: "Cancel Booking")) {
                            Task { await store.cancelServiceBookingServerFirst(booking.id) }
                        }
                        .disabled(store.isUpdatingBooking)
                        .buttonStyle(.bordered)
                        Stepper("\(store.localized("home.rating", fallback: "Rating")) \(bookingReviewRating)", value: $bookingReviewRating, in: 1...5)
                        Button(store.localized("home.submit_review", fallback: "Submit Review")) {
                            store.submitBookingReview(booking.id, rating: bookingReviewRating, comment: bookingReviewComment)
                            bookingReviewComment = ""
                        }
                    }
                    TextField(store.localized("home.review_note", fallback: "Review note"), text: $bookingReviewComment)
                        .padding(8)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .padding(.vertical, 4)
            }
            if store.hasMoreBookings {
                Button(store.isLoadingMoreBookings ? store.localized("home.loading", fallback: "Loading...") : store.localized("home.load_more_bookings", fallback: "Load More Bookings")) {
                    Task { await store.loadMoreBookings() }
                }
                .disabled(store.isLoadingMoreBookings)
                .buttonStyle(.bordered)
            }
            if let error = store.lastBookingError {
                HStack {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                    Spacer()
                    Button(store.localized("home.retry_booking_sync", fallback: "Retry Booking Sync")) {
                        Task { await store.refreshCustomerTransactionData() }
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private var customerToolRentalCard: some View {
        GoCard {
            Text(store.localized("home.tool_rental_flow", fallback: "Tool Rental Flow"))
                .font(.headline)
            TextField(store.localized("home.search_tool_rentals", fallback: "Search tool rentals"), text: $toolSearch)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                Text("\(store.localized("home.max_daily_rate", fallback: "Max daily rate:")) $\(Int(toolMaxRate))")
                    .font(.caption)
                Slider(value: $toolMaxRate, in: 10...150, step: 5)
            }
            let tools = store.filteredTools(query: toolSearch, maxDailyRate: toolMaxRate)
            Picker(store.localized("home.tool_picker", fallback: "Tool"), selection: Binding(get: {
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
                Text("\(store.localized("home.terms", fallback: "Terms:")) \(tool.terms)")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                Text("\(store.localized("home.available", fallback: "Available:")) \(tool.availableSlots.joined(separator: " · "))")
                    .font(.caption2)
                    .foregroundStyle(OneTheme.muted)
            }
            TextField(store.localized("home.reservation_slot", fallback: "Reservation slot"), text: $toolSlot)
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Toggle(store.localized("home.payment_authorization", fallback: "Payment authorization"), isOn: $toolPaymentAuthorized)
            Button(store.localized("home.reserve_tool", fallback: "Reserve Tool")) {
                if let toolID = selectedToolID ?? tools.first?.id {
                    Task { await store.reserveToolServerFirst(toolID: toolID, slot: toolSlot, paymentAuthorized: toolPaymentAuthorized) }
                    toolSlot = ""
                }
            }
            .disabled(store.isReservingTool)
            .buttonStyle(GoAccentButtonStyle())
            if store.isReservingTool {
                ProgressView(store.localized("home.reserving_tool", fallback: "Reserving tool..."))
                    .font(.caption)
            }

            ForEach(store.toolRentalReservations.prefix(3)) { reservation in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(reservation.toolTitle) · \(reservation.ownerName)")
                        .font(.subheadline.weight(.semibold))
                    Text("\(store.localized("home.deposit", fallback: "Deposit:")) \(reservation.depositStatus) · \(store.localized("home.dispute", fallback: "Dispute:")) \(reservation.disputeStatus)")
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                    Text("\(store.localized("home.payment_prefix", fallback: "Payment:")) \(reservation.paymentStatus ?? (reservation.paymentAuthorized ? store.localized("home.payment_authorized", fallback: "authorized") : store.localized("home.payment_pending", fallback: "pending")))")
                        .font(.caption2)
                        .foregroundStyle(OneTheme.muted)
                    HStack {
                        Button(store.localized("home.pickup", fallback: "Pickup")) { store.confirmToolPickup(reservation.id) }.buttonStyle(.bordered)
                        Button(store.localized("home.return", fallback: "Return")) { store.confirmToolReturn(reservation.id) }.buttonStyle(.bordered)
                        Button(store.localized("home.cancel", fallback: "Cancel")) {
                            Task { await store.cancelToolReservationServerFirst(reservation.id) }
                        }
                        .disabled(store.isUpdatingTool)
                        .buttonStyle(.bordered)
                        Button(reservation.disputeStatus == "Open" ? store.localized("home.resolve_dispute", fallback: "Resolve Dispute") : store.localized("home.open_dispute", fallback: "Open Dispute")) {
                            if reservation.disputeStatus == "Open" {
                                store.setToolDispute(reservation.id, open: false)
                            } else {
                                let detail = damageNotes[reservation.id] ?? reservation.damageNotes
                                Task { await store.openToolDamageDisputeServerFirst(reservation.id, description: detail.isEmpty ? "Customer opened a rental dispute." : detail) }
                            }
                        }
                        .disabled(store.isUpdatingTool)
                        .buttonStyle(.bordered)
                    }
                    TextField(store.localized("home.damage_assessment", fallback: "Damage assessment"), text: Binding(
                        get: { damageNotes[reservation.id] ?? reservation.damageNotes },
                        set: { damageNotes[reservation.id] = $0 }
                    ))
                    .padding(8)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Button(store.localized("home.save_damage_notes", fallback: "Save Damage Notes")) {
                        store.assessToolDamage(reservation.id, notes: damageNotes[reservation.id] ?? reservation.damageNotes)
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.vertical, 4)
            }
            if store.hasMoreRentals {
                Button(store.isLoadingMoreRentals ? store.localized("home.loading", fallback: "Loading...") : store.localized("home.load_more_rentals", fallback: "Load More Rentals")) {
                    Task { await store.loadMoreRentals() }
                }
                .disabled(store.isLoadingMoreRentals)
                .buttonStyle(.bordered)
            }
            if let error = store.lastToolError {
                HStack {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                    Spacer()
                    Button(store.localized("home.retry_rental_sync", fallback: "Retry Rental Sync")) {
                        Task { await store.refreshCustomerTransactionData() }
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }
}
