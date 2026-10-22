# Thirty follow-up fixes - 2026-10-22

This batch implements the 30 candidates approved in chat. It continues the restaurant/franchise review on the current default branch after PR #618 merged. It does not complete the broader review or authorize deployment.

| # | Implemented behavior | Main regression evidence |
|---|---|---|
| 1 | CRM audience parameters start after the restaurant ID. | PostgreSQL audience thresholds and store counts |
| 2 | Numeric wire inputs reject booleans, arrays, objects, exponents and unsafe integers. | Shared validation cases and gift-card/marketplace suites |
| 3 | CRM, gift-card and marketplace IDs require complete decimal integers. | Malformed route IDs fail before access resolution |
| 4 | Gift-card catalog reports the existing internal-ledger issuance capability. External e-gift delivery still reports provider unavailable. | Capability response test |
| 5 | Every CRM response uses the same delivery activation gate. | Default-off capability tests |
| 6 | Storage-area counts, critical counts and count timestamps use assigned stores. | Two-store PostgreSQL aggregate test |
| 7 | Supplier stock and issue counts use assigned stores. | Two-store PostgreSQL aggregate test |
| 8 | Cash-tip declarations reject nonexistent dates and year zero. | Invalid calendar-date cases |
| 9 | Activity date-only ranges use restaurant-local midnight and next-day exclusive bounds. | PostgreSQL 23-hour DST-day test |
| 10 | Tip settings reads require payroll.view; tip mutations require payroll.manage. | View-only mutation denial cases |
| 11 | Labor-policy mutations require payroll.manage and all-store access. | View-only mutation denial case |
| 12 | Exception reports require audit.view. | Manager without catalog grant denied |
| 13 | Payroll/audit views honor custom-role grants without an owner/manager pre-gate. | Employee/custom-role read cases |
| 14 | Waitlist listing has bounded pagination, status filtering and hasMore. | PostgreSQL filtered page and sibling-store denial |
| 15 | Floor-plan positions accept only finite x/y percentages between 0 and 100. | Invalid objects, fields and coordinates rejected |
| 16 | Host-stand SMS supports en, es, fr, ht and ar, with English fallback. | Both message types exercised in five languages |
| 17 | Transient campaign delivery failures return to pending with 15-minute backoff and at most five attempts. | PostgreSQL backoff, no immediate reclaim and terminal bound |
| 18 | Expired campaign leases recover below the attempt bound; exhausted leases become terminal. | PostgreSQL lease recovery and exhaustion |
| 19 | Gift-card catalog and ledger mutations audit through their transaction client. | Injected audit errors cause rollback for catalog, issue, redeem and refund |
| 20 | CRM segment and campaign mutations audit through their transaction client. | Injected audit errors cause rollback for segment/create/approve/queue |
| 21 | Marketplace mutations audit through their transaction client; transition before-state is row-locked. Integration updates serialize by restaurant/provider. | Audit-failure rollback and before-state lock test |
| 22 | Payroll inputs and exports use assigned stores. Store wages retain person-wide weekly overtime thresholds. | PostgreSQL hours, schedules, tips, revenue, roster, export and cross-store overtime |
| 23 | Activity rows and actor lists use the same assigned-store predicate. Unresolved legacy events stay all-store only. | PostgreSQL sibling/unknown-store event and actor isolation |
| 24 | Hosting location resolution and table changes enforce store access, retaining the already-merged reservation/waitlist mutation guards. | PostgreSQL sibling-store list denial and controller mutation guards |
| 25 | Reservation retries compare store and normalized payload; same-key creates serialize, including public requests. | Conflicting store retry test |
| 26 | Reservation party changes validate table capacity; table capacity reductions check active reservations. | PostgreSQL party increase and controller capacity guard |
| 27 | Reservation status transitions are explicit; terminal reservations cannot reopen. Active reservations always check conflicts. | Closed-state reactivation denial |
| 28 | Reservation creation, rescheduling and table edits lock the parent table before reservation mutation. | PostgreSQL concurrent create/create and create/reschedule conflicts |
| 29 | Waitlist SMS claims use expiring tokens, token-fenced acknowledgement, failure cleanup and acknowledged-send replay. | PostgreSQL concurrent sends and already-notified replay |
| 30 | Assigned users can preview only explicitly authorized local CRM segments; global lifetime-point segments and brand campaign management require all-store access. | PostgreSQL local audience counts and controller brand-scope denial |

## Operational boundaries

Migration `994_restaurant_payroll_hosting_scope.sql` adds nullable store identity to schedules, time entries and cash-tip declarations, waitlist notification claim columns, indexes, tenant/business attribution guards, and the explicit `payroll.manage` catalog permission. Existing view grants do not become management grants. Owners retain the catalog's implicit permissions.

Payroll backfill assigns historical rows only when the business/restaurant has exactly one possible store. Ambiguous records remain unassigned and are excluded from assigned-store reports. Scheduling and punch writers accept optional `locationId`/`location_id`, validate business/store access, and persist the attribution. Brand settings remain all-store operations.

Campaign dispatch remains disabled unless `RESTAURANT_LOYALTY_DELIVERY_ENABLED=true`. This batch does not install or activate a campaign scheduler. The reporting flag describes that explicit gate. Approval is still required before queueing. Internal gift-card issuance already existed; correcting its response flag does not configure an external provider.

Notification claims prevent concurrent sends and expire after five minutes. Provider calls and database acknowledgement are not a single distributed transaction; a crash after provider acceptance can still require reconciliation. No live SMS, email, stored-value operation, production migration or deployment was performed.

## Verification

- Focused controller/service/permission/inventory regressions and the explicit disposable PostgreSQL suite: see the current verification entry in `IMPLEMENTATION.md`.
- The PostgreSQL suite uses a random schema in a loopback-only `franchise_scope_test` database and removes its schema afterward. CI creates a separate database and runs it explicitly, so these cases are not silently skipped in CI.
- Full migration rehearsal: **969/969 migrations applied and replayed successfully**, including migration 994, in a disposable Colima container.
- Client source was not changed. No browser build or live provider acceptance is claimed.

Final focused run: **180 tests passed across 18 suites**, including **14 PostgreSQL cases**. The expected rollback/error-path logs are covered passing tests.

```sh
FRANCHISE_SCOPE_TEST_DATABASE_URL=<synthetic-loopback-url> npm --prefix server test -- --testPathPatterns='restaurantThirtyFixes|restaurantHosting|restaurantLoyaltyController|restaurantGiftCardController|restaurantGiftCardService|restaurantLoyaltyCampaignService|restaurantDeliveryMarketplaceService|restaurantInventoryOperations|restaurantInventoryStoreScope|restaurantInventoryController|restaurantInventoryOrderService|restaurantInventoryAvailabilityService|restaurantPayrollOvertime|businessStaffScheduleController|restaurantFranchiseAuditCoverage|restaurantLocationAccess|businessAuditLog|routeScopeGuard'
DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --timeout-ms 600000
```

JavaScript syntax checks, CI YAML parsing/DB-step verification, and `git diff --check` also passed. Remote CI is verified separately on the pull request; local success is not deployment evidence.
