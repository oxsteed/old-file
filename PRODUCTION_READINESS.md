# OxSteed Production Readiness (Real Users Testing)

This checklist is for “real users” beta testing on **production backend + production DB** with **Stripe live payments**.

## One-time production setup

### API/Server
- Configure production env using `5/server/.env.example` as the source of truth.
- Set `CORS_ORIGINS` to your production website origins (no localhost).
- Ensure you have **Redis** in production (`REDIS_URL`) if you run multiple server instances (rate limiting becomes per-instance without it).
- Set up DB backups and verify you can restore (see “Restore drill” below).

### Web client
- Configure build-time env using `5/client/.env.production.example`.
- CI must run `npm ci` before `npm run build:ci` so TypeScript (`tsc`) exists.
- If you want Sentry sourcemaps: set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in CI (not in browser env).

### iOS
- Release build settings already use:
  - `OX_API_BASE_URL=https://oxsteed.com`
  - `OX_AUTH_BASE_URL=https://oxsteed.com`
  - `OX_ENVIRONMENT=production`
  - `APS_ENVIRONMENT=production` (TestFlight/App Store)
- Capabilities already include App Groups + APNs via `build-atom/OxSteed.entitlements`.

## Monitoring & alerting

### Sentry
- Server Sentry is enabled when `SENTRY_DSN` is set (see `5/server/instrument.js`).
- Web Sentry initializes from `VITE_SENTRY_DSN` (see `5/client/src/instrument.jsx`).
- Create alert rules for:
  - error spike (5xx or unhandled exceptions)
  - `/health` downtime (uptime monitor)
  - Stripe webhook failure rate (server logs/Sentry issues)

### Uptime monitors
- Monitor:
  - `GET /health`
  - `GET /api/health`
  - `GET /api/health/deep` (includes Redis signal when configured)

## Stripe live payments readiness
- Confirm production `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`.
- Confirm admin can:
  - list payments: `GET /api/admin/payments` (admin + `view_financials`)
  - refund: `POST /api/payments/refund` (admin only)
- Keep an emergency kill switch ready: set `FEATURE_PAYMENTS_ENABLED=false`.

## Emergency feature kill switches
Server env flags (set to `false` to disable without redeploying code):
- `FEATURE_PAYMENTS_ENABLED`
- `FEATURE_UPLOADS_ENABLED`
- `FEATURE_CHAT_ENABLED`

## Restore drill (required before inviting users)
1. Take a production DB backup (your provider snapshot or `pg_dump`).
2. Restore to a scratch DB.
3. Run a basic query and boot the server against the restored DB.
4. Document the exact steps for your hosting provider in your internal ops docs.

## “Real users” invite policy (minimum)
- Invite-only cohort, limited size, with a single support channel.
- Publish beta expectations: response time, refund policy, known limitations.

