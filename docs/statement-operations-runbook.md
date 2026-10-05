# Statement operations runbook

How to run the monthly statement pipeline: month-end coverage, monitoring,
alerts, safe retries, amendments, outages, and restore. This is the operator
companion to `docs/credit-statements.md`.

## What the system does on its own

Every 5 minutes the worker runs `pollIssuanceCycle`:

1. Computes the latest **closed UTC month**. Nothing is issued for that month
   until **72 hours** after it closes (`ISSUANCE_GRACE_HOURS`), so late postings
   settle first.
2. For each product, discovers all policy-eligible accounts in bounded,
   resumable batches and creates one account-period job per account (including
   zero-activity accounts with carryover). Discovery is idempotent: issuance
   keys are deterministic, so repeated or catch-up runs never duplicate jobs.
3. Workers claim jobs under short leases with fencing tokens. Each job runs
   five fenced stages: freeze snapshot, render PDF, publish artifact,
   insert immutable document + queue `statement.ready`, mark complete.
4. The `statement.ready` outbox is **always** drained, even when the grace
   period has not elapsed: notifications for already-issued statements never
   stall behind the issuance calendar.

Crash recovery is automatic: a job whose worker dies is reclaimed once its
lease expires, including jobs stranded mid-pipeline (`snapshotted`,
`artifact_ready`, `notified`). Every stage is idempotent, so a re-drive never
duplicates snapshots, artifacts, documents, or notifications. Jobs that exhaust
their attempt budget move to `dead_letter` for operator review.

## Where to look

- Admin workspace: `/admin/super/statement-operations` (grants: `view_financials`
  to see, `manage_operations` for pause/resume/retry/reconcile,
  `manage_financials` for amendment approve/reject).
- Tabs: runs, failures, amendments, audit, alerts. Every count carries its
  definition and the timestamp of the data behind it; do not treat a count as
  fresher than its source timestamp.

## Month-end checklist

1. After the grace period elapses (72h past month close), confirm a run exists
   for the closed month and each product, and that discovery reached 100% of
   eligible accounts (runs tab: expected vs discovered).
2. Watch `issued` climb and `failed` stay at zero. A healthy close has
   `failed = 0`, `dead_letter = 0`, no `missing_monthly_coverage` alert.
3. If `failed` is non-zero, open the failures tab: each row shows owner,
   reason, correlation ID, attempts, next retry, and a recommended action.
   Most failures are transient (storage hiccup, lock timeout) and succeed on
   retry. Reconciliation failures are **never** transient: investigate the
   authoritative journal first (see below).
4. Confirm the `statement.ready` outbox is empty (no `repeated_delivery_failures`
   alert), so every issued statement produced its customer notification.

## Alerts

| Code | Severity | Meaning | First response |
|---|---|---|---|
| `run_failed` | critical | A run has failed jobs needing attention | Failures tab, retry or dead-letter review |
| `missing_monthly_coverage` | warning | An eligible account-period has no issued statement | Check discovery; run catch-up (`POST /api/statement-issuance/runs/:id/catch-up`) |
| `reconciliation_failure` | critical | opening + credits - debits != closing, or a running balance broke | **Stop.** Investigate the journal; never bypass, never hand-edit. See below |
| `corrupt_artifact` | critical | Stored object fails checksum/size verification | Artifact reconcile; if the object is truly corrupt, re-publish from the frozen snapshot (the snapshot is the source of truth, not the object) |
| `stale_leases` | warning | >= 1 lease past expiry (default threshold 1) | Normal during worker restarts; another worker reclaims automatically. Investigate only if persistent |
| `aged_queue` | warning | Oldest waiting job older than 6h | Workers may be down or paused; check run state and worker health |
| `repeated_delivery_failures` | warning | Outbox events failed 5+ delivery attempts | Check notification provider; events stay queued, nothing is lost |

## Safe retries (and what never to do)

- `POST /api/admin/statements/ops/jobs/:id/retry` re-queues **only**
  `failed`/`dead_letter` jobs. It never touches issued evidence.
- `POST /api/admin/statements/ops/artifacts/reconcile` re-verifies checksums
  and sizes against the database record. It is read-only: it records the
  attempt and never marks an artifact ready.
- `POST /api/admin/statements/ops/runs/:id/pause` / `resume` pauses and resumes
  a run. Pausing stops claiming; in-flight jobs finish their stage.
- **Never**: delete or edit issued documents or artifacts (the database trigger
  blocks it; do not work around it), bypass reconciliation, replay financial
  captures or payouts from these controls, or re-issue a month to "fix" numbers.
  Corrections go through the amendment workflow.

## Reconciliation failures

1. Note the product, account, currency, period, statement ID, and error code
   from the failure row. Do not ask the customer for anything.
2. Recompute from the authoritative ledger (the journal tables the statement
   product reads), not from the statement snapshot.
3. If the journal itself does not balance, that is a ledger incident, not a
   statement incident: escalate through the existing financial-incident path.
   The statement service must fail closed until the journal is repaired through
   its own approved corrections.
4. If the journal balances but the statement does not, file a bug with the
   issuance key and the frozen snapshot ID. Do not approve a hand-calculated
   balance.

## Amendments

1. An operator proposes: `POST /api/admin/statements/ops/amendments` with
   `reason` (required), evidence refs, and for accounting amendments the
   compensating transaction IDs. Clerical (presentation) vs accounting
   corrections are recorded separately.
2. A **different** admin approves or rejects (`manage_financials` grant).
   Self-approval is rejected with 403, even for super-admins. A proposal that
   changed after review cannot be approved on the old review.
3. On approval the system validates continuity, re-derives the document,
   publishes an `amended-vN` artifact, inserts the new immutable version, marks
   the original superseded (with reason/approver/time/links), and notifies the
   owner once.
4. If a later issued month already exists whose opening would break, the
   amendment is blocked with 409 (unresolved continuity) unless published as
   `restated_forward` with disclosure. The later month's row is never edited.
5. If publication fails after approval, the proposal stays approved-but-
   unpublished: `POST /ops/amendments/:id/retry-publish` retries idempotently
   (exactly one version row per proposal, guaranteed by the proposal id).
6. Rejected proposals never publish anything and stay readable with the reason.

## Outages

- **Object storage (R2) unavailable**: artifact publication fails closed at the
  verify-before-ready step; jobs retry with backoff and eventually dead-letter.
  No statement is marked issued without a verified artifact. When storage
  returns, retry the dead-lettered jobs; uncertain uploads are reconciled
  against object metadata before any retry, so no duplicate or partial objects
  become originals. `STATEMENT_ARTIFACT_BUCKET` must be configured or every
  publication fails (fail-closed by design).
- **Database unavailable**: workers fail their stage and release leases; on
  recovery the reclaim path resumes. The outbox is database-backed, so no
  notification intent is lost (Redis may transport outbox traffic but is never
  the only evidence).
- **Worker crash or deploy during issuance**: leases expire, another worker
  reclaims, stages re-drive idempotently. Verify with the runs tab that every
  job reached `complete` and no job is stuck in an intermediate state past its
  lease.
- **Notification provider down**: `statement.ready` events stay queued and are
  redelivered; customers are notified late, not never. Do not re-issue
  statements to "resend" notifications.

## Backup and restore

- Back up the database (which holds the issuance manifests: runs, jobs,
  snapshots, documents, artifacts, amendment versions, outbox) **and** the
  statement artifact bucket together. Either alone is insufficient.
- After a restore, run artifact reconciliation across all `ready` artifacts:
  every object's size and SHA-256 must match its database record before the
  archive serves it again. Objects that do not match are quarantined, never
  served; re-publish them from their frozen snapshots.
- Rehearse restore on synthetic data in the disposable `credit_statement_test`
  database, never on production. Legal-hold markers must survive a restore;
  verify them explicitly before returning the archive to service.

## Retention, erasure, legal hold

Retention and erasure follow the owner-approved policy (see
`docs/credit-statements.md`). The operations layer enforces three rules on top
of it: issued originals are never deleted through any operations control;
a legal hold blocks retention deletion for the held documents; deleting a
customer must not cascade-delete issued financial documents. If a request
conflicts with these rules, refuse and escalate rather than working around
them.
