# Default-branch CI fixture repair, 2026-10-14

Failed run: [38613001476](https://github.com/oxsteed/old-file/actions/runs/38613001476), commit `f15fce1e`.

- `ledgerTransactionUuid.test.js` created an unverified customer, so the real approval-time fiat compliance check correctly rejected its adjustment before the journal write. The disposable fixture now records an unexpired tier-2 identity review and a fresh manual sanctions clearance. The real compliance service and distinct proposer/approver remain in use.
- `adminFoodOrderRefunds.test.js` expected 502 for a missing wallet debit. The current controller returns 409 with `wallet_refund_failed`; the test now checks that status and the `debit_not_found` reason while still requiring no refunded order update.

Validation:

- All migrations applied successfully to a newly created, temporary PostgreSQL/PostGIS container on loopback port 55439, database `credit_statement_test`.
- `cd server && npx jest --runInBand __tests__/adminFoodOrderRefunds.test.js __tests__/agentCreditAdjustments.test.js __tests__/fiatCompliance.test.js`: 3 suites / 26 tests passed.
- `LEDGER_UUID_TEST_DATABASE_URL=<disposable loopback database> npx jest --runInBand __tests__/ledgerTransactionUuid.test.js`: 1 suite / 3 tests passed, including both real journal UUID round trips.
- `git diff --check`: passed.

No production code or database changes. Remote CI is reported separately; deployment is not awaited.
