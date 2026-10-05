# Finance and access review, version 2: tabs 35–52

Reviewed 2026-10-03 against HEAD `e47531c76b320c8145e15415774d05d698b456d1`, refreshed after the user's 22:30 UTC update. Scope is the current repository implementation, not production certification. Work was read-only apart from this document; no credentials, live database, provider calls, deployment, migrations, or product changes were used. Applicable guidance: repository `AGENTS.md`, `README.md`, and `RUNBOOK.md`. Paths and one-based lines below refer to this revision. The earlier `docs/admin-super-admin-full-audit-2026-10-02.md` supplied the inventory only; findings were rechecked in present source.

The earlier user-reported green runs, including `37110020289`, are historical. At the refreshed snapshot the user reports CI `37147612778` red on three restaurant-media video tests because `/usr/bin/ffmpeg` is absent, with 359 suites and 3,910 tests passing; main owns that investigation. The user also reports readiness healthy at 661/661 migrations with `gitSHA: null`; this is attributed runtime information, not independently verified deployment identity. Customer360's old mock failure is historical. Current source includes consistent-period dashboard cancellation counts, USD-keyed Money ledger channels, restaurant-wallet currency aggregates, Credit compliance pagination, localization debt gates at `25790585`, and the process-state registry/Redis fencing/two-process tests at `893f1bc3`. Those changes are acknowledged below. Classified bounded local caches are not, by their existence, defects. See `server/utils/processStateRegistry.js:4–16`, `server/utils/processStateRegistry.js:54–67`, and `server/__tests__/processStateTwoProcess.test.js`. Financial worker fencing is already present, for example `server/jobs/payoutSettlementReconciliation.js:28–43`. A synthetic scale harness now exists under `scripts/scale/`; its existence is not evidence that these tab-specific workloads meet their proposed SLOs.

**CONFIRMED DEFECT** means a demonstrable source-contract inconsistency or concrete failure path; it does not imply a live exploit was performed. **DESIGN GAP** means an absent operator capability or control needed for the stated operating model. **UNVERIFIED** identifies runtime, deployment, performance, or organizational evidence unavailable in this read-only review. Suggested endpoints and tests are requirements, not existing features. Existing test files were inspected, not executed. Six million registered users and 3,500 employees are planning populations, not a claim about concurrent traffic; latency targets below are proposed release criteria requiring a separately authorized synthetic environment.

## Coverage table

Route contracts: `client/src/admin/adminRouteManifest.js:109–143`; component mounts are in `client/src/admin/AdminApp.jsx` (the added top-up route is at `:325–326`). API paths below are relative to `/api`.

| Tab | Actual browser route | Current page file | Principal API/controller/service files |
| --- | --- | --- | --- |
| 35 Super Dashboard | `/admin/super/dashboard` | `client/src/admin/pages/super/Dashboard.jsx` | `server/routes/admin.js`; `server/controllers/superAdminController.js` |
| 36 Money | `/admin/super/money` | `client/src/admin/pages/super/MoneyPage.jsx` | `server/routes/admin.js`; `server/controllers/superAdminController.js` |
| 37 Restaurant Credit | `/admin/super/restaurant-credit` | `client/src/admin/pages/super/RestaurantCreditAdmin.jsx` | `server/controllers/restaurantCreditAdminController.js`; `server/services/foodWalletService.js`; `server/services/foodWalletOperationsService.js` |
| Additional Restaurant Top-up Approvals | `/admin/super/restaurant-topups` | `client/src/admin/pages/super/RestaurantTopupApprovals.jsx` | `server/routes/adminRestaurantTopups.js`; `server/controllers/adminRestaurantTopupController.js`; `server/services/restaurantTopupService.js` |
| 38 Credit overview | `/admin/super/oxsteed-credit` | `client/src/admin/pages/super/oxsteedCredit/OverviewPage.jsx` | `server/controllers/oxsteedCreditController.js`; `server/services/oxsteedCreditService.js` |
| 38 Approvals | `/admin/super/oxsteed-credit/approvals` | `client/src/admin/pages/super/oxsteedCredit/ApprovalsPage.jsx` | `server/services/oxsteedCreditPendingActionService.js`; `server/controllers/agentCreditAdjustmentController.js` |
| 38 Disputes | `/admin/super/oxsteed-credit/disputes` | `client/src/admin/pages/super/oxsteedCredit/DisputesPage.jsx` | `server/services/oxsteedCreditDisputeService.js` |
| 38 Settlements | `/admin/super/oxsteed-credit/settlements` | `client/src/admin/pages/super/oxsteedCredit/SettlementsPage.jsx` | `server/services/oxsteedCreditAdminService.js`; `server/services/oxsteedCreditPendingActionService.js` |
| 38 Reconciliation | `/admin/super/oxsteed-credit/reconciliation` | `client/src/admin/pages/super/oxsteedCredit/ReconciliationPage.jsx` | `server/services/oxsteedCreditExternalReconciliation.js` |
| 38 Compliance | `/admin/super/oxsteed-credit/compliance` | `client/src/admin/pages/super/oxsteedCredit/CompliancePage.jsx` | `server/services/complianceCaseService.js` |
| 38 Reserves | `/admin/super/oxsteed-credit/reserves` | `client/src/admin/pages/super/oxsteedCredit/ReservesPage.jsx` | `server/services/oxsteedCreditReserveService.js` |
| 38 Partners | `/admin/super/oxsteed-credit/partners` | `client/src/admin/pages/super/oxsteedCredit/PartnersPage.jsx` | `server/services/oxsteedCreditAdminService.js`; `server/services/oxsteedCreditPartnerLedgerService.js` |
| 38 Health | `/admin/super/oxsteed-credit/health` | `client/src/admin/pages/super/oxsteedCredit/HealthPage.jsx` | `server/services/oxsteedCreditWorkerHeartbeat.js`; `server/services/oxsteedCreditExternalReconciliation.js` |
| 38 Audit | `/admin/super/oxsteed-credit/audit` | `client/src/admin/pages/super/oxsteedCredit/AuditPage.jsx` | `server/controllers/oxsteedCreditController.js`; `server/services/oxsteedCreditAdminService.js` |
| 38 Customers | `/admin/super/oxsteed-credit/customers` | `client/src/admin/pages/super/oxsteedCredit/CustomersPage.jsx` | `client/src/admin/pages/super/OxsteedCreditCustomerDetail.jsx`; `server/services/oxsteedCreditService.js` |
| 38 Money Out | `/admin/super/oxsteed-credit/money-out` | `client/src/admin/pages/super/oxsteedCredit/MoneyOutPage.jsx`; `client/src/admin/pages/super/OxsteedCreditMoneyOut.jsx` | `server/services/oxsteedCreditWithdrawalService.js`; `server/services/oxsteedCreditFeeScheduleService.js` |
| 38 Cards | `/admin/super/oxsteed-credit/cards` | `client/src/admin/pages/super/oxsteedCredit/CardsPage.jsx`; `client/src/admin/pages/super/OxsteedCreditCards.jsx` | `server/controllers/oxsteedCreditCardController.js`; `server/services/oxsteedCreditCardService.js` |
| 38 Ledger | `/admin/super/oxsteed-credit/ledger` | `client/src/admin/pages/super/oxsteedCredit/LedgerPage.jsx` | `server/services/oxsteedCreditService.js`; `server/controllers/oxsteedCreditController.js` |
| 39 Revenue | `/admin/super/revenue` | `client/src/admin/pages/super/Revenue.jsx` | `server/controllers/superAdminController.js` |
| 40 Fee Config | `/admin/super/fees` | `client/src/admin/pages/super/FeeConfig.jsx` | `server/routes/feeConfig.js`; `server/controllers/feeConfigController.js`; `server/utils/feeCalculator.js` |
| 41 Pricing Config | `/admin/super/pricing` | `client/src/admin/pages/super/PricingConfig.jsx` | `server/routes/config.js`; `server/controllers/configController.js` |
| 42 Pricing Overrides | `/admin/super/pricing-overrides` | `client/src/admin/pages/super/PricingOverrides.jsx` | `server/routes/pricingOverrides.js`; `server/controllers/pricingOverrideController.js`; `server/services/pricingService.js` |
| 43 Financials | `/admin/super/financials` | `client/src/admin/pages/super/Financials.jsx` | `server/controllers/superAdminController.js` |
| 44 Payouts | `/admin/super/payouts` | `client/src/admin/pages/super/Payouts.jsx` | `server/controllers/superAdminController.js`; `server/migrations/014_phase4_create_payments.sql` |
| 45 Conversations | `/admin/super/conversations` | `client/src/admin/pages/super/ConversationsAdmin.jsx` | `server/controllers/conversationsAdminController.js`; `server/services/chatThreadAccess.js` |
| 46 Admin Accounts | `/admin/super/admin-accounts` | `client/src/admin/pages/super/AdminAccounts.jsx` | `server/controllers/superAdminController.js`; `server/middleware/adminAuth.js` |
| 47 Permissions | `/admin/super/permissions` | `client/src/admin/pages/super/PermissionGrants.jsx` | `server/controllers/adminPermissionController.js`; `server/middleware/adminAuth.js` |
| 48 Regions | `/admin/super/regions` | `client/src/admin/pages/super/RegionsManager.jsx` | `server/controllers/adminRegionController.js`; `server/middleware/regionAuth.js` |
| 49 Internal Access | `/admin/super/logistics-internal-access` | `client/src/admin/pages/super/LogisticsInternalAccess.jsx` | `server/controllers/logisticsInternalAccessController.js`; `server/middleware/requireInternalLogisticsWorkspace.js` |
| 50 Gate Lockouts | `/admin/super/access-gate-lockouts` | `client/src/admin/pages/super/AccessGateLockouts.jsx` | `server/controllers/logisticsInternalAccessController.js`; `server/services/accessGateRateLimitService.js` |
| 51 Create User | `/admin/super/users/create` | `client/src/admin/pages/super/CreateUser.jsx`; `client/src/components/CreateUserForm.jsx` | `server/controllers/superAdminUserController.js` |
| 52 Search Logs | `/admin/super/search-logs` | `client/src/admin/pages/super/SearchLogs.jsx` | `server/controllers/adminSearchController.js`; `server/utils/encryption.js` |

## 35. Super Dashboard

### Route and business purpose

`/admin/super/dashboard` is headquarters' broad operating summary: user growth, job outcomes, revenue, support demand, activity, and geography. It should tell a director which domain needs investigation, with definitions clear enough to compare regions and periods. It is not a general ledger or evidence that financial providers are healthy.

### Verified current implementation

The four summary/chart/activity/geography APIs require super-admin (`server/routes/admin.js:174–177`). Authentication checks current account activity, role, revocation, and enrolled MFA (`server/middleware/adminAuth.js:43–71`). The controller probes optional schema, counts users, queries jobs, and derives ledger revenue (`server/controllers/superAdminController.js:177–199`, `:233–258`, `:268–284`). The previous mixed-cohort completion-rate defect is fixed: completions and cancellations use the same created-at interval (`:239–240`, `:358–363`). The UI already provides refresh, a last-updated label, error retry, and attention cards (`client/src/admin/pages/super/Dashboard.jsx:280–309`). Those features should be extended, not rebuilt.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT:** failed subqueries become authoritative-looking zeroes. The core user query catches to `{}` at `superAdminController.js:199`; ledger errors are swallowed at `:284`, and support counts default to zero at `:310–317`. The page's green/current indicator follows the overall fetch error at `Dashboard.jsx:287–292`, so a successful degraded response can conceal an unavailable source.
2. **DESIGN GAP:** the corrected completion metric measures jobs created in the period that are currently finished, not all completions that occurred during the period. Its definition remains sensitive to old work finishing later (`superAdminController.js:239–240`). Worldwide operations need separately named creation-cohort conversion and completion-event throughput; this is not the historical denominator bug.
3. **CONFIRMED DEFECT:** revenue aggregation has no currency predicate or grouping (`superAdminController.js:270–276`). Money's later USD-key correction does not apply to this endpoint. A native multi-currency ledger is compressed into the dashboard's currency cards (`Dashboard.jsx:317–348`). Current live currency composition is **UNVERIFIED**.

### Expansion failure scenario

A director reviews seven-day performance while a regional payment feed is delayed. Support-query failure appears as zero backlog, and native currencies increase a revenue total without an exchange-rate policy. Staff divert capacity based on a healthy-looking screen. The corrected job cohort does not prevent these separate interpretation failures.

### Required changes and operator design

Return per-section `status`, `asOf`, `definitionVersion`, and source errors; represent unavailable measurements as null. Add currency-separated revenue and explicit event-time/cohort-time metrics. Connect attention items to Support, Payouts, Revenue, and incident records through stable filters.

#### Operator screen specification

Keep the current responsive card grid, but put period, territory, reporting currency, and refresh status in a sticky header. Each section needs its own timestamp and a definition popover: completion-cohort numerator/denominator, new-user exclusions, revenue source types, and support statuses. Display zero only for a successful empty aggregate. A failed ledger fetch should replace monetary cards with “Revenue source unavailable” and a retry action while user metrics remain usable.

Below the cards, replace count-only attention tiles with a bounded exception table: domain, severity, affected count, oldest age, responsible team, and linked work queue. Filters should include domain and threshold; saved views should include “Shift handover” and “Payment exposure.” Row actions open the authoritative domain with matching scope or create an incident; bulk actions may assign exception ownership, never change underlying payment/job states.

A KPI drawer should show the formula, selected cohort, numerator, denominator, exclusions, comparison period, and drill-down link. A source-error drawer shows a safe failure category and correlation ID. Preserve the last successful value with an explicit stale badge during retry, and prevent a failed period change from relabeling old data as current. On narrow screens, collapse geography/activity before priority exceptions; use logical RTL placement and keyboard-accessible card links. Announce refresh completion without moving focus. No-access should explain the super-admin requirement without exposing counts; an empty attention queue should state which sources were successfully checked and which were not.

### Acceptance tests and owner

Data Platform owns definitions; Operations owns triage. Inject a ledger or support query failure: its section must be unavailable, never zero/current. Add old cancellations to the corrected cohort fixture: seven-day conversion must stay unchanged. Seed USD/CAD rows: two native totals must appear. Exercise period-switch races and keyboard drawer closure. Benchmark bounded dashboard requests on a six-million-user synthetic dataset with a proposed p95 under two seconds, recording query plans and workload impact rather than inferring capacity from CI.

## 36. Money

### Route and business purpose

`/admin/super/money` explains the platform's revenue channels and distinguishes actual revenue, commerce volume, affiliate outflow, and configured franchise economics. Finance and commercial leadership need this distinction before investing in a channel or treating pending sales as cash.

### Verified current implementation

The read API uses `view_financials` (`server/routes/admin.js:260`). The component groups channels by category and suppresses obsolete fetch responses (`client/src/admin/pages/super/MoneyPage.jsx:196–230`). Ledger totals now group by source/currency, and headline ledger sums select USD (`server/controllers/superAdminController.js:1693–1757`). Subscription channel lookup also uses the corrected composite key (`:2068–2071`), covered by `server/__tests__/moneyOverviewT36Repro.test.js:76–99`. Marketplace is explicitly volume-only, affiliates are partner outflow, and franchise is configured economics (`superAdminController.js:2103–2152`); recommending that classification from scratch would ignore existing work.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT:** currency breakdown is calculated internally but not returned. The response at `superAdminController.js:2176–2204` exposes neither `ledgerBySource` nor `reportingCurrency`. Ledger-only USD filtering fixes mixed headline ledger sums, but operators cannot inspect excluded CAD/EUR revenue from this screen.
2. **CONFIRMED DEFECT:** recent ledger movements omit currency from the SQL projection (`:1710–1721`) while the UI formats movement amounts through one cents formatter (`MoneyPage.jsx:500`). Native non-USD rows can therefore appear with the default money presentation even though the headline excludes them.
3. **DESIGN GAP:** period/lifetime slots carry incompatible meanings. API products repeat the current monthly snapshot in both fields (`superAdminController.js:2120–2125`); affiliates repeat the same commission flow (`:2133–2138`); pipeline combines pending consulting, commerce, and franchise commitments (`:2186`). Existing notes help, but these are not comparable earned-period or lifetime amounts.
4. **UNVERIFIED:** consulting's ungrouped sum is added to USD ledger totals (`:1807–1813`, `:2040`). This inspection does not establish that every consulting record is guaranteed USD, or that completed consulting receipts cannot also post to the ledger. Do not assert double counting without verifying those producers.

### Expansion failure scenario

A country leader sees large marketplace volume and a recurring-product snapshot beside tracked revenue, then treats the pipeline as spendable income. Finance cannot explain excluded currencies or reconcile the latest movement's amount. This is a commercial decision risk even with correct ledger-key lookup.

### Required changes and operator design

Extend `/admin/super/money` with native-currency channel rows, typed measurement kinds, coverage status, period boundaries, and source identifiers. Define revenue recognition with Finance; prove disjoint consulting/ledger inclusion. Link snapshots and payables to their owning modules instead of manufacturing a combined accounting balance.

#### Operator screen specification

Retain the existing four channel groups, but make their headers explicit: recognized receipts, transaction volume, partner liabilities, and contracted economics. Put period and native currency selectors above them with “USD only; other currencies excluded” when applicable. Each KPI must display its measurement type and source coverage. Pipeline should expand into three separate amounts with distinct qualification rules, rather than one undifferentiated spending signal.

The channel table needs source, current-period amount, prior comparable amount, count definition, pending amount, refund amount, and completeness. Provide search by channel/source and saved views “Recognized revenue” and “Commercial pipeline.” A row opens a drawer containing source tables, inclusion/exclusion rules, accounting timing, native-currency breakdown, and reconciliation links. Snapshot channels must say “current snapshot,” with no fabricated lifetime comparison. From a channel, allow opening its revenue, affiliate, subscription, or franchise workspace; configuration links should appear only when the caller can use the destination.

Recent movements should include currency, source reference, signed amount, timestamp, and underlying receipt link. Allow a bounded export preview specifying rows, columns, scope, and completeness; no money-moving bulk action belongs here. A failed refresh retains the previous period label and shows “previous successful snapshot,” while a source unavailable state identifies the missing channel independently. Empty channels state “no qualifying records” only after a successful check. On mobile, turn each channel into a labeled card; use RTL-aware source/reference alignment, accessible category badges, and a keyboard drawer. Assign reconciliation discrepancies through the linked financial exception queue, with case status visible on return.

### Acceptance tests and owner

Finance Analytics is accountable with commercial channel owners. Assert CAD ledger rows appear in CAD breakdown but never USD headlines; assert every movement preserves currency. Keep both existing subscription-key tests. Seed a monthly snapshot and verify it cannot display as lifetime revenue. Test consulting inclusion with producer-level fixtures before adopting a recognition rule. Verify pending franchise commitments remain distinct from cash, and read-only finance users receive accurate destination capabilities.

## 37. Restaurant Credit

### Route and business purpose

`/admin/super/restaurant-credit` oversees merchant-specific customer wallets, pending loads, reservations, and account restrictions. Its central invariant is that a customer's balance at one restaurant does not become spendable at another. Operators need receipt-level investigation and safe holds/status decisions without conflating this rail with OxSteed Credit.

### Verified current implementation

All reads/control routes require super-admin; writes now carry the Credit mutation limiter and responses are no-store (`server/routes/admin.js:179–188`). Overview wallets have bounded paging and request/hold counts (`server/controllers/restaurantCreditAdminController.js:216–231`). The backend now returns native currency aggregates (`:300–325`, `:348–351`), fixing the earlier absent API breakdown. Status changes lock the account, prohibit closed-wallet reopening, and make unchanged targets no-ops (`:530–551`). The page has customer/restaurant/status filters, keyboard-selectable rows, detail retry, approval/decline dialogs, and recent activity (`client/src/admin/pages/super/RestaurantCreditAdmin.jsx:552–577`). Existing overview tests are at `server/__tests__/restaurantCreditAdmin.test.js:89–123`.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT:** the new `summary.currencyBreakdown` is not consumed by the current page. The mixed-currency guard and summary cards remain at `RestaurantCreditAdmin.jsx:521–544`; there is no `currencyBreakdown` reference in that component. The backend improvement therefore has not yet supplied finance with a usable screen breakdown.
2. **DESIGN GAP:** history cannot be fully investigated. Detail queries independently cap ledger, holds, requests, transfers, audit, and payments (`restaurantCreditAdminController.js:415–465`); recent requests/activity are further sliced to eight/ten in the UI (`RestaurantCreditAdmin.jsx:576–577`). Wallet list pagination already exists, but it does not paginate these independent histories.
3. **DESIGN GAP:** locks serialize changes without checking the state the operator saw. `updateWalletStatus` accepts desired status and requires a reason only for suspension (`restaurantCreditAdminController.js:516–526`); its update has no expected version (`:548–551`). A stale reactivation can undo a newer investigative suspension.

### Expansion failure scenario

A restaurant group requests an investigation of a receipt from nine months ago. Headquarters can locate the wallet but not navigate to the old entry. Meanwhile a second shift reactivates the same wallet from a stale drawer after Risk has suspended it. Accounting isolation may remain intact while the operator workflow still violates investigation intent.

### Required changes and operator design

Expose the existing currency aggregates, add separate history cursors and reference filters to wallet detail, and require expected status/version on restriction changes. Require a reason for reopening, returning a 409 with refreshed state. Add restaurant-scoped review capabilities if this responsibility is delegated; current global super-admin control is a real boundary, not an implied merchant-scoped workforce model.

#### Operator screen specification

Keep the existing list/detail split. Place restaurant scope, wallet status, customer search, currency, and snapshot time in its header. Replace the ambiguous mixed-total cards with a per-currency liability strip: balance, reserved, available, pending-load amount, and active-hold amount. Clicking a currency applies the list scope; clarify that available is balance less reserved, not money available to headquarters.

Wallet rows should add reserved amount, pending-request count, and oldest active hold beside existing customer/restaurant/balance/status columns. Save views for “Expiring loads” and “Long-lived holds.” The detail panel needs separate Accounts, Ledger, Holds, Loads, Transfers, and Audit tabs, each with its own cursor and reference/date search. Opening an old receipt must keep the restaurant and customer visible; link related POS order and payment evidence.

Status dialogs should preview observed/current state, reason, affected active holds, and the precise wallet identity. Approval previews show original request amount/currency, requester, expiry, funding evidence, and whether reviewer independence is satisfied by the actual service policy. Release previews show what reservation will be released, not promise a refund. Allow row approval/decline/release/suspend/reactivate with server capabilities; initial bulk actions should only assign cases or export scoped history. A 409 refreshes the drawer and preserves the draft reason for reconsideration. Timeout recovery reloads the receipt before offering retry. Empty history should distinguish “no matching entries” from “recent sample exhausted”; no-access and unavailable detail must not show zero balances. Use a full-screen mobile drawer with focus return, logical RTL columns, and textual balance/status labels.

### Acceptance tests and owner

Restaurant Payments owns invariants; Risk Operations owns review decisions. Render two currency aggregates from the existing API. Traverse 10,000 wallet entries to the earliest receipt through bounded requests. Race suspension and stale reactivation: require one success and one 409. Approval replay must create only one wallet effect. Validate restaurant A/B isolation through real service calls, and confirm inaccessible or failed detail loads never retain another account's actionable controls.

## 38. OxSteed Credit, overview and all thirteen subpages

### Route and business purpose

`/admin/super/oxsteed-credit` and its thirteen children form the restricted stored-value control plane. They oversee issuance, customer balances, partner entitlements, reserves, disputes, payouts, cards, reconciliation, compliance, and financial evidence. Restaurant wallets remain a separate rail. A worldwide workforce needs responsibility-specific operational queues; globally promoting every reviewer to super-admin would defeat the current restrictive boundary.

### Verified current implementation

The route inventory is `client/src/admin/adminRouteManifest.js:113–126`. Administrative APIs use super-admin, no-store, mutation limiting, and export limiting (`server/routes/admin.js:359–419`). Maker/checker decisions forbid self-approval and verify fresh checker step-up (`server/services/oxsteedCreditPendingActionService.js:483–520`); payout/withdrawal initiation also has maker step-up (`server/routes/admin.js:426–491`). Settlements carry expected status and reversal idempotency (`client/src/admin/pages/super/oxsteedCredit/SettlementsPage.jsx:253–279`). Append-only transactions, audit chains, settlement evidence, and governance are persisted in migrations `425_oxsteed_credit_transaction_immutability.sql`, `467_oxsteed_credit_audit_hash_chain.sql`, `486_oxsteed_credit_settlement_approval.sql`, and `640_oxsteed_credit_governance.sql`. These are substantial existing safeguards.

Current subpage coverage and specific residual work:

| Subpage | Verified current source | Residual operator requirement |
| --- | --- | --- |
| Overview | `client/src/admin/pages/super/oxsteedCredit/OverviewPage.jsx:46–69`; `server/controllers/oxsteedCreditController.js:854–1013` | Currency summaries and notification retry exist. Show the coverage time and link each failed notification to its receipt and retry history. |
| Approvals | `client/src/admin/pages/super/oxsteedCredit/ApprovalsPage.jsx:41–107`, `:153–211` | Financial and agent queues both request 50 rows. Add complete traversal, assignment, aged-first sorting, and decided/executed receipt history. |
| Disputes | `client/src/admin/pages/super/oxsteedCredit/DisputesPage.jsx:71–81`, `:132–160` | Paging, resolution, and account context exist. Add case ownership and evidence chronology; resolution should preview linked compensation and original transaction. |
| Settlements | `client/src/admin/pages/super/oxsteedCredit/SettlementsPage.jsx:155–169`, `:253–279` | Keep expected-state transitions and compensating reversal. Put recovery on the selected row rather than relying on the six-item recovery summary at `:123`. |
| Reconciliation | `client/src/admin/pages/super/oxsteedCredit/ReconciliationPage.jsx:93–113`, `:132–154` | Internal/external history paging exists. Add receipt-level finding ownership, progress/checkpoint visibility, and a resolved-versus-acknowledged distinction. |
| Compliance | `client/src/admin/pages/super/oxsteedCredit/CompliancePage.jsx:60–93`; `server/services/complianceCaseService.js:211–240` | The former fixed-zero verification/sanction offsets are fixed. Correct case filtering before paging and separate the three queues' cursors. |
| Reserves | `client/src/admin/pages/super/oxsteedCredit/ReservesPage.jsx:33–53` | Currency policies and maker/checker updates exist. Preview current/effective floor, partner override precedence, and affected payable coverage before submitting. |
| Partners | `client/src/admin/pages/super/oxsteedCredit/PartnersPage.jsx:70–84`, `:97–103` | Directory continuation and searched partner lookup exist. Separate directory, agreements, funding, and entitlements in detail; show scoped completeness for each. |
| Health | `client/src/admin/pages/super/oxsteedCredit/HealthPage.jsx`; `server/services/oxsteedCreditWorkerHeartbeat.js` | Existing rail/worker controls need run-to-incident links and a checklist of outstanding findings before unfreeze. Provider Health is separately main-owned. |
| Audit | `client/src/admin/pages/super/oxsteedCredit/AuditPage.jsx:43–56`, `:78–82` | Filtered continuation/export exists. Add an event drawer explaining before/after, actor, correlated financial receipt, and verification coverage. |
| Customers | `client/src/admin/pages/super/oxsteedCredit/CustomersPage.jsx:53–61`, `:87–125` | Account filters/paging and idempotent loads/adjustments/status exist. Require account-bound previews instead of relying on typed customer IDs. |
| Money Out | `client/src/admin/pages/super/OxsteedCreditMoneyOut.jsx:76–110`; `server/routes/admin.js:462–545` | Withdrawals/conversions are fetched at offset zero. Add navigable queues and execution receipts, preserving current step-up and dual-approval fee changes. |
| Cards | `client/src/admin/pages/super/OxsteedCreditCards.jsx:62–85`; `server/routes/admin.js:362–366` | Filters/offset paging and ephemeral issuance output exist. Show fulfillment events, shipment failures, and active/revoked counts independently of the current page. |
| Ledger | `client/src/admin/pages/super/oxsteedCredit/LedgerPage.jsx:69–100`, `:130–149` | Transaction continuation/detail and idempotent refund exist. Show original/refund linkage and exact refundable remainder before opening the existing confirmation. |

### Concrete flaws and gaps

1. **CONFIRMED DEFECT:** compliance case totals and page membership disagree. `listComplianceCases` applies LIMIT/OFFSET without an open-state predicate when no status is supplied (`server/services/complianceCaseService.js:172–189`). `getComplianceQueue` then filters out closed cases after paging (`:219`, `:228–238`), although its count includes only actionable cases. Closed old cases can occupy every slot; UI page count based on open totals can prevent reaching actionable later cases. The recent offset fix is real but does not fix this ordering/filter contract.
2. **DESIGN GAP:** approval and money-out work is sampled. Approvals requests newest 50 pending actions (`ApprovalsPage.jsx:41`); its API returns no continuation metadata (`server/controllers/oxsteedCreditController.js:839–846`), although the service supports offset (`oxsteedCreditPendingActionService.js:568–584`). Withdrawals/conversions always request offset zero (`OxsteedCreditMoneyOut.jsx:78–89`). Older financial work can become practically invisible.
3. **DESIGN GAP:** one global super-admin persona owns every subpage (`server/routes/admin.js:377–459`). The restriction prevents ordinary unauthorized reads but supplies no country/entity/partner-scoped reviewer roles. The residual concern is scalable delegation and conflict-of-duty enforcement, not absent authentication.
4. **UNVERIFIED:** provider settlement, reserve custody, human compliance decisions, and long-period reconciliation capacity have not been observed. External reconciliation explicitly fails when Stripe is unavailable (`server/services/oxsteedCreditExternalReconciliation.js:534–551`); report that correct unknown outcome, not “all matched.” Relevant tests include `server/__tests__/oxsteedCreditGovernance.test.js`, `oxsteedCreditCompliance.test.js`, `oxsteedCreditExternalReconciliation.test.js`, and `oxsteedCreditSettlementCycleLeaseFencing.test.js`; inspecting them is not executing them.

### Expansion failure scenario

A weekend surge creates more than 50 withdrawals and many resolved compliance cases. Older withdrawal requests vanish behind the newest sample, while actionable cases are displaced by closed records yet the count suggests few remaining pages. Two countries escalate to a global super-admin team, turning a sound journal into a bottlenecked operating process.

### Required changes and operator design

Filter actionable cases in SQL before paging and count the same predicate. Return independent continuation/count contracts for cases, sanctions, verifications, pending actions, withdrawals, and conversions. Add bounded assignment/lease and execution-receipt states to existing resources rather than a shadow ledger. Define scoped read, maker, checker, compliance, and recovery functions; reauthorize the target on every execution. Retain journal immutability, reservation integrity, step-up, idempotency, and worker fences.

#### Operator screen specification

Use the existing Credit subnavigation as a persistent workbench. Every child header should show selected currency/partner scope, source freshness, and rail/freeze state. Overview's KPI drawer defines balance, reserved liability, partner payable, and unmatched exposure separately. Queue pages need resource ID, subject, native amount, status, oldest-event age, assigned reviewer, due time, and receipt reference. Saved views differ by purpose: approvals “Mine to check,” disputes “Evidence pending,” settlements “Approved awaiting payout,” compliance “SLA breached,” and money-out “Provider outcome unknown.”

Detail drawers should match the resource: approvals show frozen proposed payload plus maker/checker identities; disputes show evidence and compensation; reserves show coverage simulation; partners show agreement/entitlement/funding tabs; customers show balance and journal; cards show fulfillment history; ledger shows original and compensating entries. Health and reconciliation draw from run/finding records, showing checkpoint, error category, and incident links. Audit opens the correlated chain, not a raw JSON-only explanation.

Allow individually authorized decisions, funding, refunds, settlement transitions, freeze, notification retry, and card fulfillment. Bulk operations initially assign or export bounded selections; money movement requires per-resource previews and approval policy. Preserve stable idempotency across network retries. Show 202 as queued with a receipt link; show executed only after its stored result is confirmed. Conflicts refresh the resource without erasing evidence drafts. Empty queues must disclose filters and completeness; unavailable provider checks say “verification unavailable,” and no-access screens name the missing role. On mobile, use a full-screen drawer, fixed decision footer, RTL-safe amounts/IDs, focus trapping, and announced status changes.

### Acceptance tests and owner

Credit Engineering owns accounting; Treasury owns payouts/reserves; Compliance owns case decisions; IAM owns delegated scope. Seed 120 closed cases preceding 60 open ones: all 60 must be reachable exactly once and match totals. Navigate 501 pending actions/withdrawals through bounded pages. Attempt self-approval, expired step-up, repeated refund, and lease-loss execution: require denied or single-effect outcomes. Validate scoped partner/entity isolation on direct IDs. Confirm provider outages produce failed/unknown reconciliation, not matched. Reconcile every proposed queue total against its source predicate before expanding reviewer staffing.

## 39. Revenue

### Route and business purpose

`/admin/super/revenue` provides period revenue, subscriptions, job fees, refunds, growth, and a transaction export. Finance needs comparability and traceable receipt definitions; this page currently reads platform-ledger movements rather than a closed accounting period or bank settlement.

### Verified current implementation

Summary and export use `view_financials` (`server/routes/admin.js:261–262`). The summary maps supported periods, calculates previous-period growth, and returns 50 recent rows (`server/controllers/superAdminController.js:1528–1589`). The component has period selection, retry, and export failure feedback (`client/src/admin/pages/super/Revenue.jsx:45–74`). Currency and sign are transformed on the server into major-unit amount and synthetic completed/refunded status (`superAdminController.js:1570–1571`). Export retrieves the selected interval into memory (`:1609–1630`). Schema currency is not hypothetical: the related financial source stores native amounts, and Money explicitly groups ledger currency at `:1699–1707`.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT:** the summary has no currency grouping and divides every amount by 100 (`superAdminController.js:1545–1550`). UI money presentation cannot recover currency omitted by the API. Money's USD-specific fix is not shared here.
2. **CONFIRMED DEFECT:** every negative entry counts as a refund, and every positive entry as total revenue (`:1545–1548`); recent status likewise depends only on sign (`:1571`). A negative correction or outflow is not necessarily a customer refund. The controller does not classify by its actual financial event.
3. **CONFIRMED DEFECT:** the dedicated export is unbounded (`:1609–1619`) and uses ad hoc CSV escaping which quotes only cells containing commas (`:1622–1625`). Quotes/newlines without commas and spreadsheet formula prefixes are not handled. This endpoint uses only the read grant and lacks the export limiter applied to generic export (`server/routes/admin.js:262`, `:274`). This is separate from existing safe-export code elsewhere.

### Expansion failure scenario

During a year-end close, many finance users request a full-year CSV. A query materializes millions of rows and builds another large string while ordinary API traffic shares resources. A controller then interprets a negative adjustment as a refund, and spreadsheet output cannot reliably reproduce the reviewed report.

### Required changes and operator design

Build summary and export from one versioned receipt classification with native currencies, half-open period bounds, and explicit recognition timing. Add bounded asynchronous export jobs with safe CSV serialization and dedicated capability/budget. Separate corrections/outflows/refunds and provide source receipt IDs; do not label sign as provider settlement state.

#### Operator screen specification

Replace the period-only header with period boundaries, accounting timezone, currency, scope, and last successful calculation. Keep the four cards but define total recognized revenue, subscription receipts, job-fee receipts, and actual refund events. Growth must identify its comparable prior interval; when the prior amount is zero, show “No comparable baseline,” not a misleading flat zero percent.

The transaction list should expose posted time, source classification, signed native amount, currency, receipt ID, linked customer/job, and reconciliation state. Add date, source, currency, and reference filters with saved views “Subscription close” and “Refund movements.” The existing 50-row table should disclose that it is recent activity and provide a cursor. A row drawer shows original event, ledger entry, recognition rule/version, any reversal, and settlement linkage. Allow opening Financials or the relevant payment; no row action should directly edit revenue.

Export becomes a preview dialog listing scope, columns, estimated rows, inclusion rule, and authorized sensitive fields. Submit creates a job receipt with queued/running/ready/failed status; downloads carry a completeness manifest. Bulk action is exporting selected authorized receipts or linking discrepancies to a reconciliation case. If generation fails, preserve the filter and job ID for retry/resume. Failed summaries retain clearly stale prior data; empty means successful zero qualifying receipts, while no-access does not display customer information. Provide a scrollable mobile table with a card alternative, RTL-safe IDs/amounts, keyboard-accessible export status, and announced job completion without automatic download or focus loss.

### Acceptance tests and owner

Revenue Accounting owns classifications; Data Engineering owns delivery. Seed fees, negative corrections, refunds, and CAD receipts: each must land in its correct category/currency. Compare a fixed snapshot's paginated rows, export manifest, and totals exactly. Test commas, quotes, CR/LF, and formula prefixes using safe serializer criteria from `server/__tests__/auditExportSafety.test.js`. Load-test concurrent year-long exports in the synthetic harness; reject or queue oversized requests without affecting ordinary request SLOs.

## 40. Fee Config

### Route and business purpose

`/admin/super/fees` edits transaction fees, subscription fees, and trial settings. It is a pricing publication workflow whose output influences quotes, helper proceeds, subscription provider prices, and commercial promises. A successful database change must not falsely imply successful billing publication.

### Verified current implementation

Reads/preview require `view_financials`; update/reset require super-admin (`server/routes/feeConfig.js:6–10`). Strict numeric parsing rejects nonfinite and trailing garbage values, and server bounds/trial minima are checked (`server/controllers/feeConfigController.js:13–19`, `:77–98`). The UI converts percentages/cents, validates bounds, and preserves confirmation on failure (`client/src/admin/pages/super/FeeConfig.jsx:43–89`). History is stored in `fee_change_log`, with a no-delete rule (`server/migrations/017_phase6_fee_config.sql:79–96`). Subscription edits create a provider price and update the plan (`feeConfigController.js:153–180`). History and reset screens already exist (`FeeConfig.jsx:190–239`, `:273–285`).

### Concrete flaws and gaps

1. **CONFIRMED DEFECT:** history and value change are separate autocommit queries (`feeConfigController.js:100–121`), with no expected version. A failed update can leave a success-looking history event, and simultaneous operators can log the same old value while overwriting each other.
2. **CONFIRMED DEFECT:** provider synchronization errors are swallowed (`:184–187`) after the local value commits; the API still returns success (`:129–134`). Partial failure after archiving the old price but before updating the plan is particularly difficult to reconstruct.
3. **CONFIRMED DEFECT:** preview uses truthiness defaults, so supplied zero rates/minimums become nonzero defaults (`:201–207`). A zero-fee proposal cannot be previewed faithfully. Reset loops through autocommit writes and does not call subscription synchronization (`:233–255`), so its success is not atomic publication of billing prices.
4. **DESIGN GAP:** history is capped at 100 (`:47–50`), and the component displays five or the loaded sample (`FeeConfig.jsx:191`). Complete historical fee attribution needs searchable revisions.

### Expansion failure scenario

Commercial teams stage a zero-fee market launch, but preview silently calculates default fees. An operator then updates subscription price; provider synchronization fails, yet success appears. Another shift resets fees and assumes billing prices now match the reset. Millions of users amplify that configuration ambiguity into disputed charges.

### Required changes and operator design

Publish versioned fee revisions atomically with audit and expected revision. Use nullish defaults and the same calculation function as charging. Represent provider publication separately as pending/succeeded/failed with stable provider idempotency and recoverable jobs. Reset should prepare an explicit revision diff and the required billing sync, not sequentially overwrite keys.

#### Operator screen specification

Keep fee groups but add a publication header showing active revision, pending draft, provider-sync state, and last applied time. Each row must show key, business label, stored unit, operator unit, allowed bounds, current value, proposed value, and affected products. Search by key/product and save “Subscription publication failures” or “Transaction fee changes.” KPIs should count draft keys, blocked publications, and unsynchronized plans, rather than imply financial gain from an unapproved change.

A row drawer shows change history with older-page navigation, consumers, sample quote calculations, and the active provider price reference. Editing stages a draft. The preview panel must demonstrate customer total, platform/protection/broker deductions, and helper proceeds on representative amounts, including zero and minimum boundaries. Confirmation lists before/after values, effective time, scope, expected revision, reason, and billing publication effects. Reset is a multi-row draft with excluded keys clearly identified.

Allow saving drafts, requesting publication, canceling unpublished drafts, and retrying failed synchronization with its original receipt. Bulk actions are a reviewed fee revision or default-reset preview; no blind reset-all button should immediately publish. A stale revision returns a conflict diff and preserves proposed values for rebase. A provider timeout shows local revision status separately from provider outcome, assigning the sync job to Billing Operations. Empty history means no recorded changes for that key; unavailable history must not imply unchanged fees. No-access identifies read versus publish capability. Use full-width mobile editors, keyboard-linked labels, accessible numeric-unit descriptions, and RTL layouts that keep percentages and values together.

### Acceptance tests and owner

Billing Engineering owns publication; Finance Pricing owns rate decisions. Inject failure between audit/value writes: both must roll back. Race identical starting revisions: one succeeds, one returns 409. Preview zero rates/minimums and assert exact zero deductions. Simulate provider failure at create/archive/plan-update stages: expose recoverable state and never claim full publication. Reset tests must reconcile fee config, plan amount, provider mapping, and revision audit after recovery.

## 41. Pricing Config

### Route and business purpose

`/admin/super/pricing` edits public tier-price presentation. Its six fields are price/label pairs, not the complete subscription charging engine. Operators must distinguish changing advertised copy from changing actual plans, regional prices, and transaction fee rules.

### Verified current implementation

The component loads public `/config/pricing` and sends its whole form to the update endpoint (`client/src/admin/pages/super/PricingConfig.jsx:11–40`). Server writes use `authenticate` plus `requireRole('super_admin')` (`server/routes/config.js:6–10`), a different authentication chain from `requireSuperAdmin`. The controller allowlists six keys and validates numeric price text before writes (`server/controllers/configController.js:80–95`); updates and audit now share a transaction with fail-on-audit-error (`:96–123`). Thus partial multi-field publication and nontransactional audit should not be reported as unchanged defects. Defaults remain string presentation values (`:38–45`), and a missing table or query failure returns defaults (`:48–65`). Migration `server/migrations/021_create_platform_config.sql` defines the persistent config.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT:** the default `tier3_price: 'up to 17%'` is incompatible with current update validation. The UI submits that unchanged default (`PricingConfig.jsx:16`, `:40`); server requires every `_price` value to match a numeric regex (`configController.js:89–92`). A legitimate edit to another field fails until the third-tier presentation is altered.
2. **DESIGN GAP:** the confirmation promises immediate platform-wide pricing effects (`PricingConfig.jsx:109`), but the update writes only `platform_config` (`configController.js:101–104`). Actual subscription checkout uses regional or plan provider IDs (`server/controllers/subscriptionController.js:136`, `:174`), and fee rules have another store. The screen should describe its actual publication boundary.
3. **CONFIRMED DEFECT:** successful defaults and failure fallback are indistinguishable (`configController.js:50–65`). Operators can review synthetic default copy during a database outage as though it were the persisted configuration; the API carries no freshness/provenance status.
4. **DESIGN GAP:** unconditional upserts have no expected revision (`:101–104`). Transactional atomicity does not prevent a later stale whole-form submission from replacing a newer editor's values. The exact MFA equivalence of this alternate middleware chain is **UNVERIFIED** here and must not be inferred from the page guard.

### Expansion failure scenario

Marketing changes a label for a country campaign and cannot save because an untouched default violates validation. Once saved, staff assume the displayed amount equals what checkout charges, although regional Stripe prices remain unchanged. Two editors then overwrite each other's copy in a whole-form update.

### Required changes and operator design

Create a typed presentation schema allowing an explicit percentage/message price type, separate monetary values from localized display labels, and publish revisions with expected version. Return persistence/fallback status. Add a read-only linkage to actual plan/fee/regional charge configuration, and test the server authentication chain directly before declaring parity.

#### Operator screen specification

Make the header read “Public tier presentation” with active revision, persistence status, language, and last publisher. Keep six fields grouped by tier, but show a live preview beside each: advertised amount/text, billing cadence, explanatory label, and actual linked billing configuration. A warning badge should identify a presentation/checkout mismatch without assuming they must always be identical; approved promotional copy may need explicit explanatory wording.

Replace generic text inputs with type selectors for free, monetary, percentage, and descriptive tiers. Attach visible labels and field-level validation. The detail drawer for a tier should show published revisions, related plan and regional overrides, fee references, and the public pages using that tier. Provide key/text search across revisions and saved views for “Unpublished copy” and “Billing mismatch review.” There is no meaningful revenue KPI here: counts should track mismatches, draft tiers, and publication failures.

Save creates a reviewable draft diff; publication requires scope, revision, reason, and exact public preview. Bulk publication means publishing all changed tiers as one atomic revision, not independently writing each field. A 409 shows the newer published text alongside the retained draft. Unavailable persistence should block publication from fallback data; “No custom presentation” should explicitly indicate defaults with provenance. No-access names the publication restriction and offers no editing controls. On mobile, stack editor and preview, maintain label associations, and provide translated preview direction independently from the operator shell. Return keyboard focus to the edited tier after confirmation and announce the actual published revision. Route any advertised-versus-charged discrepancy to Pricing Operations with the affected tier and country, not directly to refund processing.

### Acceptance tests and owner

Product Pricing owns displayed claims; Billing owns charge linkage. Load default data and edit only a label: the proposed typed API must accept it without changing unrelated price semantics. Inject audit failure and verify existing transactional rollback. Race whole-form revisions and require 409. Test persistence outage returns unavailable/fallback provenance. Exercise direct update requests for ordinary user/admin, disabled super-admin, and missing MFA according to the adopted authentication contract.

## 42. Pricing Overrides

### Route and business purpose

`/admin/super/pricing-overrides` manages country-specific Premium subscription prices. Correct operation requires a coherent mapping between native price, country, provider price ID, and actual checkout. Currency comparisons alone do not prove the charged price matches the configured price.

### Verified current implementation

The page loads overrides and currency comparisons and edits country price/currency/reason (`client/src/admin/pages/super/PricingOverrides.jsx:18–27`, `:162–187`). Routes use super-admin (`server/routes/pricingOverrides.js:5–8`). Controller validation and floor conversion call `updatePremiumPrice` (`server/controllers/pricingOverrideController.js:48–70`). Service logs the old amount, upserts the override, and invalidates its classified local cache (`server/services/pricingService.js:125–157`). Migration `160_location_based_pricing.sql:6–35` stores currency, optional price bounds, provider ID, and change history. Provider sync already creates missing prices; tests at `server/__tests__/pricingServiceStripeSync.test.js:10–63` cover that behavior. The new process-state registry classifies this cache (`server/utils/processStateRegistry.js:64–67`); it is not an unacknowledged process-state defect.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT:** changing amount/currency retains `stripe_price_id` because the upsert does not modify it (`pricingService.js:142–153`). Sync skips any row with an existing ID (`:240–247`). Checkout prefers that regional ID (`subscriptionController.js:174`), so an already-synced override can display a new price while checkout still uses the old provider price.
2. **CONFIRMED DEFECT:** audit and upsert run as separate queries (`pricingService.js:125–153`). A failed upsert can leave a change log; concurrent updates have no versioned old value. The history stores one currency value, insufficient to reconstruct a currency change's complete before/after state (`160_location_based_pricing.sql:28–35`).
3. **DESIGN GAP:** validation checks code length rather than supported country/currency membership and does not apply stored min/max bounds (`pricingService.js:111–121`; schema `160_location_based_pricing.sql:11–12`). The editor divides all currencies by 100 and fixes two decimals (`PricingOverrides.jsx:111–123`, `:169`, `:212`), requiring an explicit minor-unit contract for zero/three-decimal markets.

### Expansion failure scenario

A launch team changes a synced country's monthly price. Database and comparison cards show the new amount; sync reports already synced and checkout charges the prior price. Another region changes currency, complicating reconciliation because the history does not retain the previous currency/provider revision.

### Required changes and operator design

Publish immutable country price revisions tied to provider amount/currency/recurrence and activation state. Create/reconcile provider prices with stable idempotency and preserve existing subscription policy explicitly. Use transactional old/new audit and expected revision. Validate against supported currencies, country packs, and minor-unit metadata; benchmark rather than assume cache TTL provides instant publication.

#### Operator screen specification

Keep per-currency comparison cards but add a country/activation search bar and publication-status filter. Header should state which subscription product and interval are being edited, snapshot time, and revision. Rows need country, native amount, minor-unit scale, provider amount/currency, effective date, synchronization status, active customers affected, and last publication. Save views for “Provider mismatch,” “Awaiting activation,” and “Country launch review.”

Open a country drawer before editing: current advertised/configured/charged prices, provider revision, change history, bounds, fallback behavior, and affected new-versus-existing subscribers. Draft edits show native-unit inputs and reason. Preview must compare old and new checkout outcomes and clearly state whether existing subscriptions are grandfathered or migrated. Confirmation includes country, currency, interval, provider mapping, expected revision, and activation policy.

Allow single-country draft/publication, approved batch draft import, and retry of an identified failed synchronization job. Batch preview lists every valid/invalid country and per-row result; avoid treating the existing batch API's top-level success as universal success (`pricingOverrideController.js:163–167`). A stale edit shows the intervening revision rather than overwriting it. A provider timeout creates an unknown/pending publication state until the original idempotent request is reconciled. Empty filters state no matching countries; absent country configuration identifies the current US fallback explicitly. No-access and unavailable comparison/source states remain separate. On mobile, preserve country and currency above editable amounts; keyboard labels must include the unit, RTL codes remain readable, and focus returns to the country row after publication. Assign mismatches to Billing with the provider receipt and next reconciliation action.

### Acceptance tests and owner

Subscription Billing is accountable; Country Pricing approves economics. Extend existing sync tests: change a previously synced amount/currency and assert checkout cannot keep a mismatched provider ID. Inject log/upsert failures and demand atomic state. Verify zero/three-decimal fixtures end to end using the adopted currency metadata. Race revisions and provider retries: require one effective publication, complete per-country results, and a reconstructable old/new history.

## 43. Financials

### Route and business purpose

`/admin/super/financials` lists platform-ledger entries with source filters, summary totals, and CSV export. It helps investigators locate receipts but is not the entity-scoped double-entry Treasury journal. The business must distinguish ledger movements, revenue recognition, refunds, and bank settlement.

### Verified current implementation

The API requires `view_financials` (`server/routes/admin.js:255`). Controller paging is bounded, with source-type filtering and joined user context (`server/controllers/superAdminController.js:1305–1308`). Summary totals are separately queried (`:1309–1318`). The UI loads ledger pages and offers source tabs, fetch retry, and export feedback (`client/src/admin/pages/super/Financials.jsx:15–75`, `:119–149`). Treasury is already present with legal entities, accounts, period locking, and journal currency/entity validation (`server/controllers/treasuryController.js:182–205`); Financials should link to it rather than propose another ledger. Treasury reads require `view_financials`, and writes additionally require `requireSuperAdminOrPermission('manage_financials')` (`server/routes/treasury.js:11–26`). The route-matrix literal-pattern warning is not evidence that write gating is absent.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT:** positive movements become “gross revenue” and all negative movements become “total refunds,” irrespective of source (`superAdminController.js:1311–1315`). A signed operational ledger is not inherently a revenue/refund statement.
2. **CONFIRMED DEFECT:** totals aggregate all currencies and the UI renders dollar strings with a fixed divide-by-100 (`Financials.jsx:83–91`; `superAdminController.js:1316`). The source filter applies only to rows; totals remain lifetime/global (`:1307`, `:1316`), inviting mismatch between visible entries and headline scope.
3. **DESIGN GAP:** row queries have no date, currency, provider/reference, entity, or reconciliation filters (`:1304–1308`), and ordering lacks an ID tie-breaker. Bounded offset pagination limits payload size but does not provide a stable close snapshot under concurrent posting.
4. **UNVERIFIED:** cross-ledger reconciliation from legacy platform movements to Treasury journals and Credit dual-posting is not established by this page or `treasury.test.js`. Treasury's real entity/currency guards must be preserved, but their existence alone does not prove every legacy producer posts correctly.

### Expansion failure scenario

A controller filters refunds while the cards still show lifetime totals across every source and currency. They attempt to reconcile that screen to an entity-specific Treasury close. New entries shift offset pages mid-review, and the export cannot explain whether it represented the same snapshot.

### Required changes and operator design

Return separately labeled filtered and platform totals by currency, with typed movement categories and snapshot identifiers. Extend list queries with reference/date/entity where authoritative mapping exists; use stable cursor ordering. Connect immutable ledger entries to existing Treasury journals and reconciliation exceptions, explicitly indicating unmapped entries.

#### Operator screen specification

Place a scope bar above the existing source tabs: posting interval, currency, source, legal entity mapping, and snapshot time. KPI cards should show filtered debit/credit movement totals and separately defined recognized revenue/refunds; never relabel every sign as revenue. A toggle can expose global totals, clearly marked outside the selected filter. Saved views should include “Unmapped to Treasury” and “Refund close exceptions.”

List columns should be entry ID, posted time, source event, native signed amount, currency, user/job reference, journal linkage, and reconciliation status. Search by exact receipt/provider reference as well as description. The detail drawer needs immutable entry metadata, original financial event, related reversals, journal lines, entity/currency mapping, and audit history. Missing mapping is an actionable exception, not a guessed entity.

Row actions open the authoritative payment/refund page, open its Treasury journal, or create/attach a reconciliation exception. Bulk operations export a reviewed snapshot or assign unmapped exceptions; they must not edit ledger entries or close periods. Export preview includes scope and coverage, while status displays the stored snapshot/job receipt. A stale snapshot notice offers refresh or completion against the original close snapshot. API failure must hide authoritative totals and retain only labeled stale data; a missing ledger table is “Financial source unavailable,” not an empty successful ledger. No-access explains the read grant; lack of journal-write authority hides Treasury posting actions. Mobile uses labeled entry cards and a full-screen evidence drawer; RTL amounts/codes use directional isolation and keyboard focus returns to the originating entry. Assignment belongs to the reconciliation record, keeping financial history immutable.

### Acceptance tests and owner

Financial Systems owns source/journal linkage; Controllership owns close definitions. Seed fees, payout outflows, corrections, and refunds: totals must classify correctly. Apply source/currency/date filters and assert cards match rows or explicitly global labels. Verify equal-timestamp entries paginate once each while new posts occur. Test Treasury read-only users cannot post/close, writers without its required read grant follow the documented policy, and journal validation tests at `server/__tests__/treasury.test.js:144–245` remain valid.

## 44. Payouts

### Route and business purpose

`/admin/super/payouts` currently presents helper payment records as payout queues. Treasury staff must distinguish a customer payment's lifecycle from the helper's earned amount, transfer initiation, and actual settlement. Restaurant, affiliate, and Credit payouts are separate domains and cannot be assumed covered here.

### Verified current implementation

Read access uses `view_financials`; retry is super-admin only (`server/routes/admin.js:256–259`). The controller maps tabs to payment statuses, joins helper/connect-account context, and bounds paging (`server/controllers/superAdminController.js:1407–1432`). Retry allows only failed records, treats released as no-op, and conditionally updates status to avoid duplicate racing retries (`:1477–1503`). UI confirmation, fetch errors, and a detail drawer exist (`client/src/admin/pages/super/Payouts.jsx:17–48`, `:60–83`, `:201–207`). Migration `014_phase4_create_payments.sql:13–28` distinguishes gross amount, helper payout, currency, status, transfer ID, and failure reason. A separate fenced affiliate settlement reconciliation worker exists (`server/jobs/payoutSettlementReconciliation.js:3–11`, `:28–43`), not proof of helper settlement.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT:** the UI displays `p.amount`, the customer's gross payment, as payout amount (`Payouts.jsx:22`, `:178`), although server stats sum `helper_payout` (`superAdminController.js:1436–1440`). A $100 gross/$83 helper record produces inconsistent queue and summary amounts.
2. **CONFIRMED DEFECT:** server returns database statuses authorized/captured/released/refunded/disputed, while UI badges expect pending/processing/completed/failed (`Payouts.jsx:174–185`). Retry appears only for literal failed, despite the failed tab including refunded/disputed (`superAdminController.js:1412`). Refunded/disputed are not failed transfer retries; preserve the controller's refusal to retry them.
3. **CONFIRMED DEFECT:** the drawer expects method/reference/failure information, but the list projection omits method and failure_reason (`superAdminController.js:1418–1424`; `Payouts.jsx:23–27`). It falls back to the payment ID without exposing selected transfer evidence. Currency is also omitted and dollar formatting hardcoded (`Payouts.jsx:86–89`).
4. **DESIGN GAP:** UI fetches only status without page/limit continuation (`Payouts.jsx:61–64`), and retry's local status reset does not itself prove a worker/provider will complete the transfer. That completion path is **UNVERIFIED**, so this review does not claim an actual duplicate payout or a working requeue processor.

### Expansion failure scenario

A shift sees “failed” entries consisting of refunds and disputes, while successful released entries get a failure-colored badge. The operator reads gross customer value as money owed to a helper and lacks provider failure details. They retry a real failed item but cannot tell whether funds moved or only the local payment state changed.

### Required changes and operator design

Define a payout-specific DTO with gross, fee, helper entitlement, currency, payment state, transfer state, and settlement state. Add continuation and failure/provider details. Retry should create a durable execution receipt with clear requeue versus provider outcomes and reconciled ambiguity handling, preserving its existing conditional update.

#### Operator screen specification

Replace the four overloaded tabs with queues derived from payout state: eligible/uninitiated, transfer processing, settled, retryable failure, and investigation required. Header shows rail, currency, accounting scope, and oldest successful refresh. KPIs must count records and sum helper entitlement separately; do not present counts as money. Add recipient/reference search, provider failure category, age, and payout-readiness filters with saved views “Disabled payout accounts” and “Unknown transfer outcome.”

Rows should show helper, job/payment ID, helper amount, currency, connect readiness, transfer status, age, and last attempt. Drawer sections are entitlement calculation, customer-payment history, provider transfer evidence, bank/settlement evidence, attempts, and audit. Refunds/disputes link to investigation without a retry button. Completed records show immutable receipt evidence rather than relying on a status string.

For retryable failures, preview exact helper amount, failure category, existing transfer reference, readiness prerequisites, and the original idempotent attempt identity. Confirmation explains whether it queues or executes. Initially bulk actions only assign investigations or export; bulk retry requires per-row eligibility preview and execution manifests. A timeout shows outcome unknown and offers receipt reconciliation before another attempt. A 409 refreshes state and explains why retry is no longer allowed. Empty failure queue means no qualifying failures after successful source checks; provider unavailable is distinct from no payouts. Read-only finance users should not see actionable retry controls. Mobile prioritizes helper amount/status over optional columns, with keyboard drawer focus, textual statuses, and RTL-isolated IDs. Assign every unknown outcome to Payments Operations with its next provider check.

### Acceptance tests and owner

Payments Operations owns payout incidents; Payments Engineering owns execution contracts. Test $100 gross/$83 helper fixtures: both row and summary show $83 payout. Map every database status explicitly. Paginate 1,001 records without gaps. Retry races yield one state transition; released/refunded/disputed do not execute a transfer. Inject lost responses and verify reconciliation uses the original receipt before retry. Add integration coverage for the actual helper processor; adjacent `mainAppPayouts.test.js:27–79` covers request/balance behavior, not this admin queue's settlement.
## 45. Conversations

### Business purpose and observed implementation

Conversations is a privacy-sensitive investigation surface for exceptional staff access, not the ordinary customer messenger. The thread handler requires a normalized access reason and records access before fetching messages (`server/controllers/conversationsAdminController.js:167`). That ordering is important. Linked business/helper quotes, agreements and payment artifacts are loaded separately with individual bounds. List APIs support paging, while the current screen's search/typeahead operates over the loaded view; it does not make the entire corpus browsable automatically.

### Findings, expansion scenario and required changes

**P1 confirmed control gap:** blocking/archiving uses a read followed by an unconditional status update, accepts an optional reason and ignores audit-write failure (`server/controllers/conversationsAdminController.js:238`). Two operators can overwrite each other's decisions without acknowledging the changed state. Move status transitions and required evidence into a version-aware audited command; blocking must not incidentally cancel financial or booking records. **P2:** message history is loaded without a bound (`server/controllers/conversationsAdminController.js:193`). Long-running corporate or support conversations can overwhelm memory and rendering. Implement chronological cursors and a dedicated evidence export budget. Linked-artifact failures are caught into empty collections, so the drawer must distinguish unavailable artifacts from proven absence.

At six million users, unrestricted investigation access is itself a material privacy risk. Bind access to a case, approved purpose, scope and short-lived viewing session; separately authorize exports and attachments. Existing reason logging is a sound foundation, not proof of case-based least privilege. Logs should contain identifiers and purpose rather than copying the private conversation into diagnostics.

### Operator design recommendations

Start with an investigation index containing conversation ID, participant roles, linked engagement identifiers, last activity, case reference and current communication restriction. Hide message previews until the operator has obtained case access. Filters distinguish customer/helper, business/internal, guest inquiry, blocked and archived records, with bounded server search. A labelled access banner states why this operator can view the thread, when that permission expires and which downloads remain forbidden. A second investigator must supply their own purpose rather than inheriting another employee's open session.

The thread view uses a virtualized chronological timeline with load-earlier controls and explicit gaps when an evidence source is unavailable. A related-record rail shows quotes, booking, agreement and payment status individually; a failed payment-artifact panel says “not verified,” not “none.” Private staff channels remain separated from customer-facing exchanges. Attachment access is deliberate and checked per object; viewing a thread does not grant a bulk download entitlement.

Block/unblock/archive commands appear in a decision drawer with the current state, proposed restriction, affected communication channels, required reason and case owner. Explain that these commands do not automatically refund or cancel related work. A conflicting decision shows the intervening event and demands review. An unknown response offers command-status recovery, not repeated blocking. Closing the case removes viewing access but preserves evidence under its retention policy. On small screens retain the access banner and case owner above the message content; keyboard shortcuts cannot bypass the reason dialog. Restore focus after decisions and announce evidence-load failures separately from the chat timeline.

### Acceptance and ownership

Trust and Privacy own access policy; Messaging owns bounded retrieval and transitions. Test denied/expired case access, pre-read audit failure, guest verification, private staff-channel separation, competing status changes and partial artifact outage. Demonstrate scoped export with retention and redaction. Prove a 100,000-message fixture stays usable without loading everything and that access revocation terminates ongoing reads/realtime subscriptions.

## 46. Admin Accounts

### Business purpose and observed implementation

This tab manages privileged identities, distinct from the complete employee roster. The current list selects admin/super-admin accounts, login signals and audit counts without pagination (`server/controllers/superAdminController.js:2885`). Creation checks privileged-role authority and hashes the submitted initial password. Disable uses an expected-state predicate and invokes session revocation; these existing protections deserve credit (`server/controllers/superAdminController.js:2973`). They still need end-to-end tests across API, sessions and sockets.

### Findings, expansion scenario and required changes

**P1 confirmed misleading assurance:** creation returns “must change their password on first login,” but its INSERT does not set a must-change flag (`server/controllers/superAdminController.js:2950`). The statement is not enforcement. Replace administrator-distributed passwords with expiring invitation enrollment, enforced credential rotation where applicable and MFA registration before privileged actions. **P2:** roster queries compute per-user audit count/max against growing history and load all accounts. Use bounded identity search and maintained activity summaries. An account disable is not the entire leaver process: transfer open approvals, queues, business responsibilities and emergency coverage without reassigning financial authority implicitly.

Not every one of 3,500 employees should become an admin. Corporate staff and workflow assignments need narrower permissions, while super-admin access should remain rare and reviewable. Verify protection against disabling the last recoverable privileged operator and against treating re-enabled accounts as automatically reauthorized for expired grants. No claim is made here that the current system lacks all MFA controls; the missing gate is demonstrated complete lifecycle enforcement.

### Operator design recommendations

Use a privileged-identity roster, with tabs for enrollment pending, active privileged staff, disabled identities and recertification due. Display sponsor, employment link, privilege class, effective scope, MFA enrollment/compliance, last successful login, session count, earliest grant expiry and unresolved handoff count. The top row reports stale identities and access exceptions rather than a decorative count of all admins. Filter by country/team, sponsor, privilege, inactivity interval and enrollment blocker; expose total results and cursor navigation.

The identity drawer explains how each permission was obtained: role, direct grant, delegation or corporate assignment. Show overlapping grants and explicit denials separately. Invitation creation previews the approved role bundle, sponsor, expiry and enrollment requirements; it never places a reusable initial credential in a table, export or audit description. A recovery action requires fresh verification and its own audit reason, not a bypass toggle.

Disable opens an offboarding checklist listing active sessions, owned cases, pending decisions, expiring delegations and backup operator. Separate “disable identity now” from “transfer owned work”; the first must succeed safely even when a downstream handoff system is unavailable, with outstanding tasks tracked afterwards. Re-enable requires review of current role and MFA, not restoration of an old permission snapshot. A last-admin warning gives a verified emergency recovery path rather than trapping the operator. Unknown outcomes show the current authoritative status and revocation reconciliation. Mobile prioritizes security state and handoff actions; screen-reader announcements name the identity and the final result.

### Acceptance and ownership

Identity Operations owns enrollment and leavers. Prove mandatory first-login/MFA gates, invitation expiry, competing disables, self-disable denial, last-operator recovery and revocation of refresh/realtime access. Re-enable a user whose old grant expired and prove it stays expired. Test a full offboarding with one failed handoff, showing access removed and a tracked unresolved obligation. Budget roster queries against a realistic privileged population and multi-year audit history.

## 47. Permissions

### Business purpose and observed implementation

The permission catalogue now includes operations, financial management, moderation, support and visibility scopes (`server/controllers/adminPermissionController.js:7`). Grants have expiry and optional region; creation validates active regular-admin recipients and a maximum one-year term. Current self lookup loads at most 50 active grants, while the management view returns at most 200 without pagination (`server/controllers/adminPermissionController.js:55`, `:114`). Server authorization remains authoritative; a checked box in the UI is not proof of record-level regional access.

### Findings, expansion scenario and required changes

**P1 consistency gap:** create/revoke writes the grant and then writes audit evidence separately (`server/controllers/adminPermissionController.js:176`, `:216`). An audit failure cannot undo the already committed authority change. Use a shared transaction or durable command/event record and return an unambiguous outcome. Revocation also needs conditional transition/idempotent final-state handling. **P2:** fixed self-list limits can omit valid grants and disagree with endpoint authority; management limits hide older active grants. Introduce bounded cursor retrieval and a server-computed effective-permission summary, including region and expiry, rather than relying on incomplete unions in the browser.

For worldwide staff, define role bundles and approval limits, separation of duties and periodic recertification. Keep region-only grants out of global endpoints until every list/detail/export/socket/action has a region predicate. A regional grant must not be silently promoted to global because a UI lacks a region picker. Delegation must not extend beyond its parent's authority or expiry; verify current grant/delegation composition as a complete journey.

### Operator design recommendations

Organize the page around “who can do what, where, until when.” The roster shows staff identity, permission bundle, direct/delegated source, geographical scope, start/expiry, grantor, business reason, recertification owner and current effective status. Saved views include global money authority, expiring this week, orphaned sponsor, overlapping grants and overdue review. Search is server-bounded; a results footer states the full predicate count rather than presenting 200 rows as the whole company's access.

The grant drawer first selects the employee and authorized scope, then a role bundle or explicit capabilities. Display a plain-language impact preview: read customer messages, issue refunds within approved limits, change settings, or export data. Show incompatible combinations and routes not yet region-aware. Selecting a region must never make a global capability appear safe. Include exact effective and expiry times with timezone, requested reason and independent approver where policy requires it.

A comparison panel shows added authority, unchanged authority and authority removed by revocation. It includes dependent delegations and cached/session effects. Recertification presents evidence of actual use and sponsor confirmation; “keep all” is not the default. Revocation remains possible during staffing incidents and reports the command outcome plus downstream reconciliation. On conflict, display the new grant record and force renewed review. A permission denied state explains the required sponsor/escalation without exposing another staff member's private data. All labels use business language, while stable capability codes remain copyable for engineers.

### Acceptance and ownership

Security/IAM owns the authority contract. Seed more than 50 simultaneous grants and prove the UI summary matches every server decision. Test expiry, parent revocation, region cross-access, denied exports and stale sessions. Inject audit failure and demonstrate no unrecorded privilege change. Run explicit route tests for each catalogue scope; fix checker blind spots without weakening middleware. Record a complete quarterly recertification batch with per-record decisions and an immutable evidence reference.

## 48. Regions

### Business purpose and observed implementation

Regions defines staff territories used by grants; it is not automatically a delivery service area, a tax jurisdiction or a demand reporting region. Boundary validation supports postal ranges, city/state, geographic radius and country/region combinations (`server/controllers/adminRegionController.js:17`). Country definitions use canonical validation. Lists include active grant counts; deletion refuses a region with current active grants. Region middleware already has fail-closed semantics elsewhere, so this review is about registry quality, change control and coverage.

### Findings, expansion scenario and required changes

**P1 governance gap:** editing an existing boundary changes what current region grants mean without an immutable boundary revision or expected-version predicate (`server/controllers/adminRegionController.js:158`). At global scale a casual radius edit may widen authority for many employees. Stage changed geometry, compute affected staff/data scope, and bind grants to an approved revision or explicit migration decision. **P2 confirmed validation gaps:** radius centers are finite but not constrained to valid latitude/longitude bounds, and postal ranges are numeric rather than country-specific postal identifiers. Postal codes with leading zeros or letters cannot be modelled reliably as generic numbers. The country-aware boundary types are preferable; do not assume every territory is a US ZIP range.

Registry audit calls currently catch failures (`server/controllers/adminRegionController.js:140`, `:216`). Make consequential scope changes durably auditable. Verify delete/grant concurrency and foreign-key behavior rather than relying only on a pre-delete count. Prefer retire over delete when historical grant/evidence records refer to a boundary. Add deterministic overlap precedence and “unassigned” treatment; geography must not silently grant access to records with missing location.

### Operator design recommendations

Provide a territory inventory with canonical code, country, boundary type/revision, parent, active staff count, unresolved overlap count, unmapped records and lifecycle status. Separate labels for “admin access territory” and “service coverage” so dispatch personnel do not mistake this screen for an availability switch. Filters include country, boundary type, overlapping, unused and retirement pending. A map is optional evidence assistance; a fully accessible textual boundary and membership explanation must work without it.

The boundary editor uses country-specific input widgets: canonical subdivisions, postal strings or validated coordinates/radius. Before saving, show old/new geometry, staff whose scope changes and samples of records entering/leaving authority. Geographic precision is explicit, with missing-location records classified as unresolved. Let reviewers test a record ID or address against the proposed boundary using an authorized diagnostic, without exporting all customer coordinates.

Scope changes require a reason, version and approval where they widen privileged access. The decision drawer distinguishes editing a display name from changing authority. Retirement lists dependent active and historical grants, offers replacement mapping and keeps the old revision readable. Overlaps show deterministic rule application instead of assigning whichever region was loaded first. A conflict preserves the proposed geometry and reloads the approved revision. If mapping is unavailable, investigation continues but widening actions pause. Mobile replaces the map with a structured boundary summary, impact count and record-test control; keyboard users can inspect every coordinate and affected staff row.

### Acceptance and ownership

IAM owns authorization boundaries; Geographic Operations owns data quality. Test invalid coordinates, international postal formats, leading zeros, overlaps, missing coordinates and records on an exact boundary. Run competing retirement/new-grant operations and verify no global scope is created accidentally. Prove an approved boundary revision propagates across two workers/caches and revoked territories cannot be used by stale sessions. Keep delivery service-area tests separate from admin territory tests.

## 49. Internal Access

### Business purpose and observed implementation

Internal Access assigns additional route access to eligible internal staff. Existing code validates the employee/admin role, active identity and route-specific eligibility before saving flags (`server/controllers/logisticsInternalAccessController.js:92`). It hashes the supplied gate credential and projects only safe record fields. Operations, compliance and admin-portal flags are normalized against authoritative route rules. These are meaningful protections; the audit does not expose or rotate any live credential.

### Findings, expansion scenario and required changes

**P1 lifecycle/evidence gap:** the save helper changes access with a read/upsert pattern, but its returned `updated_by_user_id` is constructed response metadata, not a persisted change history (`server/controllers/logisticsInternalAccessController.js:175`). Add expected version, durable actor/reason evidence and explicit revocation reconciliation. Trace caller-level audit/session invalidation before certifying the full flow; a changed response label is not sufficient proof. **P2:** the roster and eligibility logic must explain why requested route flags were normalized away. Silent normalization can leave an administrator believing access was granted when it was not.

At 3,500 employees, this extra gate should not become an alternate unmanaged identity system. Maintain the underlying employee identity, MFA, device/session policy and work entitlement as the authority. Enrollment, reset and emergency recovery need accountable sponsors, expiry and offboarding. Verify already issued internal sessions after disabling a route or the linked user; the presence of a 15-minute token does not by itself establish immediate revocation. Route access must remain narrower than broad admin access.

### Operator design recommendations

Make the roster a route-entitlement matrix: employee identity, department, internal alias, underlying account health, operations/compliance/admin access, last verification, sponsor, expiry and pending revocation. Filters focus on inactive linked identities, missing sponsors, unused access and recently changed entitlements. Do not display gate credentials or reusable credential exports. A change history shows only that a credential was rotated, who authorized it and its effective time, never its plaintext value.

Selecting a staff member opens the underlying role and corporate assignment alongside requested route permissions. Each toggle has an eligibility explanation and an effective-state preview; if compliance access is not allowed for that assignment, disable the request with the correct staffing change path. Do not silently render it checked and then let the server drop it. Enrollment/reset is a separate verified workflow with deliberate handoff, not a routine row edit.

The revoke preview states exactly which routes and sessions will be affected, lists owned operational work requiring reassignment and records the reason. Access denial should happen immediately; handoff tasks may reconcile afterwards without keeping the identity active. Show revocation progress and remaining downstream checks separately. A conflict requires re-reading the employee's current role and record revision before applying changes. Recovery links take the operator to verified identity/support procedures rather than a bypass button. Keyboard and mobile use preserve effective-state labels, sponsor and expiry; safe masked contact details are enough for queue triage, with sensitive identity details available only in an authorized drawer.

### Acceptance and ownership

Identity Operations owns enrollment/recovery; Logistics Security owns route policy. Test ineligible roles, inactive users, duplicate aliases, mismatched route requests and one-time credential reset. Disable underlying staff and route-specific access while sessions are open; verify API and realtime denials. Inject a timed-out save and audit failure and prove the final authority is discoverable. Record a staff-transfer case that removes old compliance access before new operational work is granted.

## 50. Gate Lockouts

### Business purpose and observed implementation

This security queue lets authorized operators investigate failed internal-gate attempts and lift a verified lockout. The shared service persists rate-limit/attempt state, rather than relying only on one web process. The controller validates a positive lockout ID and passes actor, source and reason into the lift operation (`server/controllers/logisticsInternalAccessController.js:673`). Recent attempts have filters and offset controls. Active lockouts are capped at 200 (`server/controllers/logisticsInternalAccessController.js:663`). Verified email recovery is a separate flow and should remain separate from administrative incident handling.

### Findings, expansion scenario and required changes

**P1 policy gap:** manual lift accepts an empty reason, weakening the investigation trail for a security override. Make purpose/case reference and identity verification mandatory for privileged recovery. Lifting a lockout must not enable a disabled staff account, restore expired authority or suppress fraud evidence. **P2 scale/design gap:** a fixed active-list cap without older-page navigation can hide affected staff during a broad incident. Add cursor/total/oldest-age metadata and safe grouped investigation, not a blanket “unlock everyone.” IP plus alias is an abuse signal, not a proof of a person's identity; shared workplace networks require careful interpretation.

Prove service behavior across workers and dependency outages. Database-backed lockouts do not by themselves establish that every gate path consistently applies them or that a recovery request cannot be replayed. Alert on unusual manual lifts, repeated lockout/lift cycles, distributed failures and provider-email delivery problems. Avoid exposing account-existence information to public recovery callers. Evidence-retention periods and access restrictions belong in a documented security policy, not ad hoc deletion buttons.

### Operator design recommendations

Use an incident-oriented queue showing lockout reference, safe identity hint, route, first/last failed attempt, failure count, expiry, network indicator, linked case and current recovery state. Default ordering prioritizes active staff blocked from critical shifts and unusual repeated failures, while hiding full sensitive identifiers until the investigator opens a permitted record. Filters include route, time interval, repeated lifts, recovery sent/used and suspected shared-network incidents. The total and oldest age describe the whole authorized queue.

The investigation drawer presents a timeline of failed attempts, successful verification, prior lifts and recovery events. Compare staff account state and work entitlement; a locked gate on a disabled identity is not a reason to reactivate employment access. A network view can correlate suspicious patterns, but must not brand every employee behind the same office IP as an attacker. Provide links to the accountable Security case and current on-call owner.

“Lift verified lockout” requires case ID, purpose and completed identity checks, then previews the exact lockout scope and expiry effect. No bulk lift is offered by default. A second operator's completed lift becomes a resolved state, not an invitation to repeat it. During shared-storage outage the screen shows stale evidence and prevents unsafe recovery overrides. After lifting, display whether access verification succeeded; “lift recorded” and “employee can sign in” are different outcomes. Preserve investigation filters after returning to the queue and announce recovery errors accessibly. Mobile keeps the reason, scope and verification checklist visible above the confirmation action.

### Acceptance and ownership

Security Operations owns this workflow. Test concurrent lifts, old recovery links, disabled/expired identities, enumeration resistance, shared-office IPs and distributed attempts. Kill one worker and verify counters survive. Simulate email and storage outages and prove no silent unlock. Complete a verified staff recovery while retaining attempt history and recording one lift outcome. Measure false-positive lockouts and time to restore legitimate access without using those targets to weaken abuse controls.

## 51. Create User

### Business purpose and observed implementation

The account-creation workflow supports customer, helper, restaurant/business modes and internal employee identities with explicit role/default-mode mapping (`server/controllers/superAdminUserController.js:48`). It validates account fields and role authority, and creates the user plus helper profile and per-field action evidence through a transaction (`server/controllers/superAdminUserController.js:298`). Sensitive password fields are redacted from display/evidence helpers. This is a useful authoritative creation service, not a substitute for business membership, identity verification, paid entitlement or Stripe onboarding.

### Findings, expansion scenario and required changes

**P1 authority workflow requirement:** distinguish an administrator asserting a verification/subscription field from actual provider-verified evidence or settled payment. Creation accepts verification flags and membership information; the operator UI must require appropriate authorization/evidence and explain which changes do not activate financial privileges. Do not allow a restaurant-manager default mode to imply membership in an arbitrary restaurant. **P2 onboarding gap:** operator-supplied passwords require a secure handoff and enforcement of initial credential setup. Prefer expiring invitation completion, duplicate-safe commands, consent provenance and a clear incomplete account state. Email uniqueness alone does not make a timed-out creation command recoverable.

The new entity-ID and ownership graph work added after the main audit snapshot is relevant here. Verify every admin creation path initializes required identifiers and attaches only explicit ownership; the existence of registration-path tests is not proof this separate controller is covered. Worldwide account import needs validation preview, per-row outcome and idempotent replay, not a mass “create admin” tool. No production identities were created during this audit.

### Operator design recommendations

Make this a guided provision-and-invite form, starting with the intended person/entity and account purpose. Show canonical email/contact, country/locale, employee or customer relationship, selected account mode and role mapping. Explain that “business manager” or “restaurant staff” requires a separate verified membership assignment. A live duplicate lookup returns a masked authorized match and opens the existing-account workflow; it should never leak the complete user directory merely because an operator types a short query.

The second stage lists default tools and pending requirements: identity verification, profile completion, business membership, agreement acceptance, subscription evidence and payout onboarding. Distinguish informational mode selection from paid or regulated capability. Verification and entitlement assertions sit in a privileged evidence panel, not ordinary checkboxes beside a name. Staff provisioning requires sponsor, department and effective date; customer assistance records the user's consent or support case.

Before submission, display the exact role, identifiers to be created, pending state and invitation effect. The primary action is “create and invite,” not “create verified user.” A progress receipt shows account ID, successful domain initialization and remaining setup steps. A timeout provides command lookup; retry cannot create a second account or duplicate helper profile. Errors identify a recoverable field or initialization step without echoing credentials or raw database details. Mobile keeps the summary and pending obligations above confirmation. Preserve non-sensitive drafts only where appropriate; do not store initial credentials, identity documents or verification evidence in browser local storage.

### Acceptance and ownership

Identity and Customer Operations own provisioning. Test every supported account type, employee roles, invalid country, duplicate email, timeout/retry, denied privilege and business membership isolation. Verify per-field audit rollback on failure. Test entity-ID/ownership initialization specifically through this endpoint. Demonstrate invitation expiry/resend, unverified onboarding and valid subscription-provider handoff without manufacturing a charge or paid entitlement.

## 52. Search Logs

### Business purpose and observed implementation

Search Logs records how staff use the cross-entity search system. The list supports operator and query filters plus limit/offset and total (`server/controllers/adminSearchController.js:376`). Statistics expose search volume, common queries and top operators (`server/controllers/adminSearchController.js:433`). This is investigation evidence with sensitive search terms/IPs, not an employee productivity leaderboard or a customer analytics dataset. Search authority and evidence access must remain independently controlled.

### Findings, expansion scenario and required changes

**P2 confirmed validation flaw:** list limit clamps only the upper bound; a negative parsed value reaches PostgreSQL LIMIT and fails instead of being rejected (`server/controllers/adminSearchController.js:394`). Validate positive bounded integers and move large-history browsing to keyset pagination. **P1 privacy requirement:** returned fields and popular-query statistics include literal queries, which can contain customer identifiers or private fragments. Define minimization, reveal authorization, retention and legal-hold rules. Do not broadly expose popular sensitive queries because they are aggregated. Verify write-time storage/encryption and decryption behavior before making encryption-at-rest claims; this handler alone cannot establish the entire storage policy.

Result counts currently do not establish why each entity source returned empty. The main search transforms failed subqueries into zero-like results elsewhere; logs need completeness/error fields to distinguish “no match” from dependency failure. At enterprise size, use bounded reporting windows and background aggregations instead of repeatedly scanning all history. Include attempted denied searches and export use under appropriate privacy policy, without logging full returned customer payloads.

### Operator design recommendations

Build an access-investigation log with timestamp, staff identity, scope, requested entity types, purpose/case, query category, source completeness, result count and correlation ID. Default the literal query to masked form. Filters include date range, staff/team, sensitive entity class, denied access, incomplete search, unusual volume and linked case. Show the search interval and retention boundary so reviewers know whether missing old events are expired, absent or unavailable. Do not rank staff by raw search count as a performance metric.

The detail drawer reveals literal query only after a separately authorized purposeful action and records that reveal. It shows which sources were attempted, succeeded, denied or unavailable, alongside the staff's effective scope at the time. A source error cannot masquerade as a successful zero-result search. Links to returned record IDs perform fresh authorization; historic search access does not grant continuing access to current private records.

An anomaly panel groups repeated broad queries and unusual exports for investigation, with an assigned reviewer and disposition rather than automatically accusing an employee. Scoped export requires an approved date/predicate, privacy redaction, retention expiry and asynchronous job status. Legal hold is explicit and cannot be undone by routine purge. Paging remains stable as new searches arrive, and selected evidence is preserved by ID rather than row position. On failure retain the last verified sample and error timestamp. Keyboard users can reach reveal, case assignment and export status without depending on hover-only controls; mobile prioritizes operator, outcome and time over dense query text.

### Acceptance and ownership

Privacy Engineering owns minimization; Security Operations owns investigation. Test negative/oversized limits, source outage, sensitive-query masking, denied reveal, expired retention, legal hold and scoped export. Verify pagination with identical timestamps and concurrent writes. Seed multi-year history and measure query/report budgets. Complete one anomaly review with preserved provenance, while proving an ordinary support administrator cannot browse unrestricted staff search history.
