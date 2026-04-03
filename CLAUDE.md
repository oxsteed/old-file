# CLAUDE.md — OxSteed v2 Codebase Guide

This file gives AI coding assistants (Claude, Copilot, etc.) the context needed to work effectively in this repository.

**Last updated:** April 2026 (post production-readiness audit)

---

## Project Overview

**OxSteed** is a national community platform connecting customers with local helpers (service providers) for everyday tasks — yard work, moving help, handyman work, cleaning, and more.

The platform operates on a **hybrid broker/marketplace model**: OxSteed acts as a facilitator, not a direct employer. Helpers are independent contractors. The business is being built for long-term acquisition/sale within ~5 years.

**Live URL:** https://oxsteed.com  
**Repo:** oxsteed/old-file (monorepo — client + server)  
**Stack:** React 18 (Vite) + Node.js/Express + PostgreSQL + Socket.IO + Redis  
**Deployed on:** Hetzner VPS via Docker/Coolify with Cloudflare Tunnel  
**Database:** Local PostgreSQL on the same VPS (Docker network, no SSL needed)  
**Cache/Rate Limiting:** Redis on the same VPS (Docker network)

---

## Monorepo Structure

```
old-file/
├── client/                    # React frontend (Vite)
│   └── src/
│       ├── admin/             # Admin SPA (separate entry: admin.html)
│       ├── api/               # Axios API helpers (with token refresh interceptor)
│       ├── components/        # Shared UI components
│       │   └── helperRegister/ # 7-step helper registration flow
│       ├── context/           # AuthContext (JWT + refresh token management)
│       ├── hooks/             # Custom React hooks
│       ├── lib/               # Utility functions
│       ├── pages/             # Route-level page components
│       └── styles/            # Global CSS
├── server/                    # Node.js/Express backend
│   ├── constants/             # Shared constants (terms version, etc.)
│   ├── controllers/           # Business logic
│   ├── jobs/                  # Cron jobs (weeklySummary)
│   ├── middleware/            # Auth, rate limiting (Redis), sanitization, etc.
│   ├── migrations/            # SQL migration files (run via migrate.js)
│   ├── models/                # DB model helpers
│   ├── routes/                # Express routers
│   ├── services/              # External service wrappers (Stripe, notifications, fees)
│   ├── utils/                 # Encryption, email, SMS, storage, fees
│   ├── db.js                  # pg Pool connection (auto-detects SSL from DATABASE_URL)
│   ├── index.js               # Express entry point (with graceful shutdown)
│   └── migrate.js             # Migration runner (halts on failure)
├── Dockerfile                 # Multi-stage build with healthcheck
├── .dockerignore              # Keeps Docker images lean
└── CLAUDE.md                  # This file
```

---

## Business Model — Three Tiers

| Tier | Name | Who | Fee Model |
|------|------|-----|----------|
| 1 | Free | Customers + free helpers | Job board access only |
| 2 | Basic (paid) | Verified helpers | Subscription + W-9 required |
| 3 | Pro (paid) | Top helpers | Higher subscription, more visibility |

- **W-9 / 1099 compliance** is required for Tier 2/3 helpers earning >$600/yr.
- OxSteed collects TINs (encrypted), stores them in `w9_records`, and issues 1099s at year-end.
- Helpers are **independent contractors** — OxSteed does not withhold taxes.

---

## Key Domain Concepts

- **Helper**: Service provider who lists skills and bids on jobs.
- **Customer**: Posts jobs, reviews bids, hires helpers.
- **Job**: A task posted by a customer with description, zip, budget, and optionally photos.
- **Bid**: A helper's offer on a job (price + message).
- **Escrow**: Optional payment protection (Tier 2/3). Funds held until job complete.
- **Background Check**: Manually confirmed by super_admin. Checkr is a future placeholder only — not integrated.
- **ID Verification**: Handled by **Didit** (didit.me). Webhook mounted at `/api/webhooks/didit`.
- **Badge**: Earned markers shown on helper profiles (verified, pro, reliable, top_helper, background_clear).
- **Subscription**: Managed via Stripe Checkout. Plans map to tiers. After payment, Stripe redirects to `/helper-dashboard?subscribed=true`.

---

## Server Architecture

### Entry Point: `server/index.js`
- Loads middleware in order: security headers (Helmet with CSP) → rate limiting → webhook routes (raw body) → body parsing (1MB limit) → sanitization → API routes.
- Rate limiting uses **Redis store** via `rate-limit-redis` + `ioredis`. Falls back to in-memory if Redis is unavailable.
- CORS supports multiple origins via `CORS_ORIGINS` env var (comma-separated).
- Socket.IO for real-time notifications, authenticated via JWT, same CORS config.
- Cron: `weeklySummary` job runs via `node-cron` (Mondays 8am ET).
- **Graceful shutdown**: Handles SIGTERM/SIGINT — drains HTTP connections, closes Socket.IO, drains DB pool, with a 15s forced-exit timeout.
- **Health check**: `GET /api/health` pings the database and returns 503 if unreachable.
- Fee config is loaded asynchronously after the server starts (not at import time).

### Auth Flow
- JWT access token (15 min TTL) + refresh token (stored in `sessions` table, 7-day TTL).
- Client-side: `api/axios.js` has a **token refresh interceptor** that silently refreshes expired access tokens using the refresh token. Multiple concurrent 401s are queued so only one refresh call fires.
- Middleware: `middleware/auth.js` (generateTokens, authenticate, requireRole, requireTier, requireActiveSubscription).
- Admin: `middleware/adminAuth.js` — exports `requireAdmin` and `requireSuperAdmin`.

### Helper Registration Flow (7-step wizard)
The frontend wizard (`pages/HelperRegister.tsx`) has 7 steps with a fork at step 3:

1. **Account Setup** — email, password (min 8 chars), name, phone, zip.
2. **Email Verification** — 6-digit OTP sent via Resend. On verify, user row is created in `users` table and JWT tokens are returned.
3. **The Fork** — "Continue setup" or "Finish later" (go to dashboard).
4. **Profile & Location** — phone, zip (with city/state lookup), skills (chip selector), bio, optional photo. Saves to `helper_profiles` and `users`.
5. **Choose Plan** — Free or Pro. Saves tier preference to `users.tier_selected` and `users.membership_tier`. Payment is NOT collected here.
6. **Tax Info (W-9)** — Only shown for paid tiers. Collects legal name, TIN (encrypted via AES-256-GCM), address, signature.
7. **Review & Complete** — Accept terms, finalize onboarding (`onboarding_completed = true`).

**Important**: Step 5 saves the tier preference but does NOT collect payment. If a user selects Pro, they arrive at the dashboard with `tier_selected = true` but no active Stripe subscription. The dashboard detects this state and shows a "Complete Pro Upgrade" button that goes directly to Stripe Checkout.

### Encryption
All sensitive field encryption (W-9 TIN and any future fields) uses **`server/utils/encryption.js`**:
- Algorithm: AES-256-GCM
- Key: `process.env.ENCRYPTION_KEY` (64-char hex = 32 bytes)
- Format: `iv:authTag:ciphertext` (all hex)
- Functions: `encrypt(plaintext)`, `decrypt(ciphertext)`, `hashTIN(tin)`, `maskTIN(tin)`
- **Never use inline crypto for TIN.** Always import from `../utils/encryption`.

### Rate Limiting (`server/middleware/rateLimiter.js`)
- Uses `express-rate-limit` with **`rate-limit-redis`** store backed by `ioredis`.
- `REDIS_URL` env var enables Redis store. Falls back to in-memory if Redis is unavailable.
- Three limiters:
  - `generalLimiter`: 100 requests / 15 min per IP (all `/api/` routes)
  - `authLimiter`: 15 requests / 15 min per IP (`/api/auth` routes)
  - `strictLimiter`: 5 requests / 1 hour per IP (account deletion, data export)
- Redis key prefix: `rl:`

### Webhooks (`server/routes/webhook.js`)
- **Stripe** subscription webhook: `POST /api/webhooks/stripe` — uses `express.raw()` for signature verification.
- **Didit** identity webhook: `POST /api/webhooks/didit` — calls `verificationController.identityWebhook`.
- **No Checkr webhook** — background checks are manually confirmed by super_admin.

### Background Checks
- Checkr is a **future placeholder only**. Not integrated. No Checkr API calls.
- Super admin manually approves/rejects background checks via:
  - `POST /api/admin/background-checks/:userId/confirm` — marks passed, awards badge.
  - `POST /api/admin/background-checks/:userId/reject` — marks failed.

### ID Verification (Didit)
- Integration: **Didit v3 API** (https://verify.didit.me / https://api.didit.me)
- App ID: `0b5902a5-5b8e-4414-83b4-327855ad62e1`
- Env vars: `DIDIT_CLIENT_ID`, `DIDIT_CLIENT_SECRET`, `DIDIT_WEBHOOK_SECRET`
- Sessions created server-side, user redirected to Didit hosted flow.
- Webhook: `POST /api/webhooks/didit` receives `status.updated` events.
- On `Approved`: sets `identity_verified = true` on user, awards badge.
- On `Declined`: updates `identity_verifications` status.
- DB table: `identity_verifications` (columns: `user_id`, `didit_session_id`, `status`, `verified_name`, `last_error`, `created_at`, `updated_at`).

### Stripe Integration
- **Controllers** (`webhookController.js`, `subscriptionController.js`) validate `STRIPE_SECRET_KEY` at load time and log errors if missing.
- Checkout success URL: `/helper-dashboard?subscribed=true`
- Checkout cancel URL: `/upgrade?cancelled=true`
- All email notifications use `CLIENT_URL` (not `FRONTEND_URL`) for CTA links.

---

## Database

- **PostgreSQL** (local on same Hetzner VPS, connected via Docker network).
- Connection via `pg` pool (`server/db.js`). SSL is auto-detected from `DATABASE_URL`:
  - If URL contains `sslmode=disable` → `ssl: false` (local Docker setup).
  - Otherwise in production → `ssl: { rejectUnauthorized: true }` (managed DB with proper CA).
- Pool config: max 20 connections, 30s idle timeout, 2s connect timeout.

### Migrations
- Live in `server/migrations/` and run sequentially by `server/migrate.js` on startup.
- **Migration failures halt startup** (`process.exit(1)`) — the app will not run against an inconsistent schema.
- Each migration is tracked in `_migrations` table by filename.
- Migration filenames must have unique numeric prefixes (e.g., `033_add_feature.sql`). Duplicate prefixes cause ordering issues.
- Key tables: `users`, `helper_profiles`, `helper_skills`, `pending_registrations`, `jobs`, `bids`, `subscriptions`, `plans`, `sessions`, `badges`, `background_checks`, `identity_verifications`, `w9_records`, `messages`, `disputes`, `notifications`, `reviews`, `consent_logs`, `audit_logs`, `platform_settings`, `feature_flags`.

### users table key columns
- `role`: `customer` | `helper` | `admin` | `super_admin`
- `tier`: `free` | `basic` | `pro`
- `membership_tier`: `tier1` (free) | `tier2` (pro)
- `tier_selected`: boolean — set during registration when user picks a plan
- `onboarding_completed`: boolean — set when helper finishes all registration steps
- `background_check_status`: `none` | `pending` | `passed` | `failed`
- `identity_verified`: boolean
- `w9_on_file`: boolean
- `subscription_status`: `active` | `cancelled` | `past_due` | `trialing`

### helper_profiles key columns
- `rate_preference`: `per_job` | `hourly` (added by migration 033)
- `profile_headline`: VARCHAR(280) (added by migration 033)
- `tier`: `free` | `pro`
- `bio_long`, `service_city`, `service_state`, `service_zip`, `service_radius_miles`

---

## Environment Variables

See `server/.env.example` for the full list. Critical vars:

```
# Core
DATABASE_URL              # e.g. postgresql://user:pass@postgres:5432/oxsteed?sslmode=disable
JWT_SECRET
ENCRYPTION_KEY            # 64-char hex (32 bytes) — used for ALL encryption
PORT                      # default 5000
NODE_ENV                  # 'production' in prod
CLIENT_URL                # e.g. https://oxsteed.com — used for CORS and email CTAs
APP_URL                   # e.g. https://oxsteed.com — used for Stripe redirect URLs

# CORS (optional — defaults to CLIENT_URL)
CORS_ORIGINS              # Comma-separated origins, e.g. https://oxsteed.com,https://www.oxsteed.com

# Redis (rate limiting + future caching)
REDIS_URL                 # e.g. redis://redis:6379

# Stripe
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET

# Didit (ID Verification)
DIDIT_CLIENT_ID
DIDIT_CLIENT_SECRET
DIDIT_WEBHOOK_SECRET

# AWS S3 (file uploads)
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET

# Twilio (SMS/OTP)
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER

# Resend (email)
RESEND_API_KEY
EMAIL_FROM

# Push notifications (Expo)
EXPO_ACCESS_TOKEN
```

---

## Frontend (client/)

- **Vite** + **React 18** + **React Router v6** + **Tailwind CSS**.
- Two entry points: `index.html` (main SPA) and `admin.html` (admin SPA).
- State: `AuthContext` for user/token management with `refreshUser()` and `refreshSession()`.
- API calls go through `src/api/axios.js`:
  - Attaches Bearer token from localStorage on every request.
  - **Token refresh interceptor**: On 401, silently refreshes the access token using the refresh token and retries the request. Concurrent 401s are queued so only one refresh call fires. If the refresh itself fails, forces logout.
- Admin panel at `/admin/*` — separate SPA, served via `admin.html`.

### Key Routes (App.jsx)
- `/` — HomePage
- `/login` — Login
- `/register/customer` — Customer registration
- `/register/helper` — 7-step helper registration wizard
- `/dashboard` — SmartDashboard (auto-selects customer or helper dashboard by role)
- `/helper-dashboard` — Same as `/dashboard` (alias)
- `/upgrade` — Plan upgrade page
- `/jobs` — Job listing
- `/jobs/:id` — Job detail
- `/post-job` — Post a new job
- `/messages` — Messages
- `/settings` — User settings
- `/disputes` — Dispute center

### HelperDashboard Features
- Detects `?subscribed=true` from Stripe redirect → shows success toast, refreshes auth and subscription state, cleans URL.
- Detects "selected Pro during registration but hasn't paid" state → shows "Complete Pro Upgrade" button that goes directly to Stripe Checkout (no plan reselection needed).
- Onboarding progress checklist for incomplete helpers.
- Pulse score, earnings, bids, verification cards, life dashboard.

---

## Mobile Apps

- `oxsteed/oxsteed-ios` — Swift WebView wrapper for the main SPA.
- `oxsteed/oxsteed-android` — Kotlin WebView wrapper for the main SPA.

---

## Compliance & Legal

- **FCRA**: Background check disclosures required before initiating checks.
- **W-9 / 1099-NEC**: Collected for helpers earning >$600. TIN encrypted at rest with AES-256-GCM.
- **CCPA**: Data export and deletion endpoints in `routes/privacy.js`.
- **Terms of Service**: Versioned (current: `2026-03-27`). Acceptance logged with timestamp, IP, user agent.
- **Consent logs**: All material consent events written to `consent_logs`.

---

## Production Hardening (Applied April 2026)

The following production-readiness changes have been applied:

### Security
- **Rate limiting enforced**: Real limits (100/15/5) backed by Redis via `ioredis` + `rate-limit-redis`. Falls back to in-memory gracefully.
- **Helmet CSP fixed**: Removed dead Checkr domain from `connectSrc`, added Didit domains (`verify.didit.me`, `api.didit.me`). Single `helmet()` call (no duplicate).
- **Body size limits**: `express.json()` and `express.urlencoded()` capped at 1MB.
- **Password validation**: Minimum 8 characters enforced on both customer and helper registration.
- **Stripe key guards**: `webhookController.js` and `subscriptionController.js` log errors at startup if `STRIPE_SECRET_KEY` is missing.

### Reliability
- **Graceful shutdown**: SIGTERM/SIGINT handlers drain HTTP, Socket.IO, and DB connections. 15s forced-exit timeout.
- **Migration failure halts startup**: `migrate.js` calls `process.exit(1)` on any migration failure instead of continuing.
- **Health check pings DB**: `GET /api/health` runs `SELECT 1` and returns 503 if the database is unreachable.
- **Fee config loaded safely**: `feeService.reloadFeeConfig()` is called from `index.js` after server startup, not at module import time.

### Bug Fixes
- **"Profile failed to save"**: Migration `033_add_missing_helper_profile_columns.sql` adds `rate_preference` and `profile_headline` columns to `helper_profiles`. These were missing because migration 019 used `CREATE TABLE IF NOT EXISTS` which was silently skipped since migration 001 already created the table.
- **404 after Stripe payment**: Stripe checkout `success_url` changed from `/dashboard/helper` (non-existent route) to `/helper-dashboard`.
- **Pro plan reselection**: Dashboard now detects `tier_selected + membership_tier=tier2 + no subscription` and shows a direct "Complete Pro Upgrade" button instead of sending users back to the plan picker.
- **Didit webhook not mounted**: `POST /api/webhooks/didit` now routes to `verificationController.identityWebhook`. Dead Checkr placeholder removed.
- **Email CTA links broken**: Replaced `FRONTEND_URL` (undefined) with `CLIENT_URL` in `notificationService.js`.
- **Duplicate migration prefix**: Renamed `026_fix_auth_schema.sql` to `026b_fix_auth_schema.sql` (idempotent, safe to re-run).

### Infrastructure
- **Dockerfile**: CMD now runs `migrate.js` before `index.js`. Added `HEALTHCHECK` directive.
- **`.dockerignore`**: Excludes `node_modules`, `.git`, `.env`, `*.md`, `.github`.
- **Multi-origin CORS**: Both Express CORS and Socket.IO read from `CORS_ORIGINS` env var (comma-separated).
- **SSL auto-detection**: `db.js` reads `sslmode=disable` from `DATABASE_URL` and sets `ssl: false` for local Docker PostgreSQL.

### Client
- **Token refresh interceptor** (`api/axios.js`): Silently refreshes expired access tokens on 401. Queues concurrent requests during refresh. Forces logout if refresh fails.
- **Post-subscribe flow**: Dashboard handles `?subscribed=true` query param — shows toast, refreshes auth/subscription state, cleans URL.

---

## Coding Conventions

- **No `axios` in server code** except where already used (verificationController). Prefer `node-fetch` or native `https`.
- **Always use `../utils/encryption`** for any field-level encryption — never inline crypto.
- **Error handling**: All route handlers wrapped in try/catch, return structured JSON errors.
- **Logging**: `console.error` for errors, `console.log` for significant events. Prefixed with `[Module]` for key services (e.g., `[RateLimit]`, `[Shutdown]`, `[Stripe]`).
- **DB queries**: Raw SQL via `pool.query()`. Parameterized queries only — never string interpolation.
- **Auth**: Use `authenticate` middleware (from `middleware/auth.js`) for user routes. Use `requireAdmin` / `requireSuperAdmin` (from `middleware/adminAuth.js`) for admin routes.
- **Migrations**: Add new SQL files to `server/migrations/` with a unique numeric prefix (e.g., `034_add_feature.sql`). They run in order on startup. **Failures halt startup.** Use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for idempotency.
- **Env var naming**: Use `CLIENT_URL` for frontend URLs everywhere. Do **not** use `FRONTEND_URL` (legacy, removed).
- **Password requirements**: Minimum 8 characters. Enforced on both `/api/auth/register` and `/api/helper-registration/start`.

---

## Common Commands

```bash
# Development (from server/)
npm run dev          # nodemon index.js
npm run migrate      # node migrate.js

# Development (from client/)
npm run dev          # vite dev server
npm run build        # production build to client/dist/

# Docker (from repo root)
docker build -t oxsteed .
docker run -p 5000:5000 --env-file .env oxsteed

# The Dockerfile runs migrations automatically before starting the server.
# Equivalent to: node migrate.js && node index.js
```

---

## Important Notes for AI Assistants

1. **Checkr is NOT active** — do not generate Checkr API calls. Background checks are manually approved by super_admin.
2. **Stripe Identity is REMOVED** — ID verification is Didit only. The Didit webhook is mounted at `POST /api/webhooks/didit`.
3. **TIN encryption** must use `encrypt()`/`decrypt()` from `server/utils/encryption.js`, keyed from `ENCRYPTION_KEY`.
4. **Rate limiter** uses Redis (`rate-limit-redis` + `ioredis`). Do not revert to in-memory store. Real limits: 100/15/5.
5. **The repo is named `old-file`** for legacy reasons — it is the active, current production codebase.
6. Do not add `stripe.identity` calls anywhere — Didit handles all identity verification.
7. The `pending_registrations` table uses a `token` field as the primary lookup key during helper onboarding — it is NOT the user's JWT.
8. **Use `CLIENT_URL` everywhere** — never `FRONTEND_URL`. All email CTA links, Stripe redirects, and CORS origins use `CLIENT_URL` or `APP_URL`.
9. **Migration failures are fatal** — `migrate.js` exits with code 1 on any failure. Do not change this behavior.
10. **Stripe redirects** after payment go to `/helper-dashboard?subscribed=true`. Do not change this to `/dashboard/helper` or any other path.
11. **The `helper_profiles` table** was created by migration 001 and patched by migration 033. Columns `rate_preference` and `profile_headline` exist. Do not re-add them.
12. **Database is local** — PostgreSQL runs on the same Hetzner VPS via Docker. `DATABASE_URL` uses `sslmode=disable`. SSL is not needed for local Docker networking.
13. **Next migration number**: 034.
