# Review-wave closure audit — 2026-10-13

This is a current evidence ledger, not a declaration that the historical fixes
completed every wave. Base: `830ecfe2` (PR #566). Continuation branch:
`fix/review-w10_5-post-merge`. The W10.5–W19 goal remains active. W10.5 follow-up: PR #567 merged as `c790370a` after exact-head green CI.
W11 implementation is in progress on the continuation branch from that fresh base.
The support/warranty/job-start checkpoint has finding-specific local evidence in
`w11-reconciliation-2026-10-13.md`; the remaining W11 IDs and W12-W19 are still open.

The historical v2 audit and remaining-waves handoff define scope. Existing
progress notes, merged PRs, and aggregate green CI do not substitute for a
finding-specific behavior check. W11 is next after the W10.5 follow-up is green
and merged. W12–W19 require their own reconciliation before execution.

## Invariants

- P3-1009 is excluded; no changes to that finding.
- Money actions require two distinct administrators; no bypass or override.
- Preserve unrelated work and production data; use explicit disposable DBs.
- No deployment wait. Report remote CI and deployment separately.

## W10.5 revalidation

| Requirement | Current evidence | Closure state |
|---|---|---|
| Processor-owned payout-method verification; unverified methods cannot pay | `webhookW105Lifecycle.test.js`: capability promotion/demotion and unlinked account; `payoutMethodVerification.test.js`: pending verification, disabled/inactive refusal, owner-bound joins, no self-verify. Capability and ownership gates tightened in the follow-up. PostgreSQL planning checks also found and corrected an invalid nullable-side lock and a nonexistent payout-owner column; the owner now comes from its affiliate program, and the method/capability are re-read under locks. | Focused behavior/DB checks passed; exact-head remote CI green; PR567 merged |
| Migration 785 and all five audit writers | `w105AuditWriters.db.test.js` executes the actual five source SQL statements on migrated PostgreSQL and reapplies migration 785 twice. It exposed the remaining `admin_id` NOT NULL failure; food-order writers now populate both administrator columns. | Focused behavior/DB checks passed; exact-head remote CI green; PR567 merged |
| Settlement execution gates, reference validation, distinct checker | `w105SettlementApproval.test.js` queues while enabled then changes rail/freeze/readability after checker entry; actual execution must reject without marking paid. Also covers distinct checker and invalid/missing references. Existing governance suite remains required. | Focused behavior/DB checks passed; exact-head remote CI green; PR567 merged |
| Immediate session access-token revocation | `adminSelfSessionRevocation.test.js` uses the real revocation service: target-only hash denylist, missing-hash user-wide fallback, current/foreign-session refusal, storage-failure rollback. | Focused behavior/DB checks passed; exact-head remote CI green; PR567 merged |
| Dispute/subscription/failed-food-card notifications with idempotent keys and five locales | `disputeMessageNotifications.test.js`, `webhookW105Lifecycle.test.js`, and real service tests in `notificationServiceCredit.test.js`. Previously missing title/body templates and dispute-message emitter now supplied; subscription actions use the existing `/settings` route rather than the nonexistent `/settings/billing`. All five legacy/namespaced catalogs match; Arabic email has RTL direction. | Focused behavior/DB checks passed; exact-head remote CI green; PR567 merged |

Behavior requiring owner awareness: revoking a legacy session without a stored
access identifier revokes existing access tokens for that user through the
established all-user path. The fallback is necessary to avoid claiming immediate
revocation while leaving the legacy access JWT usable. Fresh sign-in remains
possible. Processor events can verify only methods belonging to the registered
Connect owner; disabled Connect capability blocks payout execution even if an
older method row still says verified.

No migration number claimed by this follow-up. Migration 785 is already on the
base and is not rewritten. No backend APIs or deployment settings added.

## W11 scope reconciliation checkpoint

P2-453/P2-454 were pulled forward into W10.5, but the PostgreSQL failure above
contradicted the earlier closure claim. PR567 passed and merged; these two schema findings are dropped from W11.
The separate credit-rail refund finding P2-466 remains in scope. Every other ID remains in scope until
code and focused regression evidence prove closure. Audit v2 is historical and
must be matched by behavior when it has no explicit ID row.

| ID | Handoff finding | Current closure status |
|---|---|---|
| P1-154 | Complaint barrier unenforced (merged into Top 10 #10). | Unproven; implementation and regression audit pending |
| P1-345 | No staleness alerting on the pending queue | Unproven; implementation and regression audit pending |
| P1-346 | URL-string dedupe, not video-ID dedupe | Unproven; implementation and regression audit pending |
| P1-347 | Flags have no interim effect | Unproven; implementation and regression audit pending |
| P1-348 | Admin queues truncate silently at 200 rows (adminListVideoSubmissions :1313, adminListVideoFlags :1560, newest | Local real-DB 205-row cursor checks and actual-page browser checks passed; full W11 and remote CI pending |
| P1-349 | Resubmission loop after flag-delete | Unproven; implementation and regression audit pending |
| P1-350 | Per-submission worker failures are silent (rollback with no log line in publishDueGuideVideos); | Local finding-specific checks passed; full W11 and remote CI pending (see W11 reconciliation) |
| P1-351 | Duplicate schedule entry | Local finding-specific checks passed; full W11 and remote CI pending (see W11 reconciliation) |
| P1-360 | Complaint barrier is client-only and bypassable (merged into Top 10 #10). | Unproven; implementation and regression audit pending |
| P1-361 | Promised ticket reopen does not exist. | Local finding-specific checks passed; full W11 and remote CI pending (see W11 reconciliation) |
| P1-362 | Warranty claim filed with no notice to the counterparty (fileWarrantyClaim :467-487, resolveWarrantyClaim :507 | Local finding-specific checks passed; full W11 and remote CI pending (see W11 reconciliation) |
| P1-363 | Claim status under_review is unreachable (merged with agreements-area finding) | Local finding-specific checks passed; full W11 and remote CI pending (see W11 reconciliation) |
| P1-364 | support_tickets have no SLA or stale handling | Unproven; implementation and regression audit pending |
| P1-365 | "Reply to this email" is a dead end | Local finding-specific checks passed; full W11 and remote CI pending (see W11 reconciliation) |
| P1-366 | updateStatus allows any->any transitions (:679-690) with no guard or reopen audit (e.g. | Local finding-specific checks passed; full W11 and remote CI pending (see W11 reconciliation) |
| P2-453 | Closed by W10.5 / PR #505 (audit-log columns). | Closed by PR567 after real PostgreSQL checks and green CI |
| P2-454 | Closed by W10.5 / PR #505 (audit-log columns and refund path). | Closed by PR567 after real PostgreSQL checks and green CI |
| P2-455 | Timed user suspensions never auto-lift (Top 10 #5). | Unproven; implementation and regression audit pending |
| P2-456 | The super-admin "Restrict" action is a dead flag | Unproven; implementation and regression audit pending |
| P2-457 | Enforcement-system "full account lock" enforced on exactly 2 routes | Unproven; implementation and regression audit pending |
| P2-458 | Settings change-request maker-checker is bypassable | Unproven; implementation and regression audit pending |
| P2-459 | Credit dispute provisional credit and resolution compensation bypass maker-checker | Unproven; implementation and regression audit pending |
| P2-460 | "Flag business for review" is a dead end | Unproven; implementation and regression audit pending |
| P2-461 | Purpose-bound read audit for admin food orders never records | Unproven; implementation and regression audit pending |
| P2-462 | Agent booking cancel requires issue_refunds but moves no money | Unproven; implementation and regression audit pending |
| P2-463 | Restriction types checkout and all are dead | Unproven; implementation and regression audit pending |
| P2-464 | Business moderation audit failures are swallowed | Contradicted: moderation mutates before a standalone audit that swallows failures; needs transactional rollback tests and fix |
| P2-465 | suspendUser only disconnects sockets; | Unproven; implementation and regression audit pending |
| P2-466 | Admin food-order refund 400s for oxsteed_credit payment_mode (adminFoodOrdersController.js:125-166) — pass-1 g | Unproven; implementation and regression audit pending |
| P2-483 | 13 dead onboarding endpoints (merged with onboarding-area M1) | Unproven; implementation and regression audit pending |
| P2-484 | Re-submitting ID verification silently revokes an approved verification | Unproven; implementation and regression audit pending |
| P2-485 | No job_started notification | Local finding-specific checks passed; full W11 and remote CI pending (see W11 reconciliation) |
| P2-486 | W9 completion gates nothing | Unproven; implementation and regression audit pending |
| P2-487 | Directory fail-open on listing toggle | Unproven; implementation and regression audit pending |
| P2-488 | Connect banner "ready" ignores payouts_enabled | Unproven; implementation and regression audit pending |

## Verification record

- Base repair PR #566 merged. Default CI run `38380360436` completed successfully
  on `830ecfe2`; this verifies the baseline, not this follow-up.
- Notification/session/dispute regression batch: 7 suites, 96 tests passed.
- Client `npm run build:ci`: passed; 776 emitted assets verified.
- Initial new schema test failed on a real NOT NULL constraint. That failure is
  retained as evidence of why the audit writer correction is necessary.
- `node --test client/scripts/*.test.mjs`: 470 tests passed.
- `node --test client/scripts/adminOperations.browser-check.cjs`: passed.
- Settlement, payout, existing governance, webhook and PostgreSQL guard batch:
  9 suites, 168 tests passed before the additional payout SQL planning checks.
- Final focused batch: 15 suites, 229 tests passed.
- Real migrated-DB controller/schema follow-up: 6 tests passed, including
  processor-backed promotion/completion and disabled/inactive refusal with
  synthetic Connect accounts and mocked Stripe transfers.
- Complete local server Jest finished: 556 suites passed, two failed, five skipped;
  6,030 tests passed and two failed. The unchanged million-row export hit its
  PostgreSQL statement timeout locally, and an amendment fixture lacked its
  generated document UUID. No export threshold or test was relaxed.
- Isolated amendment rerun: all 16 tests passed. This does not erase the full-run
  failure or establish its cause.
- The required migration rehearsal exposed harness defects: it invoked the
  entire chain once per file, did not bind a disposable container to a host port,
  required unavailable host `psql`, and treated zero enabled guards as present.
  The harness now runs bounded baseline/catch-up phases and checksum replay,
  uses PostGIS on a random loopback port and the installed PostgreSQL driver,
  and fails for disabled/missing guards or unexpected states. Default production
  migration behavior and all applied SQL remain unchanged.
- `node --test scripts/migration-rehearsal.test.cjs`: 11 tests passed; server
  `migrationRecovery.test.js`: five passed, including boundary validation.
- `REHEARSAL_DATABASE_URL=<synthetic disposable target> NODE_ENV=test node
  scripts/migration-rehearsal.cjs --from 785`: passed all 793 migrations in 63.7s
  on a newly created isolated database. Phase 1 applied 786 files preceding 785;
  phase 2 applied seven remaining files; replay and all eight guard checks passed.
  CI now exercises this command and its regression suite.
- Exact-head remote CI run `38385368298` passed on `8240592e`, including
  Server and Client Verification, PostgreSQL migration rehearsal (48s), Media
  harness, and CodeQL. Canonical server run: 559 suites/6,053 tests passed;
  separate million-row suite passed with 1,000,000 rows in 98,390ms on Linux x64.
  Active-status regression also passed. Local failures above remain recorded.
- PR567 merged at 10:55:42 UTC as `c790370a`; continuation fast-forwarded to it.
  No deployment check or wait was performed.
- W11 complete-ID reconciliation is recorded in
  `w11-reconciliation-2026-10-13.md`. Its 33 active findings remain open until
  per-finding regressions and the full-wave CI/merge prove closure.
