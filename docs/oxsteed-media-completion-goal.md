# OxSteed Media completion evidence

The previous MVP completion report was premature. Passing generic CI does not
prove the full Media journeys. This document tracks the renewed completion goal
against the locked specification, retaining the v2/v3 release boundaries.

| Requirement | Current evidence / remaining work |
| --- | --- |
| Signed-in recognition, likes/bookmarks, two-way blocks | Public router now resolves optional sessions; shared browser API retains credentials/refresh; search grouping and actor aliases corrected. Route and PostgreSQL regression tests added; database and live execution pending. |
| Safe admin approval | Approval rejects uncertified, unverified, unprocessed or flagged video and removed posts; never rewrites asset verdicts or finishes worker jobs. Focused regression tests added; live verification pending. |
| Draft-to-publication uploads | Composer now creates a private durable draft, stores its ID for retry, restores draft text/links, shows previews/progress/status, keeps quarantined/failed drafts discoverable, refreshes processing state after a safety-pending response, attaches links idempotently, and publishes only after asset safety gates pass. Migration 735 adds the draft state; video drafts remain private while Didit/CSAM/transcode work is pending. End-to-end upload execution still needs live storage and worker verification. |
| Upload safety in all public surfaces | Audit all asset delivery, worker concurrency, multi-asset readiness, certification and identity gates. Admin override fixed first. |
| Nearby discovery and pagination | Feed ranking now uses a stable keyset cursor over valid-link, membership/city Space locality, timestamp, and post ID; page responses expose `has_more`. Actual city matching uses the viewer profile city and Space geo scope. Entity-level distance remains a live-data verification item. |
| Saved posts, reports, edit/delete | Added authenticated saved-post retrieval/page, report menu with rate-limited server endpoint, and owner-only body edit/soft-delete endpoints with count cleanup. Live authorization verification remains. |
| Accessible actions and entity picker | Added labels to action controls, keyboard-friendly report details, upload previews/progress, and read-only target IDs selected from server entity suggestions in compose and link editing. |
| Localized image-rich previews | Media post prerender now selects a public-safe stored thumbnail for OG/Twitter images and keeps localized document language/alternates; logo remains the fallback. |
| Five languages | Existing catalog parity passes; all new copy is covered in en/es/fr/ht/ar and JSON-parses. |
| Full user journeys | Targeted API coverage now exercises verified replies and notification delivery, guest/blocked visibility and hydrated action state, structured oversized-upload failures, Didit video gating, and pending draft recovery. Mobile playback remains covered by the `playsInline`/muted video path and still needs a real-device check. |
| CI and deployment | Push coherent changes, verify exact commit CI and deployed assets/runtime. Green CI alone does not close the goal. |

External prerequisite: production CSAM vendor certification must be independently
verified before enabling public uploaded videos. A configuration variable or
administrator decision is not evidence that a vendor contract is certified.
Follows, business/profile integration, restaurant federation and extra link types
remain v2; creator payments/boosts remain v3.

## First repair batch

Public reads now resolve optional authentication and share the normal client API
session/refresh behavior. Block predicates correctly group search alternatives
and use the actor table alias for profile lookups. Both block directions and
active-author checks apply to direct reads, Spaces and their counts, and targets
of replies, quotes, reactions and reports. Admin publication requires existing
safety clearance, Didit for video, certification and usable renditions; it does
not change screening verdicts or terminate processing jobs.

Local verification: 24 tests passed in `mediaAccess.test.js` and
`mediaContracts.test.js`. Seven PostgreSQL behavior cases in
`mediaVisibilityDb.test.js` are skipped locally because no disposable PostgreSQL
is available; CI must run them using its existing test database. They exercise
actual search/profile/Space SQL, both block directions, active authors and
hydrated personal action state.

`npm run build:ci` was attempted. Two Windows path/newline issues in existing
test harnesses were repaired; it now gets past those checks but stops at the
existing `themeContrast.test.mjs` post-job hero assertion (`undefined` versus
`#1d4ed8`). Separate `npm run build` and `npm run typecheck` both passed. Do not
equate this partial local verification with full CI or deployment completion.

Second repair batch local verification: 25 focused Media tests and 7 prerender/media tests passed; client typecheck and production build passed; locale JSON parity passed. CI run `37756637913` for the preceding safety batch passed both verification and migration rehearsal. Fresh CI run `37758766529` for commit `90531167` passed client/browser/admin checks, server regression and security tests, active-job checks, and the full PostgreSQL migration rehearsal including migration 735.

Live shell checks after the push: `/health` and `/ready` returned 200; `/media`, `/media/messages`, `/media/notifications`, `/media/communities`, `/media/bookmarks`, and `/media/compose` returned 200. The live readiness payload reported all migrations applied and workers ready. Authenticated storage, upload-worker, moderation, and owner-authorization journeys still need production credentials and a real test account; those are not claimed from anonymous checks. Do not enable public uploaded video until the production CSAM vendor prerequisite is independently certified.

Third repair batch local verification: 30 focused Media tests passed, including verified reply notification delivery, oversized-upload error mapping, Didit gating, revoked-verification publication denial, and quarantined-draft recovery. Client typecheck, production build, locale parity, server syntax checks, and `git diff --check` passed. The batch is ready for CI and deployment verification.

Post-push live asset check: the deployed Media compose chunk contains the
localized processing-status copy, durable processing-status data attribute, and
draft recovery path; the deployed post-card chunk contains `playsInline` and
`muted` video behavior. The production release metadata still omits a Git SHA,
so this confirms the deployed behavior but does not prove an exact commit
identity. Authenticated upload and owner flows remain unverified live.

Feed ranking coverage: `mediaFeedRanking.test.js` now exercises the ranked
link/locality ordering, two-way block predicate, and opaque cursor parameters
across a second page. The focused Media set is 31 tests passing locally; this
test still needs the next CI run for remote confirmation.

Live feed diagnosis and repair: an anonymous request to
`/api/media/feed?limit=1` returned HTTP 500 while the other Media shell routes
were healthy. The ranked link predicate referenced `jobs.deleted_at`, which is
not part of the current jobs schema; removing that invalid column reference
restores a schema-compatible job-link check. The regression test asserts the
feed SQL cannot reintroduce that reference. A read-only chronological fallback
now catches ranked-query read failures during rolling deployment, preserving
visibility and block filters while logging the primary error; a minimal safety
fallback handles an unavailable active-author predicate as a second boundary.
The focused Media set is now 33 tests passing locally.

Live follow-up after the rollout: `/api/media/feed?limit=1` returned HTTP 200
with `{ posts: [], next_before: null, has_more: false }`. The rendered
`/media` page initially retained its prior error state, but its Retry action
then loaded the empty-feed state (“Good things start locally” / “No updates
yet”). `/ready` was healthy with all 736 migrations applied and workers ready;
the release metadata still does not expose a Git SHA.

Nearby ranking now trims and compares both the viewer city and state against a
Space geo scope, with state omitted only when the Space has no state suffix.
The focused ranking regression covers that state-aware SQL alongside cursor
pagination and the fallback paths.

SEO hardening: the prerender helper now inserts a title when a production
template omits one, while preserving localized OG/Twitter images and Media
CollectionPage JSON-LD. The Media metadata regression suite passes 8 tests.

Admin approval now rechecks current actor eligibility for helper, business, and
restaurant actors before any approval write. A revoked verification returns
`media_not_verified_poster`; no post, asset, or audit row is mutated. The
focused Media authorization/safety suite now passes 20 tests, and the combined
Media API focus passes 34 tests.

Media accessibility coverage now asserts that inline video and mute controls
have accessible labels and that composer processing status is exposed with a
status landmark. The new client contract test passes locally; the existing
client typecheck was also run after the change.

Protected-route live check: anonymous requests to draft and bookmark retrieval
return 401, and anonymous photo/video upload requests return 401 before any
upload state can be created. Public feed reads continue to return 200. This is
guest-boundary evidence only; an authenticated production test account is still
required for owner, upload-worker, and moderation journey verification.

Live shell-route check: `/media/messages`, `/media/notifications`,
`/media/communities`, `/media/bookmarks`, and `/media/compose` each return
HTTP 200 through the Media shell. Their authenticated data interactions remain
covered by the existing client/server contracts and still need a signed-in
production session for end-to-end confirmation.

Media notification rows are now keyboard-operable with Enter/Space, retain a
visible list-item role, and expose the notification title as an accessible
label. The new client accessibility contract passes locally with the existing
client typecheck.

Localized share-preview repair: Media landing prerendering now reads the
existing `media.feed.metaTitle` and `media.feed.metaDescription` catalog keys
for `en`, `es`, `fr`, `ht`, and `ar`, while retaining the English fallback.
The Spanish regression verifies the document language, localized title and
description, `og:locale`, image metadata, and CollectionPage language. The
prerender marketing suite passes 9 tests locally.

Personal action-state repair: Media post cards now reconcile server-provided
like, bookmark, repost, and count fields when a post payload is replaced, and
their toggle buttons expose `aria-pressed`. This prevents stale viewer state
from surviving feed refreshes or reused card instances. The client contract
test covers the reconciliation and accessibility attributes.

Upload retry repair: selecting a replacement photo/video or external YouTube/
Vimeo link on a restored draft now clears the old attachment marker and resets
processing progress, so submit actually sends the replacement instead of
trying to publish a failed or quarantined asset again. The client contract
suite covers both replacement handlers.

Rollout-boundary repair: the API now keeps replies newest-first at launch even
if a caller sends `sort=relevant`; the later Relevant ranking is only available
when `MEDIA_RELEVANT_REPLIES_ENABLED=true` is explicitly configured. A server
contract test verifies the default launch behavior and SQL ordering.
