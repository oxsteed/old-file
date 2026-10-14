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

## Browser fixture follow-up

Run [38616258460](https://github.com/oxsteed/old-file/actions/runs/38616258460) failed earlier in the pipeline at the job-detail terminal-status assertion (`1 !== 0` bid forms). The fixture's `configure()` waited for any summary, allowing the previous job's summary/form to satisfy readiness during navigation. It now returns the requested job ID and waits for that job's rendered ID and summary. Bid loading remains independent so existing asynchronous eligibility tests still exercise it. A concurrent full-browser run also exposed the 200-ms bid-delay assertion: on a busy runner the response could finish before the loading assertion. Explicit per-job response gates now control bid, job, and write completion, replacing time-based assumptions in the loading, stale-account/job, guest-write and error-state cases.

`cd client && node --test scripts/jobDetail.browser-check.cjs` passed all synthetic scenarios, including 90 responsive/theme/language/viewer combinations. No application behavior or assertions were weakened, and no fixed delay was added.

Final validation: `cd client && node --test --test-concurrency=2 scripts/jobDetail.browser-check.cjs scripts/jobEdit.browser-check.cjs scripts/navbarNavigation.browser-check.cjs scripts/footerNavigation.browser-check.cjs` passed 4/4 tests. Gates are keyed by the requested job, so an old route request cannot consume the new route’s pending response. The earlier unrestricted concurrent browser run reproduced the timer race and was stopped after diagnosis; it is not reported as a passing full-suite run.
