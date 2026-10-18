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
| 6 | Area 4 scope model + one domain pilot | pending | Longest pole (4-8 weeks) |
| 7 | Area 1 metrics registry v1; reconcile 8 divergences; SLA dashboard to `support_sla_targets`; remove hardcoded zeros | in progress (Track B) | Registry v1 at `server/analytics/metricsRegistry.js`. Per-metric status below. |

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
| 5 | SLA dashboard → `support_sla_targets` | pending | |
| 6 | NPS canonical source | pending | |
| 7 | MRR / escrow_held | pending | |
| 8 | Periods drift | done | Canonical `PERIOD_INTERVAL` (`'1y' = '1 year'`) in the registry; superAdminController and investorController both reference it (investor was `'365 days'`). |

## Decisions log

| Date | Decision | By |
|------|----------|----|
| 2026-10-18 | SCOPE.md moved into repo at `docs/analytics-platform/`; this log created | Atlas |
| 2026-10-18 | QW2/QW4 conflict: business analytics tab removed (was rendering $NaN/zeros), not launched; dead launch flag cleaned up; rebuild deferred to metrics layer (Phase 2) | Coordinator |
| 2026-10-18 | Item 7/1: open_disputes canonical on the disputes table (not a job flag), because the Dashboard card drills to /admin/disputes whose default tab reads that table — drill parity decides the definition | Track B |
| 2026-10-18 | Item 7/8 (partial): `'1y' = '1 year'` is the canonical period; the registry owns the map. investorController still on `'365 days'` until metric 4/8 migration | Track B |
| 2026-10-18 | Item 7/2+4: investor take-rate fixed (subscriptions excluded from numerator). Investor GMV stays SUM(budget_max) — budgets not actuals — kept as a documented known limitation, NOT silently redefined on investor surfaces | Track B |
| 2026-10-18 | Item 7/8 (done): investorController `'365 days'` normalized to registry `'1y' = '1 year'` | Track B |
