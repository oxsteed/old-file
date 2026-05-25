# OxSteed One iOS App — Production Readiness Implementation Plan

**Target:** Transform the iOS app from 35% production-ready (95% UI, 5% API integration) to **MVP-production-ready** (80% complete, all critical paths functional).

**Timeline:** ~6 weeks of focused implementation across 7 sequential phases.

**Current State:**
- ✅ Auth works (login/register with API)
- ✅ Some operations work (job posting, bid acceptance, bookings)
- ✅ Data persistence layer complete (OneSessionVault)
- ✅ UI scaffolding pixel-perfect (all 5 tabs, 7 personas)
- ❌ 60% of forms don't submit to API
- ❌ No data fetching on app launch (all data is seeded mock)
- ❌ No image upload
- ❌ No real-time messaging
- ❌ 90% of UI strings hardcoded in English

---

## Phase 1: Data Fetching & Sync on App Launch

**Objective:** Fetch real data from the backend when app launches. Convert hardcoded mock data into API-driven data.

**Effort:** 10–12 hours (can be done in parallel with other phases after setup)

**Deliverables:**
- `GET /me` endpoint (user profile + available personas/businesses)
- `GET /jobs` with pagination (for helper job feed)
- `GET /my-jobs` with status filter (for customer job view)
- `GET /bids?job_id=...` (for customer bid list)
- `GET /bookings?role=...` (service bookings by persona)
- `GET /rentals` (available tool rentals)
- `GET /life-log` (historical life entries for LIFE tab)
- `GET /sinking-funds` (list of user's sinking funds)
- `GET /messages` or `/inbox` (thread list)
- App shows loading spinners while fetching; displays cached data if offline

### Step 1.1: Add Data Fetch Methods to OneStore

Open `Sources/Stores/OneStore.swift` and add these async methods:

```swift
// MARK: - Data Fetching

@MainActor
func fetchMyProfile() async {
    do {
        let me: OneUserProfile = try await api.get("/me")
        personaContext.userID = me.userID
        personaContext.userEmail = me.email
        personaContext.activePersona = me.defaultPersona ?? .customer
        // Update available personas/businesses from API response
        availableBusinesses = me.businesses ?? []
        OneSessionVault.savePersonaContext(personaContext)
    } catch {
        authStatusMessage = "Failed to load profile. Using cached data."
    }
}

@MainActor
func fetchHelperJobFeed(page: Int = 1, radius: Int = 25) async {
    guard activePersona == .helper else { return }
    isFetchingJobs = true
    defer { isFetchingJobs = false }
    do {
        let response: OneJobListResponse = try await api.get("/jobs?page=\(page)&radius=\(radius)&status=published")
        if page == 1 {
            customerJobs = response.jobs.map { dto in
                CustomerJobPost(
                    id: uuidFromString(dto.id) ?? UUID(),
                    remoteJobID: dto.id,
                    title: dto.title ?? "Untitled",
                    category: dto.category ?? "General",
                    locationQuery: dto.locationCity ?? "Unknown",
                    address: dto.locationAddress ?? "",
                    details: dto.description ?? "",
                    photos: dto.mediaUrls ?? [],
                    status: mapJobStatus(dto.status),
                    createdAt: Date()
                )
            }
        } else {
            customerJobs.append(contentsOf: response.jobs.map { dto in
                CustomerJobPost(
                    id: uuidFromString(dto.id) ?? UUID(),
                    remoteJobID: dto.id,
                    title: dto.title ?? "Untitled",
                    category: dto.category ?? "General",
                    locationQuery: dto.locationCity ?? "Unknown",
                    address: dto.locationAddress ?? "",
                    details: dto.description ?? "",
                    photos: dto.mediaUrls ?? [],
                    status: mapJobStatus(dto.status),
                    createdAt: Date()
                )
            })
        }
        hasMoreJobs = (response.jobs.count ?? 0) >= jobPageSize
        OneSessionVault.saveCustomerJobs(customerJobs)
    } catch {
        lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Failed to load jobs.")
    }
}

@MainActor
func fetchMyJobs(status: String? = nil) async {
    guard activePersona == .customer else { return }
    isFetchingJobs = true
    defer { isFetchingJobs = false }
    do {
        let path = status != nil ? "/my-jobs?status=\(status!)" : "/my-jobs"
        let response: OneJobListResponse = try await api.get(path)
        customerJobs = response.jobs.map { dto in
            CustomerJobPost(
                id: uuidFromString(dto.id) ?? UUID(),
                remoteJobID: dto.id,
                title: dto.title ?? "Untitled",
                category: dto.category ?? "General",
                locationQuery: dto.locationCity ?? "Unknown",
                address: dto.locationAddress ?? "",
                details: dto.description ?? "",
                photos: dto.mediaUrls ?? [],
                status: mapJobStatus(dto.status),
                createdAt: Date()
            )
        }
        OneSessionVault.saveCustomerJobs(customerJobs)
    } catch {
        lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Failed to load your jobs.")
    }
}

@MainActor
func fetchBidsForJob(_ jobID: UUID) async {
    isFetchingBids = true
    defer { isFetchingBids = false }
    guard let remoteID = customerJobs.first(where: { $0.id == jobID })?.remoteJobID else { return }
    do {
        let response: OneBidListResponse = try await api.get("/bids?job_id=\(remoteID)")
        jobBids.append(contentsOf: response.bids.map { dto in
            JobBid(
                id: uuidFromString(dto.id) ?? UUID(),
                jobID: jobID,
                helperID: uuidFromString(dto.helperID) ?? UUID(),
                helperName: dto.helperName ?? "Unknown",
                amount: Double(dto.amount ?? 0),
                timeEstimate: dto.timeEstimate ?? "TBD",
                accepted: dto.accepted ?? false,
                createdAt: Date()
            )
        })
        OneSessionVault.saveJobBids(jobBids)
    } catch {
        lastBidError = OneErrorMapper.userMessage(for: error, fallback: "Failed to load bids.")
    }
}

@MainActor
func fetchServiceBookings() async {
    isCreatingBooking = true
    defer { isCreatingBooking = false }
    do {
        let response: OneBookingListResponse = try await api.get("/bookings?role=\(activePersona.apiRole)")
        customerServiceBookings = response.bookings.map { dto in
            CustomerServiceBooking(
                id: uuidFromString(dto.id) ?? UUID(),
                remoteBookingID: dto.id,
                helperID: uuidFromString(dto.helperID) ?? UUID(),
                helperName: dto.helperName ?? "Unknown",
                serviceType: dto.serviceName ?? "Service",
                scheduledDate: parseDate(dto.requestedDate) ?? Date(),
                scheduledSlot: dto.requestedStartTime ?? "TBD",
                paymentAuthorized: true,
                preMessage: dto.description ?? "",
                postMessage: "",
                reminderEnabled: true,
                status: dto.status ?? "Scheduled",
                reviewRating: nil,
                reviewComment: nil
            )
        }
        OneSessionVault.saveCustomerServiceBookings(customerServiceBookings)
    } catch {
        lastBookingError = OneErrorMapper.userMessage(for: error, fallback: "Failed to load bookings.")
    }
}

@MainActor
func fetchRentalTools(page: Int = 1) async {
    isReservingTool = true
    defer { isReservingTool = false }
    do {
        let response: OneToolListResponse = try await api.get("/rentals?page=\(page)")
        if page == 1 {
            rentalTools = response.tools.map { dto in
                RentalTool(
                    id: uuidFromString(dto.id) ?? UUID(),
                    title: dto.title ?? "Tool",
                    ownerName: dto.ownerName ?? "Unknown",
                    city: dto.city ?? "Unknown",
                    dailyRate: Double(dto.dailyRate ?? 0),
                    deposit: Double(dto.deposit ?? 0),
                    terms: dto.terms ?? "",
                    availableSlots: dto.availableSlots ?? []
                )
            }
        } else {
            rentalTools.append(contentsOf: response.tools.map { dto in
                RentalTool(
                    id: uuidFromString(dto.id) ?? UUID(),
                    title: dto.title ?? "Tool",
                    ownerName: dto.ownerName ?? "Unknown",
                    city: dto.city ?? "Unknown",
                    dailyRate: Double(dto.dailyRate ?? 0),
                    deposit: Double(dto.deposit ?? 0),
                    terms: dto.terms ?? "",
                    availableSlots: dto.availableSlots ?? []
                )
            })
        }
        hasMoreRentals = (response.tools.count ?? 0) >= rentalPage
        OneSessionVault.saveRentalTools(rentalTools)
    } catch {
        lastToolError = OneErrorMapper.userMessage(for: error, fallback: "Failed to load tools.")
    }
}

@MainActor
func fetchLifeLogHistory() async {
    do {
        let response: OneLifeLogResponse = try await api.get("/life-log")
        lifeLogEntries = response.entries.map { dto in
            LifeLogEntry(
                id: uuidFromString(dto.id) ?? UUID(),
                pillarID: dto.pillarID,
                title: dto.title,
                detail: dto.detail,
                createdAt: parseDate(dto.createdAt) ?? Date()
            )
        }
        OneSessionVault.saveLifeLogEntries(lifeLogEntries)
    } catch {
        authStatusMessage = "Failed to load life log history."
    }
}

@MainActor
func fetchSinkingFunds() async {
    do {
        let response: OneSinkingFundResponse = try await api.get("/sinking-funds")
        sinkingFunds = response.funds.map { dto in
            SinkingFund(
                id: uuidFromString(dto.id) ?? UUID(),
                title: dto.title,
                targetAmount: Double(dto.targetAmount),
                currentAmount: Double(dto.currentAmount),
                targetDate: parseDate(dto.targetDate) ?? Date().addingTimeInterval(30 * 86400)
            )
        }
        OneSessionVault.saveSinkingFunds(sinkingFunds)
    } catch {
        authStatusMessage = "Failed to load sinking funds."
    }
}

@MainActor
func fetchUnifiedInbox() async {
    do {
        let response: OneInboxResponse = try await api.get("/messages")
        unifiedInboxThreads = response.threads.map { dto in
            UnifiedThread(
                id: dto.id,
                title: dto.participantName ?? "Unknown",
                lastMessage: dto.lastMessage ?? "",
                personaSource: dto.personaSource ?? activePersona.label,
                unreadCount: dto.unreadCount ?? 0
            )
        }
        OneSessionVault.saveUnifiedThreads(unifiedInboxThreads)
    } catch {
        authStatusMessage = "Failed to load messages."
    }
}
```

### Step 1.2: Call Fetch Methods on App Launch

In `restoreSession()`, add fetch calls after auth check:

```swift
func restoreSession() {
    if token == nil, let saved = OneSessionVault.loadSession() {
        token = saved.token
    }
    if isAuthenticated {
        Task {
            // Fetch fresh data on app launch
            await fetchMyProfile()
            
            // Fetch persona-specific data
            switch activePersona {
            case .customer:
                await fetchMyJobs()
                await fetchServiceBookings()
                await fetchRentalTools()
            case .helper:
                await fetchHelperJobFeed()
            case .businessOwner, .consultant, .toolOwner, .franchiseOwner, .investor:
                break // Implement persona-specific fetches in later phases
            }
            
            // Universal data (all personas)
            await fetchLifeLogHistory()
            await fetchSinkingFunds()
            await fetchUnifiedInbox()
            
            await refreshCustomerTransactionData()
            await syncPendingChanges()
        }
        startPeriodicSyncIfNeeded()
    }
    // ... rest of method
}
```

### Step 1.3: Add Data Models to OneAPIModels.swift

Add these response DTOs:

```swift
// MARK: - User Profile

struct OneUserProfile: Decodable {
    let userID: String
    let email: String
    let firstName: String?
    let lastName: String?
    let defaultPersona: AppPersona?
    let businesses: [BusinessRef]?
}

// MARK: - Job Responses

struct OneJobListResponse: Decodable {
    let jobs: [OneJobDTO]
    let total: Int?
    let hasMore: Bool?
}

struct OneBidListResponse: Decodable {
    let bids: [OneBidDTO]
    let total: Int?
}

struct OneBidDTO: Decodable {
    let id: String
    let jobID: String?
    let helperID: String
    let helperName: String?
    let amount: Int?
    let timeEstimate: String?
    let accepted: Bool?
}

// MARK: - Booking Response

struct OneBookingListResponse: Decodable {
    let bookings: [OneBookingDTO]
    let total: Int?
}

struct OneBookingDTO: Decodable {
    let id: String
    let helperID: String
    let helperName: String?
    let serviceName: String?
    let requestedDate: String
    let requestedStartTime: String?
    let description: String?
    let status: String?
}

// MARK: - Tool Rental Response

struct OneToolListResponse: Decodable {
    let tools: [OneToolDTO]
    let total: Int?
}

struct OneToolDTO: Decodable {
    let id: String
    let title: String?
    let ownerName: String?
    let city: String?
    let dailyRate: Int?
    let deposit: Int?
    let terms: String?
    let availableSlots: [String]?
}

// MARK: - Life Log & Sinking Funds

struct OneLifeLogResponse: Decodable {
    let entries: [OneLifeLogDTO]
}

struct OneLifeLogDTO: Decodable {
    let id: String
    let pillarID: String
    let title: String
    let detail: String
    let createdAt: String?
}

struct OneSinkingFundResponse: Decodable {
    let funds: [OneSinkingFundDTO]
}

struct OneSinkingFundDTO: Decodable {
    let id: String
    let title: String
    let targetAmount: Int
    let currentAmount: Int
    let targetDate: String
}

// MARK: - Inbox

struct OneInboxResponse: Decodable {
    let threads: [OneInboxDTO]
}

struct OneInboxDTO: Decodable {
    let id: Int
    let participantName: String?
    let lastMessage: String?
    let personaSource: String?
    let unreadCount: Int?
}
```

### Step 1.4: Add Loading States to Views

Update `TodayView`, `HireView`, `ShopView`, `InboxView` to show loading spinners while data fetches:

In **TodayView**, wrap the home sections content:

```swift
var body: some View {
    GoScreen(title: "Home", showsTitle: false) {
        header
        
        // Show loading spinner while fetching
        if store.isFetchingJobs && store.customerJobs.isEmpty {
            ProgressView("Loading your jobs...")
                .padding()
        } else {
            // Render home sections...
        }
    }
}
```

### Step 1.5: Testing Checklist

- [ ] App launches and shows loading spinners
- [ ] After fetch completes, real data displays (not hardcoded)
- [ ] Switch persona: HOME tab reloads and fetches persona-specific data
- [ ] Go offline: app shows cached data, no loading spinner
- [ ] Go back online: pending sync triggers, data refreshes
- [ ] Each fetch method has error message in `authStatusMessage` or `lastJobError`
- [ ] Pagination works (Load More button fetches next page)

---

## Phase 2: Complete Form Submissions & Error Handling

**Objective:** Wire all remaining forms to API calls. Every button that creates/updates/deletes should call the backend and show loading/error states.

**Effort:** 14–16 hours

**Deliverables:**
- Business Ascension application submission
- Wholesale Groups join/leave
- Financing pre-qualification submission
- Grants application submission
- Creator upload submission
- Service booking submission (fix existing)
- Tool rental reservation submission
- Review submission
- All forms show loading state while submitting
- All errors show user-friendly message + retry option

### Step 2.1: Business Ascension Application Submission

In `OneStore.swift`, add:

```swift
@MainActor
func submitAscensionApplication(
    companyName: String,
    description: String,
    yearsInBusiness: Int,
    employees: Int
) async {
    isSubmittingCustomerJob = true // Reuse existing flag
    lastJobError = nil
    defer { isSubmittingCustomerJob = false }
    
    let request: [String: Any] = [
        "company_name": companyName,
        "description": description,
        "years_in_business": yearsInBusiness,
        "num_employees": employees,
        "persona": activePersona.apiRole
    ]
    
    do {
        let payload = try JSONSerialization.data(withJSONObject: request, options: [])
        let response: OneGenericSuccessResponse = try await api.postRaw("/ascension/apply", bodyData: payload)
        
        ascensionApplication.status = "Submitted"
        ascensionApplication.companyName = companyName
        OneSessionVault.loadAscensionApplication() // Simulate persistence
        customerJobFlowMessage = "Application submitted successfully. Check Growth tab for next steps."
    } catch {
        lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Application submission failed. Please try again.")
        enqueueForRetry(path: "/ascension/apply", method: .post, jsonObject: request)
    }
}
```

In `ShopView.swift`, update the Ascension form submission button:

```swift
Button {
    Task {
        await store.submitAscensionApplication(
            companyName: ascensionCompanyName,
            description: ascensionDescription,
            yearsInBusiness: Int(ascensionYears) ?? 0,
            employees: Int(ascensionEmployees) ?? 0
        )
    }
} label: {
    if store.isSubmittingCustomerJob {
        ProgressView()
            .frame(maxWidth: .infinity)
    } else {
        Text("Submit Application")
            .frame(maxWidth: .infinity)
    }
}
.disabled(store.isSubmittingCustomerJob)
.buttonStyle(GoAccentButtonStyle())

if let error = store.lastJobError {
    Text(error)
        .font(.caption)
        .foregroundStyle(.red)
    Button("Retry") {
        Task {
            await store.submitAscensionApplication(...)
        }
    }
    .buttonStyle(.bordered)
}
```

### Step 2.2: Wholesale Groups Join/Leave

Add to `OneStore.swift`:

```swift
@MainActor
func joinWholesaleGroup(_ groupID: UUID) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    defer { isSubmittingCustomerJob = false }
    
    let request = OneJoinWholesaleRequest(groupID: groupID.uuidString, persona: activePersona.apiRole)
    
    do {
        let _: OneGenericSuccessResponse = try await api.post("/wholesale/join", body: request)
        if let idx = wholesaleGroups.firstIndex(where: { $0.id == groupID }) {
            wholesaleGroups[idx].memberCount += 1
            wholesaleGroups[idx].isMember = true
        }
        OneSessionVault.saveWholesaleGroups(wholesaleGroups)
        customerJobFlowMessage = "Joined wholesale group successfully."
    } catch {
        lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Join failed. Please try again.")
        let request: [String: Any] = ["group_id": groupID.uuidString, "persona": activePersona.apiRole]
        enqueueForRetry(path: "/wholesale/join", method: .post, jsonObject: request)
    }
}

@MainActor
func leaveWholesaleGroup(_ groupID: UUID) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    defer { isSubmittingCustomerJob = false }
    
    do {
        let _: OneGenericSuccessResponse = try await api.post("/wholesale/leave", body: ["group_id": groupID.uuidString])
        if let idx = wholesaleGroups.firstIndex(where: { $0.id == groupID }) {
            wholesaleGroups[idx].memberCount = max(0, wholesaleGroups[idx].memberCount - 1)
            wholesaleGroups[idx].isMember = false
        }
        OneSessionVault.saveWholesaleGroups(wholesaleGroups)
        customerJobFlowMessage = "Left wholesale group."
    } catch {
        lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Leave failed. Please try again.")
    }
}
```

Add request model to `OneAPIModels.swift`:

```swift
struct OneJoinWholesaleRequest: Encodable {
    let groupID: String
    let persona: String
    
    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case persona
    }
}
```

### Step 2.3: Financing Pre-Qualification Submission

```swift
@MainActor
func submitFinancingPrequalification(
    businessName: String,
    loanAmount: Double,
    purpose: String
) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    defer { isSubmittingCustomerJob = false }
    
    let request: [String: Any] = [
        "business_name": businessName,
        "loan_amount": Int(loanAmount * 100), // cents
        "purpose": purpose,
        "persona": activePersona.apiRole
    ]
    
    do {
        let payload = try JSONSerialization.data(withJSONObject: request, options: [])
        let _: OneGenericSuccessResponse = try await api.postRaw("/financing/prequalify", bodyData: payload)
        financingPrequal.status = "Submitted"
        OneSessionVault.saveFinancingPrequal(financingPrequal)
        customerJobFlowMessage = "Pre-qualification submitted. You'll hear back within 5 business days."
    } catch {
        lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Submission failed. Please try again.")
        enqueueForRetry(path: "/financing/prequalify", method: .post, jsonObject: request)
    }
}
```

### Step 2.4: Grants Application

```swift
@MainActor
func applyForGrant(_ grantID: UUID) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    defer { isSubmittingCustomerJob = false }
    
    let request: [String: Any] = ["grant_id": grantID.uuidString, "persona": activePersona.apiRole]
    
    do {
        let payload = try JSONSerialization.data(withJSONObject: request, options: [])
        let _: OneGenericSuccessResponse = try await api.postRaw("/grants/apply", bodyData: payload)
        customerJobFlowMessage = "Application submitted successfully."
    } catch {
        lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Application failed. Please try again.")
        enqueueForRetry(path: "/grants/apply", method: .post, jsonObject: request)
    }
}
```

### Step 2.5: Creator Upload Submission

```swift
@MainActor
func submitCreatorUpload(
    title: String,
    description: String,
    videoURL: String // S3 URL from Phase 3
) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    defer { isSubmittingCustomerJob = false }
    
    let request: [String: Any] = [
        "title": title,
        "description": description,
        "video_url": videoURL,
        "language": appLanguage.rawValue
    ]
    
    do {
        let payload = try JSONSerialization.data(withJSONObject: request, options: [])
        let response: OneCreatorUploadResponse = try await api.postRaw("/uploads/create", bodyData: payload)
        
        creatorUploads.insert(
            CreatorUploadItem(
                id: uuidFromString(response.uploadID) ?? UUID(),
                title: title,
                language: appLanguage,
                status: .pending
            ),
            at: 0
        )
        OneSessionVault.saveCreatorUploads(creatorUploads)
        customerJobFlowMessage = "Upload submitted for moderation."
    } catch {
        lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Upload failed. Please try again.")
    }
}
```

### Step 2.6: Tool Rental Reservation (Fix Existing)

Update `createToolRentalReservationServerFirst`:

```swift
@MainActor
func createToolRentalReservationServerFirst(
    toolID: UUID,
    pickupDate: Date,
    returnDate: Date,
    paymentAuthorized: Bool
) async {
    let canProceed = await authorizeSensitiveAction(reason: "Authorize tool rental reservation and deposit hold")
    guard canProceed else {
        lastToolError = "Biometric confirmation required."
        return
    }
    
    lastToolError = nil
    isReservingTool = true
    defer { isReservingTool = false }
    
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    
    let request: [String: Any] = [
        "tool_id": toolID.uuidString,
        "pickup_date": formatter.string(from: pickupDate),
        "return_date": formatter.string(from: returnDate),
        "payment_authorized": paymentAuthorized
    ]
    
    do {
        let payload = try JSONSerialization.data(withJSONObject: request, options: [])
        let response: OneToolReservationResponse = try await api.postRaw("/rentals/reserve", bodyData: payload)
        
        guard let tool = rentalTools.first(where: { $0.id == toolID }) else { return }
        
        toolRentalReservations.insert(
            ToolRentalReservation(
                id: uuidFromString(response.reservationID) ?? UUID(),
                toolID: toolID,
                toolTitle: tool.title,
                pickupDate: pickupDate,
                returnDate: returnDate,
                dailyRate: tool.dailyRate,
                depositHeld: tool.deposit,
                pickupConfirmed: false,
                returnConfirmed: false,
                damageReported: false,
                status: "Confirmed"
            ),
            at: 0
        )
        OneSessionVault.saveToolRentalReservations(toolRentalReservations)
        customerJobFlowMessage = "Tool reserved successfully. Pickup is \(formatter.string(from: pickupDate))."
    } catch {
        lastToolError = OneErrorMapper.userMessage(for: error, fallback: "Reservation failed. Please try again.")
        enqueueForRetry(path: "/rentals/reserve", method: .post, jsonObject: request)
    }
}
```

### Step 2.7: Review Submission (Two-Way Reviews)

```swift
@MainActor
func submitReview(
    targetUserID: UUID,
    rating: Int,
    comment: String,
    fromRole: String,
    toRole: String
) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    defer { isSubmittingCustomerJob = false }
    
    let request: [String: Any] = [
        "target_user_id": targetUserID.uuidString,
        "rating": max(1, min(5, rating)),
        "comment": comment,
        "from_role": fromRole,
        "to_role": toRole
    ]
    
    do {
        let payload = try JSONSerialization.data(withJSONObject: request, options: [])
        let _: OneGenericSuccessResponse = try await api.postRaw("/reviews/submit", bodyData: payload)
        
        reviews.insert(
            TwoWayReview(
                id: UUID(),
                fromRole: fromRole,
                toRole: toRole,
                rating: max(1, min(5, rating)),
                comment: comment,
                createdAt: Date()
            ),
            at: 0
        )
        OneSessionVault.saveReviews(reviews)
        customerJobFlowMessage = "Review submitted successfully."
    } catch {
        lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Review submission failed. Please try again.")
        enqueueForRetry(path: "/reviews/submit", method: .post, jsonObject: request)
    }
}
```

### Step 2.8: Testing Checklist

- [ ] Business Ascension: fill form, submit, see loading spinner, get success/error message
- [ ] Wholesale Group: join/leave, member count updates, success message shown
- [ ] Financing: submit form, get success/error
- [ ] Grants: apply, get success/error
- [ ] Creator Upload: submit (with mock video URL for now), get moderation status
- [ ] Tool Rental: reserve, get confirmation
- [ ] Reviews: submit rating, see it in list
- [ ] All forms show loading state on submit button
- [ ] All errors show retry button (if not permanently failed)
- [ ] Offline mode: form queues for sync instead of erroring

---

## Phase 3: Image Upload & Media Handling

**Objective:** Users can upload photos/videos. Images are uploaded to S3, URLs stored in API, displayed in app.

**Effort:** 12–14 hours

**Deliverables:**
- Image picker integration (PHPickerViewController on iOS)
- S3 presigned URL request
- Multipart image upload to S3
- Video upload for creator uploads
- Image display in all views (job photos, profile images, tool photos)
- Upload progress indicator

### Step 3.1: Add Image Picker to OneStore

```swift
import PhotosUI

@MainActor
class OneStore: NSObject, PHPickerViewControllerDelegate {
    // ... existing code ...
    
    var selectedPhotos: [UIImage] = []
    var isUploadingImages = false
    var uploadProgress: Double = 0.0
    
    func presentImagePicker() async -> [UIImage] {
        var config = PHPickerConfiguration()
        config.selectionLimit = 5 // Max 5 photos per job
        config.preferredAssetRepresentationMode = .current
        config.filter = .images
        
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        
        // Present picker (requires accessing view controller, handled in UI layer)
        return []
    }
    
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        selectedPhotos = []
        for result in results {
            result.itemProvider.loadObject(ofClass: UIImage.self) { image, _ in
                if let uiImage = image as? UIImage {
                    Task { @MainActor [weak self] in
                        self?.selectedPhotos.append(uiImage)
                    }
                }
            }
        }
    }
    
    @MainActor
    func uploadPhotosAndGetURLs(_ images: [UIImage]) async -> [String] {
        isUploadingImages = true
        defer { isUploadingImages = false }
        
        var uploadedURLs: [String] = []
        
        for (index, image) in images.enumerated() {
            uploadProgress = Double(index) / Double(images.count)
            
            // Request presigned URL from backend
            do {
                let response: OnePresignedURLResponse = try await api.post(
                    "/media/presigned-url",
                    body: OnePresignedURLRequest(
                        filename: "job-photo-\(UUID().uuidString).jpg",
                        contentType: "image/jpeg"
                    )
                )
                
                // Compress image
                guard let jpegData = image.jpegData(compressionQuality: 0.7) else { continue }
                
                // Upload to S3 using presigned URL
                let success = try await uploadToS3(
                    url: URL(string: response.presignedURL)!,
                    data: jpegData,
                    contentType: "image/jpeg"
                )
                
                if success {
                    uploadedURLs.append(response.publicURL)
                }
            } catch {
                authStatusMessage = "Image upload failed for photo \(index + 1)."
            }
        }
        
        uploadProgress = 1.0
        return uploadedURLs
    }
    
    private func uploadToS3(url: URL, data: Data, contentType: String) async throws -> Bool {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { return false }
        return (200..<300).contains(http.statusCode)
    }
}

// Request/Response models for S3

struct OnePresignedURLRequest: Encodable {
    let filename: String
    let contentType: String
    
    enum CodingKeys: String, CodingKey {
        case filename = "file_name"
        case contentType = "content_type"
    }
}

struct OnePresignedURLResponse: Decodable {
    let presignedURL: String
    let publicURL: String
    
    enum CodingKeys: String, CodingKey {
        case presignedURL = "presigned_url"
        case publicURL = "public_url"
    }
}

struct OneCreatorUploadResponse: Decodable {
    let uploadID: String
    
    enum CodingKeys: String, CodingKey {
        case uploadID = "upload_id"
    }
}

struct OneToolReservationResponse: Decodable {
    let reservationID: String
    
    enum CodingKeys: String, CodingKey {
        case reservationID = "reservation_id"
    }
}
```

### Step 3.2: Wire Image Picker to Job Posting Form

In `TodayView`, update the job posting form:

```swift
@State private var selectedJobPhotos: [UIImage] = []
@State private var showImagePicker = false

// In form:
VStack(alignment: .leading, spacing: 8) {
    Text("Photos (up to 5)")
        .font(.subheadline.weight(.semibold))
    
    if selectedJobPhotos.isEmpty {
        Button(action: { showImagePicker = true }) {
            Label("Add Photos", systemImage: "photo.badge.plus")
        }
        .buttonStyle(.bordered)
    } else {
        ScrollView(.horizontal) {
            HStack {
                ForEach(0..<selectedJobPhotos.count, id: \.self) { idx in
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: selectedJobPhotos[idx])
                            .resizable()
                            .scaledToFill()
                            .frame(width: 80, height: 80)
                            .clipped()
                        
                        Button(action: { selectedJobPhotos.remove(at: idx) }) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.red)
                        }
                        .padding(4)
                    }
                }
            }
        }
    }
}
.sheet(isPresented: $showImagePicker) {
    // Present PHPickerViewController
    // (Requires UIViewControllerRepresentable wrapper)
}

// Update job posting submission:
Button {
    Task {
        // Upload photos first
        let photoURLs = await store.uploadPhotosAndGetURLs(selectedJobPhotos)
        
        // Then post job with photo URLs
        await store.postCustomerJobServerFirst(
            title: postTitle,
            category: postCategory,
            locationQuery: postLocation,
            address: postAddress,
            details: postDetails,
            photos: photoURLs
        )
    }
} label: {
    if store.isPostingJob || store.isUploadingImages {
        ProgressView()
            .frame(maxWidth: .infinity)
    } else {
        Text("Publish Job")
            .frame(maxWidth: .infinity)
    }
}
.disabled(store.isPostingJob || store.isUploadingImages)
.buttonStyle(GoAccentButtonStyle())

if store.uploadProgress > 0 && store.uploadProgress < 1 {
    ProgressView(value: store.uploadProgress)
        .padding()
}
```

### Step 3.3: Display Images in Views

Update `TodayView` to show job photos:

```swift
if !job.photos.isEmpty {
    ScrollView(.horizontal) {
        HStack {
            ForEach(job.photos, id: \.self) { photoURL in
                AsyncImage(url: URL(string: photoURL)) { image in
                    image
                        .resizable()
                        .scaledToFill()
                } placeholder: {
                    ProgressView()
                }
                .frame(height: 150)
                .clipped()
            }
        }
    }
}
```

### Step 3.4: Creator Upload with Video

Update creator upload form to include video:

```swift
@State private var selectedVideo: URL?
@State private var showVideoPicker = false

// Form:
VStack {
    TextField("Video title", text: $creatorTitle)
    TextField("Description", text: $creatorDescription, axis: .vertical)
    
    if selectedVideo != nil {
        Text("✓ Video selected")
            .foregroundStyle(.green)
    } else {
        Button("Select Video", action: { showVideoPicker = true })
            .buttonStyle(.bordered)
    }
    
    Button {
        Task {
            if let videoURL = selectedVideo {
                let uploadedURL = await store.uploadVideoToS3(videoURL)
                await store.submitCreatorUpload(
                    title: creatorTitle,
                    description: creatorDescription,
                    videoURL: uploadedURL
                )
            }
        }
    } label: {
        if store.isSubmittingCustomerJob {
            ProgressView()
                .frame(maxWidth: .infinity)
        } else {
            Text("Submit for Review")
                .frame(maxWidth: .infinity)
        }
    }
    .disabled(store.isSubmittingCustomerJob || selectedVideo == nil)
    .buttonStyle(GoAccentButtonStyle())
}
```

Add video upload to OneStore:

```swift
private func uploadVideoToS3(_ videoURL: URL) async -> String {
    // Similar to image upload but with video file
    // Returns public S3 URL
    return ""
}
```

### Step 3.5: Testing Checklist

- [ ] Image picker opens, select 3 photos
- [ ] Photos display as thumbnails in form
- [ ] Delete photo button removes it
- [ ] Post job: images upload to S3, URLs stored in API
- [ ] Refresh jobs list: photos display in job cards
- [ ] Creator upload: select video, upload, get moderation status
- [ ] Offline mode: queues image upload for retry when online
- [ ] Upload progress indicator shows (at least 0% → 100%)

---

## Phase 4: Real-Time Messaging & Notifications

**Objective:** Users can send/receive messages. Notifications pushed to device when new messages arrive.

**Effort:** 16–18 hours (most complex phase)

**Deliverables:**
- Message sending API call
- Message polling (if no WebSocket available) or WebSocket connection
- Push notification infrastructure setup
- Notification badge on inbox tab
- Deep linking from notification to chat thread
- Message history pagination

### Step 4.1: Add Message Sending

In `OneStore.swift`:

```swift
@MainActor
func sendMessage(toUserID: UUID, threadID: Int, content: String, persona: AppPersona) async {
    guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    
    let request: [String: Any] = [
        "thread_id": threadID,
        "to_user_id": toUserID.uuidString,
        "content": content,
        "persona_source": persona.label
    ]
    
    do {
        let payload = try JSONSerialization.data(withJSONObject: request, options: [])
        let _: OneGenericSuccessResponse = try await api.postRaw("/messages/send", bodyData: payload)
        
        // Add message to local thread
        if let threadIdx = unifiedInboxThreads.firstIndex(where: { $0.id == threadID }) {
            unifiedInboxThreads[threadIdx].lastMessage = content
        }
        OneSessionVault.saveUnifiedThreads(unifiedInboxThreads)
    } catch {
        authStatusMessage = "Message send failed. Please try again."
        enqueueForRetry(path: "/messages/send", method: .post, jsonObject: request)
    }
}

@MainActor
func fetchMessageHistory(threadID: Int, limit: Int = 20, offset: Int = 0) async -> [OneMessage] {
    do {
        let response: OneMessageListResponse = try await api.get("/messages/thread/\(threadID)?limit=\(limit)&offset=\(offset)")
        return response.messages
    } catch {
        authStatusMessage = "Failed to load message history."
        return []
    }
}
```

Add message models to `OneAPIModels.swift`:

```swift
struct OneMessage: Decodable, Identifiable, Hashable {
    let id: String
    let threadID: Int
    let senderID: String
    let senderName: String
    let content: String
    let personaSource: String
    let createdAt: String
    let isRead: Bool?
    
    enum CodingKeys: String, CodingKey {
        case id
        case threadID = "thread_id"
        case senderID = "sender_id"
        case senderName = "sender_name"
        case content
        case personaSource = "persona_source"
        case createdAt = "created_at"
        case isRead = "is_read"
    }
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
    
    static func == (lhs: OneMessage, rhs: OneMessage) -> Bool {
        lhs.id == rhs.id
    }
}

struct OneMessageListResponse: Decodable {
    let messages: [OneMessage]
    let total: Int?
    let hasMore: Bool?
}
```

### Step 4.2: Add Message Thread Detail View

Create `InboxThreadView.swift`:

```swift
import SwiftUI

struct InboxThreadView: View {
    @Environment(OneStore.self) private var store
    let thread: UnifiedThread
    
    @State private var messages: [OneMessage] = []
    @State private var messageInput = ""
    @State private var isLoadingMessages = false
    
    var body: some View {
        VStack(spacing: 0) {
            // Message list
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        if isLoadingMessages {
                            ProgressView()
                                .padding()
                        }
                        
                        ForEach(messages) { message in
                            messageRow(message)
                        }
                    }
                    .padding()
                    .onAppear {
                        proxy.scrollTo(messages.last?.id, anchor: .bottom)
                    }
                    .onChange(of: messages) { _, _ in
                        proxy.scrollTo(messages.last?.id, anchor: .bottom)
                    }
                }
            }
            
            // Message input
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    TextField("Message", text: $messageInput, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...5)
                    
                    Button(action: sendMessage) {
                        Image(systemName: "paperplane.fill")
                    }
                    .disabled(messageInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding()
            }
            .background(OneTheme.cardBackground)
        }
        .navigationTitle(thread.title)
        .onAppear {
            Task {
                isLoadingMessages = true
                messages = await store.fetchMessageHistory(threadID: thread.id)
                isLoadingMessages = false
            }
        }
    }
    
    private func messageRow(_ message: OneMessage) -> some View {
        HStack(alignment: .top, spacing: 8) {
            if message.senderID == store.personaContext.userID {
                Spacer()
                VStack(alignment: .trailing) {
                    Text(message.content)
                        .padding(10)
                        .background(OneTheme.amber)
                        .cornerRadius(12)
                    Text(formatTime(message.createdAt))
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                }
            } else {
                VStack(alignment: .leading) {
                    Text(message.senderName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(OneTheme.muted)
                    Text(message.content)
                        .padding(10)
                        .background(Color.gray.opacity(0.2))
                        .cornerRadius(12)
                    Text(formatTime(message.createdAt))
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                }
                Spacer()
            }
        }
        .id(message.id)
    }
    
    private func sendMessage() {
        let msg = messageInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !msg.isEmpty else { return }
        messageInput = ""
        
        // TODO: Implement message sending
    }
    
    private func formatTime(_ iso: String) -> String {
        guard let date = parseDate(iso) else { return "" }
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
```

### Step 4.3: Update InboxView to Link to Thread Detail

In `InboxView.swift`:

```swift
import SwiftUI

struct InboxView: View {
    @Environment(OneStore.self) private var store
    
    var body: some View {
        NavigationStack {
            GoScreen(title: "Learn", showsTitle: true) {
                GoCard {
                    Text("Unified Inbox")
                        .font(.headline)
                    Text("Messages with customers, helpers, and team")
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                }
                
                // Message threads list
                ForEach(store.unifiedInboxThreads) { thread in
                    NavigationLink(destination: InboxThreadView(thread: thread)) {
                        GoCard {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(thread.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(OneTheme.ink)
                                    Text(thread.lastMessage)
                                        .font(.caption)
                                        .foregroundStyle(OneTheme.muted)
                                        .lineLimit(2)
                                }
                                Spacer()
                                if thread.unreadCount > 0 {
                                    Text("\(thread.unreadCount)")
                                        .font(.caption.weight(.bold))
                                        .foregroundStyle(.white)
                                        .padding(6)
                                        .background(.red)
                                        .clipShape(Circle())
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
```

### Step 4.4: Push Notification Setup

In `OneStore.swift`, add notification registration:

```swift
@MainActor
func registerForPushNotifications() async {
    do {
        let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        if granted {
            #if canImport(UIKit)
            UIApplication.shared.registerForRemoteNotifications()
            #endif
            await sendDeviceTokenToServer()
        }
    } catch {
        authStatusMessage = "Push notification permission denied."
    }
}

private func sendDeviceTokenToServer() async {
    // Called after UIApplication:didFinishLaunchingWithOptions: sets device token
    // Sends token to backend for push notification targeting
    guard let token = UserDefaults.standard.string(forKey: "deviceToken") else { return }
    
    let request: [String: Any] = ["device_token": token, "platform": "ios"]
    
    do {
        let payload = try JSONSerialization.data(withJSONObject: request, options: [])
        let _: OneGenericSuccessResponse = try await api.postRaw("/device-tokens/register", bodyData: payload)
    } catch {
        // Silently fail; will retry on next sync
    }
}
```

In `OxSteedOneApp.swift`, add AppDelegate for remote notifications:

```swift
import SwiftUI
import UserNotifications

@main
struct OxSteedOneApp: App {
    @State private var store = OneStore()
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            OneRootView()
                .environment(store)
        }
    }
}

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "deviceToken")
        
        // Send token to server
        Task {
            // Call store method to register device token
        }
    }
    
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("Failed to register for remote notifications: \(error)")
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    // Handle notification when app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let userInfo = notification.request.content.userInfo
        
        // Show notification even when app is in foreground
        return [.banner, .sound, .badge]
    }
    
    // Handle notification tap
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        
        // Deep link to thread
        if let threadID = userInfo["thread_id"] as? String {
            // Navigate to InboxThreadView with threadID
            // (Requires passing state through app navigation)
        }
    }
}
```

### Step 4.5: Testing Checklist

- [ ] Push notification permission prompt appears on first launch
- [ ] Device token is sent to backend
- [ ] Send message from one device, see it appear on another (with poll loop)
- [ ] Receive push notification when new message arrives (requires test setup)
- [ ] Tap notification: deep links to correct message thread
- [ ] Message history loads and displays (pagination works)
- [ ] Unread count shows on inbox tab badge
- [ ] Message sending shows loading state
- [ ] Message input clears after send

---

## Phase 5: Payment Integration & Wallet

**Objective:** Users can manage payout methods, view transaction history, and receive/send money.

**Effort:** 14–16 hours (requires Stripe/payment processor integration)

**Deliverables:**
- Wallet UI with balance display
- Payout method management (bank account, PayPal, Stripe)
- Transaction history with filtering
- Earnings summary by persona
- Payment capture on booking confirmation
- Webhook handling for payment updates

### Step 5.1: Add Wallet Data Fetching

```swift
@MainActor
func fetchWallet() async {
    do {
        let response: OneWalletResponse = try await api.get("/wallet?persona=\(activePersona.apiRole)")
        walletSnapshot.balance = Double(response.balanceCents) / 100.0
        walletSnapshot.pending = Double(response.pendingCents) / 100.0
        walletSnapshot.payoutMethod = response.payoutMethod ?? "none"
        walletSnapshot.lastPayout = parseDate(response.lastPayoutAt) ?? Date()
        OneSessionVault.saveWallet(walletSnapshot)
    } catch {
        authStatusMessage = "Failed to load wallet."
    }
}

@MainActor
func fetchTransactionHistory(limit: Int = 30) async {
    do {
        let response: OneTransactionListResponse = try await api.get("/transactions?limit=\(limit)")
        walletTransactions = response.transactions.map { dto in
            WalletTransaction(
                id: uuidFromString(dto.id) ?? UUID(),
                title: dto.description,
                amount: Double(dto.amountCents) / 100.0,
                timestamp: parseDate(dto.createdAt) ?? Date(),
                isCredit: dto.type == "credit"
            )
        }
        OneSessionVault.saveWalletTransactions(walletTransactions)
    } catch {
        authStatusMessage = "Failed to load transactions."
    }
}
```

### Step 5.2: Add Payout Method Management

```swift
@MainActor
func addPayoutMethod(type: String, accountInfo: [String: String]) async {
    let request: [String: Any] = [
        "type": type, // "bank", "paypal", "stripe"
        "account_info": accountInfo
    ]
    
    do {
        let payload = try JSONSerialization.data(withJSONObject: request, options: [])
        let response: OnePayoutMethodResponse = try await api.postRaw("/payout-methods", bodyData: payload)
        
        walletSnapshot.payoutMethod = response.methodID
        OneSessionVault.saveWallet(walletSnapshot)
        customerJobFlowMessage = "Payout method added successfully."
    } catch {
        authStatusMessage = "Failed to add payout method."
    }
}
```

### Step 5.3: Wallet UI (ProfileView/SettingsView)

```swift
VStack(spacing: 16) {
    GoCard {
        VStack(alignment: .leading, spacing: 12) {
            Text("Available Balance")
                .font(.headline)
            
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("$\(String(format: "%.2f", store.walletSnapshot.balance))")
                        .font(.system(size: 32, weight: .bold))
                        .foregroundStyle(OneTheme.amber)
                    
                    if store.walletSnapshot.pending > 0 {
                        Text("$\(String(format: "%.2f", store.walletSnapshot.pending)) pending")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                }
                Spacer()
            }
            
            Button(action: { /* show transfer/withdraw sheet */ }) {
                Text("Withdraw")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(GoAccentButtonStyle())
        }
    }
    
    GoCard {
        Text("Payout Method")
            .font(.headline)
        Text(store.walletSnapshot.payoutMethod.capitalized)
            .foregroundStyle(OneTheme.muted)
        Button(action: { /* show payout method picker */ }) {
            Text("Change")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
    }
    
    GoCard {
        Text("Transaction History")
            .font(.headline)
        ForEach(store.walletTransactions.prefix(5)) { tx in
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(tx.title)
                        .font(.subheadline)
                    Text(relativeDate(tx.timestamp))
                        .font(.caption)
                        .foregroundStyle(OneTheme.muted)
                }
                Spacer()
                Text("\(tx.isCredit ? "+" : "-")$\(String(format: "%.2f", tx.amount))")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(tx.isCredit ? .green : .red)
            }
            .padding(.vertical, 4)
        }
    }
}
```

### Step 5.4: Testing Checklist

- [ ] Wallet balance displays correctly
- [ ] Add bank account as payout method
- [ ] Transaction history shows recent transactions
- [ ] Filter by transaction type (credit/debit)
- [ ] Earnings summary for Helper persona
- [ ] Payment from booking capture (integration test with mock Stripe)
- [ ] Webhook updates wallet balance (if using real Stripe)

---

## Phase 6: Localization — Replace 90% of Hardcoded Strings

**Objective:** App supports EN/ES/FR/HT. UI strings use i18n keys instead of hardcoded English.

**Effort:** 20–24 hours (tedious, not complex)

**Deliverables:**
- 500+ UI strings → i18n keys
- All 4 locales fully translated (or use machine translation as starting point)
- Locale-aware number/currency/date formatting
- RTL layout support (future-proofing for RTL languages)

### Step 6.1: Audit & Replace Hardcoded Strings

Create a sweeping pass across all View files. Replace:

```swift
// Before
Text("Home")
Text("Fix kitchen sink leak")
Text("Loading your jobs...")

// After
Text(store.localized("nav.home", fallback: "Home"))
Text(store.localized("job.title_placeholder", fallback: "Fix kitchen sink leak"))
Text(store.localized("state.loading_jobs", fallback: "Loading your jobs..."))
```

### Step 6.2: Expand GoLocalization

Update `GoLocalization.swift` with ~500 keys across 4 languages:

```swift
private static let table: [AppLanguage: [String: String]] = [
    .english: [
        // Navigation
        "nav.home": "Home",
        "nav.life": "Life",
        "nav.growth": "Growth",
        "nav.learn": "Learn",
        "nav.settings": "Settings",
        
        // HOME - Customer
        "home.customer.jobs_posted": "Jobs Posted",
        "home.customer.messages": "Messages with Helpers",
        "home.customer.pending_quotes": "Pending Quotes",
        "home.customer.upcoming_bookings": "Upcoming Bookings",
        "home.customer.active_rentals": "Active Rentals",
        
        // Job posting
        "job.title_label": "What needs to be done?",
        "job.title_placeholder": "e.g., Fix kitchen sink leak",
        "job.category_label": "Category",
        "job.location_label": "Where?",
        "job.details_label": "Details",
        "job.details_placeholder": "Describe the issue, current condition, any constraints",
        "job.save_draft": "Save Draft",
        "job.publish": "Publish Job + Notify Helpers",
        "job.error_title_required": "Job title is required.",
        "job.error_location_required": "Location is required.",
        
        // Errors & States
        "state.loading": "Loading...",
        "state.loading_jobs": "Loading your jobs...",
        "state.loading_bids": "Loading bids...",
        "state.offline": "Offline Mode",
        "state.sync_pending": "Sync Queue Pending",
        "error.network": "Network error. Please check your connection.",
        "error.retry": "Retry",
        
        // ... hundreds more keys
    ],
    .spanish: [
        "nav.home": "Inicio",
        "nav.life": "Vida",
        // ... all EN keys translated to Spanish
    ],
    .french: [
        "nav.home": "Accueil",
        // ... all EN keys translated to French
    ],
    .haitianCreole: [
        "nav.home": "Gida",
        // ... all EN keys translated to Haitian Creole
    ]
]
```

### Step 6.3: Locale-Aware Formatting

Update `OneStore` to provide formatting utilities:

```swift
func formatCurrency(_ value: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.locale = activeLocale
    return formatter.string(from: NSNumber(value: value)) ?? "$\(value)"
}

func formatDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = activeLocale
    formatter.dateStyle = .medium
    return formatter.string(from: date)
}

func formatNumber(_ value: Int) -> String {
    let formatter = NumberFormatter()
    formatter.locale = activeLocale
    formatter.numberStyle = .decimal
    return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
}
```

### Step 6.4: Testing Checklist

- [ ] Change language in Settings: UI updates immediately (no reload needed)
- [ ] All hardcoded strings now use i18n keys
- [ ] Refresh with EN/ES/FR/HT: strings load correctly
- [ ] Numbers format with correct separators (e.g., 1.234,56€ in FR)
- [ ] Currency shows correct symbol per locale
- [ ] Dates format in local order (DD/MM/YYYY vs MM/DD/YYYY)
- [ ] 90%+ of UI strings have translations (5-10% OK as English fallback for rare edge cases)

---

## Phase 7: Business Logic & Advanced Features

**Objective:** App implements business rules, calculations, and advanced flows.

**Effort:** 18–20 hours (varies by scope)

**Deliverables:**
- Pulse Score calculated from real Life data (not hardcoded)
- Business Owner persona HOME tab fully functional
- Helper job feed with distance calculation
- Marketplace dashboard for different personas
- Notifications per-persona preferences
- Data export functionality
- Account deletion workflow

### Step 7.1: Pulse Score Calculation

```swift
// Add to OneStore

var calculatedPulsePillars: [PulsePillar] {
    var pillars: [PulsePillar] = []
    
    // Money Pillar (25%)
    let moneyScore = calculateMoneyScore()
    pillars.append(PulsePillar(
        id: "money",
        title: store.localized("pillar.money", fallback: "Money"),
        weight: 25,
        score: moneyScore,
        summary: "30-day cash flow: \(formatCurrency(projectedCashFlow))",
        tintHex: "#f97316"
    ))
    
    // Home Care Pillar (20%)
    let homeScore = calculateHomeScore()
    pillars.append(PulsePillar(
        id: "home",
        title: store.localized("pillar.home", fallback: "Home Care"),
        weight: 20,
        score: homeScore,
        summary: "\(homeMaintenanceItems.count) items tracked",
        tintHex: "#10b981"
    ))
    
    // Car Care Pillar (20%)
    let carScore = calculateCarScore()
    pillars.append(...)
    
    // Continue for all 6 pillars
    
    return pillars
}

private func calculateMoneyScore() -> Int {
    // Score based on:
    // - Cash flow forecast (±20 points)
    // - Emergency fund balance (±15 points)
    // - Budget variance (±15 points)
    // - Recent income (±20 points)
    
    var score = 50 // Baseline
    
    // Fetch recent transactions
    let thisMonth = walletTransactions.filter { isThisMonth($0.timestamp) }
    let creditSum = thisMonth.filter { $0.isCredit }.map { $0.amount }.reduce(0, +)
    let debitSum = thisMonth.filter { !$0.isCredit }.map { $0.amount }.reduce(0, +)
    let cashFlow = creditSum - debitSum
    
    if cashFlow > 2000 {
        score += 20
    } else if cashFlow > 0 {
        score += 10
    } else if cashFlow < -500 {
        score -= 20
    }
    
    // Emergency fund
    if walletSnapshot.balance > 1000 {
        score += 15
    } else if walletSnapshot.balance > 0 {
        score += 5
    } else {
        score -= 10
    }
    
    return max(1, min(100, score))
}

// Similar for other pillars: calculateHomeScore, calculateCarScore, etc.
```

### Step 7.2: Business Owner HOME Tab

Create `BusinessOwnerHomeView.swift`:

```swift
struct BusinessOwnerHomeView: View {
    @Environment(OneStore.self) private var store
    
    var body: some View {
        VStack(spacing: 16) {
            // Team status overview
            GoCard {
                Text("Team Status")
                    .font(.headline)
                ForEach(store.teamMembers) { member in
                    HStack {
                        Circle()
                            .fill(member.isOnline ? .green : .gray)
                            .frame(width: 8, height: 8)
                        Text(member.name)
                        Spacer()
                        Text(member.status)
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                }
            }
            
            // Dispatched jobs
            GoCard {
                Text("Jobs Dispatched Today")
                    .font(.headline)
                Text("\(store.dispatchedJobs.filter { isToday($0.scheduledDate) }.count)")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(OneTheme.amber)
            }
            
            // Revenue
            GoCard {
                Text("Revenue This Month")
                    .font(.headline)
                Text(store.formatCurrency(calculateMonthlyRevenue()))
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.green)
                
                // Revenue by team member
                ForEach(store.teamMembers) { member in
                    HStack {
                        Text(member.name)
                        Spacer()
                        Text(store.formatCurrency(member.monthlyRevenue))
                            .foregroundStyle(.green)
                    }
                    .font(.caption)
                }
            }
        }
    }
    
    private func calculateMonthlyRevenue() -> Double {
        return store.walletTransactions
            .filter { isThisMonth($0.timestamp) && $0.isCredit }
            .map { $0.amount }
            .reduce(0, +)
    }
}
```

### Step 7.3: Helper Job Feed with Distance

Update `fetchHelperJobFeed`:

```swift
@MainActor
func fetchHelperJobFeedWithDistance(latitude: Double, longitude: Double, radiusMiles: Int = 25) async {
    guard activePersona == .helper else { return }
    isFetchingJobs = true
    defer { isFetchingJobs = false }
    
    do {
        let path = "/jobs/nearby?lat=\(latitude)&lng=\(longitude)&radius=\(radiusMiles)"
        let response: OneJobListResponse = try await api.get(path)
        
        customerJobs = response.jobs.map { dto in
            let jobLat = Double(dto.lat) ?? 0
            let jobLng = Double(dto.lng) ?? 0
            let distance = calculateDistance(
                from: (latitude, longitude),
                to: (jobLat, jobLng)
            )
            
            return CustomerJobPost(
                id: uuidFromString(dto.id) ?? UUID(),
                remoteJobID: dto.id,
                title: dto.title ?? "Untitled",
                category: dto.category ?? "General",
                locationQuery: "\(distance) miles away",
                address: dto.locationAddress ?? "",
                details: dto.description ?? "",
                photos: dto.mediaUrls ?? [],
                status: mapJobStatus(dto.status),
                createdAt: Date()
            )
        }
        OneSessionVault.saveCustomerJobs(customerJobs)
    } catch {
        lastJobError = OneErrorMapper.userMessage(for: error, fallback: "Failed to load nearby jobs.")
    }
}

private func calculateDistance(from: (lat: Double, lng: Double), to: (lat: Double, lng: Double)) -> Double {
    // Haversine formula
    let R = 3959.0 // Earth radius in miles
    let dLat = (to.lat - from.lat) * .pi / 180
    let dLng = (to.lng - from.lng) * .pi / 180
    let a = sin(dLat/2) * sin(dLat/2) + cos(from.lat * .pi / 180) * cos(to.lat * .pi / 180) * sin(dLng/2) * sin(dLng/2)
    let c = 2 * atan2(sqrt(a), sqrt(1-a))
    return R * c
}
```

### Step 7.4: Data Export & Account Deletion

```swift
@MainActor
func requestDataExport() async {
    do {
        let _: OneGenericSuccessResponse = try await api.post("/account/export", body: [:])
        dataExportRequested = true
        customerJobFlowMessage = "Data export requested. Check your email for a download link in 24 hours."
    } catch {
        authStatusMessage = "Data export request failed."
    }
}

@MainActor
func requestAccountDeletion() async {
    do {
        let _: OneGenericSuccessResponse = try await api.post("/account/delete", body: [:])
        accountDeletionRequested = true
        
        // Schedule logout after a few seconds to show confirmation
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            self.logout(clearMessage: false)
        }
        
        customerJobFlowMessage = "Account deletion initiated. You will be logged out in 2 seconds."
    } catch {
        authStatusMessage = "Account deletion failed. Please try again."
    }
}
```

### Step 7.5: Testing Checklist

- [ ] Pulse Score calculated from real Life data (not hardcoded)
- [ ] Score updates when life log entries are added
- [ ] Business Owner persona renders team dashboard
- [ ] Helper job feed shows distance-sorted results
- [ ] Request data export: email sent with download link
- [ ] Request account deletion: account deleted on backend, user logged out
- [ ] Persona switching reloads HOME with correct content
- [ ] All 7 personas have functional HOME tabs

---

## Summary: Implementation Order & Blockers

### Optimal Sequence (No Parallelization Needed)

1. **Phase 1** (Data Fetching) — 10–12 hours — FOUNDATION; no other phases work without this
2. **Phase 2** (Form Submissions) — 14–16 hours — Depends on Phase 1; unblocks Phase 3
3. **Phase 3** (Image Upload) — 12–14 hours — Depends on Phase 2; needed for job photos
4. **Phase 4** (Real-Time Messaging) — 16–18 hours — Independent; can run in parallel with Phase 3
5. **Phase 5** (Payments) — 14–16 hours — Independent; can run in parallel with Phases 3–4
6. **Phase 6** (Localization) — 20–24 hours — Independent; can run last (doesn't block feature delivery)
7. **Phase 7** (Business Logic) — 18–20 hours — Depends on Phase 1; polish pass

**Total time to MVP: 6–7 weeks (~300 hours) for one engineer**, or 3–4 weeks with a team of 2.

### Recommended Parallel Path

- **Week 1**: Phase 1 (Data Fetching) + Phase 2 (Form Submissions)
- **Week 2**: Phase 2 (continue) + Phase 3 (Image Upload) + Phase 4 (Messaging) in parallel
- **Week 3**: Phase 4 (continue) + Phase 5 (Payments)
- **Week 4**: Phase 5 (continue) + Phase 6 (Localization)
- **Week 5**: Phase 7 (Business Logic) + Final QA
- **Week 6**: Deployment prep, bug fixes, App Store review

### Critical Dependencies

- ❌ **Phase 2 cannot start** until Phase 1 API models are in place
- ❌ **Phase 3 cannot complete** until S3 infrastructure is available
- ❌ **Phase 4 cannot fully test** without push notification certificate setup
- ❌ **Phase 5 cannot go live** without Stripe account and webhook setup
- ❌ **Phase 6 is independent** but highly tedious; recommend machine translation + QA review

---

## Testing Strategy

### Unit Tests (Add to `server/__tests__/` if you control backend)

- API response decoding (OneJobDTO, OneMessageDTO, etc.)
- Token refresh logic
- Distance calculation
- Pulse score calculation
- Currency formatting per locale

### Integration Tests (Simulator/Device)

- Complete auth flow (register, login, logout)
- Job posting: form → upload images → publish → see in list
- Message send/receive: send on Device A, receive on Device B
- Offline: post job offline, go online, sync succeeds
- Locale switching: change language, UI updates, dates format correctly

### Manual QA Checklist

- [ ] All 7 personas have working HOME tabs
- [ ] All 4 languages display correctly (no missing keys)
- [ ] All forms validate before submission
- [ ] Errors show user-friendly messages + retry option
- [ ] Loading spinners appear during API calls
- [ ] Push notifications deliver (requires APNS certificate)
- [ ] Images upload and display (requires S3 setup)
- [ ] Wallet balance updates after job completion
- [ ] Data export email arrives within 24 hours
- [ ] App works offline; syncs when online

---

## Handoff to Codex

You now have:

1. **7 detailed implementation phases** with step-by-step code examples
2. **Specific file paths and function signatures** to implement
3. **Testing checklist** for each phase
4. **Optimal parallelization strategy** to reach MVP in 6 weeks
5. **Critical dependency graph** to avoid blocking

**Next step:** Share this document with Codex, emphasizing:

- Start with **Phase 1** (Data Fetching) — it's the foundation
- Each phase is **self-contained** after Phase 1 completes
- Use the **code examples** as-is (just integrate with your backend DTOs)
- Run the **testing checklist** before moving to the next phase
- **Phases 3 & 4 & 5** can happen in parallel after Phase 2

---

**End of Implementation Plan**

---

Would you like me to also create:
1. A shorter version Codex can paste directly into chat?
2. A backend API specification (endpoints, request/response schemas)?
3. A deployment checklist (App Store submission, TestFlight setup)?

