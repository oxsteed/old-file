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
metadata provisioning script accepts only the unprefixed metadata volume name;
resolve this discrepancy with strict inspected-volume identity and tests.
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
