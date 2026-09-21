# OxSteed Production Readiness (Real Users Testing)

This checklist is for “real users” beta testing on **production backend + production DB** with **Stripe live payments**.

## One-time production setup

### API/Server
- Configure production env using `server/.env.example` as the source of truth.
- Follow `docs/deployment-ci.md` for the current Coolify target and CI integration.
- Set `CORS_ORIGINS` to your production website origins (no localhost).
- Ensure you have **Redis** in production (`REDIS_URL`) if you run multiple server instances (rate limiting becomes per-instance without it).
- Set up DB backups and verify you can restore (see “Restore drill” below).

### Web client
- Configure build-time env using `client/.env.production.example`.
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
- Server Sentry is enabled when `SENTRY_DSN` is set (see `server/instrument.js`).
- Web Sentry initializes from `VITE_SENTRY_DSN` (see `client/src/instrument.jsx`).
- Create alert rules for:
  - error spike (5xx or unhandled exceptions)
  - `/ready` downtime (dependency and worker readiness)
  - Stripe webhook failure rate (server logs/Sentry issues)

### Uptime monitors
- Monitor:
  - `GET /ready` (readiness; use this for routing and deploy acceptance)
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
Server env flags (set to `false`, then restart/redeploy the runtime to load them):
- `FEATURE_PAYMENTS_ENABLED`
- `FEATURE_UPLOADS_ENABLED`
- `FEATURE_CHAT_ENABLED`

## Restore drill (required before inviting users)
1. Use `scripts/backup-coolify-production.sh` for the current Colima/Coolify stack.
2. Check scheduling with `scripts/verify-local-backup-scheduler.sh`.
3. Use `scripts/verify-production-restore.sh` to verify a local backup in an
   isolated database. Never restore test data over production.
4. Follow `docs/oxsteed-credit-production-runbook.md` and retain the resulting
   restore evidence. Backups remain local for now.

## CI and security scanning

The checked-in workflow is `.github/workflows/ci.yml`. It runs client checks,
backend regression tests, and optional isolated database verifiers when
`CI_DATABASE_URL` is configured. Missing database configuration means those live
checks are skipped, not passed. Never point `CI_DATABASE_URL` at production.

CodeQL appears separately in GitHub Actions, but this repository contains no
CodeQL workflow file. Verify its current GitHub code-scanning configuration and
results before claiming coverage or adding a duplicate workflow.

## “Real users” invite policy (minimum)
- Invite-only cohort, limited size, with a single support channel.
- Publish beta expectations: response time, refund policy, known limitations.
