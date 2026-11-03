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
| 26 | AI assistance | Optional self-hosted Ollama (pinned model digest, localhost only) produces review-only case summaries, next-step suggestions and reply drafts from permitted aggregate counts/statuses (upgrade 3). No identities, notes, messages, references, balances or credentials are sent. Evidence remains available without a provider. No model tools or action execution. |
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

No new credentials are required. AI drafts use self-hosted Ollama only
(`CUSTOMER360_OLLAMA_URL`, `CUSTOMER360_OLLAMA_MODEL`,
`CUSTOMER360_OLLAMA_DIGEST`); without them no draft is produced. `CUSTOMER360_ALERTS_ENABLED=false` disables the new alert
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

## Upgrades (2026-11)

Each upgrade below is a separate commit on `feat/credit-license-readiness-2`.
All endpoints sit under `/api/admin/users/:userId/workspace/*` unless stated,
require `requireAdmin` + `manage_users` (plus the source grant noted), and
write an `admin_audit_log` row with `throwOnError` before data is returned.
Background work runs in `server/jobs/customer360Upgrades.js`
(`CUSTOMER360_UPGRADES_ENABLED=false` pauses it; data is kept).

### 1. Unified append-only customer event log

- Migration `20261103120000_customer360_event_log.sql`: `customer_events`
  (per-customer SHA-256 hash chain, unique `dedupe_key`, UPDATE/DELETE/TRUNCATE
  rejected by triggers, `REVOKE TRUNCATE`), `customer_event_inbox` (outbox) and
  `customer_event_ingest_cursors` (backfill progress).
- Writers: `AFTER` triggers on `admin_audit_log` (user targets),
  `user_login_history`, `payments` (status), `support_tickets` (status) and
  `food_orders` (status / payment status) insert into the outbox; a failure
  there raises a warning and never blocks the source write. Customer 360 code
  writes directly with `customer360Events.append()` (idempotent on the key).
- Personal data: `customer_event_redact_diff()` stores only `{changed,
  redacted}` for personal-looking keys (email, phone, name, address, IP, card,
  notes, free text…) and only `{changed}` for nested or long values. Login
  events keep the country code, never the IP or user agent.
- Backfill: a one-time primary-key walk per source. Audit and login rows
  reuse the trigger keys; payments, tickets and orders record their current
  state only when the entity has no captured history, so nothing is doubled.
- Reads: `GET …/events` (cursor pagination by id, source/actor/type/date
  filters) and `GET …/events/replay?entityType&entityId&at` (folds recorded
  `to` values in order and lists fields that changed but were not stored).
  Event sources follow the viewer's grants: admin actions and sign-ins are
  super-admin only, payments need `view_financials`, support needs
  `manage_support`, food orders need `manage_orders`.
  `GET …/events/verify` (super admin) recomputes the chain.
- UI: "Change history" area (`upgrades/EventLog.jsx`).
- Tests: `server/__tests__/customer360EventLog.db.test.js` (required in CI by
  `scripts/assert-statement-db-tests.cjs`), `client/scripts/customer360Upgrades.test.mjs`,
  `client/scripts/customer360Upgrades.browser-check.cjs`.

### 2. Transparent account health and risk scores (advisory)

- Migration `20261103120100_customer360_health_scores.sql`:
  `customer_health_scores` (one row per customer: churn, payment and support
  scores 0–100, bands, `factors` JSON, `model_version`) and
  `customer360_event_consumers` (per-consumer high-water marks on
  `customer_events`).
- Model `c360-health-v1` (`server/services/customer360Health.js`): each score
  is a weighted sum (weights sum to 100) of bounded factors —
  churn: days since sign-in, activity drop (30 days vs. prior 60), new
  account; payment: failed payments/payouts, refunds, open Credit disputes
  (90 days); support: open tickets, tickets in 90 days, missed SLA
  deadlines. Every factor is stored with value, weight, contribution and an
  explanation key. Bands: <34 low, <67 medium, otherwise high.
- Advisory only: no code path reads a score to block, limit or move money.
  A band change is written to the event log as `health.band_changed`
  (bands only, no detail).
- `GET …/health` (recomputes when older than 6 hours or on a new model) and
  `POST …/health/recompute`; both audited. The payment score needs
  `view_financials`; the support score needs `manage_support`; otherwise it
  is returned as `restricted`.
- Refresh: the event consumer rescans customers with new events every
  minute; scores older than 24 hours are refreshed every 10 minutes.
- UI: "Health and risk" area (`upgrades/Health.jsx`) with the factor table.
- Tests: `server/__tests__/customer360Health.db.test.js` plus the shared
  client unit and browser checks.

### 3. AI on self-hosted Ollama only

- `server/services/customer360Ai.js` replaces the OpenRouter call in
  `POST …/assistant`. There is no hosted fallback: the URL must pass the
  shared localhost-only guard (`resolveOllamaUrl`), the model tag must be
  loaded with the pinned `CUSTOMER360_OLLAMA_DIGEST` (checked via
  `/api/tags` on every call), and the request has no tools, temperature 0
  and a JSON-schema `format`. Output is validated with Ajv; anything else
  is discarded and the endpoint returns `draft: null` with the evidence.
- Modes: `summary` (citations limited to the ready source keys sent),
  `next_step` (≤5 manual steps, each citing a source and an existing guide
  id; the prompt forbids approvals or money movement) and `reply_draft`
  (subject/body for a customer reply in en/es/fr/ht/ar, given only a topic
  code — no customer data at all).
- Data minimisation: `minimiseEvidence()` keeps source key, state, total
  and status counts only (no labels, contacts, notes, amounts or ids).
- Audit: `customer360_assistant_draft` records mode, language, whether a
  draft was produced, model, digest, prompt hash and prompt version.
- UI: the Evidence assistant area has a mode selector; reply drafts are
  editable text that can be copied into the inbox composer (upgrade 8) and
  are never sent automatically.
- Tests: `server/__tests__/customer360Ai.test.js`,
  `server/__tests__/customer360Workspace.test.js` (no OpenRouter/Meta call).

### 4. Anomaly alerts with bundling and snooze

- Migration `20261103120200_customer360_anomalies.sql`: `customer_anomalies`
  (kind, status open/snoozed/acknowledged/resolved, occurrences, first/last
  detection, bounded evidence, last 50 detection keys, revision) with a
  partial unique index that keeps one live (open or snoozed) bundle per
  customer and kind. `admin_customer_alert_rules.customer_id` may now be
  NULL, but only for the two anomaly sources (platform-wide watches).
- Detectors (`services/customer360Anomalies.js`, every minute in the C360
  worker; thresholds via `CUSTOMER360_ANOMALY_*`): refund spike (≥3 refunds
  in 7 days and ≥3× the prior 90-day weekly average, from
  `payment_refund_attempts` and `food_credit_refunds`), payout failures (≥2
  failed instant payouts in 7 days), and sign-in from a country not seen in
  the previous 180 days (from the event log; IPs are never stored).
  Time cursors start 7 days back so the first run does not scan history.
- Bundling: repeats increment `occurrences` once per detection key; a new
  bundle starts only after the previous one is acknowledged or resolved.
  Snoozes last at most 30 days and reopen the bundle when they end.
- Delivery uses the existing alert rules and worker: new workspace sources
  `anomaliesFinancial` (`view_financials`) and `anomaliesSecurity` (super
  admin) can be watched per customer, or platform-wide via
  `GET/PUT /api/admin/customer360/anomaly-watches`. Notifications are keyed
  by bundle and status, so repeats never notify twice.
- Endpoints: `GET …/anomalies`, `POST …/anomalies/:id/(snooze|unsnooze|
  acknowledge|resolve)` (reason required, optimistic revision, audited in
  the same transaction) and `GET /api/admin/customer360/anomalies`
  (platform queue, audited). Alerts never block or change an account.
- UI: "Anomalies" area (`upgrades/Anomalies.jsx`).
- Tests: `server/__tests__/customer360Anomalies.db.test.js` and the shared
  client checks.
