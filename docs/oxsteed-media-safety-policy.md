# OxSteed Media interim safety policy — 2026-10-08

Emile revised decision #12 in `oxsteed-media-spec.md`: the enabled Cloudflare
CSAM Scanning Tool is accepted as the interim MVP control. Thorn Safer is
deferred until Media demand justifies its cost. This decision replaces the
previous requirement that a certified upload-screening vendor must precede
public Media video publication. v2/v3 commerce boundaries remain unchanged.

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
