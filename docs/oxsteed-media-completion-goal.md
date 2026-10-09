# OxSteed Media combined completion evidence

## Current directive (2026-10-09)

Finish MVP, v2 and v3 as **one integrated release, one final push** from
`d9df71ec`, using up to four agents total. The primary owns shared-file
coordination, migration allocation, integration and evidence.
[The execution plan](oxsteed-media-execution-plan.md) supersedes earlier
per-batch push rules. Preserve unrelated scratch files; no intermediate or
documentation-only pushes. The goal remains incomplete.

All **57 requirements** are retained in the approved six easy-to-hard sections.
**Implemented** means source exists; **behavior-tested** means recorded behavior
ran; **verified live** requires exact-candidate deployment evidence;
**incomplete** identifies missing implementation/acceptance. Local evidence does
not substitute for required runtime/live checks. Mocks, skipped tests, earlier
releases and emulation never count as full acceptance.

## Section progress

| Section | Local evidence rows / total | Fully accepted / total | Remaining acceptance |
| --- | --- | --- | --- |
| Evidence and product polish | 1/5 | 0/5 | Run final client smoke/Chromium/localization/build; then actual activity generation, authenticated navigation and deployed share previews. |
| Core interactions | 3/12 | 0/12 | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Verification and publishing | 3/12 | 0/12 | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Discovery and integrations | 1/11 | 0/11 | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Marketplace and Credit | 1/11 | 0/11 | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Verification and release | 2/6 | 0/6 | Exact-candidate CI, full upgrade/repeat, runtime/readiness/assets identity, authenticated production, physical devices and read-only financial reconciliation remain required. |

Counts exclude source-only and still-pending container/live checks; they track
evidence rather than a speculative implementation percentage.

## 1. Evidence and product polish

| Requirement | State / implementation and behavioral evidence | Outstanding evidence / next action |
| --- | --- | --- |
| Reconciled source and retained work | Behavior-tested locally: Writable clone C:/Temp/oxsteed-media-design-20261008, branch old-files-claude, baseline d9df71ec. Three unrelated browser scratch files preserved; no intermediate push. | Run final client smoke/Chromium/localization/build; then actual activity generation, authenticated navigation and deployed share previews. |
| In-shell notifications and messages | Implemented; complete acceptance pending: Current source provides this surface; complete journey evidence is still required. | Run final client smoke/Chromium/localization/build; then actual activity generation, authenticated navigation and deployed share previews. |
| Navbar/account/footer/legal navigation | Implemented; complete acceptance pending: Mobile saved/verification/creator shortcuts, sign-in return state, real React Router actor matching and contained dialog focus added; existing account/footer/legal shell retained. | Run final client smoke/Chromium/localization/build; then actual activity generation, authenticated navigation and deployed share previews. |
| Accessibility and five languages | Implemented; complete acceptance pending: Maintained Chromium journeys exercise five languages at360/1440px and dialog Tab containment. This is browser emulation, with network fixtures where specified; physical-device/live evidence remains open. | Run final client smoke/Chromium/localization/build; then actual activity generation, authenticated navigation and deployed share previews. |
| Image-rich share previews | Implemented; complete acceptance pending: . | Run final client smoke/Chromium/localization/build; then actual activity generation, authenticated navigation and deployed share previews. |

## 2. Core interactions

| Requirement | State / implementation and behavioral evidence | Outstanding evidence / next action |
| --- | --- | --- |
| Post identity, badges, handles, time and views | Implemented; complete acceptance pending: . | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Replies and sticky entry | Behavior-tested locally: Real PostgreSQL proves ordinary unverified member replies remain public, root posts stay denied and blocks still hide replies. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Quotes and embeds | Implemented; complete acceptance pending: quoted content/media and linked cards rendered.. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Reply/repost/like/bookmark/share counts | Implemented; complete acceptance pending: actions exist, with viewer state; full response/retry/concurrency coverage outstanding.. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Owner/viewer state on all responses | Implemented; complete acceptance pending: owner identity now included in feed, search, actor, replies, quotes and business-post responses; real cross-surface execution remains outstanding.. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Saved posts | Implemented; complete acceptance pending: authenticated saved feed filters removed and mutually blocked posts, and unsaving from Saved Posts immediately removes the card through a bookmark-change callback.. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Reporting and automatic moderation | Implemented; complete acceptance pending: report reason/note validation now runs the hourly cap, duplicate check, and insert inside a per-reporter advisory-locked transaction; duplicate and cap responses are covered by 46 focused access/contract tests.. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Owner editing/deletion | Implemented; complete acceptance pending: owner deletion now locks the post, updates reply/quote counters, and commits the visibility change atomically; owner-scoped denial and counter refresh are covered by the focused contract suite.. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Two-way blocking and inactive authors | Behavior-tested locally: Real PostgreSQL covers reciprocal blocks, author inactivity, public/saved/search/detail/action boundaries and inert blocked linked cards. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Daily/upload/report limits | Behavior-tested locally: New real PostgreSQL race first reproduced two successful requests past9 posts. Separate advisory lock plus post/link/counter transaction now yields201/429 and exactly10 posts. Upload/report coverage retained; actual API limits still need final execution. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Linked entity selection and five-card limit | Implemented; complete acceptance pending: server search and composer selection exist, entity search and hydration apply two-way owner blocking, draft/public link writes now resolve live targets and replace client labels/prices with authoritative snapshots, and blocked targets preserve a plain snapshot label.. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |
| Public cards versus transaction login | Implemented; complete acceptance pending: all formerly intercepted guest card types now navigate to public targets; removed cards remain inert.. | Run full Media SQL/API interaction/block/quota matrix and authenticated owner/viewer reload. |

## 3. Verification and publishing

| Requirement | State / implementation and behavioral evidence | Outstanding evidence / next action |
| --- | --- | --- |
| Helper Didit-backed identity | Implemented; complete acceptance pending: `users.is_verified` checks at upload and commit; mocked behavior covers revocation at attachment commit.. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Business and restaurant verification | Behavior-tested locally: Real PostgreSQL proves exact represented business/restaurant verification, revocation and admin denial. Hosted API verifier adds ownership, request, changes, resubmission and approval. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Verification request and return path | Implemented; complete acceptance pending: in-shell center, owner submission, admin review and Didit return.. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Durable private drafts | Implemented; complete acceptance pending: maintained desktop/mobile browser check retains edits and draft ID across upload failure/retry.. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Attachment replacement and duplicate recovery | Behavior-tested locally: Real PostgreSQL duplicate attachment/publication/replacement cases execute without skips; sticky unsafe verdicts remain enforced. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Post-publication attachment protection | Behavior-tested locally: Real PostgreSQL publication lock denies a late attachment on a now-public post. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Stored-file cleanup and lost responses | Implemented; complete acceptance pending: thumbnail failure cleanup, preserve committed files after signing/commit response loss, defer cleanup on DB outage.. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Actual file content and external URLs | Implemented; complete acceptance pending: existing magic-byte checks and strict HTTPS host/video-ID parsing/canonicalization; lookalike hosts rejected.. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Malware, quarantine and conversion | Implemented; complete acceptance pending: real scanner required; jobs and shared aggregate state preserve safety verdicts.. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Preview, progress, processing and retry | Implemented; complete acceptance pending: composer browser cases cover failure and ready transition; video jobs now use expiring leases, fenced completion and bounded retry scheduling so crashed workers can be reclaimed safely.. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Publication/public-delivery/admin safety predicates | Implemented; complete acceptance pending: common policy exists; admin cannot rewrite asset verdicts; sticky flagged replacement test passes.. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |
| Cloudflare interim and deferred Thorn | Implemented; complete acceptance pending: retained explicit interim status; no synthetic vendor clearance.. | Run complete isolated scan/quarantine/FFmpeg/storage API journey and actual Didit/entity return on the exact deployment. |

## 4. Discovery and integrations

| Requirement | State / implementation and behavioral evidence | Outstanding evidence / next action |
| --- | --- | --- |
| City/category Spaces | Implemented; complete acceptance pending: city/category channels, join/leave state, post counts, and visibility-aware member counts are returned by the Media Space endpoints and rendered in the localized client.. | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Nearby coordinates and city/state fallback | Implemented; complete acceptance pending: entity coordinates from helpers, businesses, restaurants, jobs and linked targets rank nearby; explicit city/state matching remains available, removed entities lose their boost, and reciprocal-blocked linked targets no longer contribute a ranked link boost.. | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Guest and device location choices | Implemented; complete acceptance pending: guests can choose city/state, use device location only after an explicit action, persist a rounded choice, return to profile location, or select all locations.. | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Versioned context-bound feed cursor | Behavior-tested locally: Version3 binds viewer/tab/location/ranking/cutoff; rejects old placement cursors. Real PostgreSQL proves microsecond ranked pagination and location-context rejection without duplicate IDs. | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Stale tab responses and duplicates | Implemented; complete acceptance pending: Feed generation/dedup guards retained; Search/Actor/Detail now ignore obsolete route/account requests. | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Follows and Following | Implemented; complete acceptance pending: . | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Live authoritative counts | Implemented; complete acceptance pending: the shared Socket.IO lifecycle now exposes a read-only `/media` namespace, action endpoints broadcast committed post counters, and feed/detail cards reconcile those counters without mutating state from socket events.. | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Business Hub integration | Implemented; complete acceptance pending: . | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Profile Studio/public-profile integration | Implemented; complete acceptance pending: . | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Rentals/Direct/Logistics cards | Implemented; complete acceptance pending: . | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |
| Restaurant copy/ownership/deduplication | Implemented; complete acceptance pending: source posts remain deduplicated and anchored to the current restaurant owner; a later CSAM flag now removes every federated Media post by source ID in the same transaction, with focused CSAM/federation tests passing.. | Run actual Following/realtime/Spaces/entity/profile/copy/removal API and deployed matrix. |

## 5. Marketplace and Credit

| Requirement | State / implementation and behavioral evidence | Outstanding evidence / next action |
| --- | --- | --- |
| Creator/buyer dashboards and opportunities | Implemented; complete acceptance pending: creator shell lists offers, open gigs and applications; sponsorship offers now support acceptance, deliverable submission and settlement controls.. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Applications and award/acceptance | Implemented; complete acceptance pending: Explicit creator acceptance endpoint/UI added. Award reserves funds and durable creation keys serialize payload/currency replay matching. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Deliverable revisions and approval | Implemented; complete acceptance pending: Gig/sponsorship revisions retain reservations; current public post safety and creator verification are rechecked before settlement. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Gig reservation and payment | Implemented; complete acceptance pending: award reserves Credit, approved deliverables settle once, and cancellation/rejection releases the reservation; linked and submitted posts are rechecked for current public safety and verified publisher state.. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Sponsorship reservation/delivery/payment | Implemented; complete acceptance pending: acceptance reserves funds, creators submit a published ready deliverable, settlement requires `delivered`, and cancellation releases an active reservation.. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Tips | Implemented; complete acceptance pending: tips use durable payload-bound idempotency and settle through the shared creator settlement rail with verification and self-payment guards.. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Cancellation/release/refund/dispute review | Implemented; complete acceptance pending: Delivered cancellation/rejection opens contested-work review and keeps funds reserved. Audited admin release/resume requires reason. Settled gig/tip/sponsor/boost disputes use scoped shared Credit compensation. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Boost payment to platform revenue | Implemented; complete acceptance pending: purchaser wallet is charged through the shared settlement rail into `platform_revenue`; self-transfer and replay are rejected, and both boost creation and settlement recheck current public safety and verified-publisher predicates.. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Sponsored placement and 24-hour duration | Behavior-tested locally: Real PostgreSQL nine-item/seven-boost test retains all posts, permits one paid slot atposition5 across two-item pages and removes labels on expiry.24-hour actual settlement awaits financial runtime. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Price/currency disclosure and purchaser history | Implemented; complete acceptance pending: boost confirmation returns amount/currency before settlement, and the Media creator shell now lists tip, sponsorship and boost payment history with transaction-linked dispute entry points.. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |
| Atomic accounting/precision/fees/isolation | Implemented; complete acceptance pending: Shared Credit safeguards retained; no accounting pass is claimed until new real financial verifier executes on the migrated disposable runtime. | Run strict disposable Media Credit verifier: conservation, journal pairs, reserve/release/settlement/replay/races/freezes/currencies/disputes and wallet isolation; verify buyer/creator/admin UI. |

## 6. Verification and release

| Requirement | State / implementation and behavioral evidence | Outstanding evidence / next action |
| --- | --- | --- |
| Repeatable isolated fixtures | Implemented; complete acceptance pending: optional Media compose extension, scoped wrapper, synthetic persona seed and real API/scan/conversion verifier.. | Exact-candidate CI, full upgrade/repeat, runtime/readiness/assets identity, authenticated production, physical devices and read-only financial reconciliation remain required. |
| Required real database proof | Behavior-tested locally: Baseline all18 Media suites passed256 tests with zero PostgreSQL skips locally. Additional concurrency/reply/placement and new749 rehearsal now run against the same isolated portable PostgreSQL16.15. Record final integrated count below. | Exact-candidate CI, full upgrade/repeat, runtime/readiness/assets identity, authenticated production, physical devices and read-only financial reconciliation remain required. |
| Migration upgrade and repeat application | Behavior-tested locally: New749 portable PostgreSQL upgrade/repeat/constraint/concurrent-review rehearsal passes4 tests, zero skips. Prior migrations unchanged. Full upgraded schema rehearsal remains required in final CI. | Exact-candidate CI, full upgrade/repeat, runtime/readiness/assets identity, authenticated production, physical devices and read-only financial reconciliation remain required. |
| Passing exact-candidate CI | Incomplete: Baseline d9df71ec run37884621920: server/client PASSED; migration rehearsal PASSED; upload harness FAILED on expected Springfield versus canonical springfield. Assertions repaired; final candidate has not been pushed. | Exact-candidate CI, full upgrade/repeat, runtime/readiness/assets identity, authenticated production, physical devices and read-only financial reconciliation remain required. |
| Exact deployed release/readiness/schema/assets | Incomplete: Previously healthy ready/health responses are baseline evidence only; candidate must be matched by SHA or deterministic committed-content identity after final push. | Exact-candidate CI, full upgrade/repeat, runtime/readiness/assets identity, authenticated production, physical devices and read-only financial reconciliation remain required. |
| Authenticated production/real-device matrix | Incomplete: . | Exact-candidate CI, full upgrade/repeat, runtime/readiness/assets identity, authenticated production, physical devices and read-only financial reconciliation remain required. |

## Integrated verification and release gates

The final local sweep records commands/results here before the coherent commit.
The single push retains all CI jobs and adds financial verification to the same
disposable PostgreSQL/Redis/private-storage/ClamAV/FFmpeg job. Missing runtime
checks remain outstanding until execution. Cloudflare is the authorized interim
policy; Thorn remains deferred. Financial writes remain synthetic/isolated,
production reconciliation read-only, production controller/volumes preserved.

After push require exact-commit green CI, full migration upgrade/repeat, deployed
SHA or reproducible committed-content identity, ready/health/workers/assets,
helper/business/restaurant/admin production journeys and physical devices.
Post-push evidence is saved in a local release report without another docs push.
A genuine failure can require a corrective commit/run.

Earlier narrative/test-count claims are superseded by this requirement matrix
and the actual reports for the integrated candidate.

Final local sweep (2026-10-09):

- All22 Media Jest suites: **293 passing tests, zero skips**. Actual portable
  PostgreSQL executes the three required Media DB suites; the mandatory result
  checker confirms no skipped cases. Includes quota/report concurrency,
  member replies, block boundaries, boost placement and749 upgrade/repeat.
- Full existing Credit regression plus portable artifact/inventory checks:
 143 passing tests in3 suites. Real FFmpeg restaurant transcode + catalog
 regression:30 passing tests in2 suites using the checksum-verified portable
 FFmpeg9.0.2 binaries outside the checkout.
- Script/deployment/release/fixture guards:29 passing tests; updated Media DB
 and finance-isolation contracts:3 passing tests, zero skips.
- Complete client smoke wildcard: **388 passing tests, zero skips**. The
  maintained browser journeys passed 17/17, the route-specificity check passed
  1/1, and the embedded Didit verification journey passed 1/1 in English and
  Arabic at desktop and 360px layouts. Client type, localization-parity, and
  `npm run build:ci` completed successfully; Vite verified **763 emitted
  assets**. These are browser emulation and synthetic provider-return checks;
  a real Didit callback, physical devices, and deployed behavior remain open.
- A full server sweep was attempted on the partially migrated portable DB:
 456 suites passed,22 failed,5093 tests passed,207 failed,46 skipped. It is
 **not** a passing full-server result. Missing migrated public tables and
 Windows-only fixture/path/FFmpeg prerequisites were observed. Focused
 portability regressions were repaired and passed; complete schema regression
 remains a final hosted CI gate.
- Full real financial/runtime verifier is added to the same final disposable CI
 job; it has not run on this Windows host. No conservation/payment claim yet.
- Candidate CI/deployment/authenticated-production/physical-device acceptance
 remains incomplete. No production financial writes or intermediate pushes.
