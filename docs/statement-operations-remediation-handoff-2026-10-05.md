# FOR DEVELOPER - Finish OxSteed Statement Operations

Prepared for Emile Jean Philippe on October 5, 2026.

Emile, please forward this complete handoff to the developer. It supplements the earlier eight-workstream instructions; it does not replace or reduce their scope.

## Objective and starting point

Finish the existing statement implementation and close the 13 findings below. The review found substantial working foundations, but six P1 release blockers and seven P2 defects or incomplete workflows. Do not treat this system as production-accepted yet.

Repository: https://github.com/oxsteed/old-file
Branch reviewed: old-files-claude
Reviewed revision: c0eb264a68a44a0a9ec425dc114e5e8a0cae7624
Revision: https://github.com/oxsteed/old-file/commit/c0eb264a68a44a0a9ec425dc114e5e8a0cae7624
Foundation: c6e373e3b52e360d2c57b3cc52255065eeaa468d

Start from the latest approved branch and verify whether subsequent changes already address each finding. Source pointers below refer to the reviewed revision; line numbers may move. Read AGENTS.md, RUNBOOK.md, docs/credit-statements.md, the original statement-operations-developer-handoff-2026-10-05.md, and statement-operations-code-review-2026-10-05.md when available. The two handoff/review documents are currently local and uncommitted; this email contains the completion instructions so it is usable independently.

The review covered the statement work, not every admin tab or unrelated delivery, cards, video, or payout feature. It used synthetic data and did not change production, financial records, issued originals, or credentials.

## Non-negotiable safeguards

- Reuse existing financial, authorization, payment, support, notification, storage and audit services. Never create another credit/payment ledger.
- Statement generation, amendment, investigation, download or replay must not move money, initiate payouts, fabricate accounting adjustments or bypass approvals.
- Preserve original issued records and bytes. Approved corrections become linked immutable versions. Use additive migrations; do not rewrite applied migrations or delete issued evidence.
- Enforce current server-side account, tenant, legal-entity, restaurant, currency and role scope on every read and action. A link or object key never grants access.
- Keep exact minor-unit arithmetic, authoritative event dates and product-specific reconciliation. Holds are not charges; provider connection is not proof of payout.
- Keep private statement storage separate from public uploads and backups. No secrets, signed URLs or customer document bodies in logs, source, email or client bundles.
- Run destructive, accounting, concurrency and load tests only in explicitly isolated synthetic environments. Preserve unrelated working-tree changes.
- Production is on the owner's MacBook using Colima/Docker/Coolify with Cloudflare R2. Infrastructure changes, production activation and financial actions need the owner's approved workflow.

## Required fixes and completion tests

### R01 - P1: Enforce genuinely private statement storage

Pointers: server/services/statementArtifactService.js:60; server/utils/storage.js:138; server/routes/storage.js:29,77.

The statement service reuses general upload storage. Its statement bucket setting does not select a separate bucket; missing credentials fall back to local uploads. The public storage route blocks delivery-private but not statements. A synthetic known-key unauthenticated GET returned the exact PDF and public one-year cache headers. This proves the fallback defect, not exposure of a real customer's R2 document.

Implement a statement-specific private adapter/namespace and genuinely selected private bucket. Fail closed when unsafe or unconfigured. Block default and configurable statement prefixes from every public storage path. Preserve normal public uploads and the backup bucket. Authenticated downloads must reauthorize the current viewer.

Tests: absent credentials, wrong bucket, unsafe fallback, unauthenticated known key, cross-owner/restaurant/business, removed membership and expired links. Prove actual private R2 upload/read behavior in an approved environment, not merely a mocked URL.

### R02 - P1: Repair crash-safe artifact publication

Pointers: statementArtifactService.js:255; statementIssuanceService.js:643,674.

Retry currently returns existing staged/verifying artifacts without uploading or verifying them. A full synthetic issuance job became complete while its artifact remained staged and made zero storage calls. Notification then refuses the artifact. Object-key uniqueness also does not enforce one live original per snapshot/kind/language.

Implement resumable publication with leases/locking and stale-worker fencing. Reconcile uncertain uploads against actual object metadata/content. Require verified ready state before issuance completion or ready notification. Enforce publication identity with a database invariant and handle races safely. Provide audited repair for jobs incorrectly marked complete without a ready artifact.

Tests: crash after row insert, during upload, after upload, during verification, before document commit and before notification; overlapping publishers; lease expiry/stale workers; corrupt/missing objects. One verified original, no duplicate notification and recoverable job/outbox states are required.

### R03 - P1: Correct business accounting across periods

Pointers: server/services/settlementStatementService.js:588,617.

Opening balances use today's invoice state/amount paid. Collections are a balancing plug, and reconciliation repeats that calculation. Reproduction: August invoice 100 closed at 100; payment September 5 produced September opening 0 and collection 0.

Use authoritative dated invoice, payment, refund and approved adjustment evidence to reconstruct boundary positions and actual movements. Add approved source-history/linkage capability if absent; do not manufacture a collection or silently change issued August evidence. Reconciliation must independently test source totals.

Tests: opening 100, September collection 100 and closing 0; partial/multiple payments, cancellations, refunds, late/backdated postings, corrections and zero-activity carryover. Previous closing must equal next opening unless an approved, disclosed amendment explains the break.

### R04 - P1: Correct helper payout/reversal history

Pointers: settlementStatementService.js:405,429.

Mutable current payout status removes earnings using the original job completion date instead of the later reversal date. August closing 100 became September opening 0 with zero removals.

Derive earnings, paid amounts, reversals and corrections from dated authoritative evidence. Distinguish transport failure/retry from extinguishing money still owed. Freeze source facts and use approved amendments for historical corrections.

Tests: earnings in one month with payout/failure/retry/partial or full refund/reversal in another, correct remaining payable and exact continuity. Statements must never duplicate a payout or initiate money movement.

### R05 - P1: Deliver complete bounded high-volume exports

Pointers: creditStatementService.js:132; statementSnapshotService.js:296,370; settlementStatementService.js:369,572.

Chunking currently occurs after loading a complete document through the existing 5,000-row-limited builder. A business with 5,001 historical invoices could not issue September even with no September invoices. Shortening the period cannot fix that lifetime ceiling.

Implement the original high-volume workstream fully: one consistent frozen source cutoff, bounded/keyset source materialization, complete streamed CSV, bounded PDF rendering and numbered volumes with a complete manifest when necessary. Add idempotent request/status/cancel/retry APIs, authorized progress/recovery UI, leases/fencing, fairness and shared resource budgets. Retries use the same frozen source. Do not remove limits, truncate statements or label one partial volume as complete.

Tests: 0, 1, 5,000, 5,001, 100,000 and representative 1,000,000-entry synthetic accounts; complete counts/totals, concurrent postings, multi-worker races, restart, cancellation, disk/provider failure and ordinary API responsiveness. Record memory, connections, disk, latency, throughput and tested hardware.

### R06 - P1: Fix currency precision consistently

Pointer: server/routes/settlementStatementArchive.js:321.

Settlement CSV divides every currency by 100. JPY amount 100 exported as 1.00 instead of 100.

Reuse exact currency-aware minor-unit formatting. Document supported source precision and reject inconsistent/unsupported contracts; do not guess or use floating-point accounting.

Tests: USD, JPY, a three-decimal currency, negative/zero amounts and safe large values. JSON, PDF, CSV and UI must agree exactly.

### R07 - P2: Include expenses on the last day

Pointer: settlementStatementService.js:626.

expense_date < period.to drops the inclusive final day. A September 30 expense of 1,234 minor units produced zero September expenses.

Use the next-day exclusive end boundary consistently. Test first/last day, adjacent months, leap day and relevant date/time-zone contracts.

### R08 - P2: Make recovery controls actually resume work

Pointers: server/jobs/statementIssuanceScheduler.js:107,150,214; statementAdmin.js:345; statementJobService.js:207,385; statementIssuance.js:32,146.

Runs can become complete with dead-letter jobs. Retry makes a job pending without reopening its run; claims exclude completed runs. Catch-up can strand new work similarly. Discovery only covers the latest closed month, older pending work may not drain, resume loses the discovery phase, and manual runs only permit two credit products.

Implement an explicit run/job state machine with persisted discovery phase/cursor, bounded missed-period discovery from the approved activation boundary, independent draining of eligible jobs and all five products in operator controls. Distinguish failed coverage from success; do not silently backfill pre-activation history.

Tests: a two-month outage, dead letters in a terminal run, retry after storage repair, catch-up on completed runs, pause/resume during discovery and all five products. Queue and coverage counts must reflect eligible account-period completion.

### R09 - P2: Finish settlement self-service and accounting amendments

Pointers: client/src/App.jsx:524; statementIssuanceService.js:699; statementAmendmentService.js:84.

Helper, restaurant-settlement and business builders/APIs exist, but usable owner archive/download destinations and equivalent accessible views are missing. Notifications lead to generic dashboards. Helper/business accounting amendments remain unsupported.

Add role-authorized entry points, period/currency/history/version selection, original and revised downloads, direct notification destinations, equivalent accessible HTML and loading/empty/error/retry states. Complete authoritative accounting-correction support with independent approval and continuity; if required source evidence is absent, identify and implement that prerequisite instead of claiming completion.

Tests: helper, restaurant owner/authorized finance member, business owner/member, restricted staff, removed member and stranger; actual authenticated browser download and amendment history for every product.

### R10 - P2: Connect Restaurant Credit investigations to real cases

Pointer: server/routes/statementInvestigation.js:380.

Restaurant-wallet reporting returns statement_case_unsupported and contact support instead of an evidence-linked workflow.

Use the existing authorized support/case system with explicit statement/revision/entry/account references and idempotency. Show existing-case status and follow-up. Do not create another dispute ledger or alter balances.

Tests: duplicate submissions produce one case; exact evidence links, cross-restaurant denial, unavailable related records, customer-visible progress and no financial mutation.

### R11 - P2: Fix meaningful database tests and CI gating

Pointers: .github/workflows/ci.yml:101 and statementJobService, statementAdmin.db, statementInvestigation and adminGrantLookup tests.

CI supplies STATEMENT_TEST_DATABASE_URL but other suites need STATEMENT_JOB_TEST_DATABASE_URL, STATEMENT_INVESTIGATION_TEST_DATABASE_URL and ADMIN_GRANT_TEST_DATABASE_URL. A green CI-mode reproduction skipped 40 substantive tests. Enabling real DB tests revealed eight investigation fixture failures and two admin-grant fixture failures.

Provide consistent explicit disposable-DB configuration. Seed accounts through authoritative posting helpers rather than violating the empty-ledger invariant; create referenced region fixtures instead of assuming region 7 exists. Make required-suite skips fail CI. Never weaken production constraints or authorization to satisfy tests.

Tests: all required integration suites truly execute against current migrations; no placeholder guard-only success, hidden failure or missing foreign-key fixture. Separate genuine environment prerequisites from code failures.

### R12 - P2: Repair archive pagination and revision counts

Pointers: server/routes/statementArchive.js:500,534.

SQL version_total is read as versionTotal. Originals are paginated and then revisions appended, so total/perPage/items describe different collections.

Choose either original-level pagination with nested revisions or a consistently paginated unified version collection. Align counts, filters, page size and stable tie-breakers.

Tests: multiple pages/revisions, tied timestamps, filters, next/back navigation and no lost/duplicate originals or versions.

### R13 - P2: Neutralize CSV formula injection

Pointers: settlementStatementArchive.js:298,380; existing creditStatementPdf.js:229.

New settlement CSV only quotes delimiters. A user-controlled client name =1+1 remains a spreadsheet formula.

Reuse the hardened credit CSV contract for all untrusted text, including whitespace/BOM/direction-control prefixes; localize headings. Preserve legitimate numeric amounts separately from text neutralization.

Tests: leading =, +, -, @, tabs/spaces/BOM/RTL controls, quotes/newlines and normal names. Text must remain text when opened in a spreadsheet.

## Recommended delivery sequence

1. R01/R02: confidentiality, safe publication and repair.
2. R03/R04/R06/R07: authoritative accounting, precision and boundaries.
3. R05/R08: complete bounded export and durable recovery.
4. R09/R10/R12/R13: usable self-service, case linkage, archive and CSV.
5. R11 and regression tests for every finding.
6. All eight workstream journeys, actual authenticated browsers, private-provider checks, isolated restore and capacity verification.

Maintain an eight-workstream requirements matrix: automatic monthly issuance; private archive; amendments; investigation; admin operations/audit; high-volume exports; accessible inclusive documents/interfaces; restaurant/helper/business settlements. Each row needs source, tests, observed result, deployment state and remaining gate. Fixing the 13 defects alone does not waive the original acceptance requirements.

## Current evidence, not a clean production bill of health

- All 686 migration files through 691 applied to isolated PostgreSQL/PostGIS 16; a second migration run passed.
- Focused statement run: 324 passed, 8 failed, 6 skipped. Separately, admin-grant DB tests: 5 passed, 2 failed.
- Full server run: 398 suites passed, 2 failed, 3 skipped; 4,462 tests passed, 11 failed, 52 skipped. Eight failures were investigation fixtures; three video failures required /usr/bin/ffmpeg, absent on the macOS review host. Those video failures are an environment limitation, not established statement regressions.
- Client build:ci, translation verification and typecheck passed.
- Four existing credit-statement browser checks passed across five languages and layout variants, but used mocked APIs. They do not certify the new authenticated archive/admin/settlement flows.
- R01/R02/R03/R04/R05/R07 were synthetically reproduced; R06/R13 used production serializers. Remaining findings were code/contract inspection, not claimed production reproductions.

## Capacity and operational gates

Do not claim readiness for six million users from a small local run. Current configured nominal single-worker ceilings are 72,000 statement jobs/day and 14,400 ready notifications/day. Six million eligible monthly recipients would take roughly 417 days to notify at that setting. These are configuration calculations, not measured throughput.

Agree on close-time, queue-age, fairness, resource and error budgets; measure scaling and provider limits with representative synthetic workloads. Keep smaller deployments bounded and honest.

Also verify actual private R2 policy and access, retention/legal hold, consistent database-plus-artifact backup/restore, worker/outbox health, independent approver policy, authenticated role matrix and manual screen-reader reading of long multilingual PDFs. Obtain owner/compliance decisions for activation, eligibility, late postings, mandatory delivery, retention and amendment authority. Record external blockers; do not invent policies or claim banking/PDF conformance without evidence.

## Verification and acceptance

Run the repository's current required CI and statement suites. From client/, run npm run test:credit-statements, node --test scripts/creditStatements.browser-check.cjs, npm run verify:i18n, npm run typecheck and npm run build:ci. From server/, run the full backend suite and relevant credit/food-wallet/statement/admin-authorization suites with all required disposable-DB opt-ins enabled. Add real API/concurrency and browser tests; source-string assertions and mock-only checks are insufficient.

Use production-like synthetic PostgreSQL with additive migration/repeat-run rehearsal. Verify English, Spanish, French, Haitian Creole and Arabic, RTL, mobile/desktop, both themes, keyboard/focus/ARIA, reduced motion and tagged-PDF reading order.

Demonstrate every product:
closed period -> reconcile/freeze -> issue -> verified private original -> notify -> authorized archive/download -> linked receipt/case -> independently approved amendment -> immutable revised artifact -> operations/audit -> recovery -> isolated restore.

Recheck unauthorized reads/actions after membership removal, session expiry and revoked grants. Exercise crashes, duplicate requests/events, stale leases, corrupt artifacts, concurrent approvals, late postings and provider outages. No silent partial report, financial double count or stranded retry is acceptable.

## Deliverables and release gate

Provide:
- Reviewed commits/PR and one regression-test mapping for R01-R13.
- Updated eight-workstream matrix, accounting/date/currency and API contracts.
- Additive migration/configuration instructions without credential values.
- Operator runbook for month-end coverage, pause/resume, retry/catch-up, publication repair, amendments, outages, privacy/retention and restore.
- Machine-readable test results, authenticated browser evidence, multilingual accessibility checks and measured load/restore results.
- Deployment evidence identifying Git SHA, migration state, /ready, worker leases/queue age and authorized/denied private downloads.

Production activation remains subject to the owner's approval. An operational pause must retain jobs and issued evidence; safe rollback must not delete financial originals. Distinguish source implemented, locally verified, deployed, live verified and policy-approved. Do not declare all eight complete while a critical confidentiality, accounting, immutability, completeness or recovery gate fails. No engineering process can guarantee zero future bugs; require monitoring, ownership and tested recovery.

End of completion handoff.

