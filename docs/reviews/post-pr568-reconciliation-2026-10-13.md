# Post-PR568 reconciliation — 2026-10-13

Current source baseline: `42bbe3ed` (`origin/old-files-claude`), PR567 and PR568
merged. Working branch: `fix/review-w11-work`, created from that fresh base.
The goal is active and incomplete. Earlier W11 checkpoint documents below retain
historical evidence, but their "unimplemented" rows predate the merged bundles.

Original IDs use the immutable source report line (for example P1-345).
Area/F aliases count finding bullets within a part/area; they are not new scope.
The tables map aliases to the original IDs rather than treating duplicate
complaint-barrier rows or differently named bundles as separate completions.
Claims from commit subjects are pointers only, never closure evidence.

## W10.5 safeguards revalidated

Fresh isolated checks on 42bbe3ed: 13 suites / 157 tests passed, including payout
capability/owner verification, settlement execution/reference/distinct-checker
gates, immediate access-token revocation, notification delivery and audit writers
on migrated PostgreSQL. The same batch includes existing W11 ticket, warranty,
job-start, pagination, email and worker-topology regressions. Command:

`STATEMENT_TEST_DATABASE_URL=<disposable credit_statement_test target> npx jest
--runInBand --detectOpenHandles payoutMethodVerification webhookW105Lifecycle
w105SettlementApproval adminSelfSessionRevocation disputeMessageNotifications
w105AuditWriters notificationServiceCredit reviewW5Ops w11LearnPagination
w11SupportLifecycle w11WarrantyLifecycle w11JobStarted w11SupportEmail`

## Complete W11 ID reconciliation

All 33 active IDs are retained, plus the two W10.5 schema overlaps. Candidate
means current implementation exists but finding-specific proof remains required.
No W11 or later wave is declared complete by this checkpoint.

| Original ID | Area alias | Current evidence / next action |
|---|---|---|
| P1-154 | P1-3-F08 | Open: dispute entry improved, but supportController.submitSupportRequest still has no agreement-first gate. |
| P1-345 | P1-16-F02 | Finding checks pass locally: persisted new/overdue jobs, failed-delivery retry, reviewer eligibility/grants, five-locale real delivery; full-wave merge pending. |
| P1-346 | P1-16-F03 | Gap found and fixed in additive migration803: encoded v query key and redundant short-link slash identities differed between SQL and JS. Real DB alias/race tests pass; full-chain rehearsal passed; full-wave CI pending. |
| P1-347 | P1-16-F04 | Finding checks pass locally: actual public playlist SQL hides open flags, restores only after every flag is dismissed; full-wave merge pending. |
| P1-348 | P1-16-F05 | Fresh real DB pagination regression passes; prior actual-page browser evidence retained, rerun due before full-wave delivery. |
| P1-349 | P1-16-F06 | Finding checks pass locally: deletion tombstones survive cascades, aliases cannot resubmit, concurrent delete/submit cannot revive, audit outage rolls back; full-wave merge pending. |
| P1-350 | P1-16-F07 | Fresh publication regression passes: failed row rollback/log and next-row continuation; full-wave merge pending. |
| P1-351 | P1-16-F08 | Fresh reviewW5Ops topology regression passes; full-wave merge pending. |
| P1-360 | P1-17-F01 | Open: same support-entry complaint barrier as P1-154. |
| P1-361 | P1-17-F02 | Fresh real DB ticket lifecycle passes; prior actual-page reopen browser evidence retained; full-wave merge pending. |
| P1-362 | P1-17-F03 | Fresh warranty DB and actual five-locale notification delivery pass; full-wave merge pending. |
| P1-363 | P1-17-F04 | Fresh real DB warranty lifecycle passes; migration794 now includes under_review; prior browser evidence retained; full-wave merge pending. |
| P1-364 | P1-17-F05 | Open: supportSlaMonitor still only queries support_conversations, not support_tickets. |
| P1-365 | P1-17-F06 | Fresh five-locale support email regression passes; full-wave merge pending. |
| P1-366 | P1-17-F07 | Fresh real DB transition/concurrency/audit rollback regression passes; full-wave merge pending. |
| P2-453 | P2-1-F01 | Closed in W10.5/PR567; fresh real DB audit-writer regression passes. |
| P2-454 | P2-1-F02 | Closed schema/writer finding in W10.5/PR567; fresh real DB regression passes. Credit refund rail is separately P2-466. |
| P2-455 | P2-1-F03 | Partial/unsafe: worker now restores is_active for expired direct suspensions, but no provenance distinguishes independently inactive/banned accounts; auth rejects inactive before lazy expiry. Needs DB/login/perimeter proof. |
| P2-456 | P2-1-F04 | Open: restrictUser still writes users.is_restricted; authoritative user_restrictions not written. |
| P2-457 | P2-1-F05 | Partial: HTTP, optionalAuth, chat suspension checks improved; full endpoint/appeal perimeter and production-path proof still required. |
| P2-458 | P2-1-F06 | Open: updateSetting/updateFeatureFlag and rollback routes still mutate directly; audit alone is not maker-checker. |
| P2-459 | P2-1-F07 | Open: resolveAdminDispute/issueAdminProvisionalCredit still call money services directly. Two distinct admins required; never touch P3-1009. |
| P2-460 | P2-1-F08 | Partial: flagged filter/badge exists; no complete audited review/clear decision lifecycle proved. |
| P2-461 | P2-1-F09 | Candidate: auditAdminRead now propagates insert failures; schema is proven. Must prove purpose validation, route authorization, failure prevents protected response. |
| P2-462 | P2-1-F10 | Candidate: terminal deposit settlement exists; prove durable refund/void and failed-payment recovery through authorized agent route. |
| P2-463 | P2-1-F11 | Partial: checkout middleware mounted on more routes; NODE_ENV=test bypass remains and global all/perimeter checks unproven. |
| P2-464 | P2-1-F12 | Open: business mutation commits before standalone audit; 503 after mutation does not roll it back. logAdminAction defaults can still swallow failure. |
| P2-465 | P2-1-F13 | Partial: suspendUser now revokes tokens first; prove real immediate denylist and transactional state/audit failure behavior. |
| P2-466 | P2-1-F14 | Open: admin credit-mode food refund still invokes restaurant-wallet debit reversal and excludes guest owner; source rail/caps/atomic audit required. |
| P2-483 | P2-2-F08 | Candidate: onboarding endpoints retired/wired in merged bundles; reconcile every web/native caller and approved-resubmission behavior. |
| P2-484 | P2-2-F09 | Candidate: approved ID submission is now read-only; prove legacy/Didit no downgrade or write. |
| P2-485 | P2-2-F10 | Fresh real DB job-start and five-locale real delivery regressions pass; full-wave merge pending. |
| P2-486 | P2-2-F11 | Candidate: W9/onboarding gates now mounted on money routes; prove all affected entry points and reachable tax step. |
| P2-487 | P2-2-F12 | Candidate: public directory predicates changed; prove missing/null/unlisted variants and all public profiles. |
| P2-488 | P2-2-F13 | Open: banner checks payouts_enabled but load catches refresh errors and handleClick still shows success unconditionally; browser failure-state proof/fix required. |

## Merged bundle aliases touching W11–W19

These PR568 commit-subject claims map to the source report. Several belong to
later waves; preserve their implementations, then reconcile behavior/tests in
wave order. The historical audit v2 remains the scope reference, not current
closure status. General commit subjects without exact finding aliases are not
represented as proven closures here; inspect their diffs when reconciling.

| Alias claimed in merged commits | Original finding | Commit pointers | Source finding |
|---|---|---|---|
| P1-2-F07 | P1-134 | 7eba4d52, b9ecba06 | Duplicate, disconnected quote systems: |
| P1-2-F11 | P1-138 | 63fc9cc5, 7eba4d52, b9ecba06 | Tier-3 escrow for jobs is unreachable ( |
| P1-3-F07 | P1-153 | 7eba4d52, b9ecba06 | Unilateral versioning stalls activation: |
| P1-3-F08 | P1-154 | 7eba4d52, b9ecba06 | Complaint barrier unenforced (merged into Top 10 #10). |
| P1-3-F13 | P1-159 | 7eba4d52, b9ecba06 | Dead enum values and dead column: |
| P1-3-F14 | P1-160 | 7eba4d52, b9ecba06 | Agreement <-> payment/release unlinked: no references to |
| P1-5-F02 | P1-193 | ed81488f |  |
| P1-5-F03 | P1-194 | ed81488f | Direct ignores helper personal blocks, templates, and buffers entirely (zero references in |
| P1-6-F01 | P1-202 | ed81488f | Vanity-slug profile URLs silently lose pricing, availability, cancellation stats, and the Pay button. |
| P1-6-F03 | P1-204 | ed81488f |  |
| P1-7-F02 | P1-223 | ed81488f | The helper directory hero search has no live autocomplete: typeahead is purely client-side over hardcoded skill til |
| P2-1-F05 | P2-457 | 540baab9 | Enforcement-system "full account lock" enforced on exactly 2 routes: |
| P2-1-F08 | P2-460 | 540baab9 | "Flag business for review" is a dead end: |
| P2-1-F12 | P2-464 | 540baab9 | Business moderation audit failures are swallowed: |
| P2-1-F13 | P2-465 | 540baab9 |  |
| P2-10-F01 | P2-675 | b7c91aa5 | Payment requests open-forever; POP-confirmed requests stay |
| P2-10-F04 | P2-678 | b7c91aa5 | Accepted/approved quotes never expire; |
| P2-10-F09 | P2-683 | decbf161 | A declined |
| P2-10-F10 | P2-684 | decbf161 |  |
| P2-2-F01 | P2-476 | 1c8fe44f | Onboarding pre-completed at OTP; every "required" step skippable to money (Top 10 #6, corroborated). |
| P2-2-F08 | P2-483 | 1c8fe44f | 13 dead onboarding endpoints (merged with onboarding-area M1): |
| P2-2-F11 | P2-486 | 1c8fe44f | W9 completion gates nothing: |
| P2-2-F12 | P2-487 | 1c8fe44f | Directory fail-open on listing toggle: |
| P2-3-F04 | P2-501 | 540baab9 | Business-appointment lifecycle has zero notifications and the controller's |
| P2-3-F12 | P2-509 | 540baab9 | Dead endpoints, latent footguns: |
| P2-3-F13 | P2-510 | 540baab9 | Publish readiness goes stale post-publish: owner can deactivate all services or delete all menu items while staying |
| P2-4-F12 | P2-534 | b7c91aa5 | Agent console refund button invites rejected actions: renders for every non-refunded order ( |
| P2-6-F11 | P2-579 | 63fc9cc5 | Referral rewards are fail-open with no reconciliation: |
| P2-7-F05 | P2-597 | 1c8fe44f | 13 dead onboarding endpoints (merged with helper-dashboard M8; corroborated): tier/W9/terms/finalize/onboarding-* U |
| P2-7-F07 | P2-599 | 1c8fe44f |  |
| P2-7-F11 | P2-603 | 1c8fe44f | Three parallel identity models unreconciled (theme #5): |
| P2-7-F13 | P2-605 | 1c8fe44f |  |
| P2-8-F03 | P2-618 | b7c91aa5 | 12 notification-preference toggles are dead: |
| P2-8-F05 | P2-620 | b7c91aa5 |  |
| P2-9-F04 | P2-655 | b7c91aa5 | Submitted intakes go nowhere observable: zero |
| P2-9-F06 | P2-657 | b7c91aa5 | Assigned maintenance helper cannot discover the assignment: no "assigned to me" listing ( |
| P3-1-F09 | P3-793 | 63fc9cc5 |  |
| P3-1-F15 | P3-799 | 409cc488, 7b00ce33 | Every |
| P3-1-F16 | P3-800 | 409cc488, 7b00ce33 | Instant payouts: no local payout row and no |
| P3-10-F09 | P3-1017 | c2b4c820 | No SLA for identity verifications or sanctions screenings (only compliance cases have |
| P3-10-F10 | P3-1018 | c2b4c820 | Zero user notification across the verification lifecycle: approval, rejection, expiry, sanctions clearance all sile |
| P3-11-F04 | P3-1042 | c2b4c820 | CCPA/opt-out intake is dead: |
| P3-11-F05 | P3-1043 | c2b4c820 | The user data export is materially incomplete: exports only |
| P3-11-F08 | P3-1046 | c2b4c820 | Subscription subscribe/cancel/renewal events have no audit trail: zero writes in |
| P3-11-F16 | P3-1054 | c2b4c820 | No retention sweeps for sessions, OTPs, or notifications: no |
| P3-13-F15 | P3-1106 | d475d64d | Messaging mutation routes with no dedicated limiter: conversation creation ( |
| P3-14-F03 | P3-1126 | 7f4dde2c | No user-facing session management at all: no list/revoke/"log out everywhere" for regular users (only the admin pai |
| P3-14-F07 | P3-1130 | 7f4dde2c | Impersonation sessions are immune to all user-level revocation: denylist skipped for impersonation JWTs; force-logo |
| P3-2-F09 | P3-822 | 409cc488, 7b00ce33 | Disputes re-openable after resolution; openable on any job at any age (the advertised 30-day window unenforced). |
| P3-2-F11 | P3-824 | 409cc488, 7b00ce33 | Server never emits |
| P3-2-F15 | P3-828 | 409cc488, 7b00ce33 | Dead dispute code, some dangerous: unmounted |
| P3-2-F19 | P3-832 | 409cc488, 7b00ce33 |  |
| P3-3-F02 | P3-843 | 55bd9c2f, b99df793 | The nodemailer/SMTP email system is likely unconfigured and silently drops appointment, calendar, food-guest, and c |
| P3-3-F03 | P3-844 | a6cd31e5, 55bd9c2f, b99df793 |  |
| P3-3-F11 | P3-852 | 55bd9c2f, b99df793 |  |
| P3-3-F12 | P3-853 | 55bd9c2f, b99df793 | PII in plaintext logs: recipient email ( |
| P3-3-F14 | P3-855 | 55bd9c2f, b99df793 |  |
| P3-3-F17 | P3-858 | 55bd9c2f, b99df793 | Welcome-email Resend idempotency key |
| P3-3-F18 | P3-859 | 55bd9c2f, b99df793 | Two parallel email systems and two parallel SMS stacks with different guarantee semantics (the SMTP one likely dead |
| P3-3-F19 | P3-860 | a6cd31e5, 55bd9c2f, b99df793 | Raw-HTML reminder emails bypass the branded template and have no text part. |
| P3-4-F07 | P3-875 | d475d64d | Weekly/digest notifications send without idempotency keys ( |
| P3-5-F07 | P3-894 | d475d64d | Telematics adapters have no timestamp freshness check; when |
| P3-5-F08 | P3-895 | d475d64d | Checkr has no envelope and no recency guard: |
| P3-5-F10 | P3-897 | d475d64d | Stripe Identity webhook has no dedupe envelope and no stale guard: an out-of-order |
| P3-6-F03 | P3-914 | decbf161, 7f4dde2c | Orphaned files everywhere; no sweeper; the one cleanup worker is env-gated. Profile/cover/logo replacement never de |
| P3-6-F09 | P3-920 | 7f4dde2c | Inconsistent malware posture: general uploads pass with static EICAR-only scan when ClamAV is unconfigured, while r |
| P3-6-F12 | P3-923 | 7f4dde2c | Support messages accept caller-supplied |
| P3-6-F15 | P3-926 | 7f4dde2c | Retention cleanup deletes DB rows only and misses the active table: |
| P3-7-F06 | P3-945 | d475d64d | Three client |
| P3-8-F02 | P3-963 | a0a3ec97, 85657af5 | The customer booking page 404s for every customer: |
| P3-8-F03 | P3-964 | a0a3ec97, 85657af5 |  |
| P3-8-F04 | P3-965 | a0a3ec97, 85657af5 |  |
| P3-8-F06 | P3-967 | a0a3ec97, 85657af5 | Two cancel paths diverge: hub Cancel buttons use |
| P3-8-F08 | P3-969 | a0a3ec97, 85657af5 | Reschedule bypasses |
| P3-8-F13 | P3-974 | a0a3ec97, 85657af5 |  |
| P3-9-F04 | P3-989 | 63fc9cc5, d475d64d | Recurring-billing |

## New Learn behavior proof and discovered defect

The new w11LearnIntegrity.db.test.js uses real production migrations in a random
schema of the explicitly disposable database and un-mocks the real transaction
wrapper. Mocked transaction helpers are not evidence of PostgreSQL rollback or
concurrency. The notification boundary and audit outage are synthetic; actual
notification service/template/email behavior is verified separately.

Initial identity cases exposed two mismatches in migration793's SQL function:
URLSearchParams accepts `%76` as the `v` query key, and the JS short-link parser
accepts redundant leading slashes. Historical rows using these aliases escaped
pending/live/pinned duplicate lookup and moderation identity matching. Migration
803 replaces the identity function additively, rebuilds expression indexes, and
reapplies the blocked-decision backfill. Applied migration793 is unchanged.
Base had 802 as the latest numbered migration; no open PRs were returned when
803 was claimed. Check collisions again before merge.

Migration803 executes twice in the isolated schema. Fresh Learn regression:
3 suites / 135 tests passed (identity parity, historical pending/live/pinned
aliases, simultaneous alias submissions, approval/publication race, open-flag
visibility/restoration, durable deletion/tombstones, delete/resubmit race,
transactional audit rollback, delivered/retried/overdue jobs, reviewer eligibility
and grants, plus actual five-locale notification/email/RTL copy).

Additional verification on this checkpoint:

- `npm run build:ci` passed: 777 emitted assets verified.
- `node --test scripts/w11LearnPagination.test.mjs
  scripts/w11LearnPagination.browser-check.cjs
  scripts/w11SupportWarranty.browser-check.cjs` passed: three tests. Actual pages
  exercised at 320/390/768/1360/1600px in light/dark with French/Arabic RTL,
  pagination, filters, failed requests/retry, ticket reopen and warranty controls.
- `node --test scripts/migration-rehearsal.test.cjs` passed: 11 tests.
- `DOCKER_CONTEXT=colima NODE_ENV=test node scripts/migration-rehearsal.cjs
  --from 803` passed: all 805 migration files, catch-up, checksum replay and guard
  checks in 94.8 seconds. Container removed. Migration803 was also directly
  executed twice against synthetic blocked aliases in the DB regression.
- Initial local rehearsals failed before applying migration SQL: the image's
  temporary socket-only bootstrap server shut down while migrate.js connected.
  The harness now probes TCP readiness rather than accepting that temporary
  socket server. The readiness-target regression and real rerun passed; no
  applied SQL was rewritten to address the environment failure.
- Default-branch CI38445312289 passed on 42bbe3ed. This verifies the merged base,
  not these new unmerged changes. No deployment check/wait was performed.

Next required delivery checks: complete the remaining W11 behaviors, full-server
verification and exact-head required CI. Finish remaining W11 rows before
opening the complete W11 ready-for-review PR. W12–W19 retain their full original
scope; no later wave implementation begins here. No P3-1009 change, real-money
operation, payout activation or production-data mutation was performed.
