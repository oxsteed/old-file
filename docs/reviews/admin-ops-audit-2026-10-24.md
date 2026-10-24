# Admin and operations audit repairs — 2026-10-24

Scope: the 21-item Saturday audit supplied by the owner. Findings were checked against current source. This branch changes software controls; it does not enable Credit, change money thresholds, deploy production, or claim operational acceptance.

| # | Implemented response |
|---|---|
| 1 | Admin and agent food refunds require fresh, single-use TOTP step-up. Above the existing money threshold they enter the maker-checker queue. Food executors use the checker's transaction, recheck order state, and notify after commit. |
| 2 | A bounded scheduled sweeper recovers claimed incidents whose callers never dispatched. Immediate dispatch and the sweeper share a durable lease. Notification counters advance only after an external channel acknowledges a send; failed sends remain retryable. |
| 3 | Grant lookup requires an active, non-deleted admin grantor. Disabling an account revokes its delegations through both the endpoint and a database trigger, so re-enabling cannot restore them. |
| 4 | SOS events now have migration-owned durable storage. Notifications prefer active, authorized on-call staff and fall back deterministically to active support admins/super-admins. Unacknowledged events escalate after five minutes and every fifteen minutes thereafter. Acknowledgment is available in Service Operations → Safety. Missing delivery creates a critical incident. The linked-job lookup uses actual job party columns and checks membership. |
| 5 | Entity/account/period creation, journal posting, and period closing commit with fail-closed transactional admin audit entries. |
| 6 | Correction: this screen approves restaurant top-up **eligibility**, rather than transferring money itself. Approval now requires fresh TOTP step-up, rate limiting, and impersonation rejection. |
| 7 | Fee changes and reset-to-defaults require fresh single-use TOTP step-up, rate limiting, and impersonation rejection. Existing immediate-effect behavior remains; this is the audit's minimum safeguard, not a new two-person pricing policy. |
| 8 | Money approvals return bounded limit/offset/total and the page has a pager with a visible total. |
| 9 | Payouts return a matching filtered total and the page has a pager. |
| 10 | Message-outbox retry requires the operations grant, rate limiting, and impersonation rejection. Both explicit-ID and all-backlog paths claim at most 500 failed rows, excluding active leases. |
| 11 | Accepted gift-card status polling backs off from 15 minutes to four hours. Existing authenticated webhooks remain the immediate status path. Correction: Resend retains email data for 30 days; **idempotency keys** expire after 24 hours. Therefore the seven-day status-recovery tail remains; unconfirmed sends still stop at the existing 23-hour safety boundary. |
| 12 | Completing a deletion request queues actual erasure and returns processing/202. The worker reuses the existing deletion flow in strict error-reporting mode; active jobs, pending payments, stored value, and audit restrictions prevent false completion. Financial records are not forfeited or bypassed. Failures remain pending or need review. Completion emails follow execution, retain the recipient language across erasure, and have a retryable delivery tail. A reviewed, blocked job can be retried through the completion action after its blocker is resolved. |
| 13 | The confirmation explicitly labels acceptance revocation as record-only, and the API returns that enforcement mode. No account lockout or forced privacy reacceptance policy was introduced. |
| 14 | Admin webhook retry enforces the existing eight-attempt budget and requires rate limiting and impersonation rejection. |
| 15 | Logistics refund audit failures now emit structured error logs. |
| 16 | Physical Credit card fulfillment requires a dialog naming the target status and warning that the action cannot be undone there. Errors keep the dialog open. |
| 17 | Bulk user status changes retain failed IDs as selected and report those failures. A partial-failure error takes precedence over the success toast so it cannot be overwritten. |
| 18 | Incident email fan-out honors globally authorized operations admins' and super-admins' incident/email preferences and selected incident types. The existing admin settings page exposes type subscriptions and safety on-call participation. The configured security mailbox/Slack channel remain fallbacks; notification delivery is not human acknowledgment. |
| 19 | Discover digest processing is lease-fenced and bounded to 100 records per batch with rotating last-checked progress. Daytime catch-up ticks start at 09:00 Eastern; each alert is checked at most daily. |
| 20 | Bulk completion skips terminal/awaiting-user records, queues deletion requests, sends completion emails for completed non-deletion requests, and returns skipped/failed IDs and queued counts. |
| 21 | Runbook versions retain complete append-only snapshots. A database trigger records the version and admin audit row atomically. Updates/deletions cannot proceed without their audit evidence. A bounded history endpoint exposes retained versions. |

Provider references: [Resend retention](https://resend.com/security), [send idempotency keys](https://resend.com/changelog/idempotency-keys).

## Verification

- 272 focused server tests passed across 23 suites, including new refund-control, incident delivery, SOS routing/escalation, privacy completion, and treasury audit-failure cases.
- A subsequent 57-test focused pass passed after the final privacy queue/audit and post-commit notification changes.
- Final merge review corrected single-toast precedence on partial bulk failures; the full client check/build was rerun successfully.
- `npm --prefix client run build:ci` passed, including translations, type checking, production build, and verification of 1,076 emitted assets.
- The first fresh disposable PostgreSQL rehearsal passed all 1,003 migrations and a second full runner pass. The final fresh rehearsal also passed 1,003/1,003 migrations, checksum rerun, and guard verification. Real PostgreSQL assertions passed for append-only runbook snapshots, audit rollback, delegation revocation after disable/re-enable, incident counters, step-up purposes, SOS acknowledgment, and the privacy queue language/audit schema.
- `scripts/verify-admin-ops-audit.cjs` accepts only an explicit loopback `oxsteed_rehearsal` database and rolls back its synthetic fixtures.

## Merge verification follow-up

The first broad PR run passed 875 server suites and failed two stale fixtures: the TOTP action list expected 15 instead of 18 purposes, and the isolated analytics users table omitted `is_active`/`deleted_at`. Both fixtures were aligned with the live schema/control contract, with an additional disabled/soft-deleted grantor regression. All 18 tests in those two suites passed against a freshly migrated disposable PostgreSQL database. No runtime authorization check was weakened. The final partial-failure toast correction also passed a fresh complete client `build:ci`. Fresh GitHub CI on the final merge remains a separate result.

## Rollout boundary

Apply migration 99983 before serving this code; new step-up purposes, incident leases, SOS storage, and privacy jobs depend on it. Configure actual on-call coverage and incident subscriptions in admin settings. Run live-provider smoke checks after deployment. No live SOS, real refund, deletion, or notification was generated during local verification. Existing historical deletion requests marked completed are not automatically erased by this repair; those records require a separate verified-subject review.
