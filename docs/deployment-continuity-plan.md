# Deployment continuity implementation and acceptance plan

Part of requirement 1 in `oxsteed-eight-improvements-goal.md`. This plan records
verified constraints; it does not authorize a different deployment owner or
claim that rolling deployment has been implemented.

## Verified current state - 2026-10-27

- Coolify application `tdrapz1vvcoftfwsk7fcdq0h` uses `dockercompose` with
  `/docker-compose.coolify.yml`, no host port mappings, and two services: app
  and ClamAV. The app actually exposes port 5000. Its unused application-level
  configuration still lists port 3000 and disables application health checks.
- Installed Coolify `ApplicationDeploymentJob.php` builds the replacement,
  calls `stop_running_container(force: true)`, then starts the new Compose
  application. The separate Dockerfile/image rolling path starts a candidate,
  checks health, and only then removes the old container.
- [Coolify rolling updates documentation](https://coolify.io/docs/applications/deployments/rolling-updates)
  confirms that Compose applications do not use that rolling replacement path.
- The app's Dockerfile already exposes 5000 and checks `/ready`. The server
  checks dependencies/migrations before starting workers and handles shutdown.
  This proves useful prerequisites, not safe multi-instance operation.
- Many workers have per-job distributed locks, but `BackgroundWorkers.start()`
  also starts jobs without a common process ownership gate. Do not assume that
  overlapping app replicas are safe merely because Credit jobs are fenced.
- Existing host metadata/backup reconciliation explicitly requires one running
  app with Compose service label `app`. A Dockerfile resource has different
  generated service labels. Deployment identity checks must remain strict when
  accommodating that topology.

## Preserve the actual running storage

Read-only inspection of the current app found these mounts:

| Destination | Actual source | Access |
| --- | --- | --- |
| `/app/server/runtime/uploads` | `/Users/oxsteed/Documents/GitHub/6/server/runtime/uploads` | read/write bind |
| `/app/server/runtime/web-assets` | `tdrapz1vvcoftfwsk7fcdq0h_oxsteed-web-assets` | read/write volume |
| `/app/server/runtime/release-metadata` | `tdrapz1vvcoftfwsk7fcdq0h_oxsteed-release-metadata` | read-only volume |

Coolify's parsed volume names differ from the unprefixed source names. Never
create empty replacement volumes from source spelling alone. The current
metadata provisioning repair accepts that exact application-prefixed name as
well as the historical unprefixed name, and writes only the inspected mount.
Inventory and preserve the scanner database volume and network aliases too.

## Required implementation sequence

1. Complete the background-work overlap audit, including workers started from
   `server/index.js` after the main runtime prepares. Implement safe ownership
   and handoff or isolate worker lifecycle from replaceable web instances.
   Standby web readiness must not deadlock waiting for a worker lease still
   owned by the current healthy release. Preserve fencing/idempotency of
   financial work and never test financial writes against production.
2. Extend release/backup discovery to verified deployment-specific candidates,
   immutable image identity, actual mounted volumes, and active routing. Refuse
   ambiguity rather than selecting a convenient container name. Keep the
   application metadata mount read-only and Docker access on the host.
3. Prepare managed persistent scanner configuration and a Dockerfile-based app
   configuration using existing secret-store entries, private networks, actual
   mounts, port 5000, `/ready`, graceful stop, and unique candidate names. Recheck
   current live settings before applying the prepared change. Keep one automatic
   deployment controller and do not enable a competing Actions deployment path.
4. Rehearse successful, slow, failed, and cancelled candidate deployments using
   disposable app/data resources. Confirm current traffic survives each failure,
   new traffic reaches the correct release after promotion, and worker/session/
   realtime/storage behavior remains correct.
5. Apply the verified configuration through the existing controller and monitor
   a production transition with continuous requests to HTML, readiness, a lazy
   page, and representative read-only APIs. Record timestamps, statuses, release
   identity, overlap order, and post-transition worker health. A queue status of
   `finished` alone is not acceptance.
6. Verify rollback using a non-destructive candidate failure. Preserve current
   and retained fingerprinted assets so an old browser tab can still navigate.

## Completion gates

- No failed client requests during the measured healthy-candidate transition.
- Failed candidates retain the working release and do not take over traffic.
- No duplicate background side effects, lost durable jobs, session resets,
  unauthorized cache reuse, or changed financial activation controls.
- Existing data, assets, uploads, backups, private scanner access, and truthful
  release provenance are preserved and verified.

The deployment configuration has not been changed by this planning package.

## Runtime prerequisites implemented - 2026-10-28

Six workers started after listening now have stop handles owned by the shared
runtime, and their polling loops await an active pass on shutdown. They stop
accepting ticks and subsequent batch claims before dependency teardown. The
existing 15-second forced-shutdown deadline remains; a long media job can still
require durable recovery. This is source-level drain preparation, not proof of
safe overlapping replicas or uninterrupted production deployment.

Nine focused Jest suites passed (60 tests; one real-FFmpeg rendition case
excluded after reproducing its dimensions failure on the unchanged committed
worker). A real Direct draft-cleanup pass was held at storage to verify that
stop waits; lifecycle tests hold the pool/Redis open until all owned stops drain.

Remaining audit includes cron callbacks started by `BackgroundWorkers`,
per-process limit/cache refresh timers, the dedicated payment worker topology,
strict mounted release metadata, and candidate readiness/routing. Current live
`/ready` still has null Git SHA/image/deployment provenance, despite the Coolify
queue recording a finished commit and the browser showing changed assets.
No topology/configuration change has been applied from this prerequisite work.

## Release identity repair - 2026-10-28

The provisioner now verifies a single read-only metadata mount and uses its
actual inspected volume name. Foreign application prefixes, writable mounts,
duplicate mounts, changed containers, and mismatched deployment receipts fail
before writing. Automatic discovery still refuses multiple running apps. An
explicit full immutable container ID can select a candidate during overlap;
this does not add routing or Dockerfile-resource support.

The host installer also includes the restore-verification profile module used
by its backup adapter. Its isolated copied-bundle test previously caught that
missing runtime dependency. Portable release/reconciler regressions now run in
the existing CI deployment-command step; installer tests retain their fixed
Mac checkout safeguards and run locally.

Validation: 39 Node tests passed, including deployment command, content release,
release provisioning, host reconciliation, and installer tests. The opt-in
Docker rehearsal passed with two disposable, network-isolated containers on a
dedicated application-prefixed volume. It proved ambiguity rejection, explicit
candidate selection, per-container release records, idempotency, and preservation
of the first record after provisioning the second. The fixture containers,
volume, image, and temporary directory were removed. No API or production data
was mounted or started.

Production check mode accepts the observed mounted volume and derives the
current commit, image digest, and deployment ID. No production metadata write
or host installation has been performed at this stage. Publish through a PR
and require green CI under `deployment-ci.md` before applying the reviewed
host bundle; then verify public readiness against actual container identity.
