# OxSteed Credit Production Runbook

OxSteed Credit is a restricted stored-value rail. It is not a bank account, deposit account, cash equivalent, or promise of banking services. Customers can spend only at restaurants covered by an active partner agreement and any customer entitlement or location, category, order-type, and limit rules attached to that agreement.

## Release Gate

Do not enable OxSteed Credit for real customers until all of the following are true:

- Legal and compliance counsel has reviewed stored-value, money-transmission, consumer-protection, tax, refund, expiry, and unclaimed-property requirements for every operating jurisdiction.
- A custody and funding process exists for every credit load, including who owns the funds and how partner payables are funded.
- Partner agreements define acceptance, eligible categories and locations, settlement timing, fees, refunds, disputes, termination, and data handling.
- `OXSTEED_CREDIT_LEDGER_HMAC_SECRET` is set to a high-entropy secret and is protected separately from source control and ordinary application logs.
- The database backup schedule is active, backups are stored outside the application host, and a restore test has been completed.
- The latest migrations have been applied and `npm run verify:credit` exits with `ok: true`.
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

## First Deployment

Run these commands from the server directory against the intended database:

```sh
npm run migrate
npm run verify:credit
```

The migration runner applies the OxSteed Credit migrations and the durable `cron_job_locks` migration in order. The verification command is read-only and checks that the foundation is applied, the emergency flag exists, required columns exist, database-level transaction and journal-entry guards are installed, posted transactions have one debit and one credit entry, account balances agree with the journal, purchases have partner/agreement references, every entry HMAC recomputes correctly, each account chain is contiguous, each account head matches its final entry, and the scheduled-job lock table is present. Expired job leases are reclaimed atomically, so a crashed worker does not permanently disable hold expiry.

## Enabling a Partner

1. Confirm the restaurant identity, owner, currency, service locations, and settlement destination.
2. In Super Admin, enroll the restaurant as a partner.
3. Create a draft agreement with plain-language customer terms, allowed order types, categories or menu items, geography, transaction limits, and effective dates.
4. Submit and approve the agreement. Activate the partner only after the commercial agreement is signed.
5. Add customer entitlements only when the commercial or program rules require customer-specific access.
6. Run one low-value test load, purchase, refund, and settlement in the approved environment.
7. Enable `oxsteed_credit_enabled` only after the release gate is signed off.

## Daily Operations

- Review partner and agreement status, open disputes, pending settlements, and reconciliation results in the OxSteed Credit Super Admin workspace.
- Run `npm run verify:credit` after migrations, ledger incidents, or any database maintenance.
- Confirm the hold-expiry worker is healthy. Expired active holds are non-blocking in the verifier but must not accumulate.
- A UTC reconciliation worker runs daily at 02:10 UTC under the durable distributed job lock. It records a reconciliation run for the prior UTC day and creates a critical durable incident if the account balances and journal differ or the check fails.
- Generate non-overlapping settlement periods and require a traceable payment reference before marking a settlement paid.
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

## Provider and Compliance Gaps

The application cannot establish licensing, custody, banking status, KYC/AML obligations, consumer disclosures, tax treatment, or partner contract validity by itself. Those are external release requirements. Likewise, managed database backups, malware scanning, alert routing, MFA/passkeys, Sentry or equivalent observability, and browser/concurrency tests must be configured and evidenced in the deployment environment before calling the rail fully production-ready.
