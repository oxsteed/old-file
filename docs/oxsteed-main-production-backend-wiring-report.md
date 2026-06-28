# OxSteed Main Production Backend Wiring Report

Audited code state as of `2026-06-28`.

Scope:

- App: `/Users/oxsteed/Superapp-Projects/OxSteed Main`
- Backend: `/Users/oxsteed/Documents/GitHub/6/server`
- Goal: determine whether OxSteed Main is truly production-wired or still behaving like a prototype

## Executive Summary

### Verdict

**OxSteed Main is not yet release-ready as a production-backed app.**

The backend repo already exposes most of the route surface the app needs. The bigger problem is on the app side: several runtime flows still degrade into sample data, local-only success states, or the wrong contract. That means the app can look complete in production while silently misrepresenting backend reality.

### Feature Status Counts

Counts below are by feature surface in the integration matrix.

- `production-ready`: 7
- `partial`: 7
- `miswired`: 4
- `prototype-only`: 2
- `backend-missing`: 0

### Top Release Blockers

1. Cart checkout can still complete locally without creating a backend order.
2. Restaurant browse and menu detail still keep sample data alive in runtime paths.
3. Order tracking still renders with `FoodSampleData.activeOrder`.
4. Didit launch still calls `"/api/didit/start"` through a client that already prepends `/api`.
5. Business settings save still uses `PATCH /businesses/:id` while backend exposes `PUT /businesses/:id`.
6. Business settings are seeded from `GET /me/businesses`, which is only a membership summary, so the edit form can open with blank fields and then overwrite real business data.
7. Role switching is still local-only in the main profile flow even though the backend exposes `POST /auth/switch-role`.
8. Profile trust actions are not production-honest: change email is contract-mismatched, export is fake, report-a-problem is fake, tax docs are static, and delete-account only signs out.

### Audit Basis

App networking/services reviewed:

- `Networking/APIClient.swift`
- `Networking/AuthService.swift`
- `Networking/BidsAPIService.swift`
- `Networking/BusinessAPIService.swift`
- `Networking/CalendarAPIService.swift`
- `Networking/ChatAPIService.swift`
- `Networking/FoodAPIService.swift`
- `Networking/JobsAPIService.swift`
- `Networking/NotificationAPIService.swift`
- `Networking/ReviewsAPIService.swift`
- feature-side runtime view models in `Home`, `Food`, `Skills`, `Calendar`, `Activity`, and `Profile`

Backend route surfaces cross-checked against `server/index.js` mounts and route files:

- `routes/auth.js`
- `routes/mainApp.js`
- `routes/users.js`
- `routes/helpers.js`
- `routes/jobs.js`
- `routes/bids.js`
- `routes/food.js`
- `routes/messages.js`
- `routes/notifications.js`
- `routes/calendar.js`
- `routes/businesses.js`
- `routes/meWorkspace.js`
- `routes/reviews.js`
- `routes/didit.js`
- `routes/privacy.js`
- `routes/support.js`

### Important Positive Changes Confirmed

These are production-backed in the current code and should not be treated as still missing:

- `Home/HomeView.swift` loads from `GET /api/main-app/home`
- `FoodAPIService.fetchOrder(...)` now matches `GET /api/food/orders/:orderId`
- food wallet reads match backend wallet routes
- food markets are backend-driven
- `GET /api/users/helpers/search` now exists and matches the calendar client

## Integration Matrix

| Feature | App surface | App service call(s) | Expected backend route(s) | Current backend support | Current app behavior | Status | User impact | Recommended fix owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth | `Auth/AuthView.swift`, `Networking/AuthService.swift` | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /notifications/push-token` | `routes/auth.js`, `routes/notifications.js` | Present and aligned | Core sign-in/session flow is real | `production-ready` | Users can authenticate against production state | `app` |
| Onboarding | `Auth/AuthView.swift`, `Networking/AuthService.swift` | `POST /auth/register/start`, `POST /auth/register/accept-terms`, `POST /auth/register/verify-otp`, `POST /auth/register/resend-otp`, `POST /auth/check-email`, `POST /auth/check-zip` | `routes/auth.js` | Present and aligned | Signup matches the backend multi-step flow | `production-ready` | New account creation is genuinely backend-backed | `app` |
| Role switching | `Profile/ProfileModels.swift`, `Profile/ProfileView.swift`, `Networking/AuthService.swift` | UI mutates local role only in `ProfileViewModel.switchRole(...)`; real server path is `POST /auth/switch-role` | `routes/auth.js`, `authController.switchRole` | Present and aligned | Profile mode switching changes local UI only; backend session is unchanged; enabled roles are still hardcoded | `miswired` | User can believe they switched operating mode while backend permissions and token state did not change | `app` |
| Home | `Home/HomeView.swift` | `GET /main-app/home` | `routes/mainApp.js`, `controllers/mainAppController.js` | Present and aligned | Summary, featured helpers, restaurants, and recent activity are driven from a real aggregate route with real empty/error handling | `production-ready` | Main landing experience reflects backend state | `app` |
| Helpers | `Skills/SkillsModels.swift`, `Skills/HelperBrowseView.swift`, `Networking/JobsAPIService.swift` (`HelpersAPIService`) | `GET /helpers?...` | `routes/helpers.js` | Present and aligned | Remote browse is real, but runtime state starts at `SampleData.helpers`; failed or empty loads leave sample helpers visible | `partial` | Marketplace can look populated even when production data is empty or failing | `app` |
| Jobs | `Networking/JobsAPIService.swift`, `Skills/PostJobView.swift`, `Skills/MyJobsView.swift`, `Skills/JobBrowseView.swift` | `GET /jobs`, `GET /jobs/:id`, `POST /jobs`, `PUT /jobs/:id`, `POST /jobs/:id/cancel|start|complete|close`, `POST /jobs/assign`, `GET|PUT|DELETE /jobs/draft`, `GET /jobs/me/list`, `GET /jobs/:id/appointment` | `routes/jobs.js` | Present and aligned | Core jobs flow is backend-backed | `production-ready` | Posting, browsing, and managing jobs is real | `app` |
| Bids | `Networking/BidsAPIService.swift`, `Skills/JobBrowseView.swift`, `Skills/JobBidsView.swift` | `GET /bids/me`, `GET /bids/job/:jobId`, `POST /bids`, `PUT /bids/:id`, `POST /bids/:id/withdraw`, `GET /bids/recent` | `routes/bids.js` | Present and aligned | Route shapes match, but the app only gates on sign-in while backend also requires verified email, active onboarding, and pro tier | `partial` | Users can reach bid submission UI and then hit avoidable backend policy failures | `both` |
| Restaurants | `Food/FoodModels.swift`, `Food/RestaurantsView.swift`, `Food/RestaurantDetailView.swift`, `Networking/FoodAPIService.swift` | `GET /food/restaurants`, `GET /food/restaurants/:restaurantId`, `GET /food/restaurants/:restaurantId/promotions`, `GET /food/markets`, wallet reads | `routes/food.js` | Present and aligned | Backend routes are real, but runtime state starts from `FoodSampleData.restaurants`; empty loads keep sample restaurants; menu detail falls back to `FoodSampleData.menu(for:)`; retry path also drops market filtering | `partial` | Customers can browse fake restaurants, fake menus, or wrong-market results in a production build | `app` |
| Cart / order flow | `Food/FoodModels.swift`, `Food/CartView.swift` | Expected production write is `POST /food/restaurants/:restaurantId/orders` | `routes/food.js` | Present and aligned | If menu items lack API IDs, or the restaurant lacks an API ID, the app clears the cart and marks a local active order without writing to backend | `prototype-only` | User can believe an order was placed when nothing was persisted | `app` |
| Order tracking | `Food/OrderHistoryView.swift`, `Food/RestaurantsView.swift`, `Food/RestaurantDetailView.swift`, `Food/OrderTrackingView.swift`, `Networking/FoodAPIService.swift` | `GET /food/my/orders`, `GET /food/orders/:orderId`, `GET /food/orders/track/:trackingToken` | `routes/food.js` | Present and aligned | Refresh route is correct, but tracking UI still receives `FoodSampleData.activeOrder` as `richOrder` for display | `prototype-only` | Real orders can display sample restaurant, item, and address details | `app` |
| Favorites | `Networking/FoodAPIService.swift`, food account/preferences surfaces | `GET /food/customer/profile`, `PATCH /food/customer/profile`, `GET /food/customer/favorite-items`, `PUT /food/customer/favorite-items/sync`, `POST /food/customer/favorite-items/:restaurantId/:itemId/toggle`, `POST /food/customer/favorites/:restaurantId/toggle` | `routes/food.js` | Present and aligned | Favorite items, favorite restaurants, and customer food preferences are real | `production-ready` | Favorite persistence is backed by production data | `app` |
| Markets | `Food/MarketsPickerView.swift`, `Networking/FoodAPIService.swift` | `GET /food/markets` | `routes/food.js` | Present and aligned | Dynamic markets are backend-driven | `production-ready` | City and market availability can reflect live restaurant data | `app` |
| Chat | `Chat/ChatView.swift`, `Chat/ConversationView.swift`, `Networking/ChatAPIService.swift` | `/messages/conversations`, message CRUD, reactions, archive/restore, attachments, guest inquiries | `routes/messages.js` | Present and aligned | Route surface is real, but failed fetches return `Conversation.samples` and `ChatMessage.sampleMessages(...)` | `partial` | Messaging can look healthy while backend is actually failing | `app` |
| Notifications | `Networking/NotificationAPIService.swift`, `Notifications/*` | `GET /notifications`, mark-read/delete ops, `GET|PUT /notifications/preferences`, `POST /notifications/push-token` | `routes/notifications.js` | Present and aligned | Inbox, read state, preferences, and push-token registration are real | `production-ready` | Notification features are production-backed | `app` |
| Activity feed | `Activity/ActivityModels.swift`, `Activity/ActivityView.swift` | `GET /notifications` through `NotificationAPIService.fetchNotifications()` | `routes/notifications.js` | Present and aligned | If notifications are empty, the activity feed swaps to `fallbackSampleEvents` instead of showing a real empty state | `partial` | The product can look active even when the user has no real activity | `app` |
| Calendar | `Networking/CalendarAPIService.swift`, `Calendar/CalendarView.swift`, `Calendar/HelperSearchPicker.swift`, `Skills/BookingView.swift` | `/calendar/appointments...`, `/calendar/availability...`, `/calendar/notification-preferences`, `/calendar/notifications`, `GET /users/helpers/search` | `routes/calendar.js`, `routes/users.js` | Present and aligned | Core calendar routes are real and helper search route now exists, but failed helper searches still fall back to local `mockHelpers` | `partial` | Booking and helper search can become fake if backend search fails | `app` |
| Business hub | `Profile/BusinessHubView.swift`, `Profile/BusinessSettingsView.swift`, `Networking/BusinessAPIService.swift` | `GET /me/businesses`, `POST /businesses`, `PATCH /businesses/:id`, `GET /businesses/:id/invoices`, `GET|POST /businesses/:id/clients`, `GET|POST /businesses/:id/members` | Mostly present; update method is mismatched; richer edit route also exists as `GET /businesses/:id/profile-edit` | Workspace list, create, invoices, clients, and members are real, but business profile save still uses `PATCH` against a `PUT` backend route, and the edit form is populated from the summary `GET /me/businesses` payload instead of a full editable profile route | `miswired` | Business editing can fail or overwrite real fields with blanks while surrounding workspace UI looks production-ready | `both` |
| Reviews | `Networking/ReviewsAPIService.swift`, `Skills/ReviewSubmitView.swift`, `Skills/HelperProfileView.swift` | `GET /reviews/users/:userId`, `GET /reviews/jobs/:jobId/eligibility`, `POST /reviews/jobs/:jobId`, `PUT /reviews/:id/respond` | `routes/reviews.js` | Present and aligned | Submit/respond/fetch routes exist, but helper profile review feed is still `SampleData.reviews(for:)` with synthetic rating breakdown bars | `partial` | Users can see believable but fake testimonials and rating distribution | `app` |
| Didit verification | `Profile/VerifyIdentityView.swift` | App calls `POST /api/didit/start` | `routes/didit.js` mounted at `/api/didit`, route `POST /start` | Present and aligned at backend; miscalled by app | Shared client already prepends `/api`, so the app likely requests `/api/api/didit/start` | `miswired` | Admin-forced verification can fail even though backend capability exists | `app` |
| Profile / account actions | `Profile/ProfileView.swift`, `Profile/ProfileModels.swift`, `Profile/AccountSecurityView.swift`, `Profile/AccountActionsViews.swift`, `Profile/HelpSupportView.swift` | `PUT /auth/change-password`, `POST /auth/change-email`, `POST /auth/confirm-email-change`, `POST /auth/resend-verification`, expected `GET /privacy/export`, `DELETE /privacy/delete-account`, `POST /support/request` | Mixed: some present, some mismatched, some never called | Change password and resend verification are real, but change email expects the wrong contract, `pendingToken` is never set, export is fake, report-a-problem is local-only, tax docs are static, and delete account only signs out | `miswired` | Sensitive trust surfaces look complete while failing or doing nothing server-side | `both` |

## Mismatch Findings

| Feature | App entrypoint | App request | Backend route/support | Observed gap | Severity | Owner | Recommended fix | Release blocking? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Didit launch | `Profile/VerifyIdentityView.swift` | `POST /api/didit/start` | `POST /api/didit/start` is mounted as `/api` + `/didit` + `/start` | Shared client already prepends `/api`, so the app likely requests `/api/api/didit/start` | `Critical` | `app` | Change the request path to `/didit/start` and verify the full Safari launch flow | `Yes` |
| Business profile save | `Networking/BusinessAPIService.swift` | `PATCH /businesses/:id` | Backend exposes `PUT /api/businesses/:id` | Method mismatch blocks save | `High` | `app` | Switch the app to `PUT`, or intentionally add `PATCH` support on backend | `Yes` |
| Business settings preload | `Profile/BusinessSettingsView.swift`, `Networking/BusinessAPIService.swift` | App uses `GET /me/businesses` data as the source of truth for the full editor | Backend `GET /api/me/businesses` is a membership summary; richer editor route exists as `GET /api/businesses/:id/profile-edit` | Edit screen can open with blank description, website, phone, city, state, zip, tax, and logo values and then overwrite real data on save | `Critical` | `app` | Load business settings from a full editor payload before presenting the form, or expand `/me/businesses` intentionally | `Yes` |
| Change email | `Profile/AccountSecurityView.swift`, `Networking/AuthService.swift` | App starts with `POST /auth/change-email`, then expects `POST /auth/confirm-email-change` with `{ token, otp }` | Backend `changeEmail` sends dual confirmation emails; backend `confirmEmailChange` requires `{ oldToken, newToken }` | App is built as an OTP flow, backend is built as a dual-token flow, and the app never stores a real confirmation token anyway (`pendingToken` stays empty) | `Critical` | `both` | Pick one contract and align both sides; if keeping backend as-is, rebuild the app around old/new email confirmation tokens | `Yes` |
| Role switching | `Profile/ProfileModels.swift`, `Profile/ProfileView.swift` | No backend request; local `account.activeRole` mutation only | Backend exposes `POST /api/auth/switch-role` and issues fresh session tokens | UI suggests a real mode switch but never updates backend session or available granted modes | `High` | `app` | Route role switching through `AuthService.switchRole(to:)` and derive enabled roles from backend user state | `Yes` |
| Cart checkout | `Food/FoodModels.swift` | Expected `POST /food/restaurants/:restaurantId/orders`; actual fallback is no request | Backend supports real order creation | If menu or restaurant API IDs are missing, checkout becomes local-only success | `Critical` | `app` | Block checkout until backend-backed restaurant and menu IDs exist; remove local success fallback | `Yes` |
| Export my data | `Profile/AccountActionsViews.swift` | No backend request; local timer plus success alert only | Backend exposes `GET /api/privacy/export` | UI implies a production export request but never contacts the backend | `High` | `app` | Replace fake export flow with authenticated backend export request handling | `Yes` |
| Delete account | `Profile/ProfileView.swift` | No backend delete request; destructive action only calls `auth.signOut()` | Backend exposes `DELETE /api/privacy/delete-account` and requires `confirmation: "DELETE MY ACCOUNT"` | UI implies permanent deletion while only signing the user out | `Critical` | `app` | Wire delete account to backend route with the required confirmation body and result handling | `Yes` |
| Report a problem | `Profile/AccountActionsViews.swift` | No backend request; local success alert only | Backend exposes `POST /api/support/request` | Support submission UI looks real but never creates a ticket | `High` | `app` | Submit to support backend and show created ticket state | `No` |

### Auth-State and Response-Shape Notes

- Bids are more restricted than the app currently implies:
  - app assumes signed-in is enough
  - backend additionally requires verified email, active onboarding, and pro tier
- Restaurant browse retry logic is not contract-safe:
  - first request honors selected market
  - retry path drops the selected market and calls only `?limit=30`
- Helper search route shape is now aligned, but the app still converts request failure into believable local mock results

### Verified Resolved Contract Notes

These were worth checking because they were previously at risk, but they are not current blockers in the present code:

- `FoodAPIService.fetchOrder(...)` now calls `GET /food/orders/:orderId`
  - current app no longer expects `GET /food/restaurants/:restaurantId/orders/:orderId`
- `GET /users/helpers/search` now exists and matches the calendar search client

## Prototype / Demo Inventory

### User-Visible Production Fallbacks

- `Skills/SkillsModels.swift`
  - `helpers` starts as `SampleData.helpers`
  - `loadHelpers()` keeps sample helpers on failure or empty remote result

- `Food/FoodModels.swift`
  - `restaurantsWithDistance` starts as `FoodSampleData.restaurants`
  - `loadRestaurants()` only replaces runtime state when mapped backend results are non-empty

- `Food/RestaurantDetailView.swift`
  - `liveMenuSections ?? FoodSampleData.menu(for: restaurant)`
  - a real restaurant detail screen can degrade into a fake menu

- `Networking/ChatAPIService.swift`
  - `fetchConversations()` returns `Conversation.samples` on error
  - `fetchMessages()` returns `ChatMessage.sampleMessages(...)` on error

- `Calendar/HelperSearchPicker.swift`
  - failed helper search falls back to `mockHelpers`

- `Activity/ActivityModels.swift`
  - if notifications are empty, activity becomes `fallbackSampleEvents`
  - this can make the product look active even when the user has no real activity

### Prototype UI That Misrepresents Real Backend Capability

- `Food/FoodModels.swift`
  - checkout can complete locally without backend persistence

- `Food/OrderHistoryView.swift`, `Food/RestaurantsView.swift`, `Food/RestaurantDetailView.swift`
  - `OrderTrackingView` still receives `FoodSampleData.activeOrder`

- `Skills/HelperProfileView.swift`
  - review feed is `SampleData.reviews(for:)`
  - rating breakdown bars are synthetic, not backend-derived

- `Profile/ProfileModels.swift`
  - role list, metrics, rating, review counts, totals, and mode availability are still hardcoded defaults
  - role switching mutates local state without backend effect

- `Profile/AccountActionsViews.swift`
  - report-a-problem submit is local-only
  - tax documents are static local rows
  - export-my-data is a timed local animation, not a privacy API call

- `Profile/ProfileView.swift`
  - delete-account destructive action only signs out

- `Profile/AccountSecurityView.swift`
  - change-email sheet is designed as OTP verification, not the backend’s dual-confirmation model
  - `pendingToken` is never populated before confirm

### Benign Preview / Demo-Only Code

These are acceptable only if they remain unreachable from runtime release flows:

- `Models/SampleData.swift`
- `Food/FoodModels.swift` sample menu and sample order definitions
- SwiftUI `#Preview` blocks

The issue is not the existence of sample code. The issue is that sample code is still reachable from runtime production paths.

## Remediation Roadmap

### 1. Release Blockers

1. Remove local-only checkout behavior from `FoodViewModel.placeOrder(...)`.
2. Remove runtime sample fallback from restaurant browse and menu detail.
3. Rebuild order tracking so it renders only backend-backed order data.
4. Fix Didit launch path to `/didit/start`.
5. Fix business profile update to use `PUT /businesses/:id`.
6. Stop using `GET /me/businesses` as the business settings editor payload; load a full editable business profile before save.
7. Route role switching through backend `POST /auth/switch-role`.
8. Rebuild change-email around the real backend contract.
9. Wire export, delete-account, and report-a-problem to backend routes instead of local-only UI.

### 2. Contract Mismatches

1. Audit all app mutations for HTTP method drift similar to business `PATCH` vs `PUT`.
2. Surface backend bid eligibility rules in the app before submit.
3. Replace silent helper-search fallback with explicit empty and error states.
4. Add a business editor contract that clearly separates business membership summaries from full editable business profile payloads.

### 3. Prototype-to-Production Replacements

1. Replace helper browse sample fallback with empty and retry UX.
2. Replace helper profile sample reviews with `ReviewsAPIService` data.
3. Replace chat sample fallback with reconnect and retry UX.
4. Replace activity sample fallback with a true empty-state UX.
5. Replace hardcoded profile metrics and enabled roles with backend-derived state.
6. Replace static tax, support, and account trust surfaces with real backend integrations.

### 4. Nice-to-Have Cleanup

1. Add contract tests for:
   - `/main-app/home`
   - `/food/restaurants`
   - `/food/orders/:orderId`
   - `/food/customer/wallets`
   - `/auth/switch-role`
   - `/auth/change-email`
   - `/users/helpers/search`
2. Add a release policy forbidding runtime sample fallback in production builds.

## Implementation Backlog

| Feature | App entrypoint | App request | Backend route/support | Observed gap | Severity | Owner | Recommended fix | Release blocking? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Restaurants list and menu detail | `Food/FoodModels.swift`, `Food/RestaurantDetailView.swift` | `GET /food/restaurants`, `GET /food/restaurants/:restaurantId` | Supported | Runtime sample fallback keeps fake restaurants and menus visible | `Critical` | `app` | Remove sample fallback and use real empty and error states | `Yes` |
| Checkout | `Food/FoodModels.swift` | Expected `POST /food/restaurants/:restaurantId/orders` | Supported | Local-only fallback can create fake placed orders | `Critical` | `app` | Require backend restaurant and menu IDs before checkout | `Yes` |
| Order tracking | `Food/OrderTrackingView.swift` | `GET /food/orders/:orderId`, `GET /food/my/orders` | Supported | Screen still renders sample order details | `Critical` | `app` | Build tracking UI from backend payload only | `Yes` |
| Didit | `Profile/VerifyIdentityView.swift` | `POST /api/didit/start` | Supported as `/didit/start` | Double `/api` path | `Critical` | `app` | Fix request path and verify end to end launch | `Yes` |
| Change email | `Profile/AccountSecurityView.swift`, `Networking/AuthService.swift` | `POST /auth/change-email`, `POST /auth/confirm-email-change` | Supported, but different contract | App expects OTP flow; backend expects old and new confirmation tokens | `Critical` | `both` | Align one contract and rebuild UI accordingly | `Yes` |
| Delete account | `Profile/ProfileView.swift` | No backend request | Backend route exists | UI only signs out | `Critical` | `app` | Wire to `DELETE /privacy/delete-account` with required confirmation payload | `Yes` |
| Business settings preload and save | `Networking/BusinessAPIService.swift`, `Profile/BusinessSettingsView.swift` | `GET /me/businesses`, `PATCH /businesses/:id` | Backend expects summary list plus `GET /businesses/:id/profile-edit` and `PUT /businesses/:id` | Edit form is seeded from the wrong payload and saved with the wrong method | `Critical` | `both` | Load full editor data and save with `PUT` | `Yes` |
| Role switching | `Profile/ProfileModels.swift` | No backend request | Backend route exists | UI-only mode switching plus hardcoded mode list | `High` | `app` | Use `AuthService.switchRole(to:)` and backend-derived role availability | `Yes` |
| Support request | `Profile/AccountActionsViews.swift` | No backend request | Backend route exists | Report UI never creates a support ticket | `High` | `app` | Submit to `/support/request` and show created case state | `No` |
| Helper browse and reviews | `Skills/SkillsModels.swift`, `Skills/HelperProfileView.swift` | `GET /helpers`, `GET /reviews/users/:userId` | Supported | Sample helpers and reviews still appear in runtime | `High` | `app` | Remove runtime sample fallback and load real reviews | `Yes` |
| Chat | `Networking/ChatAPIService.swift` | `/messages/...` | Supported | Error fallback shows sample conversations and messages | `Medium` | `app` | Replace sample fallback with error and retry UX | `No` |
| Activity | `Activity/ActivityModels.swift` | `GET /notifications` | Supported | Empty notification state becomes fake activity | `Medium` | `app` | Replace sample activity with true empty state | `No` |
| Calendar helper search | `Calendar/HelperSearchPicker.swift` | `GET /users/helpers/search` | Supported | Mock helpers still appear on backend failure | `Medium` | `app` | Show empty or error state instead of local fake results | `No` |

## Final Production Readiness Call

OxSteed Main has enough real backend wiring to keep building on the current architecture, and repo `6` already supplies most of the required route surfaces. The main issue is not backend absence anymore. The main issue is that the app still allows prototype fallbacks and trust-sensitive fake flows to survive inside production runtime paths.

The fastest safe path to release is:

1. remove all runtime sample fallbacks from restaurants, checkout, tracking, helpers, chat, calendar helper search, and activity
2. fix the concrete contract mismatches called out above
3. wire the remaining profile and account actions to real backend endpoints

After those are done, the app can be re-audited as a genuinely production-backed client instead of a mixed production and prototype build.
