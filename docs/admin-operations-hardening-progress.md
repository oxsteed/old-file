# Admin and Operations Hardening Progress

This document records the current implementation evidence for the long-term
admin and operations hardening goal. It is intentionally based on the current
worktree and commands actually run; production is not considered upgraded until
the release is pushed, deployed, and passes the live readiness checks.

## Completed in the current worktree

- Centralized admin route definitions and aligned client navigation with the
  registered React routes.
- Extended the route manifest to cover every concrete AdminApp route, including
  support, legal, consulting, and logistics sub-workspaces. AdminApp now has a
  CI contract forbidding unregistered concrete paths and duplicate manifest
  destinations; the previous duplicate support-chat registration was removed.
- Added grant-aware navigation and direct-navigation guards for protected admin
  pages.
- Added the read-only operations overview covering delivery, jobs, orders,
  support, payments, disputes, queues, integrations, Credit, SLA, risk, data
  governance, change control, observability, and CRM.
- Made regional permission grants fail closed for platform-wide delegated admin
  actions. Regional access requires an explicit record-region-aware endpoint.
- Added bounded pagination to the newer and older admin/logistics list paths,
  including admin search, user activity, regional users, logistics suppliers and
  quotes, procurement programs, warehouse receipts, and mode approvals.
- Added secure, non-cacheable, rate-limited admin CSV export behavior and
  spreadsheet-formula neutralization.
- Added additive control-plane schema metadata and production readiness checks
  for settings and audit columns.
- Added transactional settings/feature-flag rollback and audit coverage,
  report-review locking/rollback behavior, and support audit schema compatibility.
- Added shared confirmation-dialog Escape handling, focus trapping, and focus
  restoration.
- Fixed admin dispute review to refresh the authoritative query after mutation
  instead of calling a nonexistent local state setter.
- Added shared locale-aware admin date, date-time, and money formatters and
  applied them to search, users, and dispute surfaces.
- Repaired the admin jobs delete modal by declaring its missing state and
  localized its high-risk controls and status labels across all five locales.
- Localized the admin content-reports queue, including status tabs, moderation
  actions, failure states, timestamps, and empty states across all five
  locales.
- Localized the admin dispute list and resolution workflow, including
  evidence, deadlines, resolution choices, irreversible-action warnings, and
  validation messages across all five locales.
- Added transactional notification intent writes for profile chat, booking,
  quote, agreement, proof-of-payment, support, and admin message paths so a
  committed message cannot silently lose its durable outbox row.
- Added migration 592 lease fencing for message and support-email outbox
  workers, preventing stale workers from overwriting a later retry.
- Hardened migration-runner cleanup and checksum/state handling, including
  advisory locking and explicit reconciliation for interrupted migrations.
- Moved admin dispute routes ahead of the generic dispute-id route and added a
  regression test so `/admin/all` and admin actions cannot be misclassified as
  customer dispute lookups.
- Made token revocation fail closed when its backing store is unavailable;
  authentication returns a retryable 503, and password changes, account
  deletion, and logout no longer claim success when revocation did not finish.
- Added stable Stripe idempotency keys for payment capture and an idempotent
  already-captured response for safe client retries.
- Made business conversation claim, release, and reassignment changes lock the
  conversation and write the audit record in the same transaction.
- Added accessible labels to newly audited icon-only affiliate, support, and
  admin controls.
- Added a CI contract test for the high-risk Users, Template Management, and
  Support controls so modal translations and icon-only labels cannot regress.
- Localized the remaining Template Management grant, revoke, filter, table,
  and statistics controls across all five supported locales.
- Added migration 593 and end-to-end QR checkout idempotency: public checkout
  requests now require a stable request key, Stripe receives the same key on
  retries, and completed checkout sessions replay from the durable record.
- Added migration 594 database-level delivery state integrity. Terminal
  deliveries cannot be resurrected, completion and return require verified
  proof, internal and marketplace ownership cannot coexist, and invalid state
  jumps are rejected while explicit recovery transitions remain supported.
- Added migration 595 database-level food-order terminal integrity. Completed
  and cancelled orders cannot be reopened, refunded orders and refunded
  payments cannot be reversed, and legitimate refund transitions remain
  available.
- Added migration 596 durable marketplace refund reconciliation. Customer and
  admin refunds now share one idempotent service, cumulative partial refunds
  cannot be recorded as full refunds, provider identity and amount are
  verified before settlement, and a locked five-minute worker retries pending
  provider results without creating a second refund.
- Added migration 598 durable external refund reconciliation for restaurant
  support and consulting payments. These rails now retain provider attempts,
  stable idempotency keys, exact provider verification, and retryable pending
  results without introducing a second financial ledger.
- Added migration 599 database-level consulting-payment terminal integrity:
  refunded payments cannot be reopened, and completed payments can only remain
  completed or transition through the approved refund path.
- Added visibility-aware 30-second refresh to the read-only operations command
  center. Hidden tabs stop polling, and returning to the tab reloads
  authoritative server state.
- Made the Users admin page URL-authoritative for search, role, status, plan,
  location, pagination, page size, and sort order so deep links and
  back/forward navigation preserve the exact operator view.
- Localized the Users admin page’s account, password, status, bulk-action,
  filter, table, pagination, and message controls across all five supported
  locales, with accessibility contracts covering the high-risk controls.
- Localized the support agent roster and performance analytics surfaces across
  all five supported locales, and added accessible names for roster actions,
  search, refresh, profile, and performance controls.
- Localized the logistics operations dashboard and shipment-operations
  workspace across all five supported locales, including navigation labels,
  status projections, warehouse tables, shipment KPIs, localized dates, and
  empty/loading states; added a CI contract for this surface.
- Localized the logistics quotes-management and shipment-management surfaces
  across all five supported locales, including review decisions, milestone and
  document workflows, status projections, localized dates, loading/error/empty
  states, and operator feedback; extended the logistics localization contract
  to cover both pages.

## Verification evidence

The following passed against the current worktree on 2026-09-29:

- Server Jest suite: 259 suites passed; 2,087 tests passed; 37 skipped when
  excluding the existing 60-request rate-limit timing test from the aggregate
  run. The aggregate was verified with a 30-second per-test timeout to avoid
  suite-load timing noise; the remembered-MFA test also passes independently.
- Client `npm run build:ci`: passed, including QR-logo, admin-dispute,
  admin-dispute-resolution, admin-jobs, and admin-reports regression coverage,
  i18n verification, typecheck, production build, and 680 emitted-asset
  verification.
- The latest client build also passed the support-agent and logistics
  localization/accessibility contracts after the current tranches; the legacy
  catalog now contains 19,686 keys consistently across English, Spanish, French, Haitian
  Creole, and Arabic.
- Client regression suite: 187 tests passed, including the admin accessibility
  contract.
- Client browser checks: admin Operations and QR Generator checks passed in
  Chrome, including logo processing, export, save, grant-aware rendering, and
  unavailable-section recovery.
- Client admin route-contract tests: passed.
- Users URL-filter route-contract tests: passed for all supported filter and
  pagination parameters.
- Users localization and accessibility contracts: passed across the five
  supported locales.
- Operations command-center route contract: passed, including visibility-aware
  refresh cleanup and the existing permission/link checks.
- Client admin Operations browser test: passed in Chrome.
- Focused admin permission, operations, order-list, support-route, readiness,
  audit-export, pagination, and region-scope tests: passed.
- Client Operations browser regression: passed in Chrome, including grant-aware
  rendering, unavailable-section recovery, and correlation references.
- Admin dispute-review regression and client typecheck: passed.
- `git diff --check` and modified-server-file syntax checks: passed.
- Focused token-revocation, dispute-route, and QR payment tests: passed (30
  tests). The broader payment, authentication, admin-authentication, and
  support-route focused checks also passed in the preceding verification run.
- Delivery state migration and dispatch/recovery tests: passed (71 tests).
- Food-order terminal integrity migration contract tests: passed.
- Consulting-payment terminal integrity migration contract tests: passed.
- Fresh PostgreSQL/PostGIS migration rehearsal: passed all 599 migration files
  from an empty database, including migrations 591 through 599; the disposable
  rehearsal database was removed after verification.
- Marketplace refund reconciliation tests: passed, including stable request
  keys, partial-refund settlement, provider verification, and migration
  contract checks. The marketplace refund worker and background-worker
  bootstrap tests also passed.
- Marketplace refund requests now fail closed without an `Idempotency-Key`;
  the admin order-refund UI generates a stable intent key and clears it only
  after success, with a client contract regression test.
- General Tier-3 payment refunds now use migration 597 durable refund
  attempts, cumulative partial-refund accounting, provider verification,
  idempotent admin requests, and a five-minute reconciliation worker. Focused
  payment-refund and worker tests pass.
- Manual job refunds and dispute-resolution refunds now use the same durable
  payment-refund service. Restaurant-support and consulting refunds use the
  external-refund attempt service with provider reconciliation and stable
  request IDs; focused external-refund tests pass.
- QR payment route tests: passed (26 tests), including missing-key rejection,
  replay behavior, and disconnected-account recovery.
- Client `npm run verify:i18n` and `npm run typecheck`: passed after the latest
  Template Management localization changes.
- Logistics admin localization contract: passed for all five locale catalogs;
  current legacy catalog count is 19,686 keys per locale, covering the
  dashboard, shipment operations, quotes management, and shipments management
  pages.

## Required before completion

- Localize and accessibility-audit the remaining admin and operational page
  inventory, including the logistics and remaining support workspaces, in
  English, Spanish, French, Haitian Creole, and Arabic with RTL and theme
  verification. The support agent roster and performance analytics are now
  covered, but the wider inventory is not yet complete. The logistics dashboard,
  shipment-operations, quotes-management, and shipments-management workspaces
  are now covered.
- Complete payment/refund and external-provider retry reconciliation coverage,
  including provider outage recovery and webhook replay assertions. Marketplace,
  job, dispute, restaurant-support, and consulting refund attempts now have
  durable retry/reconciliation paths; provider-outage and webhook-replay
  assertions across every rail remain open.
- Extend database-level transition enforcement beyond delivery, food orders,
  and consulting payments to the remaining critical workflow state machines
  where application-only guards still permit bypasses.
- Add browser coverage for every admin role and the high-risk workflows, not only
  the Operations overview.
- Verify the production schema contract from the current migration marker
  without touching production data; the fresh-database rehearsal is complete,
  but a production-like marker rehearsal still depends on a safe staging
  snapshot or CI database.
- Verify every operations card against a deployed route and authoritative live
  data source, including unavailable/degraded states and correlation IDs.
- Run deployment verification after push: `/ready`, `/health`, worker health,
  queue age, failed deliveries, external sync status, and the production smoke
  matrix.
- Push and deploy only after the above evidence is collected and reviewed.
