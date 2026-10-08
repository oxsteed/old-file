# OxSteed Media combined implementation goal and completion evidence

## Current objective and strategy (2026-10-08)

Execution resumed under the user-approved
[four-batch plan](oxsteed-media-execution-plan.md). The following matrix replaces
broad completion claims. State vocabulary: **implemented** means current source
exists; **behavior-tested** means the specified behavior actually ran;
**verified live** requires exact deployed evidence; **incomplete** includes
partial implementations and missing verification. No row below is marked
verified live for the new candidate. A historical test count is not proof.

### Current requirement-level work and evidence

| Requirement | State and implementation / behavioral evidence | Deployment / dependency | Next exact action |
| --- | --- | --- | --- |
| Reconciled source and retained work | Behavior-tested: writable checkout HEAD `95e844cb` matches the pushed branch; three pre-existing untracked browser scratch files remain preserved. | Runtime release metadata still exposes content identity but no git SHA. | Keep the scratch files untracked and compare release metadata at each deployment checkpoint. |
| Repeatable isolated fixtures | Implemented: optional Media compose extension, scoped wrapper, synthetic persona seed and real API/scan/conversion verifier. | Not executed here: Windows host has no reachable Colima/Docker runtime. | Execute `start`, `seed`, `media-test` on Colima and capture repeat/reset evidence. |
| Required real database proof | Behavior-tested in hosted CI: `mediaVisibilityDb.test.js` and `mediaDraftAttachmentsDb.test.js` both ran without skips against disposable PostgreSQL; the migration rehearsal also applied every migration twice and exercised concurrent recovery. | Local Windows checkout still has no disposable PostgreSQL runtime. | Preserve the CI database assertion and rerun it for each candidate. |
| Helper Didit-backed identity | Implemented: `users.is_verified` checks at upload and commit; mocked behavior covers revocation at attachment commit. | Authenticated Didit return and production upload outstanding. | Prove webhook → verified helper → compose in isolated/live journeys. |
| Business and restaurant verification | Incomplete: request center/admin review exist; source now binds publishing, admin approval and marketplace recognition to the exact represented entity via `mediaPublisherPolicy`; real request/revocation execution remains outstanding. | Current flags and review on deployed candidate unverified. | Execute the added PostgreSQL multiple-entity, revocation, approval and legacy-migration cases. |
| Verification request and return path | Implemented in prior source: in-shell center, owner submission, admin review and Didit return. | Fresh real API and signed-in deployed evidence outstanding. | Run helper/business/restaurant/admin request and return matrix. |
| Durable private drafts | Behavior-tested locally: maintained desktop/mobile browser check retains edits and draft ID across upload failure/retry. | Browser dependencies mocked; real API harness unexecuted. | Execute real draft restore/update/attachment/publication path. |
| Attachment replacement and duplicate recovery | Behavior-tested locally: locked draft service, server-computed digest, failed attachment/job deletion, file replacement and duplicate reuse. | Migration 742 and real concurrent PostgreSQL cases outstanding. | Run DB suite and isolated worker replacement/retry journey. |
| Post-publication attachment protection | Behavior-tested locally: preflight plus locked recheck reject public/deleted/unowned drafts; race test specified in PostgreSQL. | PostgreSQL race and live boundary outstanding. | Execute concurrent upload/publish test and guest asset reads. |
| Stored-file cleanup and lost responses | Behavior-tested locally: thumbnail failure cleanup, preserve committed files after signing/commit response loss, defer cleanup on DB outage. | Real storage outage/recovery outstanding. | Exercise storage interruptions inside disposable environment. |
| Actual file content and external URLs | Behavior-tested locally: existing magic-byte checks and strict HTTPS host/video-ID parsing/canonicalization; lookalike hosts rejected. | Actual scanned upload journey outstanding. | Run valid/spoofed photo/video API cases against isolated storage. |
| Malware, quarantine and conversion | Implemented: real scanner required; jobs and shared aggregate state preserve safety verdicts. | ClamAV/FFmpeg included in optional harness but not run here. | Execute real clean/infected/unavailable scan and successful/failed conversion. |
| Preview, progress, processing and retry | Behavior-tested locally: composer browser cases cover failure and ready transition; video jobs now use expiring leases, fenced completion and bounded retry scheduling so crashed workers can be reclaimed safely. | Real ClamAV/FFmpeg worker execution and real-device playback outstanding. | Execute long processing, replacement, stale-lease recovery and mobile playback in the isolated environment. |
| Publication/public-delivery/admin safety predicates | Incomplete: common policy exists; admin cannot rewrite asset verdicts; sticky flagged replacement test passes. | Full public-storage and admin race proof outstanding. | Audit and test publication, storage delivery, moderation and copying together. |
| Post identity, badges, handles, time and views | Implemented in existing card/actor source; complete entity recognition audit remains. | Fresh cross-surface browser/API proof outstanding. | Verify all actor types and counts in feed/search/detail/profile. |
| Replies and sticky entry | Implemented: newest/relevant source and sticky entry exist. | Real unverified reply, notification and mobile keyboard proof outstanding. | Test newest ordering, eligible replies and sticky composer in all languages. |
| Quotes and embeds | Implemented: quoted content/media and linked cards rendered. | Real blocked/removed quoted-target proof outstanding. | Exercise safe quoted hydration and removal across feeds. |
| Reply/repost/like/bookmark/share counts | Incomplete: actions exist, with viewer state; full response/retry/concurrency coverage outstanding. | Exact deployed count behavior unverified. | Verify every action/count and personal state through actual APIs. |
| Owner/viewer state on all responses | Implemented: owner identity now included in feed, search, actor, replies, quotes and business-post responses; real cross-surface execution remains outstanding. | No fresh authenticated cross-surface proof. | Run the actual owner/viewer response matrix, including quoted and saved posts. |
| Saved posts | Implemented: authenticated API/page exists. | Real reload/removal/block proof outstanding. | Test bookmark → saved feed → unsave and blocked/removed exclusion. |
| Reporting and automatic moderation | Implemented: report API, limits and existing moderation flow. | Actual repeat/limit/DMCA/admin proof outstanding. | Verify report caps, moderator permissions and resulting visibility. |
| Owner editing/deletion | Implemented: owner endpoints and actions exist. | Real authorization/count/source propagation outstanding. | Test owner versus non-owner, quoted/reply counters and source removal. |
| Two-way blocking and inactive authors | Incomplete: unsafe minimal fallback removed; failure preserves author/block restrictions; fresh actual SQL proof for all surfaces remains outstanding. | Existing PostgreSQL suite must run for candidate. | Execute all real PostgreSQL visibility cases and blocked target/action paths. |
| Daily/upload/report limits | Implemented: existing rate/count controls. | Concurrent actual API limit proof outstanding. | Test simultaneous post limits and structured upload/report rejection. |
| Linked entity selection and five-card limit | Implemented: server search and composer selection exist. | Real invalid/removed/entity ownership and currencies outstanding. | Verify all eight link types and authoritative target metadata. |
| Public cards versus transaction login | Behavior-tested locally: all formerly intercepted guest card types now navigate to public targets; removed cards remain inert. | Browser dependencies mocked; destination transaction gates outstanding. | Verify actual public pages and login at transaction start. |
| City/category Spaces | Implemented in current source. | Real channel filters, membership and counts outstanding. | Run actual database/browser city/category/membership matrix. |
| In-shell notifications and messages | Implemented in current source. | Actual replies/likes/inbox links and account sessions outstanding. | Exercise existing activity systems within Media for each persona. |
| Navbar/account/footer/legal navigation | Implemented in current source. | Signed-in/out, cookies, keyboard and Arabic proof outstanding. | Include navigation and legal dialogs in browser matrix. |
| Accessibility and five languages | Incomplete: existing catalogs and labels, but full error/keyboard/RTL audit outstanding. | Build/parity and Arabic/mobile matrix required for candidate. | Run build, localization parity, keyboard and RTL checks per batch. |
| Image-rich share previews | Implemented in prior prerender source. | Current safe assets/localized real share previews outstanding. | Verify guest-safe image metadata in every language after build. |
| Nearby coordinates and city/state fallback | Behavior-tested locally: entity coordinates from helpers, businesses, restaurants, jobs and linked targets rank nearby; explicit city/state matching remains available and removed entities lose their boost. | Real PostgreSQL locality cases are specified but skipped on this Windows host. | Execute the locality suite in the isolated PostgreSQL environment and verify deployed entity schemas. |
| Guest and device location choices | Behavior-tested locally: guests can choose city/state, use device location only after an explicit action, persist a rounded choice, return to profile location, or select all locations. | Real-device permission and deployed session evidence outstanding. | Verify permission denial, Arabic layout and mobile behavior in the release matrix. |
| Versioned context-bound feed cursor | Behavior-tested locally: cursor includes version, tab, viewer, location, ranking mode, cutoff and microsecond timestamp; changed context returns a recoverable 400; fallback preserves its chronological mode and cutoff. | Real complete-pagination proof is skipped without PostgreSQL. | Execute isolated ranked and fallback pagination cases, then verify candidate deployment. |
| Stale tab responses and duplicates | Behavior-tested locally: generation guards discard out-of-order tab/location responses and page appends deduplicate post IDs. | Browser test uses mocked API; production race evidence outstanding. | Verify rapid tab/location changes against the deployed API. |
| Follows and Following | Implemented in existing source. | Real block/follow/paging and actor-count proof outstanding. | Run actual SQL and browser tab-switch journey. |
| Live authoritative counts | Behavior-tested locally: the shared Socket.IO lifecycle now exposes a read-only `/media` namespace, action endpoints broadcast committed post counters, and feed/detail cards reconcile those counters without mutating state from socket events. | Authenticated live multi-client count proof remains outstanding. | Verify two signed-in/guest browsers receive the same committed counts and recover after reconnect. |
| Business Hub integration | Implemented in prior source. | Actual selected-business authorization/navigation outstanding. | Verify Media posting and history for owned entities. |
| Profile Studio/public-profile integration | Implemented in prior source. | Actual safe profile tabs and guest behavior outstanding. | Test profile editing/navigation and public safe posts. |
| Rentals/Direct/Logistics cards | Implemented in current link resolvers/search. | Actual public targets/removal/currency proof outstanding. | Seed and verify additional types alongside launch types. |
| Restaurant copy/ownership/deduplication | Implemented in prior source/migration 739. | Real source moderation/removal propagation incomplete. | Test and repair safe idempotent copy plus removal propagation. |
| Creator/buyer dashboards and opportunities | Behavior-tested locally: creator shell lists offers, open gigs and applications; sponsorship offers now support acceptance, deliverable submission and settlement controls. | Real full dashboard journey outstanding. | Verify authenticated creator/buyer/admin dashboards live and add remaining marketplace status/history views. |
| Applications and award/acceptance | Behavior-tested locally: existing transactional award path reserves the approved amount and rejects competing applications; concurrent production proof remains outstanding. | Real concurrent authorization/limits outstanding. | Execute isolated race cases and verify authenticated deployment. |
| Deliverable revisions and approval | Behavior-tested locally: awarded gig deliverables and sponsorship deliverables expose owner checks, publish/ready validation and review transitions; full revision matrix remains outstanding. | Real revision/concurrent approval proof missing. | Implement and test any remaining revision states across gig and sponsorship UI. |
| Gig reservation and payment | Behavior-tested locally: award reserves Credit, approved deliverables settle once, and cancellation/rejection releases the reservation. | Isolated accounting and live execution still required. | Re-run conservation/replay cases in disposable PostgreSQL and verify deployed payment history. |
| Sponsorship reservation/delivery/payment | Behavior-tested locally: acceptance reserves funds, creators submit a published ready deliverable, settlement requires `delivered`, and cancellation releases an active reservation. | Credit isolated accounting and authenticated live proof outstanding. | Execute sponsorship reserve/settle/release races and verify the deployed journey. |
| Tips | Implemented and behavior-tested locally: tips use durable payload-bound idempotency and settle through the shared creator settlement rail with verification and self-payment guards. | Real currency/freeze/fee/replay proof missing. | Run isolated accounting replay/failure cases and verify live transaction history. |
| Cancellation/release/refund/dispute review | Behavior-tested locally: creator payments now expose their latest Credit dispute state, hide duplicate dispute actions while a case is open or under review, and add a Media-scoped administrator queue that routes review, compensation and resolution through the shared audited Credit service. | Real accounting and authenticated administrator proof required. | Run the isolated reserve/release/refund/dispute matrix and verify the deployed Media admin queue. |
| Boost payment to platform revenue | Implemented and behavior-tested locally: purchaser wallet is charged through the shared settlement rail into `platform_revenue`; self-transfer and replay are rejected. | Real accounting and deployed proof outstanding. | Verify conservation, idempotent retries and platform ledger history in the isolated/live release checks. |
| Sponsored placement and 24-hour duration | Behavior-tested locally: active settled boosts receive a separate ranked lane inserted at positions 5, 10, and so on; organic ordering remains stable, ranked cursors carry `feed_position`, and cards show a localized sponsored label only during the active window. | Real active-boost database cases and deployed feed proof remain outstanding. | Run isolated expiry/replay/cap cases and verify live placement. |
| Price/currency disclosure and purchaser history | Behavior-tested locally: boost confirmation returns amount/currency before settlement, and the Media creator shell now lists tip, sponsorship and boost payment history with transaction-linked dispute entry points. | Payment retry/cancellation/refund and authenticated live history proof missing. | Add admin refund review and verify purchaser/creator history against deployed Credit records. |
| Atomic accounting/precision/fees/isolation | Incomplete for marketplace: shared rail safeguards exist, transitions are not fully atomic with payment. | Real isolated conservation/races/currency cases required. | Add transactional marketplace service and accounting behavior suites. |
| Migration upgrade and repeat application | Implemented: new 742, 743, 744 and 746 filenames follow inspected predecessors; 746 adds creator payment reservation/transaction links and delivery metadata. | Actual 746 migration execution is pending hosted CI/deployment. | Rehearse against disposable upgraded schema and repeat without data changes. |
| Cloudflare interim and deferred Thorn | Implemented: retained explicit interim status; no synthetic vendor clearance. | Real runtime/public-delivery proof outstanding. | Keep honest policy disclosures and future vendor switch tests. |
| Passing exact-candidate CI | Behavior-verified: candidate `95e844cb` passed CI run `37842488994`; the full server/client job and the PostgreSQL migration rehearsal both passed. | Hosted CI is available again; authenticated production behavior is still separate evidence. | Keep the run linked to the batch and require a new passing run before each later push. |
| Exact deployed release/readiness/schema/assets | Behavior-verified live after the candidate checkpoint: `/ready` and `/health` returned 200; `/ready` reported release `content-94eb0730a824dca6`, migrations `747/747`, no pending/unexpected migrations, healthy database/Redis/Credit/realtime/workers; Media feed and capabilities returned 200. | Coolify release metadata does not expose the git SHA, so exact commit-to-image identity remains unavailable. | Obtain release SHA or reproducible asset identity from deployment metadata and verify authenticated journeys. |
| Authenticated production/real-device matrix | Incomplete. | Signed-in helper/business/restaurant/admin and real device access outstanding. | Capture full non-financial production journeys; reconcile finance read-only. |

Current local execution: all 165 Media behavior checks passed in 13 suites;
18 PostgreSQL cases in two suites skipped because no disposable PostgreSQL is
available locally. Four maintained Chromium browser journeys passed, covering
desktop and 390px composer recovery, guest public-card navigation, tab/location
races and explicit device-location choices. The CI
result checker, existing Credit fixture regression, fixture isolation rejection,
shell syntax and `git diff --check` passed. `npm run build:ci` passed localization,
TypeScript, production bundling and verification of 760 assets. A broader local
server run encountered existing non-Media Windows/FFmpeg/SQL-artifact failures
and was stopped; it is not a passing full-suite result. Isolated ClamAV/FFmpeg
execution, candidate CI and deployed verification remain outstanding. The
baseline CI check still reports a pre-start billing rejection; canonical `/ready`
currently reports healthy release `content-840a33b23300d6be`, which is not proof
that the new changes deployed. No completion claim is made.

Publishing/identity checkpoint: shared entity-specific verification now covers
ordinary publication, admin approval and creator recognition. Previously created
unverified reply actors no longer strand a subsequently verified helper. New
entity actors retain their profile slugs and exact entity IDs, badge state is
reconciled, and conflicting handles cannot take over another owner/entity.
Migration 743 backfills only unambiguous historical handles and has a replay
case. Owner state is returned on all post-list surfaces. Ranked pagination now
uses a subquery and full PostgreSQL timestamp precision; safety failures cannot
fall back to weaker author restrictions. These are current source/local behavior
results; the added real SQL cases remain skipped on this Windows host.

The first integrated push is `89fc8aa0`. Its exact CI run
[37820019828](https://github.com/oxsteed/old-file/actions/runs/37820019828)
was rejected before any steps: GitHub reports failed recent payments or an
exceeded spending limit. The migration job was skipped. This is an external CI
availability condition, not a passing test result. Continue independent code
work; do not call either implementation batch accepted or the full goal complete.


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
| Accessible actions and entity picker | Added labels to action controls, keyboard-friendly report details, upload previews/progress, and server-backed entity selection in compose and link editing without exposing manual target IDs. |
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

The deliverable lifecycle push (`7dcde21c`) was likewise rejected before job
startup in CI run `37797458742` for the same account billing reason. Local
verification therefore remains the only current evidence for this slice.

The cancellation safeguards push (`e7b0ca3a`) hit the same pre-start billing
rejection in CI run `37798153624`; no remote test or migration job executed.
The creator dispute and settlement push (`dea57de4`) was rejected before job
startup in CI run `37800225510` for the same account billing reason; its
PostgreSQL rehearsal was skipped. The local `build:ci` and focused server
evidence above remain valid, but this commit has no remote CI confirmation.
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

Rollout-boundary repair (superseded by the combined strategy): the API and
detail page now support both newest-first and Relevant reply ordering in the
same implementation. The current contract test verifies Relevant SQL ordering;
unknown sort values still fall back safely to newest-first.

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

Deliverable lifecycle UI (2026-10-08): applicants can see their awarded Media
applications, choose one of their own published posts from a server-loaded list,
and submit it with a note; gig owners see the latest deliverable state and can
approve it or request changes. The server keeps ownership, public-ready-post,
and awarded-application checks in place, while the focused creator suite now
passes 6 tests. Client production build and authenticated deployed deliverable
verification remain required.

Creator cancellation hardening (2026-10-08): unsettled sponsorships can be
cancelled by either party, settlement transitions accepted sponsorships to
`completed`, and pending boosts can be cancelled before Credit settlement.
Settled boosts remain protected from cancellation. The focused creator suite
now passes 7 tests; refund/dispute handling for completed Credit transfers and
authenticated production verification remain open.

Creator payment disputes (2026-10-08): settled tips, sponsorships, and boosts
now have an authenticated `/media/creator/disputes/:kind/:id` entry point. The
server resolves the payment's own posted transfer by its Media reference and
requires the original payer, so callers cannot submit arbitrary Credit
transaction IDs or open a case for another customer. Requests require a
description and Idempotency-Key, then reuse `openCreditDispute` for the shared
one-open-case rule, audit event, SLA, and admin resolution flow. The current
Credit schema has no marketplace-specific dispute taxonomy, so the endpoint
uses the existing `incorrect_amount` type and records the detailed reason in
the description until that taxonomy is approved. Focused creator and contract
tests now pass 18 tests locally; authenticated dispute resolution and the
provider/CI deployment checks remain open.

Anonymous production evidence (2026-10-08): `/health`, `/ready`,
`/api/media/capabilities`, and `/api/media/creator/gigs` returned 200. The live
capabilities report Cloudflare safety mode with malware and transcode required;
the ready payload reports all workers healthy and 741 migrations applied. The
current source checkout contains migrations through 740, so that live schema
count is recorded as a deployment/source discrepancy requiring reconciliation,
not as proof that this branch is deployed. Authenticated Media and Credit
journeys remain unverified.
Verification update (2026-10-08): client `npm run build:ci` now passes after
making the theme-contrast selector check line-ending independent; it completed
the full frontend reference, localization, typecheck, production build, and
dist-asset gates. The focused server creator/contracts suite passes 18 tests,
and the creator dispute UI/API remains pending authenticated deployment and
Credit-rail evidence.

Entity-link picker hardening (2026-10-08): new-post and owner-link-edit flows
now require choosing a result from the server-backed OxSteed entity search
before adding a Linked on OxSteed card. The raw target-ID field is no longer
shown, stale selections are cleared when the type or search text changes, and
the selected entity is announced to assistive technology. The five locale
catalogs include the validation and selection status copy. `npm run verify:i18n`,
`npm run typecheck`, the focused Media contract/creator suite (18 tests),
`git diff --check`, and `npm run build:ci` all pass locally. Authenticated
production entity search and owner-edit journeys remain live verification work.

Hosted verification (2026-10-08): GitHub Actions CI run `37802171707` for
commit `5c1a55cf` passed both `Server and Client Verification` and the
`PostgreSQL migration rehearsal`. This is the first passing hosted run after
the earlier account-billing failures; it includes the browser, server, build,
and migration gates for this change.

Pagination correction (2026-10-08): ranked, Following, and fallback feed
queries now fetch one look-ahead row, return only the requested page, and set
`has_more`/`next_before` only when another visible row exists. The focused feed,
contract, and follow suites pass 19 tests locally, including an exact-page
regression case. Hosted CI run `37804524024` for commit `ff447903` passed both
Server and Client Verification and the PostgreSQL migration rehearsal.

Actor-page localization (2026-10-08): Media actor loading, missing-profile, and
empty-post states now use the shared `media.actor` catalog in all five locales
instead of English-only literals. `npm run verify:i18n`, `npm run typecheck`,
`npm run build:ci`, and `git diff --check` pass locally. Authenticated actor
pages and locale switching remain part of the pending deployed browser checks.

Reply ranking integration (2026-10-08): the Relevant reply ranking path is now
enabled as part of the unified MVP/v2/v3 implementation instead of being
hidden behind `MEDIA_RELEVANT_REPLIES_ENABLED`. The post detail page exposes a
localized, accessible Latest/Relevant selector, and the server safely falls
back to Latest for unknown values. The focused Media contracts/feed suites
pass 13 tests, `npm run verify:i18n`, `npm run typecheck`, and `git diff --check`
pass locally. Deployed reply ordering and mobile interaction remain pending
live verification.

Live-count reconciliation (2026-10-08): like, bookmark, and repost mutations
now return the authoritative post-action counter from PostgreSQL, and Media
cards use that value to reconcile concurrent changes instead of relying only
on a local increment/decrement. Ranked reply threads re-fetch in the selected
order after a new reply. The focused Media contracts/feed suites pass 14 tests,
`npm run typecheck`, and `git diff --check` pass locally. Hosted CI and live
multi-view count behavior remain pending.

Creator status localization (2026-10-08): sponsorship, application, and
deliverable lifecycle values are now rendered through the localized creator
status catalog in all five languages; machine status values remain unchanged
for workflow decisions. `npm run verify:i18n`, `npm run typecheck`, and
`git diff --check` pass locally. Authenticated marketplace browser coverage
and Credit provider behavior remain deployment verification work.

The same catalog now covers deliverable status and actor-type labels on the
Media surfaces, so those machine values are not exposed as raw UI text.

Share-count integration (2026-10-08): Media now persists idempotent user or
guest share records, returns the authoritative `share_count`, and renders the
share count beside the share action. The focused Media contracts/feed suites
pass 15 tests, `node --check`, `npm run typecheck`, and `git diff --check` pass
locally. Migration 741 is now reflected by the later live 742-migration check;
formal hosted migration evidence remains tied to the active CI run.

Live deployment check (2026-10-08): `/api/ready` returned healthy with release
`content-3a84c217f45ad2a2` and 741 applied migrations, but the deployed
`/api/media/capabilities` and `/api/media` endpoints returned 404. This proves
the current production release does not yet expose the branch represented by
this checkout; authenticated Media verification and deployment of the pushed
branch remain open.

Deployment follow-up (2026-10-08): a later live check now reports release
`content-eef8fc44394896b3` with 742 migrations applied and no pending work.
`/api/media/capabilities` returns Cloudflare interim mode with malware and
transcode requirements; `/api/media/feed`, `/api/media/communities`,
`/api/media/search`, and the share route respond through the deployed Media
router. The anonymous feed is empty, so authenticated publishing, action
counts, uploads, and marketplace journeys still require a signed-in live check.


Draft retry durability (2026-10-08): the composer now synchronizes an existing
private draft's body, Space, and up to five selected entity links through the
owner-authorized `PATCH /api/media/posts/:id/draft` endpoint before every retry.
The endpoint keeps drafts unlisted, validates supported link types and Space,
replaces link snapshots transactionally, and cannot update another user's post
or a published post. The focused Media contracts/feed suites pass 16 tests
locally; client typecheck, controller syntax, and `git diff --check` also pass.
Authenticated production retry and worker/storage execution remain deployment
verification work.

Hosted verification (2026-10-08): CI run `37811076761` for commit
`820c9890` passed both `Server and Client Verification` and the PostgreSQL
migration rehearsal. The run covered the client Media draft-retry contract,
full client build/localization checks, server regression/security tests, and
idempotent migration application.

CI availability note (2026-10-08): the documentation-only follow-up commit
`c10313f9` received a GitHub check annotation that the job was not started
because recent account payments failed or the spending limit needs to be
increased. The rerun attempts were rejected before checkout with no test or
migration logs. This is an external CI availability condition; it does not
invalidate the passing code verification for `820c9890` (run `37811076761`).

Live draft-route check (2026-10-08): the current healthy release now exposes
`PATCH /api/media/posts/:id/draft`; an anonymous request returns `401 Unauthorized`
while `/api/ready` reports all 742 migrations applied and workers ready. This
confirms route deployment and the authentication boundary, but not owner
authorization, durable draft editing, storage, or worker processing because no
signed-in production session is available in this check.

Processing-status polling (2026-10-08): the composer now polls an attached
private draft every four seconds while it is in quarantine/processing, stops
on ready/failed/blocked, unmount, or after 90 polls (six minutes), and shows
localized ready, failure, and delayed status copy in all five locales. The
Media accessibility contract has 7 passing checks; `npm run verify:i18n`,
`npm run typecheck`, `npm run build:ci`, and `git diff --check` pass locally. A
signed-in production upload-worker journey is still required to verify the real
transition and storage behavior.

Hosted verification follow-up (2026-10-08): commit `e44ad315` was pushed after
the bounded polling change. CI run `37815703524` was rejected before starting
because the GitHub account still reports failed recent payments or an exceeded
spending limit; the migration rehearsal was skipped and no test logs were
produced. The prior passing hosted code run `37811076761` remains the latest
authoritative CI evidence for the preceding draft-retry implementation.

Live health check (2026-10-08): `/api/ready` returned healthy release
`content-b9586e2b5d1b6714` with all 742 migrations applied, Redis, database,
workers, and Credit checks healthy. `/api/media/capabilities` returned the
Cloudflare interim policy with identity, malware-scan, and transcode gates;
`/api/media/feed?limit=1` returned a valid empty page; `/media` and
`/media/compose` returned 200 HTML; and the draft PATCH route returned the
expected anonymous `401`. The release metadata does not expose a Git SHA, and
no signed-in session was available, so owner authorization, uploads, worker
transitions, and authenticated actions remain unverified live.

Creator gig escrow batch (2026-10-08): awarding a creator gig now reserves the
approved Credit amount, links the reservation to the gig, rejects competing
applications, and replays safely after a lost response. Approved deliverables
release the reservation and settle the transfer atomically; requested changes
return the application to an editable awarded state; rejection and owner
cancellation release any active reservation. The composer uses the existing
localized cancel label, and the cancellation route is available in the Media
shell. Focused Media suites (50 tests) and `npm run build:ci` pass locally.
The disposable PostgreSQL migration test in hosted CI passed before the prior
feed-ranking run failed on a locality SQL syntax error; that feed defect is
included in this batch and must be reverified by the next CI run.

Creator payment escrow batch (2026-10-08): migration 746 links sponsorships,
tips and boosts to their Credit reservation or settlement transaction and
stores sponsorship delivery metadata. Sponsorship acceptance now reserves the
funds, creator submission requires a published ready post, settlement requires
the delivered state and releases the reservation in the same transaction;
authorized cancellation releases an active reservation. Tips use durable
payload-bound idempotency and settle through the shared creator settlement
rail. Boost settlement charges the purchaser wallet into platform revenue,
then activates the existing 24-hour window only after payment. Focused Media
creator, journey, access and feed-ranking suites pass (45 tests), and the
client `npm run build:ci` passed with 760 verified assets. Hosted migration
rehearsal, exact-candidate CI, authenticated production payment history and
full financial conservation tests remain pending for this batch.

Creator payment history batch (2026-10-08): authenticated Media creator pages
now load a unified, transaction-linked history for tips, sponsorships and boosts;
each settled item can open the existing audited Credit dispute flow using its own
payment kind and identifier. The history endpoint filters rows to the logged-in
user as payer or represented creator, and all five locale catalogs include the
new section label. Focused server tests (47 total across the Media suites),
localization parity and TypeScript checks pass. Sponsored placement, admin
refund resolution and authenticated live history remain outstanding.

Sponsored placement batch (2026-10-08): ranked Home now derives active boosts
only from settled rows within their `starts_at`/`ends_at` window, assigns organic
and sponsored lanes, and interleaves one sponsored slot per five feed positions.
Ranked cursors are version 2 and carry `feed_position`, keeping page boundaries
stable without duplicate rows or ranking changes. `MediaPostCard` labels active
paid placement in all five locales. Focused Media suites (62 tests) and
`npm run build:ci` pass locally; candidate CI run `37842488994` and its
PostgreSQL rehearsal pass. Real active-boost expiry/cap cases and authenticated
live placement remain pending.

Live count reconciliation batch (2026-10-08): the shared Socket.IO lifecycle now
includes a public, read-only `/media` namespace. Clients subscribe to post rooms;
like, bookmark, repost, share, view, reply and quote mutations broadcast only
after their database update returns the committed counter. Feed and detail cards
reconcile those counters while REST remains authoritative, including room
rejoin after reconnect. Focused Media/realtime suites (53 tests) and the client
build pass locally; the hosted candidate CI and anonymous production endpoints
are healthy, while an authenticated multi-client live count check remains open.

Creator dispute lifecycle batch (2026-10-08): creator payment history now
hydrates the latest Credit dispute state and suppresses duplicate dispute
actions while a case is open or under review. Media administrators have a
separate creator-dispute queue with explicit review and resolution endpoints;
the queue filters to Media tip, sponsorship and boost transactions and routes
all state changes and compensation through the existing audited Credit dispute
service. Focused server suites (39 Media tests and 150 Credit governance tests)
and the full client `npm run build:ci` pass locally. Disposable PostgreSQL,
authenticated administrator execution and live deployment verification remain
open for this batch.

Creator dispute admin surface batch (2026-10-08): the existing super-admin Credit dispute queue now exposes a localized Media creator disputes filter and labels Media tips, sponsorships, and post boosts. The filter and CSV export use the server-side `mediaOnly` reference-type predicate, so the displayed queue and exported evidence remain scoped to the same three Media payment kinds. Client contract checks, server dispute regression tests (137 tests), localization parity, typecheck, full client build, and dist-asset verification pass locally. Hosted CI and authenticated live administrator verification remain the next release checkpoint.

Media error contract batch (2026-10-08): Media controller catch paths now preserve operational HTTP statuses and machine codes for recoverable validation, authorization, and retry states while returning generic fallback copy for unknown infrastructure failures. This prevents actionable Media states from being misreported as HTTP 500 and keeps raw database/provider messages out of responses. Focused Media journey/access/contract tests (41 tests), controller syntax, and `git diff --check` pass locally; full client build and hosted CI remain the next checkpoint.

Media error contract expansion (2026-10-08): the shared safe error response now covers upload, identity/verification, and moderation handlers in addition to the main Media controller. Recoverable 4xx and operational 503 states preserve their status and machine code; unknown failures retain route-specific generic copy and fallback codes. Focused Media journey, access, verification, and dispute tests (40 tests), controller syntax checks, and `git diff --check` pass locally. The next checkpoint is the hosted candidate CI and PostgreSQL rehearsal.

Hosted verification and creator visibility follow-up (2026-10-08): candidate commit `6b69ef8e` passed the complete `Server and Client Verification` job in CI run `37852693222` (13m3s), including client build/localization, browser/admin matrices, server regression/security, FFmpeg, and disposable statement migration. The PostgreSQL migration rehearsal was blocked before checkout by GitHub's account billing/spending-limit gate, so no database logs were produced and it is not treated as a passing rehearsal. Open creator gigs now require the represented actor's current helper, business, or restaurant verification in the public listing query; the focused creator, journey, and dispute suites pass 22 tests locally. Rerun the migration rehearsal when CI billing is available.

Stable Media share-preview batch (2026-10-08): public post prerendering now points `og:image` and `twitter:image` at a stable guest `/api/media/posts/:id/share-image` endpoint. The endpoint rechecks the shared public safety predicate and only redirects to a short-lived signed thumbnail URL for a cleared public post; private, removed, processing, or unsafe assets return 404. Focused Media contract and creator suites pass 24 tests, controller/prerender syntax checks and `git diff --check` pass locally. Exact localized crawler behavior and deployed asset delivery remain live verification work.

Sponsorship idempotency batch (2026-10-08): sponsorship creation now persists a sponsor-scoped idempotency key through migration 747, replays an exact matching offer after a lost response, rejects changed-payload reuse, and keeps one key in the creator shell across retries. The focused creator suite passes 12 tests, the full client build and dist-asset verification pass locally, and syntax/diff checks are clean. Hosted CI and disposable PostgreSQL migration rehearsal remain the next release checkpoint; the latest hosted checks are externally blocked by the GitHub billing gate.
