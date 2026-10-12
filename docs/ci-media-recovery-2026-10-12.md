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
