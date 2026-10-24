# Assigned-store isolation follow-up

Implemented on `codex/restaurant-gift-card-fulfillment`, alongside gift-card fulfillment in PR #627. This addresses the approved two-store audit of POS, inventory, reporting, workforce access and paired devices. It does not declare the entire franchise review production-ready.

## Access policy

The server resolves current business membership and store assignments. An explicitly assigned member can use only those stores, including when replaying a previous operation identity. Records without known store identity are excluded from assigned-store access. Owners and existing all-store members retain cross-store access; a member without active assignments still has the established legacy all-store scope. This follow-up does not silently migrate legacy members into a different policy.

All-store authority is required to replace/clear store grants, create stores, publish brand configuration and administer business-wide staff membership. Grant clearing is transactional and requires audit evidence. Assigned managers cannot remove their own store restriction by clearing grants or creating unscoped invitations. Roster reads exclude sibling-store identities and pay rates.

## Audited paths and corrections

| Area | Boundary and evidence |
| --- | --- |
| Orders and POS | Merchant order feeds and individual staff reads now apply assigned stores. Status transitions validate the target before replay or financial work. Receipt and reprint retries validate both the saved store and order identity. Existing native checkout, payment, refund and ticket guards are exercised with sibling orders. Customers can still read their own orders. |
| Inventory and procurement | Existing-item mutation rejects unknown/sibling stores. Purchase-request and supplier-issue retries validate the saved record before returning it. Transfers, supplier catalogs and vendor-price history exclude unknown/sibling stores. Receiving rejects mismatched stock before writes. |
| Reports and exports | Inventory, operational and loyalty constituents use the same store boundary. Repeat-order/cohort calculations include only scoped orders; training totals use the assignee's active store memberships. Real PostgreSQL export tests also uncovered and fixed malformed business-date SQL in journal/accounting/BI exports. Currency and permission rules are preserved. |
| Devices and printers | Bootstrap/config/fleet/hub lists exclude sibling stores. Device status changes lock the scoped canonical row; native token/config updates retain a store predicate in the mutation. Pairing and relocation validate the destination. Human printer actions honor staff assignments, and fallback credential paths retain the authenticated device's store. Hub authentication rejects a source device moved away from the hub's store. |
| Staff identity | Restricted managers cannot mint sibling/global PINs or assign them to sibling staff. Legacy global PINs check the person's current store grants at unlock, including after reassignment. Status retries retain a consistent advisory/row-lock order for concurrent assigned and all-store actors. |
| Workforce | Both schedule APIs, shift swaps, punches, manual hours, time-off decisions and labor rules honor current restaurant scope. An omitted store on a restricted member's new shift/punch resolves to their sole assigned store; multiple assignments require an explicit choice. Nonrestaurant businesses retain their existing behavior. |

## Verification

The added `server/__tests__/restaurantStoreIsolation.db.test.js` uses the actual scope and permission services against a fully migrated disposable loopback PostgreSQL database. Its fixtures contain a brand, two stores, an owner, an all-store manager, assigned managers and staff, populated orders/stock/devices/workforce records, and synthetic retry identities. Notifications/providers are mocked. CI explicitly clones `restaurant_store_test` from its migrated template and runs the suite; ordinary unit runs skip it without explicit database opt-in.

Commands and results for this checkpoint:

- `DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --keep`: **1,002/1,002 migrations applied and replayed successfully**, including the gift-card migration already on this branch. No new migration was needed for this follow-up.
- With explicit synthetic `RESTAURANT_STORE_TEST_DATABASE_URL` and `GIFT_CARD_TEST_DATABASE_URL`, `npm --prefix server test -- --runInBand --testPathPatterns='restaurantStoreIsolation.db|restaurantGiftCardFulfillment.db|foodController.test|foodOrderStatusDeviceAuth|foodOrderRefundAudit|foodOrderLoop|foodOrderValidation|businessHubBrokenG'`: **161 passed across eight suites: 60 assigned-store cases, 15 gift-card fulfillment cases and 86 adapter regressions**, using separate clones of the fresh 1,002-migration schema for database cases.
- `npm --prefix server test -- --runInBand --testPathPatterns='restaurant|storeHub|businessStaffScheduleController|staffScheduling|businessMembersController|scopeModel|permissionsService' --testPathIgnorePatterns='restaurantMediaVideo.test.js|restaurantPrepTimeAutoExtend.db.test.js'`: **778 passed across 79 suites**. Opt-in database cases were skipped in this ordinary unit selection. The initial unfiltered selection also passed 20 media cases but failed the existing real-FFmpeg cases (`/usr/bin/ffmpeg` unavailable) and the prep-time suite's explicit `credit_statement_test` prerequisite. Those two suites were not claimed green.
- The direct CI-style Jest invocation with `--runInBand --detectOpenHandles` also passed all **60 store-isolation cases** and exited normally without `--forceExit`.
- CI YAML parsing and the new DB step's `bash -n` passed. Changed JavaScript syntax and `git diff --check` passed.

No browser source changed in this follow-up; the gift-card browser/build evidence remains documented separately. No live provider message, production migration, deployment, stored-value activation or Credit/growth flag change was performed.

## Remaining acceptance

Review the checks for the pushed commit. Then perform controlled acceptance using populated Store A and Store B accounts and the actual paired POS/kitchen/printer devices, confirming the same restrictions through the browser/native adapters and offline reconnect/retry flows. Physical printers, live gift-card email delivery and external reconciliation remain the separate acceptance items in `GIFT-CARD-FULFILLMENT-2026-10-23.md`. Source and disposable-database tests do not establish production deployment or exhaustive coverage of future integrations.
