# PR #806 statement queue test isolation

Inspected PR head `4c9235fc8246bbeef0b38c39ca9b96b0eb28d7b1` and CI run
[44887843157](https://github.com/oxsteed/old-file/actions/runs/44887843157).
The server regression job failed one assertion in `statementJobService.test.js`:
a global queue claim returned another issuance run's retry after the tested
job had correctly exhausted its attempt budget and entered `dead_letter`.
The client and remaining server suites passed in that run.

Account-job claims in this suite now use their own run ID. Removed the global
pre-test queue drain, which could mutate other suites' fixtures. After each
test, only its own unfinished runs are paused to keep those fixtures out of
later global claims. Production queue behavior, retry limits, fencing,
accounting, and applied migrations are unchanged.

The exhaustion test explicitly makes a different run's retry ready. It verifies
that the exhausted run yields no job, the other retry remains untouched, and
that retry can still be claimed under its own run. This covers the observed CI
failure deterministically without sleeps or relaxed assertions.

Verification uses the existing task-owned Colima PostgreSQL fixture on loopback
port 32800, database `credit_statement_test`, with
`STATEMENT_REQUIRE_DB_TESTS=true`. No production database or provider was used.
The repair commit contains this document; remote CI is separate evidence.

Command (with the disposable opt-in URL described above):

```sh
npm --prefix server test -- \
  __tests__/statementJobService.test.js \
  __tests__/statementJobReclaim.test.js \
  __tests__/statementRecovery.test.js \
  __tests__/statementIssuance.test.js \
  __tests__/statementExportPipeline.test.js
```

Final result: 5 suites / 94 tests passed, no skips (12.94 seconds).
`git diff --check` passed. Full server CI was not rerun locally. Client build
was not repeated for this test-only repair. Nothing merged or deployed.
