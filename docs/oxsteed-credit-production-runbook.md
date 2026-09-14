# OxSteed Credit Production Runbook

OxSteed Credit is a restricted stored-value rail. It is not a bank account, deposit account, cash equivalent, or promise of banking services. Customers can spend only at restaurants covered by an active partner agreement and any customer entitlement or location, category, order-type, and limit rules attached to that agreement.

## Release Gate

Engineering completion is governed by the
[code completion goal](oxsteed-credit-code-completion-goal.md). The release gate
below governs activation for real customers. Human launch prerequisites do not
block completion of implementation, isolated integration tests, or recovery
verification, and passing software checks does not automatically enable Credit.

Do not enable OxSteed Credit for real customers until all of the following are true:

- Production startup must use non-placeholder authentication, database, encryption,
  Credit-ledger, and live Stripe credentials. The server now fails closed instead
  of accepting `dev-*`, placeholder, or Stripe test credentials in
  `NODE_ENV=production`.
- Legal and compliance counsel has reviewed stored-value, money-transmission, consumer-protection, tax, refund, expiry, and unclaimed-property requirements for every operating jurisdiction.
- A custody and funding process exists for every credit load, including who owns the funds and how partner payables are funded.
- Partner agreements define acceptance, eligible categories and locations, settlement timing, fees, refunds, disputes, termination, and data handling.
- `OXSTEED_CREDIT_LEDGER_HMAC_SECRET` is set to a high-entropy secret and is protected separately from source control and ordinary application logs. The signing-key version is explicit, and any prior key versions needed to verify historical entries are supplied through the secret store rather than source control.
- Production ledger verification does not fall back to `JWT_SECRET`; rotate and store the dedicated ledger secret independently from authentication secrets.
- The database backup schedule is active, backups are stored outside the application host, and a restore test has been completed.
- The latest migrations have been applied and `npm run verify:credit` exits with `ok: true`. This includes the partner reporting index needed for settlement and transaction feeds as the restaurant network grows. After financial activity begins, do not change a partner's restaurant/currency, an agreement's partner, or an account's customer/partner/type/currency identity; create a replacement record instead.
- Customer wallets and customer-specific partner entitlements are restricted to users with the `customer` role at both the service and database layers. Wallet updates and ledger postings re-check current ownership, so a later role change cannot be used to move value through a non-customer identity. Helpers, restaurant owners, and administrative identities must not receive customer Credit access.
- Credit checkout, refund, hold expiry, duplicate retry, account suspension, and partner settlement have passed in a non-production environment.
- The `oxsteed_credit_enabled` feature flag remains disabled until the release owner explicitly approves activation.
- Server-side error monitoring must be configured before activation; the production admin gate checks `SENTRY_DSN`.

## Coolify Environment Repair

The Coolify OxSteed application has been repaired and is currently healthy.
Its production environment now contains non-placeholder database, JWT, and
Stripe values, and the deployed container has completed migration 515. Do not
copy values from this document into Coolify. Keep all credentials in Coolify's
secret store and redeploy only after the values have been checked.

The live `verify:credit` release check remains intentionally fail-closed until
server error monitoring is configured with `SENTRY_DSN`; do not bypass that
requirement or activate real Credit value without it.

`JWT_SECRET` must be one stable, high-entropy value shared by every OxSteed
application replica. Generate it on the trusted MacBook with
`openssl rand -hex 64`, paste the result into Coolify, and never commit it,
print it in logs, or regenerate it during an ordinary restart. Changing it
logs out existing sessions and requires an intentional authentication-secret
rotation plan.

`DATABASE_URL` must be the private PostgreSQL connection string for the
Coolify-managed OxSteed database, not a public URL and not a placeholder. Use
the database service's actual username, password, internal hostname, port,
and database name. For the current Colima deployment the known identifiers are
user `oxsteed`, database `oxsteed_db`, and container hostname
`postgres-twsam5aiyvm0w1l2jqxx9ih3`; obtain the password from Coolify's secret
store rather than exposing it in chat or source control. The final value should
follow this shape, with the password supplied privately:

```text
postgresql://oxsteed:<POSTGRES_PASSWORD>@postgres-twsam5aiyvm0w1l2jqxx9ih3:5432/oxsteed_db
```

If the database is intentionally configured for non-TLS traffic inside the
private Colima network, append `?sslmode=disable`; otherwise use the database's
approved TLS settings. Do not point the app at `localhost`, the public domain,
or the Coolify control-plane database. `DATABASE_URL` must be identical across
application replicas and must be tested by the migration and readiness checks.

The current startup log also reports placeholder Stripe values. Those must be
replaced with the approved live Stripe secret and webhook signing secret before
production traffic is accepted; do not bypass the fail-closed configuration
validator to bring the app online.

After saving the environment, redeploy the application and confirm:

```sh
docker ps --format 'table {{.Names}}\t{{.Status}}'
curl --silent --show-error --fail https://oxsteed.com/ready | npm run verify:readiness
npm run verify:credit
```

The expected result is a healthy app container, readiness JSON with no pending
migrations, and `verify:credit` reporting `ok: true`. The local database is
already at migration `514`; the pre-migration dump is stored under
`/Users/oxsteed/server-backups/production/`.

## API Abuse Controls

Credit reads use the normal authenticated API budget. Financially sensitive
operations use separate user-scoped limits so ordinary browsing cannot consume
the mutation budget:

- Customer holds, releases, transfers, and disputes: 60 requests per 15 minutes per customer.
- Super Admin credit writes, partner controls, settlement actions, and reconciliation: 60 requests per 15 minutes per operator.
- Customer statement CSV exports: 10 requests per hour per customer.

These limits complement, rather than replace, authorization, idempotency keys,
database constraints, and the immutable audit trail. Configure `REDIS_URL` in
production so every application replica shares the same rate-limit buckets. The
in-memory fallback is for local development and is not sufficient for a
multi-instance deployment.

Set `DB_CONNECTION_TIMEOUT_MS` between 1,000 and 30,000 milliseconds when the
database host or VM needs a different pool wait budget. The default is 5,000 ms,
which tolerates short host scheduling pauses without hiding a persistently
exhausted pool; do not use this setting as a substitute for investigating pool
utilization or database capacity.

Positive administrative issuance is also bounded inside the transaction:
`OXSTEED_CREDIT_MAX_TRANSACTION_CENTS` caps one movement,
`OXSTEED_CREDIT_MAX_CUSTOMER_BALANCE_CENTS` caps one customer wallet,
`OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS` caps outstanding customer value per
currency, and `OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_ISSUANCE_CENTS` caps the
amount loaded or granted to one customer in the database accounting day. The
daily check is serialized with the global issuance check and runs after an
idempotent replay check, so retries do not consume additional issuance
capacity. Set these values deliberately for each launch market and review the
resulting limits with compliance and the funding owner.

If customer-to-customer transfers are enabled, outbound transfers are also
bounded per customer and currency by
`OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_TRANSFER_CENTS` (default: the customer
wallet balance cap) and `OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_TRANSFER_COUNT`
(default: 20). The check uses the database accounting day, serializes by
sender and currency, and runs after the idempotent replay check. This limits
rapid value movement without changing restaurant purchases or partner
settlement. Keep `OXSTEED_CREDIT_ALLOW_CUSTOMER_TRANSFERS=false` unless the
program rules, fraud controls, and compliance review explicitly approve it.

Customer spending is also bounded across the entire partner network by
`OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_SPEND_CENTS` (default: the customer wallet
balance cap) and `OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_SPEND_COUNT` (default: 50).
The check combines posted purchases for the database accounting day with all
active holds in the selected currency, serializes concurrent partner activity,
and excludes the hold being captured. This keeps multi-restaurant access
possible while limiting account takeover and rapid balance movement across
separate partner agreements.

Currency conversion is an explicit, operator-mediated workflow rather than an
implicit fallback. A Super Admin records the provider's exact source amount,
target amount, integer rate numerator and denominator, fee, provider reference,
reason, and expiry through `POST /api/admin/super/oxsteed-credit/currency-quotes`.
The customer consumes that quote once through
`POST /api/oxsteed-credit/conversions` with an idempotency key. The server
posts same-currency source debit, optional source-currency fee, and target
credit journal legs in one transaction, then marks the quote consumed. Quotes
expire after 15 minutes by default and cannot exceed 24 hours; providers and
operator approvals must still be selected and governed outside the code.

Conversion volume is bounded per customer and source currency by
`OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_CONVERSION_CENTS` and
`OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_CONVERSION_COUNT` (default: the customer
balance cap and 20). No conversion is accepted when the quote is expired,
replayed with different data, outside the configured currency allowlist, or
inconsistent with its exact half-up rate calculation.

The load and positive-adjustment endpoints both require a traceable funding
reference. Clawbacks remain debits from the customer wallet and require an
operator reason; use a separate compensating credit with its own funding or
correction reference when value must be restored.

Holds default to 30 minutes and cannot be created more than 24 hours ahead by
default. If operations need a different maximum, set
`OXSTEED_CREDIT_MAX_HOLD_TTL_MINUTES` deliberately and keep it aligned with
the partner order window.

## First Deployment

The first deployment should be treated as a controlled release. The GitHub
Actions deployment job triggers Coolify only after the server and client checks
pass. It then polls the public `/ready` endpoint and the API `/health` endpoint
for up to five minutes. It also requires readiness JSON to report zero pending
migrations, a healthy Credit ledger check, and a non-empty release identifier.
This is still a service and schema gate, not proof that every database
invariant or external provider is configured. Coolify's predefined
`SOURCE_COMMIT` value is accepted as a fallback, but enable Configuration >
Advanced > Include Source Commit in Build so the exact commit also reaches the
Docker build and frontend release metadata. You may override it with
`SENTRY_RELEASE` or `COMMIT_SHA`; these values must never contain a secret.

Run these commands from the server directory against the intended database:

```sh
npm run migrate
npm run verify:credit
curl --silent --show-error --fail https://oxsteed.com/ready | npm run verify:readiness
```

The migration runner applies the OxSteed Credit migrations and the durable `cron_job_locks` migration in order. The verification command is read-only and checks that the foundation is applied, the emergency flag exists, required columns exist, required hold lookup and one-active-agreement indexes exist, database-level transaction, transaction-currency, transaction-type, transaction-partner, transaction-immutability, journal-entry-immutability, audit-immutability, hold-reference, account-integrity, settlement-integrity, settlement-state, financial-identity-stability, and journal-entry guards are installed, posted transactions have one debit and one credit entry, account balances agree with the journal, customer reservations equal their active holds, established transaction directions are valid, restaurant movements point to the partner payable account named by their partner and agreement, purchases have partner/agreement references, transaction currencies and settlements match their agreements, every stored credit currency belongs to the configured OxSteed Credit allowlist, paid non-zero settlements have payment evidence, every entry HMAC recomputes correctly, each account chain is contiguous, each account head matches its final entry, the scheduled-job lock table is present, and the restaurant wallet, POS payment, receipt-event, operator-audit, and incident-monitoring dependencies required by the restricted stored-value flows are installed with their critical columns and indexes. Expired job leases are reclaimed atomically, so a crashed worker does not permanently disable hold expiry. The readiness command separately validates the live service contract, including its non-secret release identifier, migration state, shared Redis, Credit ledger configuration, and runtime worker checks.

The application readiness endpoint (`/ready` or `/api/ready`) also checks the
Credit rail control. An enabled Credit rail cannot receive traffic unless
`REDIS_URL` is configured and the shared Redis dependency answers successfully;
this prevents a multi-instance deployment from silently falling back to
process-local rate limits and coordination. The check is inactive when Credit
is disabled, so ordinary platform traffic can remain available while the rail
is being prepared.

### Isolated concurrency drill

Restore a current production-shaped dump into a disposable database whose name
starts with `oxsteed_verify_`, set `CREDIT_CONCURRENCY_TEST_MODE=true`, and run
the service-level race through the application image:

```sh
npm --prefix server run verify:credit-concurrency
```

The drill requires `DATABASE_URL`, `REDIS_URL`, and the dedicated ledger secret.
It races two spends against one customer balance, verifies that only one is
posted, then retries one idempotency key concurrently and verifies that both
callers receive one transaction. It also injects an insufficient-funds failure
and verifies that the account balance, reservations, and purchase journal are
unchanged. Drop the disposable database after the run; never point this command
at the live production database.

## Enabling a Partner

1. Confirm the restaurant identity, owner, currency, service locations, and settlement destination.
2. In Super Admin, enroll the restaurant as a partner.
3. Create a draft agreement with plain-language customer terms, allowed order types, categories or menu items, geography, transaction limits, effective dates, and whether access is partner-wide or restricted to assigned customers.
4. Submit and approve the agreement. Activate the partner only after the commercial agreement is signed.
5. Add customer entitlements only when the commercial or program rules require customer-specific access.
6. Run one low-value test load, purchase, refund, and settlement in the approved environment.
7. Enable `oxsteed_credit_enabled` only after the release gate is signed off.

### Restaurant Operating Ledger

Each enrolled restaurant has an explicit Credit operating ledger with two
separate accounts: the payable account for earned restaurant value and a
protected reserve account for central treasury funding. The Super Admin
workspace can inspect both balances and record a `fund` or `release` movement
through `POST /api/admin/super/oxsteed-credit/partners/:partnerId/funding`.
Every movement requires an idempotency key, positive amount, external
reference, and operator reason. The journal direction is enforced by the
database: funding moves central treasury to the restaurant reserve, while a
release moves reserve back to central treasury. The restaurant operator view
at `GET /api/food/restaurants/:restaurantId/oxsteed-credit/ledger` exposes its
own payable/reserve balances and funding history without exposing customer
identity. An external reference is audit evidence supplied by the operator;
the application must not represent it as proof that an external bank or
custody transfer actually completed.

## Customer-Specific Partner Access

The Super Admin OxSteed Credit workspace includes a Customer access section for
programs that restrict spending to named customers or a defined partner set.
Customer access is one record per customer and agreement, so the same customer
can be assigned to multiple restaurants without moving or duplicating wallet
balance:

1. Confirm the customer appears in the customer wallet directory and copy the
   customer UUID from the selected customer record.
2. Confirm the restaurant has the correct active partner agreement, currency,
   effective dates, categories, order types, and spending limits.
3. Save one entitlement for that customer and agreement with a documented
   reason. Set customer-specific limits only when they should be stricter than
   the agreement limits.
4. Repeat the assignment for each additional restaurant agreement. The access
   directory can be searched by customer or restaurant and paged as the
   program grows.
5. Use `active` only when the agreement and customer program are approved;
   use `suspended`, `revoked`, or `expired` to preserve history without
   silently deleting access.

Use **View details** from the customer wallet directory to open the read-only
Customer 360 profile. It combines the selected currency wallet, all customer
restaurant assignments (including assignments in other currencies), recent
holds, and recent ledger transactions with status and references. This is the
operator view for answering “where can this customer spend?” without relying
on the customer to report their own history. The profile endpoint is
`GET /api/admin/super/oxsteed-credit/accounts/:customerId` and is protected by
the existing Super Admin gate.

Super Admin can export the selected customer's bounded statement from
`GET /api/admin/super/oxsteed-credit/accounts/:customerId/statement.csv`.
The endpoint accepts the same optional `from`, `to`, and `currencyCode`
parameters as the customer statement, permits historical records for inactive
customers for support and finance review, and is protected by the export rate
limit. It returns no partial file when the 5,000-row export cap is exceeded.

The public eligibility query still requires the Credit rail, customer wallet,
partner, agreement, entitlement when the agreement is allowlisted, currency,
geography, category, order type, and limit checks to pass. On a partner-wide
agreement, a customer-specific non-active entitlement overrides the default
access and blocks that customer; an active entitlement can instead apply
stricter customer limits. An entitlement by itself never makes a draft,
suspended, expired, or terminated agreement spendable. Existing agreements are
partner-wide unless the restricted mode is explicitly enabled when a
replacement agreement is created.

Restaurant checkout uses the same policy through
`GET /api/oxsteed-credit/eligibility`. Supply `restaurantId`, `amountCents`,
`currencyCode`, `orderType`, `categories`, and `menuItemIds`; the endpoint
returns `eligible`, a stable `reasonCode`, and safe display context. The
restaurant quote endpoint also includes this result as
`quote.paymentContract.oxsteedCreditEligibility` and only advertises
`oxsteed_credit` in `supportedModes` when the pre-check succeeds. This is a
customer-experience preflight, not authorization: order creation repeats the
checks inside the financial transaction and must remain the final authority.

### Restaurant POS Authorization

In-store OxSteed Credit payments use a customer-created hold. A cashier must
receive the hold ID from the customer and submit it with the exact order total
to `POST /api/restaurants/:restaurantId/pos/orders/:orderId/payments` using
`paymentType=oxsteed_credit` and an idempotency key. The server locks the hold,
verifies that it belongs to the restaurant's active partner, matches currency
and amount, re-checks the agreement and order categories, then captures it
atomically with the POS payment and receipt audit. Holds expire automatically
and can be released by the customer. Email addresses, phone numbers, and
cashier-entered customer IDs are lookup or display data only; they never
authorize an OxSteed Credit spend.

The customer flow is: open OxSteed Credit, choose **Authorize an in-store
payment**, select the participating restaurant and order type, reserve the
exact amount, and give the resulting expiring hold ID to the cashier. Never
allow a POS operator to debit Credit from an email or phone lookup alone.

## Daily Operations

- Review partner and agreement status, open disputes, pending settlements, and reconciliation results in the OxSteed Credit Super Admin workspace.
- Review the Partner agreement health watch on the Credit overview. Resolve active partners without an active agreement before treating them as customer coverage, review agreements expiring within 30 days, and clear pending partner activations after commercial approval.
- Every partner enrollment, agreement creation, settlement snapshot, entitlement update, rail change, and lifecycle transition requires an operator reason. Use a reason that identifies the approval, funding, contract, or incident record an auditor should follow.
- Run `npm run verify:credit` after migrations, ledger incidents, or any database maintenance.
- Confirm the hold-expiry worker is healthy. Expired active holds are non-blocking in the verifier but must not accumulate.
- Confirm the Credit lifecycle-expiry worker is healthy. Agreements and customer entitlements whose validity window ends are marked `expired` under one distributed lock; the records and audit trail remain available for review.
- Confirm the Credit notification outbox worker is healthy. Successfully delivered notification intents are retained for 90 days by default and then removed in bounded batches; set `OXSTEED_CREDIT_NOTIFICATION_RETENTION_DAYS` between 30 and 730 days when the approved retention policy differs. Pending and failed deliveries are never removed by this cleanup, and terminal failures remain available for operator retry and incident review.
- Review the Credit worker health panel for all six maintenance workers: notification delivery, hold expiry, entitlement expiry, reconciliation, integrity verification, and restaurant wallet operations. Notification, hold-expiry, entitlement-expiry, and restaurant-wallet checkpoints older than 10 minutes are stale; reconciliation and integrity checkpoints older than 48 hours are stale because they run daily. A recent checkpoint with a recorded error or consecutive failures still requires investigation. The watchdog checks these states every five minutes under a distributed lock and deduplicates critical incidents by worker.
- The restaurant wallet watchdog also checks for active QR sessions past expiry, overdue wallet POS payments, recent failed wallet POS payments, reserved-balance versus active-hold drift, account-balance versus latest-ledger drift, and recent wallet integrity locks. Each condition creates a durable deduplicated incident and auto-resolves after the next healthy check. The existing one-minute expiry cleanup remains the remediation path for expired sessions and holds; the watchdog is an independent detection and alerting path.
- Review notification backlog age separately from worker heartbeat. A due pending notification or a sending notification with a stale lock older than 15 minutes raises `oxsteed_credit_notification_backlog_stale`; scheduled future retries are excluded so they do not create false alerts. The watchdog deduplicates this incident and auto-resolves it after the active queue returns within the threshold.
- On the MacBook host, `com.oxsteed.production-backup-monitor` runs every 15 minutes and validates the newest snapshot age, required artifacts, checksums, backup-directory permissions, free disk space, Docker health, and the public readiness endpoint. Its latest state is recorded in `/Users/oxsteed/server-backups/production/backup-monitor.status`; this local monitor does not replace off-device backup storage or centralized alerting.
- The backup script also supports an optional second copy. Set `BACKUP_MIRROR_ROOT` to a mounted recovery volume such as `/Volumes/OxSteedBackups` in both LaunchAgent environment blocks. The backup job copies each verified snapshot there and the monitor verifies the matching mirror checksum every 15 minutes. Leave it unset for the current local-only setup; do not point it at the local backup root.
- A UTC reconciliation worker runs daily at 02:10 UTC under one durable distributed job lock for the complete configured currency batch. The owning worker renews its lease while the handler runs, so a slow database operation does not allow a second replica to interleave or duplicate the batch. It records a reconciliation run for the prior UTC day per currency and creates a critical durable incident if the account balances and journal differ or the check fails.
- Generate non-overlapping settlement periods that end no later than the current time, and require a traceable payment reference before marking a settlement paid.
- Treat every customer dispute as a review record. Never edit or delete a journal entry to correct a customer balance; post a compensating refund or adjustment with a reason and idempotency key.

## Emergency Suspension

Use the existing Super Admin feature-flag control to set `oxsteed_credit_enabled` to disabled. This fails closed for new loads, holds, purchases, and customer transfers. Customers can still view their balance and statement, and operators can continue refunds, dispute resolution, settlement corrections, and account safety actions as needed.

After suspension:

1. Preserve the correlation IDs and audit events for the triggering incident.
2. Run `npm run verify:credit` and the database reconciliation control.
3. Check partner balances, holds, refunds, and recent idempotency conflicts.
4. Re-enable only after the root cause, affected transactions, customer communication, and release approval are documented.

## Backup and Restore

Backups must include all OxSteed Credit tables, `_migrations`, feature flags, and the application secret needed to validate journal hashes. Store at least one copy in an immutable or access-controlled location separate from the application host.

For a restore drill:

1. Restore a backup into an isolated database with production network access disabled.
2. Apply any migrations required by the restored snapshot.
3. Run `npm run verify:credit` against the isolated database.
4. Compare account balances, transaction counts, entry counts, and the latest reconciliation result with the source environment.
5. Record the test duration, restore point, rows verified, and any difference in the backup monitor.

On the MacBook deployment host, the safe database-only drill can be run from
the production repository against an existing custom-format snapshot without
overwriting production:

```sh
cd /Users/oxsteed/Documents/GitHub/6
npm --prefix server run verify:restore -- \
  /Users/oxsteed/server-backups/production/20260914T094542Z/oxsteed-db.dump
```

The verifier restores into a temporary database on the healthy Postgres
container, checks that migrations and all required Credit tables are present,
and drops the temporary database on exit. It does not replace the separate
full restore-and-cutover procedure required for a disaster recovery exercise.

Never restore over the live database as a first response. Preserve the original database for forensic review and use a planned cutover only after the restored copy passes verification.

## Customer Statements

Authenticated customers can retrieve a bounded statement from `GET /api/oxsteed-credit/statement`. The default period is the most recent 90 days; callers may request an inclusive `from` and `to` date window up to 366 days, with pagination for larger histories. Each response includes opening and closing balances, credit and debit totals, net change, transaction count, and customer-safe transaction details.

Customers can download the same period as CSV from `GET /api/oxsteed-credit/statement.csv`. The export is capped at 5,000 transactions and returns a clear error rather than a partial file when the selected period is larger. Exported data intentionally excludes idempotency keys, ledger hashes, internal actor data, and raw transaction metadata.

Each posted transaction also has a customer-only receipt at
`/oxsteed-credit/transactions/:transactionId`. The receipt shows the posted
amount, restaurant or order context, transaction identifier, and the
server-recorded customer balance immediately after that ledger entry. The
balance-after value is read from the matching customer journal entry rather
than calculated in the browser, and the endpoint never exposes the other
side's account details or ledger integrity metadata. Customers can use the
browser print action to save a PDF copy.

Super Admin customer statement exports use the same bounded statement format
and are available from the Customer 360 panel. All Credit CSV exports quote
cells and neutralize formula-leading values so customer-controlled descriptions
or references cannot execute as spreadsheet formulas when opened by an
operator.

## Customer Partner Directory

Customers can query `GET /api/oxsteed-credit/eligible-partners` to see the
restaurants where their selected currency and current account status permit
OxSteed Credit spending. The endpoint is the eligibility source of truth; it
applies the active rail, customer wallet, partner, agreement, entitlement,
currency, order-type, and agreement-geography rules on the server before
returning a restaurant.

The directory is bounded and supports `search`, `orderType`, `city`, `state`,
`postalCode`, `country`, `limit`, and `offset` query parameters. Responses
include `pagination.hasMore` and `pagination.nextOffset`; clients must use
those fields rather than assuming the first page contains the entire partner
network. A restaurant with geographic restrictions remains visible before a
customer enters a location, but is returned only when the supplied location
matches its agreement rules.

## Currency Isolation

OxSteed Credit supports a configured set of ISO 4217 currencies with verified
minor-unit handling. The server keeps an explicit precision map, including
zero-, two-, and three-decimal currencies, so precision is never inferred
from an arbitrary currency code. Set
`OXSTEED_CREDIT_SUPPORTED_CURRENCIES` to the same comma-separated allowlist on
every application replica; when it is unset, every currency in the verified
precision map is available by default.
Configured currencies outside the verified precision map are omitted and a
startup warning is emitted, so they cannot silently enter the ledger. The
Use the environment allowlist to narrow a launch market until each enabled
currency's funding and settlement path is tested.
Customer wallets, partner agreements, restaurant settlement currency, holds,
transactions, refunds, and reconciliation runs remain currency-isolated. The
conversion record is the only supported cross-currency bridge; it never puts
two currencies in one journal transaction, combines balances implicitly, or
lets an agreement settle against a different restaurant currency.

Credit amounts are integer minor units. For example, JPY `1000` represents
1,000 yen, USD `1000` represents 10.00 dollars, and KWD `1000` represents
1.000 dinar. The admin and customer UI format values using the same currency
precision rather than assuming every value is cents. Before enabling a new
currency, confirm custody/funding,
settlement, tax, consumer-disclosure, support, and legal requirements for that
market. Run `npm run migrate` and `npm run verify:credit` against the target
database, then run a low-value load, purchase, refund, settlement, and
reconciliation for that currency in a non-production environment.

## Ledger Key Rotation

Credit journal entries record the signing-key version used to create their HMAC.
The initial migration labels existing entries `v1`; do not rewrite those rows
when rotating a secret. To rotate, deploy the new secret as
`OXSTEED_CREDIT_LEDGER_HMAC_SECRET`, set
`OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION` to a new version such as `v2`, and
set `OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON` to an object containing the prior
version and secret, for example `{"v1":"<old-secret>"}`. Keep the prior key
available until a restore drill and `npm run verify:credit` confirm that all
historical entries still verify. Then remove only keys that are no longer
required by the approved retention and audit policy. Never place key values in
logs, exports, or this runbook.

## Observability Configuration

Before enabling the Credit rail in production, configure the server Sentry DSN
in the deployment environment as `SENTRY_DSN`. Keep `SENTRY_ENABLED=true` (the
default) and leave `SENTRY_SEND_DEFAULT_PII=false` unless a documented privacy
review approves otherwise. Set `SENTRY_ENVIRONMENT` when the deployment label
should differ from `NODE_ENV`. Optional `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`,
and `SENTRY_PROFILES_SAMPLE_RATE` values may identify the release and control
sampling without exposing secrets. Configure the browser bundle with
`VITE_SENTRY_DSN` so the root, admin, and shared frontend logger report to the
same approved project. The server rail gate checks only that the server DSN is
present; provider delivery, alert routing, retention, and on-call ownership
must still be verified outside the application.

If Credit workflows accept customer or partner uploads, configure `CLAMAV_HOST`
and keep `FILE_SCAN_REQUIRE_MALWARE=true`; verify the ClamAV health endpoint
before launch. When uploads are not part of the Credit workflow, static
validation remains available for the rest of the application, but it is not a
substitute for malware scanning in a high-risk stored-value deployment.

## Provider and Compliance Gaps

The application cannot establish licensing, custody, banking status, KYC/AML obligations, consumer disclosures, tax treatment, or partner contract validity by itself. Those are external release requirements. Likewise, managed database backups, malware scanning, alert routing, MFA/passkeys, Sentry or equivalent observability, and browser/concurrency tests must be configured and evidenced in the deployment environment before calling the rail fully production-ready.
