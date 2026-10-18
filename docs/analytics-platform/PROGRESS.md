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
| 7 | Area 1 metrics registry v1; reconcile 8 divergences; SLA dashboard to `support_sla_targets`; remove hardcoded zeros | pending | Includes live credibility bugs (dispute counts by role, take-rate >100%) |

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

## Decisions log

| Date | Decision | By |
|------|----------|----|
| 2026-10-18 | SCOPE.md moved into repo at `docs/analytics-platform/`; this log created | Atlas |
| 2026-10-18 | QW2/QW4 conflict: business analytics tab removed (was rendering $NaN/zeros), not launched; dead launch flag cleaned up; rebuild deferred to metrics layer (Phase 2) | Coordinator |
