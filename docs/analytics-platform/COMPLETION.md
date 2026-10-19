# Analytics scope: completion status

Status as of October 19, 2026 on branch `codex/analytics-remaining-implementation`
(based on `old-files-claude` @ `4a89196a`, which includes PRs #605/#606/#607).
Authoritative scope: [SCOPE.md](./SCOPE.md) (same text as the original "Power BI
Capabilities: Codebase Scope Report"). The October 18 review that produced the
checklist below is preserved at the end of this file for its evidence.

Legend: **[x] done** in code with automated evidence; **[ops]** implemented but
needs live/ops verification; **[defer]** deliberately not built, with reason.
"Before" means merged in #605-#607 or the first branch commit `b40a6228`;
"now" means the follow-up commits `72d604ad`, `005fd354`, `24692700`, `aa1c5361`.

## Highest-priority corrections (Oct 18 review)

- [x] Per-metric grants (`view_financials` etc.) rechecked at execution; catalog,
  structured query, NL, export, evidence, history and alert CRUD/evaluation all
  use `metricAccess.js`. Regional-only grants are denied for global metrics
  (explicit global-or-deny). *Before (#607).*
- [x] Fail-closed audit: results are not returned if the ledger insert fails;
  READ ONLY / REPEATABLE READ transactions; append-only trigger (migration 892).
  *Before (#607).* Error codes `metric_permission_required` /
  `analytics_audit_unavailable` now map to localized copy in the builder. *Now.*
- [x] Per-currency money with exact BIGINT strings and `moneyExact` /
  `analyticsFormat` display; CSV formula neutralization. *Before (#607).*
- [x] Take rate can no longer exceed 100% by construction: job-fee ledger
  entries linked to priced completed jobs of the same currency / recorded value
  of those jobs. *Before (#607).* Values over 100% now indicate a data anomaly
  (fee above recorded price) and are shown, not clamped.
- [x] Super-admin revenue period delta: the previous-period figure summed every
  currency; it now comes from the registry USD account like the current figure
  (parity test `metricsRegistryRevenueTakeRate.db.test.js`). *Now.*

## Area 1: governed metrics

- [x] Registry of 17 governed metrics; builder dimensions, alerts, permissions
  and catalog derive from the same definitions. *Before: 16; now: +
  `job_completion_rate_pct`.*
- [x] Job completion rate is one definition (decided = completed + cancelled,
  non-deleted, created in window) used by super-admin dashboard, investor
  dashboard, builder, evidence and alerts. The investor dashboard previously used
  an all-time rate and counted soft-deleted jobs. *Now* (parity test in
  `analyticsOperationalMetrics.db.test.js`).
- [x] Configurable CSAT target: server reads `settings.general.csat_target`
  (default 80 only when unset/invalid). *Before.* The client's `|| 80` is a
  redundant display fallback, not a second definition.
- [defer] Remaining NPS/SLA support-page cohorts differ from the registry; they
  are documented, not linked to evidence, until the support pages adopt the
  registry cohort (product sign-off needed on the cohort change).
- [defer] QW5 daily snapshot pipeline (`agent_daily_performance`,
  `business_daily_metrics`, `team_daily_performance`): endpoints are marked
  deprecated; build-vs-delete is a product decision. Alert observations
  (migration 893/897) provide the persistent history the alerts need.

## Area 2: drill-through

- [x] Evidence (underlying records + canonical per-currency summary) for all
  17 builder metrics, URL-encoded, paginated, exportable, audited. *Before (16),
  now (+1).*
- [x] Super-admin Dashboard revenue-period and completion-rate cards link to
  their evidence (`analyticsEvidenceHref`); open disputes and cancelled jobs
  keep their parity-proven list links. *Now / before.*
- [x] Deep links fail closed: an unpermitted metric shows "permission required"
  without issuing a request; a malformed link shows "invalid link"; an aborted
  restore is retried when the location is shown again; back/forward restores
  evidence. Covered by `analyticsRemainder.browser-check.cjs`. *Now.*
- [defer] Investor dashboard: investor-facing, so no admin builder links.
- [defer] MoneyPage per-channel tiles, OperationsOverview incident counts and
  Customer 360 timeline rows: these numbers are not registry metrics yet; links
  are added only once KPI/evidence parity is provable.

## Area 3: threshold alerts

- [x] Dispute rate, refund rate, payout failure count, SLA compliance and job
  completion rate are alertable (15 of 17 metrics; the two restaurant metrics
  are per-restaurant). Previous-period % comparisons; observation history.
  *Before (14) + now (+1).*
- [x] `notify_payout_failures` / `notify_disputes` / `notify_incidents` and
  `notify_metric_alerts` have readers in the evaluator. *Before.*
- [x] Delivery safety: the fire is claimed transactionally (cooldown and rule
  version checked in one UPDATE, `metric_alert_fires` row) before any channel
  runs, so two workers or a crash after delivery cannot double-fire; a fire that
  reaches no channel releases the cooldown. *Now* (migration 898).
- [x] SMS crash recovery across buckets: a `sending` claim blocks new SMS for
  the rule; claims stuck in `sending` for 10 minutes become `uncertain` and are
  never auto-resent; provider rejection is `failed`. *Now.*
- [x] Email-only with daily/weekly digest preference now queues a payload digest
  row (migration 899) instead of being dropped; without a delivery key it falls
  back to realtime email. *Now.*
- [x] Retention: observations, fires and SMS claims pruned daily after
  `METRIC_ALERT_HISTORY_RETENTION_DAYS` (default 400, 30-3650). *Now.*
- [ops] Live email/SMS/push delivery, `METRIC_ALERTS_ENABLED=true`, worker
  readiness, and review of existing rules affected by period-default changes.

## Area 4: scope architecture

- [x] `scopeModel` canonical resolver; restaurant pilot; business access
  middleware converged onto `resolveBusinessAccess`. *Before (#606/#607).*
- [x] Logistics country gate fails closed on error. *Before.*
- [x] New analytics surfaces use the canonical resolvers (business invoice
  analytics and Growth Center business performance are manager-gated through
  `requireBusinessAccess`; helper performance is own-data only). *Now.*
- [defer] ~470 inline business/membership filters: long-tail convergence,
  domain by domain; no behavior change is safe without per-domain tests.
- [defer] Region-aware row filtering: product/security decision. Current policy
  is explicit global-or-deny.
- [defer] One Truth analyst scope + Q3 O(n^2) pairing redesign: separate work.

## Area 5: embedded analytics

- [x] Helper earnings: currency accounts, monthly series, paginated jobs.
  *Before (#607).*
- [x] Business Hub analytics tab rebuilt on paid invoices per currency.
  *Before (`b40a6228`).*
- [x] Restaurant paid-order retention cohorts and currency-separated top items.
  *Before (`b40a6228`).*
- [x] Featured placements: deduped conversions, 7-day identified-user click
  attribution, unpaid/cancelled/refunded excluded. *Before (`b40a6228`).*
- [x] Growth Center (Promote) Performance tab is server-backed: every copied
  tracked post/link/card/signature records a share; profile visits from tracked
  links (`ref=growth_center`) are recorded once per device/source/campaign/UTC
  day, excluding the owner and business team. Per source, medium and campaign;
  7/30/90/365-day windows; 730-day retention. The per-browser localStorage
  counter is removed. Visitor ids persist only with analytics-cookie consent
  (otherwise per-tab). *Now* (migration 900).
- [defer] Broadcast delivery/open analytics: `business_broadcasts` "send" only
  marks a row sent; there is no delivery to measure. Needs a product decision
  to build delivery first.
- [defer] Promo-code redemption analytics: promo codes are never redeemed in
  code. Same dependency.
- [defer] Booking attribution for tracked profile links: visits are reach, not
  conversions; tying anonymous visits to bookings needs an attribution policy.
- [ops] Production `AFFILIATE_ENABLED`.

## Area 6: governed query / NL

- [x] Fixed-template builder, caps, timeout, ledger, history filtered by
  current grants, admin-nav entry. *Before.*
- [x] NL: deterministic parser + parse-attempt auditing; optional validated
  JSON-only model fallback behind `ANALYTICS_NL_MODEL_ENABLED` (default false,
  documented in `server/.env.example`). *Before (`b40a6228`) / now (env docs).*
- [x] New metric aliases (`completion rate`, `job completion`). *Now.*
- [ops] Enabling the model fallback needs provider, privacy (free-text
  questions) and acceptance review.

## Cross-cutting

- [x] Legacy and namespaced catalogs in en/es/fr/ht/ar for every new key
  (`verify:i18n`, i18n debt gates and duplicate-key checks green).
- [x] Browser regressions (synthetic fixtures): `analyticsRemainder` and
  `promotionPerformance` checks at 320/390/1360 px, en/fr/ar, light/dark, RTL.
- [x] SOP: only the review manifest was re-baselined (it hashes `en.json`);
  guide PDFs/screenshots were already current and were not regenerated.
- [ops] Apply migrations 893-900 through the deployment workflow; repeat
  authenticated admin/business flows with real sessions, including revoked
  grants. No production migration or deployment was performed.

## Migrations on this branch

| # | Purpose |
|---|---------|
| 893-897 | Alert observations + SMS claims, audit event types, campaign dedupe, evidence audit type, observation definition snapshots (`b40a6228`) |
| 898 | `metric_alert_fires`, SMS claim statuses `sending/sent/uncertain/failed` |
| 899 | `email_digest_queue` payload rows (nullable `notification_id`, unique `delivery_key`) |
| 900 | `promotion_link_events` (Growth Center shares/visits) |

All additive. Exercised through the real migration runner on a disposable
database; CI runs the migration rehearsal from 785.

## Verification (local, October 19)

- Touched server suites: 17 suites / 201 tests passed against the disposable
  database (alerts, digest, notification wiring, query builder, operational
  metrics, registry parity, promotion link analytics, NL, controllers).
- Client: duplicate-key, i18n debt gates, `verify:i18n`, `typecheck`, `test:sop`,
  production `build` and `verify:dist-assets` passed.
- Browser checks passed (Chrome, synthetic API fixtures, not live sessions).
- Remote CI: see the pull request.

---

## Historical review (October 18, 2026; superseded by the status above)

Reviewed October 18, 2026 against `oxsteed/old-file`, default branch
`old-files-claude`, commit `9c900efb95ec386e2b9b91b981ffab6deefa2e12`.

The default-branch pull completed with a clean working tree and no pending
updates. The supplied SCOPE.md describes `ded205f2`; PR #606 has since added
implementations across all six areas. This review treats that document as the
comparison baseline, not as authority to execute its suggested changes.

**Conclusion: substantial v1 work is present; the full scope is incomplete.**
Several entries marked done in PROGRESS.md cover a pilot or narrower substitute.
Permissions, audit reliability, and financial meaning need correction before
expanding these capabilities further.

## Highest-priority corrections

### 1. Enforce metric permissions and scope in queries and alerts

- [ ] Require the appropriate existing grant for each metric, including
  `view_financials` for financial metrics, and recheck it at execution time.
- [ ] Honor regional/business/restaurant scope, or reject global requests when
  the caller has only scoped permission. Recheck permissions during every
  background alert evaluation, including after grant expiry/revocation.
- [ ] Filter the metric catalog by permissions; apply the same restrictions to
  structured queries, natural-language execution, exports, and alert CRUD.
- [ ] Add negative tests for an admin with no grants, regional-only grants,
  revoked grants, and access to another business.

Evidence: `server/routes/admin.js:1104` and `:1111` gate the new routes with
`requireAdmin` alone. `server/analytics/queryBuilder.js:675` resolves scope but
checks only admin role; most metric SQL does not consume that scope. Restaurant
metrics have a separate ownership restriction. `scopeModel.js:252` exposes
region restrictions, but the builder does not enforce them.
`server/jobs/metricThresholdAlerts.js:131` checks role/preferences and then
computes platform-wide metrics without grant or region checks.

A synthetic, database-free invocation confirmed that a scope marked
`regionRestricted: true` still receives a platform revenue result. This was a
service-level reproduction with stubbed scope and database objects, not a live
request or access to production data.

### 2. Make query accountability reliable

- [ ] Prevent successful disclosure of query results when required audit
  persistence fails, or introduce a durable audit mechanism with equivalent
  guarantees.
- [ ] Enforce read-only execution at the database transaction/role boundary in
  addition to fixed SELECT templates, timeouts, and row caps.
- [ ] Protect the execution ledger against update/delete at the database level;
  define retention, access, and query/export history review.

Evidence: `server/analytics/queryBuilder.js:620` catches audit INSERT failures
and continues; `:653` starts a normal transaction rather than a read-only one.
Migration 891 creates the ledger but has no append-only enforcement trigger.
The synthetic reproduction also returned revenue when the audit INSERT threw.

### 3. Correct financial semantics and export/display handling

- [ ] Separate monetary totals and thresholds by currency; do not add different
  currencies and present the result as dollars. Apply currency-aware minor-unit
  precision and preserve large integer amounts.
- [ ] Fix helper earnings totals: the newly visible UI consumes an API that
  sums all completed-job currencies and labels the sum with `MAX(currency_code)`.
- [ ] Finish investor GMV/take-rate accounting: GMV still uses job budgets;
  fee numerator and completed-job denominator are not joined to matching jobs.
  Removing subscriptions does not make this an actual realized take rate or
  guarantee it stays below 100%.
- [ ] Format PostgreSQL BIGINT string results correctly in the query table.
  Its monetary formatter currently formats only JavaScript numbers and assumes
  dollars. Native BIGINT strings fall through as raw cents.
- [ ] Neutralize spreadsheet formula cells in query-builder CSV exports.
  Quoting commas and quotes alone does not neutralize a business/item name
  beginning with `=`, `+`, `-`, or `@`.

Evidence: `server/controllers/mainAppController.js:2732`,
`server/analytics/metricsRegistry.js:210`, `:291`, `:398`,
`server/analytics/metricAlerts.js` (`formatValue`), and
`client/src/pages/admin/AdminQueryBuilderPage.jsx:36` / `:66`.

## Remaining scope by area

### Area 1: governed metrics

Present: a 13-metric catalog; shared functions/fragments for selected KPIs;
canonical dispute counts, cancellation rules, SLA target resolution, calendar
periods, and computed MRR/held-payment values.

- [ ] Move remaining hand-written aggregations into executable shared metric
  definitions. The query builder currently introduces another set of SQL
  templates for several catalog metrics rather than using one execution path.
- [ ] Apply one scope/currency/window/cohort contract across dashboards, alerts,
  drill lists, and exports, with parity tests between real consumers.
- [ ] Resolve remaining NPS cohort differences. The progress log itself notes
  that the support CSAT page and registry use different review cohorts.
- [ ] Replace remaining hardcoded configurable targets, including
  `csat_target: 80` in `server/routes/support.js:1133`.
- [ ] Decide whether to complete or retire the unwritten daily snapshot pipeline
  (`agent_daily_performance`, `business_daily_metrics`, `team_daily_performance`)
  and its orphan endpoints. QW5 remains explicitly blocked on that decision.
- [ ] Define snapshot/refresh ownership and freshness where historical metrics
  and comparisons require persistent observations.

### Area 2: drill-through

Present: URL filters for jobs/users, initial conversation deep links, verified
user filtering, and two documented parity-proven KPI links: open disputes and
cancelled jobs.

- [ ] Build filterable underlying-record views for revenue, investor GMV and
  take-rate, SLA compliance, support/consulting NPS, MRR, and held payments.
  Include totals/denominators, not just sampled recent rows.
- [ ] Carry status/date/currency/business/scope context into target lists and
  preserve it through refresh, browser navigation, pagination, and exports.
- [ ] Finish URL-driven filtering for remaining support, disputes, and report
  targets. A ticket-detail query param is not complete filter synchronization.
- [ ] Wire MoneyPage, analytics, operations, and Customer 360 dead-end KPIs and
  timeline records once their underlying query parity is proven.
- [ ] Reuse the shared clickable StatCard pattern instead of maintaining local
  variants, and handle missing target grants explicitly.

These gaps are also listed under “Item 8 — Skipped metrics” in
`docs/analytics-platform/PROGRESS.md`; Item 8 is correctly marked partial.

### Area 3: threshold alerts

Present: rule table and CRUD, settings UI, scheduled evaluator, cooldown,
notification keys, and eight alertable metrics.

- [ ] Add the originally requested dispute-rate, refund-rate and payout-failure
  metrics; add SLA compliance computation for alerts. The current eight names
  do not include these operational rates/counts.
- [ ] Add previous-period/week-over-week comparisons and persistent history
  needed for spike detection. Current rules compare one current scalar to one
  fixed threshold.
- [ ] Extend computation coverage beyond the current eight metrics. The catalog
  now contains thirteen metrics; documentation still says “8 of 11.”
- [ ] Wire the original `notify_payout_failures`, `notify_incidents`, and
  `notify_disputes` preferences into actual dispatch. The new worker reads the
  newly added `notify_metric_alerts` plus channel preferences; the old category
  toggles remain settings fields without dispatch consumers.
- [ ] Make channel selection faithful: email-only delivery still calls a
  service that inserts an in-app notification and may send push. There is no
  independent suppression of those channels in this path.
- [ ] Make evaluator delivery safe across multiple workers and crash retries.
  The SMS call has no idempotency key or durable claim and is separate from the
  notification key; `last_fired_at` is updated after delivery.
- [ ] Add scoped deep links from an alert into the metric's underlying evidence.

### Area 4: scope architecture

Present: shared scope/access helpers and restaurant-controller convergence.
This is the planned first-domain pilot, not codebase-wide row security.

- [ ] Adopt the canonical resolver in business access middleware and legacy
  business-ownership helpers, preserving each role policy.
- [ ] Converge remaining inline membership/tenancy filters domain by domain.
- [ ] Add logistics-specific scope resolution and fix the current country gate's
  fail-open error path (`server/middleware/requireLogisticsAccess.js:153`).
- [ ] Integrate One Truth analyst scopes and global admin search with the shared
  model; implement region-aware rows or retain explicit global-or-deny behavior.
- [ ] Define and test conflicting/expired/global/regional grants correctly.
  Informational region IDs are not enforcement.
- [ ] Prove isolation across all relevant roles, accounts, businesses,
  restaurants, logistics relationships, and read/export/background paths.

### Area 5: embedded analytics

Present: helper earnings card and enabled visibility, restaurant repeat-order
and top-item reporting, featured-placement event tracking/performance.

- [ ] Rebuild the business analytics capability against a correct contract if
  that scope is still desired. Removing the broken tab avoids wrong values but
  does not implement the planned business analytics tab.
- [ ] Finish helper earnings: currency-safe summaries, monthly series,
  paginated/full job drill-down, job links, account-change handling, and light/
  dark/RTL styling. The card currently displays ten recent jobs and weekly bars.
- [ ] Add restaurant retention cohorts and record drill-through; the current
  repeat-order rate is an in-window repeat-customer order share, not a cohort
  retention model.
- [ ] Settle payment-state semantics for restaurant “revenue” and repeat orders.
  New aggregates include every order except cancelled/refunded, so pending or
  unpaid orders can contribute.
- [ ] Complete campaign analytics beyond featured placements: broadcasts,
  delivery/open/click performance, promo redemption, and durable referral
  tracking. The original Promote Performance tab still uses localStorage.
- [ ] Distinguish campaign-window orders from paid, click-attributed conversions.
  Impressions are search-response events, and order creation records a
  conversion even if hosted checkout has just failed. Add attribution,
  payment/cancellation policy, retry deduplication, and data-loss visibility
  before presenting this as a reliable funnel.
- [ ] Verify affiliate activation separately. The frontend flag is enabled;
  this review did not inspect production `AFFILIATE_ENABLED` configuration.

### Area 6: governed query/NL interface

Present: fixed-template query builder with dimensions/filters, 10,000-row cap,
30-second timeout, query ledger, CSV download, and confirmed English rule-based
question parsing.

- [ ] Fix the permission/scope, audit, read-only, money, and export gaps above.
- [ ] Complete the broader natural-language scope if still required. The shipped
  implementation is a deterministic English phrase parser, not an LLM-based
  translator; calendar-quarter questions and many other expressions are
  deliberately rejected. Preserve explicit confirmation and never emit raw SQL.
- [ ] Add question/parse/rejection/execution coverage to audit history as needed;
  currently the execution path logs attempts, while `/nl-parse` has no ledger.
- [ ] Add discoverability: a route exists, but no query-builder link was found in
  the admin navigation components.
- [ ] Complete the One Truth scale prerequisite: its 5,000-row cap and nested
  within-group pair generation remain.

## Cross-cutting completion work

- [ ] Restore legacy/namespaced catalog parity. For all five requested languages,
  `queryBuilder`, `adminSettings.metricAlerts`, and
  `helperDashboard.jobEarnings` exist in the legacy catalog and are absent from
  namespaced `common.json`. Legacy default-namespace rendering can work, but the
  repository's parity requirement remains unmet.
- [ ] Add focused browser regressions for the newly shipped query builder,
  alert rules, helper earnings, and embedded analytics: authorization failures,
  account changes, currency formatting, CSV safety, keyboard operation, 320px
  layouts, light/dark themes, French, and Arabic RTL.
- [ ] Exercise the new tables/queries against full real migration schemas, and
  add real consumer parity plus denied-scope/audit-outage tests. Green tests of
  current behavior do not prove the missing safeguards.
- [ ] Update PROGRESS.md to distinguish pilot/v1/substitute/full-scope completion,
  reconcile stale counts and SOP notes, and record remaining product decisions.

## Suggested implementation order

1. Metric grants/scope enforcement and regression tests.
2. Reliable auditing/read-only execution, CSV safety, currency and cohort fixes.
3. Shared metric execution and evidence-backed drill-through.
4. Remaining operational alert metrics, old preference wiring, and delivery safety.
5. Business/helper/restaurant/campaign feature completion and scope convergence.
6. Broader NL coverage after the governance and scale prerequisites are met.

## Verification performed for this review

- Verified repository identity/default branch with `gh`, ran
  `git pull --ff-only origin old-files-claude`, and confirmed a clean tree.
- Reviewed changes from `ded205f2` through merged PR #606, the attached scope,
  implementation progress log, routes, services, controllers, client consumers,
  localization catalogs, and tests.
- Current default-branch CI run `39173175946` and CodeQL run `39173174832`
  both report success at the reviewed commit.
- Ran focused Jest suites for the query builder, NL endpoint/parser, and alert
  validation: **80 passed, 30 skipped** (database-dependent coverage), across
  four selected suites. No disposable database was supplied for this review.
- Ran a stub-only reproduction of restricted-scope revenue disclosure plus
  audit-write failure; it returned the aggregate in both conditions.
- The preceding evidence describes the initial review, before implementation.
  A fresh full build,
  browser matrix, database rehearsal, and deployment verification were not run.

## Implementation record

- Branch `codex/analytics-scope-completion`, based on `9c900efb`.
- In progress: grant-gated metrics/catalogs/alerts, fail-closed query auditing,
  read-only query transactions, protected audit history, exact money display,
  and safe CSV output. These changes are not yet release-verified.
