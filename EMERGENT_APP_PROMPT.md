# Emergent AI Build Prompt — OxSteed Mobile App

## Project

Build the official **OxSteed** mobile app (iOS + Android) as a single installable app that shares the **same backend, the same database, and the same user account system** as the existing OxSteed website (`https://oxsteed.com`). A user's activity on the website and the mobile app must remain in **1:1 parity** — a job posted on web shows up on mobile in real time, a message sent on mobile appears on web, an invoice generated on mobile is visible on web, etc.

The app is a single install in the App Store and Google Play. There are no separate apps per product line. Inside that one app, users **activate Modes**: independent, self-contained product experiences that can also connect to each other when more than one is enabled.

---

## Mental Model (Read This First)

**One app → Multiple self-contained product modes → Optional cross-mode connections.**

- The app is one binary, one icon, one login.
- Inside the app, the user picks which **Modes** they want active: Home, Learn, Tools, Pro. Modes can be toggled on/off at any time from a Modes screen.
- **Each mode is a standalone product.** A user with only Learn enabled gets a complete DIY learning app. A user with only Pro enabled gets a complete business management app. No mode requires another mode to be useful.
- When **multiple modes are enabled**, they offer optional cross-mode hand-offs (e.g., Learn → Home, Learn → Tools, Home → Pro). These hand-offs are surfaced as cards/suggestions, never as forced flows.
- Account, identity, payments, notifications, and messaging are **shared across all modes**. Mode-specific data (Learn progress, Tool rentals, Pro invoices, Home jobs) lives in its own scope but is accessible to any mode that asks for it via the existing OxSteed API.

---

## The Four Modes

### 1. Home — Marketplace, jobs, and hiring
The consumer/customer side of the local trades marketplace. Post jobs, get bids from helpers, hire, pay through escrow, review.
- Post a job (multi-step form: title, description, category, photos, location, budget, scheduling)
- Browse open helpers near me (map + list)
- Receive and accept bids
- In-app messaging with helpers
- Escrow checkout via Stripe
- Calendar with appointments + booking requests
- Reviews, reputation, dispute resolution
- Planned Needs (recurring/anticipated jobs like "tune-up car every 6 months")

### 2. Learn — DIY videos and step-by-step guides
Tutorial library. Watch how-to videos, follow step-by-step guides, save progress.
- Browse by category (plumbing, electrical, auto, home repair, etc.)
- Video player with chapters
- Step-by-step guides with progress tracking ("4 of 6 steps")
- Save / bookmark
- Search
- Optional certificates/badges on completion

### 3. Tools — Tool rentals and equipment
Peer-to-peer tool rental marketplace.
- Browse tool listings (filters: category, distance, price, condition)
- View listing detail (photos, specs, owner, reviews, availability calendar)
- Book a rental window
- Pickup/return flow with photos
- List your own tools for rent
- Owner dashboard (bookings, earnings)

### 4. Pro — Business operations for service providers
Operating system for helpers/businesses (the "Business Hub" on web).
- Clients list and CRM
- Invoices (create, send, track paid/unpaid)
- Scheduling and calendar with availability windows
- Services catalog with pricing rules and dynamic pricing
- Team members and role-based permissions
- Inbox (customer conversations across channels)
- Financials and tax tab
- Goals and analytics
- Multi-business workspace switcher

---

## Cross-Mode Connections (Surface Only When Both Modes Are Active)

- **Learn → Home**: "Don't want to do it yourself? Hire a helper for this." Pre-fills a job-post form with the guide title and category.
- **Learn → Tools**: "Need a tool for this step? Rent one." Deep links into Tools search filtered by the guide's required tools.
- **Home → Pro**: For users who are also helpers — "Open this job in your business workspace" so it lands in the Pro inbox with the client auto-created.
- **Tools → Pro**: Tool owner mode is part of Pro; if Pro is enabled, rental income flows into Pro financials.
- **Pro → Home**: A Pro business can post a job to find a subcontractor.

These show as **inline cards / chips** inside a mode, never as required steps. If the other mode is disabled, the card is hidden.

---

## Shared Foundation Across All Modes

These must work identically whether one mode or all four are enabled:

- **One account** (email + password, OTP via SMS, social login). Single JWT session shared by all modes.
- **One identity** (Didit verification, Checkr background check, profile photo, display name preference).
- **One inbox / messaging layer** (Socket.IO real-time). Conversations span modes — a Learn-related chat with an expert and a Home-related chat with a helper appear in the same inbox, tagged by mode.
- **One notifications system** (in-app, push via FCM/APNs, email digests, SMS opt-in). Per-mode notification toggles in Settings.
- **One payments layer** (Stripe Connect — escrow for jobs, marketplace for tool rentals, subscriptions for Pro, one-time for Learn premium content).
- **One calendar** that aggregates appointments, bookings, rental windows, planned needs.
- **One settings surface** with sections for account, modes, notifications, payment methods, identity, language, privacy, cookies.
- **i18n: English, Spanish, French, Haitian Creole** — must match web parity exactly. Use the existing `/api/locales` keys; do not invent new strings unless the web doesn't have them.

---

## Backend Integration — Hard Requirement

**Do not build a new backend.** Connect to the existing OxSteed backend.

- **Base URL**: configurable via env var `API_BASE_URL` (default `https://api.oxsteed.com` for production; `http://localhost:3000` for dev). Same endpoints the website uses.
- **Auth**: JWT access token (15 min) + refresh token (7 days). Mirror the web flow exactly: store both tokens securely (Keychain on iOS, Keystore on Android), attach `Authorization: Bearer <accessToken>` to every request, on 401 call `POST /api/auth/refresh` and retry. Concurrent refresh requests must be deduplicated.
- **Real-time**: Socket.IO client connecting to the same socket server, joining `user_<id>` and `business_<id>_inbox` rooms automatically on login.
- **File uploads**: multipart/form-data to the existing upload endpoints; the server already handles S3.
- **Push notifications**: register the device's FCM/APNs token via a new endpoint `POST /api/devices/register` (we will add this server-side). Server pushes to all registered devices when a user-targeted notification fires.

### Key API surfaces the app will consume (already exist on web)

```
Auth:              /api/auth/{login,register,refresh,logout,verify-otp,password-reset}
Profile:           /api/users/me, /api/users/me/settings
Jobs (Home):       /api/jobs, /api/bids, /api/jobs/:id/messages
Helpers (Home):    /api/helpers, /api/helpers/:id/profile
Bookings (Home):   /api/bookings, /api/calendar/appointments
Planned Needs:     /api/planned-needs, /api/planned-needs/suggestions
Learn:             /api/learn/* (NEW — see "Learn backend additions" below)
Tools:             /api/tool-rentals/browse, /api/tool-rentals/:id, /api/tool-rentals/bookings
Pro:               /api/businesses, /api/businesses/:id/{analytics,team,invoices,services,clients}
Inbox:             /api/conversations, /api/messages
Notifications:     /api/notifications, /api/notifications/email, /api/notifications/sms
Payments:          /api/payments, /api/carts/:id/payment-intent, /api/orders
Marketplace:       /api/marketplace (products)
Reputation:        /api/reputation/:userId
Templates:         /api/templates (profile templates — display only on mobile)
Discover:          /api/discover (unified search)
i18n:              /api/locales/:lang (or bundled in app)
```

A complete list lives in `server/routes/*.js` in the OxSteed repo. The app should consume the same shapes the web client does — do not invent new response formats.

### Learn backend additions (if `/api/learn/*` doesn't exist yet)

Most Learn surfaces are new. Generate spec for:
- `GET /api/learn/categories`
- `GET /api/learn/guides?category=&q=&page=`
- `GET /api/learn/guides/:id` (includes steps, video URLs, required tools, related jobs/services)
- `POST /api/learn/guides/:id/progress` (step index, completed at)
- `GET /api/learn/me/progress`
- `POST /api/learn/guides/:id/bookmark` / `DELETE`

Coordinate this with the web team — server controllers + migrations should live in the same repo so web can render Learn too.

---

## Information Architecture

```
Launch
 └─ Login / Sign up (skippable for Learn-only browsing? optional)
     └─ Mode picker (first run only — "Which experiences do you want to enable?")
         └─ Per-mode onboarding (only for selected modes)
             └─ Home shell
                 ├─ Bottom tab bar: tabs reflect ACTIVE modes (max 5 incl. Account)
                 │   Examples:
                 │     1 mode active  → [Home tab, Account]
                 │     2 modes active → [Mode A, Mode B, Account]
                 │     3 modes active → [Mode A, Mode B, Mode C, Account]
                 │     4 modes active → [Home, Learn, Tools, Pro, Account]
                 ├─ Top: greeting + universal search ("Search jobs, services, guides…")
                 ├─ Hero card (contextual to the most-used mode)
                 ├─ "Your active modes" horizontal carousel with one summary card per active mode
                 ├─ Recent activity feed (cross-mode)
                 └─ Global notification bell
```

### Modes screen (Account → Modes, or first-run picker)
- List of all four modes with a toggle each.
- Toggling a mode **on** triggers its onboarding flow (if not already completed).
- Toggling a mode **off** hides its tab and any cross-mode cards that depend on it but does **not** delete data — re-enabling restores it.
- Below the toggles, a "Connected experiences" section enumerates cross-mode links available given the current activation state.

---

## Mode-Based Feature Flagging

Implement a single in-app `modesStore` (Zustand or equivalent) with shape:

```ts
type Mode = 'home' | 'learn' | 'tools' | 'pro';
type ModesState = {
  active: Record<Mode, boolean>;
  onboardingComplete: Record<Mode, boolean>;
  toggleMode: (m: Mode, on: boolean) => void;
  isActive: (m: Mode) => boolean;
};
```

This drives:
- Bottom tab visibility
- Route guards (visiting a route belonging to a disabled mode redirects to the Modes screen with a "Turn on X to use this" prompt)
- Cross-mode card rendering (a card is hidden unless **both** the host mode and the target mode are active)
- Settings sections (Pro-only settings hidden when Pro is off)
- Push notification topics (subscribe/unsubscribe device from per-mode FCM topics on toggle)

Persist `modesStore` locally **and** sync to `users.settings.active_modes` (JSONB on the server) so that signing in on a new device restores the same mode set.

---

## Design Direction

Use the attached mockup as the reference:
- **Dark mode primary** (deep navy ~`#0B1220`, near-black surfaces), light mode supported. Match the existing web app's CSS variables conceptually but render natively.
- **Accent**: OxSteed orange `#F97316` for CTAs, active tab, primary buttons, status confirmations.
- **Typography**: large, friendly headings (Inter / SF Pro / Roboto), body 16px+, generous line height.
- **Cards**: rounded 16–20px, subtle borders, no heavy shadows.
- **Bottom nav**: icon + label, active tab in orange.
- **Hero cards** on the home dashboard use real imagery (helper at work, tools, etc.) with a rounded right edge.
- **Mode cards** in "Your active modes" have a small label chip in the top-left (`LEARN`, `TOOLS`, `PRO`) in orange.

---

## Tech Stack (recommendation — adjust if Emergent prefers different)

- **React Native + Expo (managed workflow)** for cross-platform iOS + Android from one codebase.
- **TypeScript**.
- **React Query** for server state (mirrors what the web already uses) + **Zustand** for client state including `modesStore`.
- **React Navigation** with a `BottomTabNavigator` whose screens are computed from `modesStore`.
- **expo-secure-store** for tokens.
- **expo-notifications** for push (FCM + APNs).
- **socket.io-client** for real-time.
- **i18next + react-i18next** with the same locale JSON shape the web uses (en, es, fr, ht).
- **Stripe React Native SDK** for in-app checkout (PaymentSheet).
- **react-native-maps** for helper/tool location and service-area circles (already a pattern on web with Leaflet).

---

## Onboarding Flows

### First run (no account)
1. Splash with logo.
2. Two-button screen: "I'm here to get something done" (suggests Home + Learn) / "I'm here to offer services" (suggests Pro + Home).
3. Mode picker (pre-checked based on prior selection; user can adjust).
4. Account creation (email + password or social) → OTP verification.
5. Per-mode mini-onboarding for each enabled mode:
   - **Home**: location permission, "what kind of help do you usually need?" (sets default category filters)
   - **Learn**: interests (multi-select categories), notification opt-in for new guides
   - **Tools**: location permission, "are you renting or listing?"
   - **Pro**: business name, primary service category, link to existing business workspace if one exists for this user account

### Re-enabling a mode later
- Lighter version of the above, only the strictly-needed steps.

---

## Critical Behaviors / Edge Cases

1. **Offline tolerance.** All read screens should show last-cached data when offline, with a banner. Writes queue and retry. Use React Query's persisted cache.
2. **Background socket reconnection** on app foreground.
3. **Universal deep linking**: `oxsteed://job/:id`, `oxsteed://guide/:id`, `oxsteed://tool/:id`, `oxsteed://business/:id/workspace/:tab`. Also support `https://oxsteed.com/...` universal links so a tap on a web URL opens the app if installed.
4. **Token expiry mid-action**: silent refresh; user never sees a logout unless the refresh itself fails.
5. **Mode toggled off while a deep link points into it**: open the Modes screen with a "Turn on Learn to view this guide" CTA, do not 404.
6. **Helper / Pro user identity**: a single user can be a customer (Home) AND a service provider (Pro). The app must let them switch contexts without re-logging in — Pro mode reads from `/api/me/businesses` to populate the workspace switcher.
7. **Push notifications routed by mode**: tapping a job-update push lands in Home tab; tapping a Pro invoice push lands in Pro tab. Honor mode-off (route to Modes screen with reactivation CTA).
8. **Cancellation fee flows** (existing on web): mirror the confirmation modal pattern with the moral-acknowledge checkbox; respect the 10%-capped-at-$100 fee.
9. **GDPR / privacy**: data export and account deletion buttons in Account → Privacy must call the same endpoints the web uses.
10. **App Store compliance**: any digital-content purchases (Learn premium, Pro subscription) need Apple IAP support OR be designed so that the app provides access to content purchased on the web (web-purchase pattern, similar to Spotify).

---

## What to Generate

For Emergent AI to produce, in priority order:

1. **Project skeleton** — Expo TS project, navigation shell, theme tokens, modesStore, auth context with JWT refresh interceptor.
2. **Modes screen** matching the attached mockup (toggles + connected experiences list).
3. **Dynamic bottom tab bar** driven by `modesStore`.
4. **Per-mode home screens** with skeleton lists wired to the listed API endpoints.
5. **Universal search** in the header (hits `/api/discover`).
6. **Auth screens** (login, signup, OTP, password reset) — exact API parity with the existing web flow.
7. **Inbox & real-time messaging** via Socket.IO.
8. **Push notification registration** + tap-routing per mode.
9. **Stripe PaymentSheet integration** for Home checkout and Tools rental booking.
10. **Settings → Modes, Notifications, Account, Identity, Privacy, Language.**
11. **i18n loaded from the same key set as the web app** (EN/ES/FR/HT).
12. **Deep linking config** (`app.json` scheme + universal links).

Then iterate per mode in this order: **Home → Learn → Tools → Pro**, completing each as a self-contained product before moving on.

---

## Acceptance Criteria

- A new user can install the app, sign up, enable only **Learn**, and have a complete, satisfying experience — without ever being prompted to also use Home, Tools, or Pro.
- The same user can later enable **Pro** in Settings → Modes, complete a 60-second onboarding, and immediately see their existing OxSteed businesses (created on web) and their invoices.
- A job posted on `oxsteed.com` appears in the mobile Home tab within 2 seconds (Socket.IO push).
- A message sent from the mobile inbox appears on the web inbox in real time.
- Toggling Home **off** removes the Home tab and hides the "Hire a helper for this guide" card inside Learn.
- All four locales render correctly with no untranslated keys.
- Push notifications respect per-mode opt-ins.
- Tokens persist across app kills; the user is not asked to log in again unless their refresh token has expired.

---

## Non-Goals

- Do **not** rebuild any backend logic that already exists in the OxSteed Node/Express server — call it.
- Do **not** create a separate user table, payment system, or notification system. Use the existing ones.
- Do **not** ship modes that are incomplete behind a flag. A mode is either fully working or not in the build.
- Do **not** force any user into a mode they didn't pick.

---

## Reference

- Production web: `https://oxsteed.com`
- API base (prod): `https://api.oxsteed.com`
- Repo lives at the same place as the website; mobile app should be added as `/mobile` (Expo project) so server + web + mobile share one monorepo and one CI pipeline.
- Design reference: see attached mockup (Modes screen + Home dashboard, dark navy + orange).

---

# Addendum — Real Modes & Capabilities Already in the OxSteed Codebase

> The four-mode model above (Home / Learn / Tools / Pro) was the user's stated starting point. The actual OxSteed backend contains **far more** than four products. Below is a grounded list of every additional top-level mode and every major sub-system that already exists server-side. The mobile app must surface these — do not pretend they don't exist and do not re-build them.

## Additional Top-Level Modes That Belong in the Mode Picker

### 5. **Life** — Personal life OS (`/api/life-dashboard`, `/api/vehicles`, `/api/house`, `/api/planned-needs`, `/api/life-pulse`)
A complete personal-finance + asset-management product. **Distinct from Home**: Home is "I need help"; Life is "I'm managing my own stuff and money." This mode alone could be its own app.
- **Vehicles**: garage of cars (VIN decoder, makes/models lookup, add/edit/delete).
- **Homes / Properties**: address lookup, multi-property list, add/edit/delete.
- **Expenses & Budgets**: income/expense tracking, monthly summary, recurring transactions (daily/weekly/monthly/quarterly/yearly), category budgets.
- **Goals**: savings/financial goals with progress tracking.
- **Home Tasks & Checklists**: personal to-do system for property maintenance.
- **Saved Helpers**: bookmark trusted helpers across past jobs.
- **Planned Needs**: recurring/anticipated jobs ("tune-up car every 6 months", "replace HVAC filter quarterly") with auto-publish on activation day, **sinking funds** (set aside money for each need), lead-time heads-up notifications, helper-acceptance flow, cost history, and per-need templates.
- **Life Pulse Score**: composite financial-health score across windows (1w/2w/1m/3m/6m/1y/5y/10y) — coverage, buffer, reliability, with timeline + trend area chart on the page.
- **Suggestions**: AI-generated "you should plan for X" suggestions.

### 6. **Consult** — Advisor / coaching (customer side: `/api/consulting`, `/api/consulting/all-phases`, `/api/consulting/payment`, `/api/consulting/feedback`, `/api/consulting/action-items`)
A full coaching/advisor product. Customer submits a consulting request (areas of help, business phase, urgency), gets matched with a consultant, books sessions, receives action items, gives feedback.
- Areas-of-help catalog + service tiers.
- Intake flow (`ConsultingIntakePage.jsx`).
- Session list + detail.
- Per-session action items with completion tracking.
- Package purchase (`/api/consulting/payment` with Stripe PaymentIntent).
- Post-session feedback collection.
- Three different portal pages on web: `ConsultingPortal`, `ConsultingPortalPage`, `ConsultingFullPortal`.

### 7. **Advise** — Consultant workspace (provider side: `/api/consultant-network`, `/api/consultant-scheduling`)
The other side of Consult — for users who ARE consultants.
- Consultant profile + dashboard.
- Availability calendar + blocked dates.
- Bookable time slots.
- Referral code management (consultants earn from their referral links).
- Earnings analytics.
- `ConsultantContractorDashboard.jsx`, `ConsultantAvailabilityPage.jsx`.

### 8. **Launch** — Business Launch / Franchise applications (`/api/business-launch`, `/api/franchise`)
Apply to start an OxSteed-branded business in a country/region. Real franchise product with initial fee, royalty bps, marketing fee, term years.
- Franchise programs catalog (default seeded: `oxsteed-global`, $25,000 initial fee, 6% royalty, 2% marketing, 5-year term).
- Application form (background, capital, desired territory, store count).
- Status tracking page (`BusinessLaunchStatusPage.jsx`).
- Launch checklist + completion %.
- Agreement, notes, activity log.
- Conversion into a live OxSteed business store.

### 9. **Support** — Support-agent workforce portal (`/api/support/agent`, `/api/support/agents`, `/api/support/chat`, `/api/support/shifts`)
For users employed by a business as support agents (a real role distinct from owner/manager/employee/representative). Has its own portal page (`SupportAgentPortalPage.jsx`).
- Multi-employer (a user can be a support agent for several businesses).
- Go online/offline per employment, global availability toggle.
- Shift scheduling, max concurrent chats per agent.
- Skill-based routing, escalation policies.
- Live chat queue, conversation assignment / claim / release / reassign.
- Canned response templates.
- KB (Knowledge Base) lookups.
- Performance + CSAT + SLA dashboards (built but separate).

### 10. **Shop** — Product marketplace (`/api/marketplace`, `/api/carts/*`, `/api/orders`, `/api/discount-codes`, `/api/affiliate`, `/api/shared-carts`)
The product marketplace is **not** Tools. Tools is peer-to-peer tool *rentals*. Shop is product *sales* — physical and API/digital products, with affiliate links (e.g., Home Depot), Stripe checkout, multi-tier promo codes, location-based shipping, shared carts, loyalty tiers.
- Browse products with infinite-scroll React Query (already redesigned).
- Cart, shared carts (group purchase), checkout via Stripe.
- Order history + order detail (`OrderHistoryPage`, `OrderDetailsPage`).
- Discount codes (percentage/fixed, min/max order, category-scoped, product-scoped, time-limited).
- Shipping calculator by zone (US continental / AK-HI / Canada / Mexico / Europe / Other).
- Affiliate commission tracking + payouts (Home Depot and custom programs).
- Loyalty tiers per business.
- API products (digital products with API keys, rate limits, usage logs).

## Pro Mode "Industry Packs" — Verticals That Reshape Pro

Pro is not a single fixed UI. The backend includes six **vertical operating systems** (migrations 249–254) that change Pro's tabs, intake forms, and workflow when a business operates in a specific industry. Treat these as **vertical packs** the user selects during Pro onboarding (or auto-detected from their business category).

| Pack | Controller / Migration | Distinct Surfaces |
|---|---|---|
| **Property Management** | `propertyOperationsController` / 249 | Units list, packages (residential/commercial), compliance records, maintenance request inbox |
| **Trades** | `tradesOperationsController` / 250 | Diagnostic requests (customer submits), recommendations, trust records, `TradesDiagnosticRequestPage` |
| **Beauty / Wellness** | `beautyOperationsController` / 251 | Intake requests, packages, trust records, `BeautyIntakeRequestPage` |
| **Creative Agency** | `creativeOperationsController` / 252 | Intake briefs, packages, approval records, `CreativeIntakeRequestPage` |
| **Professional (Legal / Accounting)** | `professionalOperationsController` / 253 | Engagement requests, packages, compliance records, `ProfessionalIntakeRequestPage` |
| **Continuity / Care** | `continuityOperationsController` / 254 | Intake, care plans, trust records (aging-in-place, hospice, etc.), `ContinuityIntakeRequestPage` |

Each pack also has a **customer-facing intake page** that the Home mode (or a public link / QR code) deep-links into.

---

## Multi-Business / Workspace Switching (Vortex)

Pro is **multi-tenant per user**. A single user account can own one or more businesses and additionally be a member of any number of businesses someone else owns. The web has a `VortexPage` (`/vortex`) for joining workspaces via code.

- `GET /api/me/businesses` — unified list of owned + active member + pending member businesses, sorted by last selected.
- Roles: **owner / manager / representative / employee / support_agent**.
- Per-role menus (see `client/src/utils/businessHubRoleMenu.js`) — the Pro tabs visible depend on the user's role in the current workspace.
- 75 named permissions (`team_permissions`) with allow/deny overrides per membership.
- Reusable **Vortex codes** (`VRTX-XXXXX-XXXXX`) for ongoing team joining (separate from single-use email invites). Optional owner approval.
- Mobile must show a **workspace switcher** in the Pro tab (or globally) and persist `last_selected_at` via `POST /api/me/workspace-context`.

## Corporate Hierarchy (Enterprise / Internal OxSteed Staff)

For OxSteed's own internal staff and any large customer org (migration 246). Probably hidden behind a Super-Admin flag for now, but the data model exists:
- 7 seeded departments (executive, technology, operations, marketing, finance, people, data).
- ~70 corporate titles (CEO, CTO, VP Eng, Director of Operations - LATAM, etc.) with seniority levels 1-10 and C-suite flags.
- Country/region-scoped assignments (`corporate_assignments`).
- 49-permission catalog (`platform.*`, `engineering.*`, `operations.*`, `finance.*`, `legal.*`, `marketing.*`, `people.*`, `data.*`, `corporate.*`).
- Org chart visualization, audit log.

The mobile app probably doesn't surface this in v1 — but admins who install the app must not crash when their account has corporate assignments.

---

## Existing Mobile Infrastructure (Do Not Reinvent)

**The server already has a mobile-specific API.** The mobile app must use it.

```
POST   /api/mobile/push-token                                      (already exists)
DELETE /api/mobile/push-token                                      (already exists)
GET    /api/mobile/feed                                            (mobile-tailored feed)
GET    /api/mobile/nearby                                          (geolocation)
POST   /api/mobile/offline-sync                                    (offline action queue, migration 268)
GET    /api/mobile/business/:businessId/workspace/mobile-summary   (mobile-optimized Pro summary)
GET    /api/mobile/payment-config                                  (Stripe publishable key + config)
POST   /api/mobile/invoices/:invoiceId/payment-intent              (Pro invoice → mobile checkout)
POST   /api/mobile/invoices/:invoiceId/confirm-payment             (confirm)
POST   /api/mobile/bookings/:bookingId/payment-intent              (booking checkout)
POST   /api/mobile/bookings/:bookingId/confirm-payment
POST   /api/mobile/helper/gallery                                  (multipart gallery upload)
```

**Offline queue table** `mobile_offline_actions` (migration 268): the app should write actions there via `POST /api/mobile/offline-sync` when reconnecting. Schema: `client_action_id` (idempotency), `action_type`, `payload JSONB`, `status` (queued / processed / failed).

**Web Push (VAPID)** is already implemented for the web (`webPushController`: `getPublicKey`, `subscribe`, `unsubscribe`, `listDevices`, `sendTest`). For native push the mobile app should register FCM/APNs tokens via the existing `/api/mobile/push-token` endpoint — DO NOT use the web-push VAPID flow on native.

---

## Major Sub-Systems I Underweighted in the Original Prompt

These aren't modes but they are first-class user-visible features that must be wired up:

### Identity & Trust
- **Two-Factor Authentication** (`/api/2fa`, `twoFactorController.js`) — TOTP enrollment, backup codes.
- **Didit identity verification** (`/api/verification`, `/api/didit`) — government-ID + selfie liveness via Didit; webhook-driven.
- **Checkr background checks** (`/api/verification/background-check`) — for helpers; webhook-driven.
- **User badges** (`getUserBadges`, `recalculateBadges`) — verified / background-checked / top-rated badges shown on profile cards.

### Disputes & Enforcement
- **Disputes flow** (`/api/disputes`, `disputeController.js`, `disputeAdminController.js`, `DisputeResolutionPage.jsx`) — escrow-aware dispute opening, evidence upload, admin resolution.
- **Enforcement system** (`/api/enforcement`, `/api/enforcement-policy`) — warnings, restrictions (bidding / job_posting / checkout / all), suspensions with auto-expiry. `users.is_suspended` + per-feature `user_restrictions`. Middleware-enforced.
- **User reporting** (`/api/reporting`, `userReportController.js`) — `job_user_reports`.
- **Review moderation** (`/api/review-moderation`).
- **Cancellation fees**: customer cancellation of an accepted job triggers a **10% capped at $100** fee with a moral-acknowledge modal (see `JobCancellationConfirmation.jsx`, `HelperCancellationConfirmation.jsx`). Mobile must reproduce both modals (role-aware).

### Reputation
- **Reputation score** per user (`reputationController.js`, `/api/reputation/:userId`).
- **Fee history** endpoint shows cumulative fees paid + per-fee timeline (customer's punctuality reputation).
- Reputation card embeddable on any profile.

### Subscriptions & Templates
- **Helper Free / Pro subscription tiers** (`subscriptionController.js`) with location-based PPP pricing (`pricingService.js`, 24 seeded countries, super-admin editable from `/admin/super/pricing-overrides`).
- **Profile Templates marketplace** (`templateController.js`, `TemplatePicker.jsx`, `/api/templates`) — 30 templates at **$0.99/month** with **automatic 1-year free trial on signup**. Active template renders the public profile differently.

### Booking & Scheduling
- **Direct helper booking** (`/api/bookings`, `BookHelperPage.jsx`) — slot picker with availability, confirmation window (1–168h), optional fallback "post publicly" if helper doesn't confirm.
- **Helper availability + service area** with radius circle on Leaflet/OpenStreetMap (web).
- **AI booking from chat** — chat messages can include `action` blocks that auto-create appointments (`appointments.source = 'ai_chat'`, `ai_thread_id`).
- **Calendar** with month/week/day views, mini-calendar sidebar, **now-indicator** red line, **block-time** for helpers, color-coded statuses, .ics export.
- **Per-staff overbooking enforcement** in business appointments (booking rules: min-advance, max-advance, duration-matches-service, staff-assigned-to-service, time blocks).

### Pricing
- **Dynamic pricing engine** (`pricingEngine.js`, `service_price_rules`) — time-of-day / seasonal / volume / demand / customer-segment children with priority + clamps, plus product pricing rules (fixed_price / fixed_modifier / percent_off / price_multiplier). Mobile must call `POST /:businessId/pricing/preview` to show live final prices in checkout.
- **Customer segments**: new / returning / vip / loyalty_tier_*.

### Discovery
- **Unified `/api/discover`** (already in original prompt) — but it also includes **saved discover alerts** with email digests (`createDiscoverAlert`, `deleteDiscoverAlert`, daily digest tick). Mobile should let users save searches and opt into push alerts when new matches appear.

### AI
- **Per-profile AI knowledge** (helper + business each have an `ai_knowledge` field, ≤8000 chars).
- **AI preview chat** (`AIPreviewPage.jsx`, `/dashboard/ai-preview`, `/business/:id/ai-preview`) — owners can chat with their own AI before customers see it.
- **AI chatbot on every profile** — customer can chat with the AI representing that helper / business (Redis-cached system prompt: skills, FAQs, products, availability, owner knowledge). AI can book appointments.
- **AI support widget** (`SupportWidget.jsx`) — Ask AI panel on the public site (currently auto-opens; suppressed on helper profile pages).

### Communications
- **Email preference center** (`/api/notifications/email`) — frequency: real-time / daily / weekly / off, category toggles, one-click unsubscribe tokens, digest queue.
- **SMS notifications** (`/api/notifications/sms`) — Twilio OTP phone verification (5 attempts/hour), per-event opt-in (order created / payment confirmed / shipped / cancelled / refunded), 1-per-event rate limit. **Mobile must reproduce the OTP phone-verification UI.**
- **Security email notice** — settings page shows users that account/security emails are always sent regardless of preferences.

### QR Codes
- **QR code generator** (`/api/qr-codes`, `QRCodeGeneratorPage.jsx`) — generate, list, download QR codes for profile / business / share links. Plus **profile QR PNG endpoint** `GET /api/helpers/:id/profile-qr.png` (sized 64–512px, cached) — the helper cover strip on web shows this QR. Mobile should show + share this QR (great for in-person handoffs).

### Promo / Referral
- **Referral codes** (`/api/referrals`, `referralController.js`).
- **A/B testing for discount codes** (`/api/ab-tests`, migration 139) — chi-square statistical analysis. Probably admin-only on mobile.

### Privacy / Compliance
- **Consent / Cookie banner** (`/api/consent`).
- **CCPA "Do Not Sell"** endpoint + page (`donotsell.tsx`).
- **GDPR data export + account deletion** endpoints (already on web; mobile must surface in Settings → Privacy).
- **Legal documents** — Terms + Privacy + Accessibility + Cookie Policy + Security, all localized in EN/ES/FR/HT via `client/src/locales/terms/` + `privacy/`.
- **Arbitration page**, **Escrow Policy page**, **Enforcement Policy page** — link in Settings.
- **Account termination** flow with grace period.

### Multi-Channel Inbox
- **Conversation channels** — chat is unified across web, mobile, guest chat (`guestChatController` — unauthenticated visitors can start a chat that converts to authed when they sign up), and AI chat. Mobile inbox must render all four channel types with consistent threading.
- **Conversation assignment** (claim / release / reassign) for Pro/Support agents.
- **Business message templates** (canned responses) — per-business library with keyboard shortcuts.

### Locales
- **Four locales must reach 1:1 parity**: en, es, fr, ht (Haitian Creole). The web has ~23,144 leaf keys per locale. Don't ship the app with any locale at lower parity — Haiti is a real market.

### Theming
- **Two distinct color palettes** in the web: app palette (cool grays / dark navy) and **homepage palette** (warm earth tones). Mobile should follow app palette throughout — homepage palette is web-marketing-site only.

---

## Updated Mode Picker (Final Recommendation)

Re-cast the first-run mode picker as a **two-tier** flow:

**Tier 1 — Persona** (single-select, sets sensible defaults):
1. **I need help around my life** → defaults: Home + Life + Learn
2. **I run a service business** → defaults: Pro + Home + Shop (for the helper's own tools/products)
3. **I rent tools / list tools** → defaults: Tools + Home
4. **I'm a consultant / advisor** → defaults: Advise + Consult
5. **I work as a support agent** → defaults: Support + Pro
6. **I'm applying to franchise OxSteed** → defaults: Launch + Consult

**Tier 2 — Modes** (multi-select toggle list of all 10 modes):
- Home, Learn, Tools, Pro, Life, Consult, Advise, Launch, Support, Shop.

Cross-mode hand-offs (now richer than the original four):
- Learn → Home, Learn → Tools, Learn → Shop
- Life → Home (a planned need becomes a posted job), Life → Tools (rent the tool you need for the home task), Life → Shop (buy the part)
- Home → Pro (open this job in my business workspace)
- Consult → Launch (your consultant can sponsor a franchise application)
- Pro → Support (hire / manage support agents for your business)
- Pro → Advise (offer your services as a consultant)
- Shop ↔ Pro (Pro businesses can sell products; orders flow into Pro financials)

## Updated Acceptance Criteria

Replace the original criteria with these (additive):
- A user can enable **Life only** and have a complete personal-finance + asset-management app (vehicles, homes, expenses, budgets, goals, planned needs with sinking funds, life pulse score).
- A consultant can enable **Advise only** and run their entire practice from the phone (availability, bookings, session notes, action items, referral code).
- A franchise applicant can enable **Launch only**, complete the application, see checklist progress, and chat with their assigned consultant.
- A support agent can enable **Support only** and take customer chats for the businesses they're employed by, with shift control.
- All six **Pro industry packs** render the correct intake form when a customer deep-links into one (e.g., `oxsteed://business/:id/intake/beauty`).
- The mobile app uses `/api/mobile/*` for push tokens, feed, nearby, offline-sync, and mobile-optimized payment intents (does **not** call the web-only routes for these).
- Offline writes queue into `mobile_offline_actions` via `client_action_id` for idempotency and replay on reconnect.
- The Vortex workspace switcher in Pro shows owned + member + pending businesses, sorted by `last_selected_at`, and persists context across sessions.
- Cancellation modals (customer + helper) reproduce the moral-acknowledge checkbox and 10%/$100 fee math.
- Identity verification (Didit) and background check (Checkr) flows complete via webhooks; badge state syncs to the profile.
- Profile template subscription ($0.99/mo) shows the active free-trial expiry on the user's Templates screen.
- All 10 modes have settings sections that are hidden when the mode is off, and all per-mode push topics subscribe/unsubscribe on toggle.
