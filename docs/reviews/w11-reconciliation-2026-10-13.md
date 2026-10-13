# W11 reconciliation checkpoint

Prepared against continuation 8240592e; implementation starts from fresh
default `c790370a` after PR567 merged with green CI. Audit v2 is a historical snapshot (1071a91d),
not current closure evidence. Full finding details are in reviews-source.md.

| IDs | Current source evidence | Required next action/evidence |
|---|---|---|
| P1-154 / P1-360 | supportController.submitSupportRequest accepts dispute category without agreement/job gate. Audit v2 partial line289 remains contradicted. | Server agreement-first gate across support/dispute entry points, party validation and bypass/error tests; reachable client remediation. |
| P1-345 | Learn submission and shared publication worker have no new/pending-stale admin emitter. | New and overdue review notifications with persisted idempotency, five locales and scheduled execution tests. Preserve 24h publication policy. |
| P1-346 | normalizeSubmittedVideoUrl canonicalizes new YouTube/Vimeo URLs. Duplicate SQL compares raw stored URLs, and lookup errors are caught as empty. | Test historical variants, canonical provider identity, concurrency, and lookup errors; cannot claim complete from normalizer alone. |
| P1-347 | getGuideVideos excludes any community video with an open flag. | Prove public hide, dismiss restoration, deleted video behavior, authorization and concurrent flag/moderation behavior. |
| P1-348 | APIs return has_more using limit+1, no offset/cursor; video/flag UI ignores has_more. | Real pagination through older rows, totals/cursors, client controls, >200-item regressions. |
| P1-349 | decideVideoFlag deletes video; submit duplicate lookup covers only pending/live/pinned. No tombstone. | Durable provider-identity moderation tombstone, reject resubmission and concurrency/legacy URL tests. |
| P1-350 | Worker catch references logger.error but learnController never imports logger. | Real rollback/error-path test, import logger, continue following submissions and preserve failed row for retry. |
| P1-351 | Shared scheduledWorkerSchedule contains expireVortexTokens once; workerMain imports shared schedule. Existing reviewW5Ops topology test checks unique names. | Re-run runtime topology regression on fresh W11 base and cite evidence. |
| P1-361 | Owner-scoped reopenMyTicket and route exist; SupportTicketDetailPage has no reopen caller. | Reachable localized reopen control, retained history, terminal-only transition, audit and participant/guest tests. |
| P1-362 | workAgreementController sends warranty_claim_filed/updated with stable keys to other party. | Verify actual localized title/body/email templates, both actors, rollback/no-notice and idempotency. |
| P1-363 | under_review is accepted but UPDATE predicate only permits status=filed. | Complete filed -> under_review -> resolved/denied path, concurrent/terminal guards, UI reachability. |
| P1-364 | supportSlaMonitor monitors conversations only, not support_tickets. | Ticket SLA/escalation/nudge with scheduled task, idempotent notifications, no terminal-ticket alerts. |
| P1-365 | Admin reply email at supportController:919 still says reply to this email; no ticket ingestion. | Give a real ticket conversation link and accurate localized instructions; do not invent inbound mail processing. |
| P1-366 | Transition matrix exists, but current state SELECT and UPDATE are separate; reopen not audited. | Atomic state gate, explicit audited reopen path and invalid/concurrent transition tests. |
| P2-453 / P2-454 | W10.5 schema/controller DB checks pass; PR567 merged green as c790370a. | Dropped after run38385368298 passed and PR567 merged; real DB schema/writer evidence is in W10.5 ledger. |
| P2-455 | suspendUser sets is_active=false; auth checks active before clearing expired is_suspended; expiry worker clears suspension only. | Timed administrative suspension lifts safely without reactivating separately banned/deleted/inactive users; login/API/worker tests. |
| P2-456 | restrictUser writes users.is_restricted only, no user_restrictions; auth does not read flag. | Connect restrict/reactivate to authoritative enforcement records and assert protected requests fail. |
| P2-457 | authenticate reads is_suspended globally; auth/support exemptions remain. | Test complete perimeter including login, messaging, booking, checkout, topups and approved appeal/remediation exceptions; resolve actual remaining holes. |
| P2-458 | updateSetting/updateFeatureFlag apply immediately; audit alone does not require second admin. | Route money-sensitive writes through existing maker/checker requests, distinct checker and execution-time validation; no bypass. |
| P2-459 | resolveAdminDispute/issueAdminProvisionalCredit call direct transaction services, no pending-action queue. | Two distinct admins for discretionary credit compensation/provisional credit, including execution caps, replay, freeze and direct-route bypass tests. Never change P3-1009. |
| P2-460 | flagBusiness writes admin_review_reason/reviewed_at; no observed review queue/decision consumers. | Reachable durable review triage and decision, lifecycle and auditing tests. |
| P2-461 | W10.5 actual auditAdminRead SQL succeeds on migrated DB. | Prove authorized purpose-bound controller reads write audit; failed audit must not expose protected data. |
| P2-462 | Agent cancellation schedules bookingDepositService.settleTerminalBookingSoon after cancellation. | Verify real refund/void/recovery and durable pending state, grants, idempotency and payment failures against synthetic deposit data. |
| P2-463 | Checkout checks mounted on selected payment/food routes; all is matched there, no global all guard. checkRestrictions returns immediately in NODE_ENV=test. | Full checkout/all route coverage, fail-closed lookups, meaningful production-path tests without skipping guards. |
| P2-464 | Business updates commit before standalone logAdminAction; audit service swallows unless client/throwOnError. | Transactional mutation + audit, failure rollback, not success or misleading post-commit error. |
| P2-465 | suspendUser disconnects sockets, does not revoke JWT/session. | Align with force-logout access/session revocation; fail-closed state/audit and immediate token tests. |
| P2-466 | oxsteed_credit is routed to restaurant-wallet reversal; this is not the credit rail, guests still excluded. | Correct source-rail reversal for customer/guest, partial/full caps, locks, idempotency and audit failures. |
| P2-483 | Checklist calls some onboarding endpoints; many legacy endpoints remain without callers. Audit v2 line335 marks 5 used/7 unused. | Reconcile every endpoint with actual UI/native contracts, complete useful steps and retire unsupported contracts clearly without fabricating backend-only UI completion. |
| P2-484 | submitIdVerification now read-only and returns verified/remediation state. | Add approved-resubmission regression proving no identity downgrade/write, with legacy/Didit cases. |
| P2-485 | startJob now emits job_started with stable key to other party. | Verify actual notification locale/template, eligibility, failed/duplicate transition and post-commit delivery. |
| P2-486 | w9 flags only read for display/legacy onboarding payloads; no payment/tier gate. | Reachable tax-information step and required gate before affected earning/payment access; preserve account/rail policies. |
| P2-487 | Helpers directory still COALESCE(hp.is_listed,TRUE) at multiple discovery endpoints. | Fail-closed default across all public directory/profile variants, missing/null profile and explicit listed/unlisted tests. |
| P2-488 | Banner ready requires connected, charges_enabled, payouts_enabled; CTA still unconditional success toast after refresh. | Browser state tests for payout-disabled and refresh failures, no premature ready message; five locales. |

Existing baseline checks on this source: learnGuideVideos, helperOnboardingRedesign,
reviewW5Ops: 3 suites/66 tests passed. These are narrow existing tests, not proof
of complete W11 closure. The unimported logger and pagination/claim-finalization
paths are examples of untested gaps despite that green baseline.

W11 implementation is in progress. Base and open PR checks confirmed 792 free
(no other open PRs, tip migration791). Migration792 adds ticket transition events.
The complete 33-ID wave remains the delivery scope; partial commits are progress,
not closure. P3-1009 and the two-distinct-admin invariants remain unchanged.

## Implementation checkpoint: support, warranty and job-start notices

These findings have local behavior evidence, pending the complete W11 PR and
exact-head remote CI. They are not a declaration that W11 or the goal is complete.

| ID | Implemented/verified behavior | Local evidence |
|---|---|---|
| P1-350 | Imported the worker logger; failed publication rolls back, stays pending and does not stop the next submission. | `learnGuideVideos.test.js` injected playlist failure, rollback/log and next-row publication. |
| P1-351 | Existing shared worker topology retains one Vortex token-expiry entry. | `reviewW5Ops.test.js` re-run against fresh c790370a. |
| P1-361 | Signed-in ticket owners have a localized Reopen control; only resolved/closed tickets reopen, history remains. Guests and other accounts cannot reopen. | `w11SupportLifecycle.db.test.js`; real production migrations 046/600/792 in an isolated PostgreSQL schema; actual component browser test. |
| P1-362 | Both parties' warranty filing/decision emits a stable claim-based key to the other participant. Added real five-language title/body templates and missing email allow-list entries, respecting email preferences. | `w11WarrantyLifecycle.db.test.js`; `notificationServiceCredit.test.js` executes actual delivery service and checks legacy/namespaced parity, email copy and Arabic RTL. |
| P1-363 | Filed claims can enter under_review and then resolve/deny. Repeated/concurrent terminal decisions cannot overwrite the result or emit another notice. Filer self-denial and nonparticipants remain forbidden. | Real PostgreSQL claim transitions, rejection and concurrency in `w11WarrantyLifecycle.db.test.js`; keyboard browser review -> resolve. |
| P1-365 | Signed-in ticket reply/resolution emails point to the existing conversation. Guest ticket emails link to public Support and include the ticket number, without promising access to an account-owned ticket. Instructions accurately state that email replies are not monitored. Message content is escaped. | `w11SupportEmail.test.js`, both ownership modes in all five languages, actual links and Arabic direction. |
| P1-366 | Ticket status comparison, timestamps and new transition event commit atomically; admin events require a transactional admin audit. Invalid transitions, audit failures and concurrent reopens fail without partial writes. | `w11SupportLifecycle.db.test.js`; actual PostgreSQL production SQL exposed and fixed varchar/text parameter inference; audit outage rolls back status and event. |
| P2-485 | Job-start notice has actual localized copy and email delivery. State and appointment commit before notice; execution rechecks current participant membership. | `w11JobStarted.db.test.js`: owner/helper, invalid states, outsider, missing assignment, appointment rollback and reassignment between precheck/execution. Actual localized delivery tests. |

Checkpoint validation (2026-10-13): 11 focused server suites / 254 tests passed,
including guest denial, guest email destinations and disabled email preferences.
`client/npm run build:ci` passed with 776 emitted assets.
`w11SupportWarranty.browser-check.cjs` passed using the actual components and
synthetic API/auth boundaries: 320/390/768/1360/1600px, light/dark, English/French/
Arabic, RTL overflow checks, 44px new controls, visible keyboard focus, Enter/
Space activation and failed reopen -> retry. An Arabic 320px screenshot was
visually inspected. This does not claim a human screen-reader pass or live-server
verification. Expected injected failure logs are not failing assertions.

Migration792 is additive/idempotent and was executed twice in the isolated
schema. No applied migration was rewritten. The required full-chain rehearsal
and full-server CI remain required before the W11 delivery PR.

All other W11 rows above remain open: complaint barrier, Learn canonical identity/
moderation/pagination/staleness, ticket SLA, enforcement, maker/checker, business
triage, purpose-bound reads, deposit/refund behavior, onboarding, directory
visibility and Stripe refresh feedback. No W12 implementation starts before W11
is complete and merged. No W11 PR was opened for this partial checkpoint.
