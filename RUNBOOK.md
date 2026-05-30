# OxSteed Runbook (Beta / Real Users)

This runbook is intentionally short and action-oriented.

## API down
1. Check uptime monitor status for `/health` and `/api/health`.
2. Check latest deploy and container/process status.
3. Check DB connectivity (`DATABASE_URL`) and connection saturation.
4. If needed: scale up, then roll back to the last known good release.

## DB migrations failed
1. Identify the failing migration filename in logs.
2. If safe: re-run migrations once (avoid repeated partial runs).
3. If blocked: roll back deploy (code) and restore DB snapshot if data is corrupted.
4. Postmortem: make the migration reversible or split into smaller steps.

## Stripe webhook failures
1. Verify `STRIPE_WEBHOOK_SECRET` is correct for the production webhook endpoint.
2. Inspect webhook delivery attempts in Stripe dashboard.
3. Check server logs/Sentry for signature verification errors.
4. If payments must be paused: set `FEATURE_PAYMENTS_ENABLED=false`.

## Sentry spike
1. Identify the top issue/release/environment.
2. If tied to a release: roll back or hotfix.
3. If traffic-related: check rate limiting, bots, and abuse endpoints.

## Refund request
1. Find payment in admin list: `GET /api/admin/payments` (requires `view_financials`).
2. Confirm status is refundable (authorized/captured).
3. Refund: `POST /api/payments/refund` (admin only).
4. Document reason and notify user.

