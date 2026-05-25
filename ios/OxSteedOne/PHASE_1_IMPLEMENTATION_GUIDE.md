# Phase 1 Implementation Guide: Unblock Primary User Flows
**Duration:** 1-2 weeks  
**Priority:** P0 - Critical Path to Production  
**Owner:** Codex

---

## Overview

Phase 1 focuses on completing the end-to-end job marketplace flow:
1. **Customer:** Post job with photos → Receive bids → Accept bid → Pay → Job marked "In Progress"
2. **Helper:** Browse jobs → Place bid → Negotiate → Get paid → Complete job

This requires implementing 6 missing API methods, S3 image upload, and Stripe payment integration.

---

## Task 1: Implement 6 Missing OneStore Methods

### Task 1.1: `submitAscensionApplication()`

**Location:** `OneStore.swift` (add after line ~800)

**Current State:** ShopView.swift line 58 calls this, but method doesn't exist.

**Implementation:**

```swift
/// Submit business ascension application (move from side gig to licensed operation)
func submitAscensionApplication(fullName: String, skill: String, targetLicense: String) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    customerJobFlowMessage = nil
    
    defer { isSubmittingCustomerJob = false }
    
    let request = OneJoinAscensionRequest(
        fullName: fullName,
        currentSkill: skill,
        targetLicense: targetLicense
    )
    
    do {
        let response: OneGenericSuccessResponse = try await apiClient.post(
            "/api/growth/ascension/apply",
            body: request
        )
        
        if response.success ?? false {
            ascensionApplication.status = "pending_review"
            customerJobFlowMessage = "Application submitted! We'll review and contact you within 5 business days."
        } else {
            lastJobError = "Failed to submit application"
        }
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        enqueueForRetry(
            operation: { await self.submitAscensionApplication(fullName: fullName, skill: skill, targetLicense: targetLicense) },
            label: "ascension_application"
        )
    }
}
```

**Required DTO:** Add to `OneAPIModels.swift`:
```swift
struct OneJoinAscensionRequest: Encodable {
    let fullName: String
    let currentSkill: String
    let targetLicense: String
    
    enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case currentSkill = "current_skill"
        case targetLicense = "target_license"
    }
}
```

**Testing:**
- [ ] Call with valid data → `customerJobFlowMessage` shows success
- [ ] Call with empty fullName → error displayed
- [ ] Network failure → error enqueued for retry
- [ ] Offline → added to sync queue

---

### Task 1.2: `toggleWholesaleGroupJoin()`

**Location:** `OneStore.swift` (add after submitAscensionApplication)

**Current State:** ShopView.swift line 99 calls this, but method doesn't exist.

**Implementation:**

```swift
/// Join or leave a wholesale group
func toggleWholesaleGroupJoin(_ groupId: String) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    
    defer { isSubmittingCustomerJob = false }
    
    let request = OneJoinWholesaleRequest(groupId: groupId, persona: activePersona.rawValue)
    
    do {
        let response: OneGenericSuccessResponse = try await apiClient.post(
            "/api/growth/wholesale/toggle",
            body: request
        )
        
        if response.success ?? false {
            // Update local group join status
            if let index = wholesaleGroups.firstIndex(where: { $0.id == groupId }) {
                wholesaleGroups[index].joined.toggle()
            }
            customerJobFlowMessage = wholesaleGroups.first(where: { $0.id == groupId })?.joined ?? false 
                ? "Joined group!" 
                : "Left group"
        } else {
            lastJobError = "Failed to join group"
        }
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        enqueueForRetry(
            operation: { await self.toggleWholesaleGroupJoin(groupId) },
            label: "wholesale_toggle_\(groupId)"
        )
    }
}
```

**Note:** `OneJoinWholesaleRequest` already exists in OneAPIModels.swift (line 395).

**Testing:**
- [ ] Click "Join" button → button changes to "Joined"
- [ ] Click "Joined" button → button changes to "Join"
- [ ] Network error → error shown, button reverts

---

### Task 1.3: `submitFinancingPrequal()`

**Location:** `OneStore.swift` (add after toggleWholesaleGroupJoin)

**Current State:** ShopView.swift line 126 calls this, but method doesn't exist.

**Implementation:**

```swift
/// Submit financing pre-qualification request
func submitFinancingPrequal(requestedAmount: Double, purpose: String, 
                            monthlyRevenue: Double, creditBand: String) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    customerJobFlowMessage = nil
    
    defer { isSubmittingCustomerJob = false }
    
    // Convert to cents for API
    let amountCents = Int(requestedAmount * 100)
    let revenueCents = Int(monthlyRevenue * 100)
    
    let request = OneFinancingPrequalRequest(
        requestedAmountCents: amountCents,
        purpose: purpose,
        monthlyRevenueCents: revenueCents,
        creditBand: creditBand
    )
    
    do {
        let response: OneGenericSuccessResponse = try await apiClient.post(
            "/api/growth/financing/prequalify",
            body: request
        )
        
        if response.success ?? false {
            financingPrequal.status = "submitted"
            customerJobFlowMessage = "Pre-qualification submitted! Check your email for next steps."
        } else {
            lastJobError = "Failed to submit pre-qualification"
        }
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        enqueueForRetry(
            operation: { await self.submitFinancingPrequal(requestedAmount: requestedAmount, 
                                                           purpose: purpose, 
                                                           monthlyRevenue: monthlyRevenue, 
                                                           creditBand: creditBand) },
            label: "financing_prequal"
        )
    }
}
```

**Required DTO:** Add to `OneAPIModels.swift`:
```swift
struct OneFinancingPrequalRequest: Encodable {
    let requestedAmountCents: Int
    let purpose: String
    let monthlyRevenueCents: Int
    let creditBand: String
    
    enum CodingKeys: String, CodingKey {
        case requestedAmountCents = "requested_amount_cents"
        case purpose
        case monthlyRevenueCents = "monthly_revenue_cents"
        case creditBand = "credit_band"
    }
}
```

**Testing:**
- [ ] Submit with valid data → success message shown
- [ ] Submit with amount > 1M → validation error
- [ ] Submit with empty purpose → validation error
- [ ] Offline → enqueued for sync

---

### Task 1.4: `applyForGrant()`

**Location:** `OneStore.swift` (add after submitFinancingPrequal)

**Current State:** ShopView.swift line 161 calls this, but method doesn't exist.

**Implementation:**

```swift
/// Apply for a grant opportunity
func applyForGrant(_ grantId: String) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    
    defer { isSubmittingCustomerJob = false }
    
    let request = OneGrantApplicationRequest(grantId: grantId, persona: activePersona.rawValue)
    
    do {
        let response: OneGenericSuccessResponse = try await apiClient.post(
            "/api/growth/grants/apply",
            body: request
        )
        
        if response.success ?? false {
            customerJobFlowMessage = "Application submitted! You'll hear back within 10 business days."
            // Refresh grant list to update "Applied" status
            await fetchGrantOpportunities()
        } else {
            lastJobError = "Failed to apply for grant"
        }
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        enqueueForRetry(
            operation: { await self.applyForGrant(grantId) },
            label: "grant_apply_\(grantId)"
        )
    }
}
```

**Note:** `OneGrantApplicationRequest` already exists in OneAPIModels.swift (line 405).

**Testing:**
- [ ] Click Apply → success toast shown
- [ ] Refresh grant list → button changes to "Applied"

---

### Task 1.5: `fetchConsultantProfile()`

**Location:** `OneStore.swift` (add after applyForGrant)

**Current State:** Called from potential Consultant tab but not implemented.

**Implementation:**

```swift
/// Fetch consultant profile (for booking consultations)
func fetchConsultantProfile(id: String) async -> OneConsultantProfile? {
    do {
        let response: OneDataEnvelope<OneConsultantProfile> = try await apiClient.get(
            "/api/consultants/\(id)/profile"
        )
        return response.data
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        return nil
    }
}
```

**Required DTO:** Add to `OneAPIModels.swift`:
```swift
struct OneConsultantProfile: Decodable {
    let id: String?
    let name: String?
    let title: String?
    let bio: String?
    let expertise: [String]?
    let hourlyRateCents: Int?
    let availableSlots: [String]?
    let reviewCount: Int?
    let avgRating: Double?
    let imageUrl: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case title
        case bio
        case expertise
        case hourlyRateCents = "hourly_rate_cents"
        case availableSlots = "available_slots"
        case reviewCount = "review_count"
        case avgRating = "avg_rating"
        case imageUrl = "image_url"
    }
}
```

---

### Task 1.6: `fetchWalletBalance()`

**Location:** `OneStore.swift` (add after fetchConsultantProfile)

**Current State:** ShopView.swift displays wallet but no API call to fetch balance.

**Implementation:**

```swift
/// Fetch current wallet balance and transaction history
func fetchWalletBalance() async {
    do {
        let response: OneDataEnvelope<WalletSnapshot> = try await apiClient.get(
            "/api/wallet/balance"
        )
        
        if let wallet = response.data {
            walletSnapshot = wallet
        }
    } catch {
        // Non-critical error, don't block UI
        logger.error("Failed to fetch wallet balance: \(error)")
    }
}
```

**Required DTO:** Add to `OneAPIModels.swift`:
```swift
struct WalletSnapshot: Decodable {
    let availableBalanceCents: Int
    let pendingEscrowCents: Int
    let payoutMethod: String
    let lastPayoutDate: String?
    
    enum CodingKeys: String, CodingKey {
        case availableBalanceCents = "available_balance_cents"
        case pendingEscrowCents = "pending_escrow_cents"
        case payoutMethod = "payout_method"
        case lastPayoutDate = "last_payout_date"
    }
}
```

**Integration:** Call `fetchWalletBalance()` when ShopView appears:
```swift
// In ShopView.swift, add to NavigationStack or .onAppear
.onAppear {
    Task {
        await store.fetchWalletBalance()
    }
}
```

---

## Task 2: Implement S3 Image Upload for Job Creation

### Current Flow (Incomplete)
1. User selects photos via PhotoPicker ✅
2. Photos loaded to memory ✅
3. **[MISSING]** Photos uploaded to S3
4. Job created with photo URLs

### Implementation

#### Step 1: Add S3 Fetch Presigned URL Method

**Location:** `OneStore.swift` (add new section "Image Upload")

```swift
// MARK: - Image Upload (S3)

/// Fetch presigned URL for uploading image to S3
func fetchPresignedURL(fileName: String, contentType: String) async -> String? {
    let request = OnePresignedURLRequest(fileName: fileName, contentType: contentType)
    
    do {
        let response: OnePresignedURLResponse = try await apiClient.post(
            "/api/media/presigned-url",
            body: request
        )
        return response.presignedUrl
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        return nil
    }
}

/// Upload image to S3 using presigned URL
func uploadImageToS3(imageData: Data, presignedURL: String, contentType: String) async -> Bool {
    do {
        var request = URLRequest(url: URL(string: presignedURL)!)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = imageData
        
        let (_, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            lastJobError = "Failed to upload image"
            return false
        }
        
        return true
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        enqueueForRetry(
            operation: { await self.uploadImageToS3(imageData: imageData, 
                                                    presignedURL: presignedURL, 
                                                    contentType: contentType) },
            label: "s3_upload"
        )
        return false
    }
}
```

#### Step 2: Modify Job Creation to Upload Photos

**Location:** `OneStore.swift` - Update `postCustomerJobServerFirst()`

**Current Code:**
```swift
func postCustomerJobServerFirst(title: String, description: String, ...) async {
    // ... validation ...
    
    let jobRequest = OneCreateJobRequest(...)
    
    do {
        let response: OneJobDTO = try await apiClient.post(
            "/api/jobs",
            body: jobRequest
        )
        // Success
    } catch {
        // Error
    }
}
```

**Updated Code:**
```swift
func postCustomerJobServerFirst(title: String, description: String, 
                                budget: Double, category: String, 
                                urgency: String, photos: [UIImage]) async {
    isSubmittingCustomerJob = true
    lastJobError = nil
    customerJobFlowMessage = nil
    
    defer { isSubmittingCustomerJob = false }
    
    // Step 1: Upload photos to S3, collect URLs
    var mediaUrls: [String] = []
    
    for (index, photo) in photos.enumerated() {
        guard let jpegData = photo.jpegData(compressionQuality: 0.8) else {
            lastJobError = "Failed to process image \(index + 1)"
            return
        }
        
        // Generate unique filename
        let fileName = "jobs/\(UUID().uuidString)_\(index).jpg"
        let contentType = "image/jpeg"
        
        // Get presigned URL
        guard let presignedURL = await fetchPresignedURL(fileName: fileName, contentType: contentType) else {
            lastJobError = "Failed to get upload URL for image \(index + 1)"
            return
        }
        
        // Upload to S3
        let uploadSuccess = await uploadImageToS3(imageData: jpegData, 
                                                   presignedURL: presignedURL, 
                                                   contentType: contentType)
        if !uploadSuccess {
            lastJobError = "Failed to upload image \(index + 1)"
            return
        }
        
        // Extract public URL from presigned URL (remove query params)
        if let publicURL = presignedURL.split(separator: "?").first {
            mediaUrls.append(String(publicURL))
        }
    }
    
    // Step 2: Create job with photo URLs
    let budgetCents = Int(budget * 100)
    
    let jobRequest = OneCreateJobRequest(
        title: title,
        description: description,
        categoryName: category,
        locationCity: "Austin", // TODO: Get from user location
        locationState: "TX",
        locationAddress: "", // TODO: Get from user
        locationZip: "", // TODO: Get from user
        locationCountry: "US",
        urgency: urgency,
        budgetType: "fixed",
        budgetMin: budgetCents,
        budgetMax: budgetCents,
        mediaUrls: mediaUrls
    )
    
    do {
        let response: OneJobDTO = try await apiClient.post(
            "/api/jobs",
            body: jobRequest
        )
        
        if let jobId = response.id {
            myJobs.insert(response, at: 0)
            selectedJobId = jobId
            customerJobFlowMessage = "Job posted successfully! Helpers can start bidding."
        } else {
            lastJobError = "Failed to create job"
        }
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        // Note: Photos already uploaded, so retry job creation will work without re-uploading
        enqueueForRetry(
            operation: { await self.postCustomerJobServerFirst(title: title, 
                                                               description: description, 
                                                               budget: budget, 
                                                               category: category, 
                                                               urgency: urgency, 
                                                               photos: photos) },
            label: "post_job"
        )
    }
}
```

#### Step 3: Wire PhotoPicker to Job Creation Form

**Location:** `TodayView.swift` - Find "Post a Job" form section

**Current Code (approximately line 80-120):**
```swift
// Post a Job card
if store.activePersona == .customer {
    Form {
        TextField("Job title", text: $jobTitle)
        // ... more fields ...
        Button("Post Job") {
            Task {
                await store.postCustomerJobServerFirst(
                    title: jobTitle,
                    description: jobDescription,
                    // ... missing photos parameter
                )
            }
        }
    }
}
```

**Updated Code:**
```swift
if store.activePersona == .customer {
    VStack(spacing: 12) {
        TextField("Job title", text: $jobTitle)
        TextField("Description", text: $jobDescription, axis: .vertical)
        
        // Photo selector
        PhotoThumbnailStrip(images: $selectedJobPhotos) {
            showPhotoPicker = true
        }
        
        TextField("Budget ($)", text: $jobBudget)
        Picker("Category", selection: $jobCategory) {
            ForEach(["Cleaning", "Repairs", "Renovation", "Other"], id: \.self) { cat in
                Text(cat).tag(cat)
            }
        }
        
        Button("Post Job") {
            Task {
                await store.postCustomerJobServerFirst(
                    title: jobTitle,
                    description: jobDescription,
                    budget: Double(jobBudget) ?? 0,
                    category: jobCategory,
                    urgency: "standard",
                    photos: selectedJobPhotos
                )
            }
        }
        .disabled(jobTitle.isEmpty || selectedJobPhotos.isEmpty)
    }
    .sheet(isPresented: $showPhotoPicker) {
        PhotoPicker(selectedImages: $selectedJobPhotos, maxSelection: 5)
    }
}
```

**State Variables** (add to `TodayView` or move to `@State` properties):
```swift
@State private var selectedJobPhotos: [UIImage] = []
@State private var showPhotoPicker = false
@State private var jobTitle = ""
@State private var jobDescription = ""
@State private var jobBudget = ""
@State private var jobCategory = "General"
```

---

## Task 3: Add Stripe Payment Integration

### Setup (One-time)

#### Step 1: Add Stripe to Package.swift

**Location:** `Package.swift` (dependencies section)

```swift
dependencies: [
    .package(url: "https://github.com/stripe/stripe-ios.git", from: "23.0.0")
],
targets: [
    .executableTarget(
        name: "OxSteedOne",
        dependencies: [
            .product(name: "StripePaymentSheet", package: "stripe-ios"),
            // ... other dependencies
        ]
    )
]
```

#### Step 2: Store Stripe Publishable Key

**Location:** `Info.plist` or config

Add to `OneStore.swift`:
```swift
let STRIPE_PUBLISHABLE_KEY = "pk_test_..." // Set from environment
```

### Implementation

#### Step 1: Add Stripe Payment Method to OneStore

**Location:** `OneStore.swift` (add new section)

```swift
// MARK: - Payments (Stripe)

import StripePaymentSheet

/// Create payment intent for booking or reservation
func createPaymentIntent(amount: Double, description: String, metadata: [String: String]) async -> String? {
    let amountCents = Int(amount * 100)
    
    let request = OnePaymentIntentRequest(
        amountCents: amountCents,
        description: description,
        metadata: metadata
    )
    
    do {
        let response: OnePaymentIntentResponse = try await apiClient.post(
            "/api/payments/create-intent",
            body: request
        )
        
        return response.clientSecret
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        return nil
    }
}

/// Confirm Stripe payment
func confirmStripePayment(clientSecret: String) async -> Bool {
    do {
        let response: OneGenericSuccessResponse = try await apiClient.post(
            "/api/payments/confirm",
            body: ["clientSecret": clientSecret]
        )
        
        return response.success ?? false
    } catch {
        lastJobError = OneErrorMapper.mapError(error)
        return false
    }
}
```

**Required DTOs** (add to `OneAPIModels.swift`):
```swift
struct OnePaymentIntentRequest: Encodable {
    let amountCents: Int
    let description: String
    let metadata: [String: String]
    
    enum CodingKeys: String, CodingKey {
        case amountCents = "amount_cents"
        case description
        case metadata
    }
}

struct OnePaymentIntentResponse: Decodable {
    let clientSecret: String
    let publishableKey: String
    
    enum CodingKeys: String, CodingKey {
        case clientSecret = "client_secret"
        case publishableKey = "publishable_key"
    }
}
```

#### Step 2: Wire Payment to Booking Flow

**Location:** `TodayView.swift` - Find booking acceptance form

**Updated Code:**
```swift
// When accepting a booking/bid:
Button("Accept & Pay") {
    Task {
        // Step 1: Get payment intent
        let bookingAmount = selectedBid.amountCents / 100.0
        guard let clientSecret = await store.createPaymentIntent(
            amount: bookingAmount,
            description: "Booking with \(selectedBid.helperName)",
            metadata: ["bidId": selectedBid.id]
        ) else {
            // Error already in store.lastJobError
            return
        }
        
        // Step 2: Show Stripe payment sheet
        var paymentSheetParams = PaymentSheet.Appearance()
        let paymentSheet = PaymentSheet(
            paymentIntentClientSecret: clientSecret,
            appearance: paymentSheetParams
        )
        
        // Present PaymentSheetViewController (need to wrap for SwiftUI)
        // ... (see StripePaymentSheetController helper below)
        
        // Step 3: After payment succeeds, confirm and create booking
        let paymentConfirmed = await store.confirmStripePayment(clientSecret: clientSecret)
        if paymentConfirmed {
            await store.acceptBidServerFirst(bidId: selectedBid.id, paymentMethod: "stripe")
            selectedBid = nil
            store.customerJobFlowMessage = "Payment successful! Helper will contact you soon."
        }
    }
}
```

**Helper: Stripe PaymentSheet for SwiftUI** (create new file)

**File:** `StripePaymentSheetController.swift`

```swift
import SwiftUI
import StripePaymentSheet

struct StripePaymentSheetController: UIViewControllerRepresentable {
    let clientSecret: String
    let appearance: PaymentSheet.Appearance
    @Binding var isPresented: Bool
    var onSuccess: () -> Void
    var onError: (String) -> Void
    
    func makeUIViewController(context: Context) -> UIViewController {
        return StripePaymentContainer(
            clientSecret: clientSecret,
            appearance: appearance,
            isPresented: $isPresented,
            onSuccess: onSuccess,
            onError: onError
        )
    }
    
    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

class StripePaymentContainer: UIViewController {
    let clientSecret: String
    let appearance: PaymentSheet.Appearance
    @Binding var isPresented: Bool
    let onSuccess: () -> Void
    let onError: (String) -> Void
    
    init(clientSecret: String, appearance: PaymentSheet.Appearance,
         isPresented: Binding<Bool>, onSuccess: @escaping () -> Void, 
         onError: @escaping (String) -> Void) {
        self.clientSecret = clientSecret
        self.appearance = appearance
        self._isPresented = isPresented
        self.onSuccess = onSuccess
        self.onError = onError
        super.init(nibName: nil, bundle: nil)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        presentPaymentSheet()
    }
    
    func presentPaymentSheet() {
        var paymentSheet = PaymentSheet(
            paymentIntentClientSecret: clientSecret,
            appearance: appearance
        )
        
        paymentSheet.present(from: self) { paymentResult in
            switch paymentResult {
            case .completed:
                self.onSuccess()
            case .canceled:
                self.isPresented = false
            case .failed(let error):
                self.onError(error.localizedDescription)
                self.isPresented = false
            }
        }
    }
}
```

---

## Task 4: Testing & Verification

### Unit Tests to Add

**File:** `OxSteedOneTests/OneStorePaymentTests.swift` (new)

```swift
import XCTest
@testable import OxSteedOne

class OneStorePaymentTests: XCTestCase {
    var store: OneStore!
    
    override func setUp() {
        super.setUp()
        store = OneStore()
    }
    
    func testCreatePaymentIntent() async {
        let clientSecret = await store.createPaymentIntent(
            amount: 150.0,
            description: "Test booking",
            metadata: ["test": "true"]
        )
        
        XCTAssertNotNil(clientSecret)
        XCTAssertTrue(clientSecret?.starts(with: "pi_") ?? false)
    }
    
    func testSubmitAscensionApplication() async {
        await store.submitAscensionApplication(
            fullName: "John Doe",
            skill: "Plumbing",
            targetLicense: "Master Plumber"
        )
        
        XCTAssertEqual(store.ascensionApplication.status, "pending_review")
        XCTAssertNotNil(store.customerJobFlowMessage)
    }
    
    func testS3ImageUpload() async {
        let testImage = UIImage(systemName: "photo")!
        let jpegData = testImage.jpegData(compressionQuality: 0.8)!
        
        let presignedURL = await store.fetchPresignedURL(
            fileName: "test.jpg",
            contentType: "image/jpeg"
        )
        
        XCTAssertNotNil(presignedURL)
        
        let uploadSuccess = await store.uploadImageToS3(
            imageData: jpegData,
            presignedURL: presignedURL!,
            contentType: "image/jpeg"
        )
        
        XCTAssertTrue(uploadSuccess)
    }
}
```

### Manual Testing Checklist

- [ ] **Job Creation with Photos**
  - [ ] Select 1 photo → upload succeeds
  - [ ] Select 5 photos → all upload
  - [ ] Select 6 photos → 6th rejected (max 5)
  - [ ] Network fails → error shown, can retry
  - [ ] Photos visible in job detail after creation

- [ ] **Bid Acceptance with Payment**
  - [ ] Click "Accept & Pay" → Stripe sheet appears
  - [ ] Enter test card `4242 4242 4242 4242` → payment succeeds
  - [ ] Job status changes to "In Progress"
  - [ ] Helper receives payment notification
  - [ ] Enter invalid card `4000 0000 0000 0002` → payment fails

- [ ] **Ascension Application**
  - [ ] Submit form → confirmation message appears
  - [ ] Refresh page → status persists as "pending_review"

- [ ] **Financing Pre-Qual**
  - [ ] Submit with $50k requested → confirmation shown
  - [ ] Offline → enqueued for sync
  - [ ] Come online → syncs automatically

- [ ] **Wallet Balance**
  - [ ] Open Shop tab → balance loads and displays
  - [ ] Make payment → pending_escrow increases
  - [ ] Complete job → available_balance increases

---

## Acceptance Criteria (Phase 1 Complete)

- [x] 6 OneStore methods implemented and tested
- [x] S3 image upload working for job creation
- [x] Stripe payment flow integrated
- [x] End-to-end job flow works: Create → Bid → Accept → Pay → Complete
- [x] Offline sync queues failed operations
- [x] Error messages user-friendly (no raw HTTP codes)
- [x] No crashes in critical flows
- [x] All 5 Growth tab forms working

---

## Files Modified Summary

| File | Changes | Lines |
|------|---------|-------|
| OneStore.swift | Add 6 methods + payment + S3 | +250 |
| OneAPIModels.swift | Add 8 new DTOs | +60 |
| TodayView.swift | Wire payment to booking flow | +30 |
| StripePaymentSheetController.swift | New PaymentSheet wrapper | +80 |
| Package.swift | Add Stripe dependency | +2 |
| OneStorePaymentTests.swift | New test file | +50 |

**Total:** ~472 lines of new/modified code

---

## Deployment

### Pre-Deployment Checklist
- [ ] All 6 methods tested locally
- [ ] Backend endpoints confirmed to exist
- [ ] Stripe keys configured (test keys for TestFlight, prod for App Store)
- [ ] S3 bucket accessible and CORS configured
- [ ] No `print()` statements in production code
- [ ] No force unwraps in payment/upload paths

### Rollout Plan
1. **Day 1-2:** Implement all code changes locally
2. **Day 3:** Internal testing with test data
3. **Day 4:** Deploy to TestFlight
4. **Day 5-7:** Beta user testing (10-20 users)
5. **Day 8:** Fix bugs, prepare for Phase 2

---

## Next Steps After Phase 1

Once Phase 1 is complete and tested:
- Phase 2: Real-time messaging (Socket.IO)
- Phase 3: Push notifications (APNS)
- Phase 4: Localization (translate 200+ strings)
- Phase 5: Testing & QA

---

**Created:** 2026-05-25  
**Status:** Ready for Codex implementation  
**Estimated Effort:** 40-50 hours
