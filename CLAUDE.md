# OxSteed — AI Contributor Guide

**Last updated:** 2026-04-10 (security audit — PR #74 merged)

> **Instructions for every AI session:**
> 1. Read this file first. It is the authoritative source of truth for what exists, what works, and what still needs to be done.
> 2. After completing any meaningful work, update this file — add to "Completed", remove or revise "Remaining Work", update file paths, and note any new issues discovered.
> 3. Commit the CLAUDE.md update in the same commit as the work it documents (or as its own follow-up commit if the work spans many files).
> 4. Do not pad this file with summaries of work you didn't personally do or verify. Keep it accurate and terse.

---

## Project Overview

**OxSteed** — a full-stack local trades marketplace.

- Customers post jobs, helpers bid, payments are handled with optional Stripe escrow.
- Helpers have tiered memberships (Free / Pro) with trial periods.
- Identity verification via Didit; background checks via Checkr; SMS OTP via Twilio; email via Resend; file storage on AWS S3.

### Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript/Vite + Tailwind CSS (dark mode via `class`) |
| Backend | Node.js + Express |
| Database | PostgreSQL via `pg` pool |
| Auth | JWT (access 15m + refresh 7d), stored in `localStorage` |
| Payments | Stripe Connect direct charges, `capture_method: 'manual'` for escrow |
| Deployment | Coolify + Docker, pushed from GitHub |
| Real-time | Socket.IO |

### Repo layout

```
/
├── client/               # Vite React SPA
│   ├── src/
│   │   ├── api/          # axios instance (axios.js) + per-domain helpers
│   │   ├── components/   # shared UI, PageMeta, ThemeToggle, CookieConsent, etc.
│   │   ├── context/      # AuthContext, ThemeContext
│   │   ├── hooks/        # useAuth, useJobs, usePayments, useSubscription, etc.
│   │   ├── pages/        # route-level page components
│   │   ├── styles/       # page-specific CSS files
│   │   ├── utils/        # consentScripts.ts, (add more here)
│   │   └── index.css     # Tailwind + CSS variable dual-palette theme system
│   └── index.html        # static og/meta defaults (overridden per-page by PageMeta)
└── server/
    ├── __tests__/        # Jest test suite (82 tests, all passing)
    ├── controllers/      # one file per domain
    ├── jobs/             # weeklySummary cron
    ├── middleware/        # auth, rateLimiter, sanitize, securityHeaders, etc.
    ├── migrations/       # SQL files 001–039, applied by migrate.js
    ├── routes/           # one file per domain
    ├── services/         # feeService, socketService
    └── utils/            # logger, validate, validateEnv, apiError, storage, email, sms
```

---

## Environment Variables

Set in Coolify (production) or a local `.env` file (development). See `server/.env.example` for the full list.

### Required (server exits if missing)

Enforced by `server/utils/validateEnv.js`:

```
JWT_SECRET
DATABASE_URL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

### Key optional vars

| Var | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_REGION` + `AWS_S3_BUCKET` | File uploads (profiles, job media). Falls back to base64 in DB if unset — **set this in production**. |
| `REDIS_URL` | Distributed rate limiting. Falls back to in-memory (fine for single instance, breaks multi-replica). |
| `RESEND_API_KEY` | Transactional email (OTP, password reset, notifications). |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` | SMS OTP. |
| `DIDIT_API_KEY` + `DIDIT_WORKFLOW_ID` + `DIDIT_WEBHOOK_SECRET` | Identity verification. |
| `APP_URL` or `CLIENT_URL` | Used to build password-reset links. Must be the public-facing frontend URL. |
| `REDIS_URL` | Add to Coolify when a Redis instance is provisioned — no code changes needed. |
| `VITE_GA_MEASUREMENT_ID` | Google Analytics 4. Consent-gated — won't fire until user accepts analytics cookies. |
| `VITE_META_PIXEL_ID` | Meta Pixel. Consent-gated. |

---

## Theme System

Dark mode toggled via `html.dark` class (set by `ThemeContext`). CSS variables in `client/src/index.css`:

- **App palette** (cool grays): `--app-bg`, `--nav-bg`, `--app-text`, `--card-bg`, `--border-color`, `--muted-text`
- **Homepage palette** (warm earth tones): defined in `client/src/styles/HomePage.css` under `.hp-root` and `.dark .hp-root` — intentionally different from the rest of the app.
- Light mode overrides: 50+ Tailwind utility class overrides in `index.css` under `html:not(.dark)` prevent hardcoded dark classes from rendering incorrectly.

`ThemeToggle.jsx` is the pill-switch toggle; it appears in both `Navbar.jsx` and `HomePage.jsx`.

---

## Authentication Flow

1. `POST /api/auth/register` or `/login` → returns `{ user, accessToken, refreshToken }`
2. `accessToken` (15m JWT) attached to every request via `client/src/api/axios.js` request interceptor.
3. On 401: `client/src/api/auth.js` response interceptor auto-refreshes using `refreshToken` stored in `localStorage`, then retries the original request. Concurrent refreshes are deduplicated.
4. `POST /api/auth/refresh` → issues a new token pair; old refresh token is invalidated in `sessions` table.
5. Logout invalidates the session server-side.

---

## Database Migrations

- Files: `server/migrations/001_*.sql` … `039_user_skills_and_tool_rentals.sql`
- Runner: `server/migrate.js` — applies unapplied migrations tracked in `_migrations` table.
- Runs automatically at startup (`npm start` = `node migrate.js && node index.js`).
- **To add a new migration:** create `server/migrations/040_description.sql`, it will be applied on next startup.

---

## Payment Architecture

- **Tier 1/2 (standard):** Stripe Checkout or Payment Intent, platform fee taken via `application_fee_amount`.
- **Tier 3 (escrow):** `capture_method: 'manual'` — funds authorized at checkout, captured when job is marked complete.
- **Webhook events handled** (`server/controllers/webhookController.js`):
  - `checkout.session.completed`
  - `customer.subscription.created/updated/deleted`
  - `invoice.payment_failed`
  - `payment_intent.amount_capturable_updated` → status='authorized'
  - `payment_intent.succeeded` → status='captured', escrow_status='released'
  - `payment_intent.payment_failed` → status='failed'
  - `charge.refunded` → status='refunded'
- Stripe Connect must be enabled on the Stripe dashboard for Tier 3 direct charges to work.

---

## File Storage

`server/utils/storage.js` — uses `@aws-sdk/client-s3`.

- Reads bucket from `AWS_S3_BUCKET` (primary) or `S3_BUCKET` (fallback).
- If AWS credentials are absent: `uploadFile()` returns `null` and controllers fall back to base64 data URLs (works but bloats the DB — always configure S3 in production).
- Public profile photos: `getPublicUrl(key)` → permanent CDN URL.
- Private files (W-9, background check results): use `getSignedDownloadUrl(key)` which expires in 1 hour.

---

## Cookie Consent & Analytics

- Banner: `client/src/components/CookieConsent.tsx` + `client/src/hooks/useCookieConsent.ts`
- Script loader: `client/src/utils/consentScripts.ts`
  - `initAnalytics()` — injects GA4 script only if `VITE_GA_MEASUREMENT_ID` is set AND analytics consent was given.
  - `initMarketing()` — injects Meta Pixel only if `VITE_META_PIXEL_ID` is set AND marketing consent was given.
  - `bootConsentedScripts()` — called on mount to replay previously saved consent.
- Non-essential scripts **cannot** load before the user consents. This is enforced — scripts are injected dynamically after consent, never via `index.html`.

---

## Logging

`server/utils/logger.js` — lightweight structured logger, no dependencies.

- **Production:** NDJSON to stdout (info/debug) and stderr (warn/error). Compatible with Datadog, Logtail, Papertrail.
- **Development:** colored pretty-print.
- `logger.requestMiddleware()` — Express middleware that logs every response with method, path, status, ms, IP. Wired in `server/index.js` before all routes.
- `LOG_LEVEL` env var controls minimum level (default: `info` in prod, `debug` in dev).
- **Known gap:** ~206 `console.error/log/warn` calls remain in `server/controllers/`. They work fine but aren't structured. Migrate them to `logger.*` incrementally; the pattern is:
  ```js
  const logger = require('../utils/logger');
  // replace: console.error('Foo error:', err)
  // with:    logger.error('Foo error', err)
  ```

---

## Rate Limiting

`server/middleware/rateLimiter.js`

- `generalLimiter` — 100 req / 15 min / IP on all `/api/` routes.
- `authLimiter` — 15 req / 15 min / IP on `/api/auth`.
- `strictLimiter` — 5 req / hour / IP on account deletion and data export.
- Uses Redis (`REDIS_URL`) when available; falls back to in-memory silently.
- **Action needed:** provision a Redis instance (Upstash or Render Redis) and set `REDIS_URL` in Coolify when scaling beyond a single container.

---

## Test Suite

```
server/__tests__/
├── setup.js           # pg, stripe, redis, socket mocks; JWT env; resetMocks()
├── auth.test.js       # register, login, refresh, logout (12 tests)
├── userSkills.test.js # lookup, CRUD with real JWT auth (13 tests)
├── validate.test.js   # pure unit tests for all validate.js rules (9 tests)
├── job.test.js        # list, get, create, cancel, me/list (11 tests)
├── payment.test.js    # intent, capture, me, connect status (10 tests)
├── bid.test.js        # create, list, update, withdraw (11 tests)
├── review.test.js     # submit, user reviews, eligibility (6 tests)
└── webhook.test.js    # all Stripe event types incl. payment_intent (10 tests)
```

Run: `cd server && npm test` — all 82 tests pass.

---

## Key Components Reference

| Component | Path | Notes |
|---|---|---|
| `PageMeta` | `client/src/components/PageMeta.jsx` | Drop-in per-page title + og/twitter meta. Requires `<HelmetProvider>` in App.jsx (already wired). |
| `ThemeToggle` | `client/src/components/ThemeToggle.jsx` | Pill toggle for dark/light mode. |
| `Navbar` | `client/src/components/Navbar.jsx` | Uses CSS variables for theming. Contains ThemeToggle. |
| `CookieConsent` | `client/src/components/CookieConsent.tsx` | GDPR banner + settings panel. |
| `TrialBanner` | `client/src/components/TrialBanner.tsx` | Shows trial days remaining for helpers. |
| `ErrorBoundary` | `client/src/components/ErrorBoundary.tsx` | Wraps entire app. |
| `LiveCaptureModal` | `client/src/pages/PostJobPage.jsx` (inline) | Modal using `getUserMedia` + `MediaRecorder` for real camera/mic capture. Photo: `canvas.toBlob()`; Video/Audio: `MediaRecorder` chunks → `File`. |
| `ContentRemovals` | `client/src/admin/pages/ContentRemovals.jsx` | Admin page — remove bids/reviews with required reason, logged to `admin_audit_log`. |
| `AdminAccounts` | `client/src/admin/pages/super/AdminAccounts.jsx` | Super-admin page — create/disable admin accounts, view per-admin activity, force logout. |

---

## API Routes Reference

| Prefix | File | Auth |
|---|---|---|
| `/api/auth` | `routes/auth.js` | Mixed |
| `/api/jobs` | `routes/jobs.js` | Mixed |
| `/api/bids` | `routes/bids.js` | Required |
| `/api/payments` | `routes/payments.js` | Required |
| `/api/webhooks` | `routes/webhook.js` | Stripe/Didit signature |
| `/api/helpers` | `routes/helpers.js` | Public |
| `/api/user-skills` | `routes/userSkills.js` | `/lookup` public, rest require auth |
| `/api/tool-rentals` | `routes/toolRentals.js` | `/browse` public, rest require auth |
| `/api/reviews` | `routes/reviews.js` | Mixed |
| `/api/messages` | `routes/messages.js` | Required |
| `/api/notifications` | `routes/notifications.js` | Required |
| `/api/subscription` | `routes/subscription.js` | Required |
| `/api/verification` | `routes/verification.js` | Required |
| `/api/life` | `routes/lifeDashboard.js` | Required |
| `/api/admin` | `routes/admin.js` | Admin role |
| `/api/2fa` | `routes/twoFactor.js` | Mixed |
| `/api/disputes` | `routes/disputes.js` | Required |
| `/api/consent` | `routes/consent.js` | Mixed |
| `/api/privacy` | `routes/privacy.js` | Required |
| `/api/geo` | `routes/geo.js` | Public |
| `/api/businesses` | `routes/businesses.js` | Mixed |
| `/api/chat` | `routes/chat.js` | Required |
| `/api/support` | `routes/support.js` | Mixed |
| `/api/didit` | `routes/didit.js` | Didit webhook |
| `/api/planned-needs` | `routes/plannedNeeds.js` | Required |

---

## Production-Readiness Audit — Completed Items

All items from the full production-readiness audit have been addressed. Recorded here for historical context.

### Critical (all done)
- [x] PostCSS `@import` must precede `@tailwind` — was at line 204, moved to line 1. This was the root cause of Coolify build failures.
- [x] S3 `uploadFile()` was never called — profile photos were stored as base64 in the DB; job media used wrong multer fields. Both now properly upload to S3.
- [x] Startup env var validation (`server/utils/validateEnv.js`) — exits with a clear error if `JWT_SECRET`, `DATABASE_URL`, `STRIPE_SECRET_KEY`, or `STRIPE_WEBHOOK_SECRET` are missing.
- [x] Input validation on auth endpoints — `server/utils/validate.js` + `rules` applied to register, login, forgotPassword, and helperRegistration.
- [x] `reviewController.submitReview` — `db.connect()` was outside try/catch, causing unhandled rejections on pool exhaustion. Fixed with wrapping try/catch and guarded `release()`.
- [x] Stripe webhook missing Tier 3 events — added `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.

### High Priority (all done)
- [x] JWT 401 refresh interceptor — already implemented in `client/src/api/auth.js`; confirmed working.
- [x] Helper email + onboarding verification before public listing — `listHelpers` and `getHelperProfile` now require `u.email_verified = TRUE AND u.onboarding_completed = TRUE`.
- [x] Cookie consent gating — non-essential scripts (GA4, Meta Pixel) now injected only after consent via `client/src/utils/consentScripts.ts`.
- [x] HelperDashboard Skills & Tools tab — added to `client/src/pages/HelperDashboard.jsx` (same API as Dashboard.jsx).
- [x] Structured logging — `server/utils/logger.js`; wired into `index.js`, `db.js`, `storage.js`, `rateLimiter.js`, new route files.
- [x] DB pool `max` reduced from 20 → 10 (right-sized for Render/small VMs).
- [x] Password reset URL — verified; uses `APP_URL || CLIENT_URL`.
- [x] Jest test suite — 82 tests across auth, userSkills, validate, job, payment, bid, review, webhook. All passing.
- [x] Redis rate limiting — already implemented; auto-detects `REDIS_URL`.

### Medium Priority (all done)
- [x] `AWS_S3_BUCKET` vs `S3_BUCKET` mismatch — `storage.js` now reads `AWS_S3_BUCKET` first.
- [x] Image lazy loading — added `loading="lazy"` to `BusinessHeader`, `GallerySection`, `ReviewsSection`, `ReviewsList`.
- [x] Inconsistent API error shapes — `server/utils/apiError.js` provides `sendError()`, `sendValidationError()`, `sendSuccess()` for new and updated routes.
- [x] Skills lookup pagination — lookup endpoint now public; supports `limit` (max 100) + `offset`.
- [x] Dynamic meta/og tags — `PageMeta.jsx` + `react-helmet-async`; applied to 8 pages.
- [x] Didit webhook signature verification — already implemented.

---

## Completed Work (Audit Items)

All production-readiness audit items have been completed. Items are documented in the "Production-Readiness Audit" section above.

**Full list — all done:**
1. Logger migration (5 highest-traffic controllers fully migrated; ~150 calls remain in 21 lower-priority files — cosmetic, not blocking)
2. Test suite — 89 tests across 9 files, all passing
3. Admin panel — dispute resolution, user detail normalization, revenue endpoints
4. Error boundaries per-route
5. Accessibility pass (forms + modals; keyboard trap deferred)
6. Notification preferences UI
7. Helper onboarding completeness
8. Vite bundle analysis (documented; lazy-loading recharts deferred)
9. PWA / service worker
10. Referral system
11. Didit integration test

### Session — 2026-04-09 (unified Life Pulse engine)

**Unified Life Pulse engine** — `GET /api/life/pulse?window=X`:

- **Controller** `server/controllers/lifePulseController.js`: single engine that powers both pages. Queries last 90 days of `expenses` + settled `payments` (OxSteed job income). Normalizes everything to a selected future horizon (`1w/2w/1m/3m/6m/1y/5y/10y`). Returns: `pulse_score` (0–100), `score_breakdown` (coverage/buffer/reliability/obligations), `projected_income`, `projected_fixed_expenses`, `sinking_fund_for_window`, `net_available`, `coverage_ratio`, `runway_months`, `income_reliability`, `auto_publishing_in_window`, per-need sinking fund breakdown, `shortfall_warnings`, and `alerts` (plain-language, e.g. "You'll be short by $800 for your June roof repair.").
- **Score formula**: coverage×0.40 + buffer×0.25 + reliability×0.20 + obligations×0.15. Coverage based on forward-looking ratio over selected horizon; buffer on 90-day cumulative net as runway proxy; reliability on last-30d vs prior-60d income drop; obligations on avg funding % of active planned needs.
- **Route** `server/routes/lifeDashboard.js`: `GET /pulse` added, served before all existing routes.
- **Hook** `client/src/hooks/useLifeDashboard.js`: `fetchFinancialPulse(window)` + `financialPulse` state added and exported.
- **Dashboard** `client/src/pages/Dashboard.jsx`: Life Pulse widget updated — fetches `/life/pulse?window=1m` on init, shows forward-looking financial score with coverage/buffer/reliability/obligations breakdown and inline alerts. Score ring color adapts (green/orange/yellow/red by threshold). Old goals/home/activity breakdown removed from this widget (those data points are still shown as their own cards on the page).
- **PlannedNeedsPage** `client/src/pages/PlannedNeedsPage.jsx`: projection now fetches `/life/pulse` instead of `/planned-needs/projection`; default window changed from `1m` → `3m`; pulse score ring + breakdown row added above the metrics grid; alerts panel rendered below the grid. CSS added to `PlannedNeedsPage.css` (`.pn-pulse-score-row`, `.pn-pulse-ring`, `.pn-pulse-bd`, `.pn-alerts`, `.pn-alert-item`).
- **Backward compatibility**: `/api/planned-needs/projection` still exists (unchanged). All existing `projection.*` field names are preserved in the new response.

**Key design decisions:**
- Runway uses 90-day cumulative net as a buffer proxy (no dedicated savings-balance column exists).
- OxSteed job income (`payments.helper_payout` where `status IN ('captured','released')`) is merged into the income baseline so helpers who earn through the platform don't appear cash-poor.
- Shortfall alerts are only emitted for needs due within 2× the selected window to avoid noisy far-future warnings.
- The old `getDashboardSummary` pulse score (goals/home/activity composite) is still returned by `/api/life/summary` and is unchanged — the new engine is a separate, additive financial-health layer.

### Session — 2026-04-09 (recurring frequency + budget period support)

**Migration** `server/migrations/047_recurring_frequency.sql`:
- `expenses`: added `frequency` (one_time/daily/weekly/bi_weekly/monthly/quarterly/yearly), `is_recurring` bool, `recurring_start_date`, `recurring_end_date`.
- `home_tasks`: added `frequency`, `is_recurring`, `estimated_cost` (for personal_care/car_care financial integration), `recurring_start_date`, `recurring_end_date`.
- `budget_categories`: added `period` (daily/weekly/bi_weekly/monthly/quarterly/yearly, default monthly). `monthly_limit` always stores the monthly-normalized value.

**`server/controllers/lifeDashboardController.js`**:
- `createExpense` / `updateExpense`: accept + persist all new frequency/recurring fields.
- `upsertBudget`: accepts `period_amount` + `period`; normalizes to `monthly_limit` via `PERIOD_TO_MONTHLY` map. Legacy `monthly_limit` field still accepted for backward compat.
- `createHomeTask` / `updateHomeTask`: accept + persist frequency, is_recurring, estimated_cost, start/end dates. Derives `recurrence_days` from named `frequency` for backward compat.

**`server/controllers/lifePulseController.js`**:
- Baseline query split into **non-recurring** (90-day sum ÷ 90) + **recurring** (most-recent entry per type/category/frequency, normalized to monthly).
- New query for recurring `home_tasks` with `estimated_cost` (personal_care + car_care) — their monthly equivalents are added to the expense baseline.
- Combined formula: `avgDailyIncome = (one_time_90d / 90) + (recurring_monthly / 30)`. Score becomes more accurate for users with annual/quarterly income or expenses that were under-represented with naive averaging.

**`client/src/pages/Dashboard.jsx`**:
- All 4 modals updated: Log Transaction, Personal Care, Car Care, Budget.
- Frequency dropdown (One-time/Daily/Weekly/Bi-weekly/Monthly/Quarterly/Yearly) and Recurring toggle on Money, Personal Care, Car Care.
- Recurring toggle shows optional start/end date inputs.
- Estimated Cost field on Personal Care and Car Care (feeds Life Pulse).
- Budget modal: "Monthly Limit" → "Budget Amount + Period" with inline monthly-equivalent preview.
- Transaction list: frequency badge shown for recurring entries.
- Budget list: period label appended to limit display (e.g., "$100/mo (yearly)").

### Session — 2026-04-09 (admin search engine, permission grants, live messaging)

**Admin search engine (`GET /api/admin/search`):**
- **Controller** `server/controllers/adminSearchController.js`: parallel `ILIKE` queries against `users`, `jobs`, `messages`. Caps at 10 results per type (30 total). Non-blocking fire-and-forget logging to `admin_search_log`. Returns `{query, entity_types, total, results}`.
- **Search audit log** `getSearchLogs()` + `getSearchStats()`: paginated log viewer with admin/query filters; stats with top-10 queries and top-10 searchers over 30 days.
- **Migration** `server/migrations/049_admin_search_and_permissions.sql`: `admin_search_log` table (GIN index on query), `admin_permission_grants` table (JSONB permissions, partial index on active grants).

**Scoped time-limited permission grants:**
- **Controller** `server/controllers/adminPermissionController.js`: 11 PERMISSION_SCOPES (`view_financials`, `export_data`, `manage_settings`, `view_audit_log`, `issue_refunds`, `verify_users`, `delete_users`, `delete_jobs`, `view_search_logs`, `manage_admin_accounts`, `message_users`). CRUD: `listGrants`, `createGrant` (validates scope, future expiry ≤ 1yr, grantee must be role='admin'), `revokeGrant`, `getScopes`, `hasPermission()`.
- **Middleware** `server/middleware/adminAuth.js`: added `requirePermission(scope)` factory — super-admins bypass automatically; regular admins checked against active non-expired non-revoked grants using PostgreSQL `permissions ? $2` JSONB containment.
- **Frontend** `client/src/admin/pages/super/PermissionGrants.jsx`: grant list (active/expired toggle), create-grant modal (admin picker, checkbox permissions, datetime-local expiry, notes), revoke button with confirm.

**Admin→user live messaging (`POST /api/admin/super/users/:userId/message`):**
- **Controller** `server/controllers/superAdminController.js` `sendAdminMessage`: finds or creates a job-less conversation (`job_id IS NULL`, admin as `customer_id`), inserts a `system` type message, emits `new_message` Socket.IO event to target user via `broadcastToUser`, logs to `admin_audit_log`. Max 4000 chars.
- **Frontend** `client/src/admin/pages/super/UserDetail.jsx`: added "Message" button (indigo) in super-admin actions; opens modal with textarea, character counter, send/cancel actions. Disabled for admin accounts.

**Frontend wiring:**
- `AdminLayout.jsx`: search bar in both desktop (top bar below sidebar header) and mobile header; new nav items: "Search" (all admins), "Permissions" + "Search Logs" (super-admin).
- `AdminApp.jsx`: routes `/admin/search`, `/admin/super/search-logs`, `/admin/super/permissions`.
- `AdminSearch.jsx`: search page with type filter toggles (users/jobs/messages), URL-driven (`?q=`), result sections per entity type, empty/loading states.
- `SearchLogs.jsx`: stats bar + top-queries/top-admins tabs + paginated log table with filters.

**Routes added to `server/routes/admin.js`:**
- `GET /admin/search` — all admins
- `GET /admin/super/search-logs` + `/super/search-stats` — `requirePermission('view_search_logs')` (super bypasses)
- `GET /admin/permission-grants` + `GET /admin/permission-scopes` — all admins (admins see own)
- `POST /admin/super/permission-grants` + `DELETE /admin/super/permission-grants/:id` — super-admin only
- `POST /admin/super/users/:userId/message` — super-admin only

### Session — 2026-04-09 (admin dashboard fixes + full support ticket system)

**Admin dashboard fixes (PR #50, merged):**
- "User not found" on super admin user detail — root cause was wrong column names in payments query (`helper_amount_cents`, `helper_id`); fixed to `helper_payout`, `payee_id`
- Mobile responsiveness — added hamburger menu + slide-in overlay sidebar to `AdminLayout.jsx`
- Theme toggle invisible — `ThemeProvider` was missing from `admin/main.jsx`; added wrapper
- Theme toggle no visual effect — admin UI uses hardcoded dark Tailwind classes; added light-mode CSS overrides to `index.css`
- Sidebar remounting — `SidebarContent` as inline component caused React remounts; converted to `renderSidebar()` plain function
- Stripe onboarding wrong source — `connect_accounts` table now joined as authoritative source
- `id_verified` `||` vs `??` — fixed boolean fallback for NOT NULL column

**Support ticket system (migration 046, new files):**
- **DB migration** `server/migrations/046_support_tickets.sql`: `support_tickets` + `support_messages` tables; `support_ticket_number_seq` for human-readable numbers starting at 1001; status workflow constraint (`open→assigned→in_progress→waiting_user→resolved→closed`); source/priority constraints; 6 indexes.
- **Controller** `server/controllers/supportController.js`: public `submitSupportRequest` (creates ticket + first message, emails user, broadcasts to admins room); user auth `getMyTickets/getMyTicket/replyToMyTicket`; admin `listTickets` (with status/priority/assigned/search filters), `getTicketAdmin`, `claimTicket` (super-admin can steal), `unclaimTicket`, `updateStatus` (emails user on resolve), `updatePriority`, `adminReply` (internal notes vs public reply), `getStats`.
- **Socket.IO** `server/services/socketService.js`: added `broadcastToAdmins(event, data)` using `io.to('admins')`. `server/index.js`: socket auth now also fetches `role`, stores as `socket.userRole`; admins/super_admins join `'admins'` room on connect.
- **Routes** `server/routes/support.js`: added `authenticate`-gated user routes (`/my-tickets`, `/my-tickets/:id`, `/my-tickets/:id/reply`). `server/routes/admin.js`: added 8 support ticket admin endpoints under `requireAdmin`.
- **Admin UI** `client/src/admin/pages/SupportTickets.jsx`: two-panel inbox (list left, conversation right); stats bar (open/mine/unassigned); filters (status, priority, assigned); claim/unclaim/take-over buttons; status quick-set; priority dropdown; public reply vs internal note toggle; Cmd+Enter to send; real-time refresh on socket events; mobile-responsive with back navigation.
- **Nav** `AdminLayout.jsx`: "Support Tickets" item with `HeadphonesIcon` added to `REGULAR_NAV`.
- **Router** `AdminApp.jsx`: `/admin/support` route added.
- **SupportWidget** `SupportWidget.jsx`: escalation modal now captures `ticket_number` from API response and displays "Your ticket number is #XXXX" in the success state.

**Key design decisions:**
- Regular admins can only claim unassigned tickets and reply on their own; super-admins can take over any ticket and reply on closed ones.
- `is_internal = true` messages never leave the admin panel (not emailed, not visible to users on `/my-tickets`).
- Auto-claim: if an admin replies to an unassigned ticket, it's automatically assigned to them.
- Status auto-transitions: `open→assigned` on claim; `assigned→in_progress` on first admin reply; `in_progress→waiting_user` on subsequent admin replies; `waiting_user→in_progress` on user reply.
- `first_response_at` is set on first non-internal admin reply (SLA tracking).

### Session — 2026-04-08 (planned needs system, preferred helper integration)

**Planned Needs** — `/planned-needs` page + full backend:

- **DB migration** `041_planned_needs.sql`: `planned_needs` table with status lifecycle (`planned → funding → activating_soon → published → completed / cancelled / regenerated`), lead_time_days, recurrence (fixed/floating), published_job_id FK, reserved_amount for sinking fund tracking.
- **Controller** `server/controllers/plannedNeedsController.js`: full CRUD + `cancelPlannedNeed` + `completePlannedNeed` (triggers auto-regeneration for recurring needs) + `getProjection` (Life Pulse projection engine with sinking fund math: `(cost − reserved) ÷ days_remaining × window_days`).
- **Routes** `server/routes/plannedNeeds.js`: mounted at `/api/planned-needs`.
- **Cron** `server/jobs/plannedNeedsScheduler.js`: daily 6am Eastern. Pass 1: marks `activating_soon` 1 day before lead-time triggers. Pass 2: auto-publishes job posts for needs where `(due_date − lead_time_days) ≤ today`, stores `published_job_id`.
- **getDashboardSummary** updated to include `planned_needs` block: active_count, activating_soon_count, publishing_this_week, total_planned_cost, next_due_date.
- **Frontend** `client/src/pages/PlannedNeedsPage.jsx` + `PlannedNeedsPage.css`: Life Pulse projection panel (8 windows), sinking fund meters per card, auto-publish queue banner, add/edit/cancel/complete modals, floating vs fixed recurrence UX.
- **Router**: `/planned-needs` protected route in `App.jsx` — was incorrectly set to `<Navigate to="/dashboard">` (PlannedNeedsPage was never imported); fixed to render `PlannedNeedsPage` properly.

**Key logic notes:**
- Recurrence: `floating` → next due = completion_date + interval_days; `fixed` → next due = original due_date + interval_days.
- Auto-publish creates a minimal job with `metadata.source = 'planned_need'` and `metadata.planned_need_id`.
- Projection formula: income/expense baseline from last 90 days of `expenses` table; sinking fund per need prorated daily.
- Category mapping: `car_care → Auto Repair`, `personal_care → General Labor`, `other → Other / Specify in Description`.
- **Known gap**: `reserved_amount` is manually tracked (no automatic deduction from expenses). A future improvement could auto-increment it when a matching expense is logged.

- **Preferred helper component integration (browser automation session):**

- **QuickAddTemplates** `client/src/components/QuickAddTemplates.jsx`: integrated into PlannedNeedsPage add modal — shows common templates (oil change, dental, HVAC, etc.) for one-click form prefill.
- **PlannedNeedHoldStatus** `client/src/components/PlannedNeedHoldStatus.jsx`: integrated into NeedCard in PlannedNeedsPage — shows 72h countdown timer for preferred helper response, "Broadcast Now" button to skip wait, "Add to Fund" quick-action. Displays for active needs with `preferred_helper_id` and `published` status.
- **HelperOffersCard** `client/src/components/HelperOffersCard.jsx`: integrated into HelperDashboard — shows pending preferred helper offers with accept/decline actions. Appears after trial banner.
- **PreferredHelperBanner** `client/src/components/PreferredHelperBanner.jsx`: integrated into JobDetailPage — shows contextual banner when a job has `held_for_helper_id` set (held for specific helper, broadcasting after timeout, etc.).

### Session — 2026-04-08 (all merged to main)

**Live capture (PostJobPage):**
- Replaced broken `<input capture="...">` approach (mobile-only hint, never worked on desktop) with `LiveCaptureModal` component using real browser APIs
- Photo: `getUserMedia` → live `<video>` viewfinder → `canvas.toBlob()` → `File`
- Video/Audio: `getUserMedia` → `MediaRecorder` with codec detection → chunked Blob → `File`
- Bug fix: black viewfinder — `srcObject` was set before `<video>` element mounted; moved to a `useEffect` that watches `phase` state
- Bug fix: `invalid input syntax for type integer` on job create — `category_id` column is `INTEGER` but frontend uses string slugs; removed `category_id` from FormData, rely on `category_name` only

**Admin expansion:**
- Regular admins can now remove bids (`status='removed'`) and hide reviews (`is_public=false`); reason required; every action logged to `admin_audit_log` (`adminController.js`: `getContent`, `removeBid`, `removeReview`, `restoreReview`)
- Super-admin: `getAdminAccounts`, `createAdminAccount` (min 12-char temp password, bcrypt), `toggleAdminAccountStatus` (invalidates all sessions), `getAdminActivity`, `forceLogout`
- Routes wired in `server/routes/admin.js` under `requireAdmin` and `requireSuperAdmin` guards
- Admin UI: `ContentRemovals.jsx` (bids/reviews tabs, RemoveModal with required reason), `AdminAccounts.jsx` (create, disable/enable, activity drawer, force logout)
- Nav entries added to `AdminLayout.jsx`; routes added to `AdminApp.jsx`

**JobDetailPage redesign (`client/src/pages/JobDetailPage.jsx` + `JobDetailPage.css`):**
- Two-column layout: main content left, sidebar right (budget, location, details, client card, owner actions)
- Budget: correctly handles `open` (→ "Open to bids"), `hourly` (→ `$X/hr`), `fixed` (→ `$X – $Y`)
- Job type: maps raw DB values (`tier1_intro`, `one_time`, etc.) to human labels
- Urgency: colored chip (ASAP=red, This Week=orange, Flexible=green)
- Requirements: parsed from JSON, shown as icon chips with detail (license type, coverage, etc.)
- Media gallery: photo thumbnails with lightbox, inline `<video>` + `<audio>` players
- Bid cards: helper avatar (initials fallback), star rating, jobs-completed count, message quoted
- Cancel job: proper modal instead of `window.prompt()`
- Skeleton loader and "job not found" empty state

**JobListPage — location-based filtering:**
- Added state dropdown (all 50 US states) to search bar
- Auto-defaults to logged-in helper's `user.state` so local jobs show first
- Persists in `localStorage` across sessions; "Showing jobs in [State]" badge with "Show all states" clear link
- Backend `getJobs` already supported `?state=` param — no server change needed

### Security Audit — 2026-04-07 (all fixed)
- **CRITICAL** SQL injection via `sessionDuration` template literal in `login()` — replaced with two hardcoded SQL strings (`authController.js`)
- **CRITICAL** JWT_SECRET minimum length not enforced — added 32-char check to `validateEnv.js`
- **HIGH** OTP generated with `Math.random()` (4 locations) — replaced with `crypto.randomInt()` (`authController.js`)
- **HIGH** IDOR: `getJobPayment` returned any payment by job_id — added payer/payee/admin check (`paymentController.js`)
- **HIGH** Authorization bypass: `refundPayment` allowed any authenticated user to refund — now admin-only (`paymentController.js`)
- **HIGH** `capturePayment` had no ownership check — now verifies `client_id === req.user.id` (`paymentController.js`)
- **MEDIUM** `startRegistration` error leaked `err.message` to client — removed (`authController.js`)
- **MEDIUM** `forgot-password` and `reset-password` had no rate limit — now behind `strictLimiter`; all OTP/register/login/refresh routes now behind `authLimiter` (`routes/auth.js`)
- **MEDIUM** Referral `/validate` (public) had no rate limit — now behind `authLimiter` (`routes/referrals.js`)
- **MEDIUM** File upload validated extension only, not MIME type; 50MB limit — now validates both ext + `file.mimetype`, limit reduced to 10MB (`middleware/upload.js`)
- **MEDIUM** `changePassword` and `resetPassword` only checked `length >= 8` — now use `validate()` with `rules.minLen(8)` + `rules.maxLen(128)` (`authController.js`)
- **MEDIUM** CSP `scriptSrc` included `'unsafe-inline'` — removed; Vite bundle does not emit inline scripts (`middleware/securityHeaders.js`)

---

## Remaining Ops / Deferred Items

These require either an infrastructure action or an architectural decision — no code work pending.





**SSR / pre-rendering** — Pure SPA; `PageMeta.jsx` handles meta at runtime but JS-less crawlers won't see it. Only matters for `/`, `/helpers`, `/helpers/:id`. Options: `vite-plugin-ssr` or migrate public pages to Next.js. Dashboard and auth pages don't need it.

**Logger cleanup** — ~150 `console.*` calls remain in ~21 lower-priority controller files. Pattern: replace `console.error('msg', err)` with `logger.error('msg', { err })`. Do incrementally when touching those files.

---

## Security Audit — Session 2026-04-10 (for next AI session)

> **For the next session:** The primary ongoing task is working through `security.md`. Read that file first — it is the authoritative tracker. Every finding has a status: ⬜ Pending, ✅ Fixed, ⏭ Deferred. Work top-down by severity. When you fix something, mark it ✅ in `security.md` and update the summary table counts. Commit `security.md` changes in the same commit as the code fix.

### What was done in this session (Batch 2 Security Fixes)

We continued the security audit remediation from `security.md` (top-down by severity).

**Fixes applied (see security.md for full detail):**
- **C-01–C-05, C-07**: Verified already fixed in codebase, updated `security.md` statuses to ✅.
- **H-06**: `loginWith2FA` and `validate2FA` now have brute-force lockout logic.
- **H-09**: OTPs are now hashed before database storage in `requestOTP` / `verifyOTP`.
- **H-20**: Verified admin ticket endpoints already have controller-level role verification. Marked ✅.
- **H-28**: Socket.IO room handling explicitly secured; `socket.on('join')` intentionally dropped to prevent arbitrary clients joining 'admins' rooms.
- **H-32**: Replaced `npm install` with `npm ci` in GitHub Actions workflows.
- **H-34**: Documented `trust proxy` configuration in `server/index.js` to ensure proper real IP proxying.
- **M-11/M-12**: Implemented MFA challenge token (`mfaToken`) format tying step 1 to step 2 of login, preventing IDOR and enumeration.
- **M-19**: Verified `getDashboardStats` interpolation uses only internal strings/constants, no user input risk. Marked as deferred (⏭).
- **M-36**: `hashTIN` updated to use `crypto.createHmac` using the application `ENCRYPTION_KEY`.

### What was done in this session (Batch 3 Security Fixes)

We continued the security audit remediation from `security.md` focusing on Encryption and Privacy parameters.

**Fixes applied (see security.md for full detail):**
- **H-33**: Replaced `speakeasy` with `otplib` across `twoFactorController.js` and `authController.js`.
- **H-35**: Encrypted TOTP secrets via symmetric AES-256 (`utils/encryption.js`) during 2FA setup and verify endpoints.
- **H-36**: Hashed TOTP Backup codes using `bcrypt` and handled constant-time comparisons.
- **H-37**: Hashed registration OTP pins inside `pending_registrations` across `authController` and `helperRegistrationController`.
- **H-38**: Hashed refresh tokens prior to storing/querying across all JWT handling operations inside the `sessions` Postgres table.
- **H-39/H-40**: Standardized `hashIP` and strictly enforced its usage across `adminSearchLog`, `two_factor_audit_log`, `w9_records` inserts, and terms acceptance fields.

### Highest-priority remaining findings (pick up here)

These are the next items to tackle in `security.md`, in order:

1. **H-41/H-42**: Investigate failed downstream migrations (e.g. `plans.tier` initialization) and structural database anomalies.
2. **M-01/M-02/M-03/M-05** — Add auth/rate-limiting/raw-body checks to pending endpoints as listed in the tracker.
3. Medium severity vulnerabilities around File Upload parsing (`M-23`, `M-24`).

The full list with file paths, descriptions, and fix guidance is in `security.md`. After fixing any item, mark it ✅ there and update the summary table.

---

## Known Issues / Watch Out For

- **Stripe Connect:** Must be enabled on the live Stripe dashboard (`dashboard.stripe.com/connect`) before Tier 3 direct charges work. This is a dashboard config step, not a code change.
- **`skills_lookup` table:** The `/api/user-skills/lookup` endpoint queries a `skills_lookup` table. This table must be seeded with skill names. Migration `037_skills_and_licenses_lookup.sql` creates it — check that it includes seed data. If it's empty, autocomplete will return no results (non-breaking, just not useful).
- **Socket.IO auth:** The Socket.IO middleware verifies JWTs but does not check `is_active` or `deleted_at` on the user. A deactivated user with a valid (unexpired) token can still connect via WebSocket.
- **`display_name_preference = 'business_name'`:** If a helper sets this but has no `business_name`, the display name falls back to `first_name`. The UI shows an empty string in one place — search for `user?.business_name ||` to audit.
- **`POST /api/auth/logout` requires auth:** If a client's access token has already expired and the refresh fails, the client cannot call logout (gets 401). The session will expire naturally but is not explicitly invalidated. Consider accepting an unauthenticated logout that invalidates by refresh token alone.
- **`jobs.category_id` is unused from frontend:** The DB column is `INTEGER REFERENCES categories(id)` but the frontend uses string slugs (`'electrical-full'`, etc.). PostJobPage intentionally omits `category_id` from the FormData and relies on `category_name` only. If a real categories table with integer IDs is ever added, wire it up in both PostJobPage and jobController.
- **Admin audit log table:** `adminController.js` calls `logAdminAction()` which writes to `admin_audit_log`. Verify this table exists (check migrations). If it's missing, admin removal actions will throw a 500. Add a migration if needed.
- **MediaRecorder MIME on Safari/iOS:** `video/webm` is not supported on Safari. `LiveCaptureModal` falls back to the browser's default MIME via `MediaRecorder.isTypeSupported()` — this works but produces `.webm` files with incorrect extension on Safari (which uses `video/mp4`). The uploaded file will still play but the extension may mismatch. Low priority for now.
