# OxSteed Credit Production Runbook

OxSteed Credit is a restricted stored-value rail. It is not a bank account, deposit account, cash equivalent, or promise of banking services. Customers can spend only at restaurants covered by an active partner agreement and any customer entitlement or location, category, order-type, and limit rules attached to that agreement.

## Release Gate

Do not enable OxSteed Credit for real customers until all of the following are true:

- Legal and compliance counsel has reviewed stored-value, money-transmission, consumer-protection, tax, refund, expiry, and unclaimed-property requirements for every operating jurisdiction.
- A custody and funding process exists for every credit load, including who owns the funds and how partner payables are funded.
- Partner agreements define acceptance, eligible categories and locations, settlement timing, fees, refunds, disputes, termination, and data handling.
- `OXSTEED_CREDIT_LEDGER_HMAC_SECRET` is set to a high-entropy secret and is protected separately from source control and ordinary application logs.
- Production ledger verification does not fall back to `JWT_SECRET`; rotate and store the dedicated ledger secret independently from authentication secrets.
- The database backup schedule is active, backups are stored outside the application host, and a restore test has been completed.
- The latest migrations have been applied and `npm run verify:credit` exits with `ok: true`. This includes the partner reporting index needed for settlement and transaction feeds as the restaurant network grows. After financial activity begins, do not change a partner's restaurant/currency, an agreement's partner, or an account's customer/partner/type/currency identity; create a replacement record instead.
- Customer wallets and customer-specific partner entitlements are restricted to users with the `customer` role at both the service and database layers. Wallet updates and ledger postings re-check current ownership, so a later role change cannot be used to move value through a non-customer identity. Helpers, restaurant owners, and administrative identities must not receive customer Credit access.
- Credit checkout, refund, hold expiry, duplicate retry, account suspension, and partner settlement have passed in a non-production environment.
- The `oxsteed_credit_enabled` feature flag remains disabled until the release owner explicitly approves activation.

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

The load and positive-adjustment endpoints both require a traceable funding
reference. Clawbacks remain debits from the customer wallet and require an
operator reason; use a separate compensating credit with its own funding or
correction reference when value must be restored.

Holds default to 30 minutes and cannot be created more than 24 hours ahead by
default. If operations need a different maximum, set
`OXSTEED_CREDIT_MAX_HOLD_TTL_MINUTES` deliberately and keep it aligned with
the partner order window.

## First Deployment

Run these commands from the server directory against the intended database:

```sh
npm run migrate
npm run verify:credit
```

The migration runner applies the OxSteed Credit migrations and the durable `cron_job_locks` migration in order. The verification command is read-only and checks that the foundation is applied, the emergency flag exists, required columns exist, required hold lookup and one-active-agreement indexes exist, database-level transaction, transaction-currency, transaction-type, transaction-partner, transaction-immutability, journal-entry-immutability, audit-immutability, hold-reference, account-integrity, settlement-integrity, settlement-state, financial-identity-stability, and journal-entry guards are installed, posted transactions have one debit and one credit entry, account balances agree with the journal, customer reservations equal their active holds, established transaction directions are valid, restaurant movements point to the partner payable account named by their partner and agreement, purchases have partner/agreement references, transaction currencies and settlements match their agreements, every stored credit currency belongs to the configured OxSteed Credit allowlist, paid non-zero settlements have payment evidence, every entry HMAC recomputes correctly, each account chain is contiguous, each account head matches its final entry, and the scheduled-job lock table is present. Expired job leases are reclaimed atomically, so a crashed worker does not permanently disable hold expiry.

## Enabling a Partner

1. Confirm the restaurant identity, owner, currency, service locations, and settlement destination.
2. In Super Admin, enroll the restaurant as a partner.
3. Create a draft agreement with plain-language customer terms, allowed order types, categories or menu items, geography, transaction limits, effective dates, and whether access is partner-wide or restricted to assigned customers.
4. Submit and approve the agreement. Activate the partner only after the commercial agreement is signed.
5. Add customer entitlements only when the commercial or program rules require customer-specific access.
6. Run one low-value test load, purchase, refund, and settlement in the approved environment.
7. Enable `oxsteed_credit_enabled` only after the release gate is signed off.

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

The public eligibility query still requires the Credit rail, customer wallet,
partner, agreement, entitlement when the agreement is allowlisted, currency,
geography, category, order type, and limit checks to pass. On a partner-wide
agreement, a customer-specific non-active entitlement overrides the default
access and blocks that customer; an active entitlement can instead apply
stricter customer limits. An entitlement by itself never makes a draft,
suspended, expired, or terminated agreement spendable. Existing agreements are
partner-wide unless the restricted mode is explicitly enabled when a
replacement agreement is created.

## Daily Operations

- Review partner and agreement status, open disputes, pending settlements, and reconciliation results in the OxSteed Credit Super Admin workspace.
- Run `npm run verify:credit` after migrations, ledger incidents, or any database maintenance.
- Confirm the hold-expiry worker is healthy. Expired active holds are non-blocking in the verifier but must not accumulate.
- Confirm the entitlement-expiry worker is healthy. Entitlements whose validity window ends are marked `expired` under a distributed lock; the access record and audit trail remain available for review.
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

Never restore over the live database as a first response. Preserve the original database for forensic review and use a planned cutover only after the restored copy passes verification.

## Customer Statements

Authenticated customers can retrieve a bounded statement from `GET /api/oxsteed-credit/statement`. The default period is the most recent 90 days; callers may request an inclusive `from` and `to` date window up to 366 days, with pagination for larger histories. Each response includes opening and closing balances, credit and debit totals, net change, transaction count, and customer-safe transaction details.

Customers can download the same period as CSV from `GET /api/oxsteed-credit/statement.csv`. The export is capped at 5,000 transactions and returns a clear error rather than a partial file when the selected period is larger. Exported data intentionally excludes idempotency keys, ledger hashes, internal actor data, and raw transaction metadata.

## Currency Isolation

OxSteed Credit supports a configured set of ISO 4217 currencies with verified
two-decimal minor-unit handling. Set
`OXSTEED_CREDIT_SUPPORTED_CURRENCIES` to the same comma-separated allowlist on
every application replica; when it is unset, the built-in allowlist is used.
Configured currencies outside the verified allowlist are omitted and a
startup warning is emitted, so they cannot silently enter the ledger.
Customer wallets, partner agreements, restaurant settlement currency, holds,
transactions, refunds, and reconciliation runs remain currency-isolated. The
application does not perform foreign-exchange conversion, combine balances from
different currencies, or let an agreement settle against a different restaurant
currency.

Credit amounts are currently integer minor units for currencies with two
decimal places. Do not add a zero-decimal or three-decimal currency until the
amount parser, limits, exports, UI formatters, and reconciliation tests are
updated together. Before enabling a new currency, confirm custody/funding,
settlement, tax, consumer-disclosure, support, and legal requirements for that
market. Run `npm run migrate` and `npm run verify:credit` against the target
database, then run a low-value load, purchase, refund, settlement, and
reconciliation for that currency in a non-production environment.

## Provider and Compliance Gaps

The application cannot establish licensing, custody, banking status, KYC/AML obligations, consumer disclosures, tax treatment, or partner contract validity by itself. Those are external release requirements. Likewise, managed database backups, malware scanning, alert routing, MFA/passkeys, Sentry or equivalent observability, and browser/concurrency tests must be configured and evidenced in the deployment environment before calling the rail fully production-ready.
