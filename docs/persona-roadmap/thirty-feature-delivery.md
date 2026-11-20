# Thirty-feature execution tracker

Requested implementation set: the 30 features selected from the user-supplied
persona roadmap. Baseline: PR 805 at `1305b1817a36ca20ac9616f133847ae30cc3bb8f`.
The feature list is descriptive; all protected operations retain server authority.

| Roadmap ID | Feature | Delivery |
|---|---|---|
| 163 | Distance preferences | Not started |
| 165 | Work suitability preview | Not started |
| 166 | Itemized bid builder | Implemented; local database/browser verification passed |
| 167 | Materials templates | Implemented; create/edit/reuse/delete with scope and version checks |
| 168 | Quote validity control | Implemented; server expiry denial and renewal as a new version |
| 169 | Counterproposal editor | Implemented; customer proposal, provider decision, explicit customer acceptance |
| 170 | Quote revision history | Implemented; immutable prior terms and previous/current comparison |
| 174 | Daily job limits | Implemented; settings, slot filtering, concurrent write/reschedule enforcement |
| 175 | Travel time blocks | Implemented; fixed user-selected gap around helper appointments |
| 191 | Portfolio permission request | Not started |
| 208 | Standard quote terms | Not started |
| 209 | Business pricing templates | Not started |
| 212 | Role templates | Not started |
| 213 | Permission preview | Not started |
| 214 | Membership expiry | Not started |
| 215 | Offboarding dashboard | Not started |
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
