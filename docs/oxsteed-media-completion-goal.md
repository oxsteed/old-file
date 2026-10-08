# OxSteed Media combined implementation goal and completion evidence

## Current objective and strategy (2026-10-08)

Emile has authorized one combined implementation effort covering the complete
MVP, v2, and v3 scope. The former release boundaries no longer defer software
implementation. Build and integrate the features in dependency order within
this goal, using feature controls where needed for safe testing and activation.
Do not restart completed work or require an MVP-only release before implementing
v2 or v3. This update changes the plan; the goal is active and this document
records the revised scope and evidence that the active implementation must use.

**Replacement goal objective:** Complete, integrate, and verify all OxSteed Media
MVP, v2, and v3 features in one implementation effort, continuing from the
existing code and verification center. Deliver the local discovery feed and
post/reply/quote/repost/like/bookmark/view journeys; reliable uploads and
processing; linked local entities; real Spaces; existing notifications and
messaging; publisher verification; follows and a Following feed; Business Hub,
Profile Studio and public-profile Media integration; restaurant post copying;
tool rental, Direct service and Logistics campaign links; live counts and
Relevant reply sorting; and a creator marketplace with paid gigs, sponsorships,
OxSteed Credit tipping and paid boosts. Implement the marketplace before
activating paid boosts within this same goal. Apply the user-approved Cloudflare
interim video policy, retaining Didit, real malware scanning, quarantine,
conversion and moderation controls; defer Thorn adoption until demand justifies
its cost rather than making it a prerequisite for this implementation. Preserve
server authorization and Credit accounting safeguards. Localize all new UI in
five languages, complete accessible mobile journeys and share previews, record
requirement-by-requirement evidence, push coherent changes, obtain passing CI,
apply migrations through the established deployment process, and verify the
deployed behavior. Exercise financial flows in isolated environments. Track
unavailable provider approvals and live checks explicitly without claiming
them completed or treating them as a reason to defer independent software work.

## Combined scope and acceptance checklist

| Workstream | Required completion evidence |
| --- | --- |
| MVP publishing and discovery | Verified helper/business/restaurant posting; avatars, existing slugs and badges; media/mute controls; timestamps and views; all five actions and counts; quotes and newest-first replies; sticky reply entry; local ranking with correct pagination; up to five actionable local cards and disabled removed links; durable drafts, previews, progress, retry and processing states. |
| MVP navigation and protections | Search posts/accounts, actual city/category Spaces, notifications and existing messages within Media; saved posts, owner edit/delete, reports, two-way blocks, rate limits and launch controls; Didit and entity verification paths; shared public-read safety gates, admin permissions and audits; accessible mobile behavior, five languages and share previews. |
| v2 discovery and integration | Follow/unfollow and Following feed; Media in Business Hub, Profile Studio and public profiles; restaurant posts copied with ownership, safety and duplicate prevention; tool rentals, Direct services and Logistics campaigns as linked targets; live count reconciliation and Relevant sorting tested alongside newest-first. |
| v3 creator marketplace | Complete creator, buyer and admin journeys for paid gigs and sponsorships, including offers/acceptance, deliverables, completion, cancellations/refunds and disputes as applicable; disclosure, permissions and audit history; safe retries and provider-failure handling. |
| v3 Credit tipping and paid boosts | Integrate the existing Credit accounting and activation controls; preserve precision, currency boundaries, wallet isolation, transactional writes, idempotency and append-only ledger history; verify tipping and boost purchase/delivery/refund behavior in isolation. Implement marketplace dependencies before boost activation, with transparent sponsored placement that retains local relevance. |
| Video policy and future provider transition | Verify Cloudflare interim mode honestly without claiming upload-time video screening; demonstrate Didit, malware, quarantine, conversion, publication and playback paths; retain the documented future vendor transition. Thorn is deferred by the user's cost/demand decision. |
| Integration and delivery | Each feature has meaningful behavior coverage and current evidence; all new migrations rehearse safely; CI passes for the pushed commit; deployed schema/assets/runtime and authenticated user/admin journeys are verified. External/provider or real-device checks still unavailable are itemized rather than silently marked complete. |

Current baseline: verification alignment commit `00576a18` and publisher
verification center commit `53f5b0f4` are pushed. The center includes Didit return
navigation, owned business/restaurant request submission and status, migration
737, and transactional admin decisions with auditing. CI
[37782637913](https://github.com/oxsteed/old-file/actions/runs/37782637913)
passed client/browser/admin checks, server regression/security checks, and the
PostgreSQL migration rehearsal. Deployment and authenticated live verification
of these new paths remain open; passing CI does not establish their deployment.

Following implementation batch (2026-10-08): the existing `media_follows` table
now has its actor-count index in migration 738. Media exposes authenticated
follow/unfollow actions with reciprocal block and active-author visibility,
self-follow prevention, follower counts, follow notifications and stable
idempotency. Actor pages show current follow state and a localized control. Home
now has a signed-in Following tab; its feed filters to followed actors while
retaining the same safety, active-author, block and cursor-pagination predicates
as the local feed. Focused `mediaFollows.test.js` and `mediaContracts.test.js`
pass locally (13 tests). CI, migration deployment and authenticated live follow
checks remain open.

On resumption, reconcile existing code against this checklist, record the next
exact action for each missing feature, and build the combined scope in coherent
batches. Earlier evidence below is retained as history; current strategy and
the current safety policy take precedence over old rollout restrictions.

Current policy and latest application evidence (2026-10-08): the user-authorized
Cloudflare interim update is implemented and pushed in `ac5ca62c` / `d45c3efa`.
CI run [37774701476](https://github.com/oxsteed/old-file/actions/runs/37774701476)
passed verification and migration rehearsal, including actual PostgreSQL Media
visibility tests. Production reports Cloudflare mode, the new schema (737
migrations), and required identity/malware/transcode controls. See
[Media safety policy](oxsteed-media-safety-policy.md) for commands, observations,
and the remaining authenticated-upload/live-coverage limitations.

Verification alignment update (2026-10-08): Media now uses `users.is_verified`,
the flag written by the Didit approval webhook, for helper actor creation,
video upload, publication, public video visibility, entity search, and admin
approval. The super-admin identity action sets the same flag and keeps the
helper profile badge synchronized. Business and restaurant posting continue to
use their entity-level `is_business_verified` and `is_verified` flags.

Verification path implementation (2026-10-08): the signed-in Media shell now
exposes `/media/verification`. Helpers are sent through the existing Didit
identity flow and can return to Media; business and restaurant owners see the
entities they own, submit an auditable verification request, and resubmit when
an administrator asks for changes. Migration 737 adds the request table with
an active-request uniqueness guard. Admin Media routes list and review requests
under the existing `verify_users` permission; approval updates the existing
entity verification flag in the same transaction as the audit record.
The existing `/admin/media-flags` workspace now exposes the pending request
queue to administrators who have that grant.

Passing generic CI does not prove the full Media journeys. This document tracks
the combined MVP, v2, and v3 goal against the specification and the user's
subsequent strategy and safety-policy revisions.

| Requirement | Current evidence / remaining work |
| --- | --- |
| Signed-in recognition, likes/bookmarks, two-way blocks | Public router now resolves optional sessions; shared browser API retains credentials/refresh; search grouping and actor aliases corrected. Route and PostgreSQL regression tests added; database and live execution pending. |
| Safe admin approval | Approval follows the revised interim Cloudflare/vendor policy and rejects unverified, unprocessed or flagged video and removed posts; never rewrites asset verdicts or finishes worker jobs. Focused regression tests added; live verification pending. |
| Draft-to-publication uploads | Composer now creates a private durable draft, stores its ID for retry, restores draft text/links, shows previews/progress/status, keeps quarantined/failed drafts discoverable, refreshes processing state after a safety-pending response, attaches links idempotently, and publishes only after asset safety gates pass. Migration 735 adds the draft state; video drafts remain private while Didit/CSAM/transcode work is pending. End-to-end upload execution still needs live storage and worker verification. |
| Upload safety in all public surfaces | Audit all asset delivery, worker concurrency, multi-asset readiness, certification and identity gates. Admin override fixed first. |
| Nearby discovery and pagination | Feed ranking now uses a stable keyset cursor over valid-link, membership/city Space locality, timestamp, and post ID; page responses expose `has_more`. Actual city matching uses the viewer profile city and Space geo scope. Entity-level distance remains a live-data verification item. |
| Saved posts, reports, edit/delete | Added authenticated saved-post retrieval/page, report menu with rate-limited server endpoint, and owner-only body edit/soft-delete endpoints with count cleanup. Live authorization verification remains. |
| Accessible actions and entity picker | Added labels to action controls, keyboard-friendly report details, upload previews/progress, and read-only target IDs selected from server entity suggestions in compose and link editing. |
| Localized image-rich previews | Media post prerender now selects a public-safe stored thumbnail for OG/Twitter images and keeps localized document language/alternates; logo remains the fallback. |
| Five languages | Existing catalog parity passes; all new copy is covered in en/es/fr/ht/ar and JSON-parses. |
| Full user journeys | Targeted API coverage now exercises verified replies and notification delivery, guest/blocked visibility and hydrated action state, structured oversized-upload failures, Didit video gating, and pending draft recovery. Mobile playback remains covered by the `playsInline`/muted video path and still needs a real-device check. |
| Publisher verification paths | Media verification center, Didit return path, business/restaurant request storage, ownership checks, resubmission after `needs_changes`, and transactional admin approval are implemented. Focused controller tests pass; live authenticated request and admin review still need deployment verification. |
| CI and deployment | Push coherent changes, verify exact commit CI and deployed assets/runtime. Green CI alone does not close the goal. |

Policy revision authorized by Emile on 2026-10-08: Cloudflare is the interim MVP
control, and Thorn is deferred until demand justifies its cost. This supersedes
the earlier vendor-certification launch prerequisite in the historical evidence
below. Cloudflare is not represented as upload-time video screening. See
[Media safety policy](oxsteed-media-safety-policy.md) for the current application
rules and future vendor-mode activation requirements.

Malware provider evidence (2026-10-08): upload scanning is wired to the private
ClamAV `clamd` service in `docker-compose.coolify.yml` (`clamav/clamav:1.5-
debian13-slim`) through the `CLAMAV_HOST`/`CLAMAV_PORT` configuration. The
scanner uses the INSTREAM protocol and fails closed when malware scanning is
required or when the configured daemon is unavailable. The local
`fileScanService` and upload-failure suites cover clean, infected, unavailable,
and malformed verdicts. Production health and an authenticated uploaded-video
scan/processing check still need to be captured after the deployment billing
block is cleared.

Delivery evidence (2026-10-08): commits `b8a58eb9` and `598ab92c` are pushed to
`old-files-claude`. Local creator, Media contract, malware-scan, upload-failure,
and migration-recovery suites pass (27 tests in the combined run). CI run
`37794549189` was created for `598ab92c` but the verification job was rejected
before starting with GitHub's account billing message about failed recent
payments or an exceeded spending limit. This is recorded as an external CI
availability blocker; it is not treated as a passing run or as evidence that
deployment is complete.

The same pre-start billing rejection was reproduced for the later UI and
sponsorship commits (`37795836625` for `c24910fa` and `37796160256` for
`193227d1`); no code job ran for those commits.
Follows, business/profile integration, restaurant post copying, extra link types,
creator payments and boosts are all in the current implementation goal. The
v2/v3 labels identify feature groups, not a requirement to postpone their build.

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

Media shell navigation repair: account results in Media Search now use the
client router instead of a full-page anchor, preserving the Media shell while
opening an actor profile. The client contract suite covers this route behavior.

External safety evidence (2026-10-08): the supplied Cloudflare zone screenshot
shows the CSAM Scanning Tool enabled for `oxsteed.com`. Cloudflare documents
that this service hashes images served through its cache and can block matched
URLs; it does not establish upload-time video screening, transcode safety, or a
certified production Media vendor. The application therefore continues to
keep public uploaded video gated by `MEDIA_CSAM_CERTIFIED` until that separate
video-screening certification and operational response evidence are recorded.

Combined-rollout link coverage (2026-10-08): Media now accepts and searches all
specified linked-entity types: restaurants, dishes, helpers, businesses, jobs,
tool rentals, Direct catalog services, and open logistics campaigns. Link
hydration and the ranked-feed validity predicate only make currently available
targets clickable; removed, unpublished, unavailable, or closed targets remain
as non-clickable snapshots. Compose and owner link editing expose the same
eight types. The focused Media contract/follow suites pass 13 tests locally;
the pushed CI run 37787111951 passed both server/client verification and the
PostgreSQL migration rehearsal. This batch still needs deployment and an
authenticated live linked-card journey before the full goal can be marked
complete.

Profile integration repair (2026-10-08): Profile Studio's existing Media
section requests the signed-in owner's posts through `tab=mine`; the API now
supports that scoped feed with the same public-safety, active-author and block
filters as Home. Guests receive a dedicated authentication response, and the
focused follow/contracts suite now passes 15 tests locally. Business Hub's
existing business-scoped Media tab continues to use the owner-checked business
actor endpoint. Public helper and business profile presentation still needs a
live browser check and any missing visible Media tab wiring should be recorded
before completion.

Public profile integration (2026-10-08): helper and business public profile
surfaces now expose a localized link into the matching Media actor page inside
the Media shell, using the existing profile slug or stable entity ID. The
client typecheck and production build pass after this addition. A signed-out
browser check of the links and an actor with published content remain required
to verify the full public-profile journey.

Restaurant federation slice (2026-10-08): migration 739 links each restaurant
Media row to at most one OxSteed Media post with a unique source key, making
retries idempotent. YouTube/Vimeo links create ready external assets; scanned
photo uploads create ready image assets; uploaded videos create an unlisted,
quarantined Media asset and queue Media CSAM/transcode jobs. Restaurant deletes,
moderation removals, and DMCA takedowns remove the federated post as well. The
existing restaurant upload contract suites pass; the video worker tests remain
environment-dependent when FFmpeg is unavailable on the local Windows host.
Migration rehearsal, CI, and an authenticated live restaurant-to-Media journey
remain required before this requirement can be marked complete.

Creator marketplace foundation (2026-10-08): migration 740 and Media routes now
cover verified creator gigs, applications, awards, published-post deliverables,
review states, sponsorship offers, creator tips, and post boosts. Tip settlement
uses the existing append-only Credit transfer service with idempotency and the
same rail limits/sanctions checks; all money-bearing rows remain
`pending_credit` until that guarded transfer succeeds, and boosts cannot be
active before settlement. Focused Credit, Media contract, migration, and source
syntax checks pass locally. A client creator surface, full Credit-enabled
settlement journey, CI, and deployed verification remain open evidence.

Creator surface (2026-10-08): `/media/creator` now opens inside the Media shell,
lists open opportunities, and lets signed-in verified creators submit a pitch
and proposed amount without leaving Media. The route and copy are wired across
all five locale catalogs. Signed-in owners also get an in-shell form to publish
a gig after the server verifies their current business or restaurant identity.
Client typecheck and production build pass; application review and settlement
journeys still need authenticated deployment evidence.

Creator settlement hardening (2026-10-08): sponsorship acceptance now
rechecks the creator's current verification, sponsorship settlement repeats that
check immediately before the guarded Credit transfer, and post-boost settlement
transfers funds idempotently before scheduling the 24-hour boost window. New
contract coverage verifies accepted offers and blocks settlement after
verification is revoked. Local creator tests now pass 4 tests; the Credit
rail's deployment flag, authenticated settlement journey, CI, and live
deployment evidence remain open prerequisites.

Creator support UI (2026-10-08): the in-shell Creator Marketplace now exposes
localized tip and sponsorship actions on each open gig. Tips create a durable
pending Credit row and immediately request its idempotent settlement; sponsorship
offers remain pending until the verified creator accepts them. The client API,
five locale catalogs, typecheck, production build, and i18n parity checks pass.
Live Credit authorization, acceptance, settlement, and failure/retry behavior
still require authenticated deployment evidence.

Owner boost UI (2026-10-08): public ready posts owned by the signed-in user
now expose an accessible Boost action in the post card. The dialog creates a
pending boost and requests the idempotent Credit settlement before the API can
schedule its 24-hour placement window; failed rail authorization remains
visible to the owner. The five localized labels, client typecheck, i18n parity,
and production build pass locally. No boost is active without the server-side
public/safety/ownership checks and a completed Credit transfer.

Sponsorship review UI (2026-10-08): signed-in creators and sponsors can now
load their sponsorship offers inside `/media/creator`; the creator can accept
an offer only while current verification is valid, and the sponsor can then
settle it through the existing guarded Credit route. The API query is limited
to the two parties, and the focused controller suite now passes 5 tests.
Authenticated Credit settlement and deployment verification remain open.

Gig review UI (2026-10-08): gig owners can open an in-shell application list,
review pitches and proposed amounts, and award one applicant; the server then
closes the gig and rejects competing submitted applications transactionally.
The creator controller suite covers the API contract, and client typecheck and
locale parity pass. Deliverable submission/review and authenticated deployed
award journeys remain next verification work.
