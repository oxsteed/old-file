# Release Checklist

Repeatable release approval for every production deploy. Do not mark a
release approved until every box is checked or explicitly waived with a
reason recorded below.

## 1. Pre-deploy: commit consistency

Deploy only on consistent commits: code and everything it depends on must
land together in the release being deployed.

- [ ] Translation keys: every `t('...')` call added in this release has its
      key in all five locale catalogs (`en`, `es`, `fr`, `ht`, `ar`).
      Run `npm run verify:i18n` in `client/`.
- [ ] Migrations: every new migration file is numbered after the current
      maximum in `server/migrations/`; no migration was renumbered or
      repurposed. New tables/columns the code reads are covered.
- [ ] Controller/handler exports: every route registration resolves to a
      real exported handler (no startup crash landmines).
- [ ] `tsc --noEmit` clean in `client/`; focused server Jest suites green;
      `npm run build:ci` green in `client/`.
- [ ] The exact commit hash to deploy is recorded: `________________`

## 2. Deploy

- [ ] Deploy the recorded commit through Coolify (no cherry-picks, no
      mixed states).
- [ ] Confirm the deployment finished and the new container is serving.

## 3. Post-deploy: automated endpoint verification

Run from any machine with network access to production:

```bash
node scripts/release-check.cjs --base https://oxsteed.com
```

- [ ] `/health` returns 200 with `status: ok` (process liveness).
- [ ] `/ready` returns 200 with `status: ready` and every subcheck green:
      database, migrations, adminControlPlane, redis, realtime, workers,
      traffic, shutdown. Any `not_ready` blocks traffic routing.
- [ ] `/api/health/deep` returns 200 with `status: ok` and database ok.
- [ ] Paste the script output into the release record below.

## 4. Post-deploy: operations review (admin session)

Open the Admin Operations overview (`/admin/operations`).

- [ ] Queue age: no queue is growing unbounded; oldest item age is within
      the normal band for its queue.
- [ ] Dead-letter / failed work: review failed delivery events and failed
      webhooks (`webhook_delivery_log` pending/failed counts); replay or
      resolve, or record why each item is left.
- [ ] Worker health: background workers report ready; no worker is
      stalled or crash-looping.
- [ ] External synchronization: payment providers, messaging providers,
      and integrations show connected; recent sync timestamps are fresh.
- [ ] Reconciliation exceptions: no new unowned exceptions since deploy.

## 5. Post-deploy: production smoke matrix

- [ ] Customer: home page loads, search works, booking flow reaches payment.
- [ ] Helper: dashboard loads, availability and bookings render.
- [ ] Admin: dashboard renders with localized labels (no raw `*.title`
      keys) in the default locale; switch to Spanish and spot-check.
- [ ] Auth: login and session refresh work.
- [ ] Realtime: a test chat message or booking update propagates.

## 6. Rollback criteria

Roll back immediately if any of these hold and cannot be fixed forward
within 15 minutes:

- `/ready` stays `not_ready` (migrations, workers, or dependencies failing).
- Crash loop or restart-limit stop reported by Coolify.
- Raw translation keys visible on any user-facing page.
- Payment capture, refund, or payout path errors on real traffic.

## Release record

| Item | Value |
|---|---|
| Date (UTC) | |
| Commit deployed | |
| Deployed by | |
| release-check output | |
| Operations review notes | |
| Smoke matrix notes | |
| Waivers (with reason) | |
| Approved by | |
