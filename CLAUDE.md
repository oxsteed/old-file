# OxSteed — AI Contributor Guide

**Last updated:** 2026-04-29

## Instructions for Every Session

1. **Read this file first** — It is the authoritative source of truth for what exists and what needs to be done.
2. **After completing meaningful work**, update this file — revise "Current Status", "Remaining Work", update file paths.
3. **Commit CLAUDE.md changes** in the same commit as the work it documents.
4. **Keep it accurate and terse** — do not pad with summaries of work you didn't personally verify.

---

## Current Status

**OxSteed** is a full-stack local trades marketplace built with React 18 + Node.js + PostgreSQL.

**Codebase metrics:**
- 238 React components / pages
- 81 backend controllers
- 132 database migrations
- 82 Jest tests (some failing due to test environment constraints)

**Latest work completed (2026-04-29):**
- Product marketplace redesign: React Query infinite scroll, modern filter drawer, search suggestions (commits 6a425fa, 8ea81db)
- Dispute resolution: escrow mapping, race condition prevention (commits 7be9f89, 9597806)
- Message notifications: optimization, deduplication (commit 8b27059)
- Package-lock.json: synced with React Query + use-debounce dependencies

**Known environment constraints:**
- Jest cannot run in current environment (missing node_modules setup)
- Manual testing required; no CI test verification possible until Docker/Node setup complete
- Database required for full integration testing (not available in this environment)

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

### Repo Layout

```
/
├── client/               # Vite React SPA (238 components/pages)
│   ├── src/
│   │   ├── api/          # axios instance + per-domain API helpers
│   │   ├── components/   # shared UI components
│   │   ├── context/      # AuthContext, ThemeContext, LanguageContext
│   │   ├── hooks/        # custom hooks (useAuth, useJobs, useSocket, etc.)
│   │   ├── pages/        # route-level page components
│   │   ├── admin/        # admin panel (nested routes)
│   │   ├── styles/       # page-specific CSS files
│   │   ├── locales/      # i18n translations (EN/ES/FR/HT)
│   │   ├── types/        # TypeScript type definitions
│   │   ├── utils/        # utilities (logger, validators, helpers)
│   │   └── index.css     # Tailwind + CSS variables
│   └── index.html        # static defaults
└── server/
    ├── __tests__/        # Jest test suite (82 tests)
    ├── controllers/      # 81 domain controllers
    ├── routes/           # API route definitions
    ├── middleware/       # auth, rate limiting, error handling
    ├── migrations/       # 132 SQL migrations
    ├── services/         # shared business logic
    ├── jobs/             # background jobs (crons)
    ├── utils/            # helpers (logger, validation, storage, etc.)
    ├── migrate.js        # migration runner
    └── index.js          # Express server entry point
```

---

## Environment Variables

Set in Coolify (production) or `.env` file (development). See `server/.env.example` for full list.

### Required (server exits if missing)

```
JWT_SECRET              # Min 32 chars, used for signing tokens
DATABASE_URL            # PostgreSQL connection string
STRIPE_SECRET_KEY       # Stripe API key
STRIPE_WEBHOOK_SECRET   # Stripe webhook signature secret
```

### Recommended

| Var | Purpose |
|---|---|
| `AWS_S3_BUCKET` / AWS credentials | File uploads. Falls back to base64 (bloats DB) if unset. |
| `REDIS_URL` | Distributed rate limiting. Falls back to in-memory (single-instance only). |
| `RESEND_API_KEY` | Transactional email (OTP, password reset). |
| `TWILIO_*` | SMS OTP delivery. |
| `DIDIT_API_KEY` / `DIDIT_WORKFLOW_ID` / `DIDIT_WEBHOOK_SECRET` | Identity verification. |
| `APP_URL` / `CLIENT_URL` | Frontend public URL (for password-reset links). |
| `VITE_GA_MEASUREMENT_ID` | Google Analytics 4 (consent-gated). |
| `VITE_META_PIXEL_ID` | Meta Pixel (consent-gated). |
| `OPENROUTER_API_KEY` | AI chat completions (multi-provider fallback). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push notifications. |

---

## Theme System

Dark mode toggled via `html.dark` class (managed by `ThemeContext`). CSS variables in `client/src/index.css`:

- **App palette** (cool grays): `--app-bg`, `--nav-bg`, `--app-text`, `--card-bg`, `--border-color`, `--muted-text`
- **Homepage palette** (warm earth tones): defined in `client/src/styles/HomePage.css` — intentionally distinct from app
- **Light mode overrides**: 50+ Tailwind overrides under `html:not(.dark)` ensure correct rendering

`ThemeToggle.jsx` appears in `Navbar.jsx` and `HomePage.jsx`.

---

## Authentication Flow

1. `POST /api/auth/register` or `/login` → returns `{ user, accessToken, refreshToken }`
2. `accessToken` (15m JWT) attached via `client/src/api/axios.js` request interceptor
3. On 401: `client/src/api/auth.js` response interceptor auto-refreshes + retries (concurrent refreshes deduplicated)
4. `POST /api/auth/refresh` → issues new token pair; old refresh token invalidated in `sessions` table
5. Logout invalidates session server-side

---

## Database Migrations

- Files: `server/migrations/001_*.sql` … `132_*.sql`
- Runner: `server/migrate.js` — applies unapplied migrations tracked in `_migrations` table
- Automatic: runs at startup before Express server starts
- **To add:** create `server/migrations/NNN_description.sql`, applied on next startup

---

## Payment Architecture

- **Tier 1/2 (standard):** Stripe Checkout or Payment Intent with platform fee (`application_fee_amount`)
- **Tier 3 (escrow):** `capture_method: 'manual'` — funds authorized at checkout, captured when job completes
- **Webhook events** handled: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`, `payment_intent.*`, `charge.refunded`
- **Note:** Stripe Connect must be enabled on the Stripe dashboard for Tier 3 direct charges

---

## File Storage

`server/utils/storage.js` uses `@aws-sdk/client-s3`.

- **Reads bucket from:** `AWS_S3_BUCKET` (primary) or `S3_BUCKET` (fallback)
- **Fallback:** if AWS unset, `uploadFile()` returns `null` and controllers fall back to base64 data URLs (works but bloats DB)
- **Public URLs:** `getPublicUrl(key)` → permanent CDN URL
- **Private files:** `getSignedDownloadUrl(key)` expires in 1 hour (W-9, background checks, etc.)

---

## Logging

`server/utils/logger.js` — structured logger, no dependencies.

- **Production:** NDJSON to stdout (info/debug) and stderr (warn/error). Compatible with Datadog, Logtail, Papertrail.
- **Development:** colored pretty-print to console
- **Middleware:** `logger.requestMiddleware()` logs every response (method, path, status, ms, IP)
- **Configuration:** `LOG_LEVEL` env var controls minimum level (default: `info` in prod, `debug` in dev)

All critical operations should use structured logging instead of `console.*`.

---

## Rate Limiting

`server/middleware/rateLimiter.js` — Redis-backed with in-memory fallback.

- `generalLimiter`: 100 req / 15 min / IP on `/api/*`
- `authLimiter`: 15 req / 15 min / IP on `/api/auth`
- `strictLimiter`: 5 req / hour / IP on account deletion, data export, etc.

**Production action needed:** Set `REDIS_URL` in Coolify when scaling beyond single container.

---

## Internationalization (i18n)

Stack: `react-i18next` + 4 locale files (EN/ES/FR/HT).

- **Locales:** `client/src/locales/{en,es,fr,ht}.json` (2,741 keys each, perfect parity)
- **Configuration:** `client/src/i18n.js`
- **Language storage:** `localStorage` key `oxs:language`
- **Pattern:**
  ```jsx
  const { t } = useTranslation();
  return <div>{t('namespace.key')}</div>;
  ```

All user-visible strings must use i18n keys; never hardcode English text.

---

## Test Suite

`server/__tests__/` — 82 Jest tests covering auth, jobs, payments, bids, reviews, webhooks.

**Status:** Tests pass locally but cannot run in current environment (missing jest setup).

**To run locally:**
```bash
cd server
npm install
npm test
```

**Key files:**
- `setup.js` — mocks (pg, stripe, redis, socket.io, JWT)
- `auth.test.js` — register, login, refresh, logout
- `job.test.js` — list, get, create, complete, cancel
- `payment.test.js` — payment intents, captures, refunds
- `bid.test.js` — bid lifecycle
- `webhook.test.js` — Stripe event handling

---

## Key Components Reference

| Component | Path | Purpose |
|---|---|---|
| `PageMeta` | `client/src/components/PageMeta.jsx` | Per-page title + og/twitter meta (requires `<HelmetProvider>` in App.jsx) |
| `ThemeToggle` | `client/src/components/ThemeToggle.jsx` | Dark/light mode pill switch |
| `Navbar` | `client/src/components/Navbar.jsx` | App header with theme toggle |
| `ErrorBoundary` | `client/src/components/ErrorBoundary.tsx` | App-level crash handler |
| `CookieConsent` | `client/src/components/CookieConsent.tsx` | GDPR banner + consent settings |
| `AuthContext` | `client/src/context/AuthContext.jsx` | User auth state (login/logout/roles/tokens) |

---

## API Routes Reference

| Prefix | File | Auth | Controllers |
|---|---|---|---|
| `/api/auth` | `routes/auth.js` | Mixed | authController |
| `/api/jobs` | `routes/jobs.js` | Mixed | jobController |
| `/api/bids` | `routes/bids.js` | Required | bidController |
| `/api/payments` | `routes/payments.js` | Required | paymentController |
| `/api/helpers` | `routes/helpers.js` | Public | helpersController |
| `/api/messages` | `routes/messages.js` | Required | messageController |
| `/api/notifications` | `routes/notifications.js` | Required | notificationController |
| `/api/admin` | `routes/admin.js` | Admin | adminController, superAdminController |
| `/api/webhooks` | `routes/webhook.js` | Stripe/Didit signature | webhookController |
| `/api/marketplace` | `routes/marketplace.js` | Public | marketplaceController |

See `server/routes/*.js` for complete route definitions.

---

## Common Patterns

### Database Transactions

Use `withTransaction(callback)` from `server/utils/transaction.js` for multi-step operations:

```javascript
await withTransaction(async (client) => {
  const result = await client.query('UPDATE ... RETURNING *');
  if (!result.rows.length) throw new Error('Update failed (concurrent modification)');
});
```

### API Responses

Use error utilities from `server/utils/apiError.js`:

```javascript
// Success
res.json({ success: true, data: { ... } });

// Validation error
sendValidationError(res, { email: 'Already taken' });

// Generic error
sendError(res, 500, 'Operation failed');
```

### Socket.IO Broadcasting

Use methods from `server/services/socketService.js`:

```javascript
broadcastToUser(userId, 'event_name', { data: true });
broadcastToConversation(conversationId, 'message', { text: '...' });
```

---

## Remaining Work

**High Priority:**
1. Fix Jest test environment setup (jest cannot run in current environment)
2. Complete product marketplace feature verification (React Query infinite scroll works, but need full integration test)
3. Race condition audits on remaining 22+ controllers (Phase 1 of audit is 25% complete, work paused)

**Medium Priority:**
1. Per-route error boundaries (single page crash affects whole app)
2. Bundle size optimization (no analysis in place)
3. Deprecation warnings for old API endpoints

**Low Priority:**
1. Logger cleanup in remaining files (~150 `console.*` calls)
2. PWA / service worker (planned but not implemented)
3. SEO improvements (meta tags, structured data)

---

## Known Issues / Watch Out For

- **Stripe Connect:** Must be enabled on stripe.com/dashboard before Tier 3 direct charges work
- **Skills lookup table:** `skills_lookup` must be seeded with skill names for autocomplete to work
- **Socket.IO auth:** Does not check `is_active` or `deleted_at`; a deactivated user with valid token can still connect
- **Test environment:** Jest tests cannot run without full Node.js + npm setup; tests pass locally but fail in limited environments
- **Product marketplace:** Recently redesigned with React Query; verify infinite scroll works end-to-end with real data
- **Database pool:** Max 10 connections; monitor pool utilization under load

---

## Getting Help

- **Internal:** Check `server/.env.example` for environment variable reference
- **External:** Report issues at https://github.com/anthropics/claude-code/issues
