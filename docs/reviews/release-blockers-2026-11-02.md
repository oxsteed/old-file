# Release blockers checked on 2026-11-02

The default branch is `984f3c3f3ab00f101724de09618621be8d9e8b50`.
Production `/ready` still reports healthy source
`f6d7543381736f899571c14d14b26e1a6ace3c45`.

## CI browser matrix

Run `41366544536` stopped in the Learn pagination browser matrix after its
120-second aggregate timeout: zero failed assertions, one cancelled test.
That single test exercises 20 viewport/language/theme combinations. Its focused
local baseline passed in 66.36 seconds. The harness now names each combination,
allows 300 seconds for the full matrix, and bounds individual UI/navigation
waits to 10 seconds. Pagination, filter reset, focus, wrapping, and failure/retry
assertions are preserved. Remote CI remains required before merging.

## Separate deployment blocker

The observer recorded failed replacement `f3653aise4m96ohidf11zgz1` for source
`2f45da75fc58fb051d160e5e829b55cd8dae9141`. Its startup logs report
`WEB_SCHEMA_NOT_READY`: 8 pending migrations and 1 unverified migration, with
zero changed, duplicate, unexpected or incomplete markers. Coolify retained the
working release. These counts describe that rejected candidate, not a fresh
schema comparison against the newer default branch.

Next: review the pending migrations and unverified checksum against the current
database and source, rehearse the migration plan, then perform the coordinated
schema release before retrying a verified web image. Preserve the read-only web
preflight and migration immutability checks. No production migrations, checksum
backfills, or deployment retries were performed during this quick diagnosis.
