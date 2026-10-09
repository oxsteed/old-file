# OxSteed Media: one integrated release, one final push

## Execution directive (2026-10-09)

Complete MVP, v2 and v3 together from baseline `d9df71ec` on
`old-files-claude`. Work through the six sections from easier to harder and
retain implementation, tests, migrations and evidence locally until the release
candidate is ready. This directive supersedes the earlier per-batch push rule.

Use up to four agents total, including the primary. Assign non-overlapping files;
the primary owns integration, shared-file coordination, migration allocation,
CI and deployment evidence. Preserve the three unrelated browser scratch files.
The authoritative checklist is `docs/oxsteed-media-completion-goal.md`.

## Local implementation order

1. **Evidence and product polish.** Reconcile checkout/migrations; finish account
   navigation, in-shell activity/legal/verification links, accessible controls,
   focus handling, five-language copy, Arabic layout and share previews.
2. **Core interactions.** Close viewer state, five actions/counts, replies/quotes,
   saved posts, reporting, owner controls, removed content, reciprocal blocks and
   real concurrent daily/upload/report limits on every response surface.
3. **Verification and publishing.** Finish Didit/entity request/review/return
   journeys and private drafts, scanned attachments, quarantine, conversion,
   previews/progress/retry/replacement/duplicate recovery/lost responses. Keep
   consistent publication, admin, feed and asset-delivery safety predicates.
4. **Discovery and integrations.** Close locality, location choice, stable
   context-bound pagination, deduplication/stale-response guards, Following,
   realtime counts, Relevant replies, Spaces, all linked entities and
   profile/workspace/restaurant-copy/removal integrations.
5. **Marketplace and Credit.** Complete buyer/creator/admin journeys, applications,
   award/acceptance, revisions, reserves, approval/payment, cancellation,
   contested-work review, disputes/compensation, history and sponsored placement.
6. **Verification and release.** Run real isolated database/storage/worker/API
   journeys and browser matrix, then exact-candidate CI and deployment checks.

## Interfaces and safeguards

- Retain shared services/API contracts. Publisher identity uses Didit-backed
  `users.is_verified` and the represented business/restaurant verification flag.
  Ordinary active members can reply without acquiring verified-publisher status.
- Admin approval cannot manufacture identity, malware, processing or safety
  clearance. Cloudflare is the authorized interim policy; Thorn is deferred.
- Feed cursors bind viewer, tab, location, ranking mode, cutoff and version.
- Financial transitions and append-only journals are transactional, durable-key
  retries recover posted outcomes and changed payloads are rejected. Preserve
  precision, fees, wallet isolation and activation/freeze controls.
- Boosts pay platform revenue after settlement, last 24 hours and occupy at
  most one paid slot in every five feed items. Retain all organic candidates.
- Only new migration files; inspect existing filenames before allocating.
- All financial writes use synthetic isolated fixtures. Production reconciliation
  remains read-only; preserve production controller, volumes, uploads and backups.

## Before the single push

Run focused behavioral checks after affected subsystems. After integration run:
real PostgreSQL authorization/attachment races/blocks/locality/pagination without
skips; client smoke/browser/localization/type/build checks; applicable server
regressions; upgraded migration rehearsal and repeat application; helper,
business, restaurant, guest, blocked, buyer, creator and admin journeys.

Prove conservation, one settlement/release, insufficient funds, currency/replay
boundaries, concurrent cancellation, disputes/compensation and boost placement/
expiry. Cover five languages, Arabic direction, keyboard, desktop/mobile browser
layouts, playback, notifications and messages. Record real-device checks
separately from emulation and mocked browser dependencies.

Use portable PostgreSQL locally. Where Colima/container dependencies are
unavailable, retain PostgreSQL/Redis/private-storage/ClamAV/FFmpeg and financial
journeys in the same final disposable CI job. Such checks remain outstanding
until that job actually passes.

## Single release candidate

1. Create one coherent commit with implementation, tests, new migrations and
   updated evidence. No intermediate or documentation-only pushes.
2. Push once to `old-files-claude`, retaining all existing CI jobs and safeguards.
3. Require passing server/client verification, disposable safety/upload/financial
   journeys and full migration rehearsal for that exact commit.
4. Verify Coolify deployed the candidate by SHA or reproducible committed-content
   identity. Check `/ready`, `/health`, migrations, workers, assets and
   authenticated helper/business/restaurant/admin behavior.
5. Reconcile production finances read-only. Save terminal CI/deployment evidence
   in a local release report without another documentation-only push.

Target one final workflow run. A genuine failure can require a corrective commit
and another run. No requirement is fully complete solely from code inspection,
mocks, a previous release, skipped tests or browser emulation. Missing credentials,
runtime/device access or provider evidence remains explicit. The goal remains
incomplete until every required acceptance check is satisfied; planning does
not automatically resume a paused goal in the app.
