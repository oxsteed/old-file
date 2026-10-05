# Credit statements

## Product and accounting contract

Bank-style presentation of existing restricted stored-value credit records. This
is **not** a bank deposit account, a new payment ledger, proof of regulatory
approval, or a deposit-insurance claim. OxSteed Credit, each restaurant wallet,
restaurant settlements, helper earnings, business statements, and each currency
remain separate. Existing payment, refund, approval, eligibility, and
account-authority services are unchanged. Generating, correcting, or downloading
a statement never initiates any balance, payment, fee, refund, payout, dispute
decision, or eligibility change.

- `/oxsteed-credit/statements` and `/restaurant-credit/statements` provide account
  selection, UTC period selection, posted activity, balances, and PDF/CSV downloads.
- Opening balance plus posted credits minus posted debits must equal the closing
  balance. Every running balance is checked using integer minor-unit arithmetic
  before any export is allowed. Zero-activity periods retain the previous balance.
- OxSteed Credit uses posted journal timestamps and includes original reversed
  transactions alongside their compensating entries. Restaurant Credit uses the
  original ledger `created_at`: migration 347 assigned a default `posted_at` to
  historical rows, which must not move old activity into the migration month.
- Stable sequence/ID ordering breaks timestamp ties. Historical records that
  cannot reconcile fail closed; this feature does not rewrite old evidence.
- Current pending holds are a separately labeled, current-as-of section in interim
  reports only. They are not completed charges or historical period-end holds and
  never reduce the posted closing balance.
- The SHA-256 checksum verifies canonical statement data, **not** a cryptographic
  signature of the PDF or proof of authenticity for an outside bank.

## Automatic monthly issuance

A scheduler discovers all policy-eligible accounts for the latest closed UTC
month in bounded, resumable batches. Nothing issues until 72 hours after the
month closes, so late postings settle first. Eligible zero-activity accounts are
included with carryover; new, closed, suspended, and deactivated accounts and
multi-currency accounts follow the documented eligibility policy
(`server/services/statementIssuancePolicy.js`).

Each account-period becomes a durable job (migration 683: runs, account jobs,
attempts, leases, fencing tokens, deterministic issuance keys, transactional
outbox). The five fenced stages are: freeze snapshot, render PDF, publish
artifact, insert the immutable document row plus a `statement.ready` outbox event
in one transaction, mark complete. Two workers can never issue two originals:
claims are atomic (`SELECT FOR UPDATE SKIP LOCKED`), fencing tokens invalidate
stale workers, and the document insert is unique per
(customer, product, account, currency, period).

Crash recovery is automatic. A job whose worker dies is reclaimed once its lease
expires, including jobs stranded mid-pipeline; every stage is idempotent, so a
re-drive never duplicates snapshots, artifacts, documents, or notifications.
Jobs that exhaust their attempt budget move to `dead_letter` for operator
review. The `statement.ready` outbox is drained on every scheduler cycle, so
notifications never stall behind the issuance calendar. Customers get a localized
in-app "statement ready" notification only after the artifact is verified; email
carries a generic authenticated link (no balances, no attachments).

## Statement archive and private artifacts

`/restaurant-credit/statements/archive` and `/oxsteed-credit/statements/archive`
list issued statements with product/account/currency/year/month filters,
original and amended versions, issue dates, and readiness/download status.
Settlement statements have their own self-service archive at
`/api/settlement-statements` (owner/finance-member/helper self-service;
ordinary staff get nothing).

Original PDF bytes live in private Cloudflare R2 under a statement-only
namespace (never a public URL path, never the backup bucket). Each artifact
records its statement/revision, language, renderer/template/font versions,
SHA-256, byte length, media type, and an opaque object key. Downloads are
authenticated byte streams or short-lived scoped signed URLs; every download is
re-authorized. Repeat downloads are byte-identical; translations and re-renders
are separate labeled renditions, never replacements.

Publication is recoverable: database snapshot, staging upload, size/checksum
verification, ready, then notify. Uncertain uploads are reconciled against object
metadata before any retry. Missing or corrupt objects fail closed and are
quarantined, never served.

## Corrections and amendments

Corrections follow an explicit reviewed workflow linked to the original
(migration 686: proposals; 687: immutable versions). An operator proposes with a
reason and evidence refs, distinguishing clerical/presentation corrections from
accounting-result changes. A **different** admin approves or rejects
(maker-checker; self-approval is rejected with 403 even for super-admins).

Ledger facts change only through authoritative compensating transactions with
their existing approvals; the statement service never fabricates adjustments.
On approval the system validates continuity, re-derives the document, publishes
an `amended-vN` artifact, inserts the new immutable version, marks the original
superseded (with reason, approver, time, and links), and notifies the owner once.
If a later issued month already exists whose opening would break, the amendment
is blocked as unresolved continuity unless published `restated_forward` with
disclosure; the later month's row is never edited. Rejected proposals never
publish. Publication failures after approval retry idempotently: exactly one
version row per proposal.

## Transaction investigation and support

Statement entries drill down to existing details, receipts, orders, payments,
and dispute flows. Relationships resolve only through explicit stored
references; nothing is inferred from name, amount, or description. Each drilldown
shows snapshot facts (labeled historical), live status (labeled current), and
related records; deleted records show as unavailable.

"I don't recognize this" / "Report an issue" attaches the statement ID,
revision, entry, account, and period to the existing case system, with
idempotency keys so retries never duplicate cases. Filing a case moves no money
and makes no dispute decision. Restaurant wallet ledger entries have no case
API today, so they get read-only drilldown and an honest notice directing the
customer to support instead of an invented case flow.

## Admin operations and audit

`/admin/super/statement-operations` (grants: `view_financials` to see,
`manage_operations` for pause/resume/retry/reconcile, `manage_financials` for
amendment approve/reject) shows expected vs issued counts, oldest queue age,
active runs, stale leases, generation/storage/reconciliation/notification
failures, missing artifacts, amendments awaiting review, and product/currency
filters. Every count carries its definition and source timestamp.

Safe controls: pause/resume runs, retry failed or dead-lettered jobs (never
touches issued evidence), read-only artifact reconciliation, catch-up discovery.
These controls cannot delete evidence, bypass reconciliation, or replay
financial captures/payouts. All statement activity is recorded as append-only
audit events (issuance, access/download auth, publication, notification,
failures, retries, proposals, approvals/rejections, retention) with
actor/action/target/UTC time/outcome/reason/correlation; document bodies and
signed links are never logged. Alert thresholds cover failed runs, missing
coverage, reconciliation failures, corrupt artifacts, stale leases, aged queues,
and delivery backlogs. See `docs/statement-operations-runbook.md` for the
operator procedures.

## Accessible documents

PDFs are tagged: document language and title, heading hierarchy, one logical
table with repeated header rows, list structures, artifact-marked decorative
content, logical reading order, and real link annotations. Mixed Arabic/Latin
content extracts correctly; unsupported scripts fail loudly with a named error
and an HTML/CSV recovery path instead of corrupting glyphs. No PDF/UA
conformance is claimed. An accessible HTML statement (semantic table, caption,
RTL, dark mode, reduced motion, print styles) is offered as an equivalent
option alongside PDF and CSV, in all five languages.

## Settlement statements

Restaurant settlement, helper earnings, and business statements extend the same
framework through explicit product adapters
(`server/services/settlementStatementService.js`). The table-by-table inventory
and journal/status meanings are documented in
`docs/statement-settlement-inventory.md`.

- **Restaurant settlement**: sub-bank journal reconciliation
  (opening + credits - debits = closing, verified per row); partner
  settlements, reserves, and funding requirements are informational and kept
  out of the equation. Payouts are labeled verified / in_transit / failed /
  never_executed from authoritative outcomes only: provider connection or
  payout initiation is never presented as proof of payout success. Order
  proceeds that go direct-to-Connect are shown with no OxSteed payout record.
  Customer-wallet balances never enter merchant statements.
- **Helper earnings**: opening payable, posted earnings, adjustments, platform
  fees, refunds/reversals, settled payouts; pending/available/reserved are
  explicitly separate; unpaid earnings are never described as received. Every
  document states it is not a tax form, payroll record, or proof of employment.
- **Business**: per (business, currency) receivables and payables, approved
  fees, settlements, reserves, verified payout outcomes, per-restaurant payout
  sections. No cross-entity consolidation.

Settlement documents live in their own append-only archive (migration 688), so
customer stored value and merchant/helper/business money stay structurally
separate. The same issuance, archive, amendment, audit, recovery, and
accessibility safeguards apply per adapter.

## API and access

Customer APIs (the authenticated account is the only permitted owner):

- `GET /api/oxsteed-credit/documents[.pdf|.csv]`
- `GET /api/food/customer/wallets/:restaurantId/statements[.pdf|.csv]`
- `GET /api/statement-archive/archive` (filters: product, accountId, currency, year, month)
- `GET /api/statement-archive/archive/:documentId/download` (byte stream)
- `GET /api/statement-archive/archive/:documentId/link` (short-lived signed URL)
- `GET /api/statements/:documentId/entries` and `/entries/:entryId` (drilldown)
- `POST /api/statements/:documentId/entries/:entryId/cases` (report an issue)
- `GET /api/statements/documents/:documentId/renditions/:language/pdf|html`
- `GET /api/settlement-statements/...` (self-service settlement archive)

Query fields: `from`, `to`, `currencyCode`, `language` (en/es/fr/ht/ar). Owner/account
IDs in the query/body are ignored. Existing customer authentication, role/identity
rules, and export rate limits apply. Responses use private/no-store, no-cache and
nosniff. Only approved public document fields are rendered: no card credentials,
fraud notes, internal actor metadata, or full account identifiers.

Admin APIs (existing active-session, role, grant, and MFA enforcement):

- `GET /api/admin/statements/ops/runs`, `/ops/runs/:id`, `/ops/failures`, `/ops/alerts`, `/audit`
- `POST /api/admin/statements/ops/runs/:id/pause|resume`, `/ops/jobs/:id/retry`, `/ops/artifacts/reconcile`
- `GET|POST /api/admin/statements/ops/amendments`, `/ops/amendments/:id/approve|reject|retry-publish`
- `POST /api/statement-issuance/runs`, `/runs/:id/pause|resume|catch-up`, `GET /runs/:id/stats`

These routes do not grant ordinary admins access to another customer's financial
documents. A pre-existing defect in the grant-lookup query (UNION with an
expression ORDER BY, rejected by PostgreSQL) once turned every non-super-admin
permission check into a 500; it is fixed and covered by
`server/__tests__/adminGrantLookup.test.js`.

## Operational bounds and recovery

- On-demand sync ceiling remains 5,000 rows; the async export path (frozen
  snapshot/chunk model, migration 684) serves larger reports without
  truncating and never tells customers to use shorter periods as the only
  solution.
- All database reads use one repeatable-read snapshot, a 15-second query timeout,
  and the existing export concurrency budget.
- PDF work runs in a separate thread, not the API event loop: 60-second wall-clock
  deadline, 32 MiB result limit, termination on disconnect/error/completion.
- Dedicated private Cloudflare R2 configuration must be present or artifact
  publication fails closed; no statement is marked issued without a verified
  artifact. Bundled OFL-licensed Noto fonts cover the five supported languages.
- CSV neutralizes spreadsheet formula triggers, including those behind hidden
  direction marks or whitespace, and preserves minor-unit precision.
- An integrity failure requires investigation of the authoritative journal and
  its existing reconciliation tooling. Do not edit snapshots, bypass the check,
  or approve a hand-calculated balance. Support should record the product,
  currency, period, statement ID, and error code, not ask for passwords or card PINs.

## Verification and release checklist

The older green-suite counts below are historical, not a current release
approval. The subsequent code review found thirteen outstanding defects; see
`statement-operations-code-review-2026-10-05.md`. Remediation requires a new
full-suite run with the DB opt-ins enabled, a fresh complete migration
rehearsal, and browser checks. Do not infer production readiness from the
earlier counts or the presence of routes/components.

Verification performed on 2026-10-05 against disposable `credit_statement_test`
databases (synthetic fixtures only; no production data):

- Full server suite green (398 suites, 4416 tests, 0 failures at last full run),
  including: durable job infrastructure (leases, fencing, reclaim, dead-letter),
  snapshot/chunk model, artifact publication, automatic issuance (month/year
  boundaries, leap years, open/close, empty months, multi-currency, repeated
  and catch-up runs, concurrent workers, restart after each stage, late posting,
  unavailable storage, notification retries, duplicate suppression), archive
  (isolation, tampered IDs, expired links, byte-identical downloads,
  original-vs-rendition, missing/corrupt objects), amendments (maker-checker,
  ordered chains, continuity, no double counting, safe retries), investigation
  (explicit-FK drilldown, case dedupe, no money movement), admin operations
  (role matrix, audit integrity, alert thresholds), accessibility (tag
  structure, 5 languages incl. RTL, extraction fidelity), and settlement
  adapters (22 tests: separation, roles, payout honesty, reconciliation).
- Client `build:ci` green (typecheck, i18n verification, admin route
  contracts, production build).
- Migrations 682-689 applied cleanly in sequence on disposable databases.

Production deployment remains a separate gate: install the locked dependency
tree, deploy client/server/fonts together, apply migrations, set
the private R2 runtime configuration below, confirm `/ready` and the
deployed revision, and perform an authenticated real-account read/download
smoke test for each product. Known production issues outside this build's
scope: the restaurant payout path is not atomic (Stripe Transfer before journal
post) and has no webhook reconciliation; migration 689 unblocks the
`sub_bank_payout` journal leg, but payouts must not be activated for real money
without the atomicity redesign. This local verification does not certify
deployment, production data reconciliation, regulatory readiness, or
global-scale load capacity.

## Private Cloudflare R2 statement storage

Statements use `server/utils/statementStorage.js`, not the general uploads
adapter. There is no local-filesystem fallback, public URL, shared uploads
bucket, or backup-bucket fallback. Required runtime-only settings are:

- `STATEMENT_ARTIFACT_BUCKET`: a separate private statement bucket.
- `STATEMENT_R2_ENDPOINT`: the Cloudflare R2 S3 endpoint (region is `auto`).
- `STATEMENT_R2_ACCESS_KEY_ID` and `STATEMENT_R2_SECRET_ACCESS_KEY`: credentials
  scoped to that bucket, entered directly into the runtime secret store.
- `STATEMENT_R2_PRIVACY_ATTESTED=1`: set only after an operator confirms that
  r2.dev/public custom domains are disabled and reviews token/bucket access.
  This is an operator gate; the S3 API does not prove those public settings.
- `STATEMENT_ARTIFACT_PREFIX`: defaults to `statements`.
- `STATEMENT_LEGACY_PREFIXES`: comma-separated previous local prefixes to block
  in generic storage routes. Reserved `/stmt/` keys are always blocked there.

Legacy artifacts with an unknown storage bucket are intentionally unavailable
until their location and exact bytes are verified in an authorized recovery.
Do not edit ready artifact metadata to make a download pass. Preserve original
bytes, hashes and attempt evidence; recovery is not permission to reissue an
original from mutable source data. Missing/corrupt ready objects fail closed.

Privacy, lifecycle retention, restoration from backup, production throughput,
and actual account downloads still require live operational verification.
No live R2 credentials or bucket configuration were changed by this code fix.
