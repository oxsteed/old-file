# Restaurant franchise review implementation

Source requirements: [the supplied review](REVIEW-2026-10-20.md), all 33 findings,
feature-gap table, suggested flows, and phased roadmap. Work continues on
`codex/demand-sales-engine`. This is an **incomplete implementation**, not a
franchise-grade or production-readiness declaration. Existing fixes are retained;
no production migrations, deployment, financial activation, or provider-account
changes are authorized by this checkpoint.

## Current pass: store menu and temporary sold-out controls

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

## Requirements matrix

`Existing source` means an earlier branch change exists; it is not a fresh
end-to-end acceptance claim. Each row retains the review's full scope.

| ID | Current boundary | Remaining implementation / acceptance |
| --- | --- | --- |
| F-01 | Existing timezone capture, validation, business copy and backfill | Populated-store owner confirmation and onboarding/browser acceptance |
| F-02 | Existing location columns/counters/hours; this pass adds store menu and customer selection | Store-scoped roles/employment, mandatory store IDs, per-store tax/inventory/printers, HQ/region hierarchy and data boundaries |
| F-03 | Existing cashier own-drawer tender and permission resolver | Exercise custom grants/denials and approvals across every money surface |
| F-04 | Existing stable order/payment retry IDs and pay-first hold | Lost-response/concurrent replay and reload resilience; verify all kitchen fire paths |
| F-05 | Existing production server-dial prohibition and print queue | Working paired in-store print bridge and device/browser acceptance |
| F-06 | Existing Connect-bound Terminal flow and token permission gate | Provider sandbox/readers and reconciliation acceptance |
| F-07 | Existing local-day net-collected reports, currencies and CSV | Canonical per-store/brand facts, daily close/Z-report, XLSX/journal and HQ comparisons |
| F-08 | Existing offline drafts and failure reporting | In-store hub, offline cash with idempotent replay, Terminal store-and-forward/risk policy |
| F-09 | Existing broken split-route adapter | Maintain canonical split guards and populated-db acceptance |
| F-10 | Existing overnight/split-shift/holiday/timezone evaluator | Full multi-range editor and scheduling/device acceptance |
| F-11 | Existing dayparts and scheduled fire filtering | Verify all scheduling paths and store-selected quote/submit invariants |
| F-12 | Existing onboarding fulfillment defaults | End-to-end first-store POS acceptance |
| F-13 | Existing table-name aliases | Device/counter/kitchen contract acceptance |
| F-14 | Existing server-priced payment totals | Browser change/tax/tip/fee and retry acceptance |
| F-15 | Existing restaurant discount definitions and PIN approvals | Complete brand/store policy and reporting acceptance |
| F-16 | Existing unpaid completion guards | Verify every kitchen, display, runner, counter and manager exception path |
| F-17 | This pass adds per-store availability, timed restock, audit, POS/kitchen grants | Full per-store inventory integration and all native/KDS UI adoption |
| F-18 | Existing daily counters and routing/Stripe lock reduction | Concurrent 50-store load and lock-observation evidence |
| F-19 | Restaurant-wide flat tax remains | Item categories, store jurisdictions, inclusive/exclusive rules, fees/exemptions, rule snapshots and provider integration |
| F-20 | Existing menu/settings/tax audit emitters; required store-menu audit added | Audit coverage across every resource and owner-visible history acceptance |
| F-21 | Existing PIN sessions, switching, lockout and keyed lookup | Native/shared-device and multi-store identity acceptance |
| F-22 | Existing time punches, wages, labor, tips and CSV foundation | Scheduling integration/rules, availability/swaps, break/overtime compliance and native timeclock |
| F-23 | Existing inventory quantities/mappings/counts and location column | Store-isolated stock/transfer, unit/yield recipes, period COGS/variance, vendor catalogs and PO/invoice matching |
| F-24 | Existing five-language cleanup; new store UI parity in both catalogs | Server/receipt and full-screen human language acceptance |
| F-25 | Existing logical CSS cleanup | Full POS/KDS/merchant RTL visual acceptance |
| F-26 | Three device systems remain | Canonical device identity and print bridge, deprecated API adapters, resource-controller convergence |
| F-27 | Existing display grants and token expiry | Store scoping and actual rotation/revoke device acceptance |
| F-28 | Existing transactional primary-location update and validation | Populated database concurrency acceptance |
| F-29 | Existing edit/pause/close/timezone/hours/location UI | Full multi-range hours editor and store-role acceptance |
| F-30 | Existing src tests and loader in CI | Retain browser/device regression coverage as surfaces converge |
| F-31 | Existing ticket/payment/printing permission gates | Custom membership and deny-override acceptance on every adapter |
| F-32 | Existing per-store per-day atomic counters | Concurrent multi-store rollover and peak-load acceptance |
| F-33 | Existing pacing/busy settings foundation | Per-store/channel slot capacity, automatic prep extension and load acceptance |

## Additional named deliverables still in scope

The review also requests reservations, table/floor-plan/seat workflows, a walk-in
SMS waitlist, coursing and expanded splits, brand loyalty/CRM, physical/e-gift
card products, delivery-marketplace menu/order adapters, QuickBooks/Xero and BI
exports, allergen ordering filters/label printing, unified onboarding/hardware
pairing, HQ compliance publishing/rollups and end-to-end store acceptance.
These have **not** been completed by the store-menu pass. External vendor or
hardware decisions do not excuse independent software work on these flows.

## Verification

- `server`: `npx jest --runInBand --testPathPatterns='restaurantStoreMenu|restaurantAppFlow|foodController|foodOrderValidation|routeScopeGuard'` — **127 passed**.
- `client`: `node --test scripts/restaurantRender.browser-check.cjs scripts/restaurantCheckoutCard.browser-check.cjs scripts/restaurantStoreMenu.browser-check.cjs` — **3 passed**. The new store-menu check covers save/reset payloads, English/French/Arabic labels, RTL direction, narrow widths, and form labels.
- `server/scripts/verifyRestaurantStoreMenu.js` — **passed** in the dedicated Colima PostgreSQL container. It applied migration 963 twice, verified default-store backfill/onboarding and legacy order/counter continuity, tenant foreign keys, negative prices, screen events, SQL projections, and sibling-store isolation.
- `client`: `npm run build:ci` — **passed**; Vite emitted and verified 1,020 assets. The existing build warnings are the repository's large-chunk and dynamic-import advisories.
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
