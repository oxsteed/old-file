# OxSteed Credit Requirements Matrix

Updated 2026-09-14. This matrix is the engineering evidence gate for the
code-completion goal. A row marked `environment` is implemented in code but
cannot be called production-ready until the listed isolated or live check has
been run. Human licensing, custody, contracts, and provider approval belong in
the separate launch handoff.

Current evidence: the live Colima PostgreSQL database is at migration `515`;
the live application container is healthy and its public `/`, `/direct`, and
`/ready` routes return HTTP 200. A fresh production dump was restored into a
temporary database and passed the restore verifier with 515 migrations, all 10
required Credit tables, and all 4 partner/conversion integrity triggers. The
live `verify:credit` command still stops at the production prerequisite gate
because Sentry monitoring is not configured; that is an activation/configuration
gap, not a reason to weaken the safety gate.

## Core Accounting

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Central authority ledger and immutable journal | `server/migrations/421_oxsteed_credit_foundation.sql`, `server/services/oxsteedCreditService.js` | live non-activating `verify:credit` passed with zero invalid balances, entries, chains, or audit hashes; backend Credit tests | implemented; activation remains gated by production monitoring |
| Independent restaurant payable and reserve ledgers | `server/migrations/514_oxsteed_credit_partner_ledgers.sql`, `server/services/oxsteedCreditPartnerLedgerService.js` | live non-activating `verify:credit` passed with zero invalid partner ledgers/funding records; partner-ledger unit tests | implemented; external funding evidence remains an operator handoff |
| Funding and reserve release traceability | `oxsteed_credit_partner_funding_records`, admin ledger UI and routes | idempotency and integrity tests; live treasury drill | implemented; external transfer evidence must be supplied by operators |
| Loads, purchases, holds, captures, releases, refunds, transfers, and adjustments | `server/services/oxsteedCreditService.js` and Credit controllers | backend suite plus isolated PostgreSQL/Redis concurrency and insufficient-funds rollback drill | implemented; broader failure-injection and browser workflow evidence remains |
| Settlement, reversal, reconciliation, statements, disputes, and audit | Credit admin service, controllers, UI, and migrations | backend suite, live verifier, restore script | implemented; settlement failure-injection and end-to-end browser evidence remains |
| Double-spend, limits, tenant isolation, and replay defense | advisory locks, account guards, idempotency and role middleware | isolated `verify:credit-concurrency` passed: one concurrent spend committed, one rolled back, duplicate retry shared one transaction, and insufficient-funds failure left state unchanged; live schema verifier passed | partial: broader failure-injection and multi-restaurant browser evidence remains |

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
| Secrets, HMAC ledger integrity, authorization, and audit | Credit service secret validation, HMAC entries, role middleware, audit events | live non-activating verifier and deployed secret replacement/restart passed; backend security tests | implemented; Sentry monitoring is still required before activation |
| Provider adapters, webhooks, reconciliation, and outage handling | provider-specific adapters and webhook handlers in `server/` | contract fixtures and failure-path tests; live Stripe credentials are deployed | partial: provider sandbox/event-delivery and outage runs remain |
| Workers, diagnostics, health, and readiness | worker config, `/ready`, `/health`, verifier scripts | worker tests and readiness checks | partial: live worker recovery observation remains |
| Reproducible build, migration upgrade, and release identification | Dockerfile, compose deployment, migration runner, build metadata | client `build:ci`, deployed image `6b2bdf8d`, migration 515 startup, and live non-activating verifier | partial: CI/deploy rerun with the current uncommitted monitoring change remains |
| Automated backup and tested restoration | deployment backup procedure and `scripts/verify-production-restore.sh` | fresh production dump restored and verified with 515 migrations, 10 Credit tables, and 4 partner/conversion triggers; temporary database removed | partial: backup scheduling/off-host retention and recurring restore evidence remain |
| Performance and resource targets | bounded page sizes, transaction and export limits, retry controls | documented workload benchmark | partial: run and record target workload measurements |

## Completion Gate

The code-completion goal is complete only when every `implemented` row has been
run against the intended artifact and database, and every `partial` row has
its listed evidence or an explicitly accepted engineering exception. A live
provider or human launch dependency may remain in the launch handoff, but it
must not be represented as a passing software verification result.
