# OxSteed Media execution and verification plan

The user approved execution on 2026-10-08. The goal is active. Up to four
agents may work in parallel, with the primary agent coordinating integration,
non-overlapping file ownership and release evidence. Retain all existing work
and finish MVP, v2 and v3 in the same effort. The authoritative requirements
and evidence matrix are in
`docs/oxsteed-media-completion-goal.md`; earlier narrative entries there are
historical observations, not current completion claims.

## Parallel batch rules

- Split work into independent, reviewable batches. Agents may inspect and
  implement separate workstreams concurrently, but they must not edit the same
  files or migrations without coordination.
- Each batch still gets focused checks, one coherent commit and one push. Keep
  unrelated scratch files untracked and reconcile the shared checkout before
  staging.
- CI runs asynchronously. Do not wait for an earlier CI check before sending
  the next ready batch. Record each run against its commit and address failures
  in the next corrective batch; never describe an unfinished run as passing.
- The primary agent owns final integration, deployment checks, requirement
  evidence and the decision that the combined goal is complete.

## Batch 1: repeatable verification baseline

- Reconcile the writable checkout, branch, remote, current migrations and live
  release. Preserve unrelated scratch files.
- Maintain the complete requirements matrix with implementation, behavioral
  execution, exact deployed evidence, dependencies and next action.
- Use the existing disposable Credit harness plus the optional Media extension:
  PostgreSQL/PostGIS, Redis, private uploads, real ClamAV and runtime FFmpeg.
  Run `bash scripts/media-isolated-env.sh start`, then `seed`, then `media-test`
  on the supported Colima host. `down` removes only that disposable project.
- Use synthetic helper, business, restaurant, customer, blocked and admin
  identities from `server/scripts/media-isolated-fixtures.js`. The established
  Credit seed supplies separate currency wallets and restaurant-wallet isolation.
  Financial activity stays inside that disposable environment.
- Require the PostgreSQL suites to execute without skips in CI. Keep browser
  interaction mocks explicitly distinct from real API/storage/worker proof.

Acceptance: the setup executes repeatedly, including fixture reset/replay, and
the matrix covers the entire combined scope. The scripts existing alone do not
meet this acceptance condition.

## Batch 2: publishing, safety and everyday journeys

Work in complete paths: current publisher and entity verification → private
draft → scanned attachment → conversion → ready → publication → public delivery.
Then finish replies/quotes, five actions, views, saved posts, reports, owner
editing/deletion, two-way blocks, limits, linked cards, Spaces, in-shell activity,
accessibility, five-language copy and image-rich share previews. Keep the same
safety predicates across publication, administration, feed and asset delivery.
Test lost responses and concurrent publication/replacement, not just happy paths.

Acceptance: real API/database authorization, verified posting, guest browsing,
upload recovery and worker transitions pass; blocked or unauthorized accounts
cannot bypass the controls.

## Batch 3: discovery and v2 integration

Implement entity coordinate locality with explicit city/state fallback, guest
location selection, user-triggered device location, versioned context-bound
ranking cursors, complete duplicate-free pagination and stale-response handling.
Complete Following, existing realtime reconciliation, Business Hub/Profile
Studio/public profiles, rentals/Direct/Logistics cards and safe restaurant copying.
Test source removal/moderation propagation and duplicate prevention in real SQL.

Acceptance: real database locality, pagination, Following and copy/removal cases
pass; maintained browser tests verify integration and tab switching.

## Batch 4: marketplace, Credit and paid placement

Complete buyer/creator dashboards, opportunities, applications, award/acceptance,
deliverables/revisions/approval, cancellation, history, notifications and disputes.
Reserve gig funds on award and sponsorship funds on acceptance. Use new creator
reservations over the shared wallet accounting; never repurpose restaurant holds.
Settle on approved delivery; release once on authorized cancellation; contested
work goes to administrator review. Tips settle immediately.

Boosts pay OxSteed platform revenue, then activate a 24-hour placement. Disclose
price/currency, retain locality, label sponsored posts and limit them to one in
five feed items. Complete purchaser history and cancellation/refund review.
Verify atomic state/accounting, append-only history, precision, fees, activation,
freeze controls, changed-payload idempotency rejection, lost responses and races.
Use only new migration filenames; rehearse upgrade and repeat application.

Acceptance: real isolated accounting proves fund conservation, one settlement or
release, insufficient funds, currency rules, durable retry/replay and audited
refund/dispute handling.

## Release verification

Run focused behavioral tests after each subsystem; run the full client build once
per integrated batch. Push code and evidence together. Start CI for each pushed
batch, but allow the next ready batch to proceed without waiting for that run
to finish. Check GitHub billing and deployment access once at each release
checkpoint. Continue independent work when unavailable; do not substitute a
previous commit's green CI for an unfinished or different commit.

For the final candidate, execute full client/server suites, real database
journeys, migration rehearsal, desktop/mobile browser matrix, five languages,
Arabic layout, keyboard controls, playback, activity and payment failure/retry.
Require passing CI and exact deployed commit/content identity. Verify `/ready`,
schema, workers, assets and signed-in helper/business/restaurant/admin journeys.
Production financial checks are read-only reconciliation. Real-device and
unavailable live evidence remain open. Cloudflare is the authorized interim
publication policy, not upload-time video screening; Thorn remains deferred.

Mark the goal complete only when every requirement has matching evidence.
