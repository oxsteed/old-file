# OxSteed Media interim safety policy — 2026-10-08

Emile revised decision #12 in `oxsteed-media-spec.md`: the enabled Cloudflare
CSAM Scanning Tool is accepted as the interim MVP control. Thorn Safer is
deferred until Media demand justifies its cost. This decision replaces the
previous requirement that a certified upload-screening vendor must precede
public Media video publication. Emile's subsequent strategy update brings MVP,
v2, and v3 into one implementation goal; this changes build scope, while the
interim safety policy and financial activation controls still apply. See
[combined Media goal](oxsteed-media-completion-goal.md).

Cloudflare documents cached-image hash matching and URL blocking at
https://developers.cloudflare.com/cache/reference/csam-scanning/ . This interim
policy does not claim that Cloudflare screens uploaded video before publication
or that every asset delivered by OxSteed is covered by its cache scanning.

## Current application rules

- `MEDIA_CSAM_MODE=cloudflare` selects the interim policy. With no explicit mode,
  this is the default unless an existing `MEDIA_CSAM_CERTIFIED=true` selects
  strict vendor mode. This default implements Emile's revised requirement.
- Video upload still requires Didit identity, ownership, valid file content,
  a real clean malware scan, upload limits, and a private processing stage.
- The Media worker records `cloudflare_deferred`, never a synthetic `passed`
  vendor result. Migration 736 adds that explicit asset status.
- FFmpeg must produce nonempty renditions before the owner can publish. All
  assets must be ready; finishing one asset cannot clear another asset's
  quarantine. Public playback uses the processed rendition.
- Feed, post detail, replies, quotes, saved posts, search, Spaces, actor feeds,
  view counting, and share previews enforce the same public asset rules.
- Publication and admin approval recheck identity and current actor verification;
  removed, flagged, failed, pending, or incomplete content remains blocked.
- `MEDIA_CSAM_MODE=disabled` or an unknown mode stops public uploaded video.
  Existing launch flags, reporting, takedowns, and moderation remain required.
- `/api/media/capabilities` exposes the effective mode and policy requirements
  without secrets. It describes policy availability, not scanner/worker health
  or evidence of an authenticated upload succeeding.
- The restaurant Media pipeline is not switched to the interim policy.

## Future Thorn adoption

Choose `MEDIA_CSAM_MODE=vendor` only after implementing and validating the real
production vendor API/fingerprinting contract, configuring credentials, testing
safe/match/unavailable fixtures, and establishing the operational response.
`MEDIA_CSAM_CERTIFIED=true` remains a vendor-only assertion, not a Cloudflare
setting. Vendor mode rejects deferred assets; existing deferred videos need
actual screening and requeued processing before becoming public in that mode.

## Verification

Local focused tests cover interim worker processing without a fake vendor pass,
unchanged flagged/unavailable verdicts, strict vendor behavior, owner publication,
Didit revocation, processing/rendition gates, and admin approval. A PostgreSQL
test exercises the actual public-read predicates and mode transitions in CI's
disposable database. Live upload, Cloudflare cache coverage, and moderation
journeys require an authenticated account and remain separately unverified.

Executed locally: 6 Jest suites passed, 67 tests; the 8 disposable PostgreSQL
tests were skipped because this Windows session has no test database URL.
The CI workflow supplies that isolated database and runs all of those tests
alongside a full migration rehearsal. JavaScript syntax and `git diff --check`
passed. No browser interface copy was changed by this application update.

A follow-up test confirmed that conversion failure marks the asset failed and
refreshes the draft's aggregate state for the existing replacement/retry UI.
The focused safety-policy suite then passed all 20 tests.

Commands executed:

```text
cd server
npm test -- --runTestsByPath __tests__/mediaSafetyPolicy.test.js __tests__/mediaAccess.test.js __tests__/mediaContracts.test.js __tests__/mediaJourneys.test.js __tests__/mediaFeedRanking.test.js __tests__/mediaVisibilityDb.test.js __tests__/prerenderMarketing.test.js
npm test -- --runTestsByPath __tests__/mediaSafetyPolicy.test.js
```

JavaScript syntax checks covered the changed controllers, safety policy,
worker, route module, and prerender middleware; `git diff --check` passed.

CI for application commit `d45c3efa3138b97f03073beefbab14a55c721d94`
passed both Server and Client Verification and PostgreSQL migration rehearsal:
https://github.com/oxsteed/old-file/actions/runs/37774701476 . The server run
passed 464 suites / 5,112 tests, with 3 suites / 46 tests skipped. The Media
safety-policy and real PostgreSQL visibility suites specifically passed;
`STATEMENT_REQUIRE_DB_TESTS=true` required the disposable database tests.

Final live checks on 2026-10-08:

- `GET /api/media/capabilities`: 200; mode `cloudflare`, policy allows video
  publication, identity/malware/transcode requirements all true.
- `GET /ready`: ready; release `content-da1b83ca00b32c75`; all 737 migrations
  applied, zero pending, workers ready.
- `GET /api/media/feed?limit=1`: 200; empty feed with a valid pagination payload.
- `GET /media`: 200 after the deployment restart.
- Guest `POST /api/media/assets/video-uploads` with no file: 401 before upload.

The deployment metadata still omits its Git SHA, so these observations prove
the revised live policy and schema, not an exact deployed commit identity.
Authenticated upload/processing/playback and Cloudflare scanning coverage
remain unverified in production. No claim of full Media goal completion is
made from anonymous checks.
