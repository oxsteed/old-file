# Restaurant franchise review implementation

Source requirements: [the supplied review](REVIEW-2026-10-20.md), all 33 findings,
feature-gap table, suggested flows, and phased roadmap. Work continues on
`codex/demand-sales-engine`. This is an **incomplete implementation**, not a
franchise-grade or production-readiness declaration. Existing fixes are retained;
no production migrations, deployment, financial activation, or provider-account
changes are authorized by this checkpoint.

## Current pass: store menu and split-shift hours controls

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

F-05 now exposes a paired-kitchen-device printer queue contract. A device token
can list, claim and acknowledge only printer jobs assigned to that device's
restaurant and location; runtime config publishes the queue paths and polling
interval. The queue remains the server-side handoff. A native LAN print bridge
and physical printer acceptance are still required before this can be called a
complete print deployment.

The host-stand tranche adds migration 964 and location-scoped tables,
reservations, and walk-in waitlist records. Reservation creation is
idempotent, checks table capacity and overlapping active bookings under a
transaction, and all writes stay behind the restaurant permission gate. The
merchant Operations panel can create tables and reservations, update
reservation state, add walk-ins, seat them, and send a transactional SMS
notification. SMS delivery is fail-closed when the provider is unavailable;
the entry is not marked notified until the provider accepts the message.

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

## Requirements matrix

`Existing source` means an earlier branch change exists; it is not a fresh
end-to-end acceptance claim. Each row retains the review's full scope.

| ID | Current boundary | Remaining implementation / acceptance |
| --- | --- | --- |
| F-01 | Existing timezone capture, validation, business copy and backfill | Populated-store owner confirmation and onboarding/browser acceptance |
| F-02 | Existing location columns/counters/hours; this pass adds store menu and customer selection; hosting records are location-scoped; migration 968 adds store-scoped staff assignments, menu enforcement, store-filtered sales reports, and assigned-store inventory reads/writes | Mandatory store IDs on every operational record, per-store printers, HQ/region hierarchy and full data-boundary adoption |
| F-03 | Existing cashier own-drawer tender and permission resolver | Exercise custom grants/denials and approvals across every money surface |
| F-04 | Existing stable order/payment retry IDs and pay-first hold; POS checkout state now survives reload for a bounded window and cash replay preserves the same identities | Lost-response/concurrent replay verification across every kitchen/display/runner fire path |
| F-05 | Existing production server-dial prohibition and print queue; this pass adds paired kitchen-device queue endpoints and runtime contract | Native LAN print bridge and physical device/browser acceptance |
| F-06 | Existing Connect-bound Terminal flow and token permission gate | Provider sandbox/readers and reconciliation acceptance |
| F-07 | Existing local-day net-collected reports, currencies, summary CSV and tender-level journal CSV; this pass adds per-store/currency daily close and multi-day location comparison JSON/CSV/XLSX | Labor and food-cost percentages; accounting-system adapters |
| F-08 | Existing offline drafts and failure reporting; web POS adds cash-only browser outbox replay with stable order/payment idempotency keys and sequential reconnect processing | In-store hub, Terminal store-and-forward/risk policy, and physical outage acceptance |
| F-09 | Existing broken split-route adapter | Maintain canonical split guards and populated-db acceptance |
| F-10 | Existing overnight/split-shift/holiday/timezone evaluator; this pass adds a multi-range and dated special-hours location editor | Scheduling/device acceptance and populated-store special-date acceptance |
| F-11 | Existing dayparts and scheduled fire filtering | Verify all scheduling paths and store-selected quote/submit invariants |
| F-12 | Existing onboarding fulfillment defaults | End-to-end first-store POS acceptance |
| F-13 | Existing table-name aliases | Device/counter/kitchen contract acceptance |
| F-14 | Existing server-priced payment totals | Browser change/tax/tip/fee and retry acceptance |
| F-15 | Existing restaurant discount definitions and PIN approvals | Complete brand/store policy and reporting acceptance |
| F-16 | Existing unpaid completion guards | Verify every kitchen, display, runner, counter and manager exception path |
| F-17 | This pass adds per-store availability, timed restock, audit, POS/kitchen grants | Full per-store inventory integration and all native/KDS UI adoption |
| F-18 | Existing daily counters and routing/Stripe lock reduction | Concurrent 50-store load and lock-observation evidence |
| F-19 | Migrations 965 and 967 add store policy plus item-level tax rates/exemptions; quote/order snapshots include a line tax breakdown | Provider integration and populated-store tax acceptance |
| F-20 | Existing menu/settings/tax audit emitters; store-menu, location-policy, printer-settings, and store-membership before/after audit writes are covered | Audit coverage across every remaining resource and owner-visible history acceptance |
| F-21 | Existing PIN sessions, switching, lockout and keyed lookup | Native/shared-device and multi-store identity acceptance |
| F-22 | Existing time punches, wages, labor, tips and CSV foundation | Scheduling integration/rules, availability/swaps, break/overtime compliance and native timeclock |
| F-23 | Existing inventory quantities/mappings/counts and location column; assigned-member item reads, adjustment history, and item writes now enforce store scope | Store-isolated transfers, unit/yield recipes, period COGS/variance, vendor catalogs and PO/invoice matching |
| F-24 | Existing five-language cleanup; new store UI parity in both catalogs | Server/receipt and full-screen human language acceptance |
| F-25 | Existing logical CSS cleanup | Full POS/KDS/merchant RTL visual acceptance |
| F-26 | Three device systems remain | Canonical device identity and print bridge, deprecated API adapters, resource-controller convergence |
| F-27 | Existing display grants and token expiry | Store scoping and actual rotation/revoke device acceptance |
| F-28 | Existing transactional primary-location update and validation | Populated database concurrency acceptance |
| F-29 | Existing edit/pause/close/timezone/hours/location UI plus store-role assignment panel | Full multi-range hours editor and populated store-role acceptance |
| F-30 | Existing src tests and loader in CI | Retain browser/device regression coverage as surfaces converge |
| F-31 | Existing ticket/payment/printing permission gates | Custom membership and deny-override acceptance on every adapter |
| F-32 | Existing per-store per-day atomic counters | Concurrent multi-store rollover and peak-load acceptance |
| F-33 | Migration 966 adds per-store online/in-store pacing caps, inheritance/disable semantics, and prep extensions applied to quote/order estimates | Peak-load/lock evidence and physical terminal/channel acceptance |

## Additional named deliverables still in scope

The review also requests coursing and expanded splits, brand loyalty/CRM, physical/e-gift
card products, delivery-marketplace menu/order adapters, QuickBooks/Xero and BI
exports, allergen label printing, unified onboarding/hardware
pairing, HQ compliance publishing/rollups and end-to-end store acceptance.
Reservations, table records, floor-plan metadata, seat-state updates, and a
walk-in SMS waitlist are now implemented in the host-stand tranche. The merchant
panel now provides a location-scoped drag/drop floor plan backed by the table
position field; guest self-service and physical SMS/provider acceptance remain.
External vendor or
hardware decisions do not excuse independent software work on these flows.

## Verification

- `server`: `npx jest --runInBand --testPathPatterns='restaurantStoreMenu|restaurantAppFlow|foodController|foodOrderValidation|routeScopeGuard'` — **127 passed**.
- `server`: `npx jest --runInBand --testPathPatterns='restaurantAppFlow' __tests__/restaurantAppFlow.test.js` — **52 passed**. The device printer queue check verifies token-authenticated kitchen access and location-scoped query parameters.
- `client`: `node --test scripts/restaurantRender.browser-check.cjs scripts/restaurantCheckoutCard.browser-check.cjs scripts/restaurantStoreMenu.browser-check.cjs` — **3 passed**. The new store-menu check covers save/reset payloads, English/French/Arabic labels, RTL direction, narrow widths, and form labels.
- `client`: `node --test scripts/restaurantLocationHours.browser-check.cjs` — **1 passed**. The location-hours check loads a legacy multi-range day, preserves an all-day special closure, adds a dated one-off range, verifies the exact payload, and confirms the form resets.
- `server`: `npx jest --runInBand --testPathPatterns='restaurantHosting' __tests__/restaurantHosting.test.js` — **5 passed**. Covers location-scoped table conflict detection, reservation idempotency, final-window validation, waitlist SMS acknowledgement, and floor-plan position updates.
- `server`: `npx jest --runInBand --testPathPatterns='restaurantReportsController' __tests__/restaurantReportsController.test.js` — **13 passed**. Covers per-store/currency daily close, multi-day location comparison in JSON, CSV, and XLSX, plus assigned-member filtering with a parameterized store predicate.
- `server`: `npx jest --runInBand __tests__/restaurantLocationAccess.test.js __tests__/restaurantStoreMenu.test.js __tests__/routeScopeGuard.test.js` — **38 passed**. Covers tenant-checked assignment replacement/clear, sibling-store denial, store-menu enforcement, and route scope registration.
- `server`: `npx jest --runInBand __tests__/restaurantInventoryController.test.js __tests__/restaurantInventoryOperations.test.js __tests__/restaurantInventoryOrderService.test.js` — **20 passed**. Covers assigned-store item, adjustment, purchase-request, and supplier-issue filtering, idempotent adjustments, and inventory operations.
- `server`: `npx jest --runInBand --testPathPatterns='foodController|foodOrderValidation' __tests__/foodController.test.js __tests__/foodOrderValidation.test.js` — **45 passed**. Includes the server-enforced allergen exclusion quote check.
- `server`: `npx jest --runInBand --testPathPatterns='routeScopeGuard' __tests__/routeScopeGuard.test.js` — **10 passed** after adding all host-stand routes.
- `client`: `npm run verify:i18n` — **passed** with the host-stand keys present in `en`, `es`, `fr`, `ht`, and `ar`.
- `client`: `npm run build` — **passed**; Vite emitted the merchant bundle with the host-stand panel. Existing large-chunk and dynamic-import advisories remain.
- `node scripts/migration-rehearsal.cjs --timeout-ms 600000` — **passed** against a disposable Colima PostgreSQL container; all 944 discovered migrations applied and replayed cleanly, including migrations 964, 965, 968, and 969.
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
