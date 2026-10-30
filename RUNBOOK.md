# OxSteed Runbook (Beta / Real Users)

This runbook is intentionally short and action-oriented.

## CI or deployment failed
1. Check build isolation with `node scripts/provision-coolify-build-isolation.cjs --check`; see `docs/deployment-build-isolation.md` if source builds affect live traffic.
2. Open the failed Actions job: verification failure and deployment failure are
   different incidents. Fix the first failed check before retrying publication.
3. For Coolify HTTP 404, verify the live instance, application UUID, and token
   team permissions using `docs/deployment-ci.md` and the read-only deploy check.
4. Inspect the exact queued deployment and commit. A healthy old container does
   not prove a new release succeeded.
5. Keep one automatic deployment controller; coordinate a switch from Coolify's
   GitHub hook to Actions only after its access and deployment checks work.

## API down
1. Check process liveness at `/health` and traffic readiness at `/ready`.
2. Inspect `/ready` JSON for the failing dependency: database, migrations, configured Redis, realtime, workers, traffic, or shutdown.
3. Keep load balancers and Coolify pointed at `/ready`; `/health` only proves the Node process is alive.
4. Check latest deploy and container/process status.
5. Check DB connectivity (`DATABASE_URL`) and connection saturation.
6. If needed: scale up, then roll back to the last known good release.

## Realtime degraded
1. Confirm the client connects to the correct namespace: authenticated messaging `/chat`, customer support `/support`, or public PII-free queue updates `/restaurant-display`.
2. Confirm only one Socket.IO server initialized; duplicate bootstrap now fails fast instead of competing for HTTP upgrades.
3. Check `/ready` reports `realtime.ok: true` before sending traffic to the instance.
4. During a rollout, verify SIGTERM logs both `Graceful shutdown started` and `Graceful shutdown complete` before the old container exits.

## Optional integration unavailable
1. Inspect `GET /api/config/capabilities`; it reports availability without exposing credentials.
2. SMS requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER`.
3. Background checks require both `CHECKR_API_KEY` and `CHECKR_WEBHOOK_SECRET`.
4. AI support and geocoding require `OPENAI_API_KEY` and `GOOGLE_MAPS_API_KEY`, respectively.
5. Missing optional integrations must hide or degrade their UI; they must not make `/ready` fail.

## Upload malware scanning posture
1. Tiered by design (review P3-6-F09): public media uploads (restaurant media,
   media-creator posts) fail closed and 503 without a real scanner. General
   uploads (profile photos, attachments) use static validation only
   (magic bytes, extension allowlist, EICAR signature) when no scanner is
   configured, so uploads keep working on deployments without ClamAV.
2. Scanner status: `GET /api/monitoring/upload-security` (admin,
   `manage_operations` grant); an `UPLOAD_MALWARE_SCANNER_NOT_CONFIGURED`
   alert appears on `GET /api/monitoring/health`, and the server logs a
   startup warning in static-only mode.
3. To force every upload path fail-closed: set `CLAMAV_HOST` (plus
   `CLAMAV_PORT`) and `FILE_SCAN_REQUIRE_MALWARE=true`.

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

## Media CSAM (Cloudflare + owner video override)
1. Operational steps, env vars, and daily-email match response:
   `docs/oxsteed-media-csam-cloudflare-runbook.md`.
2. Public photos in production require `MEDIA_CSAM_MODE=cloudflare` plus
   `MEDIA_CLOUDFLARE_HOST` / `MEDIA_CLOUDFLARE_PUBLIC_BASE_URL` and the zone
   CSAM Scanning Tool enabled (cached images only).
3. Public video without upload-time CSAM is **owner-accepted risk** only when
   `MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM=true` (server logs a startup warning). Disable
   once `MEDIA_CSAM_MODE=vendor` and `MEDIA_CSAM_CERTIFIED=true` are live.
4. Cloudflare match takedown: Admin → Media flags → CSAM takedown by public URL,
   or `POST /api/admin/media/takedowns/by-url` with the path from the daily email.
