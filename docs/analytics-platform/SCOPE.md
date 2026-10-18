# Power BI Capabilities: Codebase Scope Report

**Date:** 2026-10-18
**Branch scoped:** `old-files-claude` @ `ded205f2` (includes PR #605)
**Method:** 6 area agents, each running two independent investigation passes (client-inward and server/DB-outward) with reconciliation. Read-only; no code changed.
**Standing rule:** quality over speed.

## Executive summary

The codebase has **no governed metrics layer** and **no automatic data scoping**. These are the two load-bearing gaps: four of the six ideas depend on one or both. The good news: the primitives exist (notification fan-out with idempotency, a safe LLM precedent, owner-scoped analytics endpoints, a permission resolver Customer 360 already consumes). The bad news is structural, not missing features:

- The same KPI is computed differently in different places, **on the same screen**. "Open disputes" shows a different number to super-admins vs admins on the super dashboard.
- "Revenue" has 4-5 live definitions; the investor take-rate can exceed 100% by construction.
- ~470 hand-written `business_id` filters across 78 controllers; 19 copy-pasted restaurant access checks. Every endpoint author must remember to filter.
- A complete helper-earnings API exists with **zero UI consumers**. A business analytics tab reads fields the server never returns.
- `admin_notification_prefs` (payout failures, incidents toggles) has **zero readers** — a settings UI with no dispatch behind it.

---

## Area 1: Semantic metrics layer — Effort M (v1) / L (full)

### Current state (verified duplicates)

There is no metric registry and no shared aggregation library (`server/utils/` contains zero aggregation helpers; `metricsService.js` is operational telemetry, not business KPIs). Every controller hand-rolls its own SQL and its own status semantics:

| Metric | Definitions found | Worst instance |
|---|---|---|
| Open disputes | 3 | `adminController.js:29` counts `jobs.status='disputed'`; `superAdminController.js:283` counts `dispute_status='open'`; the same `Dashboard.jsx:393` card shows **different numbers by role** (`Dashboard.jsx:151` picks endpoint by role). Neither touches the `disputes` table. |
| Revenue | 4-5 | Platform take (`platform_ledger`, superAdminController.js:306-321, duplicated verbatim in investorController.js:116-131) vs food vertical GMV (`restaurantReportsController.js:76-80`) vs tool rentals (different status set, `toolAnalyticsController.js:124-125`) vs consulting. Investor GMV is `SUM(budget_max)` (budgets, not actuals); `take_rate_pct` (investorController.js:206) divides all-time take incl. subscriptions by budget-GMV, so it can exceed 100%. `mrr: 0` and `escrow_held: 0` are hardcoded zeros (superAdminController.js:~440). |
| Cancel rate | 3 | Materialized view (migration 170, thresholds 5/15/30 hardcoded in SQL *and* duplicated in controller *and* in JS `calculateRiskLevel`); Customer360 computes it **client-side in JSX** (`Customer360.jsx:975`) mixing both roles and skipping the `deleted_at` filter the MV uses; consulting uses `cancelled/(completed+cancelled)` (different denominator). |
| Completion rate | 2 | Period-bound (superAdminController.js:388-391) vs all-time (investorController.js:109-111). Same KPI name, different cohort. |
| SLA compliance | 2 incompatible | `support.js:797+` recomputes breach from **hardcoded** intervals; `slaMetricsController.js:19+` counts stored booleans set from the configurable `support_sla_targets` table (read at supportConversationsController.js:150). The admin SLA dashboard **ignores the business-configured targets**. "Avg first response" also disagrees *within* support.js (`COALESCE(first_response_at, updated_at)` vs raw). |
| NPS | 3 source tables | `consulting_session_feedback` vs `feedback_trends` view (sourced from `consulting_session_followups`, different table) vs `support_conversation_reviews`. Plus hardcoded `csat_target: 80` in server and client. |
| Periods | drifting | `'1y': '1 year'` (superAdminController.js:197) vs `'1y': '365 days'` (investorController.js:23). |

Also found: a **dead metric pipeline** — `performanceAnalyticsController.js` reads `agent_daily_performance`/`business_daily_metrics`/`team_daily_performance` (migration 141) but **nothing in the repo writes to these tables**; its 6 routes have no client consumers. "Dispute rate" as a rate exists nowhere. Consulting is the only area with a proto-metric layer (SQL views in migration 108), but the admin dashboard bypasses them with ad-hoc queries anyway.

### Gaps
No metric registry; no shared aggregation library; no canonical status taxonomy (one exception proves it's possible: `TERMINAL_CONVERSATION_STATUS_SQL` in `server/services/supportConversationTerminal.js`); targets/thresholds hardcoded in code instead of config tables; snapshot/MV pipelines without governance.

### Effort
- **M (2-3 weeks):** v1 — `server/services/metrics/` registry (name → canonical SQL + status sets + owner), shared aggregation helper, canonical status taxonomy, reconcile the 8 verified divergences with parity tests, wire SLA dashboard to `support_sla_targets`.
- **L (1+ month):** full vision — resurrect or delete dead snapshot tables, role-aware scoping in the registry, per-metric drill-through, migrate all ~15 aggregation sites across 8 domains off bespoke queries.

### Dependencies
- **Area 4 (data scoping): top dependency.** Every metric endpoint hand-rolls scoping today; the registry must inherit one scoping primitive or it reproduces the role-based divergence by design.
- Area 2 (drill-through): aggregates need interrogation.
- Workers/scheduling: MV refresh and snapshot pipeline ownership.

---

## Area 2: Drill-through as a first-class pattern — Effort M (core) / L (full)

### Current state

**The reference pattern works:** Customer360.jsx honors `?tab=` from the URL (`Customer360.jsx:357-359`), stat cards navigate to tabs (`:937-958`), and record rows link to detail pages whose routes exist in both the client manifest and `server/utils/adminSpaRoutes.js` (`:47-48, :52, :56`). AdminEnforcementDashboard uses the same `?tab=appeals&appealId=` convention.

**But most admin numbers are dead ends**, and several "linked" stats are broken:

| Drill link | Verdict |
|---|---|
| `/admin/users?role=helper` / `?status=banned` | Works (UsersList.jsx:377-392 reads params). But no `verified` filter exists, so the *unverified*-helpers card lands on the same list as the *verified* card — mechanically linked, semantically wrong. |
| `/admin/jobs?status=published` | **Broken.** JobsList.jsx:42 keeps filters in `useState`; no URL parsing. The `?status=` is silently dropped; the click *looks* like it worked. |
| `/admin/disputes` | Works only by coincidence (default tab is "open"); no explicit context. Fragile. |
| `/admin/support`, `/admin/reports` | Land unfiltered; targets keep filters in component state. |
| `/admin/messages?conversation=` (from Customer360.jsx:1061) | **Broken.** AdminMessages.jsx has no `useSearchParams` at all. |

**Dead-end inventory (high value):** all money numbers on super/MoneyPage (tracked revenue, GMV, pipeline, outflows, per-channel tiles); every support/analytics KPI (SLA, CSAT, performance, compliance, provider health, consulting); OperationsOverview incident/breach/webhook counts; super/Dashboard revenue and completion-rate family; Customer360 health metrics and payouts/tickets/fraud/incidents timeline rows (`link: null` at Customer360.jsx:283-305); all seven analytics pages have zero Link/navigate usage.

**No shared pattern:** the shared `StatCard` supports `href` (`components/StatCard.jsx:74`) but only super/Dashboard.jsx imports it. Five pages hand-rolled their own local StatCard (Customer360, SupportTickets, ConsultingDashboard, OrderManagement, OneTruthPage). Drill-through is per-page improvisation.

### Gaps
Filter context survives only where list pages were built URL-first. JobsList, Disputes, SupportTickets, ReportsDashboard, AdminMessages need URL-param filter support (UsersList/Customer360 is the template). Missing `verified` filter on UsersList. MoneyPage channels and analytics tiles have no underlying record lists at all.

### Effort
- **M (1-3 weeks):** make existing links honest — URL-param filter support on ~5 list pages (regression-tested), wire `href`s through hand-rolled stat cards, add `verified` filter. No new server endpoints needed.
- **L (1+ month):** "every number drillable" including metrics with no underlying record list (requires new queryable endpoints per metric).

### Dependencies
- **Area 1 (metrics): drilled numbers must match the KPI definition.** Dashboard aggregates and list-page filters are separate code paths today; without definition parity, "Open jobs: 12" drills into a list showing 40 — worse than no drill-through.
- **Area 4 (data scoping):** deep links cross grant boundaries; new param-driven filters must re-verify server-side enforcement, and the UI should degrade gracefully when the admin lacks the target's grant.
- Needs one agreed query-param convention adopted across all list pages.

---

## Area 3: Threshold alerts — Effort S (narrow) / M (v1) / L (with full metrics layer)

### Current state

**Everything business-facing is event-based today.** All ~45 `sendNotification` call sites (`server/services/notificationService.js:58`) fire on discrete events (creation, status change, decisions). The watchlist (`customer360Controller.js:324-377`) fires on dispute/ticket/booking events with idempotency keys — zero metric evaluation. The PR #605 alert rules (`server/jobs/customer360Alerts.js`, evaluated every 60s) are **condition-based, not threshold-based**: status-list + `min_age_minutes` staleness, no counts, no rates, no WoW. (It does have the right *shape* to extend: permission recheck per evaluation, stable dedupe keys.)

**Two genuine threshold silos exist, neither serves business metrics:**
1. **Platform health** (`metricsService.js:201` `checkAlerts()` every 5 min): error rate > 5%, rate-limit hits, failed logins, DB p95. Dispatches email+Slack to a single security mailbox. Caveat: the `this.thresholds` config object (`:35-42`) is **not wired into `checkAlerts()`** — decorative config; `paymentFailureCount`/`backupMissingHours` referenced nowhere.
2. **Credit compliance fraud** (`transactionMonitoringService.js`): real metric rules (structuring, velocity spike ≥5x baseline, rapid fund-out, new-destination payout ≥$5k). But hits **open compliance cases, not alerts**. Only one SLA check dispatches; another records critical incidents that are never dispatched (pull-only asymmetry).

**Ops incident pipeline** (`incidentStore.js`: dedupe_key + 15-min cooldown) exists, but watchdog callers record without dispatching — effectively pull-only via the monitoring UI.

**Precursor debt:** `admin_notification_prefs` (migration 706: `notify_payout_failures`, `notify_incidents`, `notify_disputes`) is **write-only — zero readers anywhere**. A settings UI promising toggles with no dispatch behind it.

### Gaps
No business-metric evaluation at all (no dispute rate, refund rate, payout failure rate, no WoW comparisons). No metric snapshot store (in-process counters reset on restart). No spike-detection primitive. No per-admin threshold config with working dispatch. Dedup/cooldown fragmented across three mechanisms. Channel routing siloed (business alerts in-app only; incidents email+Slack to one mailbox).

### Effort
- **S (days):** 3-4 hardcoded metrics (dispute rate, payout failure count, refund rate) routed through the existing incident pipeline.
- **M (1-3 weeks):** v1 — metric-definition queries + `admin_metric_alert_rules` table (metric, window, threshold, op, cooldown) + scheduled evaluator (template: `customer360Alerts`' 60s loop) + per-admin fan-out honoring `admin_notification_prefs` + CRUD UI.
- **L (1+ month):** if it must wait on / build the general semantic metrics layer first.

### Dependencies
- **Area 1 (metrics):** threshold definitions must come from one canonical catalog, or alerts disagree with dashboards.
- **Area 4 (data scoping):** alerts must respect admin scopes; `customer360Alerts.js:12-15` permission-recheck is the template.
- Own debt: decide whether threshold alerts honor the existing (currently dead) `notify_incidents`/`notify_payout_failures` toggles.

---

## Area 4: Row-level security as architecture — Effort L (4-8 weeks)

### Current state

**As designed:** a layered, documented architecture. Canonical 7 roles + hierarchy + capabilities in `server/constants/roles.js` (note: `can_mediate` is defined at :166/180/195/210 with **zero consumers** — inert flag). Admin gates: `requireAdmin`/`requireSuperAdmin` (`middleware/adminAuth.js:58-118`) composed with grant-based `requirePermission` (`adminAuth.js:301`; note: a *different same-named* middleware exists at `middleware/requirePermission.js` for business-team codes — easy to import the wrong one). Business tenancy: `requireBusinessAccess` (`middleware/requireBusinessAccess.js:65-140`) attaches `req.business`/`req.permissions` via `permissionsService.js`; its docstring claims to replace the legacy per-controller helpers. Logistics: capability middleware in `middleware/requireLogisticsAccess.js` — but `enforceCountryRestriction` **fails open** on error (`:155`). One Truth: `requireOneTruthGrant` attaches `req.oneTruthScopeIds`.

**As practiced (the reconciliation finding):** the replacement is partial and **no automatic row filtering exists anywhere**:
- ~**470 inline `business_id = $N` filters across 78 controllers**; **36 controllers query `business_members` inline**.
- Legacy `businessOwnership.js` helpers still called per-handler in **28 files** (incl. `chatController.js:1662`).
- **19 duplicated local copies** of `requireRestaurantAccess` across restaurant controllers (one file comments "Identical access query to foodController.requireRestaurantAccess"); 3 near-duplicate `isRestaurantOwner` variants. Restaurants have **no shared scoping middleware at all** — the 239-route router relies on a code comment.
- The middleware gates **membership only**; rows are always hand-filtered. Controllers split between using the validated `req.business.id` and re-reading raw `req.params.businessId`.
- One Truth's `withAnalystScope` injects `= ANY($N)` predicates but is **hand-called per query** at 4 sites.
- The warehouse reference pattern (capability `warehouse.view` + ownership SQL in `warehouseService.js:214,235,285`) is sound but the branch decision is still hand-rolled per handler.
- Region-scoped admins get 403 on global endpoints rather than scoped rows (fail-closed by design, but row-level region scoping doesn't exist as a mechanism).

### Gaps
No centralized query rewriter or choke point (`pool.query` called directly in hundreds of controllers). Scoping semantics are domain-specific and inconsistent (business = `business_id` + role codes; restaurant = ownership-through-business joins; logistics = capability + buyer/recipient ids; admin = full access or fail-closed). Gate and filter live in different layers and can diverge. ~20 subtly different restaurant ownership definitions must be converged before any automatic layer, or behavior changes.

### Effort
**L (4-8 weeks, one engineer):** (1) canonical scope model covering business tenancy, restaurant ownership, logistics capabilities, grant-scoped admin reads, region rules; (2) enforcement point (scoped-repository layer or query rewriter) with one domain pilot; (3) convergence of duplicated access queries without changing authorization behavior; (4) per-domain regression tests proving no over/under-scoping. The ~470 filter sites are the long tail; the hard part is semantic.

### Dependencies
- **Co-foundation with Area 1:** metrics/drill-through/NL are all consumers of the scope model; it should be designed with them as co-consumers.
- Customer 360 already consumes the production permission resolver (`docs/customer360/implementation.md:5,26`) — proof the resolver-based design is consumable, and it constrains the new layer's API surface.

---

## Area 5: Embedded analytics for users — Effort S-M per item

### Current state by role

**Restaurant owner — strongest coverage.** `RestaurantReportsPanel.jsx` (sales by day/fulfillment/source, inventory, operations) backed by three manager-only endpoints (`restaurants.js:202-204`, `restaurantReportsController.js:62,147,205`). Not drill-down-able (plain divs). Merchant home "Today" stats link into tabs, and revenue uses the server-computed `paid_sales_cents` deliberately matching the Orders tab (P2-3-F06 comment) — a good semantic-consistency pattern.

**Helper — the biggest hole.** The "Earnings" tab is manual money logging (`HelperDashboard.jsx:1659-1686`), **launch-gated off** (`helperEarnings: false`, `launchScope.js:86`). `/helper/payouts` shows balances only. **But `GET /api/main-app/earnings` (`mainAppController.js:2732-2817`) returns a complete earnings drill-down** (lifetime/week/month, per-job rows, 12-week and 12-month series, payout breakdown) with **zero client consumers**. The API for the missing surface already exists.

**Business owner — partially working, partially broken.** `GET /businesses/:id/analytics` returns a P&L shape consumed correctly by Overview/Goals tabs. But `BusinessAnalyticsTab.jsx` reads `totalRevenue`/`revenueTrend`/`appointmentsByStatus` — **fields the server never returns** — and the tab isn't in the launched set (`launchScope.js:42-62`), so it's doubly dead. **Campaign performance doesn't exist:** the Promote page's "Performance" tab counts clicks in **localStorage** (`PromotePage.jsx:57,1007-1030`) — device-local, not server analytics. Broadcasts/promo codes have no delivery/open/click stats endpoint.

**Genuinely good embedded surfaces:** tool-rental analytics (`ToolRentalsAnalytics.tsx`, funnel + per-tool table, event-tracked) and the affiliate dashboard (stats, funnels, breakdowns). `CancellationStats` on job detail pages (customer reliability shown where helpers bid) is the embedded-analytics playbook in miniature.

**Dead API graveyard** (~10 orphan analytics endpoints, all verified zero consumers): the helper earnings API, payout summary, richer manager reports (`restaurantAppFlowController.js:1669` — POS-aware, net-collected — vs the live simpler `salesSummary`: two competing contracts, the better one unused), `/api/orders/stats`, support per-business analytics suites, calendar summary, shared-cart stats.

### Gaps
Helper earnings drill-down UI; restaurant repeat-order analytics (no repeat rate, cohorts, or top-items-by-revenue in either reports endpoint); business campaign performance (needs server-side event tracking); drill-down links absent on every aggregate surface; contract mismatches between analytics APIs and consumers; finished surfaces dark behind launch flags.

### Effort
- **S (days) each:** wire the orphaned helper-earnings API into UI (~2-4 days incl. i18n); fix the business analytics tab contract (~3-5 days); deprecate duplicate restaurant report APIs (~2-3 days); add drill-down links to live surfaces (~1 week).
- **M (1-3 weeks) each:** restaurant repeat-order + top-items analytics (~1-2 weeks); campaign performance with event tracking (~2-3 weeks; backfill policy is the hard part).
- Launch-flag flips are product calls, not eng calls.

### Dependencies
- **Area 1 (metrics): critical.** Revenue currently means three different things across user surfaces; embedded numbers must match admin numbers via the shared contract.
- **Area 4 (data scoping):** new aggregations must reuse existing owner-scoping patterns; users only ever see their own data.
- i18n (5 locales) for every new user-visible string.

---

## Area 6: Natural language over the governed model — Effort M (interim) / L (full)

### Current state

**Search infrastructure:** global admin search (`GET /admin/search`, `adminSearchController.js:90-302`) does escaped ILIKE across 8 entity types with grant gating — but **no scope filtering** (`scopeFilter.js:34-37` notes entity/team scoping needs grant-schema work). Customer 360 related-search is ILIKE-based. Learn search is client-side in-memory. One Truth is server-built SQL with a 5,000-row cap. Full-text (tsvector) exists only for the customer-facing knowledge base and marketplace products, not admin search.

**No NL-to-SQL, no query builder, no structured filter-to-aggregation layer exists.** The only "natural language" reference is a code comment stub (`jobKitService.js:18`).

**AI provider wiring:** Meta provider still defined (`aiChatProvider.js:1-60`) but its only production caller is the Customer 360 AI assistance (`customer360WorkspaceController.js:420-461`). User-facing paths are Meta-free (OpenRouter → Ollama). **PR #605's AI assistance is the closest safe precedent:** LLM sees only aggregate counts/statuses, guardrail system prompt, review-only draft, audited to `admin_audit_log` (`:447-454`), no model tools. It's per-case, not a global query interface, and depends on the 64-source Customer 360 registry — a per-case metric shape, not a global model.

**Audit:** `admin_search_log` logs every global search (migration 049); One Truth reads logged per-read with purpose/approver. But **no generic query-execution ledger** exists.

**One Truth / Q3 context:** the 5k cap stands; the code comment at `oneTruthController.js:860` claims indexed queries replaced the O(n²) comparison, but `buildSuspectPairsIndexed` (`:646-685`) still pairs within groups via nested loops — the audit queue's Q3 wording is accurate, the comment overstates the fix. Status: open.

### Gaps
No governed metrics model to target (Area 1 is a **hard blocker** — without it an LLM would emit raw SQL, the unsafe path). No NL-to-structured-query layer. No query validation sandbox (read-only enforcement, timeouts, row caps, table allowlist). No unified query-execution ledger for E15 accountability. Data scoping incomplete for NL (global search ignores it).

### Effort
- **M (2-3 weeks): interim structured query builder (no LLM)** — form UI emitting a validated JSON query spec executed as parameterized SQL against an allowlist, with caps and audit logging. The "days" version skips the sandbox and audit, which is precisely what makes it safe.
- **L (1+ month): full NL, strictly after Area 1** — constrained LLM translation (NL → validated spec, never raw SQL) with eval harness (~2 weeks) + execution sandbox and scope integration (~1 week) + audit ledger (~1 week) + hardening. The LLM piece is the smaller half; governance plumbing is the larger half.

### Dependencies
- **Area 1: hard blocker.** The Customer 360 64-source registry could inform Area 1's design but is per-case, not global.
- **Area 4: must be designed in, not bolted on** — scope resolution as a mandatory query-spec field.
- Q3 One Truth scale redesign: the aggregation engine must be built on its replacement pattern.

---

## Cross-area dependency map

```
                    ┌─────────────────────┐
                    │  Area 4: Data       │
                    │  scoping (L)        │◄──── longest pole; start first
                    └─────────┬───────────┘
                              │ scope primitive consumed by
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
   ┌─────────────────┐ ┌─────────────┐ ┌──────────────┐
   │ Area 1: Metrics │ │ Area 2:     │ │ Area 6: NL   │
   │ registry (M/L)  │ │ Drill-through│ │ (M interim /│
   └────────┬────────┘ │ (M/L)       │ │  L full)     │
            │          └─────────────┘ └──────────────┘
            │ metric definitions consumed by
   ┌────────┴────────┬──────────────┐
   ▼                 ▼              ▼
┌──────────┐  ┌────────────┐ ┌──────────────┐
│ Area 3:  │  │ Area 5:    │ │ Area 6       │
│ Threshold│  │ Embedded   │ │ (again: needs│
│ alerts   │  │ analytics  │ │  both 1 & 4) │
│ (S/M/L)  │  │ (S/M)      │ └──────────────┘
└──────────┘  └────────────┘
```

- **Areas 1 and 4 are co-foundations**, largely independent of each other, both required before 2/3/5/6 are fully sound. Area 4 is the longest pole (L, 4-8 weeks) — start it first.
- **Area 1 is the most-depended-on**: drill-through needs definition parity, alerts need canonical thresholds, embedded needs number consistency, NL is hard-blocked on it.
- **Area 2 is the cheapest credibility win** once Area 1 exists: the mechanic is trivial, the value is trust in numbers.
- **Area 5 has the most S-sized quick wins** that don't strictly need the foundations (wire orphaned APIs, fix contracts), though full consistency needs Area 1.

## Suggested sequencing

**Phase 0 — quick wins (days each, no foundation needed):**
1. Wire the orphaned helper-earnings API (`mainAppController.js:2732`) into the helper UI.
2. Fix the business analytics tab contract (reshape UI to the server's P&L fields or vice versa).
3. Fix broken drill links: URL-param filter support for JobsList, AdminMessages; add `verified` filter to UsersList.
4. Decide launch flags deliberately (helper earnings tab, business analytics tab, affiliate CTA) — product calls.
5. Delete or officially deprecate the dead analytics endpoints (or finish the abandoned snapshot pipeline — product decision).

**Phase 1 — foundations (parallel tracks):**
6. Start Area 4 scope model + one domain pilot (longest pole).
7. Build Area 1 v1 metrics registry; reconcile the 8 verified divergences with parity tests; wire SLA dashboard to `support_sla_targets`; delete the hardcoded zeros or compute them.

**Phase 2 — capabilities on the foundations:**
8. Drill-through rollout (M) once Area 1 definitions are stable.
9. Threshold alerts v1 (M): metric rules table + evaluator on the `customer360Alerts` template + per-admin fan-out; wire up the dead `admin_notification_prefs` toggles.
10. Embedded gaps (M each): restaurant repeat-order/top-items analytics; campaign performance event tracking.

**Phase 3 — after 1 and 4 mature:**
11. Structured query builder interim (M), then NL translation layer (L) with eval harness, sandbox, and E15 query ledger.

## Risks and watch-outs

1. **The metrics divergences are user-visible today.** "Open disputes" differs by role on the same page; investor take-rate can exceed 100%. These aren't future-tech problems — they're live credibility bugs worth fixing in Phase 1 regardless of the larger vision.
2. **Drill-through without definition parity is worse than none.** A drilled number that disagrees with the KPI discredits the numbers. Area 2 must follow Area 1, not lead it.
3. **The scope-model convergence is the hard part of Area 4**, not the enforcement point. ~20 subtly different restaurant ownership definitions and the business middleware-vs-legacy split must be unified without changing authorization behavior. Phase it per domain with regression tests.
4. **Don't build the NL layer on today's query patterns.** The One Truth O(n²)-in-groups failure mode would just get a natural-language trigger. Q3's redesign is a prerequisite pattern.
5. **Launch flags are product decisions.** Several finished analytics surfaces are dark; flipping them is Emile's call, not an eng task.
6. **The abandoned snapshot pipeline** (unwritten tables + orphan endpoints) needs an explicit decision: complete it as the metrics snapshot store, or delete it. It overlaps with what Area 1 v1 and Area 3 need.
