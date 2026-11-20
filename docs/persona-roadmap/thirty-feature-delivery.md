# Thirty-feature execution tracker

Requested implementation set: the 30 features selected from the user-supplied
persona roadmap. Baseline: PR 805 at `1305b1817a36ca20ac9616f133847ae30cc3bb8f`.
The feature list is descriptive; all protected operations retain server authority.

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
| 214 | Membership expiry | Not started |
| 215 | Offboarding dashboard | Existing server workflow verified; frontend completion review pending |
| 219 | Overdue task alerts | Not started |
| 224 | Follow-up reminders | Not started |
| 229 | Team onboarding guide | Not started |
| 230 | Policy acknowledgment history | Not started |
| 557 | Accessory inventory | Not started |
| 558 | Usage restrictions | Not started |
| 572 | Condition checklist | Not started |
| 573 | Accessory count | Not started |
| 577 | Return condition report | Not started |
| 578 | Missing accessory record | Not started |
| 581 | Extension request | Not started |
| 582 | Schedule conflict alert | Not started |
| 585 | Late-return follow-up | Not started |
| 593 | Repair record | Not started |

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

## Checkpoint and next actions

14 of the selected 30 features have new implementations with local verification.
The remaining 16 are still in scope; they are not represented as complete.
Continue on PR 805's fix/persona-roadmap-1000 branch from the latest pushed head.
Use the isolated worktree /private/tmp/oxsteed-pr805-ci-repair. Preserve unrelated
work in the main checkout and do not add the client/node_modules symlink.

1. Membership expiry (214): existing business_members.expires_at is invitation
   expiry, not effective employment expiry. Trace all authorization consumers
   before adding time-bound active access. About 105 non-test server files refer
   to business_members; changing only navbar or one middleware is insufficient.
2. Offboarding (215): reuse staffOffboarding and current Team history/rehire UI.
   Current database coverage confirms task reassignment, retention/history,
   rehire and anonymized records. Reconcile the remaining user-facing dashboard
   behavior rather than introducing a second removal system.
3. Overdue tasks/follow-up (219/224): reconcile existing crew tasks, attention
   adapters and reminder infrastructure before adding scoped alerts/reminders.
4. Team onboarding/policy history (229/230): reuse existing staff/careers training
   and onboarding where applicable. Client-facing business policies are a
   different audience from internal team acknowledgments.
5. Equipment (557/558/572/573/577/578/581/582/585/593): extend existing tool_rentals,
   tool_rentals_bookings, ToolOwnerDashboard and MyBookingsPage. Owner rules and
   agreement snapshots already exist. Preserve the peer-rental agreement,
   invoice/deposit lifecycle, effective tool-owner access, customer ownership and
   tool-rental advisory lock used by booking creation. Extensions must preserve
   explicit date/price consent and existing payment records; condition reports
   must not automatically levy damage or missing-accessory charges.

Run focused checks per increment and push reviewable commits while GitHub CI is
running. Do not treat a passing older commit as CI evidence for the new head.

The disposable PostGIS container for continuation is oxsteed-pr805-quote-db
(Colima context), port 32800, database credit_statement_test. It contains only
synthetic fixtures and the applied additive migrations. Use the local test URL
postgresql://postgres@127.0.0.1:32800/credit_statement_test?sslmode=disable for
ACCESS_TEST_DATABASE_URL and STATEMENT_TEST_DATABASE_URL. Never substitute a
production database. Remove this task container/volumes when its verification
work is finished; do not remove other Docker resources.
