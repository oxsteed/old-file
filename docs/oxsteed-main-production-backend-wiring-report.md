# OxSteed Main Production Backend Wiring Report

## Executive Summary

### Verdict

**OxSteed Main is not yet production-wired end to end.** The app has a real backend service layer and several core routes do exist in repo `6`, but large parts of the user experience still behave like a prototype. The main risks are:

- user-visible demo/sample data that remains on screen when backend data is missing or errors
- several confirmed app-to-backend contract mismatches
- screens that look functional but do not actually call production backend flows
- a few feature surfaces that are only partially wired, so the app can appear live while silently falling back to local mock content

### Feature Status Counts

These counts are based on the feature areas in the integration matrix below.

- `production-ready`: 5
- `partial`: 8
- `miswired`: 4
- `prototype-only`: 2
- `backend-missing` confirmed findings: 2

### Top Release Blockers

1. **Didit verification launch is miswired**: the app calls `"/api/didit/start"` through an API client that already prepends `/api`, which likely produces `/api/api/didit/start`.
2. **Business profile update uses the wrong HTTP method**: the app sends `PATCH /businesses/:id`, while backend `6` exposes `PUT /businesses/:id`.
3. **Single food order refresh uses the wrong route shape**: the app expects `/food/restaurants/:restaurantId/orders/:orderId`, while backend `6` exposes `/food/orders/:orderId`.
4. **Calendar helper search uses a missing backend route**: the app calls `/users/helpers/search`, but no matching route exists in repo `6`; the UI falls back to mock helpers.
5. **Restaurant credit / wallet is not production-backed**: OxSteed Main presents a per-restaurant stored-value product, but repo `6` does not currently expose a matching customer wallet API or ledger contract for this flow.
6. **Multiple main surfaces still present production-looking sample data**: home, helper browse, restaurant browse, restaurant menus, helper reviews, chat, order tracking, profile metrics, and export/delete account flows still contain prototype behavior.

---

## Integration Matrix

| Feature | App entrypoint | App request | Backend route/support | Current app behavior | Status | User impact | Owner | Recommended fix | Release blocking? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth login | `Auth/AuthView.swift`, `Networking/AuthService.swift` | `POST /auth/login` | Supported by `server/routes/auth.js` | Core login path is wired and matches backend flow expectations, including agreement name | `production-ready` | Users can sign in against production auth | `none` | Keep and regression-test with real account flows | `No` |
| Registration / OTP onboarding | `Auth/AuthView.swift`, `Networking/AuthService.swift` | `POST /auth/register/start`, `POST /auth/register/accept-terms`, `POST /auth/register/verify-otp`, `POST /auth/register/resend-otp` | Supported by `server/routes/auth.js` | Core registration contract matches backend multi-step onboarding | `production-ready` | New users can create accounts with backend-backed OTP verification | `none` | Validate against latest web flow payloads during QA | `No` |
| Role switching | `Profile/ProfileView.swift`, `Profile/ProfileModels.swift`, `Networking/AuthService.swift` | UI switches locally; backend-capable path exists at `POST /auth/switch-role` | Backend route exists in `server/routes/auth.js` | Profile role switcher updates only local `account.activeRole`; it does not call `AuthService.switchRole(to:)` | `miswired` | User can believe they switched workspace while backend auth/session stays unchanged | `app` | Make role switcher call backend role-switch route and refresh `auth.currentUser` before updating UI | `Yes` |
| Home dashboard | `Home/HomeView.swift` | Only activity uses backend via recent bids; cards use local sample models | Backend has jobs, bids, helpers, food, payments, reviews routes, but home screen is not built on them | Helpers, restaurants, stats, and most activity remain hardcoded or sample-backed | `prototype-only` | Landing screen looks live even if production backend data is absent or inconsistent | `app` | Replace sample cards with real aggregations or explicit empty/loading states | `Yes` |
| Helper discovery | `Skills/SkillsView.swift`, `Skills/SkillsModels.swift`, `Networking/JobsAPIService.swift` | `GET /helpers?...` | Supported by `server/routes/helpers.js` | Core helper fetch exists, but initial state is `SampleData.helpers` and error fallback keeps demo helpers visible | `partial` | Users may browse sample helpers instead of real marketplace inventory when fetch fails or returns empty | `app` | Remove production fallback to sample helpers; render empty/error states | `Yes` |
| Jobs browse / create / manage | `Networking/JobsAPIService.swift`, `Skills/PostJobView.swift`, `Skills/MyJobsView.swift` | `GET /jobs`, `GET /jobs/:id`, `POST /jobs`, `PUT /jobs/:id`, `POST /jobs/:id/cancel|start|complete|close`, `POST /jobs/assign`, `GET|PUT|DELETE /jobs/draft`, `GET /jobs/me/list` | Supported by `server/routes/jobs.js` | Core job posting and lifecycle routes are present and aligned | `production-ready` | Main jobs flow is structurally compatible with backend | `none` | Regression-test payload mapping and auth gating | `No` |
| Bids | `Networking/BidsAPIService.swift`, `Skills/JobBidsView.swift` | `GET /bids/me`, `GET /bids/job/:jobId`, `POST /bids`, `PUT /bids/:id`, `POST /bids/:id/withdraw`, `GET /bids/recent` | Supported by `server/routes/bids.js` | Routing is aligned, but backend applies restrictions like verified email, onboarding state, and tier gating that the UI does not fully model | `partial` | Users can hit backend rejection states that are not clearly anticipated in the app | `both` | Surface backend eligibility requirements in UI before submit and handle error states explicitly | `No` |
| Restaurants discovery / menu | `Food/RestaurantsView.swift`, `Food/FoodModels.swift`, `Food/RestaurantDetailView.swift`, `Networking/FoodAPIService.swift` | `GET /food/restaurants`, `GET /food/restaurants/:restaurantId`, `GET /food/restaurants/:restaurantId/promotions`, `GET /food/markets` | Supported by `server/routes/food.js` | Routes exist, but the list initializes with `FoodSampleData.restaurants`, keeps sample content on failure or empty results, and the detail view falls back to `FoodSampleData.menu(for:)` when live menu sections are absent | `partial` | Food surfaces can appear populated even if the real market has no active restaurants or a restaurant menu payload is incomplete | `app` | Remove production sample fallback and show true empty/error states for both restaurant lists and menu detail | `Yes` |
| Cart / order submission | `Food/CartView.swift`, `Food/FoodModels.swift`, `Networking/FoodAPIService.swift` | `POST /food/restaurants/:restaurantId/orders` | Supported by `server/routes/food.js` | Order submit route exists, but delivery credit / wallet behavior is local-only and not obviously backed by a production ledger in this app flow | `miswired` | Users may see payment-like behavior that is not actually persisted or reconciled against backend state | `both` | Either remove local credit simulation or wire it to a real backend wallet / credit product before release | `Yes` |
| Order tracking / order history | `Food/OrderTrackingView.swift`, `Food/OrderHistoryView.swift`, `Networking/FoodAPIService.swift`, `Food/RestaurantsView.swift` | App uses `GET /food/my/orders`, `GET /food/orders/track/:trackingToken`, and `GET /food/restaurants/:restaurantId/orders/:orderId` | Backend supports `GET /food/my/orders`, `GET /food/orders/track/:trackingToken`, `GET /food/orders/:orderId` | Tracking sheet is still seeded with `FoodSampleData.activeOrder`, and single-order refresh path does not match backend route shape | `miswired` | Live orders can show sample presentation or fail refresh because the fetch route is wrong | `app` | Switch to backend `GET /food/orders/:orderId`, remove sample seeded tracking state for production | `Yes` |
| Favorites / customer profile | `Networking/FoodAPIService.swift`, food account/settings surfaces | `GET /food/customer/profile`, `PATCH /food/customer/profile`, `GET /food/customer/favorite-items`, `PUT /food/customer/favorite-items/sync`, `POST /food/customer/favorite-items/:restaurantId/:itemId/toggle`, `POST /food/customer/favorites/:restaurantId/toggle` | Supported by `server/routes/food.js` | Contract is largely aligned, but the app uses optimistic local state and does not present full failure recovery or favorite-restaurant hydration flows | `partial` | Users can get out-of-sync favorite state if backend calls fail | `app` | Add reload/error recovery and ensure all favorite state is hydrated from backend on load | `No` |
| Markets | `Food/MarketsPickerView.swift`, `Networking/FoodAPIService.swift` | `GET /food/markets` | Supported by `server/routes/food.js` | Dynamic market loading is correctly wired and replaces hardcoded city lists | `production-ready` | Customer market picker can reflect live backend restaurant markets | `none` | Keep as the model for other dynamic lookup surfaces | `No` |
| Chat / guest inquiries | `Chat/ChatView.swift`, `Chat/ConversationView.swift`, `Networking/ChatAPIService.swift` | `GET|POST /messages/conversations`, `GET|POST /messages/conversations/:conversationId`, reactions, archive/restore, attachments, block/unblock, report, guest inquiries | Supported by `server/routes/messages.js` | Route surface exists and matches well, but chat still falls back to `Conversation.samples` and `ChatMessage.sampleMessages(...)` on error | `partial` | Messaging can look healthy when backend is failing, which hides real production issues | `app` | Replace sample fallback with empty/error states and reconnect guidance | `Yes` |
| Notifications | `Notifications/*`, `Networking/NotificationAPIService.swift`, `App/OxSteedApp.swift` | `GET /notifications`, `POST /notifications/mark-read`, `POST /notifications/read-all`, `GET|PUT /notifications/preferences`, `POST /notifications/push-token`, `GET /notifications/:id`, `POST /notifications/:id/read`, `DELETE /notifications/:id` | Supported by `server/routes/notifications.js` | Notification route contract is aligned and complete for app usage | `production-ready` | Push registration, inbox, and preferences have a real backend path | `none` | Validate APNs release configuration separately | `No` |
| Calendar / availability | `Networking/CalendarAPIService.swift`, `Calendar/CalendarView.swift`, `Calendar/HelperSearchPicker.swift` | `GET|POST /calendar/appointments`, appointment confirm/cancel, reschedule, iCal, availability CRUD, notification preferences, notifications; app also calls `GET /users/helpers/search` | Calendar routes are supported by `server/routes/calendar.js`, but `/users/helpers/search` is not present in repo `6` | Core calendar routes are wired, but helper search inside calendar falls back to mock helpers because the searched route is missing | `partial` | Scheduling UI can degrade into mock selection even when production backend is live | `both` | Either add a supported helper-search endpoint or change the app to a route that exists | `Yes` |
| Business hub / workspace | `Profile/BusinessHubView.swift`, `Networking/BusinessAPIService.swift` | `/me/businesses`, `/businesses`, `/businesses/:id`, `/businesses/:id/invoices`, `/businesses/:id/clients`, `/businesses/:id/members` | Most routes exist via `server/routes/meWorkspace.js` and `server/routes/businesses.js`, but update method differs | Workspace list and create flows are real, but update uses `PATCH` while backend expects `PUT`; business stats in profile remain static | `partial` | Some business management flows are real while surrounding profile/business metrics still misrepresent live state | `both` | Normalize business update contract and replace static business/profile stats with backend-backed values | `Yes` |
| Reviews | `Networking/ReviewsAPIService.swift`, `Skills/HelperProfileView.swift` | `GET /reviews/users/:userId`, `GET /reviews/jobs/:jobId/eligibility`, `POST /reviews/jobs/:jobId`, `PUT /reviews/:id/respond` | Supported by `server/routes/reviews.js` | Submission and response routes exist, but helper review display still uses `SampleData.reviews(for:)` and local rating breakdowns instead of backend review data | `partial` | Review surfaces can look complete while showing sample testimonials rather than real production reviews | `app` | Keep the backend contract, but replace sample review rendering with backend-backed review fetches | `Yes` |
| Didit verification | `Profile/VerifyIdentityView.swift` | App calls `POST /api/didit/start`; backend mounts `POST /didit/start` under `/api/didit` | Backend route exists in `server/routes/didit.js`, but app path is double-prefixed | Verification launch is likely broken even though backend capability exists | `miswired` | Identity verification can fail at launch in production | `app` | Change request path to `/didit/start` and verify returned `verification_url` flow end to end | `Yes` |
| Profile / account actions | `Profile/ProfileView.swift`, `Profile/AccountActionsViews.swift`, `Profile/AccountSecurityView.swift` | `PUT /auth/change-password` is real; export/delete actions do not hit backend privacy routes | Backend supports `GET /privacy/export` and `DELETE /privacy/delete-account` in `server/routes/privacy.js` | Change password is real, but export is a fake timed UI flow and delete account only signs the user out | `prototype-only` | Users can believe sensitive account actions completed when nothing happened server-side | `app` | Wire export and delete to backend privacy routes or hide these actions until real | `Yes` |

---

## Confirmed Mismatch Findings

These are the most concrete app-to-backend contract problems found during the audit.

| Feature | App request | Backend route/support | Observed gap | Severity | Owner | Recommended fix | Release blocking? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Didit verification launch | `POST /api/didit/start` from `Profile/VerifyIdentityView.swift` | Backend mounts `diditRoutes` at `/api/didit` and route file exposes `POST /start` | Shared API client already prepends `/api`, so the app likely generates `/api/api/didit/start` | `Critical` | `app` | Change the client path to `/didit/start` | `Yes` |
| Business update | `PATCH /businesses/:id` from `Networking/BusinessAPIService.swift` | `server/routes/businesses.js` exposes `PUT /:id` | Method mismatch | `High` | `app` | Change app method to `PUT` or add backend `PATCH` support intentionally | `Yes` |
| Single food order refresh | `GET /food/restaurants/:restaurantId/orders/:orderId` from `Networking/FoodAPIService.swift` | `server/routes/food.js` exposes `GET /orders/:orderId` | Route shape mismatch | `High` | `app` | Fetch order by backend route `/food/orders/:orderId` | `Yes` |
| Calendar helper search | `GET /users/helpers/search?q=...&limit=20` from `Calendar/HelperSearchPicker.swift` | No matching route found in repo `6` | Confirmed missing endpoint, UI falls back to mock helpers | `High` | `both` | Add a real backend route or change app to a supported helper search endpoint | `Yes` |
| Profile role switching | Profile UI mutates local `account.activeRole` only | Backend route `POST /auth/switch-role` exists | UI does not call the backend-backed role switch path | `High` | `app` | Route all role switching through `AuthService.switchRole(to:)` | `Yes` |
| Export my data | `Profile/AccountActionsViews.swift` simulates export with local delay and success alert | Backend exposes `GET /api/privacy/export` | No backend call at all | `High` | `app` | Replace fake export flow with authenticated backend export request | `Yes` |
| Delete account | `DeleteAccountButton` only calls `auth.signOut()` | Backend exposes `DELETE /api/privacy/delete-account` with confirmation phrase and safety checks | Destructive action is not wired; UI behavior is misleading | `High` | `app` | Implement delete-account request flow with confirmation payload and backend response handling | `Yes` |

### Additional High-Risk Contract / Behavior Gaps

- `Home/HomeView.swift` uses `SampleData.helpers`, `SampleData.restaurants`, hardcoded KPI values, and sample recent activity fallback, so the home tab is not a trustworthy production dashboard.
- `Food/FoodModels.swift` initializes `restaurantsWithDistance` with sample restaurants and keeps those records when backend fetches fail or return empty.
- `Food/RestaurantDetailView.swift` falls back to `FoodSampleData.menu(for:)`, so a restaurant can display a realistic sample menu even when the backend has not provided one.
- `ChatAPIService.swift` falls back to `Conversation.samples` and `ChatMessage.sampleMessages(...)`, which can mask real backend failures.
- `OrderTrackingView` is still shown with `FoodSampleData.activeOrder` from `RestaurantsView.swift` and `OrderHistoryView.swift`, even when an API order exists.
- `Profile/ProfileModels.swift` still hardcodes role availability, ratings, totals, jobs completed, orders placed, and member-since text instead of deriving them from backend state.
- `Skills/HelperProfileView.swift` still renders `SampleData.reviews(for:)`, so the review surface is not actually using production review records.

---

## Confirmed Backend-Side Gaps / Incomplete Support

These are gaps where repo `6` itself does not currently satisfy the product behavior OxSteed Main presents.

| Feature | Backend route/support | Observed gap | Severity | Owner | Recommended fix | Release blocking? |
| --- | --- | --- | --- | --- | --- | --- |
| Calendar helper search | No route matching `GET /api/users/helpers/search` was found in `server/routes/users.js`, `server/routes/helpers.js`, or mounted route aliases | The app uses a route shape the backend does not expose | `High` | `both` | Either add a supported search endpoint or change the app to query an existing helper directory route with filters | `Yes` |
| Restaurant credit / wallet | No dedicated customer restaurant-wallet or stored-value routes were found under mounted `/api/food`, `/api/payments`, or other repo `6` surfaces; existing ledger concepts are platform ledger, POS ledger, and food loyalty | The app presents per-restaurant preloaded credit as if it is a real backend product, but repo `6` does not currently expose a matching source of truth for balances, funding, debits, or transaction history | `Critical` | `both` | Define and implement a real wallet/ledger contract before shipping this feature, or remove the feature from OxSteed Main production UI | `Yes` |
| Home dashboard aggregate | No single backend contract currently mirrors the app’s blended home dashboard of jobs, orders, helpers, restaurants, earnings, and recent activity | The app is forced to stitch a dashboard from sample data and partial endpoints, which makes the home screen misleading | `Medium` | `both` | Add a dedicated dashboard aggregate route or explicitly de-scope the dashboard to smaller real subsections | `No` |

---

## Prototype / Demo Inventory

These are the most important prototype behaviors still visible to end users.

### User-Visible Production Risk

- **Home tab**: `Home/HomeView.swift` uses `SampleData.helpers`, `SampleData.restaurants`, sample activity fallback, and hardcoded values like `3` active jobs, `2` orders, and `214` in earnings formatting.
- **Helper browse**: `Skills/SkillsModels.swift` initializes helpers from `SampleData.helpers` and keeps sample data when API loading fails.
- **Restaurant browse**: `Food/FoodModels.swift` initializes `restaurantsWithDistance` from `FoodSampleData.restaurants` and keeps sample content when real fetches fail or return empty.
- **Restaurant detail menu**: `Food/RestaurantDetailView.swift` falls back to `FoodSampleData.menu(for:)` when live menu sections are unavailable.
- **Chat**: `Networking/ChatAPIService.swift` falls back to sample conversations and sample messages.
- **Calendar helper picker**: `Calendar/HelperSearchPicker.swift` falls back to a hardcoded `mockHelpers` list because its backend route is missing.
- **Order tracking**: `Food/RestaurantsView.swift` and `Food/OrderHistoryView.swift` still inject `FoodSampleData.activeOrder` into tracking views.
- **Helper profile reviews**: `Skills/HelperProfileView.swift` renders `SampleData.reviews(for:)` instead of backend review records.
- **Profile stats and persona state**: `Profile/ProfileModels.swift` hardcodes ratings, totals, jobs completed, orders placed, enabled roles, member state, and the weekly earnings chart.
- **Account actions**: `Profile/AccountActionsViews.swift` simulates export locally; `Profile/ProfileView.swift` delete action only signs out.
- **Restaurant credit / wallet**: `Food/RestaurantWallet.swift` persists balances in `UserDefaults`, seeds sample credit, and `Food/RestaurantCreditView.swift` includes a demo load sheet that writes local-only wallet state.

### Prototype Features That Need Product Decisions Before Wiring

- **Restaurant credit / wallet simulation** in `Food/RestaurantWallet.swift` and `Food/RestaurantCreditView.swift` appears local/demo-driven. If this is meant to survive into production, it needs a real backend source of truth and ledger behavior.
- **Home dashboard composition** currently blends skills marketplace and food ordering with mostly local presentational cards. This needs a deliberate backend-backed dashboard contract rather than incremental patching.

### Benign Preview / Development-Only Uses

- `Models/SampleData.swift`, `Food/FoodModels.swift`, and preview blocks are fine as preview scaffolding **only if they never appear in runtime error paths**.
- The problem is not that sample data exists; the problem is that sample data still drives live screens and error fallback behavior.

---

## Remediation Roadmap

### 1. Release Blockers

1. Fix Didit launch path to use `/didit/start` through the shared API client.
2. Align business profile update to backend method expectations (`PUT /businesses/:id`).
3. Align single-order refresh to backend route shape (`GET /food/orders/:orderId`).
4. Replace calendar helper search mock fallback by either:
   - adding a real backend search route, or
   - changing the app to an already supported helper search surface.
5. Remove fake export/delete account behavior from production UI unless it is fully wired.
6. Either implement a real restaurant credit / wallet backend contract or remove the feature from the production app.

### 2. Contract Mismatches

1. Route all profile role switching through backend auth role switching.
2. Audit every `FoodViewModel` and `BusinessAPIService` mutation for exact backend method and response-shape alignment.
3. Recheck any path that was manually assembled around helper, business, food order, and verification flows.

### 3. Prototype-to-Production Replacements

1. Replace runtime sample fallbacks in home, helpers, restaurants, menus, chat, reviews, and order tracking with:
   - empty state
   - loading state
   - retry / error state
2. Replace hardcoded profile metrics and role availability with backend-derived state.
3. Decide whether restaurant wallet / credit is a real production feature; if not, remove it from the main production app.

### 4. Nice-to-Have Cleanup

1. Consolidate dashboard data into a single production-backed home contract if OxSteed Main is intended to be the umbrella app.
2. Make helper reviews in profile surfaces consume `ReviewsAPIService` rather than sample review content.
3. Add backend contract tests or a generated API compatibility checklist for app networking services.

---

## Acceptance Checklist For Follow-Up Implementation

The next engineer should consider this report complete enough to act on only if they can implement against it without re-discovery.

- Every backend-dependent feature area in OxSteed Main is classified above.
- Every major app service was cross-checked against mounted backend routes in `server/index.js` plus the relevant route file.
- Confirmed route mismatches are explicitly named.
- Prototype behavior is separated from true backend support.
- Each important issue is assigned to `app`, `backend`, or `both`.
- Release blockers are clear enough to turn directly into tickets or implementation tasks.

---

## Evidence Base

This report was derived from the current code in:

- `OxSteed Main/OxSteed Main/Networking/*`
- Specifically cross-checked: `APIClient.swift`, `AuthService.swift`, `JobsAPIService.swift`, `BidsAPIService.swift`, `FoodAPIService.swift`, `ChatAPIService.swift`, `NotificationAPIService.swift`, `CalendarAPIService.swift`, `BusinessAPIService.swift`, and `ReviewsAPIService.swift`
- `OxSteed Main/OxSteed Main/Home/*`
- `OxSteed Main/OxSteed Main/Food/*`
- `OxSteed Main/OxSteed Main/Skills/*`
- `OxSteed Main/OxSteed Main/Profile/*`
- `server/index.js`
- `server/routes/auth.js`
- `server/routes/food.js`
- `server/routes/jobs.js`
- `server/routes/bids.js`
- `server/routes/messages.js`
- `server/routes/notifications.js`
- `server/routes/calendar.js`
- `server/routes/businesses.js`
- `server/routes/helpers.js`
- `server/routes/meWorkspace.js`
- `server/routes/privacy.js`
- `server/routes/reviews.js`
- `server/routes/didit.js`
