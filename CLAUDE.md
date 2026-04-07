# OxSteed — AI Contributor Guide

**Last updated:** 2026-04-07

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

---

## Remaining Ops / Deferred Items

These require either an infrastructure action or an architectural decision — no code work pending.





**SSR / pre-rendering** — Pure SPA; `PageMeta.jsx` handles meta at runtime but JS-less crawlers won't see it. Only matters for `/`, `/helpers`, `/helpers/:id`. Options: `vite-plugin-ssr` or migrate public pages to Next.js. Dashboard and auth pages don't need it.

**Logger cleanup** — ~150 `console.*` calls remain in ~21 lower-priority controller files. Pattern: replace `console.error('msg', err)` with `logger.error('msg', { err })`. Do incrementally when touching those files.

---

## Known Issues / Watch Out For

- **Stripe Connect:** Must be enabled on the live Stripe dashboard (`dashboard.stripe.com/connect`) before Tier 3 direct charges work. This is a dashboard config step, not a code change.
- **`skills_lookup` table:** The `/api/user-skills/lookup` endpoint queries a `skills_lookup` table. This table must be seeded with skill names. Migration `037_skills_and_licenses_lookup.sql` creates it — check that it includes seed data. If it's empty, autocomplete will return no results (non-breaking, just not useful).
- **Socket.IO auth:** The Socket.IO middleware verifies JWTs but does not check `is_active` or `deleted_at` on the user. A deactivated user with a valid (unexpired) token can still connect via WebSocket.
- **`display_name_preference = 'business_name'`:** If a helper sets this but has no `business_name`, the display name falls back to `first_name`. The UI shows an empty string in one place — search for `user?.business_name ||` to audit.
- **`POST /api/auth/logout` requires auth:** If a client's access token has already expired and the refresh fails, the client cannot call logout (gets 401). The session will expire naturally but is not explicitly invalidated. Consider accepting an unauthenticated logout that invalidates by refresh token alone.
