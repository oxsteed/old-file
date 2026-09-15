# OxSteed Credit Requirements Matrix

Updated 2026-09-15. This matrix is the engineering evidence gate for the
code-completion goal. A row marked `environment` is implemented in code but
cannot be called production-ready until the listed isolated or live check has
been run. Human licensing, custody, contracts, and provider approval belong in
the separate launch handoff.

Current evidence: the live Colima PostgreSQL database is at migration `516`;
the deployed application container image is
`tdrapz1vvcoftfwsk7fcdq0h_app:0a0ec7853830d76fcbf7e4163a5354f01bc114ed`, is
healthy, and its `/ready` payload reports release `content-31a6dffe8f22ad24`
with database, migrations, Redis, Credit ledger, realtime, workers, and traffic
checks healthy. The read-only `verify-oxsteed-credit` run using the current
verifier source passed against the live database with zero invalid balances,
refunds, settlements, conversions, hashes, or expired holds. A fresh dump from
that database was restored into a temporary database and passed the strengthened
restore verifier with 516 migrations, all 11 Credit tables, and all 5 Credit
integrity triggers. The live production `verify:credit` command still stops at
the prerequisite gate because Sentry monitoring is not configured; that is an
activation/configuration gap, not a reason to weaken the safety gate.
The Credit rail readiness check is healthy but currently disabled as an
emergency activation state; no live value movement was enabled by this pass.
The live browser smoke check redirects unauthenticated `/oxsteed-credit` visits
to the localized `/login` screen; no authenticated customer or operator
workflow was run against production.

## Core Accounting

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Central authority ledger and immutable journal | `server/migrations/421_oxsteed_credit_foundation.sql`, `server/services/oxsteedCreditService.js` | current-source non-activating verifier transiently run inside the healthy Colima application container passed with zero invalid balances, entries, chains, or audit hashes; backend Credit tests | implemented; activation remains gated by production monitoring and redeployment of the patched verifier source |
| Independent restaurant payable and reserve ledgers | `server/migrations/514_oxsteed_credit_partner_ledgers.sql`, `server/services/oxsteedCreditPartnerLedgerService.js` | live non-activating verifier passed with zero invalid partner ledgers/funding records; partner-ledger unit tests | implemented; external funding evidence remains an operator handoff |
| Funding and reserve release traceability | `oxsteed_credit_partner_funding_records`, admin ledger UI and routes | idempotency and integrity tests; live treasury drill | implemented; external transfer evidence must be supplied by operators |
| Loads, purchases, holds, captures, releases, refunds, transfers, and adjustments | `server/services/oxsteedCreditService.js` and Credit controllers | backend suite plus isolated PostgreSQL/Redis concurrency and insufficient-funds rollback drill | implemented; broader failure-injection and browser workflow evidence remains |
| Settlement, reversal, reconciliation, statements, disputes, and audit | Credit admin service, controllers, UI, and migrations `516_oxsteed_credit_settlement_reversal.sql` | backend suite, reversal compensating-journal test, current-source live verifier, and strengthened restore script | implemented in source; paid payout reversals require admin reason, recovery reference, idempotency, and append-only compensating journal evidence; failure-injection and end-to-end browser evidence remains; patched verifier source still requires redeployment for artifact-level proof |
| Double-spend, limits, tenant isolation, and replay defense | advisory locks, account guards, idempotency and role middleware | isolated migration-516 `verify:credit-concurrency` passed: one concurrent spend committed, one rolled back, duplicate retry shared one transaction, and insufficient-funds failure left state unchanged; live schema verifier passed; disposable database was removed | partial: broader failure-injection and multi-restaurant browser evidence remains |

## Product And International Support

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Customer, restaurant, and Super Admin workflows | `client/src/pages/food/OxsteedCreditPage.jsx`, `client/src/pages/food/OxsteedCreditPartnerManager.jsx`, `client/src/admin/pages/super/OxsteedCreditAdmin.jsx`, and the read-only Customer 360 detail panel | `client` typecheck/build, API/controller tests, and live unauthenticated route guard | implemented; authenticated browser and responsive QA remain |
| Accessible loading, empty, failure, retry, and emergency controls | Credit page states, admin controls, rail status gates, visible admin retry path, and focused in-app dialogs for destructive/status actions | live localized login boundary and client build; authenticated failure-path checks remain | partial: full browser accessibility evidence remains |
| Currency precision and currency-isolated reporting | explicit minor-unit map and currency checks in `oxsteedCreditService.js`; runbook Currency Isolation | server currency tests and verifier | implemented; per-market funding/settlement drill remains |
| Cross-currency conversion safety | `server/migrations/515_oxsteed_credit_currency_conversions.sql`, `server/services/oxsteedCreditCurrencyConversionService.js`, quote/conversion API routes; customer quote reads expose terms only while Super Admin reads retain provider/audit fields | conversion unit tests, exact-rate idempotency regression test, customer quote redaction regression, isolated PostgreSQL quote-to-ledger drill, daily-cap advisory-lock regression test, and verifier | implemented; live migration and provider-backed sandbox drill remain |
| Localization, time zones, and regional policy enforcement | localized customer/operator UI plus Credit admin entitlement, partner-ledger, action-dialog, and Customer 360 entry/recovery states; server policy validation and ISO currency configuration | 321-key parity and surface checks across en/es/fr/ht/ar, plus regional API tests | partial: complete browser locale matrix remains |

## Security, Integrations, And Operations

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Secrets, HMAC ledger integrity, authorization, and audit | Credit service secret validation, HMAC entries, role middleware, audit events | live non-activating verifier and deployed secret replacement/restart passed; backend security tests | implemented; Sentry monitoring is still required before activation |
| Provider adapters, webhooks, reconciliation, and outage handling | provider-specific adapters and webhook handlers in `server/`; payment worker claims jobs with visibility leases, atomically reclaims stale jobs after worker crashes, acknowledges already-completed duplicate claims, dead-letters unprocessable queue jobs, propagates Redis acknowledgment failures into retry/dead-letter handling, fails unmatched Stripe payment updates for retry/dead-letter handling, delegates notification delivery to the real fan-out service, and moves exhausted provider jobs to a queue-specific dead-letter list with an atomic operator requeue command | contract fixtures, webhook receipt replay protection, worker notification success/failure tests, optional Stripe payload handling, unmatched-payment regression, duplicate-claim acknowledgment regression, unknown-processor dead-letter regression, acknowledgment-failure regression, queue failure-path tests, expired-lease reclamation, dead-letter preservation/requeue coverage, and guarded `server/scripts/verify-payment-queue-recovery.js` run against real Colima Redis; live Stripe credentials are deployed | partial: provider sandbox/event-delivery and end-to-end outage runs remain |
| Workers, diagnostics, health, and readiness | worker config, `/ready`, `/health`, verifier scripts; claimed duplicate jobs are acknowledged when their completion marker already exists, and unknown claimed jobs are preserved for operator recovery | worker tests, duplicate-claim acknowledgment regression, unknown-processor dead-letter regression, worker failure/retry contracts, and readiness checks | partial: live worker recovery observation remains |
| Reproducible build, migration upgrade, and release identification | Dockerfile, compose deployment, migration runner, deterministic image release metadata, and production release readiness gate | client `build:ci`, deployed image `0a0ec7853830d76fcbf7e4163a5354f01bc114ed`, migration 516 startup, readiness release `content-31a6dffe8f22ad24`, and current-source live non-activating verifier; source generates a shared `content-<hash>` release when Coolify does not inject commit metadata | partial: deploy the patched verifier source and rerun the production-gated Credit verification after Sentry monitoring is configured; explicit `SENTRY_RELEASE`, `COMMIT_SHA`, or `SOURCE_COMMIT` remains preferred for incident correlation |
| Automated backup and tested restoration | complete Coolify snapshot runner `scripts/backup-coolify-production.sh`, manifest/checksum monitor, launchd templates, and `scripts/verify-production-restore.sh`; runner pins the Colima context before health checks, supplies launchd-safe paths, and prevents overlapping runs with an atomic lock; active MacBook monitor ignores incomplete benchmark directories | runner syntax/plist/deployment wiring verified; non-destructive live monitor passed complete snapshot `20260914T094542Z` with Colima health and public readiness; fresh current-database dump restored and verified with 516 migrations, 11 Credit tables, and 5 Credit integrity triggers; temporary database removed | partial: configure the approved off-host recovery copy, install the versioned scheduler/monitor, run one successful versioned backup, and repeat restore verification on schedule |
| Performance and resource targets | bounded page sizes, transaction and export limits, retry controls, bounded PostgreSQL pool | isolated migration-516 restored-database `verify:credit-performance` passed: 10 account reads p95 0.854s, 10 transaction reads p95 0.629s, 10 eligibility reads p95 1.129s, and 8 parallel purchases p95 3.109s; all wallets ended at 9,990 cents with zero reservations | partial: rerun against the deployed artifact after the pool/read-path change; shared partner-payable writes intentionally serialize on one ledger row |

## Completion Gate

The code-completion goal is complete only when every `implemented` row has been
run against the intended artifact and database, and every `partial` row has
its listed evidence or an explicitly accepted engineering exception. A live
provider or human launch dependency may remain in the launch handoff, but it
must not be represented as a passing software verification result.
