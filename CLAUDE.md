# CLAUDE.md — OxSteed v2 Codebase Guide

This file gives AI coding assistants (Claude, Copilot, etc.) the context needed to work effectively in this repository.

---

## Project Overview

**OxSteed** is a national community platform connecting customers with local helpers (service providers) for everyday tasks — yard work, moving help, handyman work, cleaning, and more.

The platform operates on a **hybrid broker/marketplace model**: OxSteed acts as a facilitator, not a direct employer. Helpers are independent contractors. The business is being built for long-term acquisition/sale within ~5 years.

**Live URL:** https://oxsteed.com  
**Repo:** oxsteed/old-file (monorepo — client + server)  
**Stack:** React (Vite) + Node.js/Express + PostgreSQL + Socket.IO  
**Deployed on:** Hetzner VPS (oxsteed-v2), served via Docker  

---

## Monorepo Structure

```
old-file/
├── client/                    # React frontend (Vite)
│   └── src/
│       ├── admin/             # Admin SPA (separate entry: admin.html)
│       ├── api/               # Axios API helpers
│       ├── components/        # Shared UI components
│       │   └── helperRegister/ # 7-step helper registration flow
│       ├── context/           # AuthContext, etc.
│       ├── hooks/             # Custom React hooks
│       ├── lib/               # Utility functions
│       ├── pages/             # Route-level page components
│       └── styles/            # Global CSS
├── server/                    # Node.js/Express backend
│   ├── constants/             # Shared constants (terms version, etc.)
│   ├── controllers/           # Business logic
│   ├── jobs/                  # Cron jobs (weeklySummary)
│   ├── middleware/            # Auth, rate limiting, sanitization, etc.
│   ├── migrations/            # SQL migration files (run via migrate.js)
│   ├── models/                # (reserved for future ORM use)
│   ├── routes/                # Express routers
│   ├── services/              # External service wrappers
│   ├── utils/                 # Encryption, email, SMS, storage, fees
│   ├── db.js                  # pg Pool connection
│   ├── index.js               # Express entry point
│   └── migrate.js             # Migration runner
├── Dockerfile
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
- **Background Check**: Manually confirmed by super_admin (Checkr is a future integration placeholder).
- **ID Verification**: Handled by **Didit** (didit.me) — replaces Stripe Identity.
- **Badge**: Earned markers shown on helper profiles (verified, pro, reliable, top_helper, background_clear).
- **Subscription**: Managed via Stripe. Three plans map to tiers.

---

## Server Architecture

### Entry Point: `server/index.js`
- Loads middleware in order: security headers → rate limiting → webhook routes (raw body) → body parsing → sanitization → API routes.
- Rate limiting uses **Redis store** via `rate-limit-redis` + `ioredis`.
- Socket.IO for real-time notifications, authenticated via JWT.
- Cron: `weeklySummary` job runs via `node-cron`.

### Auth Flow
- JWT access token (short-lived) + refresh token (stored in `sessions` table, 7-day TTL).
- Middleware: `middleware/auth.js` (generateTokens) and `middleware/authenticate.js` (verify on protected routes).
- Admin: `middleware/adminAuth.js` — exports `requireAdmin` (role: admin or super_admin) and `requireSuperAdmin` (role: super_admin only).

### Helper Registration Flow (5-step)
1. Basic info → creates `pending_registrations` record with token.
2. Email OTP verification.
3. Helper profile (categories, bio, radius, rate).
4. Tier selection → W-9 submission (Tier 2/3 only).
5. Terms acceptance → finalize (creates `users` + `helper_profiles` + commits `w9_records`).

### Encryption
All sensitive field encryption (W-9 TIN and any future fields) uses **`server/utils/encryption.js`**:
- Algorithm: AES-256-GCM
- Key: `process.env.ENCRYPTION_KEY` (64-char hex = 32 bytes)
- Format: `iv:authTag:ciphertext` (all hex)
- Functions: `encrypt(plaintext)`, `decrypt(ciphertext)`, `hashTIN(tin)`, `maskTIN(tin)`
- **Never use inline crypto for TIN.** Always import from `../utils/encryption`.

### Rate Limiting (`server/middleware/rateLimiter.js`)
- Uses `express-rate-limit` with **`rate-limit-redis`** store backed by `ioredis`.
- `REDIS_URL` env var required in production.
- Falls back gracefully if Redis is unavailable (logs warning).
- Three limiters: `generalLimiter` (100/15min), `authLimiter` (10/15min), `strictLimiter` (5/hr).

### Webhooks (`server/routes/webhook.js`)
- Stripe subscription webhook: `/api/webhooks/stripe` — verifies Stripe signature.
- Didit identity webhook: `/api/webhooks/didit` — verifies HMAC X-Signature + X-Timestamp.
- **No Checkr webhook** — background checks are manually confirmed by super_admin via admin panel.

### Background Checks
- Checkr is a **future placeholder only**. Not integrated.
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

---

## Database

- **PostgreSQL** via `pg` pool (`server/db.js`).
- Migrations live in `server/migrations/` and are run sequentially by `server/migrate.js` on startup.
- Key tables: `users`, `helper_profiles`, `helper_skills`, `pending_registrations`, `jobs`, `bids`, `subscriptions`, `plans`, `sessions`, `badges`, `background_checks`, `identity_verifications`, `w9_records`, `messages`, `disputes`, `notifications`, `reviews`, `consent_logs`, `audit_logs`.

### users table key columns
- `role`: `customer` | `helper` | `admin` | `super_admin`
- `tier`: `free` | `basic` | `pro`
- `background_check_status`: `none` | `pending` | `passed` | `failed`
- `identity_verified`: boolean
- `w9_on_file`: boolean
- `subscription_status`: `active` | `cancelled` | `past_due` | `trialing`

---

## Environment Variables

See `server/.env.example` for the full list. Critical vars:

```
# Core
DATABASE_URL
JWT_SECRET
ENCRYPTION_KEY          # 64-char hex (32 bytes) — used for ALL encryption
PORT
NODE_ENV
CLIENT_URL
APP_URL

# Redis (rate limiting)
REDIS_URL               # e.g. redis://localhost:6379

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

- **Vite** + **React** + **React Router v6**.
- Two entry points: `index.html` (main SPA) and `admin.html` (admin SPA).
- State: `AuthContext` for user/token management.
- API calls go through `src/api/` wrappers (axios with auth header injection).
- Admin panel at `/admin/*` — separate SPA, served via `admin.html`.

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

## Coding Conventions

- **No `axios` in server code** except where already used (verificationController). Prefer `node-fetch` or native `https`.
- **Always use `../utils/encryption`** for any field-level encryption — never inline crypto.
- **Error handling**: All route handlers wrapped in try/catch, return structured JSON errors.
- **Logging**: `console.error` for errors, `console.log` for significant events. No external logging service yet.
- **DB queries**: Raw SQL via `pool.query()`. Parameterized queries only — never string interpolation.
- **Auth**: Use `authenticate` middleware (from `middleware/authenticate.js`) for user routes. Use `requireAdmin` / `requireSuperAdmin` (from `middleware/adminAuth.js`) for admin routes.
- **Migrations**: Add new SQL files to `server/migrations/` with a numeric prefix (e.g., `022_add_feature.sql`). They run in order on startup.

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
```

---

## Important Notes for AI Assistants

1. **Checkr is NOT active** — do not generate Checkr API calls. Background checks are manually approved by super_admin.
2. **Stripe Identity is REMOVED** — ID verification is Didit only.
3. **TIN encryption** must use `encrypt()`/`decrypt()` from `server/utils/encryption.js`, keyed from `ENCRYPTION_KEY`.
4. **Rate limiter** uses Redis (`rate-limit-redis` + `ioredis`). Do not revert to in-memory store.
5. **The repo is named `old-file`** for legacy reasons — it is the active, current production codebase.
6. Do not add `stripe.identity` calls anywhere — Didit handles all identity verification.
7. The `pending_registrations` table uses a `token` field as the primary lookup key during helper onboarding — it is NOT the user's JWT.
