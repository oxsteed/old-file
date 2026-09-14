# OxSteed Credit Requirements Matrix

Updated 2026-09-14. This matrix is the engineering evidence gate for the
code-completion goal. A row marked `environment` is implemented in code but
cannot be called production-ready until the listed isolated or live check has
been run. Human licensing, custody, contracts, and provider approval belong in
the separate launch handoff.

Current evidence: the live Colima PostgreSQL database is at migration `514`;
the isolated `514 -> 515` upgrade and conversion drill pass
`verify-oxsteed-credit.js` with no missing schema objects, integrity triggers,
invalid conversion records, or invalid ledger hashes. The latest production application
container is still stopped because its Coolify environment contains placeholder
production secrets; that is a deployment configuration handoff, not a reason to
weaken the startup safety gate.

## Core Accounting

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Central authority ledger and immutable journal | `server/migrations/421_oxsteed_credit_foundation.sql`, `server/services/oxsteedCreditService.js` | `server/scripts/verify-oxsteed-credit.js`, backend Credit tests | implemented; run against target database |
| Independent restaurant payable and reserve ledgers | `server/migrations/514_oxsteed_credit_partner_ledgers.sql`, `server/services/oxsteedCreditPartnerLedgerService.js` | isolated upgrade from the latest dump, live `verify:credit`, partner-ledger unit tests | implemented; live funding drill remains |
| Funding and reserve release traceability | `oxsteed_credit_partner_funding_records`, admin ledger UI and routes | idempotency and integrity tests; live treasury drill | implemented; external transfer evidence must be supplied by operators |
| Loads, purchases, holds, captures, releases, refunds, transfers, and adjustments | `server/services/oxsteedCreditService.js` and Credit controllers | backend suite and API route tests | implemented; real database concurrency run remains |
| Settlement, reversal, reconciliation, statements, disputes, and audit | Credit admin service, controllers, UI, and migrations | backend suite, verifier, restore script | implemented; restore and failure-injection evidence remains |
| Double-spend, limits, tenant isolation, and replay defense | advisory locks, account guards, idempotency and role middleware | focused tests plus real PostgreSQL/Redis concurrency test | partial: live concurrency evidence remains |

## Product And International Support

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Customer, restaurant, and Super Admin workflows | `client/src/pages/food/OxsteedCreditPage.jsx`, `client/src/pages/food/OxsteedCreditPartnerManager.jsx`, `client/src/admin/pages/super/OxsteedCreditAdmin.jsx` | `client` typecheck/build and API/controller tests | implemented; browser and responsive QA remain |
| Accessible loading, empty, failure, retry, and emergency controls | Credit page states, admin controls, rail status gates | browser accessibility and failure-path checks | partial: browser evidence remains |
| Currency precision and currency-isolated reporting | explicit minor-unit map and currency checks in `oxsteedCreditService.js`; runbook Currency Isolation | server currency tests and verifier | implemented; per-market funding/settlement drill remains |
| Cross-currency conversion safety | `server/migrations/515_oxsteed_credit_currency_conversions.sql`, `server/services/oxsteedCreditCurrencyConversionService.js`, quote/conversion API routes | conversion unit tests, isolated PostgreSQL quote-to-ledger drill, and verifier | implemented; live migration and provider-backed sandbox drill remain |
| Localization, time zones, and regional policy enforcement | localized customer UI, server policy validation, ISO currency configuration | i18n checks and regional API tests | partial: complete browser locale matrix remains |

## Security, Integrations, And Operations

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Secrets, HMAC ledger integrity, authorization, and audit | Credit service secret validation, HMAC entries, role middleware, audit events | backend security tests and `verify:credit` | implemented; deployment secret rotation drill remains |
| Provider adapters, webhooks, reconciliation, and outage handling | provider-specific adapters and webhook handlers in `server/` | contract fixtures and failure-path tests | partial: live provider credentials and sandbox runs remain |
| Workers, diagnostics, health, and readiness | worker config, `/ready`, `/health`, verifier scripts | worker tests and readiness checks | partial: live worker recovery observation remains |
| Reproducible build, migration upgrade, and release identification | Dockerfile, compose deployment, migration runner, build metadata | `client` build, `npm run migrate`, `verify:credit` | partial: target-environment upgrade run remains |
| Automated backup and tested restoration | deployment backup procedure and `scripts/verify-production-restore.sh` | restore verifier checks 10 Credit tables and 4 partner/conversion triggers; isolated schema upgrade passed | partial: full restore verifier still requires a healthy database container and a complete snapshot |
| Performance and resource targets | bounded page sizes, transaction and export limits, retry controls | documented workload benchmark | partial: run and record target workload measurements |

## Completion Gate

The code-completion goal is complete only when every `implemented` row has been
run against the intended artifact and database, and every `partial` row has
its listed evidence or an explicitly accepted engineering exception. A live
provider or human launch dependency may remain in the launch handoff, but it
must not be represented as a passing software verification result.
