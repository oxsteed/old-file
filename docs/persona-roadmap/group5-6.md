# Groups 5-6: Business owner (201-250) and Business team member (251-300) — tracker

Branch `feat/persona-group4-rest` (PR #809; Emile 2026-11-23: all batches go on
this branch while #809 is open). Backlog: `/workspace/persona-backlog-1000.md`
lines 333-495 (titles only). Emile 2026-11-23 (t316): do not ask; follow
industry standards (Housecall Pro, Jobber, Square, Gusto, Thumbtack); record each
choice as a numbered decision (D-2xx) in `persona-roadmap-decisions.md`.

Persona labels grant nothing: every route resolves the live business, membership,
role and permission on the server (`requireBusinessAccess` + `requirePermission`
or owner checks inside the service). The unit of team work is
`business_appointments` (staff_id = assignee); team tasks are `business_team_tasks`.

## Status legend
EXISTS = verified at `28196a8a8` (evidence cited). PARTIAL = gap named.
BUILD = to build. DONE = built on this branch (commit/test cited).

## Slices (build order)
- S1 Launch readiness: 203, 204, 205 (computed, read-only) + 201 listing claim.
- S2 Offerings: 207 regional rules, 210 service pause (enforced on booking).
- S3 Owner oversight: 217 open assignments, 218 heatmap, 220 handoff timeline, 222 repeat records, 225 service issue review.
- S4 Policies: 226 approval thresholds, 227 work authorization, 228 cancellation defaults.
- S5 Finance: 231 invoice overview, 232 refund tracker, 233 payout reconciliation, 234 expense categories.
- S6 Expansion: 236-240 locations, checklist, territory, capacity, seasonal forecast.
- S7 Continuity: 241-245 ownership transfer, deputy, open work transition, departed access, closure checklist.
- S8 Performance: 246-250 reports.
- S9 Member start/dispatch: 252, 254, 255, 256-258, 260.
- S10 Member jobs/crews: 261, 262, 264, 265, 266-270.
- S11 Member comms/schedule: 273-275, 277, 280.
- S12 Outcomes/blockers: 281-290.
- S13 Continuity/leave: 291-300.

## Tracker

| # | Item | Status at 28196a8a8 | Evidence / gap | Branch status |
|---|---|---|---|---|
| 201 | Business claim | BUILD | `prospect_businesses` listings exist, no claim path | DONE (D-194; migration 20261123190000, listingClaimService, /api/business-listing-claims + admin review; group56Launch.db.test.js) |
| 202 | Ownership application | EXISTS | `access_requests` capability `business.own` (`services/access/*`, `businessGate.js`), linked launch intake (migration 20261116162100) | - |
| 203 | Launch status page | BUILD | `setup_status`/`published_at`/`is_hidden_by_admin` exist, no owner-facing status | DONE (D-196; launchService.readiness, GET /owner/launch-readiness, BusinessLaunchConsole; group56Launch.db.test.js) |
| 204 | Business verification checklist | BUILD | no computed checklist | DONE (D-196; as 203) |
| 205 | Service publication checklist | BUILD | no per-service readiness | DONE (D-196; as 203) |
| 206 | Service catalog editor | EXISTS | `businesses.js` services CRUD + `BusinessServicesTab.jsx` | - |
| 207 | Regional offering rules | BUILD | only `service_radius_miles` | DONE (D-197; migration 20261123190100, PUT /owner/services/:id/regions, booking guard; group56Launch.db.test.js) |
| 208 | Standard quote terms | EXISTS | thirty-feature-delivery.md | - |
| 209 | Business pricing templates | EXISTS | thirty-feature-delivery.md | - |
| 210 | Service pause controls | PARTIAL | `is_active` only (no pause reason/resume date) | DONE (D-198; POST /owner/services/:id/pause|resume, booking guard, public list filter; group56Launch.db.test.js) |
| 211 | Invitation dashboard | EXISTS | `GET /:id/members` pending + resend/expire (`BusinessHubPage.jsx` team tab) | - |
| 212-215 | Role templates / preview / expiry / offboarding | EXISTS | thirty-feature-delivery.md | - |
| 216 | Operations board | EXISTS | `GET /:id/operations-summary`, `BusinessOperationsOverview.jsx` | - |
| 217 | Open assignment view | BUILD | | DONE (D-199..D-201; migration 20261123190200, oversightService, /owner/* routes, OwnerOversight, MyBusinessVisits; group56Oversight.db.test.js) |
| 218 | Schedule heatmap | BUILD | | DONE (D-199..D-201; migration 20261123190200, oversightService, /owner/* routes, OwnerOversight, MyBusinessVisits; group56Oversight.db.test.js) |
| 219 | Overdue task alerts | EXISTS | thirty-feature-delivery.md | - |
| 220 | Business handoff timeline | BUILD | `business_audit_log` exists, no timeline | DONE (D-199..D-201; migration 20261123190200, oversightService, /owner/* routes, OwnerOversight, MyBusinessVisits; group56Oversight.db.test.js) |
| 221 | Scoped customer directory | EXISTS | `businessCustomer360.js` | - |
| 222 | Repeat service records | BUILD | | DONE (D-199..D-201; migration 20261123190200, oversightService, /owner/* routes, OwnerOversight, MyBusinessVisits; group56Oversight.db.test.js) |
| 223 | Shared business inbox | EXISTS | `businessOperations.js` messages claim/release/reassign | - |
| 224 | Follow-up reminders | EXISTS | thirty-feature-delivery.md | - |
| 225 | Service issue review | BUILD | | DONE (D-199..D-201; migration 20261123190200, oversightService, /owner/* routes, OwnerOversight, MyBusinessVisits; group56Oversight.db.test.js) |
| 226 | Approval thresholds | BUILD | | DONE (D-202..D-204; migration 20261123190300, policyService + guards in quote send / expense create / refund request / appointment status / late-cancel fee, OwnerPolicies; group56Policies.db.test.js) |
| 227 | Work authorization policy | BUILD | | DONE (D-202..D-204; migration 20261123190300, policyService + guards in quote send / expense create / refund request / appointment status / late-cancel fee, OwnerPolicies; group56Policies.db.test.js) |
| 228 | Cancellation settings | PARTIAL | per-service `cancellation_policy_hours/fee_percent`; no business default | DONE (D-202..D-204; migration 20261123190300, policyService + guards in quote send / expense create / refund request / appointment status / late-cancel fee, OwnerPolicies; group56Policies.db.test.js) |
| 229, 230 | Onboarding guide / policy acks | EXISTS | thirty-feature-delivery.md | - |
| 231 | Invoice overview | PARTIAL | invoice list only; no aging overview | DONE (D-205..D-208; migration 20261123190400, financeService, /owner/{invoice-overview,refund-tracker,payout-reconciliation,payout-deposits,expense-categories}, OwnerFinance + ExpenseTracker custom category; group56Finance.db.test.js) |
| 232 | Refund request tracker | PARTIAL | per-job refund requests (`businessFinance.js`); no business-wide tracker | DONE (D-205..D-208; migration 20261123190400, financeService, /owner/{invoice-overview,refund-tracker,payout-reconciliation,payout-deposits,expense-categories}, OwnerFinance + ExpenseTracker custom category; group56Finance.db.test.js) |
| 233 | Payout reconciliation | BUILD | | DONE (D-205..D-208; migration 20261123190400, financeService, /owner/{invoice-overview,refund-tracker,payout-reconciliation,payout-deposits,expense-categories}, OwnerFinance + ExpenseTracker custom category; group56Finance.db.test.js) |
| 234 | Business expense categories | PARTIAL | free-text `business_expenses.category` | DONE (D-205..D-208; migration 20261123190400, financeService, /owner/{invoice-overview,refund-tracker,payout-reconciliation,payout-deposits,expense-categories}, OwnerFinance + ExpenseTracker custom category; group56Finance.db.test.js) |
| 235 | Delegated statement access | EXISTS | D-22 `statements.view` override | - |
| 236-240 | Locations / checklist / territory / capacity / seasonal forecast | BUILD | | - |
| 241-245 | Transfer / deputy / open work / departed access / closure | BUILD | | - |
| 246-250 | Performance reports | BUILD | | - |
| 251 | Invitation acceptance | EXISTS | `POST /businesses/invitations/:id/accept` | - |
| 252 | Responsibility overview | BUILD | | - |
| 253 | Assigned workspace picker | EXISTS | `meWorkspace.js` `/businesses` + workspace-context | - |
| 254 | Shift onboarding checklist | BUILD | | - |
| 255 | Permission help request | BUILD | | - |
| 256-258 | Assignment queue / availability matching / conflict warnings | BUILD | | - |
| 259 | Provider transfer | EXISTS | `PUT /appointments/:id/staff` (notifies `appointment_staff_reassigned`) | - |
| 260 | Dispatch confirmation | BUILD | | - |
| 261, 262, 264, 265 | Work board / checklist / progress / exception routing | BUILD | | - |
| 263 | Customer note handoff | EXISTS | appointment notes (`POST /appointments/:id/notes`) | - |
| 266-270 | Crews | BUILD | | - |
| 271 | Scoped customer messages | EXISTS | shared inbox claim/assignment | - |
| 272 | Internal job notes | EXISTS | appointment notes `note_type='internal'` | - |
| 273-275 | Handoff summary / mentions / unread inbox | BUILD | | - |
| 276 | Shift calendar | EXISTS | `businessStaff.js` shifts (any role) | - |
| 277 | Coverage request | BUILD | | - |
| 278 | Shift swap approval | EXISTS | `businessStaff.js` shift-swaps respond/approve | - |
| 279 | Schedule change notice | EXISTS | shifts publish notifies; `schedule-changes` | - |
| 280 | Daily workload view | BUILD | | - |
| 281-290 | Outcomes / blockers | BUILD | | - |
| 291-300 | Continuity / leave a scope | BUILD | | - |

## Running tests
```
/workspace/pgbin/env/bin/pg_ctl -D /workspace/pgdata -o "-k /workspace/pgsock -p 5432 -c listen_addresses=127.0.0.1" -l /workspace/pgdata.log start
createdb -h 127.0.0.1 -U oxsteed g56   # then: cd server && DATABASE_URL=postgresql://oxsteed@127.0.0.1:5432/g56?sslmode=disable NODE_ENV=test npm run migrate
ACCESS_TEST_DATABASE_URL=postgresql://oxsteed@127.0.0.1:5432/g56?sslmode=disable npx jest --runInBand __tests__/group56
cd ../client && npm run build:ci
```
(symlink node_modules from /workspace/old-file/{client,server}; remove before committing)

## Conventions
- Server: `server/routes/businessOwnerConsole.js` (mounted at `/api/businesses`, owner paths `/:businessId/owner/*`, member paths `/:businessId/work/*`), services in `server/services/businessOwner/*`, shared helpers + `notify()` in `common.js`.
- Notifications: add types to `server/utils/businessTeamNotificationTemplates.js`, then run `python3 docs/persona-roadmap/tools/group56-sync.py .` (regenerates the catalog block, the toggles-test variable site, and the `bizG56` locale block from `docs/persona-roadmap/group5-6-copy.json`). The `bizG56` block must stay last in each locale file.
- Client: `client/src/components/businessHub/g56/*` (shared hook `useBizG56`), tabs `owner-console` and `my-work` in `BusinessHubPage.jsx`; run `node client/scripts/growthInstrumentation.mjs --write` after UI edits.
- Tests: `server/__tests__/group56*.db.test.js`; also `STATEMENT_TEST_DATABASE_URL=.../credit_statement_test npx jest __tests__/notificationsPrefsToggles`.

## Next step
S6: expansion (236-240 locations, checklist, territory, capacity, seasonal forecast).
