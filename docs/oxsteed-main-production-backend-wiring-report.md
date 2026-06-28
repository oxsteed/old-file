# OxSteed Main Production Backend Wiring Report

Audited code state as of `2026-06-28`.

Scope:

- App: `/Users/oxsteed/Superapp-Projects/OxSteed Main`
- Backend: `/Users/oxsteed/Documents/GitHub/6/server`
- Goal: determine whether OxSteed Main is truly production-wired or still behaving like a prototype

## Executive Summary

### Verdict

**OxSteed Main is not production-ready.**

The backend repo already contains most of the required surface area. The release risk is not primarily "missing backend" anymore. It is a combination of:

- app-to-backend contract drift on several critical flows
- runtime sample/demo fallbacks that still make failing or empty features look alive
- profile and business surfaces that look production-real but are still partly local-only or wired to the wrong contract

In other words: this is no longer just a prototype backend problem. It is now mostly a **wiring honesty** problem.

### Feature Status Counts

Counts below are by feature surface in the integration matrix.

- `production-ready`: 7
- `partial`: 5
- `miswired`: 7
- `prototype-only`: 0
- `backend-missing`: 0

### Top Release Blockers

1. Restaurant detail is contract-mismatched:
   - app expects `restaurant + categories|menuCategories`
   - backend returns `restaurant + menu + uncategorizedItems`
   - the nested `restaurant` payload also uses `display_name`, not the app's required `name`

2. Order placement is contract-mismatched:
   - app expects `POST /food/restaurants/:restaurantId/orders` to decode directly to `APIFoodOrder`
   - backend returns `{ order, payment, trackingToken, replayed, runnerTask }`
   - result: backend can create a real order while the app still throws a decode error

3. Order history / tracking is contract-mismatched:
   - app order items require `id: String`, `menuItemId`, and `unitPriceCents`
   - backend order item payloads return numeric `id` plus `lineTotalCents`, and list route omits `menuItemId`
   - result: `GET /food/my/orders` and `GET /food/orders/:orderId` are at high risk of decode failure

4. Didit verification launch is still pointed at `"/api/didit/start"` even though the shared client already prepends `/api`.

5. Business settings are still miswired in two ways:
   - editor preload uses `GET /me/businesses` summary data instead of a full editor payload
   - save still uses `PATCH /businesses/:id` while backend exposes `PUT /businesses/:id`

6. Business team invite body is mismatched:
   - app sends `{ invite_email, role }`
   - backend expects `{ email, role }`

7. Profile trust/account flows are still not production-honest:
   - change email flow expects OTP token semantics the backend does not use
   - export-my-data is local-only UI
   - delete-account only signs the user out
   - report-a-problem does not create a backend support ticket

### Audit Basis

App-side networking and runtime feature wiring reviewed:

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
- `Home/HomeView.swift`
- `Food/FoodModels.swift`
- `Food/RestaurantsView.swift`
- `Food/RestaurantDetailView.swift`
- `Food/OrderHistoryView.swift`
- `Food/OrderTrackingView.swift`
- `Skills/SkillsModels.swift`
- `Skills/HelperProfileView.swift`
- `Calendar/HelperSearchPicker.swift`
- `Activity/ActivityModels.swift`
- `Profile/ProfileModels.swift`
- `Profile/ProfileView.swift`
- `Profile/AccountSecurityView.swift`
- `Profile/AccountActionsViews.swift`
- `Profile/VerifyIdentityView.swift`

Backend route/controller surfaces cross-checked:

- `server/index.js`
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
- `controllers/foodController.js`
- `controllers/businessController.js`
- `controllers/businessMembersController.js`
- `controllers/authController.js`

## Integration Matrix

| Feature | App surface | App service call(s) | Expected backend route(s) | Current backend support | Current app behavior | Status | User impact | Recommended fix owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth | `Auth/AuthView.swift`, `Networking/AuthService.swift` | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /notifications/push-token` | `routes/auth.js`, `routes/notifications.js` | Present and aligned | Core sign-in/session flow is real | `production-ready` | Users can authenticate against production state | `app` |
| Onboarding | `Auth/AuthView.swift`, `Networking/AuthService.swift` | `POST /auth/register/start`, `POST /auth/register/accept-terms`, `POST /auth/register/verify-otp`, `POST /auth/register/resend-otp`, `POST /auth/check-email`, `POST /auth/check-zip` | `routes/auth.js` | Present and aligned | Signup follows the backend multi-step registration flow | `production-ready` | New account creation is genuinely backend-backed | `app` |
| Role switching | `Profile/ProfileModels.swift`, `Profile/ProfileView.swift`, `Networking/AuthService.swift` | UI mutates local role only; real server call exists as `POST /auth/switch-role` | `routes/auth.js`, `authController.switchRole` | Present and aligned | UI-only mode switch; enabled roles and profile metrics are still hardcoded | `miswired` | User can believe they changed operating mode while backend session and permissions never changed | `app` |
| Home | `Home/HomeView.swift` | `GET /main-app/home` | `routes/mainApp.js`, `controllers/mainAppController.js` | Present and aligned | Dashboard is backend-driven and clears to honest empty/error states | `production-ready` | Main landing experience reflects backend state | `app` |
| Helpers | `Skills/SkillsModels.swift`, `Networking/JobsAPIService.swift` (`HelpersAPIService`), `Skills/HelperBrowseView.swift` | `GET /helpers?...` | `routes/helpers.js`, `controllers/helpersController.js` | Present and aligned | Remote helper browse is real, but runtime state still starts at `SampleData.helpers` and stays believable on failure/empty load | `partial` | Marketplace can look populated even when real helper browse failed or returned empty | `app` |
| Jobs | `Networking/JobsAPIService.swift`, `Skills/PostJobView.swift`, `Skills/MyJobsView.swift`, `Skills/JobBrowseView.swift` | `GET /jobs`, `GET /jobs/:id`, `POST /jobs`, `PUT /jobs/:id`, `POST /jobs/:id/cancel|start|complete|close`, `POST /jobs/assign`, `GET|PUT|DELETE /jobs/draft`, `GET /jobs/me/list`, `GET /jobs/:id/appointment` | `routes/jobs.js` | Present and aligned | Core jobs flow is backend-backed | `production-ready` | Posting, browsing, and managing jobs is real | `app` |
| Bids | `Networking/BidsAPIService.swift`, `Skills/JobBrowseView.swift`, `Skills/JobBidsView.swift` | `GET /bids/me`, `GET /bids/job/:jobId`, `POST /bids`, `PUT /bids/:id`, `POST /bids/:id/withdraw`, `GET /bids/recent` | `routes/bids.js` | Present and aligned | Route shapes match, but the app only explains sign-in while backend also enforces verified email, active onboarding, and pro tier | `partial` | Users can reach a real bid flow and still hit avoidable policy failures | `both` |
| Restaurants | `Food/FoodModels.swift`, `Food/RestaurantsView.swift`, `Food/RestaurantDetailView.swift`, `Networking/FoodAPIService.swift` | `GET /food/restaurants`, `GET /food/restaurants/:restaurantId`, `GET /food/restaurants/:restaurantId/promotions` | `routes/food.js`, `controllers/foodController.js` | Browse route is real; detail contract is not aligned | Restaurant list is live, but restaurant detail expects `categories|menuCategories` and a nested `restaurant.name`; backend returns `menu` plus `restaurant.display_name` | `miswired` | Restaurant cards can open into empty or failing detail screens even when backend data exists | `both` |
| Cart / order flow | `Food/FoodModels.swift`, `Food/CartView.swift`, `Networking/FoodAPIService.swift` | `POST /food/restaurants/:restaurantId/orders` | `routes/food.js`, `foodController.createOrder` | Present but response shape is not aligned | App expects `APIFoodOrder` as the top-level response, but backend returns a wrapper with `order`, `payment`, and tracking metadata | `miswired` | A real order can be created on the backend while the app surfaces a failure due to decode mismatch | `both` |
| Order tracking | `Food/OrderHistoryView.swift`, `Food/OrderTrackingView.swift`, `Networking/FoodAPIService.swift` | `GET /food/my/orders`, `GET /food/orders/:orderId`, `GET /food/orders/track/:trackingToken` | `routes/food.js`, `foodController.listMyOrders`, `foodController.getOrder` | Present but item contract is not aligned | Order fetches are real, but item payload fields do not match `APIOrderItem` requirements in the app | `miswired` | Order history and refresh can fail even after a real order was placed | `both` |
| Favorites | `Networking/FoodAPIService.swift` and food preference surfaces | `GET /food/customer/profile`, `PATCH /food/customer/profile`, `GET /food/customer/favorite-items`, `PUT /food/customer/favorite-items/sync`, `POST /food/customer/favorite-items/:restaurantId/:itemId/toggle`, `POST /food/customer/favorites/:restaurantId/toggle` | `routes/food.js` | Present and aligned | Favorite items, favorite restaurants, and basic food profile settings are real | `production-ready` | Favorite persistence is production-backed | `app` |
| Markets | `Food/MarketsPickerView.swift`, `Networking/FoodAPIService.swift` | `GET /food/markets` | `routes/food.js` | Present and aligned | Dynamic market list is backend-driven | `production-ready` | City/market availability can reflect live restaurant data | `app` |
| Chat | `Chat/ChatView.swift`, `Chat/ConversationView.swift`, `Networking/ChatAPIService.swift` | Conversations, message CRUD, reactions, archive/restore, attachments, guest inquiries | `routes/messages.js` | Present and aligned | Chat routes are real, but fetch failures fall back to `Conversation.samples` and `sampleMessages(...)` | `partial` | Messaging can look healthy while backend is actually failing | `app` |
| Notifications | `Networking/NotificationAPIService.swift`, `Notifications/*` | `GET /notifications`, read/delete ops, `GET|PUT /notifications/preferences`, `POST /notifications/push-token` | `routes/notifications.js` | Present and aligned | Inbox, read state, preferences, and push token registration are real | `production-ready` | Notification features are production-backed | `app` |
| Calendar | `Networking/CalendarAPIService.swift`, `Calendar/CalendarView.swift`, `Calendar/HelperSearchPicker.swift`, `Skills/BookingView.swift` | Appointment CRUD, reschedule, availability, notification prefs, `GET /users/helpers/search` | `routes/calendar.js`, `routes/users.js` | Present and aligned | Core calendar routes are real, but helper search still falls back to local `mockHelpers` on failure | `partial` | Booking-related search can become fake if backend search fails | `app` |
| Business hub | `Profile/BusinessHubView.swift`, `Profile/BusinessSettingsView.swift`, `Networking/BusinessAPIService.swift` | `GET /me/businesses`, `POST /businesses`, `PATCH /businesses/:id`, `GET /businesses/:id/invoices`, `GET|POST /businesses/:id/clients`, `GET|POST /businesses/:id/members` | Most routes exist; editor preload/update/invite contracts do not fully align | Workspace list, create, invoices, and clients are mostly real, but settings preload uses the wrong payload, settings save uses the wrong method, and member invites send the wrong field name | `miswired` | Business owners can see a real workspace shell but still fail on core management actions | `both` |
| Reviews | `Networking/ReviewsAPIService.swift`, `Skills/ReviewSubmitView.swift`, `Skills/HelperProfileView.swift` | `GET /reviews/users/:userId`, `GET /reviews/jobs/:jobId/eligibility`, `POST /reviews/jobs/:jobId`, `PUT /reviews/:id/respond` | `routes/reviews.js` | Present and aligned | Submit/respond/fetch routes exist, but helper profile still renders `SampleData.reviews(...)` and synthetic rating bars instead of backend review data | `partial` | Users can see believable but fake review content | `app` |
| Didit verification | `Profile/VerifyIdentityView.swift` | App calls `POST /api/didit/start` | `routes/didit.js` mounted at `/api/didit`; route is `POST /start` | Backend exists; app path is wrong | Shared client already prepends `/api`, so app likely requests `/api/api/didit/start` | `miswired` | Admin-forced identity verification can fail even though backend capability exists | `app` |
| Profile / account actions | `Profile/ProfileView.swift`, `Profile/ProfileModels.swift`, `Profile/AccountSecurityView.swift`, `Profile/AccountActionsViews.swift` | `PUT /auth/change-password`, `POST /auth/change-email`, `POST /auth/confirm-email-change`, `POST /auth/resend-verification`, expected `GET /privacy/export`, `DELETE /privacy/delete-account`, `POST /support/request` | Mixed: some present, some mismatched, some never called | Change password and resend verification are real, but change email is contract-mismatched, export is fake, report-a-problem is fake, tax docs are static, and delete-account only signs out | `miswired` | Trust-sensitive settings look complete while failing or doing nothing server-side | `both` |

## Mismatch Findings

This section uses the fixed audit schema requested for implementation follow-up.

| Feature | App entrypoint | App request | Backend route/support | Observed gap | Severity | Owner | Recommended fix | Release blocking? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Restaurant detail payload | `Networking/FoodAPIService.swift`, `Food/RestaurantDetailView.swift` | `GET /food/restaurants/:restaurantId` expects `APIRestaurantDetail { restaurant, categories|menuCategories }` | `foodController.getRestaurant` returns `{ restaurant, menu, uncategorizedItems }`; nested `restaurant` comes from `SELECT *` on `food_restaurants` | App-side model and backend response shape do not match. `restaurant.name` is required by app but backend uses `display_name`; menu lives under `menu`, not `categories` | `Critical` | `both` | Standardize backend detail response to the app contract or update app models/mapping to decode the existing backend payload intentionally | `Yes` |
| Order creation response | `Networking/FoodAPIService.swift`, `Food/FoodModels.swift` | `POST /food/restaurants/:restaurantId/orders` expects top-level `APIFoodOrder` | `foodController.createOrder` returns `{ order, payment, trackingToken, replayed, runnerTask }` | Backend may successfully create the order, but the app decode fails because it expects the wrong top-level shape | `Critical` | `both` | Make the app decode the wrapper or simplify backend response to a clearly documented order envelope used by mobile | `Yes` |
| Order item response shape | `Networking/FoodAPIService.swift`, `Food/OrderHistoryView.swift`, `Food/OrderTrackingView.swift` | App expects order items shaped like `APIOrderItem { id:String, menuItemId, itemName, quantity, unitPriceCents, notes }` | `listMyOrders` returns numeric `id`, `itemName`, `quantity`, `lineTotalCents`; `getOrder` returns numeric `id`, `itemName`, `quantity`, `lineTotalCents`, `specialInstructions` | The app model is stricter and differently named than the backend payload, so history/detail fetches are likely to fail decoding | `Critical` | `both` | Align one shared item contract for food orders and update both list and detail payloads to match it | `Yes` |
| Didit launch path | `Profile/VerifyIdentityView.swift` | `POST /api/didit/start` | `POST /api/didit/start` exists when mounted; app client already prepends `/api` | The request path likely becomes `/api/api/didit/start` | `Critical` | `app` | Change the app request path to `/didit/start` and verify the full Safari launch flow | `Yes` |
| Business settings preload | `Profile/BusinessSettingsView.swift`, `Networking/BusinessAPIService.swift` | App seeds editor from `GET /me/businesses` | Backend `GET /api/me/businesses` is a membership summary; richer editor route exists as `GET /api/businesses/:id/profile-edit` | Edit screen can load partial/blank fields and then overwrite real business data | `Critical` | `app` | Load the full business editor payload before presenting the form | `Yes` |
| Business settings save | `Networking/BusinessAPIService.swift` | `PATCH /businesses/:id` | Backend exposes `PUT /api/businesses/:id` | Update method mismatch blocks settings save | `High` | `app` | Switch the app to `PUT`, or explicitly add `PATCH` support on backend if desired | `Yes` |
| Business member invite | `Networking/BusinessAPIService.swift` | `POST /businesses/:id/members` with `{ invite_email, role }` | `businessMembersController.inviteMember` expects `{ email, role }` | The invite body field name is wrong | `High` | `app` | Send `{ email, role }` or add backend alias support for `invite_email` | `No` |
| Change email flow | `Profile/AccountSecurityView.swift`, `Networking/AuthService.swift` | App starts with `POST /auth/change-email`, then expects `POST /auth/confirm-email-change` with `{ token, otp }` | Backend `changeEmail` issues dual email confirmations; `confirmEmailChange` requires `{ oldToken, newToken }` | App assumes OTP confirmation semantics the backend does not implement, and `pendingToken` is never populated anyway | `Critical` | `both` | Pick one contract and align both sides. If backend stays dual-token, rebuild the app sheet around that flow | `Yes` |
| Delete account | `Profile/ProfileView.swift` | No backend delete call; destructive action only signs out | Backend exposes `DELETE /api/privacy/delete-account` with required body `{ confirmation: "DELETE MY ACCOUNT" }` | UI implies permanent deletion but only signs the user out | `Critical` | `app` | Wire the destructive action to the privacy delete route and handle backend blockers/errors | `Yes` |
| Export my data | `Profile/AccountActionsViews.swift` | No backend request; local timer and success alert only | Backend exposes `GET /api/privacy/export` | UI implies a privacy export request but never contacts the backend | `High` | `app` | Replace fake export flow with an authenticated backend export request | `Yes` |
| Report a problem | `Profile/AccountActionsViews.swift` | No backend request; local success alert only | Backend exposes `POST /api/support/request` | Support submission UI looks real but never creates a ticket | `High` | `app` | Submit to support backend and show created ticket state | `No` |
| Role switching | `Profile/ProfileModels.swift`, `Profile/ProfileView.swift` | No backend request; local role mutation only | Backend exposes `POST /api/auth/switch-role` and can rotate tokens | UI says the user switched workspace mode, but backend session and permissions do not change | `High` | `app` | Route switching through `AuthService.switchRole(to:)` and derive allowed modes from backend user state | `Yes` |

### Auth-State Mismatches

- **Bids**
  - app surface implies "signed in" is enough
  - backend additionally requires:
    - verified email
    - active onboarding
    - pro tier
  - result: a real backend rule exists, but the app does not prepare the user for it

- **Role availability**
  - `ProfileViewModel.buildAccount(...)` hardcodes enabled roles to `[.customer, .helper]`
  - this ignores backend-granted modes such as restaurant/business-related operational roles

### Response-Shape Mismatches Worth Calling Out Explicitly

- `GET /food/restaurants/:restaurantId`
  - app expects `categories` or `menuCategories`
  - backend returns `menu`

- `POST /food/restaurants/:restaurantId/orders`
  - app expects a bare order
  - backend returns an order wrapper with payment metadata

- `GET /food/my/orders`
  - app expects `APIOrderItem.unitPriceCents`
  - backend returns `lineTotalCents`

- `GET /food/orders/:orderId`
  - app expects `menuItemId`, `unitPriceCents`, `notes`
  - backend returns `lineTotalCents`, `specialInstructions`, and numeric item ids

## Prototype / Demo Inventory

### User-Visible Production Fallbacks

- `Skills/SkillsModels.swift`
  - `helpers` starts from `SampleData.helpers`
  - `loadHelpers()` keeps those believable helper cards alive on failed or empty remote result

- `Networking/ChatAPIService.swift`
  - `fetchConversations()` falls back to `Conversation.samples`
  - `fetchMessages()` falls back to `ChatMessage.sampleMessages(...)`

- `Calendar/HelperSearchPicker.swift`
  - failed helper search falls back to `mockHelpers`

- `Activity/ActivityModels.swift`
  - if notifications are empty, the activity feed swaps to `fallbackSampleEvents`

### Prototype UI That Misrepresents Real Backend Capability

- `Skills/HelperProfileView.swift`
  - public helper reviews still come from `SampleData.reviews(...)`
  - rating breakdown bars are generated locally, not from backend review stats

- `Profile/ProfileModels.swift`
  - active role, enabled roles, rating, review count, totals, and other hero metrics are still hardcoded defaults

- `Profile/AccountActionsViews.swift`
  - export-my-data is local-only
  - report-a-problem is local-only
  - tax documents are static local rows

- `Profile/ProfileView.swift`
  - delete-account destructive action only signs out

- `Food/RestaurantDetailView.swift`
  - rating review count and breakdown are still synthesized locally instead of coming from a backend review breakdown contract

### Benign Preview / Demo-Only Code

These are acceptable only if they remain unreachable from live release flows:

- `Models/SampleData.swift`
- `Food/FoodModels.swift` sample menu/order definitions
- `Food/OrderTrackingView.swift` preview-only sample order
- preview wiring in `CartView.swift` and `RestaurantDetailView.swift`

The problem is no longer the existence of sample code by itself. The problem is that some sample behavior still remains reachable from runtime failure states.

## Remediation Roadmap

### 1. Release Blockers

1. Fix food restaurant detail contract.
   - Owner: `both`
   - Reason: detail screen is not reading the real backend payload correctly

2. Fix food order creation response contract.
   - Owner: `both`
   - Reason: backend can create a real order while app thinks the request failed

3. Fix food order item contracts for order history and order detail.
   - Owner: `both`
   - Reason: history/tracking is at high risk of decode failure

4. Fix Didit start path from `"/api/didit/start"` to `"/didit/start"`.
   - Owner: `app`

5. Rebuild business settings around:
   - `GET /businesses/:id/profile-edit`
   - `PUT /businesses/:id`
   - Owner: `app`

6. Fix business member invite body field.
   - Owner: `app`

7. Route role switching through backend `POST /auth/switch-role`.
   - Owner: `app`

8. Rebuild change email around the real backend contract.
   - Owner: `both`

9. Wire export, delete-account, and report-a-problem to backend routes.
   - Owner: `app`

### 2. Contract Mismatches

1. Standardize a shared food mobile contract for:
   - restaurant detail
   - order create response
   - order list/detail items

2. Expose bid eligibility rules in the app before submit.

3. Make business editor payloads intentionally separate from membership-summary payloads.

4. Decide whether business invites should support `invite_email` as an alias or whether the app must switch to `email`.

### 3. Prototype-to-Production Replacements

1. Replace helper browse sample fallback with honest empty/error states.
2. Replace helper profile sample reviews with `ReviewsAPIService` data.
3. Replace chat sample fallback with reconnect/retry UX.
4. Replace activity sample fallback with a real empty-state UX.
5. Replace helper-search mock fallback with retry/error UX.
6. Replace hardcoded profile metrics and enabled roles with backend-derived state.

### 4. Nice-to-Have Cleanup

1. Add contract tests for:
   - `GET /api/main-app/home`
   - `GET /api/food/restaurants/:restaurantId`
   - `POST /api/food/restaurants/:restaurantId/orders`
   - `GET /api/food/my/orders`
   - `GET /api/food/orders/:orderId`
   - `POST /api/auth/switch-role`
   - `POST /api/auth/change-email`
   - `POST /api/support/request`
   - `POST /api/businesses/:id/members`

2. Add a release rule that runtime sample fallbacks are not allowed in production builds.

## Implementation Backlog

This is the condensed implementation-ready backlog from the audit.

| Feature | App entrypoint | App request | Backend route/support | Observed gap | Severity | Owner | Recommended fix | Release blocking? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Restaurants detail | `Networking/FoodAPIService.swift`, `Food/RestaurantDetailView.swift` | `GET /food/restaurants/:restaurantId` | Supported, but payload shape differs | App expects `categories|menuCategories` and `restaurant.name`; backend returns `menu` and `restaurant.display_name` | `Critical` | `both` | Standardize one detail payload and update the decoder/mapping | `Yes` |
| Order create | `Networking/FoodAPIService.swift`, `Food/FoodModels.swift` | `POST /food/restaurants/:restaurantId/orders` | Supported, but response shape differs | App expects a bare order; backend returns a wrapper | `Critical` | `both` | Align create-order response contract | `Yes` |
| Order history and tracking | `Networking/FoodAPIService.swift`, `Food/OrderHistoryView.swift`, `Food/OrderTrackingView.swift` | `GET /food/my/orders`, `GET /food/orders/:orderId` | Supported, but item fields differ | App order item model does not match backend list/detail payloads | `Critical` | `both` | Align one mobile order-item schema | `Yes` |
| Didit | `Profile/VerifyIdentityView.swift` | `POST /api/didit/start` | Supported as `/didit/start` | Double `/api` path bug | `Critical` | `app` | Fix request path and verify end-to-end launch | `Yes` |
| Business settings | `Networking/BusinessAPIService.swift`, `Profile/BusinessSettingsView.swift` | `GET /me/businesses`, `PATCH /businesses/:id` | Backend expects summary list plus `GET /businesses/:id/profile-edit` and `PUT /businesses/:id` | Editor is seeded from the wrong payload and saved with the wrong method | `Critical` | `both` | Load full editor data and save with `PUT` | `Yes` |
| Business member invite | `Networking/BusinessAPIService.swift` | `POST /businesses/:id/members` with `invite_email` | Backend expects `email` | Wrong request body field | `High` | `app` | Send `{ email, role }` | `No` |
| Role switching | `Profile/ProfileModels.swift`, `Profile/ProfileView.swift` | No backend request | Backend route exists | UI-only mode switching and hardcoded role availability | `High` | `app` | Use `AuthService.switchRole(to:)` and backend-derived mode state | `Yes` |
| Change email | `Profile/AccountSecurityView.swift`, `Networking/AuthService.swift` | `POST /auth/change-email`, `POST /auth/confirm-email-change` | Backend exists, but with different semantics | OTP-style app flow vs dual-token backend flow | `Critical` | `both` | Align one change-email contract | `Yes` |
| Export / delete / support | `Profile/AccountActionsViews.swift`, `Profile/ProfileView.swift` | No real export/delete/support write calls | Backend routes exist | UI implies real trust/account actions that are still local-only | `Critical` | `app` | Wire export, delete-account, and support ticket submission to backend | `Yes` |
| Demo fallbacks | `Skills/SkillsModels.swift`, `Networking/ChatAPIService.swift`, `Calendar/HelperSearchPicker.swift`, `Activity/ActivityModels.swift`, `Skills/HelperProfileView.swift` | Mixed runtime surfaces | Backend generally exists | Sample/mock behavior is still reachable in production failure states | `Medium` | `app` | Replace all runtime sample fallback with honest empty/error/retry UX | `No` |
