# CI Media recovery

## Observed failures

CI run `38242193141` failed before the isolated safety harness started because the public ECR Redis pull returned `toomanyrequests: Rate exceeded`. The client browser job also had three fixture-build failures (missing `getMediaVerification`) and one ambiguous publisher-identity locator.

## Changes

- Update the synthetic Media discovery API fixture with the verification export used by the real neighborhood provider.
- Match the displayed publisher identity explicitly, preserving the selector-overlap assertion instead of disabling it.
- During broader verification, fix city URL synchronization discarding approximate device coordinates and triggering a duplicate feed request. Add a deterministic browser regression assertion after URL synchronization.
- Prepare an isolated local Redis image before Compose starts. Try the existing public ECR official Redis 7 mirror, then Docker Hub's official Redis 7 image. Retry at most three rounds with 5/10-second backoff; each Docker command has a two-minute timeout.
- Fail CI if neither public registry succeeds or the local tag cannot be created. Preserve all PostgreSQL, Redis, ClamAV, FFmpeg, readiness, and safety checks. No new credentials, AWS infrastructure, or production changes are required.
- Explicitly install Node 22 in the isolated harness job and run pull-recovery regression tests in the verification job.

## Verification

- `node --test scripts/credit-isolated-seed.test.cjs scripts/media-credit-isolated.test.cjs scripts/pull-ci-redis.test.cjs`: 8 passed.
- Targeted Media discovery and shell browser checks: 17 passed.
- After the duplicate-feed fix, discovery and location browser checks: 4 passed.
- Final complete client browser suite: 50 passed, 2 expected authenticated-environment skips, 0 failures.
- Final `npm run build:ci`: passed, including verification of 771 emitted assets.
- Workflow YAML parsed successfully.
- `docker manifest inspect docker.io/library/redis:7`: succeeded; this checks fallback manifest availability, not the complete isolated harness.

The complete isolated container harness must run on GitHub to establish end-to-end success. Registry availability can still fail after bounded retries; those failures remain visible rather than skipping safety verification.

## Follow-up: Space visibility schema drift

CI run `38244945441` confirms the isolated Media safety harness passed. The server job exposed one remaining failing suite: `mediaVisibilityDb.test.js`. Its controller error was `column c.status does not exist`, not stale fixture rows or an immutability/foreign-key failure. The suite creates a fresh UUID-named schema and applied Media migrations only through 757, omitting the Space lifecycle migration 759 required by current community queries.

Apply the real `759_oxsteed_media_space_suggestions.sql` migration to this isolated fixture. Preserve the original membership/count/detail assertions and add paused/archived Space list/detail regression cases. No broad truncation, production migration rewrite, or visibility-policy fallback is necessary.

Local verification used a newly created `credit_statement_test` database in the separate `oxsteed-postgres-local` container, with synthetic test-only access. The real PostgreSQL visibility suite passed all 19 tests, including both new lifecycle cases. Production databases and credentials were not used.

Combined verification of `mediaVisibilityDb.test.js`, `mediaContracts.test.js`, and `mediaEntityVisibility.test.js`: 3 suites and 51 tests passed. The temporary database and test role were removed after verification; the disposable fixtures can be recreated.
