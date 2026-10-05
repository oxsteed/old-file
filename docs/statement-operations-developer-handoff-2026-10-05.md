# FOR DEVELOPER: Complete OxSteed statement operations, items 1-8

Prepared for Emile Jean Philippe on 2026-10-05. This is an implementation handoff,
not a claim that the work below has already been implemented or deployed.

## Objective and completion standard

Complete all eight workstreams below as one coherent statement service. Reuse
OxSteed's existing financial records, authorization, support, notifications,
storage, audit and approval systems. Build for customer credit, restaurant credit,
restaurant settlements, helper earnings and business payouts without combining
their balances or creating another financial ledger.

All eight are required. Deliver working code, additive migrations, operator tools,
automated and real-browser tests, deployment verification and recovery runbooks.
Do not substitute mock screens, tests that only search source text, TODOs, or
"contact support" for the requested workflows. Identify genuine policy/provider
blockers explicitly; finish independent software work, but never claim a blocked
workflow is production-approved. No reasonable engineering review can promise
zero future defects; provide evidence, alerts and recovery instead.

## Starting point: verify before changing anything

- Repository: `oxsteed/old-file`; current local checkout is
  `/Users/oxsteed/Documents/GitHub/6`, branch `old-files-claude`.
- Foundation commit: `c6e373e3b52e360d2c57b3cc52255065eeaa468d`,
  "Add reconciled credit statements and immutable monthly documents".
  It was committed locally, not pushed or deployed by this handoff. Ensure it is
  available in your working branch through the owner's approved Git workflow;
  do not assume GitHub or production contains it. Recheck newer commits and
  migration numbers before implementation. Preserve unrelated changes.
- Read `AGENTS.md`, `README.md`, `RUNBOOK.md`, `docs/credit-statements.md`,
  `docs/oxsteed-credit-requirements-matrix.md`, and `docs/deployment-ci.md`.
- Production runs on the owner's MacBook using Colima/Docker/Coolify. Cloudflare
  **R2**, not "S2", is the intended off-device object storage. Do not migrate
  production to AWS, start another Docker stack, replace production volumes,
  or change the backup bucket without separate authorization.
- Current customer routes: `/oxsteed-credit/statements` and
  `/restaurant-credit/statements`. Current monthly documents are immutable
  accounting JSON snapshots issued on demand; PDFs are rendered on download.
- Migration `682_credit_statement_documents.sql` creates snapshot records and
  blocks UPDATE/DELETE. Keep existing issued records intact. No scheduler,
  stored original-PDF archive or amendment workflow exists in this foundation.
- Current synchronous limits: 366-day period, 5,000 rows/holds, 15-second statement
  query timeout, 60-second PDF worker deadline, 32 MiB PDF result, and an export
  concurrency budget defaulting to two operations. Do not simply remove limits.
- Prior local evidence: 39 relevant server suites / 738 tests, four browser
  checks, translation verification, typecheck, client CI build, and disposable
  PostgreSQL migration/rehearsal passed. These are historical baseline results,
  not proof your revision or production is healthy.

Primary implementation files:

- `server/services/creditStatementService.js`: ownership, periods, exact balances,
  repeatable-read snapshots, immutable issuance and content checksums.
- `server/services/creditStatementPdf.js`, `creditStatementExport.js`,
  `creditStatementPdfWorker.js`: localized PDF/CSV and bounded worker rendering.
- `server/controllers/creditStatementController.js` and
  `server/routes/{oxsteedCredit,food,admin}.js`: current protected APIs.
- `client/src/pages/food/CreditStatementsPage.{jsx,css}`,
  `client/src/api/creditStatements.js`, `client/src/lib/creditStatementFormat.js`.
- `client/src/admin/pages/super/OxsteedCreditCustomerDetail.jsx`.
- `server/locales/statement-copy.json`, `server/assets/fonts/`, and each of the
  five client `credit.json` locale catalogs.
- Existing integration candidates: `server/utils/storage.js`,
  `server/services/{notificationService,auditService,auditLoggerService,paymentQueue}.js`,
  `server/jobs/oxsteedCreditNotificationOutbox.js`, and
  `server/services/supportEmailOutbox.js`. Verify suitability and authoritative
  financial services in current source; do not assume one queue fits every job.

## Non-negotiable invariants

1. No balance, payment, fee, refund, payout, dispute decision or eligibility change
   may be initiated merely by generating, correcting or downloading a statement.
   Financial changes remain in existing approved services.
2. Preserve product, tenant, restaurant, legal entity, account and currency scope.
   Never combine currencies, customer stored value and merchant earnings.
3. Use integer minor-unit arithmetic with the actual currency precision; reconcile
   opening + posted credits - posted debits = closing and every running balance.
   Do not use floating-point accounting or relabel a failed reconciliation as zero.
4. Preserve authoritative timestamps and ordering. Restaurant ledger `created_at`
   is intentional: migration 347 defaulted historical `posted_at` values. Do not
   move historical activity into that migration's month.
5. Holds are not charges. Current holds must not masquerade as historical month-end
   holds or reduce the posted closing balance. Show unavailable historical hold
   data honestly unless it can be reconstructed from authoritative history.
6. Issued originals are append-only evidence. Corrections, translations and
   re-renders must not overwrite them. SHA-256 is a checksum, not a digital
   signature, banking license, tax certificate or deposit-insurance claim.
7. Every read/download/action checks current record-level authorization on the
   server. A document ID, object key, related-record link or business membership
   alone never grants access. Keep existing MFA/session/revocation enforcement.
8. Do not place personal identifiers in public URLs/object names or document
   filenames. No public buckets, permanent public links, credentials in logs,
   browser bundles, source, email or chat. Use runtime secret configuration.
9. No destructive or financial tests against production. Use synthetic fixtures
   in the repository's disposable isolated test environment only.

## 1. Automatic monthly issuance

Implement a durable scheduler that discovers all policy-eligible accounts for a
closed UTC month in bounded, resumable batches. Include eligible zero-activity
accounts with carryover balances; define handling of new, closed, suspended,
deactivated and multi-currency accounts. Suspended access must not erase required
financial history. Never create pre-account periods or silently backfill history.

- Define the activation month, eligibility policy and closing grace period with
  the owner. Record actual cutoff, accounting/schema version and issue time.
  Reconcile late/backdated postings through item 3, never a silent rewrite.
- Persist runs, account-period jobs, attempts, leases, fencing tokens and unique
  issuance keys. Two schedulers or workers must not issue two originals.
- Use durable transactional events/outbox when domain records and downstream
  work must be committed together. Redis may transport jobs; do not make its
  cache/TTL the only surviving evidence of financial issuance.
- Separate accounting snapshot, artifact generation and notification states.
  Resume safely after crashes without resnapshotting a completed original.
- Add catch-up discovery for missed runs, bounded retries/backoff, dead-letter
  handling, graceful shutdown, pause/resume and per-account failure isolation.
- Emit localized in-app "statement ready" notifications only when the approved
  artifact is available. Email should contain a generic authenticated link,
  not balances, transaction data, bearer tokens or PDF attachments by default.
  Reuse preferences and verified delivery destinations; keep required-notice
  policy separate from marketing consent. Record failures and avoid duplicates.

Acceptance: month/year boundaries and leap years; account creation/closure; empty
months; multiple currencies; repeated/catch-up runs; concurrent workers; restart
after each stage; late posting; unavailable storage; notification retries; no
duplicate originals or silent missing-account skips.

## 2. Statement archive and private original artifacts

Provide a paginated archive with product/account/currency/year/month filters,
original and amended versions, issue date, readiness and download status. Support
direct routes, refresh/back navigation, empty/loading/retry states, and discovery
from credit pages and relevant dashboards. Never fetch every user's statements.

- Store original PDF bytes in approved private Cloudflare R2 storage using an
  appropriate statement-only namespace/bucket and least-privilege configuration.
  Do not make statements public through the upload utility's public URL path or
  place customer documents in the existing backup bucket without approval.
- Record artifact ID, statement/revision, language, renderer/template/font version,
  checksum, byte length, media type and opaque object key. Stream authenticated
  downloads, or issue short-lived scoped signed URLs only after authorization.
  Reauthorize each new download; document the limited lifetime of signed URLs.
- Original means byte-for-byte stable retrieval. A newly translated or regenerated
  artifact is a separate labeled rendition; preserve the issued original and its
  accounting identity. For pre-archive snapshots, label the later artifact as
  generated from an existing snapshot, not a historically stored original PDF.
- Use a recoverable publication workflow: DB snapshot -> staging/upload -> verify
  object size/checksum -> ready -> notification. A network timeout with uncertain
  upload outcome must reconcile object metadata before safe retry. Never expose
  an incomplete object or mark it ready merely because upload was attempted.
- Handle object missing/corrupt, interrupted downloads, account access changes,
  provider outage and unpublished orphan objects without overwriting evidence.
- Obtain approved retention/erasure/legal-hold policy. Do not invent a universal
  retention period or weaken migration 682's trigger for easy deletion. Cleanup
  must distinguish expendable temporary objects from retained issued originals.
- Back up/restore both DB manifests and private artifacts, verify checksums after
  restore, and demonstrate recovery with synthetic data. Do not assume R2 itself
  or a local DB backup is sufficient protection against deletion or corruption.

Acceptance: cross-owner/restaurant/business isolation; tampered IDs/keys; expired
links; reauthentication and access removal; repeated download identical bytes;
original vs translated rendition; upload uncertainty; missing/corrupt objects;
legal-hold protection; interrupted download; isolated restore consistency.

## 3. Corrections and amendments

Build an explicit reviewed amendment workflow linked to the original statement.
Separate clerical/presentation corrections from changes to accounting results.

- Capture reason, evidence references, initiator, independent approver, timestamps,
  original hash, source correction references, and new revision/hash/artifact.
  Reuse existing maker-checker and step-up approval patterns where applicable;
  prevent self-approval and stale approval after the proposal changes.
- Correct ledger facts only through authoritative compensating transactions and
  their existing approvals. The statement service cannot fabricate adjustments,
  alter posting dates, modify journals or initiate money movement.
- Define whether a correction belongs in a later posted period or requires a
  restated presentation. Show original, adjustment and revised totals where
  appropriate. Disclose posting/effective dates and prevent double counting.
  Preserve continuity with subsequent statements; never silently change another
  issued month's opening balance. Block unresolved continuity/reconciliation.
- Each amendment is a new immutable version. Keep originals downloadable and
  clearly mark superseded/corrected versions, approver-approved reason, issue time
  and links between versions. Notify the owner after publication, once.
- Handle rejected/cancelled proposals, concurrent proposals, duplicate approvals,
  changed source data, backdated corrections, and archive/storage failure after
  approval. A regeneration with unchanged facts is not an accounting amendment.

Acceptance: independent approval required; original update/delete still blocked;
concurrent amendments yield an ordered valid chain; exact balances/continuity;
fees/refunds/reversals are not duplicated; original and corrected files accessible
with correct permissions; rejected proposals do not publish; retries remain safe.

## 4. Transaction investigation, receipts and support

Add authorized transaction drilldowns from statement entries to existing details,
receipts, orders/payments and dispute/support flows. Preserve explicit relationships
and immutable journal-entry identity; a transaction can have multiple entries.
Do not infer relationships from a name, amount or translated description.

- Snapshot the public facts needed to understand the transaction: posting date,
  type, amount/currency, merchant/payee label when authorized, masked reference,
  fees/refund references and status. Linked current status is separate from the
  historical statement facts. Handle deleted/unavailable related records.
- Provide "I don't recognize this" and "Report an issue" paths that attach the
  statement ID/revision, transaction/entry, account and period to existing cases.
  Preserve applicable eligibility/deadline rules; do not invent a universal time
  limit or reject legitimate clarification requests through a new restriction.
- Prevent duplicate cases on retries, identify an existing relevant case, and
  provide case status and follow-up. Filing a case must not auto-refund, charge,
  lift a hold, change the journal or automatically decide the dispute.
- Minimize PII in case evidence and operator views. Deep links still enforce
  authorization, including after business membership or role changes.

Acceptance: purchase/refund/transfer/fee/reversal details; multiple entries for one
transaction; missing receipt; unauthorized related record; duplicate case retry;
existing case; statement remains unchanged while live case/payment status changes.

## 5. Admin statement operations and audit

Create a registered admin/super-admin statement-operations workspace using current
navigation, grant and permission conventions. Do not grant every employee broad
financial access. Target six million users / 3,500 worldwide employees as a design
scenario, not proof the current MacBook can support that scale.

- Show expected vs issued account-period counts, oldest queue age, active runs,
  stale leases, generation/storage/reconciliation/notification failures, missing
  artifacts, amendments awaiting review, and regional/product/currency filters.
  Counts need definitions and source timestamps, not misleading green cards.
- Use bounded server pagination/search with role/tenant/region scope. Show a clear
  owner, reason, correlation ID, attempts, next retry and recommended next action.
  Restrict document contents and personal data to explicitly permitted viewers.
- Provide safe retry/replay, reconcile missing artifacts, pause/resume automation,
  catch-up requests and reviewed amendment actions. These controls cannot delete
  issued evidence, bypass reconciliation or replay financial captures/payouts.
- Add statement-specific append-only audit events for issuance, access/download
  authorization, artifact publication, notification, failures, retries, proposals,
  approvals/rejections and retention actions. Record actor, action, target,
  UTC time, outcome, reason/correlation; never log document bodies or signed links.
  Distinguish authorized/download-started from delivery actually confirmed.
- Expose an appropriately minimized user statement activity/history view and a
  separately authorized admin audit view. Reuse existing audit tooling/integrity
  services; no unrelated parallel audit system.
- Add alert thresholds for failed runs, missing monthly coverage, reconciliation,
  corrupted artifacts, worker/lease failures, aged queue and repeated delivery
  failures. Include safe operational context, not customer financial contents.
- All writes are protected POST/PATCH actions with validation, CSRF protection
  where applicable, idempotency and approval/step-up where warranted.

Acceptance: viewer/operator/approver/super-admin and denied roles; scope changes;
expired session/MFA/revocation; self-approval rejected; concurrent retries;
nonfinancial replay; audit integrity; accurate queue/coverage counts; alerts;
worker shutdown; no PII leak through lists, downloads, logs or error responses.

## 6. Complete high-volume background exports

Replace the 5,000-entry synchronous ceiling with a complete asynchronous path;
retain bounded synchronous behavior for smaller reports. Never truncate a monthly
statement or tell the customer to use shorter periods as the only solution.

- Add idempotent job request/status/cancel/retry APIs with current authorization,
  progress, error/recovery states and completion notification. Small requests may
  return immediately; large jobs return an accepted job identity, not partial data.
- Freeze consistent source data before long rendering. Use a bounded immutable
  snapshot/manifest and chunk model or another justified approach that guarantees
  one source cutoff. Multiple independent read snapshots per page are insufficient.
  Avoid a multi-hour transaction that harms production vacuum/pool availability.
- Use stable composite keyset cursors with timestamp/sequence/entry ID and correct
  legacy/null ordering. Prove no duplicate/missing rows under concurrent postings.
  Reconcile chunk boundaries, counts and final totals against the frozen source.
- Stream CSV and render PDF in bounded workers; write private artifacts rather
  than retaining entire large reports in API memory. If exceptionally large PDFs
  require numbered volumes, provide a complete manifest with clear boundaries,
  counts, checksums and balances; never call one partial volume the whole statement.
- Add shared scheduling limits across API replicas/workers, per-account fairness,
  resource budgets, disk checks, leases/fencing and crash recovery. An in-process
  semaphore alone is insufficient after horizontal scaling.
- Version API/document contracts additively. Existing complete-document validators
  must not accept a paginated partial response as a complete original. Preserve
  existing snapshots/endpoints or provide explicit compatible migration behavior.
- On retry, use the same frozen source. A newer report is a distinct job/version.
  Reauthorize access/cancellation; cancelling rendering cannot delete an already
  issued original. Observe worker/runtime/provider limits instead of disabling them.

Acceptance: 0, 1, 5,000, 5,001, 100,000 and representative 1,000,000-entry synthetic
accounts; multiple currencies/negative balances; concurrent postings and replicas;
every crash checkpoint; expired leases; cancellation; provider outage/disk pressure;
complete counts/totals; bounded memory/DB connections; no ordinary API starvation.
Record hardware, concurrency, latency, memory, queue throughput and limitations.
Define and approve a deployment capacity target; do not claim six-million-user
readiness from a small local test or remove safeguards to hit a throughput number.

## 7. Accessible PDFs and complete inclusive interfaces

Produce tagged PDFs with document language/title, heading hierarchy, meaningful
table/header associations, artifact tags for decorative/repeated elements, logical
reading order and accessible links. Keep screen-reader text and searchable text
accurate for mixed Arabic/Latin references, amounts and dates.

- Evaluate the current PDF library's tagged-PDF capabilities; use a maintained
  renderer/toolchain if required. Visual appearance and extracted text alone do
  not prove accessibility. Do not claim PDF/UA conformance without verification.
- Preserve embedded licensed fonts, Unicode shaping, selectable text, adequate
  contrast, large/negative/zero-precision/three-decimal currency values, long
  references/descriptions, repeated headings and page/volume labels.
- Support English, Spanish, French, Haitian Creole and Arabic across documents,
  notifications, errors, admin controls and metadata. OxSteed remains the brand.
  Use stable identifiers, not translated labels, for product/transaction mapping.
- Keep accessible HTML statements as an equivalent option; CSV alone is not a
  substitute for semantic HTML. Test keyboard/focus/ARIA, browser zoom, mobile,
  RTL, light/dark themes and reduced motion on all new workflows.
- Establish a truthful unsupported-script path. Expand fonts when appropriate;
  never silently replace a name with empty boxes, corrupt an amount or pretend a
  failed PDF succeeded. Offer the complete accessible HTML/CSV recovery path.

Acceptance: automated tag/structure checks plus manual screen-reader reading of
multi-page statements and tables; five languages including RTL; correct transaction
reading order; keyboard links; zoom/reflow; visual inspection of all representative
pages; no overlap, missing glyphs, clipping, lost rows or incorrect number signs.
Reference: https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF3.html

## 8. Business, restaurant and helper settlement statements

Extend the same issuance/archive/correction/accessibility framework through explicit
product adapters. First inventory existing financial/settlement records and define
their journal/status meaning. Do not rebuild their ledgers or use customer-wallet
balances to represent money owed to a merchant/helper.

- Restaurant statements: distinguish restaurant-specific customer credit liability,
  OxSteed partner settlements, order proceeds and actual payouts. Link authorized
  orders/receipts, fees, refunds, reversals, reserves, settlement and payout IDs.
- Helper earnings: opening payable, posted earnings, adjustments, platform fees,
  refunds/reversals and settled payouts, with pending/available/reserved amounts
  explicitly separate. Link jobs/bookings and payout references under current rules.
- Business statements: entity/currency-scoped receivables/payables, approved fees,
  settlements, reserves and verified payout outcomes according to existing books.
  Do not mix a business owner's personal credit, business accounts and team earnings.
- Provider account connection or payout initiation is not proof of payout success.
  Respect authoritative verified outcomes, including pending, failed, retried and
  reversed payouts. Do not describe unpaid earnings as money received.
- Define exact reconciliation equations for each adapter and document inclusion,
  cutoff, date and refund treatment. If an existing source cannot support a reliable
  statement, implement its approved additive linkage/reconciliation prerequisites;
  do not fabricate records or mark the adapter complete while totals are guessed.
- Add owner/finance-member and helper self-service archive entry points. Ordinary
  employees, kitchen staff and former business members must not inherit finance
  access. Define parent/franchise/cross-entity consolidation permissions explicitly.
- Preserve existing pricing, payout thresholds, permissions, launch gates and
  approval services. No automatic charge, payout, tax filing or new subscription.
  Statements are not tax forms, payroll records or proof of employment status.

Acceptance: customer vs merchant separation; multiple restaurants/businesses;
helper vs team roles; removed members; multiple currencies; payout pending/failure/
retry/reversal; reserves and releases; partial refunds and fees; overlapping
settlements; zero-activity carryover; exact reconciliation; identical archive,
amendment, audit, recovery and accessibility safeguards for every adapter.

## Data contracts and proposed interfaces

Design additive, versioned records for issuance runs/jobs, source snapshot manifests
and chunks, immutable statement revisions, artifact renditions/publication attempts,
notification deliveries, amendments/approvals, and links to support cases. Store
account/product/entity/currency/period/cutoff, schema version, entry count/totals,
data and artifact checksums, lifecycle state, lease/fencing and correlation IDs.

Use database constraints to enforce unique originals, ordered revisions, scope and
referential integrity. Do not repurpose applied migration 682. Choose migration
numbers after inspecting current repository history. Operational job state may
change; issued financial content must remain immutable.

Proposed contracts, not permission to bypass existing routers:

- Owner-scoped archive listing and immutable revision retrieval/download.
- Authorized asynchronous export creation/status/cancellation/retry.
- Authorized transaction/receipt and existing support/dispute linkage.
- Admin run/coverage/failure views and nonfinancial safe replay.
- Reviewed amendment proposal/approval/rejection/publication.
- Explicit adapter-specific merchant/helper/business archive endpoints.

Document request/response/status/error and idempotency semantics. Use bounded
pagination, complete export manifests, stable error codes and private/no-store
responses. Never depend on client-supplied owner/tenant IDs for authorization.

## Policies requiring explicit owner/compliance decisions

Before enabling production automation, obtain decisions for eligible account types,
inactive/closed accounts, cycle/grace/late-posting rules, initial/backfill scope,
delivery preferences/mandatory notices, original languages and translations,
retention/erasure/legal holds, amendment authority, regional data handling,
business finance access and rollout capacity. Record decisions and unresolved gates.

Qualified counsel must assess actual product classification and applicable
statement, delivery and error-resolution duties in operating jurisdictions. Do
not assume these stored-value products are bank deposits or universally subject
to one rule. Relevant reference, not a determination of applicability:
https://www.consumerfinance.gov/rules-policy/regulations/1005/9/

## Suggested implementation sequence

1. Verify baseline source/deployment; inventory domain records; obtain/document
   policies; define adapters and capacity/access contracts.
2. Add durable jobs, consistent snapshot/chunking and artifact publication needed
   by both automatic issuance and large exports (items 1, 2, 6).
3. Add archive UI, notifications, operations/audit and transaction/support links
   (items 2, 4, 5); integrate tagged-PDF work from the start (item 7).
4. Add reviewed immutable amendments and continuity checks (item 3).
5. Implement and validate all restaurant/helper/business adapters (item 8).
6. Complete all acceptance tests, policy approvals, isolated restore/load tests
   and staged deployment/live read checks. Do not omit later items after phase 1.

## Required verification and release evidence

Keep an eight-item requirements matrix mapping each requirement to code, migration,
test, observed result and next action. Run real PostgreSQL integration/concurrency
tests, controller/service tests, and actual authenticated browser flows using
seeded synthetic customer, helper, business owner/member, restricted staff,
finance operator/approver, ordinary admin and super-admin accounts.

Cover authorization tampering; expired sessions/revoked grants; publication and
notification failures; replay/crash/fencing; corrupted artifacts; reconciliation;
late corrections and continuity; large exports; restore; all locales/themes/mobile/
RTL/accessibility. Inspect SQL plans, indexes, connection/disk/memory budgets and
load effects. Mock-provider tests alone do not prove R2 or delivery configuration.

Run current repository CI, including from `client/`:

```
npm run test:credit-statements
node --test scripts/creditStatements.browser-check.cjs
npm run verify:i18n
npm run typecheck
npm run build:ci
```

From `server/`, retain existing relevant suites and add the new suites:

```
npm test -- --testPathPatterns='(oxsteedCredit|foodWallet|creditStatement|adminAuthSecurity)'
```

Use `npm run verify:credit-statements` only with its exact disposable local
`credit_statement_test` database and applied migrations. Follow
`scripts/credit-isolated-env.sh` / `docker-compose.credit-test.yml` for other
synthetic financial tests. Never point rehearsal/load/mutation probes at production.

Deployment requires approved additive migrations rehearsed on production-like
synthetic PostgreSQL, a tested backup/restore, locked dependencies/fonts, migration
compatibility with existing snapshots, and controlled worker activation. Confirm
actual Git SHA/migration state, `/ready`, worker leases, queue age, R2 publication
and authenticated authorized/denied downloads. Use canary accounts for read-only
smoke tests; do not create real charges, disputes or payouts merely to test.

Demonstrate end to end for each adapter:

closed period -> reconcile/freeze -> issue -> publish original -> notify -> owner
archive/download -> authorized receipt/support -> independently approved amendment
-> new immutable artifact -> operations/audit -> retry/recovery and isolated restore.

Provide an operational pause that stops new issuance/notifications without
deleting queued jobs or issued evidence. Explain safe rollback/forward repair,
artifact recovery, outage handling and amendment review. Do not run destructive
down-migrations against issued financial records.

## Deliverables to Emile

- Reviewed commits/PR with all eight workstreams complete, preserving unrelated work.
- Additive migration and deployment/configuration instructions, with real secrets
  entered only through the approved secret store and no credential values in docs.
- Updated requirements matrix and `docs/credit-statements.md`; architecture and
  endpoint contracts; owner-approved policy record and remaining external gates.
- Operator runbook covering month-end coverage, alerts, safe retries, amendments,
  outages, access changes, retention/legal hold, original recovery and restore.
- Test, browser, PDF-accessibility, load and restore evidence; real deployed SHA
  and live R2/authenticated-download checks. State unperformed checks plainly.
- Completion report distinguishing source complete, locally verified, deployed,
  live verified and policy-approved. No blanket production-ready claim while a
  critical permission, accounting, immutability, completeness or recovery check fails.

End of developer handoff. Implement all items 1-8; do not merely restyle the PDFs.
