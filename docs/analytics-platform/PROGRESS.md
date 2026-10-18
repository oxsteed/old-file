# Analytics Platform — Progress Log

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
| 8 | Drill-through rollout | pending | Blocked on Area 1 definitions |
| 9 | Threshold alerts v1; wire dead `admin_notification_prefs` toggles | pending | |
| 10 | Embedded gaps (restaurant repeat-order, campaign performance) | pending | |

## Phase 3

| # | Item | Status | Notes |
|---|------|--------|-------|
| 11 | Structured query builder, then NL layer | pending | Blocked on Areas 1+4 |

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
