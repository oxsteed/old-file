# OxSteedOne Codebase Quick Reference
**For:** Codex iOS development  
**Updated:** 2026-05-25

---

## Architecture Overview (Mental Model)

```
┌─────────────────────────────────────────────────────────┐
│                    App Entry Point                       │
│                  (OxSteedOneApp.swift)                   │
│              Creates @Observable OneStore                │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              OneRootView (Navigation Shell)              │
│  - Force update check                                    │
│  - Auth check (login/signup)                             │
│  - Biometric lock check                                  │
│  - 5-tab TabView (if authenticated)                      │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼ (and 2 more)
    TodayView       HireView        ShopView
    (HOME tab)      (LIFE tab)      (GROWTH tab)
        │               │               │
        └───────────────┼───────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              OneStore (@Observable)                      │
│  - State for all 5 tabs                                  │
│  - 30+ fetch methods (API calls)                         │
│  - 20+ mutation methods (create/update)                  │
│  - Offline sync queue                                    │
│  - Error handling & logging                              │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
 OxSteedOneAPIClient            OneSessionVault
 (HTTP requests)            (UserDefaults + Keychain)
        │                               │
        ▼                               ▼
   Backend API              Persisted App Data
   (Node.js Express)        (Survives app restart)
```

---

## File Organization

### Core App Structure
```
Sources/
├── OxSteedOneApp.swift
│   └─ Entry point (@main struct)
│      Creates OneStore, passes to OneRootView via @Environment
│
├── OneRootView.swift (195 lines)
│   ├─ Force update check
│   ├─ Auth state routing (LoginView, SignupView embedded)
│   ├─ Biometric unlock flow
│   └─ 5-tab TabView with AppTab enum
│
├── OneStore.swift (2100+ lines) ⭐ THE BRAIN
│   ├─ @Observable final class
│   ├─ 100+ @Published properties
│   ├─ 30+ async fetch methods
│   ├─ 20+ sync/mutation methods
│   ├─ Network connectivity monitoring
│   ├─ Offline sync queue
│   └─ Error handling
│
├── OneModels.swift (200+ lines)
│   ├─ AppTab enum (home, life, growth, learn, profile)
│   ├─ AppPersona enum (customer, helper, businessOwner, etc.)
│   ├─ AppLanguage enum (en, es, fr, ht)
│   └─ 20+ domain models
│
├── OneAPIModels.swift (500+ lines) ⭐ DATA CONTRACTS
│   ├─ Request DTOs (OneCreateJobRequest, etc.)
│   ├─ Response DTOs (OneJobDTO, OneHelperDTO, etc.)
│   ├─ Envelope types (OneJobListResponse, etc.)
│   └─ Codable conformances with CodingKeys
│
└── Networking/
    ├─ OxSteedOneAPIClient.swift (175 lines) ⭐ HTTP LAYER
    │   ├─ Generic get<Response>(), post<Body, Response>()
    │   ├─ Token management & refresh on 401
    │   ├─ JSON encoding with snake_case conversion
    │   └─ Error handling (OneAPIError enum)
    │
    └─ OneErrorMapper.swift
        └─ Maps API errors to user-friendly messages

UI/
├─ TodayView.swift (700+ lines) ⭐ HOME TAB
│   ├─ Customer job posting form
│   ├─ Helper job browsing
│   ├─ Bid management
│   ├─ Booking management
│   ├─ Trust & Safety section
│   └─ Offline sync indicator
│
├─ HireView.swift (335+ lines) ⭐ LIFE TAB
│   ├─ Pulse Score visualization (6 pillars)
│   ├─ Urgency queue
│   ├─ Life log creation
│   ├─ Sinking fund tracking
│   └─ API sync for all data
│
├─ ShopView.swift (335+ lines) ⭐ GROWTH TAB
│   ├─ Economic Mobility Ladder
│   ├─ 4 growth forms (Ascension, Wholesale, Financing, Grants)
│   ├─ Wallet display
│   ├─ Tax documents
│   └─ Transaction history
│
├─ InboxView.swift (195+ lines)
│   ├─ Academy lessons
│   ├─ Toolkit bundles
│   └─ Unified inbox thread list
│
├─ ProfileView.swift (175+ lines)
│   ├─ Persona picker (7 roles)
│   ├─ Language selector
│   ├─ Appearance toggle
│   ├─ Biometric lock
│   └─ Notification preferences
│
├─ Components/
│   ├─ PhotoPicker.swift (119 lines)
│   │   ├─ PHPickerViewController wrapper
│   │   └─ PhotoThumbnailStrip component
│   │
│   ├─ InboxThreadView.swift
│   │   ├─ Message thread detail
│   │   ├─ Message bubbles
│   │   └─ [MISSING] Send message form
│   │
│   └─ ... other components
│
└─ Localization/
    └─ GoLocalization.swift (175 lines)
        ├─ Translation table (EN/ES/FR/HT)
        ├─ 57 keys (10% of UI)
        └─ localized() function

Utilities/
├─ OneSessionVault.swift (651 lines) ⭐ DATA PERSISTENCE
│   ├─ Keychain methods (saveToken, loadToken, etc.)
│   ├─ UserDefaults methods (saveCustomerJobs, etc.)
│   └─ Seed data fallbacks
│
├─ OneTheme.swift
│   └─ Design tokens (colors, spacing)
│
├─ Logger.swift
│   └─ Structured logging
│
└─ OneConstants.swift
    └─ App-wide constants
```

---

## Key Patterns & How They Work

### Pattern 1: Async Fetch Methods in OneStore

**Location:** OneStore.swift, every method starting with `fetch*`

**Pattern:**
```swift
// 1. Mark async (suspendable, returns without blocking)
func fetchMyJobs(status: String) async {
    // 2. Add loading state
    isLoadingJobs = true
    lastJobError = nil
    
    // 3. Defer cleanup (runs on exit, success or error)
    defer { isLoadingJobs = false }
    
    do {
        // 4. Call API client with typed generics
        let response: OneJobListResponse = try await apiClient.get(
            "/api/jobs/me?status=\(status)"
        )
        
        // 5. Extract data (handle inconsistent envelopes)
        let jobs = response.jobs ?? response.data ?? []
        
        // 6. Update state
        myJobs = jobs
        
        // 7. Reset error
        lastJobError = nil
        
    } catch {
        // 8. Map error to user-friendly message
        lastJobError = OneErrorMapper.mapError(error)
        
        // 9. Enqueue for retry on network return (offline handling)
        enqueueForRetry(
            operation: { await self.fetchMyJobs(status: status) },
            label: "fetch_my_jobs"
        )
    }
}
```

**How to Call from Views:**
```swift
// In any view with @Environment(OneStore.self) var store
Button("Refresh") {
    Task { await store.fetchMyJobs(status: "open") }
}
```

---

### Pattern 2: Mutation Methods in OneStore

**Slightly different from fetches - they also mutate local state:**

```swift
// Example: addLifeLogEntry
func addLifeLogEntry(_ entry: LifeLogEntry) {
    // 1. Append to local array immediately (optimistic update)
    lifeLogEntries.append(entry)
    
    // 2. Sync to server in background
    Task {
        let success = await syncLifeLogEntry(entry)
        if !success {
            // 3. Revert on failure
            lifeLogEntries.removeAll { $0.id == entry.id }
            lastJobError = "Failed to save entry"
        }
    }
}

func syncLifeLogEntry(_ entry: LifeLogEntry) async -> Bool {
    do {
        let request = OneCreateLifeLogRequest(
            pillarId: entry.pillarId,
            title: entry.title,
            // ...
        )
        
        let response: OneGenericSuccessResponse = try await apiClient.post(
            "/api/life-log",
            body: request
        )
        
        return response.success ?? false
        
    } catch {
        enqueueForRetry(
            operation: { await self.syncLifeLogEntry(entry) },
            label: "sync_life_log"
        )
        return false
    }
}
```

---

### Pattern 3: Form Submission Flow

**Example: Submitting Ascension Application**

**In View (ShopView.swift):**
```swift
@State private var fullName = ""
@State private var targetLicense = ""

Button("Submit") {
    Task {
        // Call OneStore method
        await store.submitAscensionApplication(
            fullName: fullName,
            skill: store.activePersona.rawValue,
            targetLicense: targetLicense
        )
    }
}

// Show loading state
if store.isSubmittingCustomerJob {
    ProgressView()
}

// Show success/error messages
if let msg = store.customerJobFlowMessage {
    Text(msg).foregroundColor(.green)
}

if let error = store.lastJobError {
    Text(error).foregroundColor(.red)
}
```

**In OneStore.swift:**
```swift
func submitAscensionApplication(fullName: String, skill: String, targetLicense: String) async {
    isSubmittingCustomerJob = true // Show spinner in view
    lastJobError = nil
    customerJobFlowMessage = nil
    
    defer { isSubmittingCustomerJob = false } // Hide spinner
    
    let request = OneJoinAscensionRequest(...)
    
    do {
        let response: OneGenericSuccessResponse = try await apiClient.post(...)
        if response.success ?? false {
            customerJobFlowMessage = "Application submitted!" // View shows success
        } else {
            lastJobError = "Failed to submit" // View shows error in red
        }
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        // Optionally enqueue for retry
    }
}
```

---

### Pattern 4: Persona Switching (Multi-role State)

**How it Works:**

```swift
// In OneStore: single activePersona property
@Published var activePersona: AppPersona = .customer

// In ProfileView: Picker to switch
Picker("Persona", selection: $store.activePersona) {
    ForEach(AppPersona.allCases, id: \.self) { persona in
        Text(persona.displayName).tag(persona)
    }
}

// When persona changes:
// 1. activePersona updates
// 2. TodayView re-renders (shows different UI for each persona)
// 3. homeReloadToken UUID changes (forces HOME tab refresh)

// In TodayView, show different content per persona:
if store.activePersona == .customer {
    CustomerJobUI()
} else if store.activePersona == .helper {
    HelperJobFeedUI()
} else if store.activePersona == .businessOwner {
    BusinessDashboardUI()
}
```

**Important:** HomeReloadToken ensures HOME tab fully refreshes on persona switch, avoiding stale data.

---

### Pattern 5: Offline Sync Queue

**How it Works:**

```swift
// In OneStore
var pendingSyncChanges: [SyncOperation] = []

func enqueueForRetry(operation: @escaping () async -> Void, label: String) {
    let syncOp = SyncOperation(id: UUID(), operation: operation, label: label)
    pendingSyncChanges.append(syncOp)
    
    // Persist to UserDefaults so survives app restart
    OneSessionVault.savePendingSyncQueue(pendingSyncChanges)
}

// When network returns (monitored by NWPathMonitor):
func syncPendingChanges() async {
    for operation in pendingSyncChanges {
        try await operation.operation()
    }
    // Clear queue on success
    pendingSyncChanges.removeAll()
}

// In TodayView, show indicator:
if !store.pendingSyncChanges.isEmpty {
    HStack {
        ProgressView().scaleEffect(0.8)
        Text("Syncing changes...")
    }
    .padding()
    .background(.blue.opacity(0.1))
}
```

---

## State Properties Quick Map

### Authentication
```swift
@Published var isAuthenticated: Bool = false
@Published var currentUser: OneAuthUser?
@Published var accessToken: String = ""
@Published var refreshToken: String = ""
```

### Jobs & Bids
```swift
@Published var myJobs: [OneJobDTO] = []
@Published var myBids: [OneBidDTO] = []
@Published var jobFeed: [OneJobDTO] = []  // Helper view
@Published var selectedJobId: String?
@Published var selectedBidId: String?
```

### Personas & Roles
```swift
@Published var activePersona: AppPersona = .customer
@Published var personaContext: PersonaContext?
var homeReloadToken = UUID() // Force refresh on switch
```

### Marketplace Data
```swift
@Published var serviceBookings: [OneAppointmentDTO] = []
@Published var rentalTools: [OneToolBrowseDTO] = []
@Published var unifiedInbox: [OneInboxThreadDTO] = []
```

### Growth/Life
```swift
@Published var lifeLogEntries: [LifeLogEntry] = []
@Published var sinkingFunds: [SinkingFund] = []
@Published var ascensionApplication: AscensionStatus
@Published var wholesaleGroups: [WholesaleGroup] = []
@Published var grantOpportunities: [Grant] = []
@Published var walletSnapshot: WalletSnapshot
```

### UI State
```swift
@Published var isLoadingJobs: Bool = false
@Published var isSubmittingCustomerJob: Bool = false
@Published var lastJobError: String?
@Published var customerJobFlowMessage: String?
@Published var appLanguage: AppLanguage = .english
@Published var isDarkMode: Bool = true
```

### Connectivity
```swift
var isOnline: Bool = true  // NWPathMonitor
var pendingSyncChanges: [SyncOperation] = []
```

---

## API Call Reference

### How to Add a New Fetch

**Step 1: Add to OneStore.swift**
```swift
func fetchNewResource(id: String) async -> [NewResourceDTO]? {
    do {
        let response: OneDataEnvelope<[NewResourceDTO]> = try await apiClient.get(
            "/api/new-resource/\(id)"
        )
        return response.data
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        return nil
    }
}
```

**Step 2: Add DTOs to OneAPIModels.swift**
```swift
struct NewResourceDTO: Decodable {
    let id: String?
    let name: String?
    // ... other fields
}
```

**Step 3: Call from View**
```swift
Button("Load") {
    Task {
        let result = await store.fetchNewResource(id: "123")
    }
}
```

**That's it!** The OxSteedOneAPIClient handles:
- ✅ URL building
- ✅ Bearer token injection
- ✅ JSON encoding/decoding
- ✅ Snake_case conversion
- ✅ 401 token refresh
- ✅ Error mapping

---

## Error Handling Quick Map

### API Errors (automatically mapped)
```
400 (Validation Error)  →  "Please check your input"
401 (Unauthorized)      →  "Token expired, logging in..."
404 (Not Found)         →  "Resource not found"
500 (Server Error)      →  "Something went wrong, please try again"
Network Timeout         →  "Check your connection and try again"
```

### How to Handle in Views
```swift
if let error = store.lastJobError {
    Text(error)
        .foregroundColor(.red)
        .padding()
}

Button("Retry") {
    store.lastJobError = nil  // Clear error
    // Retry operation
}
```

---

## Common Tasks

### 1. Add a New Field to User Profile
```swift
// 1. Backend returns new field in GET /api/me
// 2. Add to OneAuthUser DTO in OneAPIModels.swift
// 3. Add to OneStore state
@Published var userBio: String = ""
// 4. Update in view when profile loads
```

### 2. Add Loading Indicator to View
```swift
if store.isLoadingJobs {
    ProgressView()
} else {
    // Content
}
```

### 3. Handle Offline Post
```swift
// 1. Update local state immediately
store.myJobs.append(newJob)

// 2. Sync in background
Task {
    let success = await store.postCustomerJobServerFirst(...)
    if !success {
        // Revert on failure
        store.myJobs.removeAll { $0.id == newJob.id }
    }
}
```

### 4. Switch Language
```swift
Picker("Language", selection: $store.appLanguage) {
    ForEach(AppLanguage.allCases, id: \.self) { lang in
        Text(lang.displayName).tag(lang)
    }
}

// All UI automatically updates via:
Text(OneLocalization.localized("key", for: store.appLanguage))
```

### 5. Validate Form Input
```swift
Button("Submit") {
    // Client-side validation
    guard !fullName.isEmpty else {
        store.lastJobError = "Name required"
        return
    }
    
    // Server will also validate
    Task {
        await store.submitForm(name: fullName)
    }
}
```

---

## Performance Tips

### 1. Avoid Unnecessary Re-renders
```swift
// ❌ BAD - Re-renders even if unrelated state changes
if store.activePersona == .customer {
    CustomerView()  // Rebuilds entire tree
}

// ✅ GOOD - Only PersonaView rebuilds
PersonaView(persona: store.activePersona)
```

### 2. Use State-driven UI, Not Conditionals
```swift
// ❌ BAD
var shouldShowError: Bool { store.lastJobError != nil }

// ✅ GOOD
if let error = store.lastJobError {
    // Use error directly
}
```

### 3. Debounce Search Queries
```swift
@State private var searchText = ""
@State private var searchTask: Task<Void, Never>?

var searchResults: [Job] = []

func onSearchChange(_ text: String) {
    searchTask?.cancel()
    
    searchTask = Task {
        try? await Task.sleep(milliseconds: 300)
        
        if !Task.isCancelled {
            searchResults = await store.searchJobs(text: text)
        }
    }
}
```

---

## Debugging Tips

### 1. Print OneStore State
```swift
// Add to OneStore
func debugPrintState() {
    print("=== OneStore State ===")
    print("ActivePersona: \(activePersona)")
    print("MyJobs: \(myJobs.count)")
    print("Pending Sync: \(pendingSyncChanges.count)")
    print("Last Error: \(lastJobError ?? "none")")
}
```

### 2. Monitor Network Traffic
```swift
// In OxSteedOneAPIClient.sendRaw()
print("📡 Request: \(method) \(url)")
print("📡 Response: \(response.statusCode)")
```

### 3. Check Persisted Data
```swift
// In OneSessionVault
func debugPrintAll() {
    print("Saved Jobs: \(loadCustomerJobs().count)")
    print("Saved Token: \(loadToken() != nil ? "exists" : "missing")")
    print("Saved Language: \(UserDefaults.standard.string(forKey: "appLanguage") ?? "default")")
}
```

---

## Testing Strategy

### Unit Tests
```swift
// Test OneStore methods in isolation
func testFetchMyJobs() async {
    let store = OneStore()
    let jobs = await store.fetchMyJobs(status: "open")
    XCTAssertNotNil(jobs)
    XCTAssertGreaterThan(jobs?.count ?? 0, 0)
}
```

### UI Tests
```swift
// Test critical user flows
func testJobPostingFlow() {
    // 1. Login
    // 2. Navigate to TodayView
    // 3. Fill job form
    // 4. Submit
    // 5. Verify success message
}
```

### Integration Tests
```swift
// Test OneStore + API Client + Models
func testEndToEndJobCreation() async {
    // 1. Create job via API
    // 2. Verify it appears in myJobs
    // 3. Verify persisted to UserDefaults
    // 4. Kill app, restart
    // 5. Verify data still there
}
```

---

## Next Steps

1. **Read PRODUCTION_READINESS_AUDIT.md** — Understand what's missing
2. **Read PHASE_1_IMPLEMENTATION_GUIDE.md** — Detailed implementation steps
3. **Start Phase 1** — Implement 6 missing methods + S3 upload + Stripe
4. **Test thoroughly** — Use manual testing checklist
5. **Move to Phase 2** — Real-time messaging (Socket.IO)

---

**Questions?** Check the implementation guides for specific code examples.  
**Ready to code?** Open `OneStore.swift` and start implementing Phase 1!
