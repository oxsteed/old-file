# Connected two-store service cycle

The default-branch follow-up adds `server/__tests__/restaurantServiceCycle.db.test.js`
to the explicit PostgreSQL CI step alongside `restaurantStoreIsolation.db.test.js`.
It is an HTTP-handler integration test with the complete migrated schema and real
membership, permission, store-scope, transaction, payment, inventory and reporting
services. Test middleware supplies fixture user identities. It does not exercise
JWT login, browser rendering, native clients, physical printers or live providers.
External notification/processor transports remain mocked by the test setup.

## Connected scenarios

Each kitchen release mode, `on_send` and `on_pay`, starts with a new brand,
two stores, an owner, assigned managers, a Store A cashier, stock and print stations.
All financial activity uses synthetic cash ledger entries in an explicitly opted-in,
fully migrated loopback `restaurant_store_test` database.

1. Open independent drawers with starting cash; refuse sibling drawer close.
2. Create a two-course, two-seat ticket, retry its checkout identity and confirm
   the same ticket. Deny sibling checkout replay and split.
3. Split the second seat before tendering, preserving its course, store and
   reservation, without reusing the original checkout identity. Verify original
   checkout replay still returns the original ticket after the split.
4. Verify sent tickets remain released and unpaid on-pay tickets are hidden from
   the kitchen feed. Populate and tender a Store B sale so scope leaks are visible.
5. Race two identical cash tender requests for each Store A ticket. Require one
   payment identity, correct paid state, one initial print per fired ticket, and
   conflict on a changed amount. Already-sent split items are not printed twice.
6. Hold/fire each course, replay hold and race fire retries, verifying one chit
   per action. Deny sibling operations and replay. Start items, refuse premature
   quality-check completion, finish items, mark ready with the explicit readiness
   gate, and hand out each paid ticket.
7. Deny cashier and sibling-manager refunds; race manager refund retries and
   require one refund. Close Store A with exactly 7,600 cents: 5,000 opening cash
   plus 3,000 collected minus 400 refunded. Verify zero over/short and replay both
   original payments and refund after close without new financial writes.
8. Reconcile Store A reports/CSV to 2,600 cents, Store B to 9,000 and HQ to 11,600.
   Verify two payments plus one refund in Store A, inventory consumed exactly once
   (97 remaining), sibling stock unchanged (100), and both split reservations consumed.

Splitting happens before payment because the existing financial guard deliberately
rejects splitting tickets with payment activity.

## Corrections exposed

- Splitting a normal POS checkout copied `metadata.clientOrderId` into the child,
  violating the guest/customer uniqueness indexes from migration 435. Child
  metadata now clears both checkout ID spellings while retaining source-ticket
  provenance; the original checkout identity remains on the source.
- Split children lost `kitchen_ticket_fired_at`, hiding already-sent child tickets
  from the queue board. The child now inherits the source release timestamp;
  on-pay children retain NULL until their own first payment fires them.
- The kitchen feed omitted the on-pay release predicate and exposed unpaid tickets.
  It now excludes explicitly on-pay tickets with no release timestamp, preserving
  historical on-send feed behavior.
- Expanded opt-in regressions uncovered two stale POS fixtures: availability
  assertions now inspect the canonical store-menu business audit, and the display
  fixture includes its store identity so it reaches the unpaid-completion guard.
  The POS/course suites also close their PostgreSQL pools after running.

## Verification

- Full migration rehearsal: **1,003/1,003 applied and replayed**, with guard checks,
  in a disposable Colima PostgreSQL/PostGIS container.
- Two-store scope and connected-cycle suites: **62 passed**, using the complete
  migrated disposable `restaurant_store_test` schema.
- POS integrity, kitchen course/seat split and fire-mode suites: **40 passed**
  against explicit disposable `fr_t2` / `credit_statement_test` clones.
- Focused adapter/unit selection: **151 passed**, with **49 opt-in cases skipped**
  in that ordinary unit invocation. Explicit database results are listed above.
- Final connected-cycle rerun after the paid-feed assertions: **2/2 passed**.
- Changed JavaScript syntax, CI YAML parsing, the CI step's `bash -n`, and
  `git diff --check` passed.
- No client source changed; a browser build is not claimed for this checkpoint.

Commands, from the repository root (supply only the named disposable loopback URLs):

```sh
DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --keep --timeout-ms 600000
cd server
RESTAURANT_STORE_TEST_DATABASE_URL=<disposable-store-url> \
  npx jest --runInBand --detectOpenHandles __tests__/restaurantServiceCycle.db.test.js __tests__/restaurantStoreIsolation.db.test.js
FR_T2_TEST_DATABASE_URL=<disposable-fr-t2-url> STATEMENT_TEST_DATABASE_URL=<disposable-statement-url> \
  npx jest --runInBand --detectOpenHandles __tests__/restaurantPosIntegrity.db.test.js __tests__/restaurantKitchenCourseActions.db.test.js __tests__/restaurantKitchenFire.db.test.js
npx jest --runInBand --detectOpenHandles --testPathPatterns='restaurantAppFlow|restaurantPos|restaurantFranchise|restaurantOrderTax|restaurantInventoryOrder|kitchenDeviceAuth|foodOrderLoop|foodOrderStatusDeviceAuth|foodOrderRefundAudit|restaurantReports|restaurantKitchen'
```

CI and deployment results must be tied to the pushed commit separately. The next
acceptance step is to repeat this flow through populated browser/native accounts
and paired hardware, including an actual network outage/reconnect. Card/provider
reconciliation, other split modes, taxes/tips/fees, runner delivery, midnight/50-store
load and human language/accessibility acceptance retain their matrix boundaries.
No production database, activation flag, provider account or deployment setting
was changed during this verification.
