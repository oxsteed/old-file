# Local delivery isolated verification

Run from the repository root:

```sh
node server/scripts/verify-local-delivery.js
```

Requires the existing Colima runtime, cached `postgis/postgis:16-3.4-alpine`
image, Node 22 and installed server dependencies. The harness uses the `colima`
context explicitly, creates one uniquely named container with an ownership
label, limits it to one CPU and 384 MB, and publishes PostgreSQL only on
`127.0.0.1` with a Docker-selected port. PostgreSQL data lives in a 256 MB tmpfs.
It neither mounts nor queries existing databases, volumes or containers.
Cleanup validates the new container's ownership label before removing its exact
ID. Synthetic data is disposable and cannot be recovered after cleanup.

No database URL argument is supported. Ambient database, PostgreSQL, Redis,
Stripe and AWS configuration is cleared inside the harness process. The real
application `db.js`, `.env` and server bootstrap are never loaded. The pool
connects only to the newly published loopback port with explicitly configured
database and user names; SSL is disabled only for this disposable connection.
The test database uses trust authentication and contains no real credentials.

## Exact prerequisite fixture

The harness creates `users(id UUID PRIMARY KEY, email TEXT, first_name TEXT,
last_name TEXT, role TEXT, default_mode TEXT, logistics_role TEXT)`,
`support_tickets(id UUID PRIMARY KEY DEFAULT gen_random_uuid())`,
`jobs(id UUID PRIMARY KEY)` and a minimal
`logistics_internal_access_credentials` table with the access flags used by
the real workspace middleware. It extracts and executes the exact
`CREATE TABLE platform_ledger` statement from migration 001, including its
foreign keys. It does not execute the rest of migration 001.

Eight synthetic users use deterministic UUIDs with prefix
`10000000-0000-4000-8000-` and suffixes 000000000001 through 000000000008:
customer, other customer, helper, helper2, driver, driver2, admin and unapproved
helper. Emails end in `@delivery.example.test`. Approved helpers and drivers
have van capacity, 1,000 lb payload, 100 inch cargo dimensions, required
equipment, acknowledged insurance and a Miami/Florida service area.

Intake uses synthetic Miami addresses, phone numbers +13055550101 and
+13055550102, a small 5 lb package with one 10 x 8 x 6 inch piece and declared
value 1,500 cents. Pickup and delivery windows are ordered, start at least 48
hours ahead, and are spaced apart between independent journeys. Race tests
intentionally share a window. The route fixture is 8,046.72 meters / 900 seconds.

Actual migrations 566, 570, 571, 572 and 574 are executed unmodified, one SQL
file per database connection, matching the migration runner's execution style.
The harness first proves that 566/570/571 alone lack `proof_pin_digest` with
PostgreSQL error 42703, then requires 572 to provide the column. Missing or
failing migrations are failures, never skipped or patched by the fixture.

## Test boundary

The real Express delivery router, controllers, internal workspace middleware,
pricing, SQL, transactions, locks and constraints run against PostgreSQL.
Authentication is replaced with a deterministic fixture-user header; this is
not an authentication-token integration test. The shared rate limiter is
bypassed to avoid involving Redis. Road routing, notifications, sockets,
malware scanning and private object storage use explicit local fixtures.
Support linking inserts a real UUID into the fixture support table, without
loading the wider support system. Stripe is an in-memory provider fixture.
No real provider calls, emails, notifications or payments are made.

The checks cover migration execution, authorization, intake validation, quote
ownership and expiry, create and claim races, assignment overlap, privacy,
completion proof, idempotency, rescheduling, returns and payment verification.
Each check prints PASS or FAIL; any failure produces a nonzero exit status.
Successful migration application alone does not imply all journeys passed.

This verifies delivery behavior on an explicitly documented minimal prerequisite
schema. It does not certify the full historical migration chain, production
data compatibility, deployed readiness, browser UX, provider integration,
notification transport or helper payouts. Run those separate acceptance gates
before claiming both complete delivery plans are verified.
