# OxSteed Media completion evidence

The previous MVP completion report was premature. Passing generic CI does not
prove the full Media journeys. This document tracks the renewed completion goal
against the locked specification, retaining the v2/v3 release boundaries.

| Requirement | Current evidence / remaining work |
| --- | --- |
| Signed-in recognition, likes/bookmarks, two-way blocks | Public router now resolves optional sessions; shared browser API retains credentials/refresh; search grouping and actor aliases corrected. Route and PostgreSQL regression tests added; database and live execution pending. |
| Safe admin approval | Approval rejects uncertified, unverified, unprocessed or flagged video and removed posts; never rewrites asset verdicts or finishes worker jobs. Focused regression tests added; live verification pending. |
| Draft-to-publication uploads | Still incomplete: composer publishes before attachment succeeds. Needs durable draft/retry, idempotency, progress/previews and processing UI. |
| Upload safety in all public surfaces | Audit all asset delivery, worker concurrency, multi-asset readiness, certification and identity gates. Admin override fixed first. |
| Nearby discovery and pagination | Still incomplete: Space membership is not distance; timestamp-only cursor does not match ranking. |
| Saved posts, reports, edit/delete | Still incomplete: add usable controls and enforce server ownership/visibility. |
| Accessible actions and entity picker | Still incomplete: remove manual IDs and improve labels, keyboard flows and media controls. |
| Localized image-rich previews | Still incomplete: initial prerender copy is English and uses the site logo. |
| Five languages | Existing catalog parity passes; all new copy requires en/es/fr/ht/ar coverage. |
| Full user journeys | Add targeted browser and API evidence for verified poster, guest, blocked accounts, upload failures, replies, notifications and mobile playback. |
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

Next: verify this batch in Linux CI, then implement a durable private draft and
explicit publication step before addressing local ranking and post controls.
