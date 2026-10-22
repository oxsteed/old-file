# Restaurant franchise review implementation

Source requirements: [the supplied review](REVIEW-2026-10-20.md), all 33 findings,
feature-gap table, suggested flows, and phased roadmap. Work continues on
`codex/demand-sales-engine`. This is an **incomplete implementation**, not a
franchise-grade or production-readiness declaration. Existing fixes are retained;
no production migrations, deployment, financial activation, or provider-account
changes are authorized by this checkpoint.

Restaurant support case listing, detail, responses, escalation, and resolution
now use the `support.view` and `support.manage` permission catalog instead of
role-name checks. Kiosk configuration uses `settings.manage` through the same
resolver, and help requests, team communications, and staff documents use
`restaurant.manage`, so membership deny overrides apply to these manager
surfaces, shared-device POS manager approvals, and the OxSteed Credit partner
reporting surface. Existing case ownership and payment approval rules remain in force;
provider and populated-store acceptance are still open.

## Current pass: store menu, split-shift hours, quantity-level POS splits, and HQ regions

Migration 988 formalizes the existing restaurant record as the brand anchor and
adds tenant-bound HQ regions beneath it. Every existing store is assigned to an
`all-stores` root region; new stores default there, and owners can create nested
regions, move stores between regions, and review store counts through the HQ
console. Parent cycles and cross-brand region assignments fail closed, and
region changes are audited. This closes the hierarchy portion of F-02 while
leaving the remaining mandatory-record backfill and full data-boundary adoption
as explicit follow-up work.

Migration 989 completes the operational store-identity cutover for orders,
payments, shifts, printer settings/jobs, paired devices, kitchen and drawer
records, approvals, inventory ledgers, and workforce task records. It backfills
legacy rows to the primary store, adds composite tenant foreign keys, installs
source-aware database triggers for omitted store ids, and makes the operational
location columns non-null. Brand-level accounting integrations remain
intentionally location-aggregated until their provider mapping is configured.

Manager dashboard and report rollups now apply the assigned-member store scope
to order, kitchen, runner, inventory, paired-device, and POS-sync queries. The
manager surfaces preserve all-store behavior for owners and legacy members
without active assignments. Kitchen station reads, routing, and writes now carry
the assigned store, runner settlement reads and writes follow the runner task's
store identity, assigned crew shifts/tasks/events require and retain their
store, POS sync status/acknowledgement records now require the same store
identity for assigned managers, and POS receipt-event history follows the
order's assigned store, including receipt audit events emitted by POS payment
and reprint flows. Remaining F-02 work is the full data-boundary audit
across every adapter plus populated multi-store acceptance.

Migration 963 adds tenant-constrained store menu overrides. Prices and temporary
availability are separate fields; null inherits the brand menu. Store overrides
cannot restore an item blocked by brand/inventory availability. Expiry is checked
on every read, quote, and order, with client refresh timers for idle storefronts
and POS screens. Writes use the existing permission catalog and a transaction
with a required before/after business audit entry. The existing screen outbox
receives store-scoped menu-change events.

The locations editor now manages store prices, sold-out state and optional
return time. Public storefronts choose a store before adding items; checkout
pins the selection into the draft, quote, order and retry fingerprint. POS menus
load the open drawer's store and adapt the canonical grouped menu response,
including modifiers. Both order writers reprice from their authoritative store.
Paused/closed stores reject new quotes and orders. Invalid store IDs reject
rather than silently selecting another store. Delivery origin/hours/timezone use
the selected store when supplied.

This implements the menu-override portion of F-02 and the operational per-store
86/return-time portion of F-17. It does **not** imply complete location-scoped
employment, inventory, tax or reporting. Existing legacy availability URLs now
adapt to the primary/acting device's store instead of changing the brand menu.

The location editor now preserves legacy single ranges and edits F-10 split-shift
arrays without collapsing them. Owners can add or remove ranges for each weekday;
closed days retain their configured ranges for later reopening. The editor also
supports dated special-hour overrides, including all-day closures. The evaluator's
overnight, split-shift, holiday and timezone behavior remains server-owned, while
the browser check verifies the multi-range and special-date save payloads and reset behavior.

The canonical POS split path now accepts quantity-level line selections in
addition to its existing whole-line payload, plus exact split-by-amount and
even-share requests that resolve to whole item quantities. A partial line creates a child
line, leaves the remainder on the source ticket, clones modifiers, and splits
active inventory reservations proportionally inside the same transaction. The
source and child totals are recalculated after the move; duplicate selections,
invalid quantities, payment activity, delivery tickets, and emptying the source
ticket remain guarded. The legacy split endpoint is still absent.

Migrations 978 and 979 add bounded `course_number` and optional `seat_number`
fields to every order line, defaulting existing and unlabelled tickets to
course 1 with no seat. POS creation validates courses 1 through 20 and seats 1
through 99, and POS/kitchen/receipt payloads expose both fields so downstream
screens can sequence service and support seat-level splits without trusting
client totals.

F-05 now exposes a paired-kitchen-device printer queue contract. A device token
can list, claim and acknowledge only printer jobs assigned to that device's
restaurant and location; runtime config publishes the queue paths and polling
interval. The queue remains the server-side handoff. The repository now
includes a bounded `server/scripts/restaurant-print-bridge.mjs` process that
uses the paired device token, claims queued jobs, validates the configured LAN
target, prints receipt or kitchen-ticket payloads locally, and acknowledges
success or leaves failures retryable. Physical printer/browser acceptance is
still required before this can be called a complete print deployment.
Manager-only allergen-label printing now reads the
restaurant's declared menu allergens, emits an ESC/POS label job, and exposes a
store-aware merchant control; no-label orders fail closed and no order or
payment state is changed. Fixed label text on those jobs now follows the
restaurant's configured receipt locale across en, es, fr, ht, and ar, while
the existing English output remains the default for legacy restaurants.

The host-stand tranche adds migration 964 and location-scoped tables,
reservations, and walk-in waitlist records. Reservation creation is
idempotent, checks table capacity and overlapping active bookings under a
transaction, and all writes stay behind the restaurant permission gate. The
merchant Operations panel can create tables and reservations, update
reservation state, add walk-ins, seat them, and send a transactional SMS
notification. SMS delivery is fail-closed when the provider is unavailable;
the entry is not marked notified until the provider accepts the message.

Public storefronts can now submit a future reservation request without
merchant credentials. The endpoint requires a contact method, bounded party
size and reservation window, and an idempotency key; it records a pending,
location-scoped request without assigning a table. The restaurant page exposes
the localized request form and leaves confirmation to the merchant Operations
workflow. Managers can send one guarded SMS notification for a pending or
confirmed request; the notification timestamp is persisted by migration 986
and retries after a successful send are acknowledged without sending again.
Migration 987 adds a five-minute claim lease so concurrent manager clicks
cannot send duplicate SMS messages; failed sends release the claim for retry.
Successful sends also append a business activity event with the provider
reference and reservation state.
Provider delivery, race testing against a live SMS service, and
populated-store/browser acceptance remain open.

Migration 965 adds optional store tax and service-fee rates, tax-inclusive
pricing, and a jurisdiction label. A selected store overrides the brand rate
for authoritative quote and order totals; existing stores inherit the brand
policy when the override is blank. The location editor exposes these controls,
and the order stores the effective rate and inclusive flag in its pricing
snapshot.

Migration 966 adds nullable online and in-store pacing caps per location plus a
bounded prep-time extension. A blank cap inherits the restaurant setting while
zero disables that channel cap at the store. The order lock enforces the
selected store/channel window, and quotes/orders expose and apply the effective
prep estimate. This is source-level pacing behavior; peak-load and physical
terminal acceptance remain open.

Migration 967 adds nullable menu-item tax rates and an explicit tax-exempt
flag. Quote and order calculations allocate discounts across lines and compute
tax per item, while retaining the selected store rate as the fallback; the
pricing metadata includes the line breakdown for later provider or accounting
adapters.

The public menu now exposes the stored allergen labels as exclusion filters.
Selected exclusions are sent with every quote and order, and both server paths
reject a menu item whose authoritative allergen list intersects the request.
The selected exclusions are retained in the order pricing metadata so kitchen
and support surfaces can see the customer's safety preference.

Location creation and updates now append before/after snapshots to the existing
manager-visible business activity log, including hours, tax policy, channel
pacing caps, and prep extensions. This closes the location-policy audit write;
full resource coverage and owner-facing review across every adapter remain open.

The HQ location-comparison report now has CSV and XLSX downloads. The workbook
contains separate store-comparison and brand-total sheets, preserves each
currency as its own row, and is generated from the same net-collected report
facts as the JSON and CSV endpoints.

The web POS now has a cash-only offline replay lane. When order creation or
cash payment loses the network, the full order or the existing order payment
is stored in a bounded browser outbox with stable order and payment idempotency
keys. On reconnect, entries replay sequentially and are removed only after the
server acknowledges both steps; a closed shift or validation failure keeps the
entry for reconciliation. Card, mobile, credit, managed-screen drafts, and
Terminal store-and-forward remain fail-closed. This is not an in-store LAN
hub or physical payment-device acceptance.

The same POS now persists an in-progress ticket, fulfillment context, and
stable checkout/order identity for up to two hours. A reload restores the
ticket and an already-created unpaid order so the cashier can continue the
same idempotent payment attempt; successful payment, kitchen send, deliberate
clear, or offline cash queue completion clears the saved state.

Migration 968 adds explicit store-scoped staff assignments. The manager-facing
location-access API and Settings panel validate the membership and store
tenants, record before/after assignments, and enforce the boundary on store
menu reads and writes. Sales summary, close, comparison, and journal exports
apply the same active-store filter for assigned members. Existing members
without an assignment retain the legacy all-store scope during rollout; once
assigned, a member can only use the listed stores and may receive a store role
override.

Inventory item reads, adjustment history, and item mutations now use the same
assignment scope. New items must resolve to an accessible store; assigned
members cannot adjust, edit, or delete stock in a sibling store. Legacy rows
with a null location remain readable during the migration backfill, while new
writes always carry a location.

Migration 969 adds the same location column and primary-store backfill to
purchase requests and supplier issues. Their list and update paths filter by
assigned stores, and new records resolve and validate an explicit or primary
store before insertion.

Migration 970 adds an explicit restaurant labor policy. Payroll labor reports
now apply weekly overtime thresholds and multipliers to recorded time punches,
surface required-break exceptions, and expose the policy through the guarded
restaurant payroll API. The policy defaults are 40 hours, 1.5x overtime, and a
30-minute break after six hours; owners or payroll.view managers can update
them. Migration 977 adds recurring availability windows and manager-approved
shift swaps with atomic reassignment. Scheduling vendor integration and native
device acceptance remain open.

Migration 971 carries each inventory transfer's item store onto the transfer
record, backfills populated rows, and filters transfer listing and lifecycle
updates for assigned members. Transfer creation validates the item's store
before writing; null-location legacy rows remain available during rollout.

Migration 972 adds recipe mapping units, conversion factors, and yield
percentages. The inventory reports surface a period food-cost view that compares
recipe-theoretical usage with recorded usage adjustments and calculates cost
variance from the item's unit cost. Vendor catalogs, purchase-order matching,
and invoice reconciliation remain open.

Migration 973 adds a supplier catalog keyed to each store inventory item,
including supplier SKU, pack quantity/unit, currency, lead time, preferred
status, and current unit cost. Catalog reads and writes use the same assigned
store boundary and write inventory audit events.

Migration 974 links inventory receipts to a purchase request, records invoice
match status/total/currency, backfills and enforces receipt store scope, and
marks the linked request received only after the receipt transaction succeeds.
Invoice exceptions remain visible as status data; external invoice ingestion and
accounting adapters are still open.

Receipts also expose a guarded invoice-match update endpoint for invoices that
arrive after delivery. It validates the receipt and purchase-request store,
supports explicit unmatched/matched/exception states, preserves invoice totals
and currency, writes a before/after audit event without changing stock, and
exports receipt/invoice/store rows as a CSV contract for accounting ingestion.

Migration 975 binds legacy display pairings to an active store and backfills
the primary store. Pairing codes select that store, display managers must hold
the assigned-store scope, token verification carries the store identity, and
kitchen ticket actions reject a sibling-store order.

Migration 976 adds a store key to receipt-printer settings, backfills existing
rows to the primary store, and keeps a guarded legacy row only for restaurants
that do not yet have a store. The merchant settings card lists the stores and
sends the selected store with save and test requests; receipt jobs select the
order's store printer and reject an explicitly mismatched store.

## Requirements matrix

`Existing source` means an earlier branch change exists; it is not a fresh
end-to-end acceptance claim. Each row retains the review's full scope.

| ID | Current boundary | Remaining implementation / acceptance |
| --- | --- | --- |
| F-01 | Existing timezone capture, validation, business copy and backfill | Populated-store owner confirmation and onboarding/browser acceptance |
| F-02 | Existing location columns/counters/hours; this pass adds store menu and customer selection; hosting records are location-scoped; migrations 968 and 976 add store-scoped staff assignments and receipt-printer settings, menu enforcement, store-filtered sales reports, assigned-store inventory reads/writes, and an audited HQ override-policy publish contract; migration 988 adds tenant-bound nested HQ regions and audited store assignment; migration 989 makes operational store identity non-null with composite tenant FKs and database resolution triggers; manager rollups, POS drawer events, managed-screen snapshots/changes/control/ticket actions, runner inbox tasks, display fleet listing, kitchen station reads/routing/writes, runner settlements, crew shift/task/event paths, POS sync status/acknowledgement, POS receipt-event history, and receipt audit writers now honor assigned-store sets | Full data-boundary adoption across every remaining adapter plus populated multi-store acceptance |
| F-03 | Existing cashier own-drawer tender, Terminal intent gate, receipt-event gate, and permission resolver | Exercise custom grants/denials and approvals across every money surface |
| F-04 | Existing stable order/payment retry IDs and pay-first hold; POS checkout state now survives reload for a bounded window and cash replay preserves the same identities | Lost-response/concurrent replay verification across every kitchen/display/runner fire path |
| F-05 | Existing production server-dial prohibition and print queue; this pass adds paired kitchen-device queue endpoints, runtime contract, store-scoped receipt-printer settings/jobs, and the executable LAN bridge | Physical device/browser acceptance |
| F-06 | Existing Connect-bound Terminal flow, token permission gate, and card-intent reservation gate | Provider sandbox/readers and reconciliation acceptance |
| F-07 | Existing local-day net-collected reports, currencies, summary CSV and tender-level journal CSV; this pass adds per-store/currency daily close, multi-day location comparison JSON/CSV/XLSX, theoretical/actual/variance food-cost percentages, labor percentage output against paid sales, QuickBooks/Xero import-ready journal contracts with stable account codes, and migration 985's dynamic-reference integration plus idempotent currency-scoped journal outbox | Authenticated provider API posting, account mapping confirmation, and populated external-ledger reconciliation |
| F-08 | Existing offline drafts and failure reporting; web POS adds cash-only browser outbox replay with stable order/payment idempotency keys and sequential reconnect processing | In-store hub, Terminal store-and-forward/risk policy, and physical outage acceptance |
| F-09 | The broken legacy food split route is removed; POS splitting uses the canonical transactional `splitPosOrder` path with whole-line, quantity-level, exact amount, and even-share selection, modifier/reservation cloning, course/seat preservation, payment, delivery, non-empty-ticket, store inheritance, and queue-counter guards | Maintain canonical split guards and populated-db acceptance |
| F-10 | Existing overnight/split-shift/holiday/timezone evaluator; this pass adds a multi-range and dated special-hours location editor | Scheduling/device acceptance and populated-store special-date acceptance |
| F-11 | Existing dayparts and scheduled fire filtering | Verify all scheduling paths and store-selected quote/submit invariants |
| F-12 | Existing onboarding fulfillment defaults | End-to-end first-store POS acceptance |
| F-13 | Existing table-name aliases | Device/counter/kitchen contract acceptance |
| F-14 | Existing server-priced payment totals | Browser change/tax/tip/fee and retry acceptance |
| F-15 | Existing restaurant discount definitions and PIN approvals | Complete brand/store policy and reporting acceptance |
| F-16 | Existing unpaid completion guards; unpaid completion overrides now use the `orders.manage` catalog permission, including membership overrides | Verify every kitchen, display, runner, counter and manager exception path |
| F-17 | This pass adds per-store availability, timed restock, audit, POS/kitchen grants | Full per-store inventory integration and all native/KDS UI adoption |
| F-18 | Existing daily counters and routing/Stripe lock reduction | Concurrent 50-store load and lock-observation evidence |
| F-19 | Migrations 965 and 967 add store policy plus item-level tax rates/exemptions; quote/order snapshots include a line tax breakdown | Provider integration and populated-store tax acceptance |
| F-20 | Existing menu item/category/modifier, settings/tax, store-menu, location-policy, printer-settings, store-membership, and server-validated POS receipt before/after audit writes are covered | Audit coverage across every remaining resource and owner-visible history acceptance |
| F-21 | Existing PIN sessions, switching, lockout and keyed lookup | Native/shared-device and multi-store identity acceptance |
| F-22 | Existing time punches, wages, labor, tips and CSV foundation; migration 970 adds configurable weekly overtime pricing and required-break exception reporting; migration 977 adds recurring availability windows and manager-approved shift swaps with atomic reassignment, with staff availability/swap audit events | Scheduling vendor integration and native timeclock/device acceptance |
| F-23 | Existing inventory quantities/mappings/counts and location column; assigned-member item reads, adjustment history, item writes, procurement, and transfer reads/writes now enforce store scope; migrations 972-974 add recipe costing, supplier catalogs, receipt-to-request invoice matching, late-invoice reconciliation with audited match states, a receipt CSV accounting-ingestion contract, and food-cost percentage output | External invoice ingestion and populated external-provider invoice acceptance |
| F-24 | Existing five-language cleanup; new store UI parity in both catalogs; fixed receipt and allergen-label text follows the configured locale | Full-screen human language acceptance |
| F-25 | Existing logical CSS cleanup | Full POS/KDS/merchant RTL visual acceptance |
| F-26 | The authenticated `GET /api/restaurants/:restaurantId/devices` fleet contract now gives app-device and legacy display-pairing records one read model with source/capability identifiers, applies assigned-store filtering, and uses a safe legacy display-role fallback; receipt-printer settings and queued jobs carry the selected store; kiosk configuration uses the `settings.manage` permission catalog | Canonical credential identity, native print bridge, deprecated write adapters, resource-controller convergence |
| F-27 | Existing display grants, 90-day expiry/rotation, revoke-by-unpair, and migration 975 store-bound pairing tokens with sibling-store kitchen-action rejection | Populated store-role and physical device acceptance |
| F-28 | Existing transactional primary-location update and validation | Populated database concurrency acceptance |
| F-29 | Existing edit/pause/close/timezone/hours/location UI plus store-role assignment panel and region assignment | Full multi-range hours editor and populated store-role/region acceptance |
| F-30 | Existing src tests and loader in CI | Retain browser/device regression coverage as surfaces converge |
| F-31 | Ticket, payment, printing, drawer-event, crew, runner, restaurant support, kiosk, help-request, team-comms, staff-document, shared-device POS manager, and Credit partner reporting gates now resolve the permission catalog (including membership overrides) instead of role-name checks; staff printer-job creation, queue visibility, feed acknowledgements, and drawer-event reads/writes require their POS or kitchen permissions; bootstrap `canManage` follows the same resolver | Custom membership and deny-override acceptance on every adapter |
| F-32 | Existing per-store per-day atomic counters | Concurrent multi-store rollover and peak-load acceptance |
| F-33 | Migration 966 adds per-store online/in-store pacing caps, inheritance/disable semantics, and prep extensions applied to quote/order estimates | Peak-load/lock evidence and physical terminal/channel acceptance |

## Additional named deliverables still in scope

The review also requests further split-workflow coverage, brand-wide loyalty
programs and CRM campaign delivery,
delivery-marketplace menu/order adapters, and live QuickBooks/Xero provider
adapters,
unified onboarding/hardware pairing, full HQ menu/compliance publishing and
end-to-end store acceptance. Allergen label printing is now implemented as a
manager-only, store-scoped queued printer job; physical label stock and device
acceptance remain open. Migration 980 adds manager-audited physical/e-gift card
SKUs as the catalog foundation and migration 982 adds an internal append-only
hashed-code value ledger with idempotent issue, redeem, refund, lookup, and POS
redemption paths. Generated codes are returned only at issue time; raw codes are
never stored. E-gift delivery-provider dispatch and external value
reconciliation remain release-gated. Migration 981 adds restaurant-scoped CRM segment
definitions with bounded criteria (lifetime points, paid-order count, recency,
and optional store) and an aggregate-only audience preview. Migration 983 adds
approval-gated campaign definitions and consent-aware in-app/email delivery
queues. Customer identity remains excluded from merchant responses; provider
delivery failures stay retryable and auditable. Migration 984 adds provider-neutral
DoorDash/Uber Eats/Grubhub integration records, dynamic secret-reference fields,
available-menu export, and idempotent inbound order state queues. Live provider
OAuth/webhook verification and local food-order creation remain deployment-gated.
The localized merchant gift-card panel now issues cards with an idempotency key
and reveals a generated code only in the issue response.
The restaurant HQ surface now provides a permission-filtered, location-native
business view with store comparison, currency-separated net-collected sales, latest audit score,
high-severity open findings, checklist completion, and current training
completion/overdue counts; it does not merge currencies or reveal customer
identity. Compliance facts are read-only aggregates scoped to the requested
date range for checklists and the accessible business stores for training.
HQ can also publish an approved source store's existing menu override policy to
selected same-restaurant stores in one audited transaction. The operation is
bounded to the caller's assigned stores and leaves the central menu and
unrelated target overrides untouched.
Migration 988 adds tenant-bound nested HQ regions beneath the restaurant brand
anchor. Existing stores are placed in the `all-stores` root, new stores default
there, and the merchant location editor and HQ panel can assign or create
regions. Cross-brand assignment and parent cycles fail closed; region writes
are audited. Remaining store-record backfill and populated multi-region
acceptance are still open.

Sales reports now expose `/reports/sales/accounting/quickbooks.csv` and
`/reports/sales/accounting/xero.csv`. These are read-only, store-scoped import
contracts derived from the journal export. They use stable account codes for
sales, tax, service fees, delivery fees, tips, and payment clearing, preserve
currency and location columns, and never call an external provider. Live OAuth,
provider account mapping, posting, duplicate detection, and reconciliation
remain release-gated work. Migration 985 adds provider configuration records
for QuickBooks and Xero, stores only Secrets Manager dynamic references, and
persists an idempotent journal-export outbox with explicit sending, posted,
failed, and reconciliation-required states. The outbox is the handoff for a
future provider worker; it never claims that an external ledger has posted.
The merchant Reports panel now lists configured provider state and recent
currency-scoped journal exports through a bounded, payload-free status endpoint;
provider credentials remain outside the browser and the worker handoff is
explicitly labeled as pending external reconciliation.
The same report surface exposes `/reports/sales/bi.ndjson`, a versioned row-level
BI contract that excludes customer identity and preserves store, currency, and
minor-unit values.
Reservations, table records, floor-plan metadata, seat-state updates, and a
walk-in SMS waitlist are now implemented in the host-stand tranche. The merchant
panel now provides a location-scoped drag/drop floor plan backed by the table
position field; guest self-service and physical SMS/provider acceptance remain.
External vendor or
hardware decisions do not excuse independent software work on these flows.

## Verification

- `server`: `npx jest --runInBand --testPathPatterns='restaurantStoreMenu|restaurantAppFlow|foodController|foodOrderValidation|routeScopeGuard'` — **137 passed** (including bounded course, seat, and split-by-amount validation).
- `server`: `npx jest --runInBand --testPathPatterns='restaurantAppFlow' __tests__/restaurantAppFlow.test.js` — **58 passed**. The suite covers quantity-level and exact amount split reconciliation, bounded coursing and seating, and the device printer queue check verifies token-authenticated kitchen access and location-scoped query parameters.
- `client`: `npm run build:ci` — **passed** (typecheck, production build, i18n and emitted-asset verification).
- `client`: `node --test scripts/restaurantRender.browser-check.cjs scripts/restaurantCheckoutCard.browser-check.cjs scripts/restaurantStoreMenu.browser-check.cjs` — **3 passed**. The new store-menu check covers save/reset payloads, English/French/Arabic labels, RTL direction, narrow widths, and form labels.
- `client`: `node --test scripts/restaurantLocationHours.browser-check.cjs` — **1 passed**. The location-hours check loads a legacy multi-range day, preserves an all-day special closure, adds a dated one-off range, verifies the exact payload, and confirms the form resets.
- `migration rehearsal`: `DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --timeout-ms 600000` — **954/954 migrations passed twice**, including migrations 978-979's coursing and seat columns/constraints.
- `server`: `npx jest --runInBand --testPathPatterns='restaurantHosting' __tests__/restaurantHosting.test.js` — **5 passed**. Covers location-scoped table conflict detection, reservation idempotency, final-window validation, waitlist SMS acknowledgement, and floor-plan position updates.
- `server`: `npx jest --runInBand --testPathPatterns='restaurantReportsController' __tests__/restaurantReportsController.test.js` — **13 passed**. Covers per-store/currency daily close, multi-day location comparison in JSON, CSV, and XLSX, plus assigned-member filtering with a parameterized store predicate.
- `server`: `npx jest --runInBand __tests__/restaurantLocationAccess.test.js __tests__/restaurantStoreMenu.test.js __tests__/routeScopeGuard.test.js` — **38 passed**. Covers tenant-checked assignment replacement/clear, sibling-store denial, store-menu enforcement, and route scope registration.
- `server`: `npx jest --runInBand __tests__/restaurantInventoryController.test.js __tests__/restaurantInventoryOperations.test.js __tests__/restaurantInventoryOrderService.test.js` — **20 passed**. Covers assigned-store item, adjustment, purchase-request, and supplier-issue filtering, idempotent adjustments, and inventory operations.
- `server`: `npx jest --runInBand --testPathPatterns='foodController|foodOrderValidation' __tests__/foodController.test.js __tests__/foodOrderValidation.test.js` — **45 passed**. Includes the server-enforced allergen exclusion quote check.
- `server`: `npx jest --runInBand --testPathPatterns='routeScopeGuard' __tests__/routeScopeGuard.test.js` — **10 passed** after adding all host-stand routes.
- `server`: `npx jest --runInBand __tests__/restaurantPrinterLabels.test.js __tests__/restaurantPrinterSettings.db.test.js` — **4 passed, 13 skipped** without the explicit disposable printer database URL; localized receipt and allergen-label rendering pass and the DB suite remains fail-closed.
- `server`: `npx jest --runInBand __tests__/foodController.test.js __tests__/restaurantAppFlow.test.js __tests__/restaurantPosIntegrity.db.test.js __tests__/restaurantRunnerController.test.js __tests__/restaurantPayrollOvertime.test.js` — **94 passed, 19 skipped** after routing operational manager and unpaid-completion checks through the permission catalog; the disposable database suites remain fail-closed without their explicit opt-in URLs.
- `server`: `npx jest --runInBand __tests__/restaurantSupport.test.js __tests__/restaurantPublicVisibility.test.js` — **22 passed** after routing support case and kiosk configuration gates through `support.view`, `support.manage`, and `settings.manage`; the suites include denied membership response and kiosk paths.
- `server`: `npx jest --runInBand __tests__/oxsteedCreditPartnerController.test.js __tests__/restaurantAppFlow.test.js __tests__/restaurantSupport.test.js __tests__/restaurantPublicVisibility.test.js` — **82 passed** after routing Credit partner reporting through `credit.manage`; the focused set covers denied membership gates across the updated surfaces.
- `server`: `npx jest --runInBand __tests__/oxsteedCreditPartner.test.js __tests__/oxsteedCreditPartnerController.test.js` — **9 passed** after aligning the existing Credit partner response-contract tests with the catalog-backed `credit.manage` gate.
- `client`: `npm run verify:i18n`, `node scripts/growthInstrumentation.mjs --check`, and `npm run build:ci` — **passed** after adding the localized allergen-label printer control and gift-card catalog panel; growth coverage is 2,520/2,520 and emitted-asset verification covered 1,020 assets.
- `server`: `npx jest --runInBand __tests__/restaurantGiftCardController.test.js __tests__/restaurantGiftCardService.test.js __tests__/restaurantAppFlow.test.js` — **66 passed** across catalog validation, value-ledger issue/redeem/refund guards, POS redemption, and route scope registration.
- `migration rehearsal`: `DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --timeout-ms 600000` — **957/957 migrations passed** twice, including migration 982's gift-card value ledger.
- `server`: `npx jest --runInBand __tests__/restaurantLoyaltyCampaignService.test.js __tests__/restaurantLoyaltyController.test.js` — **6 passed, 7 skipped** (the skipped cases require the explicit disposable loyalty database URL).
- `migration rehearsal`: `DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --timeout-ms 600000` — **958/958 migrations passed** twice, including migration 983's campaign delivery queue.
- `server`: `npx jest --runInBand __tests__/restaurantDeliveryMarketplaceService.test.js __tests__/routeScopeGuard.test.js` — **13 passed** across provider/secret-reference validation, menu filtering, disabled-provider rejection, and route scope registration.
- `migration rehearsal`: `DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --timeout-ms 600000` — **959/959 migrations passed** twice, including migration 984's marketplace integration and order queue.
- `server`: `npx jest --runInBand __tests__/restaurantHQController.test.js __tests__/restaurantHQService.test.js __tests__/routeScopeGuard.test.js` — **18 passed** after making HQ rollups location-native and adding bounded menu-override publishing, its merchant console contract, and route registration.
- `server`: `npx jest --runInBand __tests__/restaurantAccountingService.test.js __tests__/restaurantHQController.test.js __tests__/restaurantHQService.test.js __tests__/routeScopeGuard.test.js` — **24 passed** across accounting dynamic-reference validation, bounded provider/export status listing, idempotent journal outbox states, location-native HQ rollups, bounded menu publishing, and route registration.
- `server`: `npx jest --runInBand __tests__/restaurantAccountingService.test.js __tests__/restaurantAppFlow.test.js` — **67 passed** after fixing accounting integration upsert shaping, adding the unified fleet assigned-store predicate, and covering the legacy display-role fallback.
- `server`: `npx jest --runInBand __tests__/restaurantAppFlow.test.js` — **63 passed** after requiring kitchen permissions for human printer-job creation, queue visibility, audit reads, event writes, and feed acknowledgements, including denied-member coverage.
- `server`: `npx jest --runInBand __tests__/restaurantAppFlow.test.js` — **65 passed** after applying assigned-store predicates to manager dashboard and report rollups, with regression coverage for order, kitchen, runner, inventory, device, and POS-sync queries.
- `server`: `npx jest --runInBand __tests__/restaurantAppFlow.test.js` — **66 passed** after gating POS drawer-event reads/writes by the permission catalog and preserving assigned-store filtering for manager rollups.
- `server`: `npx jest --runInBand __tests__/restaurantScreenSync.test.js` — **6 passed** after allowing multi-store assigned screen feeds while filtering other-store change events.
- `server`: `npx jest --runInBand __tests__/runnerWorkspace.test.js` — **9 passed** after filtering unified runner offers and assignments by active store memberships while preserving owner and legacy all-store behavior.
- `server`: `npx jest --runInBand __tests__/restaurantAppFlow.test.js` — **68 passed** after scoping kitchen station reads/routing/writes and runner settlement task/ledger access to assigned stores; owner behavior remains all-store.
- `server`: `npx jest --runInBand __tests__/restaurantAppFlow.test.js` — **69 passed** after requiring assigned-store identity for crew task creation and carrying it into task events; owner behavior remains all-store.
- `server`: `npx jest --runInBand __tests__/restaurantAppFlow.test.js` — **70 passed** after requiring assigned-store identity for POS sync acknowledgements and filtering status/history reads; owner behavior remains all-store.
- `server`: `npx jest --runInBand __tests__/restaurantPosController.test.js` — **3 passed** after filtering receipt-event reads by assigned store and carrying the order store into new receipt events.
- `server`: `npx jest --runInBand __tests__/restaurantAppFlow.test.js __tests__/restaurantPosController.test.js` — **73 passed** after carrying location identity through POS receipt audit and reprint writers.
- `server`: `npx jest --runInBand __tests__/restaurantPrintBridge.test.js` — **3 passed** across bridge configuration bounds, receipt target validation, claim/print/ack sequencing, and retryable failures.
- `migration rehearsal`: `DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --timeout-ms 600000` — **960/960 migrations passed**, including migration 985's accounting integration and export outbox schema.
- `client`: `npm run verify:i18n` — **passed** with the host-stand keys present in `en`, `es`, `fr`, `ht`, and `ar`.
- `server`: `npx jest --runInBand __tests__/restaurantHosting.test.js __tests__/routeScopeGuard.test.js` — **18 passed** after adding the persisted reservation-notification state, guarded manager route, single-send test, and concurrent-claim guard.
- `server`: `node --check server/controllers/restaurantHostingController.js` — **passed** after adding the short-lived reservation notification claim lease.
- `server`: host-stand notification tests also pass with the business activity audit write enabled.
- `client`: `npm run verify:i18n`, `node scripts/growthInstrumentation.mjs --write && --check` — **passed** with localized reservation-notification controls and growth coverage at 2,532/2,532.
- `client`: `npm run build:ci` — **passed** after adding the localized HQ comparison and menu-policy publishing console; typecheck, production build, i18n, and emitted-asset verification completed with the repository's existing chunk advisories.
- `client`: `npm run verify:i18n`, `node scripts/growthInstrumentation.mjs --write && --check`, and `npm run build:ci` — **passed** after adding the localized accounting integration/export status panel; growth coverage is 2,528/2,528 and emitted-asset verification covered 1,020 assets.
- `client`: `npm run build` — **passed**; Vite emitted the merchant bundle with the host-stand panel. Existing large-chunk and dynamic-import advisories remain.
- `server`: `npx jest --runInBand __tests__/restaurantHosting.test.js __tests__/routeScopeGuard.test.js` — **16 passed** after adding the bounded, contact-required, idempotent public reservation request route.
- `client`: `npm run verify:i18n` — **passed** after adding the localized public reservation request form in `en`, `es`, `fr`, `ht`, and `ar`.
- `server`: `npx jest --runInBand __tests__/restaurantPayrollOvertime.test.js` — **2 passed**. Covers weekly overtime allocation and required-break exception detection.
- `server`: `npx jest --runInBand __tests__/restaurantInventoryOperations.test.js` — **9 passed**. Covers assigned-store transfer filtering and transfer creation/lifecycle behavior.
- `server`: `npx jest --runInBand __tests__/restaurantInventoryController.test.js __tests__/restaurantInventoryOperations.test.js __tests__/routeScopeGuard.test.js` — **28 passed**. Includes recipe mapping validation and the food-cost report contract.
- `server`: `npx jest --runInBand __tests__/restaurantInventoryOperations.test.js` — **14 passed**. Includes assigned-store catalog filtering, supplier catalog upsert validation, late-invoice match/exception state handling, the receipt CSV contract, and food-cost percentages.
- `node scripts/migration-rehearsal.cjs --timeout-ms 600000` — **passed** against a disposable Colima PostgreSQL container; all 952 discovered migrations applied and replayed cleanly through migration 977.
- `server`: `npx jest --runInBand __tests__/businessStaffScheduleController.test.js` — **12 passed**. Covers shift persistence plus availability replacement, validation, swap requests, and atomic manager approval.
- `server`: `npx jest --runInBand __tests__/foodMenuOwnerManagement.test.js` — **5 passed**. Covers menu category before/after audit events alongside existing menu and modifier management.
- `server`: `npx jest --runInBand __tests__/restaurantPosController.test.js` — **2 passed**. Covers POS receipt permission enforcement and server-order total validation.
- `server/scripts/verifyRestaurantStoreMenu.js` — **passed** in the dedicated Colima PostgreSQL container. It applied migration 963 twice, verified default-store backfill/onboarding and legacy order/counter continuity, tenant foreign keys, negative prices, screen events, SQL projections, and sibling-store isolation.
- `client`: `npm run build:ci` — **passed**; Vite emitted and verified 1,020 assets. The existing build warnings are the repository's large-chunk and dynamic-import advisories.
- `client`: `node --test scripts/restaurantPosOfflineCash.test.mjs` — **passed**. Covers cash-only replay ordering, retention after a failed entry, and network-error classification.
- `client`: `node --test scripts/restaurantPosCheckoutPersistence.test.mjs` — **passed**. Covers bounded reload recovery of ticket/order identity and clearing stale or completed state.
- The broader restaurant Jest selection was also run with the local FFmpeg binary. It reached 768 passing tests, but the pre-existing media-transcode test still fails because it expects a 960x720 rendition while the current binary produces 1280x960. That unrelated media behavior is outside this store-menu change.
- `git diff --check` and JavaScript syntax checks for the changed server files pass.
- `node server/scripts/verifyRestaurantStoreMenu.js` creates a random temporary
  database only in a dedicated `oxsteed-franchise-*-test` container. It applies
  migration 963 twice and exercises the actual SQL projections, cross-tenant
  foreign keys, negative-price check, screen outbox emission, and sibling-store
  isolation. It drops only its own random database.
- No production database, Redis, uploads, stored-value controls, or deployment
  was modified. This isolated schema fixture does not replace the complete
  migration rehearsal or production acceptance.
