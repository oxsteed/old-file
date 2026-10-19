# Analytics Platform — Progress Log

> This log retains historical implementation claims. The current checkpoint and
> release blockers are recorded in [HANDOFF-2026-10-19.md](./HANDOFF-2026-10-19.md),
> which supersedes stale counts, financial definitions and completion claims here.

Living build log for the Power BI-inspired analytics platform work, scoped in
[SCOPE.md](./SCOPE.md) (two-pass codebase scope, 2026-10-18). Updated as work
lands. Branch: `feat/analytics-platform`.

## Phase 0 — quick wins

| # | Item | Status | Notes |
|---|------|--------|-------|
| QW1 | Wire orphaned helper-earnings API into helper UI | done | Wired `GET /api/main-app/earnings` into a new `HelperJobEarnings` card atop the HelperDashboard earnings tab (`f3d91416`); 20 locale keys x5 langs, build:ci green x2 |
| QW2 | Fix business analytics tab contract | done | `1cc92397`: UI read 12 fields the server never returns (zero overlap; rendered $NaN/zeros/empty charts). Reshaping to server fields would duplicate the Overview tab, so the dead tab was removed UI-side; server untouched. Component left orphaned in-tree for a metrics-layer rebuild |
| QW3 | Fix broken drill links (JobsList, AdminMessages URL params; `verified` filter on UsersList) | done | `48ac7c7a` + `054dd566`: JobsList `?status=`/`?search=`/`?page=` and AdminMessages `?conversation=` URL params work; new server `verified` param on getUsers (NULL-safe, matches dashboard stat) + UsersList dropdown + dashboard card links fixed; build:ci green. Note: /admin/export/users ignores plan/verified filters (pre-existing) |
| QW4 | Launch flags (helper earnings tab, business analytics tab, affiliate CTA) | done | Emile decided: launch. `2f4f6f73`: helperEarnings + affiliateRewards flags ON. Business analytics tab could NOT be launched: it rendered $NaN/zeros/empty charts (see QW2); QW2 removed the dead tab and the dead `businessHubAnalytics` flag was cleaned up. Affiliate needs `AFFILIATE_ENABLED=true` in Coolify (Emile's domain) or /api/affiliate/* returns 503 |
| QW5 | Dead analytics endpoints: delete vs complete snapshot pipeline | blocked | Product decision needed — Emile |

## Phase 1 — foundations

| # | Item | Status | Notes |
|---|------|--------|-------|
| 6 | Area 4 scope model + one domain pilot | done | **Primitive + restaurant pilot shipped** (`d45f6bcb`, `dd065733`). `server/services/scopeModel.js`: `resolveScope(user, context)` (business IDs + roles, restaurant IDs + roles, admin global/regionRestricted markers, own-data constraints), `resolveBusinessAccess(userId, businessId)` (canonical single-business gate mirroring `requireBusinessAccess` row semantics; middleware adopts it later), `resolveRestaurantAccess(userId, restaurantId)` (the canonical restaurant gate), `isRestaurantOwner(userId, restaurantId)`. Migrated 17 local `requireRestaurantAccess` copies + 2 `isRestaurantOwner` variants across 20 restaurant controllers; no authorization behavior change (same ownership CASE, same 404s, per-domain role gates stay at call sites). New `__tests__/restaurantScopeModel.db.test.js`: 28 tests proving legacy-vs-new parity across all 7 user_role values (historical variants copied verbatim from pre-migration tree @ bf4cb933). All touched suites green (282 tests). Convergence plan for remaining domains below. Longest pole (4-8 weeks) unchanged. |
| 7 | Area 1 metrics registry v1; reconcile 8 divergences; SLA dashboard to `support_sla_targets`; remove hardcoded zeros | done (Track B) | Registry v1 at `server/analytics/metricsRegistry.js`. All 8 divergences reconciled with 28 parity tests; 7 commits on `feat/analytics-platform`. No migrations. No new user-visible strings (no i18n changes needed). Known limitations documented, not silently redefined: investor GMV = SUM(budget_max) (budgets, not actuals); consulting cancel rate keeps its own denominator; `under_review` disputes not folded into open_disputes. |

## Phase 2 — capabilities

| # | Item | Status | Notes |
|---|------|--------|-------|
| 8 | Drill-through rollout | partially-done | **Shipped 2 parity-proven drill links** (Track A). (1) `open_disputes` → `/admin/disputes`: the card link already existed; verified the drill target's count (`disputeAdminController.getAllDisputes`, default `?status=open`) matches the registry canonical — new parity test. (2) `cancel_rate_pct` → `/admin/jobs?status=cancelled`: new `href` on the super-dashboard Cancelled Jobs card; reconciled the soft-delete edge — dashboard jobs stats (super + admin `getDashboardStats`) and the admin jobs list (`superAdminController.getJobs`) previously counted soft-deleted jobs while the registry canonical excludes them (`deleted_at IS NULL`, migration 170 MVs); all three now exclude them so KPI card, drill list, and registry numerator agree (3 parity tests; the pre-fix predicates provably disagreed: 4 vs 3 on the fixture). **Skipped with reasons** (parity unprovable, no link shipped): see "Item 8 — Skipped metrics" below. No new i18n strings (href-only client change); no new routes. Server: 3 controller edits. Tests: `metricsRegistryDrillThrough.db.test.js` (3 new) + all 7 metricsRegistry suites (31 tests) green; `build:ci` green. |
| 9 | Threshold alerts v1; wire dead `admin_notification_prefs` toggles | done (Track B) | **Shipped** (commits below): migration `890_metric_threshold_alerts.sql` (new `metric_alert_rules` table + additive `notify_metric_alerts` column on `admin_notification_prefs`); `server/analytics/metricAlerts.js` (shared validation + canonical compute map over the registry); `server/jobs/metricThresholdAlerts.js` (per-minute evaluator, registered in `backgroundWorkers.js` behind `METRIC_ALERTS_ENABLED`); rule CRUD on `/admin/settings/me/metric-alert-rules` in `adminSelfSettingsController.js`; "Metric alerts" tab in `AdminUserSettingsPage.jsx` (existing `/admin/settings` SPA route, no new SPA route needed); 5-language copy for all UI + notification strings. **8 of 11 registry metrics alertable** (`investor_gmv_cents`, `consulting_cancel_rate_pct`, `sla_first_response_compliance_pct` have no registry compute fn — rejected with 400 until one is registered). **Prefs mapping**: `notify_metric_alerts=false` kills the rule entirely; `channel_email` additionally requires `email_notifications !== false`; `channel_sms` requires `sms_notifications === true` (SMS best-effort via Twilio; skipped silently when unconfigured). `sendNotification` gained an additive `emailChannel` option (default true) + `'metric_threshold_alert'` in its email allow-list. **Limitations**: (1) rules evaluate platform-wide for every admin — registry definitions have no per-admin dimension, so `scopeModel.js` has nothing to scope to; per-admin/per-business scoping is a follow-up; (2) `cancel_rate_pct` alerts use the platform cohort only (customer/helper roles need a userId); (3) thresholds are in native units (cents for `*_cents`, points for `*_pct`); (4) editing a rule resets its cooldown. **Tests**: `server/__tests__/metricThresholdAlerts.db.test.js` — 18/18 pass (validation, 5-lang copy, fire-once-per-cooldown, delivery_key same-window dedupe, prefs gating, NULL-value skip). `verify:i18n` green, `typecheck` green, client production `build` green. **OPEN**: `build:ci` stops at `test:sop` — the SOP source-manifest hashes `client/src/locales/en.json`, and the worktree's locale additions (this item's keys + the parallel track's keys) drift it. Verified the locale diff is purely additive in all 5 languages (no existing string value changed), so no guide rendering changed; the prescribed fix is review + `node scripts/sop/check-manifest.mjs --regenerate`, best done once after the parallel track lands. |
| 10 | Embedded gaps (restaurant repeat-order, campaign performance) | done (Track C) | **Shipped** (`129461c2`). Part 1: `server/analytics/restaurantAnalytics.js` (canonical repeat-order rate + top-items-by-revenue; registry entries `restaurant_repeat_order_rate`, `restaurant_top_items_revenue` added to metricsRegistry.js catalog), thin manager-only `GET /api/restaurants/:restaurantId/reports/loyalty` (canonical scope-model gate, default 90d window), loyalty section in RestaurantReportsPanel with loading/error/empty states. Part 2: migration 889 `campaign_analytics_events` (campaign_id, event_type impression|click|conversion, occurred_at, actor_key, metadata JSONB); `server/analytics/campaignAnalytics.js` emitter (never rejects; call sites never await); impressions from `listRestaurants` featured rows, clicks via `POST /api/food/restaurants/:id/campaign-click` beacon (FoodHomePage RestaurantCard), conversions from `createOrder` at featured restaurants; `GET /api/businesses/:businessId/campaign-performance` (business-scoped) + PromotePage funnel block (impressions/clicks/conversions, CTR, CVR). 16 new DB tests green; existing food/marketing/reports suites green; verify:i18n green. Decisions: see log below. |

## Phase 3

| # | Item | Status | Notes |
|---|------|--------|-------|
| 11 | Structured query builder, then NL layer | done | Track A `f651712b`: migration 891 (`analytics_query_audit` ledger), `server/analytics/queryBuilder.js` (registry validation, fixed per-metric SQL builders, scopeModel scoping, 10k row cap, 30s timeout, audit every attempt), `GET /meta` + `POST /run` behind requireAdmin, admin UI at `/admin/analytics/query-builder` with CSV export, 36 i18n keys x5 langs; 22/22 builder tests green. Track B `14cbca7f`: deterministic NL parser (`server/analytics/nlParser.js`, no LLM), 62/62 eval tests (46 utterances incl. 10 adversarial must-reject). Integration (coordinator): `POST /nl-parse` (requireAdmin, never executes, parser wired to Track A's BUILDER_DIMENSIONS, defense-in-depth revalidation), confirm-before-run UI with interpretation preview, `/run` accepts `raw_utterance` for the ledger, NL i18n keys x5 langs (parser English-only, stated in UI); 8/8 nl-parse endpoint tests green. Phase 3 test totals: 92/92 across builder + parser + endpoint suites. |

## Item 7 — per-metric status (Track B)

| # | Metric | Status | Decision / notes |
|---|--------|--------|------------------|
| 1 | Open disputes | done | Canonical: `disputes` table `status='open'` (matches the `/admin/disputes` drill target default tab). Replaces `jobs.status='disputed'` (admin) and `jobs.dispute_status='open'` (super-admin). `under_review` tracked separately, not folded in. |
| 2 | Revenue / take-rate | done | Canonical platform revenue: platform take from `platform_ledger` (`job_fee`+`subscription`, positive amounts). Super/investor dashboards already matched; now annotated to the registry. Vertical GMVs (food, tools, consulting) registered as separate metrics. |
| 3 | Cancel rate | done | Canonical: per-role, server-side, `deleted_at IS NULL` (matches migration 170 MVs). Risk thresholds 5/15/30 now live once in the registry (`CANCEL_RISK_THRESHOLDS` + `cancelRiskLevelCaseSql`); cancellationStatsController SQL CASEs and JS `calculateRiskLevel` reference them. customer360 health returns server-computed `cancel_rate_customer`/`cancel_rate_helper` (+ platform `cancel_rate` as %); Customer360.jsx no longer computes client-side. Consulting keeps its own `consulting_cancel_rate_pct` (different domain, deliberate). |
| 4 | Investor take-rate formula | done | OLD: all-time take incl. subscriptions / budget GMV (could exceed 100% by construction). NEW (registry `investorTakeRatePct`): all-time `job_fee` take / all-time budget GMV, 2dp, NULL on zero GMV. Parity test shows old=140% vs new=6.67% on the same fixture. |
| 5 | SLA dashboard → `support_sla_targets` | done | `GET /support/sla` (stats, 30d trend, by-department, violations list) and `supportConversationStats` now judge breach against configured targets via registry fragments (`slaTargetsJoinSql`/`slaFirstResponseTargetSql`/`slaResolutionTargetSql`): COALESCE(stored per-conversation target, current `support_sla_targets` row for business+priority, legacy hardcoded default). Hardcoded 15m/1h/4h/24h (first response) and 12h/24h/48h/96h (resolution) intervals removed. Avg first response now averages only responded conversations (was `COALESCE(first_response_at, updated_at)`). Response shape unchanged, so SupportSLADashboard.jsx needs no change. 4 parity tests; 89 existing support/sla/survey/settings tests pass. |
| 6 | NPS canonical source | done | Two domain metrics, each pinned: `support_nps_index` = `support_conversation_reviews`, proper NPS index (promoters − detractors; already used by the support CSAT route, now annotated); `consulting_avg_nps` = `consulting_session_feedback` AVG (adminConsultingController already used it, now annotated). `feedback_trends` (from `consulting_session_followups.feedback_rating`) is explicitly NOT an NPS source — rating trend only. No endpoint changed behavior; 5 parity tests; 53 admin-bundle route tests pass. |
| 7 | MRR / escrow_held | done | Both computed properly instead of hardcoded 0: `mrr_cents` = active subscriptions × plan amount (yearly /12); `escrow_held_cents` = net held payments (`held`/`disputed` escrow_status + `authorized`/`captured` status), floored per payment. Wired into superAdmin `getDashboardStats` (fail-open with schema probes). No client reads these fields today, so no UI change. 4 parity tests. |
| 8 | Periods drift | done | Canonical `PERIOD_INTERVAL` (`'1y' = '1 year'`) in the registry; superAdminController and investorController both reference it (investor was `'365 days'`). |

## Item 8 — Skipped metrics (no drill link shipped; parity unprovable)

The rule applied: if the drill target's filtered query cannot be made to
agree with the registry's canonical compute, the link is NOT shipped. Each
skip below names the exact blocker; none of these is a client-param gap that
QW3-style plumbing could close.

| Metric | Reason skipped |
|--------|---------------|
| `platform_revenue_cents` | No drill target can reproduce the KPI. The `/admin/super/revenue` page is period-bounded (7d/30d/90d/1y) and currency-scoped, while the dashboard KPIs are all-time / period / MTD over all currencies; its transaction list is a recent-50 sample, not a filterable full ledger. A sum KPI needs a full filterable ledger list with a totals row — does not exist. |
| `sla_first_response_compliance_pct` | No admin support-conversations list page exists: `GET /support/conversations` feeds only the agent chat workspace (1700-line console, no URL-param filtering), and the SLA dashboard's own violations list uses a broader predicate (first-response OR resolution breaches, non-terminal only) than the KPI (`sla_violation_count` = first-response breaches, all statuses). Building a breach-filtered conversations list page is follow-up work, not Item 8. |
| `support_nps_index` | KPI is a ratio (% promoters − % detractors); no dedicated reviews list page exists. The CSAT page's `recent_feedback` is a 25-row sample whose cohort (reviews on resolved/closed conversations in 30d for the index) does not match the registry canonical cohort (all reviews in 30d), so parity is unprovable without a new full list page. |
| `consulting_avg_nps` | No record list page exists for `consulting_session_feedback` (the canonical source). Nothing to link to; building one is out of scope. |
| `investor_gmv_cents` | Underlying records are completed jobs, but the KPI is `SUM(budget_max)` — a jobs list cannot reproduce the number, so a drill would show a count that disagrees with the KPI. |
| `investor_take_rate_pct` | Ratio of two all-time aggregates (job_fee take / budget GMV); no natural record list. |
| `mrr_cents` | Derived sum (active subscriptions × plan amount, yearly /12); no natural record list. |
| `escrow_held_cents` | No client displays this KPI (Item 7 wired it server-side only), so there is no card to drill from. |

## Decisions log

| Date | Decision | By |
|------|----------|----|
| 2026-10-18 | SCOPE.md moved into repo at `docs/analytics-platform/`; this log created | Atlas |
| 2026-10-18 | QW2/QW4 conflict: business analytics tab removed (was rendering $NaN/zeros), not launched; dead launch flag cleaned up; rebuild deferred to metrics layer (Phase 2) | Coordinator |
| 2026-10-18 | Item 6: `!restaurantId` fast-fail guard stays at call-site wrappers, not in the shared gate — moving it would turn the 4 no-guard modules' 500-on-garbage-id into 404 (error-path behavior change). Less invasive option chosen. | Track A |
| 2026-10-18 | Item 6: `operator_role` alias (restaurantCreditFundingController) and `membership_id` alias (restaurantInventoryController) preserved on the canonical gate alongside `effective_role`/`effective_membership_id` — same CASE, zero-cost, keeps both naming conventions working. | Track A |
| 2026-10-18 | Item 6: per-domain role gates (reports MANAGE_ROLES 403, appFlow assertManage, wallet assertWalletOperator) stay at call sites — domain policy on top of access resolution, not access resolution. | Track A |
| 2026-10-18 | Item 6: NOT migrated — `routes/statementArchive.js` wallet-standing check (keyed by wallet account, grants standing to wallet customer OR restaurant party) and `mediaController.js` actor verification (media-posting check with status/is_verified filters). Different semantics; documented in scopeModel.js. | Track A |
| 2026-10-18 | Item 6: `resolveScope` excludes soft-deleted businesses (matches `requireBusinessAccess` 404) but restaurant scope mirrors the gate's JOIN (no `deleted_at` filter) — each side mirrors its own legacy pattern; converging the two needs a product decision. | Track A |
| 2026-10-18 | Item 6: platform admins/super_admins get NO restaurant standing from their platform role (historical queries only look at ownership/membership) — preserved; `resolveScope` returns `global: true` for admin surfaces with `regionRestricted` as informational-only (no row-level region scoping exists; consumers keep fail-closed behavior). | Track A |
| 2026-10-18 | Item 6: shared `isRestaurantOwner` keeps the topup variant's `!userId -> false` guard (media variant had none; its only caller passes an authenticated id, so this converts an unreachable 500 into fail-closed false). | Track A |

## Item 6 — convergence plan for the remaining domains

End state: every hand-written tenancy filter in the codebase is either a
call into `server/services/scopeModel.js` or a thin, documented wrapper
around it. The gate (who may touch this row) and the filter (which rows a
query returns) come from one ownership CASE per domain, so the metrics
registry (Item 7) and drill-through (Item 8) inherit scoping instead of
re-implementing it. No automatic query rewriter — the codebase calls
`pool.query` directly in hundreds of places and a rewriter would be a
flag-day; convergence is per-domain, behavior-preserving, regression-tested.

Rough order (cheapest / most-contained first; each step = migrate +
parity tests like the restaurant pilot's):

1. **Business tenancy middleware** (`middleware/requireBusinessAccess.js`).
   Adopt `resolveBusinessAccess` for the row query; keep the middleware's
   401/400/404/403 contract and `req.business` / `req.businessRole` /
   `req.membership` / `req.permissions` attachments byte-identical.
   Unlocks: the 36 controllers that query `business_members` inline can
   then drop their inline queries for the canonical helper.
2. **Legacy `utils/businessOwnership.js` helpers** (`ownedBusiness`,
   `canEditProfile`, `canManageBusinessFinance`, `canAccessBusinessTeam`,
   …). Re-express over `resolveBusinessAccess` + role policy at the call
   site (they encode narrower policies — owner-only, owner+manager — which
   stay as policy, like the pilot's MANAGE_ROLES). 28 files call these.
3. **Logistics capabilities** (`middleware/requireLogisticsAccess.js` +
   `warehouseService.js` ownership SQL). Different semantics (capability +
   buyer/recipient ids, not business membership) — needs its own
   `resolveLogisticsScope` in the model; do NOT force it into the business
   CASE. Note: `enforceCountryRestriction` fails open on error — converge
   only after that is fixed or explicitly accepted.
4. **One Truth analyst scope** (`withAnalystScope`, 4 hand-called sites).
   Promote to a scope-model accessor returning the `= ANY($N)` predicate
   values; keep the hand-applied call pattern until the metrics registry
   consumes it.
5. **Admin grant-scoped reads** (`requirePermission` grants, region
   rules). Today: global-or-403 (fail closed). The model already surfaces
   `regionRestricted`/`regionIds` informationally; row-level region scoping
   does not exist as a mechanism — building it is a product + security
   decision, not a refactor. Until then, consumers must keep fail-closed.
6. **The long tail: ~470 inline `business_id = $N` filters.** Mechanical
   only after 1-5: replace with a `scopeFilter('business', scope)` helper
   that renders the `IN`/`= ANY` predicate from a resolved scope. This is
   where the 4-8 week estimate lives; it should be done controller by
   controller with the parity-test pattern, ideally driven by which
   endpoints the metrics registry (Item 7) actually needs.

Deliberately out of scope for convergence (different semantics, keep
separate): `statementArchive` wallet-standing, media actor verification,
`isRestaurantOwner`-style boolean checks that predate the CASE.
| 2026-10-18 | Item 7/1: open_disputes canonical on the disputes table (not a job flag), because the Dashboard card drills to /admin/disputes whose default tab reads that table — drill parity decides the definition | Track B |
| 2026-10-18 | Item 7/8 (partial): `'1y' = '1 year'` is the canonical period; the registry owns the map. investorController still on `'365 days'` until metric 4/8 migration | Track B |
| 2026-10-18 | Item 7/2+4: investor take-rate fixed (subscriptions excluded from numerator). Investor GMV stays SUM(budget_max) — budgets not actuals — kept as a documented known limitation, NOT silently redefined on investor surfaces | Track B |
| 2026-10-18 | Item 7/8 (done): investorController `'365 days'` normalized to registry `'1y' = '1 year'` | Track B |
| 2026-10-18 | Item 9: migration numbered **890** — 889 was taken by the parallel track's `889_campaign_analytics_events.sql`; checked `server/migrations/` before numbering | Track B |
| 2026-10-18 | Item 9: alert rules evaluate **platform-wide** for every admin — the registry's canonical definitions have no per-admin dimension, so `scopeModel.js` has nothing to scope a platform admin's rule to. Per-admin/per-business scoping is a follow-up, not a silent guess | Track B |
| 2026-10-18 | Item 9: `sendNotification` gained an additive `emailChannel` option (default true, no behavior change for existing callers) so the evaluator can enforce `admin_notification_prefs.email_notifications` without forking the delivery path | Track B |
| 2026-10-18 | Item 9: editing a rule resets `last_fired_at` — the old rule's cooldown must not suppress the new condition | Track B |
| 2026-10-18 | Item 9: only 8 of 11 registry metrics are alertable (`investor_gmv_cents`, `consulting_cancel_rate_pct`, `sla_first_response_compliance_pct` have no compute function). Rules for them are rejected with 400 rather than computed ad-hoc — the registry stays the single definition | Track B |
| 2026-10-18 | Item 8: cancel-rate drill reconciliation — `deleted_at IS NULL` added to the super/admin dashboard jobs stats AND the admin jobs list (`getJobs`), not just the drill filter. A drill-side-only fix would have left the dashboard cards disagreeing with their own drill targets for soft-deleted jobs; aligning all three to the registry canonical (migration 170 MVs) keeps every `/admin/jobs?status=` deep link parity-safe. Side effect: soft-deleted jobs no longer appear in the admin jobs list. | Track A |
| 2026-10-18 | Item 8: drill links NOT shipped where parity is unprovable (revenue, SLA compliance, both NPS metrics, investor GMV/take-rate, MRR, escrow_held) — documented in "Item 8 — Skipped metrics" with exact blockers instead of linking numbers that disagree. | Track A |
| 2026-10-18 | Item 10: "campaign" = the business's featured-placement request (`business_featured_placement_requests.id` as `campaign_analytics_events.campaign_id`). Promo codes were rejected: `business_promo_codes` are managed but never redeemed in code (no conversion seam). Broadcasts have no open/click tracking. Featured placement is the only funnel with real impression (search render) / click (card tap) / conversion (order) seams. | Track C |
| 2026-10-18 | Item 10: repeat-order window fixed at 90 days (documented in `server/analytics/restaurantAnalytics.js` docstring, endpoint `window_days`, UI hint). Guest orders (`customer_id IS NULL`) excluded from numerator AND denominator; rate is NULL (not 0) with no attributable orders. Cancelled/refunded orders excluded, mirroring the sales report. | Track C |
| 2026-10-18 | Item 10: conversion = campaign-window attribution (order placed while the placement is live), NOT proven click-through causality. No cross-session click→order stitching exists; the PromotePage block labels it via `windowNote` and the module docstring. CTR = clicks/impressions; CVR = conversions/clicks; NULL on zero denominators (not 0%). | Track C |
| 2026-10-18 | Item 10: performance view lives on the business-owner surface (PromotePage, `GET /api/businesses/:businessId/campaign-performance`, manager role, business-scoped) — the business owns the campaign. No new admin route, so no `adminSpaRoutes.js` change. The admin approve/review flow (`adminFeaturedPlacement`) is untouched. | Track C |
| 2026-10-18 | Item 10: impressions are server-side only (`listRestaurants` emits one event per effectively-featured row in the response). Click beacons cover FoodHomePage `RestaurantCard` grid/section cards; map pins and the suggestion-dropdown jump are known gaps (no click tracking there in this pass). | Track C |
| 2026-10-18 | Item 10: all instrumentation is fire-and-forget — the emitter never rejects and call sites never await (same pattern as `emitRestaurantOrder`). `trackCampaignClick` answers 204 before emitting. No ordering, payment, or campaign execution paths were modified. | Track C |
