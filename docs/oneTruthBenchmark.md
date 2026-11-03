# One Truth scale benchmark (Q3)

The Nov 3 data-integrity audit carried Q3 because no 100k/500k/1M benchmark
harness existed for One Truth (the largest test seed was 50 users), even
though the 5,000-row cap was retired in favor of scoped GROUP BY discovery
plus a 100,000-pair guard (413 `one_truth_pair_limit_exceeded`).

## Harness

`server/scripts/oneTruthBenchmark.js` (kept out of the default unit-test
path: it seeds up to a million rows). It exercises the real controller
code (`_buildSuspectPairsScoped` and `_countScopedUsers`) against a scratch
database, in a dedicated `one_truth_bench` schema that is dropped at the
end unless `--keep-schema` is passed.

Per scale (100,000 / 500,000 / 1,000,000) it runs two cases:

- `sparse`: duplicate groups of 2 every 1,000 users. Expects success, an
  exact pair count (computed from the seeded data by SQL), and an
  evaluated-users count exactly equal to the seeded count. That exact
  equality is what "the retired cap holds" means: no silent truncation.
- `guard-trip`: every user shares one phone and one IP, so linear pairs
  are 2*(N-1), over the guard at every scale. Expects a 413 with code
  `one_truth_pair_limit_exceeded`, while the count query still returns
  exactly N (the guard bounds materialized pairs, never coverage).

## Run

From `server/`, with dummy secrets only for loading the controller module
(the harness never signs, charges, or sends anything):

```sh
ONE_TRUTH_BENCH_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test \
  NODE_ENV=test LOG_LEVEL=error JWT_SECRET=test-jwt-secret \
  ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  SIGNED_URL_SECRET=test-signed-url-secret STRIPE_SECRET_KEY=sk_test_dummy \
  STRIPE_WEBHOOK_SECRET=whsec_test \
  node scripts/oneTruthBenchmark.js [--scales 100000,500000,1000000] [--keep-schema] [--json]
```

Safety: the harness refuses to run unless the database name contains
`test`, `bench`, or `dev`, and aborts if `ONE_TRUTH_MAX_PAIRS` is set
(the guard expectation is the default 100,000).

## Reference result (2026-11-03, local Postgres)

All three scales PASS in about 45 seconds total. Sparse pair query:
0.4s / 4.4s / 3.4s; guard-trip query: 0.6s / 1.7s / 3.3s, at
100k / 500k / 1M. The retired cap holds at every scale; the guard trips
as designed at every scale.

## Fast companion test

`server/__tests__/oneTruthPairGuardScale.test.js` pins the guard
arithmetic at the default limit without a database (100,001 pairs abort
with 413; exactly 100,000 pairs succeed). It runs in the default unit-test
path; the database harness does not.
