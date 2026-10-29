# Web schema preparation - 2026-10-29

Requirement 1: an incompatible web replacement must leave the working release
and its database intact. Separating consumers from web processes does not meet
that requirement if `npm start` still applies migrations before checking the
existing background runtime.

## Startup behavior

`prepare-runtime-schema.cjs` dispatches on the established runtime role. The
combined role uses the existing migration runner. A web role never imports
that writer: it reads the migration catalog and existing markers inside a
PostgreSQL read-only transaction. Pending, failed/applying, unexpected,
duplicate or changed recorded checksums refuse startup. The migration SQL is
never executed, and metadata is neither bootstrapped nor repaired.

The checker preserves the existing runner's legacy applied-row policy. A
missing checksum is reported as `legacyUnverified`, without claiming that
historically applied bytes were verified and without recording a forward
baseline. Existing recorded checksums are compared to current source bytes;
immutable-file CI remains mandatory. A stricter proposed checker rejected one
such production record; that observation is retained rather than changing the
database to satisfy the checker.

The guard runs before retained-asset synchronization and API startup. A
rejected web release cannot prune retained assets or start consumers. Explicit
`npm run migrate` and combined startup retain their existing behavior. Schema
changes require a coordinated migration/background release; automatic web
replacements cannot perform that coordination by themselves.

## Verification

- Eighteen focused unit/PostgreSQL tests pass. They cover compatible metadata,
  pending SQL, legacy checksums, changed files, incomplete markers, newer
  catalogs and absent metadata. SQL files deliberately contain `CREATE TABLE`
  statements; none execute. All checker statements run in a read-only
  transaction and fixture data remain unchanged.
- The actual startup CLI runs in a separate disposable database with the
  checkout's complete catalog. Instrumentation rejects any import of the
  writer. Compatible metadata succeeds; removing one marker exits with
  `WEB_SCHEMA_NOT_READY`, without recreating the marker or creating tables.
- Four compatibility suites pass 23 tests, including existing recovery and
  forward-baseline behavior and the bounded worker observer.
- A read-only production check reports 1,029 applied migrations, 1,028 matching
  recorded checksums and one legacy unverified checksum. No schema, marker,
  financial or customer record was changed by this observation.

These are local and read-only production observations. CI and deployment of
this startup change remain required.

## Current release boundary

PR #639 passed all four required jobs and merged as
`c1b2c4da64d44a7b21f0d6f4366a2054378204e6`. The live web image is
`sha256:93c661cf56d365145b7c5d409977d94e8ceaecd36d7c908dbe8a60fa498eceb4`.
Its final shared-service deployment is `2cv0qyyaarh5x2an7byht6if`.

All eight generated routes now reference one upstream service and one active
readiness check per container, replacing eight identical health checks against
the same API. The timeout is three seconds with a one-second interval. Actual
Docker labels and the read-only metadata mount are verified; the web container
is healthy and the original combined runtime remains running at `1e584da3`.

The last continuous report contains 342 requests after the readiness repair
became active, with zero failed requests. It retains the earlier failures under
the old 1.5-second worker observer separately. A browser document loaded before
the replacement navigated to Food afterwards in 1,358 ms, using the same
document with no chunk retry, missing asset or page error. This report samples
only part of the shared-service change; repeat final rolling/rejection checks
after publishing the schema guard.

Pinned release-variable overrides are removed from the web resource. Coolify
now supplies the actual source commit at build and runtime; the live image,
browser release and host provenance agree. Both automatic triggers remain
disabled until final acceptance. Enable only the web trigger after publication
and verification; the combined runtime continues owning the workers and backup
observer. Its release is distinct from the web release.

The eight-improvement goal remains active. Workspace priorities, remaining
design consistency and cross-tab/private-draft isolation remain separate work.
