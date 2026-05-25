# OxSteed iOS SwiftUI App — Production Readiness Audit
**Date:** May 25, 2026  
**Status:** UI Scaffolding 90% Complete | Backend Integration 5% Complete | **NOT PRODUCTION READY**

---

## Executive Summary

The native iOS SwiftUI app has **comprehensive UI scaffolding** for all 5 tabs and persona-aware home screens, but is **almost entirely missing backend integration**. The app shows placeholder data and local-only state management. To be production-ready for real user testing, the app needs:

1. **Real API calls** replacing mock data
2. **Actual data persistence** via database sync
3. **Authentication flow** (currently hardcoded)
4. **Error handling & retry logic**
5. **Biometric auth & force update** 
6. **Multi-language support** (infrastructure exists; translations need completion)

---

## What's Already Built (UI Layer: 90% Complete)

### ✅ Architecture Foundation
- **@Observable pattern** (`OneStore.swift`) — modern SwiftUI state management with 100+ properties
- **@Environment injection** — all views access store cleanly
- **Session vault** (`OneSessionVault.swift`) — persistent local storage for onboarding state, preferences, lists
- **Locale support** — infrastructure for EN/ES/FR/HT with `appLanguage` and `activeLocale` properties
- **Theme system** (`OneTheme.swift`) — consistent colors, typography, spacing across all screens
- **Custom components** — `GoScreen`, `GoCard`, `GoAccentButtonStyle`, `GoButton`, `OxSteedOneMark`

### ✅ Tab Navigation (5/5 Complete)
1. **TodayView (Home Tab)** — 700+ lines
   - Persona-aware home cards (Customer → Jobs, Helpers, Bookings, Rentals; Helper → Nearby jobs, earnings; Business Owner → Team/dispatch/revenue; Consultant → Intake queue; etc.)
   - Universal search with saved alerts
   - Map view with location pins
   - Trust & safety (verification badges, SOS button, safety timer)
   - Two-way reviews form
   - Mock customer transaction flows (job posting, bid acceptance, booking, tool rental)

2. **HireView (Life Tab)** — 370+ lines
   - **Pulse Score** visualization (6-pillar colored ring, 0-100 score)
   - Six pillar drilldown with sample data (Money, Home Care, Car Care, Personal Care, Goals, Planned Needs)
   - **Urgency queue** sorted by deadline
   - **Life log** entry form (offline-resilient)
   - **Sinking funds** creation, status tracking (on-track/behind/critical), weekly contribution calculation
   - Booking request form + counter-propose flow
   - Buffer time between jobs configuration

3. **ShopView (Growth Tab)** — 335+ lines
   - Economic mobility ladder (Skill → Side Income → Licensed Business → Scaled Operation)
   - **Business Ascension Application** form
   - **Wholesale Groups** join/leave toggle
   - **Financing Pre-Qualification** form (amount, purpose, revenue, credit band)
   - **Grants & Subsidies** list
   - Progress tracker visual
   - **Tax document center** (year-to-date gross/deductions display)
   - **Wallet** UI (available balance, pending escrow, payout method)
   - Transaction history form + list
   - **Quote builder** (labor + materials, customer name)
   - **Recurring services** plan creation + pause/resume

4. **InboxView (Learn Tab)** — 195+ lines
   - **OxSteed Academy** lessons list with duration/category
   - **Tool Kit Store** bundles (with affiliate links to Amazon)
   - **Trending Skills** in your area with learner counts
   - **Unified inbox** with unread counts and persona tagging
   - **Creator upload** form with moderation status (pending/approved/rejected)
   - Auto-translate toggle for inbox previews

5. **ProfileView (Settings Tab)** — 175+ lines
   - **Persona picker** (7 roles with instant switching)
   - **Business selection** (picker sheet + sub-role override for owner)
   - **Language selector** (EN/ES/FR/HT) with locale display + RTL/LTR indication
   - **Appearance toggle** (system/light/dark)
   - **Privacy mode** (mask sensitive values)
   - **Biometric lock** toggle
   - **Notification preferences by persona** (enabled toggle + radius miles + quiet hours)
   - **Availability blocks** manager (recurring availability)
   - **Account recovery** status + data export/deletion requests

### ✅ State Management (OneStore.swift: 100+ properties)
- Persona context (active persona, selected business, sub-role)
- Life data (life log entries, sinking funds, booking drafts, dispatch buffer)
- Marketplace data (customer jobs, bids, service bookings, tool rentals)
- Growth ladder (ascension app, wholesale groups, financing prequal, grants, tax docs)
- Learning content (academy lessons, tool kits, trending skills)
- Communication (unified inbox threads, auto-translate flag)
- Safety (verification badges, safety timer, SOS trigger)
- Settings (app language, appearance, privacy mode, notification prefs, availability blocks)
- Wallet (snapshot + transaction history)
- Creator content (uploads with moderation status)
- Search (universal search query, saved alerts, map points)

### ✅ Computed Properties & Logic
- `pulseScore` — weighted average of 6 pillars
- `urgencyQueue` — critical items per pillar sorted by deadline
- `homeSections` — persona-specific home card layout
- `pulsePillars` — 6-pillar data with color tints
- `growthNextStep` — recommends next action in ascension flow
- `activeLocale` — language-aware Locale object
- `canUploadCreatorContent` — role + verification badge check
- `resolvedBusinessSubRole` — membership lookup with owner override logic
- `canOverrideBusinessSubRole` — owner-only check

---

## What's Missing for Production (Backend Integration: 5% Complete)

### 🔴 CRITICAL: Authentication & Session Management

**Current State:**
```swift
var authEmail = ""
var authPassword = ""
var authStatusMessage: String?
```
- Login/registration **UI forms exist** but **don't call API**
- No JWT token storage or refresh logic
- No session timeout handling
- Email/password stored in plain text in state (unsafe)

**Needed:**
```swift
// Missing:
func login(email: String, password: String) async throws -> AuthToken
func register(email: String, password: String, persona: AppPersona) async throws -> AuthToken
func refreshToken() async throws -> AuthToken
func logout() async
func setupBiometricAuth() async
func authenticateWithBiometric() async throws -> Bool
```

**Impact:** Users can't sign in; app can't authenticate API calls.

---

### 🔴 CRITICAL: Real API Integration

**Current State:**
```swift
private let api = OxSteedOneAPIClient()
// OneAPIClient has basic HTTP methods (get, post, put)
// But OneStore NEVER calls api.get() or api.post()
```

**All data is mocked:**
- `customerJobs` — hardcoded in `OneSessionVault.loadCustomerJobs()`
- `pulsePillars` — hardcoded computed property returning 6 sample items
- `ascensionApplication` — loaded from vault (empty on first run)
- `walletSnapshot` — loaded from vault (hardcoded zeros)

**Needed:**
```swift
// Missing for EVERY feature:
func refreshCustomerJobs() async throws
func postJob(title: String, ...) async throws -> CustomerJobPost
func acceptBid(bidId: UUID) async throws
func postCustomerJobServerFirst(title: String, ...) async // Currently a mock
func refreshServiceHelpers() async throws
func createServiceBookingServerFirst(helperID: UUID, ...) async // Currently a mock
func refreshToolRentals() async throws
func reserveToolServerFirst(toolID: UUID, ...) async // Currently a mock
// ... similar for all 100+ user actions
```

**Impact:** App is fully offline. No syncing with backend.

---

### 🔴 CRITICAL: Data Synchronization

**Current State:**
- All data loaded **once** at app launch from `OneSessionVault`
- No refresh mechanism (button "Refresh" exists but doesn't call API)
- No background sync
- No conflict resolution if user is on multiple devices

**Needed:**
```swift
// Missing:
func syncAllData() async throws  // Full re-fetch from server
func setupBackgroundSync()  // Periodic refresh
func handleOfflineChanges() async throws  // Queue edits, sync when online
func resolveConflicts(local: [Item], remote: [Item]) -> [Item]  // If user on 2 devices
```

**Impact:** Stale data; user actions don't persist.

---

### 🔴 CRITICAL: Real Data Loading in Views

**Example from TodayView (Lines 103-109):**
```swift
GoCard {
    HStack {
        Text("Customer Transactions")
        Spacer()
        Button("Sync Live Data") {
            Task { await store.refreshCustomerTransactionData() }
        }
    }
}
```

The method `refreshCustomerTransactionData()` **doesn't exist** in OneStore. Button does nothing.

**Every view has this issue:**
- Buttons call methods that don't exist: `.refreshCustomerTransactionData()`, `.postCustomerJobServerFirst()`, `.acceptBidServerFirst()`, etc.
- Some are partially stubbed (empty `async` functions returning success)
- None actually call the API

**Needed:**
Each method must:
1. Call `api.post()` / `api.get()` / `api.put()`
2. Decode the response into model types
3. Update `OneStore` property with fresh data
4. Handle errors with retry + user feedback
5. Update UI (handled automatically via `@Observable`)

---

### 🟠 HIGH: Biometric Auth & Force Update

**Current State:**
```swift
var biometricEnabled = OneSessionVault.loadBiometricEnabled()
var forceUpdateRequired = false
Toggle("Biometric lock", isOn: $biometricEnabled)  // Toggle exists but doesn't work
```

**What's Missing:**
```swift
@available(iOS 17.0, *)
func setupBiometricAuth() async throws {
    let context = LAContext()
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
        throw BiometricError.notAvailable
    }
    // Store biometric flag
}

func authenticateWithBiometric() async throws -> Bool {
    let context = LAContext()
    let reason = "Unlock OxSteed"
    do {
        let success = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
        return success
    } catch {
        throw BiometricError.authenticationFailed
    }
}

// Check on app launch:
if biometricEnabled && !isLocked {
    isLocked = true  // Show lock screen until biometric passes
}
```

**Impact:** App can be accessed without authentication; security risk.

---

### 🟠 HIGH: Multi-Language Real Content

**Current State:**
- UI supports EN/ES/FR/HT via `AppLanguage` enum
- Picker exists in Settings
- `activeLocale` property set correctly
- Number/currency formatters use `activeLocale`

**Missing:**
- No translation strings for **any** of the 700+ UI labels
- Hardcoded English text throughout all 5 views
- Example: `Text("Customer Job Posting")` should be `Text("jobPosting.title", tableName: "Localizable")`
- No Localizable.strings files for ES/FR/HT
- Real-time message translation toggle exists but doesn't translate anything

**Needed:**
```swift
// Create files:
// - Localizable.strings (English)
// - Localizable.strings (Spanish)
// - Localizable.strings (French)
// - Localizable.strings (Haitian Creole)

// Update 700+ lines to use NSLocalizedString or SwiftUI Text(_:tableName:)
Text(NSLocalizedString("customerJobPosting.title", tableName: "Localizable", comment: ""))
// OR with .strings keys
Text("customerJobPosting.title")  // with Localizable.strings lookup
```

**Needed for real-time message translation:**
```swift
// Missing in OneStore:
func translateMessage(text: String, fromLanguage: String, toLanguage: String) async throws -> String {
    // Call /api/translate endpoint
    let translation = try await api.post<TranslationResponse>(
        "/translate",
        body: TranslationRequest(text: text, from: fromLanguage, to: toLanguage)
    )
    return translation.translatedText
}
```

**Impact:** App only usable in English; spec requires 4 languages.

---

### 🟠 HIGH: Error Handling & Retry Logic

**Current State:**
```swift
Button("Publish Job + Notify Helpers") {
    Task {
        await store.postCustomerJobServerFirst(...)
    }
}
```

**Missing:**
- No `.try` or `.catch`
- No error message shown to user
- No retry button on failure
- No offline indication
- API errors silently ignored (methods exist but don't actually call API)

**Needed:**
```swift
// In OneStore:
var lastError: (message: String, canRetry: Bool)?

func postCustomerJobServerFirst(...) async {
    do {
        let job = try await api.post<CustomerJobPost>(
            "/jobs",
            body: JobRequest(...)
        )
        customerJobs.append(job)
        lastError = nil  // Clear error
    } catch let error as NetworkError {
        lastError = (
            message: "Network error. Check your connection.",
            canRetry: true
        )
    } catch {
        lastError = (
            message: error.localizedDescription,
            canRetry: false
        )
    }
}

// In View:
if let lastError = store.lastError {
    HStack {
        Text(lastError.message).font(.caption).foregroundColor(.red)
        if lastError.canRetry {
            Button("Retry") { Task { await store.postCustomerJobServerFirst(...) } }
        }
    }
}
```

**Impact:** Users don't know if their action succeeded or failed.

---

### 🟠 HIGH: Loading States & Skeleton Screens

**Current State:**
- No loading indicators anywhere
- Button text doesn't change to "Posting..." or "Loading..."
- User has no feedback while waiting for API response

**Needed:**
```swift
// In OneStore:
var isPostingJob = false
var isLoadingHelpers = false

func postCustomerJobServerFirst(...) async {
    isPostingJob = true
    defer { isPostingJob = false }  // Always turn off, even if error
    // Make API call
}

// In View:
Button(store.isPostingJob ? "Posting..." : "Post Job") {
    if !store.isPostingJob {
        Task { await store.postCustomerJobServerFirst(...) }
    }
}
.disabled(store.isPostingJob)
```

**Impact:** Users click button repeatedly thinking it didn't work; duplicate submissions.

---

### 🟠 HIGH: Background Sync & Offline Resilience

**Current State:**
- Life log entries saved locally to `OneSessionVault`
- App can function entirely offline (but with no data)
- No queue for offline edits
- Spec requirement: "App is offline-resilient — Life tab entries save locally and sync when online"

**Needed:**
```swift
// Missing:
struct PendingChange {
    let id: UUID
    let action: String  // "create", "update", "delete"
    let resource: String  // "lifeLogEntry", "sinkingFund", etc.
    let data: Data  // JSON payload
    let createdAt: Date
}

var pendingChanges: [PendingChange] = []  // Queue of edits while offline

func addLifeLogEntryWithSync(pillarID: String, title: String, detail: String) async {
    let entry = LifeLogEntry(pillarID: pillarID, title: title, detail: detail)
    lifeLogEntries.append(entry)
    OneSessionVault.save(lifeLogEntries)  // Save locally first
    
    // Try to sync, but don't block
    Task {
        do {
            _ = try await api.post<LifeLogEntry>("/life-log", body: entry)
            // Success - nothing more needed
        } catch {
            // Queue the change for retry
            pendingChanges.append(
                PendingChange(id: entry.id, action: "create", resource: "lifeLogEntry", data: try JSONEncoder().encode(entry), createdAt: Date())
            )
        }
    }
}

// On app launch or when connectivity returns:
func syncPendingChanges() async {
    for change in pendingChanges {
        do {
            try await api.post("/sync/\(change.resource)", body: change.data)
            pendingChanges.removeAll { $0.id == change.id }
        } catch {
            // Log and continue with next change
        }
    }
}
```

**Impact:** User's offline edits are lost if app crashes; no sync on reconnect.

---

### 🟠 HIGH: Real Marketplace Flows

**Examples of stub methods in OneStore:**
```swift
// Line 400+: These methods are called from buttons but don't exist or are empty
func postCustomerJobServerFirst(...) async { }
func acceptBidServerFirst(_ bidId: UUID) async { }
func createServiceBookingServerFirst(...) async { }
func reserveToolServerFirst(toolID: UUID, slot: String, ...) async { }
func submitAscensionApplication(...) { }
func submitFinancingPrequal(...) { }
```

**Each needs real implementation:**
```swift
func postCustomerJobServerFirst(title: String, ...) async {
    isPostingJob = true
    defer { isPostingJob = false }
    do {
        let job = try await api.post<CustomerJobPost>(
            "/jobs",
            body: ["title": title, "description": description, ...]
        )
        customerJobs.append(job)
    } catch {
        lastError = (message: error.localizedDescription, canRetry: true)
    }
}
```

**Impact:** Users can see UI but can't actually post jobs, book services, or rent tools.

---

### 🟢 MEDIUM: Pagination & Large Lists

**Current State:**
- `.prefix(3)` or `.prefix(5)` shown for all lists (hardcoded)
- No "Load more" button
- No pagination API calls

**Needed:**
```swift
var jobPage = 1
var isLoadingMoreJobs = false

func loadMoreJobs() async {
    guard !isLoadingMoreJobs else { return }
    isLoadingMoreJobs = true
    defer { isLoadingMoreJobs = false }
    do {
        let moreJobs = try await api.get<[CustomerJobPost]>("/jobs/me?page=\(jobPage)&limit=20")
        customerJobs.append(contentsOf: moreJobs)
        jobPage += 1
    } catch {
        lastError = (message: "Failed to load more", canRetry: true)
    }
}
```

**Impact:** User sees only first 3–5 items in any list.

---

### 🟢 MEDIUM: Payment Integration

**Current State:**
- Wallet displays hardcoded balance
- "Book Service" and "Reserve Tool" buttons don't actually charge

**Needed:**
```swift
// Missing:
func createPaymentIntent(for booking: CustomerServiceBooking) async throws -> String {
    let response = try await api.post<PaymentIntentResponse>(
        "/payments/intent",
        body: ["bookingId": booking.id, "amount": booking.estimatedCost]
    )
    return response.clientSecret
}

// Then integrate Stripe SDK to actually charge the card
// This is beyond scope of this audit but critical for real transactions
```

**Impact:** App processes no payments; revenue = $0.

---

### 🟢 MEDIUM: Real Images & File Uploads

**Current State:**
- Photo picker opens in views but photos never uploaded
- `postPhotos` field shows filenames as strings ("photo1.jpg, photo2.jpg")
- Job posts can't include actual photos

**Needed:**
```swift
func pickAndUploadPhotos() async {
    let photoData = try await PHPickerViewController.selectPhotos(maxCount: 6)
    for photo in photoData {
        let url = try await api.uploadFile(photo, to: "/uploads/jobs")
        postPhotoURLs.append(url)
    }
}
```

**Impact:** Jobs posted without images; harder for helpers to understand scope.

---

### 🟢 MEDIUM: Real Notifications

**Current State:**
- Notification preferences form exists
- Toggle for "Auto-translate inbox previews"
- No actual push notifications or inbox updates

**Needed:**
```swift
// Missing:
func setupPushNotifications() async throws {
    let center = UNUserNotificationCenter.current()
    try await center.requestAuthorization(options: [.alert, .sound, .badge])
    DispatchQueue.main.async {
        UIApplication.shared.registerForRemoteNotifications()
    }
}

func handlePushNotification(_ notification: UNNotification) {
    let threadID = notification.request.content.userInfo["threadId"] as? Int
    selectedThread = threadID
}
```

**Impact:** Users don't know when new messages arrive or jobs are available.

---

### 🟢 MEDIUM: Real Search & Filtering

**Current State:**
```swift
TextField("Search jobs, helpers, tools, training, financing", text: ...)
Text("Saved search alerts and map overlays are next implementation step.")
```
- Universal search field exists but doesn't search anything
- Filters (`helperMinRating`, `toolMaxRate`) exist but only filter local mock data

**Needed:**
```swift
func searchGlobal(query: String) async throws -> [GlobalSearchResult] {
    let results = try await api.get<[GlobalSearchResult]>(
        "/search?q=\(query.addingPercentEncoding()!)"
    )
    globalSearchResults = results
}

func createSavedAlert(query: String, persona: AppPersona) async throws {
    let alert = try await api.post<SavedSearchAlert>(
        "/saved-searches",
        body: ["query": query, "persona": persona.rawValue]
    )
    savedSearchAlerts.append(alert)
}
```

**Impact:** User can't discover jobs, helpers, or tools; must know the URL.

---

## Missing from Spec vs. Implemented

| Feature | Spec Priority | Status | Effort |
|---------|---------------|--------|--------|
| **Persona switching** | Core | ✅ UI complete; no server sync | 3h |
| **Pulse score & pillars** | Core | ✅ UI + computed properties; no data persistence | 5h |
| **Job posting** | Core | ✅ Form UI; ❌ no API call | 4h |
| **Service booking** | Core | ✅ Form UI; ❌ no API call | 4h |
| **Tool rental** | Core | ✅ Form UI; ❌ no API call | 4h |
| **Universal search** | High | ⚠️ UI only; no backend | 6h |
| **Maps view** | High | ✅ MapKit integrated; ❌ no real pins | 3h |
| **Unified inbox** | High | ✅ List UI; ❌ no real messages | 4h |
| **Real-time translation** | High | ⚠️ Toggle exists; ❌ no API | 8h |
| **Biometric auth** | High | ❌ Not started | 5h |
| **Force update** | High | ⚠️ Property exists; ❌ no logic | 2h |
| **Multi-language UI** | High | ⚠️ Infrastructure; ❌ no strings | 20h |
| **Offline sync** | High | ❌ Not started | 12h |
| **Payment integration** | High | ❌ Wallet UI only; no Stripe | 10h |
| **Image uploads** | Medium | ❌ Not started | 5h |
| **Push notifications** | Medium | ❌ Not started | 6h |
| **Background sync** | Medium | ❌ Not started | 8h |

---

## Minimal Path to Production Testing

To launch a **beta** for **real users** (not just designers/QA testing the flow), implement in order:

### Phase 1: Auth & Session (6 hours)
- [ ] Login/register API calls (`POST /auth/register`, `POST /auth/login`)
- [ ] JWT token storage (Keychain via `OneSessionVault`)
- [ ] Token refresh on 401 errors
- [ ] Logout + session cleanup

### Phase 2: Customer Job Flow (12 hours)
- [ ] Real job posting API (`POST /jobs` with photo upload)
- [ ] Fetch customer jobs (`GET /jobs/me`)
- [ ] Fetch bids for jobs (`GET /jobs/{id}/bids`)
- [ ] Accept bid (`POST /bids/{id}/accept`)
- [ ] Confirm appointment after bid acceptance

### Phase 3: Data Sync (8 hours)
- [ ] Refresh all data on app launch
- [ ] Implement "Sync Live Data" buttons (fetch fresh data)
- [ ] Error handling + retry logic for all API calls
- [ ] Loading states + disable buttons while loading

### Phase 4: Biometric & Force Update (4 hours)
- [ ] Face ID / Touch ID unlock on app launch
- [ ] Check `/api/app/min-version` at startup
- [ ] Block access if app version too old

### Phase 5: Error & Offline Handling (6 hours)
- [ ] Show error messages to user
- [ ] Offline indicator (detect network, show banner)
- [ ] Queue offline edits (life log, sinking funds) for sync when online

**Total: 36 hours** — enough for one person (4–5 days) to build a **testable beta**.

---

## What Users Will See When Testing Starts

### What Works ✅
- Beautiful 5-tab navigation
- Persona switching (instant, no network)
- Settings (language, appearance, biometric, notifications)
- Pulse score & life log (local-only)
- Sinking funds calculator (local-only)
- Quote builder (local-only)
- Tax document display (mock data)

### What Doesn't Work ❌
- Can't sign in (no auth API)
- Can't post jobs (no API call)
- Can't see helpers (no API call)
- Can't book services (no API call)
- Can't rent tools (no API call)
- Can't send messages (no API call)
- All lists show 3 hardcoded items
- No real data persists across app restarts

---

## Recommendations

1. **Frontend team should focus on Phase 1–2** (auth + job flow) before involving testers
2. **Backend team should have all endpoints ready** (spec says 100+ endpoints; verify they all exist)
3. **QA should test on TestFlight** once Phase 3 is done (loading states prevent double-taps)
4. **Start with iOS-only launch** (React Native Android can follow in parallel)
5. **Plan localization** (Phase 5) last; don't block user testing on translations

---

## Summary Table

| Layer | Status | Completeness |
|-------|--------|--------------|
| **Navigation & Shell** | ✅ Complete | 100% |
| **UI Scaffolding (5 tabs)** | ✅ Complete | 95% |
| **State Management** | ✅ Complete | 90% |
| **Local Data Persistence** | ✅ Complete | 80% |
| **Authentication** | ❌ Missing | 0% |
| **Backend API Integration** | ❌ Missing | 5% |
| **Error Handling** | ❌ Missing | 0% |
| **Multi-Language Content** | ⚠️ Partial | 10% |
| **Biometric Auth** | ❌ Missing | 0% |
| **Real-Time Sync** | ❌ Missing | 0% |
| ****OVERALL PRODUCTION READY?** | **❌ NO** | **~30%** |

---

## Next Steps

1. **Assign developer to Phase 1** (auth) — critical path blocker
2. **Verify all backend endpoints exist** and match expected request/response shapes
3. **Create a feature branch** for API integration (keep scaffolding branch clean)
4. **Plan 3-week sprint** for Phases 1–5
5. **Build TestFlight release** after Phase 3
6. **Onboard 10–20 beta testers** after Phase 4
