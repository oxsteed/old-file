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

### 5. Weighted duplicate/fraud link graph and guided merge review

- Migration `20261103120300_customer360_link_graph.sql`:
  `customer_identity_signals` (keyed HMAC-SHA256 digests only — raw device
  ids, card fingerprints, bank details and addresses are never stored) and
  `customer_link_reviews` (one active review per pair; a database CHECK
  requires two different admins for `confirmed_duplicate`).
- Signals: devices and normalised addresses from `users`, bank accounts from
  `credit_payout_destinations.account_fingerprint` (both swept continuously with a wrap-around
  cursor by the `signals` worker task), and card fingerprints captured by the
  payment worker when the Stripe payload includes charge details. Digests
  are computed in SQL with `CUSTOMER360_SIGNAL_HMAC_KEY` (or a key derived
  from `ENCRYPTION_KEY`); without a key nothing is recorded.
- Edge score = 1 − Π(1 − weight) over distinct shared kinds (card 0.9, bank
  0.9, device 0.6, address 0.3). Values shared by more than 25 customers
  (apartment blocks, shared kiosks) are ignored and listed as "common".
  Staff accounts are excluded.
- Visibility follows grants: address always; card and bank need
  `view_financials`; device needs super admin. Emails are masked.
- Review flow (`POST …/links/:otherUserId/review`, `POST …/link-reviews/:id/
  (checklist|duplicate|confirm|reject|distinct|dismiss)`): four required
  checklist items, a reason on every decision, optimistic revisions, and a
  second distinct admin to confirm a duplicate. Every step is audited.
- Nothing is ever merged: a confirmed duplicate appends a
  `link_review.confirmed_duplicate` event to both customers and leaves
  accounts, balances and Credit untouched; any change follows the existing
  procedures.
- UI: "Linked accounts" area (`upgrades/Links.jsx`).
- Tests: `server/__tests__/customer360Links.db.test.js` and the shared
  client checks.

### 6. Business-scoped Customer 360 for business and restaurant owners

- Business Hub → Clients → "All customers (360)"
  (`client/src/components/businessHub/BusinessCustomer360.jsx`), backed by
  `GET /api/businesses/:businessId/customer360/customers` and
  `GET …/customers/:customerKey` (`u-<user id>` or `c-<CRM client id>`).
- Only the business's own relationship data: its CRM record (including its
  own notes and contact details), its appointments, its invoices (matched
  only on contact details the business itself recorded) and its restaurant
  orders. Platform account email/phone, Credit, KYC, support and anything
  from other businesses are never returned.
- Authorization uses the production resolvers only: `requireBusinessAccess`
  → `permissionsService.getEffectivePermissions` (catalog + per-membership
  overrides) for `customers.view_all` / `customers.view_assigned`,
  `calendar.view_all` / `calendar.view_self` and `invoices.view`; for each
  restaurant `scopeModel.resolveRestaurantAccess` →
  `getRestaurantPermissions` (`orders.view`) narrowed by
  `getLocationScope` (store boundary). Assigned-only staff see customers
  they created or serve by appointment. Without a customers permission the
  API returns 403; unknown or out-of-scope customers return 404.
- Every list and profile read is written to `business_audit_log`
  (`customer360.customers_listed`, `customer360.customer_viewed`) and fails
  closed if the audit cannot be written. Responses are `no-store`.
- Migration `20261103120400_business_customer360.sql` adds the
  per-business indexes that keep the list and profile bounded.
- Copy in all 20 locales (`businessCustomer360`).
- Tests: `server/__tests__/businessCustomer360.db.test.js` (owner, store-
  scoped manager, assigned-only employee, deny override, outsider and
  cross-business isolation) and `client/scripts/businessCustomer360.browser-check.cjs`.

### 7. Lifecycle stage and country cohort comparison

- Migration `20261103120500_customer360_lifecycle_cohorts.sql`:
  `customer_lifecycle` (one row per customer: stage, country, signup-month
  cohort, first/last transaction, 90-day count, `stage_since`, model
  version) and `customer_cohort_stats` (precomputed counts per country ×
  signup month × stage), plus the payer/customer indexes the batch needs.
- Model `c360-lifecycle-v1`, derived only from signup date and completed
  transactions (payments, paid/refunded food orders): `new` (≤30 days, no
  transaction), `never_activated`, `active` (≤30 days), `lapsing` (31–90),
  `dormant` (>90), `closed` (deleted). Staff accounts are excluded.
  Descriptive only; nothing changes an account.
- Computed set-based in batches (`computeBatch`), refreshed from customer
  events (`lifecycle` consumer), by a continuous wrap-around sweep
  (`CUSTOMER360_LIFECYCLE_BATCH`, default 2000 users every 15 s) and on
  read when older than 24 h. Stage changes append
  `lifecycle.stage_changed`; first computations do not, so the backfill
  does not flood the log. Cohort stats rebuild every 6 h in one transaction.
- Small-cell suppression: cohorts or stages under 10 customers are returned
  as suppressed, never as counts.
- Endpoints: `GET …/workspace/lifecycle` (stage, inputs, the customer's
  country cohort vs the platform cohort for the same signup month) and
  `GET /api/admin/customer360/cohorts?countries=HT,US&months=12` (1–6
  countries, ≤24 months). Both audited. Region-scoped admins see the stage
  but not cross-country aggregates (403 `region_scoped_admin`).
- UI: "Lifecycle" area (`upgrades/Lifecycle.jsx`).
- Tests: `server/__tests__/customer360Lifecycle.db.test.js` and the shared
  client checks.

### 8. Unified inbox with templates and explicit sends

- Migration `20261103120600_customer360_inbox.sql`:
  `customer_outbound_messages` (email/SMS sent from Customer 360: admin,
  channel, template, language, masked recipient, status
  `queued|sent|not_sent`, `UNIQUE (admin_id, client_message_id)` for
  idempotency; SMS bodies are not stored, only a hash and a short preview)
  and `notification_preferences.sms_support_replies` (default on, so the
  customer can opt out of support SMS).
- Timeline (`GET …/workspace/inbox`): support tickets (with internal notes
  only for admins holding the internal-notes grant), admin ⇄ customer
  in-app messages, and Customer 360 email/SMS, newest first with a cursor.
  Sections the admin cannot read are left out; the read is audited.
- Sending, always behind the "Review → Send now" step, never automatic:
  - support reply → the existing `POST /api/admin/support/tickets/:id/reply`;
  - in-app message → the existing `POST /api/admin/messages/conversations/:userId/send`
    (Idempotency-Key header);
  - email → `POST …/workspace/inbox/send` → the Resend support email outbox
    (`supportEmailOutbox`, idempotency key `customer360:<id>`);
  - SMS → the same endpoint → the existing opt-in SMS sender
    (`sendSMSIfOptedIn(…, 'support_replies')`), verified phone only, ≤480
    characters, behind `CUSTOMER360_INBOX_SMS_ENABLED` (default `false`,
    because SMS delivery uses a paid provider).
  The send endpoint requires `confirm: true`, a UUID `clientMessageId`,
  `manage_users` plus a platform-wide `message_users` grant, rejects
  impersonated sessions and staff/deleted recipients, and writes the record,
  the `customer360_inbox_<channel>_send` audit row and an
  `inbox.<channel>_sent` event in one transaction before delivery.
- Templates (`customer360InboxTemplates.js`): `general`, `verification`,
  `payment`, `resolved` in en/es/fr/ht/ar, defaulting to the customer's
  preferred language; the admin edits the text before review. Arabic drafts
  render right-to-left.
- UI: "Inbox" area (`upgrades/Inbox.jsx`).
- Tests: `server/__tests__/customer360Inbox.db.test.js` and the shared
  client checks.

### 9. Playbooks for safe steps

- Migration `20261103120700_customer360_playbooks.sql`:
  `customer_playbook_runs` (one open run per customer × playbook via a
  partial unique index; idempotent on `(started_by, client_request_id)`)
  and `customer_playbook_run_steps` (status per step; a CHECK constraint
  stops a `money_handoff` step from ever being marked `done`).
- Definitions are versioned code (`services/customer360Playbooks.js`):
  - `verification_help`: check the email is unverified → send a new
    verification code (`authController.issueEmailVerificationCode`: same
    HMAC hashing, 15-minute expiry and 60-second H10 cooldown as the
    customer resend, claimed atomically; plus a 10-minute per-customer
    playbook cooldown) → confirm with the customer (manual);
  - `notification_retry` (needs `manage_operations`): count failed rows →
    requeue this customer's dead-lettered in-app message notifications and
    support emails (only `failed` rows; the stored Resend idempotency key
    prevents duplicates) → confirm delivery (manual);
  - `payment_issue`: review 30 days of payments → contact the customer
    (opens the inbox) → **refund or credit: hand-off only**. The step links
    to the existing approvals page and can only be marked `handed_off` with
    a note. Refunds, credits and adjustments keep their existing approval
    and two-distinct-admin rules; no playbook calls a money-moving service.
- Automatic steps run only after `confirm: true`; a failed check stops the
  remaining safe actions. Each start, safe action, manual completion and
  cancellation writes an audit row (`customer360_playbook_*`) and safe
  actions append `playbook.<step>` events.
- Endpoints: `GET …/workspace/playbooks`,
  `POST …/workspace/playbooks/:playbookKey/run`,
  `POST …/workspace/playbook-runs/:runId/steps/:stepKey/complete`,
  `POST …/workspace/playbook-runs/:runId/cancel`.
- UI: "Playbooks" area (`upgrades/Playbooks.jsx`).
- Tests: `server/__tests__/customer360Playbooks.db.test.js` and the shared
  client checks.

### 10. Saved views and shared team queues with SLA tracking

- Migration `20261103120800_customer360_queues.sql`:
  `customer360_queues` (key, name, SLA minutes 5–43 200, optional feed,
  active, revision; seeded with `anomalies` 4 h, `link_reviews` 24 h and
  `general` 24 h), `customer360_queue_items` (one live item per queue and
  source, or per queue and customer for manual items; `due_at` fixed at
  creation from the queue SLA; first-claim, breach, resolution and
  revision columns) and `customer360_saved_views` (owner, unique name per
  owner, `private` or `team`, allowlisted filters ≤2 KB).
- Feeds (worker `queue-feeds`, 60 s): open/acknowledged anomalies and link
  reviews awaiting a second admin enter their queue with `due_at` measured
  from detection/proposal; items close as `source_closed` when the source
  closes. Worker `queue-sla` (60 s) stamps `sla_breached_at` once and
  appends `queue.sla_breached` events.
- Visibility: each item has a topic (anomaly kind, `link_review`,
  `general`); admins only see topics their grants allow (the same anomaly
  and link grants as upgrades 4 and 5). The platform-wide board needs a
  global `manage_users` grant; queue configuration is super-admin only.
- Actions: claim, release (assignee only), resolve (`handled` or
  `no_action`, optional note), all with optimistic revision checks and
  audit rows (`customer360_queue_item_*`); resolving appends
  `queue.item_resolved` with `withinSla`.
- Queue stats: open, claimed, overdue, resolved in 30 days, SLA met % and
  median time to resolve (30 days).
- Saved views store board filters (queues, statuses, assignee me/unassigned,
  overdue only, sort). Team views are visible to every admin; only the
  owner can edit or delete. Sharing a view needs the global board grant.
- Endpoints: `GET /api/admin/customer360/queues` (board, `?view=` or
  filters, cursor paging), `POST|PATCH /customer360/queues[/:queueId]`,
  `POST /customer360/queue-items/:itemId/(claim|release|resolve)`,
  `GET|POST /customer360/saved-views`, `PUT|DELETE /customer360/saved-views/:viewId`,
  `GET|POST …/workspace/queues|queue-items`.
- UI: "Queues" area (`upgrades/Queues.jsx`): this customer's items, add to
  a manual queue, and the team board with stats, filters and saved views.
- Tests: `server/__tests__/customer360Queues.db.test.js` and the shared
  client checks.

### 11. Customer-facing "Your data" page and self-serve export

- Migration `20261103120900_customer360_privacy.sql`: `erased_at` on
  `customer_outbound_messages` and a body rule that allows an erased row
  (send record and body hash kept; subject, body and recipient removed).
- `services/customer360Privacy.js`:
  - `categories(userId)` mirrors the admin workspace areas exactly: it is
    built from the same `customer360Sources` definitions (count and latest
    date per area, so a new admin source appears for customers
    automatically), plus the Customer 360 derived data (activity log, health
    scores, lifecycle stage, messages from staff, playbook steps,
    follow-ups, precomputed summary). Staff-internal sources (admin actions,
    staff tasks, anomaly reviews, duplicate-account signals) are shown as
    described categories without counts or contents, so fraud-prevention
    work is not revealed; they are retained under that basis.
  - Each category states whether it is in the export and what erasure does
    (`removed`, `anonymized` or `retained`), matching what
    `privacyRetentionService.eraseUser` actually does.
  - `exportData(conn, userId)` adds `customer360_*` sections to the existing
    verified export (`GET /api/privacy/export`: password, then emailed
    code, one-time token): every non-internal source's records (id, label,
    status, date), account events (types and times; staff, anomaly, link and
    queue events excluded), scores with factors, lifecycle stage, messages
    staff sent, playbook step statuses (no staff notes) and general
    follow-ups (no staff reasons). Sections are capped at 100 000 rows and
    fail rather than truncate.
  - `erase(conn, userId)` runs inside both erasure paths (self-serve
    `DELETE /api/privacy/delete-account` and `eraseUser`): deletes identity
    signals, health scores, lifecycle rows and summaries; strips outbound
    message content, playbook notes/results, queue reasons/notes and anomaly
    evidence. The hash-chained event log is kept (it holds no free text) and
    link reviews are retained for fraud prevention.
- Endpoint: `GET /api/privacy/your-data` (authenticated, own data only,
  rate-limited, `no-store`).
- UI: `/settings/your-data` (`client/src/pages/Settings/YourData.jsx`),
  linked from Settings → Privacy; grouped categories, counts, last update,
  export and erasure rules, and the same verified export flow. Copy in all
  20 locales (`yourData` namespace), logical CSS, RTL for Arabic and Urdu.
- Tests: `server/__tests__/customer360Privacy.db.test.js`,
  `client/scripts/yourData.browser-check.cjs` (20 languages × light/dark ×
  320/1360 px, export flow and error states), and the existing privacy
  export tests.

### 12. Precomputed per-customer summaries with staleness

- Migration `20261103121000_customer360_summaries.sql`:
  `customer360_summaries`, one row per customer (`ON DELETE CASCADE`), with
  the summary JSONB (capped at 16 KB), `event_watermark` (highest event id
  covered), `computed_at`, `compute_ms`, `failed_sources`, `dirty_since`
  and a worker lease (`claimed_until`). `fillfactor = 80` keeps recomputes
  HOT; partial index on `dirty_since` and an index on `computed_at` keep the
  queue and the sweep off full scans.
- `services/customer360Summaries.js`:
  - `computeOne` counts every workspace source (count, latest date, last
    30 days) in one `UNION ALL` statement inside a transaction with a 15 s
    statement timeout; if one source fails it falls back per source and
    records it in `failed_sources`. It adds events, health bands,
    lifecycle stage, open anomalies by kind and open queue items by topic.
    A dirty mark set after the compute started survives the write.
  - `markFromEvents` (consumer `summaries` in `customer360_event_consumers`)
    reads up to 10 000 events per batch, skips audited admin reads
    (`admin.customer360_*`), and in one upsert flags affected customers
    dirty, but only if the event is newer than the row's watermark. Bursts
    collapse into one recompute per customer.
  - `computeDirty` and `sweepStale` claim rows with `FOR UPDATE SKIP LOCKED`
    plus a 120 s lease, so several workers share the work. The sweep
    refreshes rows older than `CUSTOMER360_SUMMARY_TTL_HOURS` (default 24)
    or on an older model version. That catches changes that emit no event.
  - Reads (`load`) never wait on a recompute, except on the first read for
    a customer. They report a state: `fresh`, `dirty` (newer activity),
    `stale` (past TTL), `outdated_model` or `missing`, plus age and computed
    time. A stale read queues a refresh.
  - `present` filters the stored summary for the admin. It shows only
    sources the admin holds the grant for (super-only sources for super
    admins), and only the anomaly kinds and queue topics they may see.
    Hidden sources are left out, not shown as zero.
  - `backlog()` reports the dirty count, the oldest dirty age and the
    consumer cursor for monitoring.
- Worker tasks:
  - `summary-events` every 15 s, up to 5 × 10 000 events per tick.
  - `summary-dirty` every 15 s, 200 rows per tick.
  - `summary-stale` every 60 s, 200 rows per tick.
- Scale (about 6M customers):
  - The table is about 6–12 GB at 1–2 KB per row, and a read is one
    primary-key lookup plus one index probe on
    `customer_events (customer_id, id)`.
  - Dirty work grows with the number of active customers, not the total.
  - The TTL sweep runs 200 per minute per worker. To keep a 24 h TTL for
    every customer, run about 20 worker instances or raise the batch size.
  - Until then, read-time staleness marks plus the event path keep active
    customers fresh, and the badge shows how old the numbers are.
- Endpoints:
  - `GET workspace/summary`, audited as `customer360_summary_read` with
    state and area count.
  - `POST workspace/summary/recompute` forces a recompute. It is
    rate-limited, not available while impersonating, and audited as
    `customer360_summary_recompute`.
- UI: the "Summary" area (`upgrades/Summary.jsx`) shows the freshness
  badge (`data-staleness`, colour plus text) and the compute time. It warns
  when the summary is incomplete, shows lifecycle, churn band, events,
  anomaly and queue cards, and has a per-area table that links to each
  area. Copy is in en/es/fr/ht/ar and uses logical CSS.
- Erasure: summaries are deleted by upgrade 11's `erase` and appear as the
  "precomputed summary" category on the "Your data" page.
- Tests:
  - `server/__tests__/customer360Summaries.db.test.js`: staleness states;
    sync first read; event → dirty → worker recompute; no re-mark for
    events already covered; pending rows; TTL and model sweep; leases;
    grant projection; cascade.
  - The upgrade-12 flow in `client/scripts/customer360Upgrades.browser-check.cjs`.
