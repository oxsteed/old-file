# Thirty-feature execution tracker

Requested implementation set: the 30 features selected from the user-supplied
persona roadmap. Baseline: PR 805 at `1305b1817a36ca20ac9616f133847ae30cc3bb8f`.
The feature list is descriptive; all protected operations retain server authority.

Current source status: all 30 selected features have implementations and focused
local verification. The final six business-team features are detailed below.
Exact-head GitHub CI and non-production operational acceptance are separate
from this source-completion status. Paid rental extensions are out of scope;
the delivered extension flow requires explicit no-additional-charge consent.

| Roadmap ID | Feature | Delivery |
|---|---|---|
| 163 | Distance preferences | Implemented; saved cross-device radius drives nearby opportunities |
| 165 | Work suitability preview | Implemented; advisory access, requirements and timezone-aware calendar preview |
| 166 | Itemized bid builder | Implemented; local database/browser verification passed |
| 167 | Materials templates | Implemented; create/edit/reuse/delete with scope and version checks |
| 168 | Quote validity control | Implemented; server expiry denial and renewal as a new version |
| 169 | Counterproposal editor | Implemented; customer proposal, provider decision, explicit customer acceptance |
| 170 | Quote revision history | Implemented; immutable prior terms and previous/current comparison |
| 174 | Daily job limits | Implemented; settings, slot filtering, concurrent write/reschedule enforcement |
| 175 | Travel time blocks | Implemented; fixed user-selected gap around helper appointments |
| 191 | Portfolio permission request | Implemented; private upload, customer decision, history, withdrawal and revocation |
| 208 | Standard quote terms | Implemented; defaults snapshot across finance/chat/lead quote creation |
| 209 | Business pricing templates | Implemented; business-scoped create/edit/apply/delete with versions |
| 212 | Role templates | Implemented; owner-only reusable business roles/overrides and application history |
| 213 | Permission preview | Implemented; server-computed before/after and added/removed permissions, stale confirmation denial |
| 214 | Membership expiry | Implemented; database and browser verified |
| 215 | Offboarding dashboard | Implemented; database and browser verified |
| 219 | Overdue task alerts | Implemented; database and browser verified |
| 224 | Follow-up reminders | Implemented; database and browser verified |
| 229 | Team onboarding guide | Implemented; database and browser verified |
| 230 | Policy acknowledgment history | Implemented; database and browser verified |
| 557 | Accessory inventory | Implemented; database and browser verified |
| 558 | Usage restrictions | Implemented; database and browser verified |
| 572 | Condition checklist | Implemented; database and browser verified |
| 573 | Accessory count | Implemented; database and browser verified |
| 577 | Return condition report | Implemented; database and browser verified |
| 578 | Missing accessory record | Implemented; database and browser verified |
| 581 | Extension request | Implemented; database and browser verified |
| 582 | Schedule conflict alert | Implemented; database and browser verified |
| 585 | Late-return follow-up | Implemented; database and browser verified |
| 593 | Repair record | Implemented; database and browser verified |

## Quote and capacity increment

- Job detail hosts itemized helper quotes. Customer ownership and effective
  helper access determine the server audience. Persona/mode labels are unused.
- Labor/material lines have bounded quantities and integer minor-unit prices;
  totals use the existing exact basis-point money helper. Currency follows the
  job. Accepted terms create a bid at the exact currency/price/current job
  revision, then the existing hire/schedule flow completes the assignment.
- Submissions and revisions are retry-safe. The job and quote are locked in
  consistent order. Old versions cannot be accepted. Accepted versions cannot be
  revised; customer counterproposals require provider agreement and then explicit
  customer acceptance of the resulting new quote. No payment is made by quoting.
- The legacy helper status endpoint delegates managed quotes to the guarded
  lifecycle. Chat response checks also delegate; managed quote sharing/revision
  stays in the job workspace to avoid incompatible legacy currency/guest flows.
- Material templates are helper-scoped and currency-specific. Updates require
  an expected version. No scope is inferred from a template or a client field.
- Daily capacity and travel gaps are saved through `/helpers/me/capacity`.
  Defaults are unlimited/zero. The shared availability computation filters slots;
  an appointment trigger serializes writes and enforces limits even when called
  through an older API. Completed appointments count toward daily capacity;
  cancellation releases it. Existing reservations are not automatically cancelled.
- Daily limits use the profile timezone (UTC fallback). Cross-midnight bookings
  count on every touched local day. Travel is a fixed conservative gap around
  helper appointments, not a route estimate or a business-wide staffing policy.
- A failed capacity check during bid acceptance rolls back hiring and financial
  bookkeeping. It is no longer swallowed as an optional calendar insertion error.
- A widening of `bids.amount` preserves three-decimal display values while
  canonical minor amounts remain authoritative. The migration recreates existing
  noninternal triggers verbatim, preserving their enabled modes. Other additive
  migrations introduce templates, counters and capacity settings. Applied
  historical migrations are unchanged.
- New functionality is available by default to authorized users. Five-language
  legacy/namespaced catalogs and private analytics boundaries are maintained.

## Verification recorded for this increment

- Fresh disposable PostGIS migration: passed, including trigger recreation.
- Quote database/compatibility suites: 18 tests passed. Includes currency
  exponents, retries, counter-consent, concurrent revisions, expiry through the
  legacy route, scope/revocation, and stale template updates.
- Capacity, availability, hiring, booking lifecycle and error-handler suites:
  92 tests passed. Includes a real HTTP hiring rollback, concurrent reservations,
  cancellation/completion, rescheduling, and local-day boundaries.
- Quote and capacity browser journeys: passed with synthetic APIs; covers
  create/edit/reuse, counter/accept, conflict draft retention, linked bid,
  explicit reload, revocation and Arabic RTL.
- Client `npm run build:ci`: passed (1238 emitted assets).
- Migration history check against the full baseline SHA: passed.
- GitHub CI is tracked on each pushed commit. Local checks are not production
  acceptance, provider/payment activation, or a human screen-reader pass.

Rollback application code while retaining the additive data/schema. Do not
rewrite an applied migration or delete saved quotes, counterproposals or limits.

## Discovery and portfolio increment

- A helper saves a 1–250 mile opportunity radius with optimistic concurrency.
  Nearby Home opportunities use that radius with existing geographic search.
  Missing coordinates retain the explicit same-city fallback. This is a search
  preference, not a restriction or a grant; directory filters remain independent.
- Suitability reads only open jobs or the helper's own assignment. It uses
  effective helper access, current job status, requirements and the existing
  availability service in the helper's timezone. Unknown schedule data stays
  unknown. Skills need human confirmation; the preview never certifies them,
  reserves work or bypasses submission checks. No customer private fields leave
  this endpoint.
- Portfolio upload is limited to the assigned effective helper after completion.
  Existing upload validation, quotas and scanning apply; images are re-encoded
  as JPEG with metadata removed and stored privately. Requests bind the exact
  image and public caption. Only the job customer may approve/decline/revoke;
  only the helper may withdraw. Retry keys, bounded collections, version checks
  and job/decision locks prevent duplication and conflicting decisions.
- Approval adds the existing gallery item. Its image URL streams through a
  no-store endpoint that checks approval and effective helper access each time.
  Withdrawal/revocation deletes that gallery row. Authenticated participants get
  five-minute signed previews, not permanent public storage URLs. Already
  downloaded copies or signed previews cannot be recalled before their expiry.
- Changes are available by default, with all five legacy/namespaced locales.
  Account/access changes discard obsolete responses and clear scoped content.
- Database verification: 15 tests passed across discovery/portfolio and prior
  work-record suites (5.58s), including actual transactions and public-image
  HTTP denial after revocation. Storage was an in-memory test double; decoding
  used real Sharp. Live storage/provider behavior remains unverified.
- Browser verification: new discovery/consent journey and the affected JobDetail
  matrix both passed (2 tests, 31.98s); includes saved radius applied to search,
  stale draft retention, upload/request/approval/revocation, Arabic RTL, narrow
  viewport and access-change clearing. Browser APIs were synthetic.
- Client build: passed, 1238 emitted assets. Migrations applied successfully to
  the same disposable PostGIS database; historical migration files unchanged.
- Prior increment exact-head CI passed on
  `2cbecb0ee37982567907f384aa3c090a6f1cfa03` in run `44712422233`.

Retain additive schema and consent history on rollback. Do not turn private
portfolio objects into public objects or weaken the live image consent check.

## Business quote standards increment

- Finance-authorized members maintain standard terms and reusable USD pricing
  templates in the existing quote builder. Templates include exact minor-unit
  prices, quantities, tax and terms. Read-only finance members cannot write;
  foreign businesses and revoked memberships are rejected through current gates.
- Database triggers snapshot defaults across every business quote insert path,
  including chat and lead quotes. Terms on sent quotes cannot be rewritten.
  Changing saved defaults never changes existing quotes. Conversion preserves
  the agreed terms in invoice notes. Helpers' separate job quote flow is intact.
- The existing copied `/quote/:token` destination had no application route.
  It now renders the shared quote, frozen terms and explicit accept/decline.
  Drafts are unavailable through this link; response is valid only for a sent,
  unexpired quote and records a decision without charging a payment. The shared
  link remains the existing bearer capability and exposes no client email.
- Lead quote creation referenced nonexistent amount_cents/valid_until columns
  and omitted required business_id. It now validates integer minor input and
  writes actual amount/expires_at fields within the verified lead scope.
- Five-language legacy/namespaced UI, RTL and private analytics boundaries are
  maintained. The builder resets on account/session/business identity changes.
- Disposable database and existing chat suites: 17 tests passed, four suites,
  2.0s. Includes real HTTP authorization, default snapshots, stale versions,
  foreign template denial, public quote handoff, immutable sent terms and a
  second-decision rejection. Lead creation exercised against the actual schema.
- Browser: pricing-template CRUD/apply, exact cents conversion, default terms,
  stale draft preservation, keyboard customer acceptance and Arabic RTL passed
  (1 test, 9.56s), using synthetic APIs. Client build passed with 1239 assets.

Rollback retains quote snapshots and templates; sent terms remain immutable.

## Role templates and permission preview increment

- The existing Business Hub Team area has owner-only saved role templates.
  Templates contain an existing business role and explicit allow/deny overrides.
  They do not create a capability or change location assignments by themselves.
- The server previews the target member's actual current role/permissions and
  the saved template's resulting effective permissions, including added/removed
  codes. Application requires current business ownership, explicit confirmation
  and a reason. It replaces the stated business role and override set atomically.
- Confirmation is bound to template version, membership version, current role
  defaults and effective permission sets. Concurrent edits, old override APIs,
  membership changes and competing confirmations invalidate stale previews.
  Database triggers advance the membership version even through existing writers.
- Role changes, overrides, immutable before/after application records and access
  projection invalidation commit together. Existing permission/realtime cache
  invalidation follows commit. Other business memberships and helper grants are
  unchanged. A template cannot edit an owner's own membership or foreign scope.
- Full template create/edit/delete, named member selection, preview, explicit
  apply, reasons/history, five-language catalogs and RTL are implemented. Scoped
  content clears on account/session/access changes. Loading is announced.
- Database: role templates, quote standards, existing managed permissions and
  existing offboarding regression suites are exercised. The first combined run
  had 12 passing tests and skipped six offboarding tests because that suite uses
  STATEMENT_TEST_DATABASE_URL; those six then passed with that variable set.
  Final combined run with both variables set: all 18 tests passed across four
  suites (2.80s), with no skipped tests.
- Browser: the new role-template CRUD/preview/stale-confirm/apply/Arabic/revocation
  journey passed (1 test, 5.13s). All three existing workspace-navigation browser
  journeys passed, including delayed editors and cross-account draft isolation.
  The first new browser fixture failed because it used the native window.history
  name for test data; renaming the fixture state fixed it. Production code was
  not weakened. Client build passed with 1240 emitted assets.
- Migration history/append order, growth instrumentation and diff whitespace
  checks passed. No merge, deployment or production acceptance was performed.

## Equipment operations increment

Inspected integration: f6934cd2a6fa3c10c9dc7965b404649b1a2c63bd, PR 805.
This increment implements the ten selected equipment features (557, 558, 572,
573, 577, 578, 581, 582, 585, 593) in existing owner/renter workspaces.

- Equipment owners maintain a versioned accessory inventory, condition checklist
  and usage rules in ToolOwnerDashboard. Booking confirmation displays those
  terms and rejects stale configured inventory. Each booking freezes a separate
  inventory/rules snapshot. Later listing edits do not rewrite that agreement.
- Both booking parties can submit their own pickup/return reports with exact
  observed counts, checklist results and notes. Amendments append versions and
  preserve old observations. Missing accessories compare against the owner's
  pickup record when present, otherwise the booking snapshot. Owners resolve
  discrepancies with a shared explanation; reports do not assess charges.
- Renters request extensions and owners explicitly approve or decline them.
  This delivery supports no-additional-charge extensions with both parties'
  explicit agreement. Existing invoices, total price and deposit records stay
  unchanged. Paid extensions are outside this increment and require separate
  billing/consent work; no financial transaction is fabricated.
- Calendar conflicts are rejected under the existing per-tool lock, including
  older booking writes via a database trigger. Owner approval checks live dates;
  a conflict leaves the request pending. Request retry IDs prevent duplicates.
  Row/advisory lock order matches existing status writers.
- Owners see late rentals and record follow-up notes shared in the renter's
  booking workspace. These are persistent in-app follow-ups, not email/push or
  automated debt collection. Owner-only repair history records completed work.
- Effective tool-owner access and exact ownership are rechecked for owner
  operations. Renters retain their own booking history when owner access ends.
  Foreign accounts cannot read or mutate these records. Account/session changes
  reset both existing parent pages and the equipment panels; access changes
  discard obsolete reads and clear the panel. All authenticated reads are
  no-store, all five catalogs are updated, and private form data is excluded
  from analytics. Existing peer-rental, invoice and deposit flows remain in use.
- Real booking creation previously selected an ambiguous unqualified id from a
  users join. The selected tool fields are now qualified; the real database
  test exercises creation and both agreement/inventory snapshots.
- Verification: disposable PostGIS migrations passed; 26 tests passed across
  seven suites (3.87s), covering inventory CAS, scope, real booking creation,
  report versions, discrepancy resolution, concurrent calendar writes, rejected
  extensions, explicit consent, unchanged pricing, follow-ups, repairs and
  revoked old-link denial. Existing rental/deposit/date/error suites passed.
- Browser verification: inventory and repair editing, owner pickup, renter
  return counts, missing accessory resolution, extension consent/conflict,
  Arabic RTL/narrow viewport and access-change clearing passed (1 test, 7.92s).
  Browser APIs were synthetic; real database paths were tested separately.
- Initial client build passed (1246 emitted assets). Final validation and exact
  GitHub head are recorded when pushed. Migration history, growth registry and
  whitespace checks passed. No production acceptance, merge or deployment.

24 of the selected 30 features now have implementations with local verification.
The six remaining items are business membership expiry (214), offboarding
completion review (215), overdue task alerts (219), follow-up reminders (224),
team onboarding guide (229), and policy acknowledgment history (230).

## Final business-team increment

Completes 214, 215, 219, 224, 229 and 230 against the equipment increment
9b26b2f28da4e6a40ca9cb44bee10dd7b75af38e.

- A shared Team guide and work panel in the existing business workspace shows
  owner-published onboarding guides and policies. Versions append; acknowledgments
  bind the exact document/version read, are retry-safe, and remain in history.
  Publishing a revision never acknowledges it for someone else. Staff can read
  only within current standing; the owner can see the team's acknowledgment
  history. These records do not create grants or replace domain activation.
- Owners assign tasks to active team members; members can create their own
  follow-up reminders. Due/overdue state is computed on the server, with exact
  counts and a bounded list. The panel refreshes once per minute and on focus.
  Reminders are persistent in-app records, not email/push promises. Completion
  and reopening require current scope, assignee/owner authority and a version.
  Request keys and serialized creates prevent duplicates on retries.
- Existing offboarding/rehire machinery is reused. Open team tasks are reassigned
  atomically to the existing handoff target; completed work remains historical.
  The dashboard shows removal reasons, reassignment counts, flagged cash drawers
  and retention dates, linking back to the existing Team management/rehire flow.
  Team acknowledgment/task foreign keys preserve anonymized history instead of
  newly blocking account deletion. Owners cannot see another organization's data.
- Active membership expiry is a separate nullable access_valid_until field;
  existing invitation expires_at semantics are unchanged. Only the current owner
  can schedule/clear a future end time with an expected membership version.
  Already-expired access cannot be revived by clearing the date: existing
  invitation/rehire admission applies. Owner and member views show the deadline.
- Canonical business/restaurant/finance/PIN-session guards and access projection
  exclude elapsed memberships before cleanup. Authenticated and optional-auth
  user requests settle due expiry before downstream operations, including older
  raw membership consumers. A fenced minutely worker also settles due records.
  Cleanup, reassignment, scoped staff session/PIN removal, history and projection
  invalidation commit together. Failed cleanup rolls back and fails closed with
  retryable 503; the timestamp-based canonical scopes still deny access.
- Expiry cleanup deliberately preserves account refresh sessions and unrelated
  memberships/helper grants. Existing manual offboarding keeps its previous
  session-revocation behavior. The expiry test uses a real signed access token:
  an old business link is rejected while another business and helper capacity
  remain available, and the account session remains valid. Real restaurant
  scope/projection denial is verified before cleanup. Competing expiry checks
  produce one history/offboarding record. No instantaneous UI or socket-room
  invalidation is promised: normal refresh and worker backlog apply, and an
  already-authorized in-flight operation may finish.
- Available by default under existing business standing and business.view.
  Owner mutations use current ownership. All five legacy/namespaced catalogs,
  keyboard controls, live status messages, RTL, account/scope resets and private
  analytics boundaries are covered. No persona label or client preference
  establishes authority.

## Final verification evidence

Source baseline: f6934cd2a6fa3c10c9dc7965b404649b1a2c63bd (latest PR pulled before
this continuation). Equipment package pushed as 9b26b2f28da4e6a40ca9cb44bee10dd7b75af38e.
The final business-team package's exact commit is the commit containing this
record; GitHub PR 805 records the exact pushed head/run. Commands ran from the
isolated /private/tmp/oxsteed-pr805-ci-repair worktree.

- Disposable PostgreSQL/PostGIS migrations: applied successfully, including the
  three business-team/expiry migrations. Historical files remained unchanged.
- ACCESS_TEST_DATABASE_URL and STATEMENT_TEST_DATABASE_URL targeted only
  127.0.0.1:32800/credit_statement_test. Focused team/access/expiry/auth/offboarding/
  restaurant scope/crew/role/calendar/message regression run: 83 tests passed,
  ten suites, 5.08s; no skipped tests. Includes deliberate cleanup failure and
  rollback, overlapping grants, stale versions, old links, and real HTTP auth.
- Dedicated POS/staff-session verification used st_t3, cloned from that disposable
  database in the same task-only container. restaurantStaffIdentity.db,
  staffOffboardingSessions.db and backgroundWorkers: 27 tests passed, three
  suites, 10.10s. No production or external payment service was used.
- Equipment regression package: 26 tests passed across seven suites, 3.87s.
- Team/expiry browser journey and all three existing workspace-navigation
  journeys passed: four tests, including owner/member separation, exact guide
  acknowledgment, due task completion, expiry stale-version preservation,
  schedule/clear controls, offboarding visibility, Arabic RTL/narrow viewport,
  keyboard use and scoped-data clearing. Browser APIs were synthetic; database
  and authenticated API checks were separate.
- Equipment browser journey passed (7.92s); build passed with 1246 assets.
- Final client npm run build:ci passed with 1247 emitted assets. Migration
  history/append order, frontend references, locale parity, instrumentation
  (1033 eligible files, 100% named interactions), assets and git diff --check
  passed. Automated checks are not human screen-reader or production acceptance.

## Deployment, rollback and remaining acceptance

No selected source feature remains unimplemented. This does not close the
entire persona roadmap or establish production readiness. Exact-head GitHub CI
is required after the final push. No merge, deployment or production activation
was performed. Validate representative owner/member/renter accounts in approved
non-production and measure refresh/worker behavior before production acceptance.

Apply all additive migrations before the new API/worker code. Every serving
API/POS/socket reader must understand expiry before configured deadlines are
used. After deadlines are configured, retain expiry enforcement and cleanup
when rolling back UI changes; blindly reverting to pre-expiry server code could
restore time-expired standing. Keep all document, acknowledgment, condition,
repair, discrepancy, extension and offboarding records. Do not drop data or
rewrite applied migrations during rollback.

The task-only Colima container oxsteed-pr805-quote-db remains available on port
32800 for continuation/acceptance, containing credit_statement_test and the
st_t3 and credit_statement_test_pr804_c verification clones. Remove this task container/volumes after acceptance
work is finished; preserve all unrelated databases, Docker resources, worktrees
and the untracked client/node_modules development symlink.

Additional final guard verification: the finance-specific location/HQ settlement
and read-only statement suites initially refused the generic test database name,
as designed. After creating the dedicated credit_statement_test_pr804_c clone,
all 19 finance/expiry tests passed (four suites, 19.63s). Expiry is checked on
business_members; restaurant_location_memberships retains its own assignment
status semantics. A valid HQ finance read remains available before expiry and
is denied after its parent membership deadline. No live balances were changed.

Final shared-control browser run after adding visible summary focus and 44px
summary/checkbox targets: all three team/expiry, equipment and role-template
journeys passed (19.36s). The three existing workspace-navigation journeys also
passed. Final build: 1247 assets. The existing service worker uses network-only
for /api/ requests and never intercepts ordinary writes; authenticated responses
are also no-store, so offline state is not used as access authority.
