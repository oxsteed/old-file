# Coordinated web schema release (2026-11-02)

Status: implemented and rehearsed locally; CI, staged production release and
live continuity acceptance still pending. Do not report this as deployed.

## Failure and compatibility boundary

The current serving source is f6d7543381736f899571c14d14b26e1a6ace3c45.
The five failed Coolify attempts target 2f45da75fc58fb051d160e5e829b55cd8dae9141.
The latest attempt 8yhecuq3et86rjwnipmqdxjb retained the old healthy release.
A fresh read-only comparison found 1029 applied migrations, eight pending,
no changed/incomplete/unexpected markers, and one legacy null checksum:
088b_platform_ledger_user_id_fkey_drop.sql. A null legacy checksum is reported
but is not itself a startup blocker; this release must not backfill it.

Both old web startup and runtime readiness reject unknown future migrations.
Simply applying the eight additions would withdraw the old backend before the
replacement starts. The bridge keeps the deployed application and assets, and
changes only the two schema checkers plus their compatibility helper. The base
image is pinned by digest and its checker sources are verified before overlay.
Only the eight exact filename/checksum pairs in the reviewed plan are accepted,
and only when recorded as applied. Pending required migrations, unexpected
additions, changed checksums and incomplete future markers still fail closed.
Normal images contain no compatibility manifest and retain strict behavior.

## Reviewed additions

- Seed the confirmed dual-approval default only when absent.
- Add nullable refresh replay, CSRF session and deletion completion markers.
- Add support attachment keys and backfill only recoverable local URLs.
- Add nullable impersonation attribution columns and indexes.
- Add the explicit pending-partner auto-provision flag and narrow trigger carve-out.
- Add a nullable bigint audit target and extend hash verification for old rows.

These preserve old columns and rows; no ledger history, credentials or activation
flags are changed. The trigger change keeps the old default false and therefore
preserves the old creator guard. Index/DDL locks are bounded to one second; SQL
statements to ten seconds. All eight additions and markers commit in one
transaction using the migration runner's advisory lock. An error rolls back the
whole batch. Existing legacy checksum markers are left untouched.

## Release order

1. Require all four CI checks, merge, then manually run Verified web schema bridge.
2. Promote its separately validated receipt with --bridge; the normal observer
   cannot select this workflow. Verify live image identity, public traffic,
   original assets and realtime reconnection before changing the database.
3. Coordinate the background process as well: its current readiness checker also
   rejects future migrations. Do not apply the database batch until that old
   process has a reviewed compatibility/replacement plan. Do not launch duplicate
   background consumers or disable its readiness check.
4. Take and verify a database backup, dry-run the exact reviewed plan, then execute
   applyReviewedSchema with apply:true under the established runtime credentials.
5. Promote the verified full default-branch image, verify identity and monitor
   traffic throughout. Keep the compatibility image as the rollback target after
   expansion; the original strict image is not a valid post-expansion rollback.

## Local evidence

- 32 tests across migrationCompatibility, webSchemaPreflight and readinessCapabilities.
- Six promotion/source gate checks plus the atomic transaction regression pass.
- Disposable PostgreSQL catch-up: 1029 baseline + 8 additions, all 1037, repeat runner
  and guard verification passed in 29.4 seconds. No production data used.
- Actual bridge image startup and runtime migration readiness pass against the
  expanded disposable database; seven real-image synthetic schema cases pass.
- Actual inherited startup/shutdown check: 2164 ms drain; schema and asset failures
  each refuse startup.

No production schema writes or new production deployments were performed during
these local checks. Background coordination and live acceptance remain required.
