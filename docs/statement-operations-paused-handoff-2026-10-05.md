# Statement operations - paused implementation handoff

Date: 2026-10-05. Prepared for Emile Jean Philippe and the next developer.
Status: LOCAL WIP CHECKPOINT. NOT PUSHED, NOT DEPLOYED, NOT PRODUCTION APPROVED.

## Start here

The owner stopped implementation to preserve usage and requested a commit plus this email handoff. Continue from the checkpoint commit containing this file, not from the older email claiming that all eight workstreams were complete.

Repository: oxsteed/old-file. Checkout: /Users/oxsteed/Documents/GitHub/6. Branch: old-files-claude. Starting HEAD before this checkpoint: c0eb264a68a44a0a9ec425dc114e5e8a0cae7624.

Read AGENTS.md, README.md, RUNBOOK.md, docs/credit-statements.md, docs/statement-operations-code-review-2026-10-05.md and docs/statement-operations-remediation-handoff-2026-10-05.md. The code review contains the original 13 findings. The remediation handoff contains the complete requirement and acceptance instructions. This checkpoint supersedes their implementation-status assumptions, not their requirements.

This local commit has NOT been pushed because the production branch auto-deploys through Coolify. Obtain approval before pushing/deploying it. Prefer a reviewed development branch/PR after verification. No production database, real money, credentials, or R2 settings were changed.

Cloudflare R2 is the intended storage. The AWS SDK is only the S3-compatible client. Do NOT migrate to AWS or reuse the public uploads/backup bucket for statements.

## What is saved

1. Private storage/publication (R01/R02): added statementStorage.js, dedicated private R2 runtime configuration, no local fallback, generic local-route statement blocking, publication advisory locks and fencing tokens, staged-object recovery, verified ready downloads, immutable ready metadata, DB validation before document/outbox creation, frozen original language, frozen-document reads, and a pipeline heartbeat scaffold.
2. Accounting (R03/R04/R07): added immutable observations of existing invoice/job/payment writers; independently computed boundary positions and actual movements; source-history continuity and fail-closed legacy/unsupported cases; final-day expense inclusion. This observes existing authoritative records, not a new money ledger.
3. Serialization (R06/R13): exact currency precision and hostile spreadsheet-cell neutralization in settlement CSV; localized heading adjustments.
4. Recovery/CI (R08/R11): persisted discovery cursor/phase, terminal-run reopening, catch-up/retry audit and limits, five-product controls, bounded missed-period scanning, coverage distinctions, schema-valid fixtures and a CI gate against silently skipped required DB suites.
5. Exports (R05, PARTIAL): durable request/status/cancel/retry/manifest/download APIs, SQL-frozen rows, bounded keyset reading, streamed CSV, numbered PDF volumes, checksum verification, fencing/fairness/disk budgets, notifications and worker lifecycle wiring. Helper/business adapters and complete automatic large-account issuance are NOT finished.
6. User workflows (R09/R10/R12, IN PROGRESS): settlement self-service routes and scope discovery, shared archive/amendment pagination, real restaurant investigation/support linkage, activity-source correction references, export UI and localized strings. These require integrated regression/browser verification.

Additive migrations 692-695 are checkpoint code, not applied production migrations:
- 692_statement_publication_integrity.sql: artifact bucket/token/label identity, ready immutability, original language.
- 693_statement_export_jobs.sql: frozen documents and durable export evidence/jobs/files.
- 694_settlement_source_history.sql: authoritative source-observation triggers and baseline.
- 695_statement_run_recovery.sql: discovery cursor/phase/generation.

Do not change an already APPLIED production migration checksum. Before release, inspect current remote migration numbers and reconcile conflicts. Existing local test databases saw migration files while they were still being authored; that produced checksum mismatches. Never repair this by rewriting migration records or disabling guards. Rehearse the FINAL catalog in a new disposable database.

## Highest-priority unfinished work

### A. Resolve the integrated issuance prerequisites

Parent added heartbeat calls every 30 seconds with a 120-second renewal and renderer abort signaling. BUT statementJobService.renewLease still only accepts state leased. It must safely renew leased, snapshotted, artifact_ready and notified while checking current fencing token, lease owner and unexpired lease; completed/failed/reclaimed ownership must reject. Test this before deployment. Otherwise a healthy long-running pipeline can abort/reclaim itself.

The issuer now uses snapshots.getFrozenDocument(snapshot.id). Verify that freeze stores actual document content, every retry renders the same frozen source, hash/totals/cutoff checks pass, and archived JSON agrees with the original PDF. Legacy hash-only snapshots intentionally fail visibly; do not silently associate them with a new live-data build. Establish an authorized, checksum-preserving legacy recovery procedure.

Re-run the publication crash/race tests. Confirm busy/stale publishers cannot duplicate an original, delete a newly adopted object, or emit duplicate notifications. Re-run document/outbox crash tests with the SAME fake object store across retries. An empty new fake store correctly simulates a missing original and must not bypass verification.

Check notification destinations: the issuer's PRODUCT_ACTION_URLS was changed to settlement URLs ending /statements/archive, while current App routes for restaurant-settlement, helper-earnings and business are /statements (without /archive). Align these three destinations or register appropriate aliases and add route-contract tests. Verify amendment and export notification links too.

### B. Fix the reproduced invoice-payment controller defect

businessInvoiceController.markInvoicePaid returns HTTP 500 in real PostgreSQL tests:
"inconsistent types deduced for parameter $2".

Inspect the real SQL and cast/bind parameters consistently with their authoritative column types. Preserve existing invoice/payment approval rules and money arithmetic. Add a behavior regression for the route/controller. This caused three failures in statementSettlementFinancialHistory.db.test.js, including dependent accounting assertions. Do not mask these failures by weakening the source-history projector.

### C. Complete R05 rather than merely exposing an accepted job

The new export service is substantial but incomplete:
- Implement bounded helper-earnings and business source adapters against verified immutable source observations, with independent balances/movements and precise currency handling.
- Restaurant-settlement exports currently cover the journal only; include supplementary sections required by the document contract or explicitly reject an incomplete contract. Do not call a partial journal the full settlement statement.
- Automatic large-account issuance still uses the capped original builder. Delegate to the complete durable export workflow without truncation, changed financial content, duplicate originals or unusable notifications.
- Run the million-entry DB/publication test, not only the million-entry synthetic accumulator.
- Verify cancellation during freeze/render/upload, retry using unchanged frozen rows, uncertain upload recovery, changed bucket denial, process restart, fairness and cross-replica resource limits.
- Review R2 stream deadlines and both server/browser memory use. The current client download obtains a Blob; a very large CSV can consume hundreds of MiB. Finish a bounded, authenticated download strategy or an honest supported-size/recovery contract.
- Ensure current authorization is rechecked after finance membership removal and on status, manifest, retry, cancel and download.
- Verify API error/status messages, temporary disk cleanup and notification idempotency.

### D. Finish user workflows and correction proof

Check credit-account shapes passed into StatementExportPanel. OxSteed account responses may use id rather than accountId; restaurant wallets must select restaurant scope rather than wallet id. Normalize all five product shapes and test multiple currencies.

Provide explicit localized loading, no eligible account, unavailable source-history, removed-access, retry and failure states. A permanently disabled form or generic error alone is insufficient.

Verify real Restaurant Credit support records: existing authoritative case creation, explicit statement/entry/order references, deduplication, follow-up/status, current record authorization and no money movement. Check both error recovery and removed access.

Verify helper/business accounting amendment references against immutable source observations. Preserve maker/checker, stale-approval rejection, scope/currency validation, nonzero actual corrections, no duplicate references, original immutability and subsequent-period continuity. Do not turn a mutable title/status edit into an invented compensating financial transaction. Unsupported allocation evidence must remain clearly blocked.

Verify pagination is in originals with each complete revision chain attached, stable ordering, accurate total/totalPages and versionTotal metadata. Refresh/back/locale changes must preserve product/scope.

Repair the new statementSelfService.db.test.js fixture's null snapshot created_at, then rerun against the finalized migrated database. Verify amendment publication crash recovery: a retry must preserve the original envelope identity and exact staged PDF bytes, rather than accidentally rerendering different bytes under the same identity.

### E. Validate migration and financial-history rollout safety

Migration 694 installs history triggers and captures an observation baseline at the actual installation time. It does NOT reconstruct missing historic payment/refund timestamps. Pre-baseline history, unsupported helper refund/cancellation net allocations and unsupported legacy currencies intentionally fail closed.

Rehearse startup against production-like existing synthetic records, rollback atomicity and migration re-run. Inspect the baseline's table locks/runtime/size before a production maintenance window. Never fabricate historical observations, disable immutable-history triggers, or reinterpret missing evidence as zero.

Verify the actor/source correction references and the new 693 frozen-document guard coexist with amendment/rendition flows. Ready artifacts and original document records must remain immutable.

## Verification actually performed

Do not add the counts below together; runs overlap and refer to different moments during editing.

Parent:
- client npm run verify:i18n: passed, five-language parity and static references.
- client npm run typecheck: passed at that checkpoint.
- statementPrivateStorage + statementExportPipeline: 2 suites, 37 passed.
- git diff --check and main artifact/issuer/export syntax checks: passed.
- Earlier integrated issuance/publication run: 32 passed, 4 failed; recovery fake-store and scheduler assertions were subsequently adjusted, but final integrated rerun remains pending.
- Later snapshot run failed because the shared DB lacked the newly added frozen_document column; this is not a passing final migration rehearsal.

Recovery agent:
- 7 focused suites, 88 passed, 0 failed, 0 skipped.
- Latest coverage-test/guard cleanup remains unverified.
- /tmp/statement-r08-r11-focused-results.json is local transient evidence, not a repo artifact.

Accounting agent:
- Accounting/CSV suites: 69 passed.
- Accounting/CSV/new PostgreSQL suites: 75 passed, 3 failed on the invoice-payment SQL defect.
- Existing settlement/issuance suites: 33 passed, 15 failed due missing frozen_document in that test schema.
- Migration 694 applied/reapplied in a disposable schema, but full fresh-catalog rehearsal remains pending.

Export agent:
- Earlier pipeline/worker/service run: 99 passed, before later frozen-document changes.
- Real PostgreSQL/API export run: 15 passed, 1 intentionally excluded; exercised SQL freezes through 100,000 rows, CSV publication/download, actual PDF worker/volumes, ownership, cancellation/fencing/fairness/disk and changed-bucket denial.
- Million-entry accumulator passed; million-entry DB/publication run NOT performed.
- Migration 693 passed in an agent's disposable schema, not a final whole-catalog rehearsal.

User-workflow agent:
- Client statement tests: 8 passed; source-amendment unit tests: 4 passed.
- Earlier archive/amendment DB run: 33 passed, 1 failed; expired-link fixture was subsequently adjusted.
- Latest four-suite DB run: 25 passed, 19 failed. Archive and source-amendment passed; amendment failures included missing frozen_document in the interim database, and the new self-service fixture failed on null snapshot created_at.
- Newest export/UI changes were not revalidated with localization/typecheck/build or browsers. No migration 696 was created.

The final full server suite, client build:ci, authenticated new-workflow browser matrix, live R2 checks, production restore and final load/capacity acceptance have NOT passed for this checkpoint.

## Required next verification

1. Provision a NEW loopback-only disposable PostgreSQL16/PostGIS database named credit_statement_test. Use synthetic fixtures only. Follow repository guards; do not read production connection values or mutate production volumes.
2. Apply the complete finalized migration catalog twice. Include existing-data upgrade rehearsal for 692-695 and inspect indexes/triggers/query plans.
3. Set all test opt-ins to the same approved disposable DSN: STATEMENT_TEST_DATABASE_URL, STATEMENT_JOB_TEST_DATABASE_URL, STATEMENT_INVESTIGATION_TEST_DATABASE_URL, ADMIN_GRANT_TEST_DATABASE_URL. Set STATEMENT_REQUIRE_DB_TESTS=true. Run the new source-history, amendment, self-service, export jobs, recovery and publication suites plus every existing statement/credit/support/authorization suite.
4. Run full server npm test with JSON results and scripts/assert-statement-db-tests.cjs. Provision the documented ffmpeg prerequisite. Do not silently skip important DB tests.
5. Run client verify:i18n, typecheck, build:ci and existing credit browser checks. Add authenticated five-product customer/helper/owner/manager/denied-role flows with synthetic accounts; exercise five locales, Arabic RTL, keyboard, reduced motion, mobile/desktop and both themes.
6. Prove issuance -> frozen source -> verified private artifact -> notification -> archive/download -> investigation/support -> independent amendment -> immutable revision -> recovery for every supported product.
7. Record actual hardware, latency, memory, queue rate, disk pressure and DB connection effects. A synthetic accumulator is NOT six-million-user capacity proof.

## Operational and owner gates

Private storage configuration is runtime-only:
STATEMENT_ARTIFACT_BUCKET, STATEMENT_ARTIFACT_PREFIX, STATEMENT_R2_ENDPOINT,
STATEMENT_R2_ACCESS_KEY_ID, STATEMENT_R2_SECRET_ACCESS_KEY,
STATEMENT_R2_PRIVACY_ATTESTED and optional STATEMENT_LEGACY_PREFIXES.

Use a dedicated private R2 bucket separate from public uploads and backups. An operator must confirm r2.dev/public custom domains are disabled and credentials are bucket-scoped before setting privacy attestation to 1. The attestation is not an API proof of privacy. Do not email or commit actual secret values.

Automatic missed-month recovery requires owner-approved STATEMENT_ISSUANCE_ACTIVATION_MONTH=YYYY-MM. Also obtain/document required-notice, original-language, grace/late-posting, retention/legal hold/erasure, regional handling and amendment/finance access policies.

Rehearse restoring BOTH DB manifests and exact private artifacts. Confirm deployed SHA/migration state, readiness, workers, queue age, failures and live authorized/denied reads before approving production. No real charges, payouts or disputes merely to test. This work does not fix or authorize the separately documented non-atomic restaurant payout path.

## Local cleanup and deliverables

Two agent-created disposable statement test containers remain, on loopback ports 32770 and 32771. Parent container: oxsteed-statement-fix-20261005 (tmpfs test data). Resolve and inspect exact labeled/test containers before stopping/removing; do not touch the production PostgreSQL or broad Docker volumes. They contain synthetic fixtures, not live data. Keeping them is optional; final rehearsal must use a clean schema regardless.

Deliver a reviewed completed commit/PR, accurate per-finding evidence for R01-R13, updated runbook and a completion report separating source implemented, locally verified, deployed, live verified and policy approved. No blanket claim of zero gaps or production readiness while any critical invariant/test remains unresolved.
