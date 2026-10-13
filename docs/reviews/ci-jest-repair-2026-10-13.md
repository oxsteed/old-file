# CI Jest repair

Source failure: GitHub Actions run 38425789141, head `5ba43bf5`,
Server and Client Verification: 10 failed suites / 30 failed tests.

## Changes

- Restore the missing Learn flag-decision error mapper. Missing flags/guides,
  decided flags, blocked videos, and duplicates now return their intended
  404/409 codes. Error copy is localized in all five server/client catalogs.
- Replace positional Learn video query fixtures with SQL-aware fixtures for
  identity locks, moderation checks, review notifications, and audit writes.
  Preserve success, duplicate, rollback-and-continue, and moderation assertions.
- Supply the existing onboarding/tax eligibility fields for successful instant
  payout fixtures. Add denied onboarding, missing W-9, and expired identity
  assertions that verify no payout write/provider call occurs.
- Supply the local payout insert result, locked authorized payment row, absence
  of pending agreement change orders, absence of an agreement warranty barrier,
  and attachment pre-read required by the current handlers.
- Make the subscription Stripe mock constructible for the capture service.
- Register Connect status cache in the process-state inventory and use the
  existing TTL/size-bounded cache helper (15 minutes / 250 entries). Failed
  provider refreshes remain uncached and fail closed.
- Scope migration 238's legacy table-existence probe to the scheduling test's
  disposable schema. Assert both tables actually belong to that schema before
  seeding. Applied migration SQL is unchanged.
- Run the million-row suite sequentially, then invoke Jest directly with
  `--runInBand --detectOpenHandles`. Calling `npm test` would still add
  `--forceExit` from package.json. Keep existing database result assertions.

## Validation performed

- All 10 previously failing suites: **204 tests passed**, with
  `--runInBand --detectOpenHandles`. Scheduling used the existing isolated
  Credit test PostgreSQL container on loopback port 55439, database
  `credit_statement_test`, and its own random schema.
- Payment controller / process-state / Learn focused regression: **73 passed**
  before the additional localized-error and payout-denial cases above.
- `cd client && npm run build:ci`: passed; localization, TypeScript, Vite,
  and verification of **777 emitted assets** succeeded.
- Workflow YAML parses; checked that regression commands contain no background
  million-row process or `--forceExit` and do include open-handle diagnostics.
- `git diff --check` and changed controller syntax checks passed.

A broader local Jest invocation completed with 570 passed / 5 failed /
21 skipped suites. Those five failures used the default unavailable PostgreSQL
port or missing media tools. Rerunning all five with the disposable database
and actual FFmpeg/FFprobe binaries passed **85 tests**. The runner exited
naturally with no detected open-handle report. This is not an exact full CI
environment pass; the million-row case and the full CI database matrix require
the new remote run. The previous remote million-row case passed.

No production database, payment-policy changes, merges, or deployment work are
included. Remaining review waves are still incomplete. Remote CI status is
reported separately after pushing.
