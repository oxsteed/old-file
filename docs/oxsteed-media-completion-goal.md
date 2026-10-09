# OxSteed Media combined implementation goal and completion evidence

## Current objective and strategy (2026-10-08)

Execution resumed under the user-approved
[four-batch plan](oxsteed-media-execution-plan.md). The following matrix replaces
broad completion claims. State vocabulary: **implemented** means current source
exists; **behavior-tested** means the specified behavior actually ran;
**verified live** requires exact deployed evidence; **incomplete** includes
partial implementations and missing verification. No row below is marked
verified live for the new candidate. A historical test count is not proof.

Execution directive (2026-10-08): up to four agents may work in parallel on
non-overlapping batches. Each batch must run focused checks, produce one
coherent commit and push, and record its CI run. A ready batch may be pushed
without waiting for an earlier CI run to finish; unfinished CI remains
explicitly unverified until it completes. The primary agent coordinates shared
checkout integration, deployment evidence and final completion decisions.

Easy-to-hard execution order (2026-10-09): track the remaining work in this
sequence so each checkpoint closes a complete dependency layer before moving
upward: (1) static contracts, localization and navigation; (2) single-user
publishing, saved posts, reports, owner controls and linked-card safety; (3)
real PostgreSQL, storage, worker, blocking, locality and pagination journeys;
(4) follows, live counts, profile/business/restaurant integrations and
restaurant propagation; (5) isolated Credit reservations, settlement,
refunds, disputes and paid placement; (6) release identity, authenticated
production, mobile/RTL and exact deployed verification. A layer can be
behavior-tested before its external dependency is available, but its matrix
row stays incomplete until that dependency is verified.

### Current requirement-level work and evidence

| Requirement | State and implementation / behavioral evidence | Deployment / dependency | Next exact action |
| --- | --- | --- | --- |
| Reconciled source and retained work | Behavior-tested: writable checkout HEAD is kept aligned with the pushed branch; three pre-existing untracked browser scratch files remain preserved. | Runtime release metadata still exposes content identity but no git SHA. | Keep the scratch files untracked and compare release metadata at each deployment checkpoint. |
| Repeatable isolated fixtures | Implemented: optional Media compose extension, scoped wrapper, synthetic persona seed and real API/scan/conversion verifier. | Not executed here: Windows host has no reachable Colima/Docker runtime. | Execute `start`, `seed`, `media-test` on Colima and capture repeat/reset evidence. |
| Required real database proof | Behavior-tested in hosted CI: the disposable Media harness ran against PostgreSQL, Redis, ClamAV, FFmpeg, private storage, and synthetic personas; the earlier full server job was cancelled before its database suite completed. | Local Windows checkout still has no disposable PostgreSQL runtime. Exact-candidate run `37873084185` is still in progress. | Preserve the harness assertion and rerun it for each candidate; record the final exact-candidate result. |
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
| Saved posts | Behavior-tested locally: authenticated saved feed filters removed and mutually blocked posts, and unsaving from Saved Posts immediately removes the card through a bookmark-change callback. | PostgreSQL case is skipped on this Windows host; exact-candidate hosted execution and authenticated live reload/unsave remain outstanding. | Execute the saved-feed case in the disposable harness, then verify bookmark → saved feed → unsave in an authenticated deployment. |
| Reporting and automatic moderation | Behavior-tested locally: report reason/note validation now runs the hourly cap, duplicate check, and insert inside a per-reporter advisory-locked transaction; duplicate and cap responses are covered by 46 focused access/contract tests. | Real concurrent PostgreSQL, repeat/limit, DMCA, and administrator proof remain outstanding. | Execute concurrent report submissions in the disposable harness and verify moderation outcomes. |
| Owner editing/deletion | Behavior-tested locally: owner deletion now locks the post, updates reply/quote counters, and commits the visibility change atomically; owner-scoped denial and counter refresh are covered by the focused contract suite. | Real PostgreSQL authorization/count/source-propagation and deployed proof remain outstanding. | Execute owner versus non-owner, quoted/reply counter, and federated-source removal cases in the isolated harness. |
| Two-way blocking and inactive authors | Behavior-tested in the maintained PostgreSQL suite: both block directions hide actors/posts and now stop like, bookmark, repost, view, and report actions before any write; inactive and banned author predicates remain enforced. Linked helper, business, restaurant, job, rental and logistics cards now apply the same two-way owner-block predicate while retaining an inert snapshot. | The 15-case SQL suite is skipped on this Windows host; hosted database and deployed proof remain outstanding. | Execute all visibility/action cases in the disposable harness, including inactive authors and blocked links/replies. |
| Daily/upload/report limits | Implemented: existing rate/count controls. | Concurrent actual API limit proof outstanding. | Test simultaneous post limits and structured upload/report rejection. |
| Linked entity selection and five-card limit | Behavior-tested: server search and composer selection exist, entity search and hydration apply two-way owner blocking, draft/public link writes now resolve live targets and replace client labels/prices with authoritative snapshots, and blocked targets preserve a plain snapshot label. | Real invalid/removed/entity ownership and currencies outstanding. | Verify all eight link types and authoritative target metadata. |
| Public cards versus transaction login | Behavior-tested locally: all formerly intercepted guest card types now navigate to public targets; removed cards remain inert. | Browser dependencies mocked; destination transaction gates outstanding. | Verify actual public pages and login at transaction start. |
| City/category Spaces | Implemented in current source. | Real channel filters, membership and counts outstanding. | Run actual database/browser city/category/membership matrix. |
| In-shell notifications and messages | Implemented in current source. | Actual replies/likes/inbox links and account sessions outstanding. | Exercise existing activity systems within Media for each persona. |
| Navbar/account/footer/legal navigation | Implemented in current source. | Signed-in/out, cookies, keyboard and Arabic proof outstanding. | Include navigation and legal dialogs in browser matrix. |
| Accessibility and five languages | Incomplete: existing catalogs and labels, but full error/keyboard/RTL audit outstanding. Media legal dialogs now return focus to the opening link after Escape, backdrop, or close-button dismissal; 14 Media accessibility/notification contract checks, localization parity, and the full 761-asset client build pass locally. | Full keyboard, Arabic/RTL and mobile matrix required for candidate. | Run the maintained browser accessibility matrix in Arabic/RTL and on mobile. |
| Image-rich share previews | Implemented in prior prerender source. | Current safe assets/localized real share previews outstanding. | Verify guest-safe image metadata in every language after build. |
| Nearby coordinates and city/state fallback | Behavior-tested locally: entity coordinates from helpers, businesses, restaurants, jobs and linked targets rank nearby; explicit city/state matching remains available, removed entities lose their boost, and reciprocal-blocked linked targets no longer contribute a ranked link boost. | Real PostgreSQL locality and blocked-target ranking cases are specified but skipped on this Windows host. | Execute the locality suite in the isolated PostgreSQL environment and verify deployed entity schemas. |
| Guest and device location choices | Behavior-tested locally: guests can choose city/state, use device location only after an explicit action, persist a rounded choice, return to profile location, or select all locations. | Real-device permission and deployed session evidence outstanding. | Verify permission denial, Arabic layout and mobile behavior in the release matrix. |
| Versioned context-bound feed cursor | Behavior-tested locally: cursor includes version, tab, viewer, location, ranking mode, cutoff and microsecond timestamp; changed context returns a recoverable 400; fallback preserves its chronological mode and cutoff. | Real complete-pagination proof is skipped without PostgreSQL. | Execute isolated ranked and fallback pagination cases, then verify candidate deployment. |
| Stale tab responses and duplicates | Behavior-tested locally: generation guards discard out-of-order tab/location responses and page appends deduplicate post IDs. | Browser test uses mocked API; production race evidence outstanding. | Verify rapid tab/location changes against the deployed API. |
| Follows and Following | Implemented in existing source. | Real block/follow/paging and actor-count proof outstanding. | Run actual SQL and browser tab-switch journey. |
| Live authoritative counts | Behavior-tested locally: the shared Socket.IO lifecycle now exposes a read-only `/media` namespace, action endpoints broadcast committed post counters, and feed/detail cards reconcile those counters without mutating state from socket events. | Authenticated live multi-client count proof remains outstanding. | Verify two signed-in/guest browsers receive the same committed counts and recover after reconnect. |
| Business Hub integration | Implemented in prior source. | Actual selected-business authorization/navigation outstanding. | Verify Media posting and history for owned entities. |
| Profile Studio/public-profile integration | Implemented in prior source. | Actual safe profile tabs and guest behavior outstanding. | Test profile editing/navigation and public safe posts. |
| Rentals/Direct/Logistics cards | Implemented in current link resolvers/search. | Actual public targets/removal/currency proof outstanding. | Seed and verify additional types alongside launch types. |
| Restaurant copy/ownership/deduplication | Behavior-tested: source posts remain deduplicated and anchored to the current restaurant owner; a later CSAM flag now removes every federated Media post by source ID in the same transaction, with focused CSAM/federation tests passing. | Real source moderation/removal propagation and deployed execution remain outstanding. | Run source removal, moderation and duplicate-prevention cases in the isolated PostgreSQL harness. |
| Creator/buyer dashboards and opportunities | Behavior-tested locally: creator shell lists offers, open gigs and applications; sponsorship offers now support acceptance, deliverable submission and settlement controls. | Real full dashboard journey outstanding. | Verify authenticated creator/buyer/admin dashboards live and add remaining marketplace status/history views. |
| Applications and award/acceptance | Behavior-tested locally: existing transactional award path reserves the approved amount and rejects competing applications; concurrent production proof remains outstanding. | Real concurrent authorization/limits outstanding. | Execute isolated race cases and verify authenticated deployment. |
| Deliverable revisions and approval | Behavior-tested locally: awarded gig deliverables and sponsorship deliverables expose owner checks, publish/ready validation and review transitions; full revision matrix remains outstanding. | Real revision/concurrent approval proof missing. | Implement and test any remaining revision states across gig and sponsorship UI. |
| Gig reservation and payment | Behavior-tested locally: award reserves Credit, approved deliverables settle once, and cancellation/rejection releases the reservation; linked and submitted posts are rechecked for current public safety and verified publisher state. | Isolated accounting and live execution still required. | Re-run conservation/replay cases in disposable PostgreSQL and verify deployed payment history. |
| Sponsorship reservation/delivery/payment | Behavior-tested locally: acceptance reserves funds, creators submit a published ready deliverable, settlement requires `delivered`, and cancellation releases an active reservation. | Credit isolated accounting and authenticated live proof outstanding. | Execute sponsorship reserve/settle/release races and verify the deployed journey. |
| Tips | Implemented and behavior-tested locally: tips use durable payload-bound idempotency and settle through the shared creator settlement rail with verification and self-payment guards. | Real currency/freeze/fee/replay proof missing. | Run isolated accounting replay/failure cases and verify live transaction history. |
| Cancellation/release/refund/dispute review | Behavior-tested locally: creator payments now expose their latest Credit dispute state, hide duplicate dispute actions while a case is open or under review, and add a Media-scoped administrator queue that routes review, compensation and resolution through the shared audited Credit service. | Real accounting and authenticated administrator proof required. | Run the isolated reserve/release/refund/dispute matrix and verify the deployed Media admin queue. |
| Boost payment to platform revenue | Implemented and behavior-tested locally: purchaser wallet is charged through the shared settlement rail into `platform_revenue`; self-transfer and replay are rejected, and both boost creation and settlement recheck current public safety and verified-publisher predicates. | Real accounting and deployed proof outstanding. | Verify conservation, idempotent retries, safety revocation and platform ledger history in the isolated/live release checks. |
| Sponsored placement and 24-hour duration | Behavior-tested locally: active settled boosts receive a separate ranked lane inserted at positions 5, 10, and so on; organic ordering remains stable, ranked cursors carry `feed_position`, and cards show a localized sponsored label only during the active window. | Real active-boost database cases and deployed feed proof remain outstanding. | Run isolated expiry/replay/cap cases and verify live placement. |
| Price/currency disclosure and purchaser history | Behavior-tested locally: boost confirmation returns amount/currency before settlement, and the Media creator shell now lists tip, sponsorship and boost payment history with transaction-linked dispute entry points. | Payment retry/cancellation/refund and authenticated live history proof missing. | Add admin refund review and verify purchaser/creator history against deployed Credit records. |
| Atomic accounting/precision/fees/isolation | Incomplete for marketplace: shared rail safeguards exist, transitions are not fully atomic with payment. Creator settlement and boost retries now resolve a matching committed journal entry before daily limits, sanctions, or balance checks, with account ownership and idempotency semantics preserved; focused replay regressions pass. | Real isolated conservation/races/currency cases required. | Add transactional marketplace service and accounting behavior suites. |
| Migration upgrade and repeat application | Implemented: new 742, 743, 744 and 746 filenames follow inspected predecessors; 746 adds creator payment reservation/transaction links and delivery metadata. | Actual 746 migration execution is pending hosted CI/deployment. | Rehearse against disposable upgraded schema and repeat without data changes. |
| Cloudflare interim and deferred Thorn | Implemented: retained explicit interim status; no synthetic vendor clearance. | Real runtime/public-delivery proof outstanding. | Keep honest policy disclosures and future vendor switch tests. |
| Passing exact-candidate CI | Incomplete for current candidate: the exact current candidate `d9e3f14c` is pending in [37875210815](https://github.com/oxsteed/old-file/actions/runs/37875210815). | The exact candidate has not completed its server regression and migration jobs yet. | Record the terminal result of `37875210815`; keep the goal open until the run passes or a failure is repaired. |
| Exact deployed release/readiness/schema/assets | Behavior-verified live after the latest rollout: `/ready` and `/health` returned 200; `/ready` reported release `content-ac71aaf48e521400`, migrations `749/749`, no pending/unexpected migrations, healthy database/Redis/Credit/realtime/workers; Media feed, capabilities, notifications, and messages returned 200, while unauthenticated bookmarks returned 401 and an invalid cursor returned the expected 400. | Coolify release metadata does not expose the git SHA, so exact commit-to-image identity remains unavailable. | Obtain release SHA or reproducible asset identity from deployment metadata and verify authenticated journeys. |
| Authenticated production/real-device matrix | Incomplete. | Signed-in helper/business/restaurant/admin and real device access outstanding. | Capture full non-financial production journeys; reconcile finance read-only. |

Current local execution: 216 Media behavior checks passed in 16 suites;
26 PostgreSQL cases in two suites skipped because no disposable PostgreSQL is
available locally. The maintained Media client contract and full `npm run
build:ci` passed, and four maintained Chromium browser journeys passed, covering
desktop and 390px composer recovery, guest public-card navigation, tab/location
races and explicit device-location choices. The CI
result checker, existing Credit fixture regression, fixture isolation rejection,
shell syntax and `git diff --check` passed. `npm run build:ci` passed localization,
TypeScript, production bundling and verification of 761 assets. A broader local
 server run encountered existing non-Media Windows/FFmpeg/SQL-artifact failures
and was stopped; it is not a passing full-suite result. Isolated ClamAV/FFmpeg
execution, candidate CI and deployed verification remain outstanding. The
baseline CI check still reports a pre-start billing rejection; canonical `/ready`
currently reports healthy release `content-5a3ad5ab7517685f`, which is not proof
that the new changes deployed. No completion claim is made.

Integrated Media suite checkpoint (2026-10-09): the current writable checkout
ran all 18 maintained `media*.test.js` files with 216 passing tests and 26
database-only skips; no Media suite failed. The skipped PostgreSQL cases cover
saved-feed reload, block/action boundaries, and other real database journeys
that require the hosted disposable environment.

Linked-card block boundary checkpoint (2026-10-09): hydrated helper, business,
restaurant, job, tool-rental and logistics cards now evaluate the viewer's
two-way block relationship against the target owner. A blocked target keeps its
saved label but returns `available: false` and no canonical URL, so a stale
entity cannot become a navigation or transaction bypass. The maintained
contract and integrated Media suite pass 211 tests; the PostgreSQL link fixture
is specified but skipped locally and still needs hosted and deployed proof.

Entity-search block boundary checkpoint (2026-10-09): signed-in entity search
now applies the same reciprocal owner-block predicate as card hydration across
restaurants, dishes, helpers, businesses, jobs, rentals and logistics. The
compose picker cannot reintroduce a blocked target through a fresh search. The
focused contract and integrated Media suite pass 212 tests; real database and
deployed search evidence remain open.

Authoritative linked-target checkpoint (2026-10-09): create, draft-update and
post-link replacement now resolve every selected target against its current
public entity row before writing. Invalid or removed targets fail the write,
while names and prices come from the target rather than caller-supplied labels.
The update-draft journey and Media contract suites pass locally; full target
type coverage still requires the disposable database and deployed verification.

Admin video-approval checkpoint (2026-10-09): the administrator safety query
now aliases the current Didit-backed `users.is_verified` value explicitly
before evaluating processed video approval. This closes the production gap
where a real SQL row could lack the property used by the video gate, while the
existing tests continue to prove that approval never rewrites safety verdicts.
Focused access and contract checks pass; the real approval path remains part of
the hosted and authenticated release matrix.

Link-write rejection checkpoint (2026-10-09): a maintained draft journey now
proves that a removed or unknown target is rejected before existing cards are
deleted, with the transaction rolled back. The integrated Media suite passes
213 checks; target-type and storage-backed execution remain in the hosted
database matrix.

Feed-link visibility checkpoint (2026-10-09): ranked link counts now apply the
same reciprocal owner-block predicate as card hydration, so a blocked entity
cannot silently improve a post's rank. A maintained SQL assertion covers the
target-owner clauses and the hosted PostgreSQL fixture covers the resulting
zero boost; the fixture remains skipped locally.

Nearby-link visibility checkpoint (2026-10-09): the same reciprocal owner-block
predicate now applies to linked restaurant, dish, helper, business, job, rental
and logistics candidates inside locality scoring. A blocked entity therefore
cannot improve either link count or nearby placement. Focused ranking/context
checks pass; the real locality fixture remains part of hosted verification.

Boost safety checkpoint (2026-10-09): boost creation and settlement now join
the represented actor and require the shared public-post safety predicate plus
current helper/business/restaurant verification. Two focused regressions prove
that a post which is no longer public, ready, safety-cleared or verified cannot
enter or complete paid placement. The integrated Media suite passes 215 tests;
isolated Credit conservation, replay and deployed payment evidence remain open.

Creator-post safety checkpoint (2026-10-09): gig links, creator deliverables,
tips and sponsorships now require the referenced post to remain public, ready,
undeleted and clear under the same safety policy used by public delivery; a
deliverable also requires the creator actor to remain verified. A focused unsafe
tip regression and the integrated Media suite pass 216 tests. Isolated Credit
accounting and authenticated deployment evidence remain open.

Creator settlement replay checkpoint (2026-10-09): creator gig, sponsorship,
tip, and boost settlement retries now recover an already-posted matching
Credit journal transaction before applying daily transfer limits, rail state,
sanctions, or balance checks. The replay still validates the debit/credit
account owners, transaction type, amount, currency, reference, description,
and metadata through the shared append-only journal path. Two new governance
regressions cover customer-to-customer creator settlement and platform-revenue
boost payment replays; the focused creator/governance run passes 43 tests and
the broader Media creator/admin/contracts/journeys run passes 54 tests. Code
is pushed in `69e842b8`; exact-candidate CI run `37873754635` was superseded
by the later accessibility candidate `4e004995` in run `37874125718`.

Accessibility checkpoint (2026-10-09): Media legal links continue to open in
the in-shell dialog, and dismissal now restores keyboard focus to the exact
link that opened it. The maintained Media accessibility and notification
contracts pass 14 tests; `npm run verify:i18n` and `npm run build:ci` pass with
761 emitted assets. Full Arabic/RTL, mobile and real-browser keyboard evidence
remains open.

Restaurant federation safety checkpoint (2026-10-09): a later CSAM vendor
flag on a restaurant source row now marks every copied OxSteed Media post
removed, with `deleted_at` preserved, in the same transaction as the source
verdict and audit event. The flagged-vendor regression and all three
federation ownership/deduplication tests pass locally. The complete restaurant
video suite still has three environment-only FFmpeg failures on this Windows
host; the focused CSAM/federation checks pass, and hosted CI remains the
required real-worker verification.

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

Creator payment retry batch (2026-10-08): tip, sponsorship, and boost clients now send idempotency keys in the standard request header. Tip and boost keys are generated when their action dialog opens and reused through retries, so a lost response cannot create a second payment intent. The focused client idempotency suite passes 3 tests, the creator server suite passes 12 tests, and the full client CI build with dist-asset verification passes locally. Hosted CI and isolated accounting replay remain pending because the GitHub billing gate blocks job startup.

Marketplace cancellation replay batch (2026-10-08): authorized sponsorship and boost cancellation retries now return the existing cancelled record and skip a second reservation release. Unauthorized parties and settled records still fail closed. Focused creator, journey, and dispute suites pass 20 tests with clean controller syntax and diff checks. The client build is unchanged for this batch; hosted CI and disposable Credit accounting races remain blocked by the external GitHub billing gate.

Gig deliverable atomicity batch (2026-10-08): awarded gig deliverable submission now locks the application and performs post validation, deliverable upsert, application transition, and commit in one transaction. Partial writes cannot leave a deliverable and application in different states, while revisions remain possible after a requested change. Focused creator and journey suites pass 21 tests with clean controller syntax and diff checks; hosted CI and isolated database race verification remain blocked by the GitHub billing gate.

Gig application retry batch (2026-10-08): application submission now runs under an explicit transaction and locks the gig/application before checking capacity. An identical submitted application replays with HTTP 200, while changed details or an application that has advanced to award/delivery cannot be used to reset its lifecycle. Focused creator and journey suites pass 22 tests with clean controller syntax and diff checks; hosted CI and real concurrent database verification remain blocked by the GitHub billing gate.

Gig creation idempotency batch (2026-10-08): creator gig creation now stores an owner-scoped idempotency key through migration 748, replays exact matching requests after a lost response, rejects changed-key reuse, and sends the key in the request header from the Media creator shell. Focused client idempotency checks pass 4 tests, creator/journey server suites pass 23 tests, the full client build and dist-asset verification pass locally, and syntax/diff checks are clean. Hosted CI and migration rehearsal remain externally blocked by the GitHub billing gate.

Counted-action concurrency batch (2026-10-08): Media likes, bookmarks, and reposts now lock the public post row, use conflict-safe inserts, and recompute the denormalized counter from the authoritative action table before committing. This prevents concurrent toggles from leaking duplicate-key failures or drifting counts, while preserving two-way block and safety checks. Focused Media contracts, journey, and access suites pass 44 tests; controller syntax and diff checks pass. Hosted CI and disposable PostgreSQL verification are the next checkpoint.

Share/view counter batch (2026-10-08): Media shares and views now use the same locked-post transaction, conflict-safe viewer hash insert, and exact recount before commit. Duplicate shares/views remain idempotent, blocked or unsafe posts are rejected before the write, and new views return the authoritative count. Focused Media contracts, journey, access, creator, and admin suites pass 66 tests; controller syntax and diff checks pass. Hosted CI and disposable PostgreSQL verification are the next checkpoint.

Notification identity batch (2026-10-08): like notifications now use `media_like:<post>:<liker>` and reply notifications use `media_reply:<reply>`, so retries remain idempotent without collapsing distinct users or replies into one recipient-scoped key. Focused Media journey, contract, and access suites pass 45 tests; controller syntax and diff checks pass. Hosted CI and disposable PostgreSQL verification are the next checkpoint.

Follow consistency batch (2026-10-08): actor follow/unfollow now runs in one transaction while locking the actor row, rechecking two-way block visibility, using conflict-safe insertion, and recounting followers before commit. Notifications are sent only after a committed follow; rollback paths release the connection safely. Focused follow, feed-context, and journey suites pass 27 tests with clean diff checks. Hosted CI and disposable PostgreSQL verification are the next checkpoint.

Reply and quote counter batch (2026-10-08): creating and deleting replies or quote posts now recomputes the parent counter from visible, ready child rows instead of incrementing or decrementing a denormalized value. Draft, removed, and failed-processing children cannot inflate counts, and repeated cleanup cannot drive counters below the authoritative total. Focused Media follow, feed-context, and journey suites pass locally; hosted CI and disposable PostgreSQL verification remain pending.

Location and marketplace integrity batch (2026-10-08): profile-based nearby feeds now display the API-resolved city/state context without mutating the saved location preference; explicit location changes update the visible context immediately and incomplete device coordinates no longer claim nearby-device mode. Marketplace awards, reviews, sponsorship settlements, tips, and paid boosts now fail closed and roll back when their state transition returns no row or Credit returns no transaction ID, preventing unreconcilable successful responses. Focused creator suites pass 17 tests, the client production build passes, and syntax/diff checks are clean. Hosted CI is running; live verification remains blocked by current 404 responses from the deployed routes.

Localized share-preview batch (2026-10-08): Media post prerender fallbacks now localize the title, empty-post description, eyebrow, and server-rendered shell in English, Spanish, French, Haitian Creole, and Arabic while retaining stable guest-safe image URLs and language alternates. The prerender marketing suite passes 9 tests with syntax and diff checks clean. Hosted CI and deployed crawler verification remain outstanding.

Publishing safety batch (2026-10-09): every public Media read and action now rechecks the represented helper, business, or restaurant actor's current verification in addition to the shared media safety verdict. The gate covers feeds, post/quote/reply detail, Spaces, search, actor/business pages, bookmarks, action counters, and stable share images. Focused safety/access/contracts/journey suites pass 67 tests with controller syntax and diff checks clean. Hosted CI and authenticated live revocation evidence remain outstanding.

Discovery integration batch (2026-10-09): Media now restores Following and explicit city/state choices from shareable URLs, keeps tab/location query state synchronized, and retains precise device coordinates only in local storage. The maintained discovery browser journey passes 3 tests, including stale-response deduplication, explicit device-location choice, and Following/city deep links; i18n and syntax checks pass. Hosted CI and real-device evidence remain outstanding.

Marketplace reservation batch (2026-10-09): gig and sponsorship settlement now requires the durable reservation ID and amount to match the active Credit hold; stale or mismatched transitions fail closed and roll back. Award, tip, sponsorship, deliverable, cancellation, and boost mutations now require persisted state rows before success responses. Creator/admin/integrity suites pass 28 tests, syntax and diff checks pass, and the integrated client build verifies 760 assets. Hosted CI and isolated financial race evidence remain outstanding.

Upload safety lease batch (2026-10-09): flagged CSAM scan jobs now complete through the leased-job path, preserving lease-token fencing while leaving the asset quarantined and unpublished. The regression worker suite passes 3 tests and syntax/diff checks are clean. Full private-storage, ClamAV, FFmpeg, and deployed upload lifecycle verification remain outstanding.

Media accessibility batch (2026-10-09): notification rows now use native keyboard-accessible buttons with descriptions and visible focus states, while preserving the in-shell notification flow. The maintained accessibility contract passes locally and the client build passes; existing Vite chunk warnings remain. Full mobile/Arabic keyboard verification and deployed evidence remain outstanding.

Restaurant federation batch (2026-10-09): restaurant-origin Media posts now attribute the federated actor to the restaurant owner rather than the submitting staff user, and source deletion hides the restaurant item and copied Media post in one transaction. The restaurant Media suite passes 57 tests with clean syntax checks. Live ownership, duplicate-prevention, and removal propagation remain to verify against the deployed database.

Restaurant federation coverage follow-up (2026-10-09): the maintained federation suite now covers source deduplication, owner-anchored actor creation, historical ownership repair, and source-copy removal behavior. Restaurant Media, upload, and federation suites pass 90 tests combined; the client build remains in progress and live propagation is still open.

Integrated verification update (2026-10-09): after correcting the restaurant federation syntax before release, the focused worker and restaurant suites pass 60 tests, the expanded restaurant Media/upload/federation suites pass 90 tests, and `client/npm run build:ci` passes with typecheck, localization parity, Vite production build, and 761 emitted assets verified. Large-chunk and dynamic-import warnings remain advisory. Live `/ready`, `/health`, `/api/media/capabilities`, `/media`, and empty feed endpoints are healthy; exact commit-to-image identity and authenticated production journeys remain open.

Combined Media server verification (2026-10-09): 18 focused Media/restaurant suites passed with 252 tests passing and 8 intentionally skipped; exercised access, contracts, drafts/attachments, feed context/ranking, follows, journeys, namespace, publisher verification, safety, transcode, URL validation, visibility, creator/admin disputes, and restaurant federation. Test logs include expected mocked operational-error paths; no suite failed.

Verification return-path batch (2026-10-09): publish failures for unverified businesses and restaurants now expose a localized Request verification action linking to the in-shell verification center with `returnTo=/media/compose`, preserving the private draft and existing Didit identity path. The Media accessibility contract passes 8 tests and a production Vite build passes with the existing large-chunk warnings. Live authenticated request/retry behavior remains to verify.

Live regression check (2026-10-09 00:28 UTC): the domain currently returns HTTP 404 from Cloudflare for `/`, `/ready`, `/health`, `/media`, and Media API endpoints. This is a deployment/origin availability failure, not a passing application verification result. The latest branch CI run for `62b38dd4` is still in progress; investigate Coolify/origin routing after the rollout stabilizes.

Live rollout recovery (2026-10-09 00:30 UTC): the prior 404 was a transient rollout gap. Production now returns 200 for `/`, `/ready`, `/health`, `/media`, `/api/media/capabilities`, and `/api/media/feed?limit=1`. Readiness reports release `content-d3db892b3f0fa613`, 749/749 migrations, and healthy database, Redis, Credit, realtime, and workers. Coolify still does not expose a Git SHA, so exact candidate-to-image identity remains unverified.

Marketplace fail-closed batch (2026-10-09): deliverable review now accepts only `approved`, `changes_requested`, or `rejected`; malformed statuses return a 400 before opening a transaction or touching Credit. The focused creator suite passes 19 tests. This prevents malformed review input from triggering a gig payout.

Linked-card availability batch (2026-10-09): unavailable dishes are now excluded from live search, feed link counts, and locality ranking while preserving their snapshot card with `available: false` and no canonical URL. Contract and ranking suites pass 24 tests; guest transaction gates and other entity types remain covered by existing contracts.

Disposable Media CI harness batch (2026-10-09): CI now has a separate `media-isolated` job that builds the production app with disposable PostgreSQL, Redis, ClamAV, and FFmpeg, seeds synthetic fixtures, runs the existing real API/storage/worker verifier, and always removes its scoped volumes and containers. The new deployment wiring contract passes 1 focused test. Docker is unavailable in this Windows shell, so the actual harness remains pending its GitHub Actions run.

Gig deliverable transition batch (2026-10-09): submitting a gig deliverable now
requires the locked awarded application to transition to `delivered` with a
returned row; a missing transition rolls back the inserted deliverable and
returns an operational failure. The creator suite passes 21 tests locally,
including the rollback regression, with controller syntax and diff checks clean.

Transactional moderation batch (2026-10-09): flag decisions now lock the flag,
require the flag and removed-post updates to return rows, write the audit event
through the same transaction, and roll back if post removal or audit logging
fails. The creator/admin suites pass 28 tests locally with syntax and diff
checks clean. CI run `37869352956` for `dcd86ba4` was rejected before startup by
the GitHub account billing/spending gate, so no hosted job evidence exists for
this batch.

Rollout-gap classification (2026-10-09): the earlier production 404 was a
transient deployment gap. A fresh probe returned 200 for `/`, `/ready`,
`/health`, `/api/media/feed?limit=1`, `/api/media/capabilities`,
`/media/notifications`, and `/media/messages`; unauthenticated bookmarks
correctly returned 401. Readiness reports 749/749 migrations and healthy
database, Redis, Credit, realtime, and workers. Coolify still exposes no git
SHA, image digest, or deployment ID, so exact candidate-to-image identity and
authenticated production journeys remain incomplete.

Easy baseline batch (2026-10-09): the maintained Media contract checks passed
55 tests covering accessible video and action controls, notification rows and
realtime reconciliation, five-locale parity, Arabic-safe copy constraints,
upload tabs and validation, upload progress/status mapping, video embeds,
removed-link behavior, restaurant Media cards, and payment idempotency keys.
These are local behavior checks; real-device keyboard/RTL and authenticated
deployed activity remain open.

Easy-to-medium publishing batch (2026-10-09): three maintained discovery
browser journeys passed for stale-response protection, deduplicated pagination,
explicit device-location permission, and Following/city URL restoration. Two
publishing browser journeys passed for draft recovery after upload failure,
replacement uploads, guest linked-card navigation, and inert removed targets.
The focused server safety, publisher-verification, draft-attachment, contract,
and access suites passed 87 tests. Real PostgreSQL, private storage, ClamAV,
FFmpeg, and authenticated production execution remain outstanding.

Feed contract batch (2026-10-09): the ranked feed now accepts the canonical
`cursor` query parameter and returns `next_cursor` alongside the retained
`next_before` field. The cursor remains bound to viewer, tab, location, ranking
mode, cutoff, and version. The focused ranking suite passes 10 tests; the
change is pushed in `1e860a42`.

Admin approval integrity batch (2026-10-09): administrator publication now
fails closed when actor verification is missing or indeterminate and only
reports success after the guarded public transition returns a row. The focused
access and moderation suites pass 33 tests; the change is pushed in
`9faefa8e`. Hosted CI and authenticated production proof remain outstanding.

Credit reservation integrity batch (2026-10-09): marketplace reservation
creation now uses a conflict-safe insert so concurrent idempotent retries do
not abort the transaction or increment `reserved_cents` twice. The focused
Credit governance suite passes 19 tests and the change is pushed in
`38e78e13`.

Integrated local verification (2026-10-09): all maintained `media*.test.js`
 suites ran with 205 tests passing and 18 intentionally skipped database-only
tests because this Windows environment has no PostgreSQL service. The client
`npm run build:ci` passed typecheck, localization gates, production build, and
verification of 761 emitted assets. Vite dynamic-import and large-chunk notices
remain advisory. Disposable PostgreSQL/Redis/ClamAV/FFmpeg, hosted CI, and
authenticated live journeys remain open.

Live rollout check (2026-10-09 01:42 UTC): a short deployment window returned
404 for the public routes, then recovered to 200 for `/`, `/ready`, `/health`,
`/api/media/capabilities`, `/api/media/feed?limit=1`, `/media`,
`/media/notifications`, and `/media/messages`; unauthenticated bookmarks
returned the expected 401. Readiness reports release
`content-0a6b6dd815d13503`, 749/749 migrations, and healthy dependencies. The
rollout gap is classified as transient; exact candidate-to-image identity and
authenticated production evidence remain open because release metadata still
does not expose a Git SHA, image digest, or deployment ID.

Hosted disposable safety checkpoint (2026-10-09 01:45 UTC): the dedicated
Media harness in run [37871122216](https://github.com/oxsteed/old-file/actions/runs/37871122216)
completed successfully before the parent verification job was cancelled. It
ran the real API/storage/worker verifier with PostgreSQL, Redis, ClamAV,
FFmpeg, private storage, and synthetic helper, business, restaurant, guest,
blocked, and administrator personas. The harness covered draft ownership,
two-way blocking, duplicate photo retry, video Didit gating, ClamAV clean and
infected decisions, FFmpeg conversion to ready, and public rendition delivery.
The parent run is not a passing release result because its server regression
and migration jobs were cancelled.

Linked-card naming checkpoint (2026-10-09): available linked cards now prefer
the authoritative current entity name returned by the server, while removed
or unavailable targets retain their saved label and remain inert. Nine
maintained client contract checks pass in commit `37a909f1`. Exact-candidate
CI run [37871436611](https://github.com/oxsteed/old-file/actions/runs/37871436611)
is running; its terminal result and authenticated production journeys remain
open.

Explicit publisher selection batch (2026-10-09): the Media composer now loads
the signed-in user's verified helper, business, and restaurant identities and
requires the selected identity to remain fixed after a draft is created. The
server accepts an explicitly owned verified restaurant or business identity,
rejects ambiguous publisher input, and preserves the existing helper fallback
for helper-only accounts. The focused server journey suite passes 38 tests,
the Media client/accessibility and browser journeys pass 12 tests, and the
full client `npm run build:ci` passes with 761 emitted assets. Real authenticated
multi-entity production verification remains open.

Publisher loading race checkpoint (2026-10-09): the composer now waits for the
verified publisher response before creating a draft, surfaces loading and
unavailable states, and fails closed if that lookup cannot complete. The
focused Media client/browser checks pass 13 tests, all five locale catalogs
pass parity checks, and the integrated client build passes with 761 emitted
assets. This closes the client-side identity race; authenticated production
verification and exact candidate CI remain open.

Action feedback checkpoint (2026-10-09): Media like, bookmark, repost, and
share controls now suppress duplicate requests while an action is in flight
and expose localized, live-region failure feedback instead of silently
swallowing transport errors. The focused client/browser suite passes 15 tests,
all five locale catalogs remain aligned, and the full client build passes with
761 emitted assets. Server authorization and multi-client live count evidence
remain open.

Current candidate checkpoint (2026-10-09): pushed HEAD `6139d283` has CI run
[37873401647](https://github.com/oxsteed/old-file/actions/runs/37873401647)
in progress, with both the server/client verification and disposable Media
harness jobs running. After a transient rollout gap, production recovered to
HTTP 200 for `/ready`, `/health`, `/api/media/capabilities`,
`/api/media/feed?limit=1`, and `/media`; readiness reports release
`content-ac71aaf48e521400`, 749/749 migrations, and healthy dependencies. The
release metadata still omits a git SHA, so exact candidate-to-image identity
and authenticated production journeys remain open.

Credit reservation replay checkpoint (2026-10-09): active reservation lookup
now happens before the available-balance check, so a retry of an existing
reservation cannot be rejected by its own reserved amount. A low-available-
balance replay regression was added; the focused marketplace/governance suite
passes 20 tests and the reservation service syntax check passes. Real isolated
PostgreSQL conservation and concurrent settlement evidence remains required.

Saved-feed visibility checkpoint (2026-10-09): the maintained PostgreSQL
visibility suite now seeds saved posts from both blocked directions and a
removed post, then verifies that `/api/media/posts/bookmarks` returns none after
reload. The focused mock access/contract suites pass 44 tests and the new SQL
suite is syntactically valid but skipped locally because no disposable
PostgreSQL service is available. Hosted execution and authenticated live
bookmark/unsave evidence remain open.

Report concurrency checkpoint (2026-10-09): Media report submissions now hold
one PostgreSQL transaction and a reporter-scoped advisory lock while enforcing
the hourly cap, checking for an existing open report, and inserting the flag.
Duplicate and limit regressions are covered; the focused access/contract suites
pass 46 tests. The implementation is pushed in `38895bf5`, with exact-candidate
CI pending in [37874713434](https://github.com/oxsteed/old-file/actions/runs/37874713434).
Real concurrent database and deployed moderation evidence remain open.

Owner deletion checkpoint (2026-10-09): deleting an owned Media post now locks
the row, recalculates parent reply and quoted-post counters, commits the full
transition atomically, and broadcasts the committed counts afterward. Owner
denial and counter-refresh regressions pass as part of a 48-test focused
access/contract run. The implementation is pushed in `9b6f047b`, with exact-
candidate CI pending in [37874833168](https://github.com/oxsteed/old-file/actions/runs/37874833168).
Real PostgreSQL and deployed source-propagation evidence remain open.

Saved-post interaction checkpoint (2026-10-09): the Saved Posts page now
removes a card immediately when its bookmark action succeeds in the unsaved
state. The focused client contract passes 2 tests, localization parity passes,
and the full client build verifies 761 emitted assets. The implementation is
pushed in `c91983d5`, with exact-candidate CI pending in
[37875142624](https://github.com/oxsteed/old-file/actions/runs/37875142624).
Authenticated deployed bookmark/unsave evidence remains open.

Blocked-action checkpoint (2026-10-09): the maintained PostgreSQL visibility
suite now covers both block directions across direct actor/post reads and all
five state-changing actions, asserting a 404 before any action write. The suite
is syntax-checked and remains intentionally skipped locally without PostgreSQL;
the implementation/test batch is pushed in `d9e3f14c`, with exact-candidate CI
pending in [37875210815](https://github.com/oxsteed/old-file/actions/runs/37875210815).
Hosted database and deployed blocked-link/reply evidence remain open.
