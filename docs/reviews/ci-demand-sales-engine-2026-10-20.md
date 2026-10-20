# Demand & Sales Engine CI repair - 2026-10-20

Branch: `codex/demand-sales-engine`, PR #618.

The legal browser fixture's Vite `import.meta.glob` failure was repaired by
`1ccb7a6c`, which landed during this investigation. Its focused browser check
passed locally, and Actions run `39506438353` passed the production client build,
browser suite, Media harness, migrations, and logistics database integration.

That run then exposed the only failing server suite:
`restaurantQueueCounter.db.test.js` fell back to `DATABASE_URL`, which the shared
Jest setup always replaces with a mock URL. It attempted a real connection as
the placeholder `test` user. The other 785 server suites passed.

The queue suite now uses `disposableDatabaseOptIn`, matching existing database
tests. It honors CI's `STATEMENT_TEST_DATABASE_URL` and the explicit queue alias,
requires a loopback `credit_statement_test` target, skips without opt-in, and
fails if database tests are required but no target is configured.

Local verification:

- `npm run migrate` completed through migration 953 in a fresh, project-scoped
  PostgreSQL container created with `docker-compose.credit-test.yml` on Colima.
- `STATEMENT_TEST_DATABASE_URL=<disposable URL> STATEMENT_REQUIRE_DB_TESTS=true
  npx jest __tests__/restaurantQueueCounter.db.test.js --runInBand
  --detectOpenHandles`: all 4 tests passed, including 50 concurrent allocations.
- Without database opt-in, the same Jest suite skipped all 4 tests.
- An explicit URL naming another database was rejected before connection.
- `node --test scripts/legalPolicies.browser-check.cjs`: passed.
- Additional full local browser run: 73 passed, 2 skipped, 2 W11 timeouts.
  Both W11 tests passed when rerun with `--test-concurrency=1`; both also passed
  in the Actions browser suite.
- `git diff --check`: passed.

Remote CI for the queue repair must be checked separately. No production
migration, deployment, or Demand & Sales Engine activation was performed.
