# OxSteed Credit Requirements Matrix

Updated 2026-09-14. This matrix is the engineering evidence gate for the
code-completion goal. A row marked `environment` is implemented in code but
cannot be called production-ready until the listed isolated or live check has
been run. Human licensing, custody, contracts, and provider approval belong in
the separate launch handoff.

Current evidence: the live Colima PostgreSQL database is at migration `515`;
the live application container is healthy and its public `/`, `/direct`, and
`/ready` routes return HTTP 200. The live readiness payload currently has a
missing release identifier, and the source now fails readiness for that case.
A fresh production dump was restored into a
temporary database and passed the restore verifier with 515 migrations, all 10
required Credit tables, and all 4 partner/conversion integrity triggers. The
read-only `verify-oxsteed-credit` run inside the healthy Colima application
container also passed against the live database with zero invalid balances,
refunds, settlements, conversions, hashes, or expired holds. The
live `verify:credit` command still stops at the production prerequisite gate
because Sentry monitoring is not configured; that is an activation/configuration
gap, not a reason to weaken the safety gate.
The live browser smoke check redirects unauthenticated `/oxsteed-credit` visits
to the localized `/login` screen; no authenticated customer or operator
workflow was run against production.

## Core Accounting

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Central authority ledger and immutable journal | `server/migrations/421_oxsteed_credit_foundation.sql`, `server/services/oxsteedCreditService.js` | live non-activating verifier inside the healthy Colima application container passed with zero invalid balances, entries, chains, or audit hashes; backend Credit tests | implemented; activation remains gated by production monitoring and redeployment of current source |
| Independent restaurant payable and reserve ledgers | `server/migrations/514_oxsteed_credit_partner_ledgers.sql`, `server/services/oxsteedCreditPartnerLedgerService.js` | live non-activating verifier passed with zero invalid partner ledgers/funding records; partner-ledger unit tests | implemented; external funding evidence remains an operator handoff |
| Funding and reserve release traceability | `oxsteed_credit_partner_funding_records`, admin ledger UI and routes | idempotency and integrity tests; live treasury drill | implemented; external transfer evidence must be supplied by operators |
| Loads, purchases, holds, captures, releases, refunds, transfers, and adjustments | `server/services/oxsteedCreditService.js` and Credit controllers | backend suite plus isolated PostgreSQL/Redis concurrency and insufficient-funds rollback drill | implemented; broader failure-injection and browser workflow evidence remains |
| Settlement, reversal, reconciliation, statements, disputes, and audit | Credit admin service, controllers, UI, and migrations `516_oxsteed_credit_settlement_reversal.sql` | backend suite, reversal compensating-journal test, live verifier, restore script | implemented in source; paid payout reversals require admin reason, recovery reference, idempotency, and append-only compensating journal evidence; failure-injection and end-to-end browser evidence remains; current source still requires redeployment for live proof |
| Double-spend, limits, tenant isolation, and replay defense | advisory locks, account guards, idempotency and role middleware | isolated `verify:credit-concurrency` passed: one concurrent spend committed, one rolled back, duplicate retry shared one transaction, and insufficient-funds failure left state unchanged; live schema verifier passed | partial: broader failure-injection and multi-restaurant browser evidence remains |

## Product And International Support

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Customer, restaurant, and Super Admin workflows | `client/src/pages/food/OxsteedCreditPage.jsx`, `client/src/pages/food/OxsteedCreditPartnerManager.jsx`, `client/src/admin/pages/super/OxsteedCreditAdmin.jsx` | `client` typecheck/build, API/controller tests, and live unauthenticated route guard | implemented; authenticated browser and responsive QA remain |
| Accessible loading, empty, failure, retry, and emergency controls | Credit page states, admin controls, rail status gates, visible admin retry path | live localized login boundary and client build; authenticated failure-path checks remain | partial: full browser accessibility evidence remains |
| Currency precision and currency-isolated reporting | explicit minor-unit map and currency checks in `oxsteedCreditService.js`; runbook Currency Isolation | server currency tests and verifier | implemented; per-market funding/settlement drill remains |
| Cross-currency conversion safety | `server/migrations/515_oxsteed_credit_currency_conversions.sql`, `server/services/oxsteedCreditCurrencyConversionService.js`, quote/conversion API routes | conversion unit tests, exact-rate idempotency regression test, isolated PostgreSQL quote-to-ledger drill, daily-cap advisory-lock regression test, and verifier | implemented; live migration and provider-backed sandbox drill remain |
| Localization, time zones, and regional policy enforcement | localized customer UI, server policy validation, ISO currency configuration | i18n checks and regional API tests | partial: complete browser locale matrix remains |

## Security, Integrations, And Operations

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Secrets, HMAC ledger integrity, authorization, and audit | Credit service secret validation, HMAC entries, role middleware, audit events | live non-activating verifier and deployed secret replacement/restart passed; backend security tests | implemented; Sentry monitoring is still required before activation |
| Provider adapters, webhooks, reconciliation, and outage handling | provider-specific adapters and webhook handlers in `server/`; payment worker atomically publishes exhausted provider jobs to a queue-specific dead-letter list and provides an atomic operator requeue command | contract fixtures, webhook receipt replay protection, queue failure-path tests, dead-letter preservation/requeue coverage, and guarded `server/scripts/verify-payment-queue-recovery.js` run against real Colima Redis; live Stripe credentials are deployed | partial: provider sandbox/event-delivery and end-to-end outage runs remain |
| Workers, diagnostics, health, and readiness | worker config, `/ready`, `/health`, verifier scripts | worker tests and readiness checks | partial: live worker recovery observation remains |
| Reproducible build, migration upgrade, and release identification | Dockerfile, compose deployment, migration runner, deterministic image release metadata, and production release readiness gate | client `build:ci`, deployed image `5582f99a`, migration 515 startup, and live non-activating verifier; source now generates a shared `content-<hash>` release when Coolify does not inject commit metadata | partial: redeploy the current image and apply migration 516, then rerun readiness and Credit verification; explicit `SENTRY_RELEASE`, `COMMIT_SHA`, or `SOURCE_COMMIT` remains preferred for incident correlation |
| Automated backup and tested restoration | complete Coolify snapshot runner `scripts/backup-coolify-production.sh`, manifest/checksum monitor, launchd templates, and `scripts/verify-production-restore.sh`; active MacBook monitor ignores incomplete benchmark directories | runner syntax/plist/deployment wiring verified; active monitor passed complete snapshot `20260914T094542Z`; fresh production dump restored and verified with 515 migrations, 10 Credit tables, and 4 partner/conversion triggers; temporary database removed | partial: configure the approved off-host recovery copy, install the versioned scheduler/monitor, run one successful versioned backup, and repeat restore verification on schedule |
| Performance and resource targets | bounded page sizes, transaction and export limits, retry controls, bounded PostgreSQL pool | isolated restored-database `verify:credit-performance` passed: 10 account reads p95 1.42s, 10 transaction reads p95 0.85s, 10 eligibility reads p95 0.67s, and 8 parallel purchases p95 5.03s; all wallets ended at 9,990 cents with zero reservations | partial: rerun against the deployed artifact after the pool/read-path change; shared partner-payable writes intentionally serialize on one ledger row |

## Completion Gate

The code-completion goal is complete only when every `implemented` row has been
run against the intended artifact and database, and every `partial` row has
its listed evidence or an explicitly accepted engineering exception. A live
provider or human launch dependency may remain in the launch handoff, but it
must not be represented as a passing software verification result.
