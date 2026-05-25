# OxSteed iOS App — Complete Production Integration Instructions for Codex

**Objective:** Convert the OxSteedOne iOS SwiftUI app from **UI mockup (95%) + mock data (5%)** to **fully functional production-ready app** with real backend integration, error handling, and offline resilience.

**Current State:** See `iOS_PRODUCTION_READINESS_AUDIT.md` for detailed gap analysis.

**Timeline:** 5 days (one developer, 36 hours total)

**Success Criteria:**
- ✅ User can sign up, log in, stay logged in
- ✅ User can post a job (with photos) and see it live on backend
- ✅ User can browse helpers, book a service, see appointment created
- ✅ User can browse/reserve tools, see reservation confirmed
- ✅ Errors show with retry buttons; loading states prevent double-clicks
- ✅ App works offline; edits sync when online
- ✅ Biometric unlock on app launch
- ✅ All 700+ UI strings translated to ES/FR/HT

---

## Phase 1: Authentication & Session (6 hours)

### What to Build
Replace mock auth with real JWT-based sign-up, login, token refresh, and logout.

### Files to Modify/Create

**1. `OneStore.swift` — Add auth methods**

```swift
// REMOVE:
var authEmail = ""
var authPassword = ""
var authStatusMessage: String?

// REPLACE WITH:
@ObservationIgnored private(set) var token: String? {
    didSet { OneSessionVault.saveToken(token) }
}
@ObservationIgnored private(set) var refreshToken: String? {
    didSet { OneSessionVault.saveRefreshToken(refreshToken) }
}

var authEmail = ""
var authPassword = ""
var authStatusMessage: String?
var isAuthenticating = false

var isAuthenticated: Bool {
    token != nil
}

// MARK: Authentication Methods

func register(
    email: String,
    password: String,
    primaryPersona: AppPersona
) async {
    isAuthenticating = true
    defer { isAuthenticating = false }
    authStatusMessage = nil
    
    do {
        let response = try await api.post<AuthResponse>(
            "/auth/register",
            body: [
                "email": email,
                "password": password,
                "primary_persona": primaryPersona.rawValue
            ]
        )
        
        token = response.accessToken
        refreshToken = response.refreshToken
        personaContext = PersonaContext(activePersona: primaryPersona)
        oneboardingState.didComplete = false  // Show onboarding after signup
        authStatusMessage = "Welcome! Let's set up your profile."
    } catch {
        authStatusMessage = error.localizedDescription
    }
}

func login(email: String, password: String) async {
    isAuthenticating = true
    defer { isAuthenticating = false }
    authStatusMessage = nil
    
    do {
        let response = try await api.post<AuthResponse>(
            "/auth/login",
            body: [
                "email": email,
                "password": password
            ]
        )
        
        token = response.accessToken
        refreshToken = response.refreshToken
        
        // Fetch user profile to restore persona context
        await refreshUserProfile()
        authStatusMessage = nil
    } catch {
        authStatusMessage = error.localizedDescription
    }
}

func refreshAccessToken() async throws {
    guard let currentRefreshToken = refreshToken else {
        throw AuthError.noRefreshToken
    }
    
    do {
        let response = try await api.post<AuthResponse>(
            "/auth/refresh",
            body: ["refreshToken": currentRefreshToken]
        )
        
        token = response.accessToken
        refreshToken = response.refreshToken
    } catch {
        // Refresh failed; user must login again
        logout()
        throw AuthError.refreshFailed
    }
}

func logout() {
    token = nil
    refreshToken = nil
    personaContext = PersonaContext()
    authEmail = ""
    authPassword = ""
    authStatusMessage = nil
    
    // Clear local session
    OneSessionVault.clearSession()
}

private func refreshUserProfile() async {
    do {
        let profile = try await api.get<UserProfile>("/users/me")
        personaContext = PersonaContext(
            activePersona: profile.primaryPersona,
            selectedBusinessID: profile.defaultBusinessId
        )
        onboardingState = profile.onboardingState
    } catch {
        // Log but don't block; user can still proceed
        logger.error("Failed to fetch user profile: \(error)")
    }
}

// MARK: Biometric Authentication

@available(iOS 17.0, *)
func setupBiometricAuth() async throws {
    let context = LAContext()
    var error: NSError?
    
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
        throw BiometricError.notAvailable(error?.localizedDescription ?? "Device does not support biometric auth")
    }
    
    biometricEnabled = true
    OneSessionVault.saveBiometricEnabled(true)
}

@available(iOS 17.0, *)
func authenticateWithBiometric() async throws -> Bool {
    let context = LAContext()
    let reason = "Unlock OxSteed to continue"
    
    do {
        let success = try await context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: reason
        )
        return success
    } catch {
        throw BiometricError.authenticationFailed(error.localizedDescription)
    }
}
```

**2. `OxSteedOneAPIClient.swift` — Add token handling**

```swift
// Modify the request() method to:
// 1. Attach Bearer token to every request
// 2. On 401, refresh token and retry
// 3. On persistent 401 after refresh, return 401 error (user must login again)

private func request<Response: Decodable>(_ path: String, method: String, body: Data?) async throws -> Response {
    guard let url = URL(string: path, relativeTo: baseURL) else {
        throw OneAPIError.invalidURL(path)
    }

    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    if let body {
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }

    // Attach token
    if let token {
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
        throw OneAPIError.invalidResponse
    }

    // Handle 401: try refresh
    if http.statusCode == 401 {
        // Call store.refreshAccessToken() here
        // If successful, retry the original request
        // If fails, throw .unauthorized
        throw OneAPIError.unauthorized
    }

    guard (200..<300).contains(http.statusCode) else {
        let errorBody = String(data: data, encoding: .utf8) ?? "No body"
        throw OneAPIError.server(http.statusCode, errorBody)
    }

    return try decoder.decode(Response.self, from: data)
}
```

**3. `OneSessionVault.swift` — Add token persistence**

```swift
// Add these functions:
static func saveToken(_ token: String?) {
    if let token = token {
        keychain.set(token, forKey: "oxsteed_access_token")
    } else {
        keychain.removeObject(forKey: "oxsteed_access_token")
    }
}

static func loadToken() -> String? {
    return keychain.string(forKey: "oxsteed_access_token")
}

static func saveRefreshToken(_ token: String?) {
    if let token = token {
        keychain.set(token, forKey: "oxsteed_refresh_token")
    } else {
        keychain.removeObject(forKey: "oxsteed_refresh_token")
    }
}

static func loadRefreshToken() -> String? {
    return keychain.string(forKey: "oxsteed_refresh_token")
}

static func clearSession() {
    keychain.removeObject(forKey: "oxsteed_access_token")
    keychain.removeObject(forKey: "oxsteed_refresh_token")
}
```

**4. `OneRootView.swift` — Add login screen before home**

```swift
// Wrap the TabView in conditional logic:

var body: some View {
    if !store.isAuthenticated {
        LoginView()
            .environment(store)
    } else if store.showOnboarding {
        OnboardingFlow()
            .environment(store)
    } else if store.isLocked {
        LockScreen()
            .environment(store)
    } else {
        TabView(selection: $store.selectedTab) {
            // ... existing TabView code
        }
    }
}
```

**5. Create `LoginView.swift` (NEW FILE)**

```swift
import SwiftUI

struct LoginView: View {
    @Environment(OneStore.self) private var store
    @State private var isSignup = false

    var body: some View {
        NavigationStack {
            if isSignup {
                SignupView(isSignup: $isSignup)
            } else {
                LoginFormView(isSignup: $isSignup)
            }
        }
        .environment(store)
    }
}

struct LoginFormView: View {
    @Environment(OneStore.self) private var store
    @Binding var isSignup: Bool

    var body: some View {
        Form {
            Section("Sign In") {
                TextField("Email", text: $store.authEmail)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                SecureField("Password", text: $store.authPassword)
            }

            if let message = store.authStatusMessage {
                Section {
                    Text(message)
                        .foregroundColor(.red)
                }
            }

            Section {
                Button(store.isAuthenticating ? "Signing in..." : "Sign In") {
                    Task {
                        await store.login(email: store.authEmail, password: store.authPassword)
                    }
                }
                .disabled(store.isAuthenticating || store.authEmail.isEmpty || store.authPassword.isEmpty)

                Button("Create account instead") {
                    isSignup = true
                }
                .buttonStyle(.bordered)
            }
        }
        .navigationTitle("OxSteed")
    }
}

struct SignupView: View {
    @Environment(OneStore.self) private var store
    @Binding var isSignup: Bool
    @State private var selectedPersona: AppPersona = .customer

    var body: some View {
        Form {
            Section("Create Account") {
                TextField("Email", text: $store.authEmail)
                    .keyboardType(.emailAddress)
                SecureField("Password", text: $store.authPassword)
            }

            Section("Primary Role") {
                Picker("Role", selection: $selectedPersona) {
                    ForEach(AppPersona.allCases) { persona in
                        Text(persona.label).tag(persona)
                    }
                }
            }

            if let message = store.authStatusMessage {
                Section {
                    Text(message)
                        .foregroundColor(.red)
                }
            }

            Section {
                Button(store.isAuthenticating ? "Creating..." : "Create Account") {
                    Task {
                        await store.register(
                            email: store.authEmail,
                            password: store.authPassword,
                            primaryPersona: selectedPersona
                        )
                    }
                }
                .disabled(store.isAuthenticating || store.authEmail.isEmpty || store.authPassword.isEmpty)

                Button("Already have an account?") {
                    isSignup = false
                }
                .buttonStyle(.bordered)
            }
        }
        .navigationTitle("Sign Up")
    }
}
```

**6. Create `LockScreen.swift` (NEW FILE)**

```swift
import SwiftUI
import LocalAuthentication

struct LockScreen: View {
    @Environment(OneStore.self) private var store

    var body: some View {
        ZStack {
            OneTheme.background.ignoresSafeArea()

            VStack(spacing: 32) {
                OxSteedOneMark(size: 80)

                Text("OxSteed")
                    .font(.title.weight(.bold))

                Button(action: { Task { await unlockWithBiometric() } }) {
                    HStack {
                        Image(systemName: "faceid")
                        Text("Unlock with Face ID")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(OneTheme.amber)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }

                Button("Sign Out") {
                    store.logout()
                }
                .foregroundColor(.red)
            }
            .padding()
        }
    }

    private func unlockWithBiometric() async {
        do {
            let success = try await store.authenticateWithBiometric()
            if success {
                store.isLocked = false
            }
        } catch {
            // Show error
        }
    }
}
```

### Verification Checklist
- [ ] User can sign up with email/password
- [ ] User can log in with email/password
- [ ] Token is stored in Keychain (survives app restart)
- [ ] Failed login shows error message
- [ ] Logout clears token + returns to login screen
- [ ] Bearer token attached to all API requests
- [ ] 401 from API triggers refresh attempt
- [ ] Refresh succeeds and retries original request
- [ ] Refresh fails and shows "Please sign in again"

---

## Phase 2: Customer Job Flow (12 hours)

### What to Build
Real job posting → bid management → appointment creation. This is the **primary customer workflow**.

### Files to Modify/Create

**1. `OneStore.swift` — Replace mock job methods with real API calls**

**DELETE** these placeholder methods:
```swift
func postCustomerJobServerFirst(...) async { }
func acceptBidServerFirst(_ bidId: UUID) async { }
func messageHelperForBidServerFirst(...) async { }
func startCustomerJobServerFirst(_ jobId: UUID) async { }
func completeCustomerJobServerFirst(_ jobId: UUID) async { }
func cancelCustomerJobServerFirst(_ jobId: UUID) async { }
```

**ADD** these real implementations:

```swift
// MARK: Job Management

var isPostingJob = false
var lastJobError: String?

func postCustomerJobServerFirst(
    title: String,
    category: String,
    locationQuery: String,
    address: String,
    details: String,
    photos: [String]  // File paths or URLs after upload
) async {
    isPostingJob = true
    defer { isPostingJob = false }
    lastJobError = nil

    do {
        // Step 1: Upload photos if provided
        var photoURLs: [String] = []
        for photoPath in photos {
            // Assuming photos come from PHPickerViewController as Data
            let url = try await uploadJobPhoto(photoPath)
            photoURLs.append(url)
        }

        // Step 2: Create job on backend
        let jobPayload: [String: Any] = [
            "title": title,
            "description": details,
            "category_name": category.isEmpty ? "General" : category,
            "location_city": locationQuery,
            "location_address": address,
            "location_country": "US",
            "photos": photoURLs,
            "budget_type": "fixed",
            "urgency": "normal"
        ]

        let newJob = try await api.post<CustomerJobPost>(
            "/jobs",
            body: jobPayload
        )

        // Step 3: Update local state
        customerJobs.insert(newJob, at: 0)  // Show newest first
        
        // Step 4: Refresh home cards
        homeReloadToken = UUID()

    } catch {
        lastJobError = error.localizedDescription
    }
}

private func uploadJobPhoto(_ imagePath: String) async throws -> String {
    // Use multipart FormData to upload to /api/uploads/jobs
    // Return the public URL from the response
    let url = try await api.uploadFile(imagePath, to: "/uploads/jobs")
    return url
}

// MARK: Bid Management

var isFetchingBids = false
var lastBidError: String?

func refreshBidsForJob(_ jobId: UUID) async {
    isFetchingBids = true
    defer { isFetchingBids = false }

    do {
        let bids = try await api.get<[JobBid]>("/jobs/\(jobId)/bids")
        jobBids = bids
    } catch {
        lastBidError = error.localizedDescription
    }
}

func acceptBidServerFirst(_ bidId: UUID) async {
    do {
        // POST to /bids/{id}/accept
        let appointment = try await api.post<CustomerServiceBooking>(
            "/bids/\(bidId)/accept",
            body: [:]
        )

        // Update local state
        if let index = jobBids.firstIndex(where: { $0.id == bidId }) {
            jobBids[index].accepted = true
        }

        // Add appointment to bookings
        customerServiceBookings.insert(appointment, at: 0)

    } catch {
        lastBidError = error.localizedDescription
    }
}

func messageHelperForBidServerFirst(
    _ bidId: UUID,
    content: String
) async {
    do {
        try await api.post<Void>(
            "/bids/\(bidId)/message",
            body: ["content": content]
        )
        // Message sent; no local update needed (unified inbox handles this)
    } catch {
        lastBidError = error.localizedDescription
    }
}

// MARK: Job Lifecycle

var isUpdatingJob = false

func startCustomerJobServerFirst(_ jobId: UUID) async {
    isUpdatingJob = true
    defer { isUpdatingJob = false }

    do {
        let updated = try await api.put<CustomerJobPost>(
            "/jobs/\(jobId)",
            body: ["status": "in_progress"]
        )
        if let index = customerJobs.firstIndex(where: { $0.id == jobId }) {
            customerJobs[index] = updated
        }
    } catch {
        lastJobError = error.localizedDescription
    }
}

func completeCustomerJobServerFirst(_ jobId: UUID) async {
    isUpdatingJob = true
    defer { isUpdatingJob = false }

    do {
        let updated = try await api.put<CustomerJobPost>(
            "/jobs/\(jobId)",
            body: ["status": "completed"]
        )
        if let index = customerJobs.firstIndex(where: { $0.id == jobId }) {
            customerJobs[index] = updated
        }
    } catch {
        lastJobError = error.localizedDescription
    }
}

func cancelCustomerJobServerFirst(_ jobId: UUID) async {
    isUpdatingJob = true
    defer { isUpdatingJob = false }

    do {
        let updated = try await api.put<CustomerJobPost>(
            "/jobs/\(jobId)",
            body: ["status": "cancelled"]
        )
        if let index = customerJobs.firstIndex(where: { $0.id == jobId }) {
            customerJobs[index] = updated
        }
    } catch {
        lastJobError = error.localizedDescription
    }
}

// MARK: Fetching

func refreshCustomerJobs() async {
    do {
        let jobs = try await api.get<[CustomerJobPost]>("/jobs/me")
        customerJobs = jobs
    } catch {
        logger.error("Failed to fetch customer jobs: \(error)")
    }
}
```

**2. `TodayView.swift` — Update buttons to show loading states and errors**

Replace:
```swift
Button("Publish Job + Notify Helpers") {
    let photos = postPhotos.split(separator: ",").map { ... }.filter { !$0.isEmpty }
    Task {
        await store.postCustomerJobServerFirst(...)
    }
    postTitle = ""
    postDetails = ""
    postPhotos = ""
}
```

With:
```swift
VStack(spacing: 8) {
    Button(store.isPostingJob ? "Posting..." : "Publish Job + Notify Helpers") {
        if !store.isPostingJob {
            let photos = postPhotos.split(separator: ",").map { ... }.filter { !$0.isEmpty }
            Task {
                await store.postCustomerJobServerFirst(...)
                if store.lastJobError == nil {
                    postTitle = ""
                    postDetails = ""
                    postPhotos = ""
                }
            }
        }
    }
    .buttonStyle(GoAccentButtonStyle())
    .disabled(store.isPostingJob || postTitle.trimmingCharacters(in: .whitespaces).count < 10)

    if let error = store.lastJobError {
        HStack {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundColor(.red)
            Text(error)
                .font(.caption)
                .foregroundColor(.red)
            Spacer()
            Button("Retry") {
                Task {
                    let photos = postPhotos.split(separator: ",").map { ... }.filter { !$0.isEmpty }
                    await store.postCustomerJobServerFirst(...)
                }
            }
            .font(.caption.weight(.semibold))
        }
        .padding(.vertical, 4)
    }
}
```

Similarly update:
- "Accept + Create Appointment" button (call `acceptBidServerFirst`, show loading, handle errors)
- "Start" and "Complete" job buttons
- All messaging buttons

### Verification Checklist
- [ ] User can post job with title, description, location, photos
- [ ] Job appears in `/jobs/me` fetch
- [ ] Job posting shows loading spinner ("Posting...")
- [ ] Failed posting shows error with Retry button
- [ ] User can see bids on posted job
- [ ] User can accept a bid (creates appointment)
- [ ] User can start/complete/cancel job
- [ ] All state updates reflected immediately in UI

---

## Phase 3: Service Booking & Tool Rental (12 hours)

### What to Build
Real helper booking flow + tool rental reservation.

### Structure
- Implement similar pattern to job flow
- Add real API calls in `OneStore`
- Update all buttons in `TodayView` to load data and show errors
- Handle photos for tool damage assessments

### Key Methods to Implement

```swift
// In OneStore.swift

// MARK: Service Bookings

var isBookingService = false
var bookingError: String?

func createServiceBookingServerFirst(
    helperID: UUID,
    serviceType: String,
    scheduledDate: Date,
    slot: String,
    paymentAuthorized: Bool,
    preMessage: String
) async {
    isBookingService = true
    defer { isBookingService = false }
    bookingError = nil

    do {
        let booking = try await api.post<CustomerServiceBooking>(
            "/bookings",
            body: [
                "helper_id": helperID.uuidString,
                "service_type": serviceType,
                "scheduled_date": ISO8601DateFormatter().string(from: scheduledDate),
                "scheduled_slot": slot,
                "payment_authorized": paymentAuthorized,
                "pre_message": preMessage
            ]
        )
        customerServiceBookings.insert(booking, at: 0)
        homeReloadToken = UUID()
    } catch {
        bookingError = error.localizedDescription
    }
}

func sendBookingMessageServerFirst(
    _ bookingId: UUID,
    content: String
) async {
    do {
        try await api.post<Void>(
            "/bookings/\(bookingId)/message",
            body: ["content": content]
        )
    } catch {
        bookingError = error.localizedDescription
    }
}

func cancelServiceBookingServerFirst(_ bookingId: UUID) async {
    do {
        try await api.put<Void>(
            "/bookings/\(bookingId)",
            body: ["status": "cancelled"]
        )
        customerServiceBookings.removeAll { $0.id == bookingId }
    } catch {
        bookingError = error.localizedDescription
    }
}

func submitBookingReview(
    _ bookingId: UUID,
    rating: Int,
    comment: String
) async {
    do {
        try await api.post<Void>(
            "/bookings/\(bookingId)/review",
            body: ["rating": rating, "comment": comment]
        )
    } catch {
        bookingError = error.localizedDescription
    }
}

// MARK: Tool Rentals

var isReservingTool = false
var toolError: String?

func reserveToolServerFirst(
    toolID: UUID,
    slot: String,
    paymentAuthorized: Bool
) async {
    isReservingTool = true
    defer { isReservingTool = false }
    toolError = nil

    do {
        let reservation = try await api.post<ToolRentalReservation>(
            "/tool-rentals",
            body: [
                "tool_id": toolID.uuidString,
                "slot": slot,
                "payment_authorized": paymentAuthorized
            ]
        )
        toolRentalReservations.insert(reservation, at: 0)
        homeReloadToken = UUID()
    } catch {
        toolError = error.localizedDescription
    }
}

func confirmToolPickup(_ reservationId: UUID) {
    if let index = toolRentalReservations.firstIndex(where: { $0.id == reservationId }) {
        Task {
            do {
                try await api.put<Void>(
                    "/tool-rentals/\(reservationId)",
                    body: ["pickup_confirmed": true]
                )
                toolRentalReservations[index].pickupConfirmed = true
            } catch {
                toolError = error.localizedDescription
            }
        }
    }
}

func confirmToolReturn(_ reservationId: UUID) {
    if let index = toolRentalReservations.firstIndex(where: { $0.id == reservationId }) {
        Task {
            do {
                try await api.put<Void>(
                    "/tool-rentals/\(reservationId)",
                    body: ["return_confirmed": true]
                )
                toolRentalReservations[index].returnConfirmed = true
            } catch {
                toolError = error.localizedDescription
            }
        }
    }
}

func openToolDamageDisputeServerFirst(
    _ reservationId: UUID,
    description: String
) async {
    do {
        try await api.post<Void>(
            "/tool-rentals/\(reservationId)/dispute",
            body: ["damage_notes": description]
        )
        if let index = toolRentalReservations.firstIndex(where: { $0.id == reservationId }) {
            toolRentalReservations[index].disputeStatus = "Open"
        }
    } catch {
        toolError = error.localizedDescription
    }
}
```

### Verification Checklist
- [ ] User can book a service (call creates appointment)
- [ ] User can send messages to helper (message thread shows in inbox)
- [ ] User can submit review after booking
- [ ] User can search and filter helpers by rating
- [ ] User can reserve tool with payment authorization
- [ ] User can confirm pickup/return
- [ ] User can open damage dispute
- [ ] All errors show with user-friendly messages

---

## Phase 4: Error Handling & Loading States (8 hours)

### What to Build
Make every action show loading spinner and error messages so users never wonder if their click worked.

### Implementation Pattern

For **every button that makes an API call**:

```swift
// BAD (current state):
Button("Book Service") {
    Task { await store.createServiceBookingServerFirst(...) }
}

// GOOD:
VStack(spacing: 8) {
    Button(store.isBookingService ? "Booking..." : "Book Service") {
        if !store.isBookingService {
            Task { await store.createServiceBookingServerFirst(...) }
        }
    }
    .disabled(store.isBookingService)

    if let error = store.bookingError {
        HStack {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundColor(.red)
            Text(error)
                .font(.caption)
                .foregroundColor(.red)
            Spacer()
            Button("Retry") {
                Task { await store.createServiceBookingServerFirst(...) }
            }
            .buttonStyle(.bordered)
        }
        .padding(.vertical, 4)
    }
}
```

### Files to Update
1. **TodayView.swift** — Wrap all buttons in error handling + loading logic
2. **HireView.swift** — Same for sinking fund, booking request buttons
3. **ShopView.swift** — Same for ascension, financing, payout buttons
4. **InboxView.swift** — Same for creator upload
5. **OneStore.swift** — Add loading flags and error strings for every async operation

### Verification Checklist
- [ ] Every button shows "Loading..." while operation is in progress
- [ ] Button is disabled while loading (prevents duplicate clicks)
- [ ] Failed operations show error message
- [ ] Retry button appears on errors
- [ ] Retry clears the error and re-attempts
- [ ] Success clears error message
- [ ] User can't accidentally submit form twice

---

## Phase 5: Data Sync & Offline Resilience (8 hours)

### What to Build
- Load real data from backend on app launch
- Sync changes when connectivity returns
- Queue offline edits (life log, sinking funds) for later sync

### Implementation

**1. `OneStore.swift` — Add startup sync**

```swift
func restoreSession() async {
    // Called from OneRootView .onAppear
    guard isAuthenticated else { return }
    
    // Fetch all data in parallel
    async let jobsTask = refreshCustomerJobs()
    async let helpersTask = refreshServiceHelpers()
    async let toolsTask = refreshToolRentals()
    async let inboxTask = refreshInbox()
    
    _ = await (jobsTask, helpersTask, toolsTask, inboxTask)
}

func refreshInbox() async {
    do {
        let threads = try await api.get<[UnifiedThread]>("/messages/threads")
        unifiedInboxThreads = threads
    } catch {
        logger.error("Failed to fetch inbox: \(error)")
    }
}
```

**2. `OneStore.swift` — Queue offline edits**

```swift
struct PendingChange: Codable {
    let id: UUID
    let action: String  // "create", "update", "delete"
    let resource: String  // "lifeLogEntry", "sinkingFund"
    let data: Data
    let createdAt: Date
}

var pendingChanges: [PendingChange] = OneSessionVault.loadPendingChanges() {
    didSet { OneSessionVault.savePendingChanges(pendingChanges) }
}

// OFFLINE-SAFE method for adding life log
func addLifeLogEntryOfflineFirst(pillarID: String, title: String, detail: String) {
    let entry = LifeLogEntry(pillarID: pillarID, title: title, detail: detail)
    lifeLogEntries.append(entry)
    OneSessionVault.saveLifeLogEntries(lifeLogEntries)  // Save immediately
    
    // Try to sync, but don't block
    Task {
        do {
            _ = try await api.post<LifeLogEntry>("/life-log", body: entry)
        } catch {
            // Add to pending queue for retry
            let encoded = try JSONEncoder().encode(entry)
            pendingChanges.append(
                PendingChange(
                    id: entry.id,
                    action: "create",
                    resource: "lifeLogEntry",
                    data: encoded,
                    createdAt: Date()
                )
            )
        }
    }
}

// Sync pending changes (call on app launch or when connectivity restored)
func syncPendingChanges() async {
    for (index, change) in pendingChanges.enumerated() {
        do {
            switch change.resource {
            case "lifeLogEntry":
                _ = try await api.post<LifeLogEntry>("/life-log", body: change.data)
            case "sinkingFund":
                _ = try await api.post<SinkingFund>("/sinking-funds", body: change.data)
            default:
                break
            }
            pendingChanges.remove(at: index)
        } catch {
            logger.error("Failed to sync \(change.resource): \(error)")
            // Keep in queue for next attempt
        }
    }
}
```

**3. `OneSessionVault.swift` — Add pending changes persistence**

```swift
static func savePendingChanges(_ changes: [PendingChange]) {
    let data = try? JSONEncoder().encode(changes)
    UserDefaults.standard.set(data, forKey: "pending_changes")
}

static func loadPendingChanges() -> [PendingChange] {
    guard let data = UserDefaults.standard.data(forKey: "pending_changes") else { return [] }
    return (try? JSONDecoder().decode([PendingChange].self, from: data)) ?? []
}
```

### Verification Checklist
- [ ] App fetches all real data on launch (if authenticated)
- [ ] Loading indicators show while fetching
- [ ] User can add life log entry while offline
- [ ] Offline changes saved to UserDefaults
- [ ] When online, offline changes sync to backend
- [ ] Synced changes removed from queue
- [ ] Failed syncs remain in queue for next retry

---

## Phase 6: Biometric Auth & Force Update (4 hours)

### What to Build

**1. `OneRootView.swift` — Check force update on app launch**

```swift
.onAppear {
    Task {
        await store.checkForceUpdate()
        if !store.forceUpdateRequired && store.isAuthenticated {
            await store.authenticateWithBiometricIfEnabled()
        }
    }
}

if store.forceUpdateRequired {
    ForceUpdateSheet()
        .environment(store)
}
```

**2. `OneStore.swift` — Add force update check**

```swift
func checkForceUpdate() async {
    do {
        let config = try await api.get<AppConfig>("/app/config")
        let currentVersion = Bundle.main.appVersion  // "1.0.0"
        forceUpdateRequired = !isVersionSupported(currentVersion, minimumRequired: config.minimumVersion)
    } catch {
        // Fail open; don't block if server unreachable
        logger.error("Failed to check force update: \(error)")
    }
}

private func isVersionSupported(_ current: String, minimumRequired: String) -> Bool {
    // Compare "1.2.3" vs "1.2.0"
    let currentParts = current.split(separator: ".").compactMap { Int($0) }
    let requiredParts = minimumRequired.split(separator: ".").compactMap { Int($0) }
    
    for i in 0..<max(currentParts.count, requiredParts.count) {
        let curr = currentParts.count > i ? currentParts[i] : 0
        let req = requiredParts.count > i ? requiredParts[i] : 0
        
        if curr > req { return true }
        if curr < req { return false }
    }
    return true
}

@available(iOS 17.0, *)
func authenticateWithBiometricIfEnabled() async {
    guard biometricEnabled else { return }
    
    do {
        let success = try await authenticateWithBiometric()
        if !success {
            isLocked = true
        }
    } catch {
        // If biometric fails, lock the app
        isLocked = true
    }
}
```

**3. Create `ForceUpdateSheet.swift`**

```swift
import SwiftUI

struct ForceUpdateSheet: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.4).ignoresSafeArea()

            VStack(spacing: 24) {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 60))
                    .foregroundColor(.orange)

                VStack(spacing: 8) {
                    Text("Update Required")
                        .font(.title.weight(.bold))
                    Text("A new version of OxSteed is available. Please update to continue.")
                        .font(.body)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }

                Link(destination: URL(string: "https://apps.apple.com/app/oxsteed")!) {
                    Text("Update on App Store")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                }
            }
            .padding()
            .background(Color(uiColor: .systemBackground))
            .cornerRadius(16)
            .padding()
        }
    }
}
```

### Verification Checklist
- [ ] App checks `/app/config` on launch for minimum version
- [ ] If version too old, shows "Update Required" sheet
- [ ] Update button links to App Store
- [ ] User can't dismiss sheet (blocks app access)
- [ ] If biometric enabled, shows Face ID unlock on launch
- [ ] Biometric failure locks app (can retry or sign out)

---

## Phase 7: Multi-Language Support (20 hours)

### What to Build
Translate all 700+ UI strings to ES, FR, HT.

### Implementation

**1. Create `Localizable.strings` files**

Each language gets a file:
- `Localizable.strings` (English)
- `Localizable.strings (Spanish)` (Spanish)
- `Localizable.strings (French)` (French)
- `Localizable.strings (Haitian Creole)` (Haitian Creole)

**2. Update all Text() calls**

```swift
// BEFORE:
Text("Customer Job Posting")

// AFTER:
Text("jobPosting.title")  // Key from Localizable.strings
```

**3. Create strings files with all keys**

**Localizable.strings (English):**
```
// Customer Job Posting
"jobPosting.title" = "Customer Job Posting";
"jobPosting.titlePlaceholder" = "Job title";
"jobPosting.descriptionPlaceholder" = "Describe the work";
"jobPosting.categoryLabel" = "Category";
"jobPosting.locationPlaceholder" = "Location autocomplete";
"jobPosting.addressPlaceholder" = "Address";
"jobPosting.photoHint" = "Photos preview: %@";
"jobPosting.saveDraft" = "Save Draft";
"jobPosting.publish" = "Publish Job + Notify Helpers";
"jobPosting.posting" = "Posting...";
// ... 700+ more keys
```

**Localizable.strings (Spanish):**
```
"jobPosting.title" = "Publicar trabajo";
"jobPosting.titlePlaceholder" = "Título del trabajo";
// ... translated
```

Use `NSLocalizedString()` or SwiftUI's simple key lookup.

### Tools
- Create a Python script to extract all hardcoded strings from `.swift` files
- Generate a template `Localizable.strings` file
- Use Google Translate API to generate first draft (then manual review)
- Store final translations in `Localizable.strings` files

### Verification Checklist
- [ ] All 700+ UI strings have keys in `Localizable.strings`
- [ ] Spanish/French/Haitian Creole translations complete
- [ ] RTL layout works (if any language is RTL)
- [ ] Language picker in Settings works
- [ ] App restarts when language changed (or uses @EnvironmentObject)
- [ ] Date/time/currency formatters use `activeLocale`

---

## Integration Checklist (Final Verification)

### Authentication ✅
- [ ] Sign up creates user account on backend
- [ ] Login fetches user data and populates persona context
- [ ] Token stored in Keychain
- [ ] Token automatically refreshed on 401
- [ ] Logout clears all data and returns to login

### Core Workflows ✅
- [ ] Post job → see bids → accept bid → appointment created
- [ ] Search helpers → book service → appointment confirmed
- [ ] Browse tools → reserve → confirm pickup/return
- [ ] Life log entries sync to backend
- [ ] Sinking funds calculate weekly contributions

### UI/UX ✅
- [ ] All buttons show loading states
- [ ] Errors display with retry buttons
- [ ] Disabled state while loading (no double-clicks)
- [ ] Persona switching reloads home tab only
- [ ] Offline changes saved, synced when online

### Data ✅
- [ ] Real data fetched on app launch
- [ ] All CRUD operations call correct endpoints
- [ ] Responses correctly update local state
- [ ] No hardcoded mock data remains

### Security ✅
- [ ] Bearer token attached to all requests
- [ ] Biometric unlock on app launch
- [ ] Logout clears sensitive data
- [ ] No passwords stored in memory long-term

### Languages ✅
- [ ] App starts in device language (EN/ES/FR/HT)
- [ ] Language switcher works
- [ ] All UI text translated
- [ ] Dates/times use locale formatters

---

## Testing Instructions

### Manual Testing (Before Beta)

1. **Create test account** with email `test@oxsteed.local`
2. **Sign up → onboarding**
3. **Post a job** (with photo)
4. **Switch to helper persona** → see job in nearby feed
5. **Place bid** on job as helper
6. **Switch back to customer** → see bid, accept it
7. **Appointment created** → book service from appointment
8. **Navigate offline** (airplane mode)
9. **Add life log entry** while offline
10. **Go online** → entry syncs
11. **Change language** to Spanish
12. **All UI strings** should be in Spanish
13. **Sign out** → back to login

### Automated Testing
- Unit tests for API client (mocked responses)
- Unit tests for `OneStore` methods (mock API)
- UI tests for critical paths (post job, book service)

---

## Success Criteria (Ship When These Pass)

✅ User can complete entire customer → helper → business job workflow end-to-end

✅ All errors show with user-friendly messages + retry options

✅ App works offline for life tab; syncs when online

✅ Loading states prevent double-submissions

✅ All strings translated to EN/ES/FR/HT

✅ Biometric unlock works

✅ Force update check works

✅ 95%+ test coverage on critical paths

---

## Deployment Steps

1. Create beta build in Xcode
2. Upload to TestFlight via App Store Connect
3. Invite 10–20 beta testers
4. Gather feedback (1 week)
5. Fix bugs + polish
6. Submit to App Store for review (2 weeks)
7. Soft launch in one city
8. Monitor crashes, performance
9. Expand to all regions

---

## Summary

This document provides a **complete, phase-by-phase roadmap** to convert the iOS UI mockup into a production-ready app. Each phase:

- Lists files to modify/create
- Provides exact code examples to implement
- Includes verification checklists
- Takes ~6–20 hours to complete

**Total effort: 36 hours (4–5 days of focused development)**

Follow this sequentially. Don't skip phases; each builds on the previous one. When complete, you'll have a **fully functional app ready for real user testing**.
