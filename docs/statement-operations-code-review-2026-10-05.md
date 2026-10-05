# Statement operations developer review

Reviewed on 2026-10-05 for Emile Jean Philippe.

## Verdict

Do not accept the eight-workstream statement handoff as complete yet. Substantial
implementation exists, but this review found 13 actionable defects or acceptance
gaps, including six P1 findings affecting confidentiality, reliable publication,
financial history, high-volume completion, and currency accuracy.

This is a code review and synthetic verification report, not a production
certification. No financial operation, production configuration, customer record,
or existing issued statement was changed. No fixes were implemented or pushed.

## Scope and revision

- Repository: `oxsteed/old-file`, branch `old-files-claude`.
- Reviewed commit: `c0eb264a68a44a0a9ec425dc114e5e8a0cae7624`.
- Baseline: `c6e373e3b52e360d2c57b3cc52255065eeaa468d`.
- Reviewed the 21 intervening commits against
  `docs/statement-operations-developer-handoff-2026-10-05.md`.
- GitHub was checked again at the end of verification and still pointed to the
  reviewed commit. The main checkout also then pointed to that commit.
- Source and tests were exercised in an isolated Git archive copy at
  `/tmp/oxsteed-statements-review.ffyCyt`, not by modifying application code in
  the user's working tree. The review probe is outside the repository.
- This does not repeat the earlier audit of all admin tabs or certify unrelated
  card, payout, delivery, video, or business features.

## Findings, ordered by release risk

### R01 - P1: Private statement storage can fall back to a public local route

Evidence: `server/services/statementArtifactService.js:60`,
`server/utils/storage.js:138`, `server/routes/storage.js:29` and `:77`.

The statement service uses the general upload adapter. `STATEMENT_ARTIFACT_BUCKET`
is checked as a string but is not used to select a separate storage bucket.
With object credentials present, a distinct statement bucket is rejected unless
it matches the general uploads bucket. With credentials absent, the adapter
silently stores statements in local uploads. The unauthenticated `/public/*`
route blocks `delivery-private/`, but not the default `statements/` prefix.

Confirmed synthetic reproduction: publication returned `ready`; GET
`/api/storage/public/<statement-object-key>` without authentication returned HTTP
200, the exact synthetic PDF bytes, and
`Cache-Control: public, max-age=31536000, immutable`.

This proves a confidentiality defect in the supported fallback configuration;
it does not prove that a real customer's document is currently exposed in R2.

Required correction: introduce a genuinely private statement storage adapter and
separate namespace/bucket configuration. Reject unsafe/unconfigured storage;
block every statement path from public serving, including configurable prefixes.
Verify provider privacy and reauthorization through the authenticated download
path. Do not change the existing uploads or backups bucket to work around this.

Acceptance: no-credentials and wrong-bucket fail-closed tests; unauthenticated
known-key access denied; private R2 upload/download integration; unchanged public
uploads; cross-owner denial and expired-link tests.

### R02 - P1: A crashed publication can be marked complete with no ready PDF

Evidence: `server/services/statementArtifactService.js:255`,
`server/services/statementIssuanceService.js:643` and `:674`.

`publishArtifact` returns any existing artifact whose state is not `failed`,
including `staged` and `verifying`, without resuming upload or verification.
`issueAccountStatement` does not require the returned artifact to be `ready`
before advancing the job. A worker crash after the staged-row insert therefore
leaves the next worker with an unusable artifact it treats as successful.

Confirmed against PostgreSQL: retrying a staged artifact made zero storage calls,
returned `staged`, and the full issuance pipeline marked its job `complete` while
the artifact remained `staged`. The notification consumer subsequently refuses
that artifact. Normal job retry cannot repair a job already marked complete.

The check-then-insert publication path also lacks a database uniqueness invariant
for a live original per snapshot/kind/language; object-key uniqueness alone is
not that invariant. This concurrency risk was inspected, not separately raced.

Required correction: recover staged/verifying work under a publication lease or
lock; verify the actual object before success; require ready state at every
publication boundary; enforce the intended publication identity transactionally.

Acceptance: crash after insert, during upload, after upload, during read-back,
before document commit, and before notification; overlapping publishers;
stale-worker fencing; one verified original and recoverable job/outbox state.

### R03 - P1: Business statements lose real payments between months

Evidence: `server/services/settlementStatementService.js:588` and `:617`.

Opening receivables are calculated using today's invoice status and today's
`amount_paid`, rather than the position at the opening boundary. Collections are
then calculated as a balancing plug. The reconciliation check repeats that same
equation, so it cannot detect missing historical payments.

Confirmed reproduction: a $100 invoice issued in August produced an August
closing balance of $100. After recording payment on September 5, September's
statement showed opening $0, collected/adjusted $0, and closing $0. It should
carry the $100 opening position and the $100 September payment.

Required correction: derive period positions and collections from authoritative
dated payment/adjustment evidence. Add source history/reference capabilities
where genuinely missing, using existing approved financial services. Do not
invent a balancing collection or silently rewrite an issued original.

Acceptance: full/partial payment across month boundaries; refunds, cancellations,
late postings, multiple payments, subsequent corrections; previous closing equals
next opening unless an explicitly approved/disclosed amendment explains the break.

### R04 - P1: Helper reversals rewrite the next month's opening position

Evidence: `server/services/settlementStatementService.js:405` and `:429`.

Current payout state determines whether earnings are removed from both opening
and closing balances. Removal is assigned to the job's completion date, not the
actual later reversal/failure date. Mutable present-day state is not a historical
financial event stream.

Confirmed reproduction: August's issued payable closed at $100. Changing the
job to `reversed` before September issuance produced September opening $0 and
September removals $0, so the $100 change had no period movement explaining it.

Required correction: reuse dated payout/refund/reversal evidence and freeze the
period calculation. Distinguish payout transport failure from extinguishing an
amount still owed. Preserve original evidence and provide accounting corrections
through the approved workflow.

Acceptance: earning in one month with payout, failure, retry, cancellation,
partial/full refund or reversal in another; correct amounts still owed; exact
period continuity; no duplicate settlement or money movement from statements.

### R05 - P1: High-volume asynchronous export workstream is not delivered

Evidence: `server/services/creditStatementService.js:132`,
`server/services/statementSnapshotService.js:296` and `:370`,
`server/services/settlementStatementService.js:369` and `:572`.

The background snapshot calls the same complete-document builder that rejects
more than 5,000 rows. It then chunks an already-loaded in-memory document; chunk
metadata does not provide a new complete bounded high-volume source-reading path.
No customer export request/status/cancel/retry workflow replaces this ceiling.

Confirmed reproduction: a business with 5,001 August invoices could not freeze a
September statement, even with zero invoices issued in September. The service
reads lifetime invoices and returned `statement_export_too_large`, advising a
shorter period that cannot solve that lifetime limit.

Required correction: implement workstream 6 as specified: consistent frozen data,
bounded/keyset processing, complete streamed CSV and bounded PDF volumes where
needed, durable request/status/cancel/retry APIs, fairness, and private artifacts.
Do not simply remove limits or truncate monthly statements.

Acceptance: 5,001, 100,000 and representative 1,000,000-entry synthetic accounts;
complete counts/totals; concurrent postings; cancellation/retry; memory, pool,
disk and queue bounds; unchanged small-report behavior.

### R06 - P1: Settlement CSV assumes every currency has two decimal places

Evidence: `server/routes/settlementStatementArchive.js:321`.

The new exporter divides every minor-unit amount by 100 and formats two decimals,
even though the API accepts other three-letter currencies and the existing credit
formatter already handles currency precision. A pure production-serializer
reproduction with JPY amount 100 produced `1.00` rather than `100`.

Required correction: reuse the exact currency-aware minor-unit formatter and
document supported source currency contracts. Avoid floating-point accounting;
validate unsupported/inconsistent source precision instead of guessing.

Acceptance: USD, JPY, three-decimal currency, signed balances, safe large amounts,
and agreement between JSON, PDF, CSV and UI.

### R07 - P2: Business expenses on the final day are omitted

Evidence: `server/services/settlementStatementService.js:626`.

The query compares `expense_date < period.to`, although `to` is inclusive elsewhere.
Confirmed: a 1,234-minor-unit expense dated September 30 produced expense total 0
and count 0 for the September 1-30 statement.

Required correction: use the next-day exclusive boundary consistently.
Acceptance: first and last day, adjacent months, leap day, and relevant time zones.

### R08 - P2: Recovery controls can strand work or silently miss coverage

Evidence: `server/jobs/statementIssuanceScheduler.js:107`, `:150`, `:214`;
`server/routes/statementAdmin.js:345`;
`server/services/statementJobService.js:207` and `:385`;
`server/routes/statementIssuance.js:32` and `:146`.

- Runs are marked complete when all jobs are either complete or dead-letter.
- Admin Retry changes a failed/dead-letter job to pending but does not reopen a
  completed run. Claiming excludes completed runs, so the advertised retry can
  never run. Catch-up can similarly add work to a completed run without reopening it.
- Polling discovers only the latest closed month. An outage that skips a whole
  month has no automatic missing-period discovery. Older outstanding work is not
  independently drained when all current product runs are terminal.
- Resuming a paused discovering run always sets it to running, losing its discovery
  phase. An interrupted discovery can be skipped after resume.
- Manual run creation only permits the original two credit products, not the three
  new settlement products.

Required correction: explicit run/job recovery state machine; persist discovery
phase/cursor; bounded missed-period discovery; independent draining of claimable
work; all-product operator controls; honest coverage alerts tied to eligible
account-period completion rather than merely a completed run record.

Acceptance: outage spanning two months, complete run with dead letters, retry after
storage repair, catch-up on completed run, pause during discovery, all five products.

### R09 - P2: Settlement self-service and accounting corrections remain incomplete

Evidence: `client/src/App.jsx:524`,
`server/services/statementIssuanceService.js:699`,
`server/services/statementAmendmentService.js:84`.

Restaurant-settlement, helper-earnings and business APIs/builders exist, but their
dedicated user-facing archive/download entry points are not connected in the
client. Notifications lead to the dashboard or Business Hub rather than a usable
statement. The accessible-view client still selects only the two credit products.
Accounting amendments are explicitly unsupported for helper and business documents.

Required correction: integrate role-authorized statement entry points, period/
currency selection, original/version downloads, empty/error states and direct
notification destinations. Finish authoritative accounting correction support or
clearly identify a blocked product instead of marking workstream 8 complete.

Acceptance: helper, restaurant owner/authorized finance member, business owner,
removed member and stranger; actual browser journeys and correction history.

### R10 - P2: Restaurant Credit statement investigations stop at a placeholder

Evidence: `server/routes/statementInvestigation.js:380`.

Reporting a restaurant wallet entry returns `statement_case_unsupported` and
"Contact support". The handoff expressly required attaching statement/entry
evidence to the existing case/support workflow, not substituting that message.

Required correction: reuse the existing authorized support/case system for this
product without creating a parallel dispute ledger or initiating financial actions.
Acceptance: duplicate submissions create one case; exact evidence links;
cross-restaurant denial; no balance change; customer-visible case progress.

### R11 - P2: CI skips important DB tests; enabling them reveals invalid fixtures

Evidence: `.github/workflows/ci.yml:101`;
`server/__tests__/statementJobService.test.js:23`;
`statementAdmin.db.test.js:29`, `statementInvestigation.test.js:28`,
`adminGrantLookup.test.js:19`.

CI supplies `STATEMENT_TEST_DATABASE_URL`, but other suites require separate
`STATEMENT_JOB_TEST_DATABASE_URL`, `STATEMENT_INVESTIGATION_TEST_DATABASE_URL`,
and `ADMIN_GRANT_TEST_DATABASE_URL`. They skip their meaningful DB tests without
those settings. A reproduction with CI's configuration ran four suites green
with 4 guard tests passed and 40 actual tests skipped.

With real migrations and explicit opt-ins, eight statement investigation tests
fail before exercising the feature: fixtures insert nonzero balances into new
accounts, violating the empty-ledger invariant. Separately, two admin grant tests
fail because they reference region 7 without creating that region.

These fixture failures do not prove production authorization is broken; they prove
the required behavior is not validated by the claimed green CI.

Required correction: consistent explicit disposable-DB variables, migrated-schema
fixtures using authoritative posting helpers and real foreign keys, and a CI gate
that fails on skipped required suites. Never weaken financial invariants to make
fixtures pass.

### R12 - P2: Archive amendment pagination metadata is inconsistent

Evidence: `server/routes/statementArchive.js:500` and `:534`.

SQL returns `version_total`, but JavaScript destructures `versionTotal`; revision
counts therefore disappear from `total`. The query paginates originals, then adds
all amendment rows to each page, so `perPage`, items, total and page count do not
describe the same collection. The current tests did not catch this contract bug.

Required correction: consistently paginate originals with nested versions, or
paginate a unified original/version set with a stable total and tie-breaker.
Acceptance: many revisions, multiple pages, tied issue timestamps, filters,
forward/back navigation, and no duplicate/missing records.

### R13 - P2: New settlement CSV bypasses the existing formula-injection defense

Evidence: `server/routes/settlementStatementArchive.js:298` and `:380`;
compare `server/services/creditStatementPdf.js:229`.

The new CSV cell function only quotes commas, newlines and quotes. It does not
neutralize spreadsheet formulas in user-controlled client names, job titles or
descriptions. A pure serializer reproduction exported client name `=1+1` unchanged
as a CSV cell. The original credit exporter already defends against formula
triggers, whitespace and direction-control prefixes.

Required correction: reuse the hardened CSV escaping/neutralization contract for
all untrusted text and localize the new CSV headings.
Acceptance: leading `=`, `+`, `-`, `@`, whitespace, tabs, BOM/direction controls,
quotes/newlines, and normal names; opened text must remain text, not a formula.

## Eight-workstream acceptance matrix

| Workstream | Delivered foundation | Why not accepted as complete |
|---|---|---|
| 1. Automatic monthly issuance | Durable jobs, leases, scheduler, notifications | R02, R05, R08; missing-period/recovery/capacity proof |
| 2. Private archive | Archive APIs/UI, manifests, hash-verified publication | R01, R02, R12; live private R2 and restore still unverified |
| 3. Amendments | Maker/checker, immutable versions, referenced corrections, continuity checks | Shared publication R02; helper/business accounting corrections unsupported |
| 4. Investigation | Explicit references, drilldowns, OxSteed Credit case linkage | R10 and R11; restaurant workflow incomplete |
| 5. Admin operations | Runs/failures/amendments/audit/alerts workspace | R08, R11; controls/coverage need end-to-end recovery proof |
| 6. High-volume export | Snapshot/chunk metadata and bounded workers | R05: complete asynchronous export path is absent |
| 7. Accessibility | Tagged PDF and HTML renderers, localized credit UI | Structural tests passed, but new page/browser/assistive-tech acceptance incomplete |
| 8. Settlements/earnings | Three scoped builders, archive API, renderers | R03, R04, R06, R07, R09, R13 |

Passing a foundation test is not an acceptance of every workflow above.

## Verification evidence

- Applied all 686 migration files through migration 691 to an isolated temporary
  PostgreSQL/PostGIS 16 database. Second migration run passed without pending work.
- Statement-focused server run: 19 suites; 18 passed, 1 failed; 324 tests passed,
  8 failed, 6 skipped. The six skips were admin grant tests requiring their own
  opt-in variable, subsequently exercised separately below.
- Admin grant DB run with its explicit opt-in: 5 passed, 2 failed (missing region
  fixture). No inference of a production permissions failure is made from this.
- Full backend suite with the three statement DB variables enabled: 403 total
  suites, 398 passed, 2 failed, 3 skipped; 4,462 tests passed, 11 failed, 52 skipped.
  Eight failures are the investigation fixtures described above. Three video
  failures depend on `/usr/bin/ffmpeg`, absent on this macOS review host; those are
  an environment limitation, not evidence of a regression from these 21 commits.
- `npm run build:ci` passed in the isolated client copy. Its translation verification
  and typecheck passed; emitted-asset verification checked 718 assets.
- All four existing credit-statement browser checks passed, including five locales,
  both themes, mobile/desktop, RTL, keyboard navigation and reduced motion. These
  use mocked API responses and do not cover all new archive/admin/settlement flows.
- Synthetic probes reproduced R01, R02 end-to-end, R03, R04, R05, R07. Pure
  production-serializer probes reproduced R06 and R13. Other findings are code/
  contract inspection, not claimed live-browser reproductions.
- No real customer data, live charges, secrets, or storage credentials were used.

Temporary machine-readable results and probe source remain under
`/tmp/oxsteed-statements-review.ffyCyt` for this session. The test database/container
is disposable and was removed after verification; the source/review files remain.

## Capacity and operational acceptance still required

The worker is configured for five product passes of up to 50 jobs every five
minutes, and 50 ready-notification events per cycle. Even before rendering/query
costs, the nominal single-worker ceilings are 72,000 statement jobs/day and 14,400
ready events/day. These are upper-bound calculations from configuration, not load
test measurements. If six million monthly recipients were eligible, draining
notifications alone at that configuration would take about 417 days. A capacity
claim therefore needs measured worker scaling, fairness, queue-age budgets and
approved close-time targets, not merely green builds.

Also unverified: live private R2 policies, retention/legal-hold behavior, consistent
DB/artifact restore, production worker/notification health, actual approver policy,
screen-reader reading order with representative long multilingual documents, and
the authenticated browser matrix for the newly added experiences.

## Recommended developer order and completion gate

1. Fix R01/R02 before enabling reliance on automatic financial-document delivery.
2. Fix R03/R04/R06/R07 using authoritative evidence and precise currency rules.
3. Implement R05 and correct the R08 lifecycle/recovery model.
4. Complete R09/R10 user workflows and R12/R13 export/archive correctness.
5. Fix R11 fixtures/CI; add explicit reproductions for every finding above.
6. Run all eight acceptance journeys, failure/crash/concurrency tests, new authenticated
   browser checks, private-provider integration, isolated restore and load tests.
7. Update implementation documentation to distinguish verified completion from
   limitations, policy decisions and operational dependencies. Do not describe
   all eight workstreams as finished while these defects remain.

Keep existing issued evidence and financial approvals intact throughout. No review
can guarantee that future defects never occur; these gates provide an evidence-based
acceptance and a maintainable recovery standard.
