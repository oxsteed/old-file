# Customer 360 operational workspace

Customer 360 now opens an actionable workspace, while retaining the previous
profile, investigation, trust, notes, network, and audit tabs. The expansion
reads 64 explicitly scoped sources, uses the existing business permission
resolver and helper/Didit rules, and links to existing product workflows.

## Scope and entry points

- Page: `/admin/customers/:userId/360`; `?tab=overview` retains the classic view.
- Workspace: `?tab=workspace&area=attention`; the area selector exposes all
  products, activity, engagement, data quality, cases, guides, and reports.
- Source, search, and dates are retained in the URL. A record opens in a
  keyboard-contained modal with Close and Open full page controls.
- API: `GET /api/admin/users/:userId/workspace`. `source`, `from`, `to`, `q`,
  `status`, `offset`, and `limit` are validated. Limits are 1–100; default is 5.
- Responses identify the subject **and viewer**. Account/viewer changes discard
  previous records, drafts, modal actions, report previews, and requests.

## Expansion coverage

| # | Area from the requested roadmap | Implementation |
|---|---|---|
| 1 | Actionable overview | Matching review-state counts across full filtered sources; inspect records and create follow-ups. Pending is not mislabeled overdue. |
| 2 | Complete activity access | Combined loaded timeline, per-source date/search/pagination, plus real kitchen, cancellation, subscription and recent sync-event histories. |
| 3 | Roles and permissions | Account role, memberships and last role changes; effective business permissions use the production permission resolver, including overrides and owner defaults. |
| 4 | Onboarding diagnostics | Production helper derivation and Didit gate called separately; listing, work prerequisites, enforcement/freshness, account restrictions and tax facts remain distinct. |
| 5 | Financial overview | Payments, invoices, payout readiness, restaurant payouts and partner settlements; status/currency/participant-role groups, no cross-account balance aggregation. |
| 6 | OxSteed Credit | Accounts, transactions, top-ups, holds, disputes, cards (last four only), entitlements, withdrawals and attributable pending approvals. Existing credit detail and native controls retained. |
| 7 | Restaurant Credit | Per-restaurant wallets, load requests, ledger, holds, refunds, disputes, reserves and exposure. Contextual authorized PDF download uses the existing statement handler. |
| 8 | Payment investigation | Recorded payment/escrow/refund/dispute state, safe provider/reference IDs, correlation search and original job/order links. Existing provider operations retain their own gates. |
| 9 | Statements/documents | Credit and settlement document metadata, periods, hashes, export jobs, account-specific credit detail/downloads, existing statement operations. |
| 10 | Jobs/helper work | Jobs, bids, booking requests, appointments, quotes and invoices; customer/helper and payer/payee participation are labeled separately. |
| 11 | Food/restaurant operations | Customer and linked-business orders, recorded amounts/payment/kitchen/handoff states, kitchen event history and full food-order page access. |
| 12 | Business relationships | Owned/actively joined businesses, memberships, restaurants, setup/listing/verification and business relationship navigation. Business money is still business-scoped. |
| 13 | Store device diagnostics | Device mode/location, heartbeat-derived connectivity, last data sync, pending operations, configuration version/acknowledgement and provisional unpaid tickets. |
| 14 | Logistics | Campaigns, commitments, purchase orders, buyer quotes/installments, payment attempts, shipments/customs exceptions, delivery handoffs and existing logistics operations. |
| 15 | Subscriptions | Recorded plans, periods, renewal cancellation flags, billing failures, subscription events, membership diagnostics and credit entitlement records. |
| 16 | Case management | Durable tasks with priority, due time, assignee, revision, outcome and related record; existing notes/pins, case owner, tickets/SLA and support workflows remain available. |
| 17 | Communications | Support conversation metadata, notification state, communication preferences, message/credit outboxes and appointment email/SMS delivery status. Existing messaging remains grant-gated. |
| 18 | Notification diagnostics | Status, attempts, next retry, sent/read flags, preferences and safe failure presence; existing credit-delivery retry control is available to super admins. |
| 19 | Sessions/security | Existing login history plus safe current-session records. Super-admin session revocation uses the existing access-token denylist; legacy sessions trigger the existing all-token fallback. |
| 20 | Relationship investigation | Navigable relationship map for linked people/businesses, existing duplicate links, related search and purpose-controlled investigation. Connections are evidence, not proof of misconduct. |
| 21 | Duplicate resolution | Comparison/network navigation, dedicated investigation checklist and durable review/outcome tasks. No automatic account or balance merge. |
| 22 | Trust/appeals | Existing enforcement histories, current restrictions, visibility appeals, credit identity/appeal deadlines, received ratings and administrative actions. |
| 23 | Experience/engagement | Full-filter first/latest activity, active days, last-30-day counts and received-rating metrics, separated by product; no predictive risk score. |
| 24 | Proactive alerts | Opt-in per-admin/per-customer source/status/age rules. Evaluator rechecks active admin role, MFA and current source permission. Notifications have stable idempotency keys and localized copy. |
| 25 | Guided resolution | Eight localized four-step checklists: verification, refunds, restaurant credit, payouts, food/screens, statements, duplicate accounts and session recovery. Each can create a follow-up; existing visual guides remain linked. |
| 26 | AI assistance | Optional configured Meta provider produces a review-only handoff draft from permitted aggregate counts/statuses. No identities, notes, messages, references, balances or credentials are sent. Evidence remains available without a provider. No model tools or action execution. |
| 27 | Privacy/sensitive reads | Consent and erasure states restricted to super admins, safe projections, purpose-required audited exports, retained investigation grants and private/no-store responses. |
| 28 | Search/navigation | Date/reference/status/text filtering within the selected person/business context, URL state, record preview, related participants and native full-page destinations. |
| 29 | Reports/exports | Selected authorized sources, purpose, subject, dates, fetch timestamp, counts and partial labels; JSON/CSV downloads and dedicated printable/save-as-PDF case report. CSV formulas neutralized. |
| 30 | Reliability/data quality | Restricted, unavailable, empty and partial are distinct; counts and pages share a statement snapshot, source times remain visible, stale warnings and bounded query fanout. |

## Financial and authorization boundaries

No new money-moving backend, approval exception, eligibility bypass, payment
hardware, or account consolidation is introduced. Existing refund/cancellation
services remain authoritative, including their permissions, step-up requirements,
idempotency, confirmations, and any pending approvals. Unsupported actions open
existing full workflows rather than claiming completion.

The new inline actions reuse existing food-order refunds, marketplace refunds,
booking/job cancellations and credit-notification retry endpoints. Tasks and
alert rules do not settle, refund, approve credit, or complete onboarding.

Money and related IDs are serialized as strings before PostgreSQL JSON reaches
JavaScript. Aggregates are grouped by status, currency and participant role;
major-unit sources remain distinct from minor-unit sources. Formatting uses
currency precision and BigInt for exact large amounts. No recent-page sum is
presented as a lifetime value.

Read sources require the global grants of their corresponding administrative
surface. Credit, private documents, privacy and sessions remain super-only.
Delegated staff cannot inspect admin or internal-system targets through this
API. Every workspace read is audited; audit failure prevents a successful read.
Tasks and alert-rule changes audit inside their transaction. Task retries are
idempotent; conflicting revisions fail with 409. External revocation failure
prevents acknowledging a successful session revoke.

## Migration and rollout

Migration **888_customer360_workspace.sql** was allocated after fetching the
default branch and checking open PRs (none at allocation). It adds only
`admin_customer_tasks` and `admin_customer_alert_rules` plus their indexes.
Applied migrations, including the restored 886 bytes, are unchanged.

No new credentials are required. AI drafts use the already-configured Meta
provider if available. `CUSTOMER360_ALERTS_ENABLED=false` disables the new alert
worker without deleting rules or tasks. Otherwise it evaluates at most 50 rules
per minute and 25 newly matching records per rule; notifications are opt-in and
use existing delivery preferences/idempotency. Active role, MFA and source grants
are checked again by the evaluator.

For rollback, retain additive migrations and durable task/rule data; switch the
client entry back to the classic view and disable the new alert worker if needed.
Do not delete migration markers or run an image missing already-applied migration
files. No production feature flag, secret, customer record or financial record
was changed during implementation/testing.

## Evidence and limits

- Disposable PostgreSQL: **865/865** fresh migrations passed, complete replay
  checksums and guard-trigger checks passed. Final API queries and synthetic
  verification cover all **64 sources**.
- Synthetic verification: 240 target jobs and another person's job, complete
  counts versus loaded pages, multiple currencies, pagination beyond 100,
  malicious search input, dates, task retry conflicts, concurrent updates,
  audited mutations, alert configuration, bounded exports and exact amounts
  beyond JavaScript's safe-integer range.
- Focused server tests cover existing wave-2 behavior, new permission/data/error
  boundaries, audit failures, authoritative eligibility, session denylisting,
  notification keys, provider data minimization and bootstrap shutdown.
- Client model/localization tests cover currency precision, huge amounts,
  heartbeat thresholds, source filtering, destinations and five-language
  legacy/namespaced parity.
- Browser checks use synthetic data only: 30 layout combinations (320, 390,
  768, 1360, 1600px; light/dark; English/French/Arabic RTL), focus containment,
  Escape/focus return, pagination, tasks, alerts, refund confirmation, evidence,
  report preview, errors, and subject/viewer changes. Example captures are in
  `evidence/`; no customer data appears in them.
- PR #605 CI exposed a locale-switch timing race in that browser fixture:
  a translated page could render before the test clicked the English Refresh
  label. The fixture now awaits initial mount and explicitly rerenders on locale
  changes. The focused browser journey passed all 30 layout combinations after
  this correction; application behavior and build output are unchanged.
- Full client `npm run build:ci` passed during implementation. Final release
  rerun and remote CI status are recorded in the PR; neither implies deployment.
- The broad local server run encountered environment failures in unrelated
  suites requiring `/usr/bin/ffmpeg` and PostgreSQL on port 5432. It was stopped;
  do not report that run as passing. Focused database tests use the explicit
  disposable connection instead of production.
- Existing English guide strings were compared to the base and are identical
  after excluding only the added `customerWorkspace` namespace. SOP baseline
  hashes were refreshed for this additive catalog change; no existing guide
  instructions/screenshots/PDF content changed.

Historical state transitions cannot be invented: the timeline combines recorded
source pages and available event histories. Screen events follow the existing
seven-day journal retention and per-restaurant feature flag. Use date filters
and source pagination for deeper history; a case export is explicitly capped
at 100 filtered records per selected source and is not an accounting statement.
Direct provider delivery, real payments/refunds, live AI responses, human screen
reader testing and production deployment were not exercised by these synthetic
checks. Nonfinancial case workflow completion is never financial confirmation.
