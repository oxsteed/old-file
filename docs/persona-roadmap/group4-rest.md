# Group 4 rest: Helper items 176-200 (tracker)

Branch `feat/persona-group4-rest` off `old-files-claude` @ `28196a8a8`.
Source backlog: `/workspace/persona-backlog-1000.md` lines 291-331 (titles only).
Prior Group 4 work (Slices A-D, items 151-175) is merged; see
`persona-roadmap-decisions.md` "Group 4 survey" and Slices A-D.

Persona labels grant nothing: every route resolves the live job assignment /
reviewee / ownership on the server. No payout, price, status or grant changes
unless an item says so.

## Status legend
EXISTS = verified working end to end at `28196a8a8` (evidence cited).
PARTIAL = machinery exists, a leg is missing (gap named).
BUILD = to build in this batch. DONE = built on this branch (commit cited).

## Tracker

| # | Item | Status at 28196a8a8 | Evidence | Gap / plan | Branch status |
|---|---|---|---|---|---|
| 176 | Active assignment board | EXISTS | `server/routes/helperWork.js` `GET /work-board`; `docs/persona-roadmap/helper-work-execution.md` | none | - |
| 177 | Arrival check-in | PARTIAL | `jobController.markJobArrived` (assigned helper only, notifies customer), `JobDetailPage.jsx:483` | no time guard: arrival can be recorded days before the scheduled window. Plan: refuse arrival more than 2h before the scheduled start when one exists (409 `arrival_too_early`) | DONE (jobStartGuard in jobController; tests in pr804TrackDJobArrivalNoShow.db.test.js, which also fixes its broken interval param) |
| 178 | Work checklist | EXISTS | `helperWork.js` work-records + templates (PR 805) | none | - |
| 179 | Progress update | PARTIAL | `helperWorkService.publish` (append-only, idempotent) | customer is never notified. Plan: `helper_progress_update` notification to the job's customer after commit, idempotent per update id | DONE (helperWorkService notices, group4RestWorkNotices.db.test.js) |
| 180 | Completion handover | PARTIAL | work-record handover (PR 805) vs `completeJob` | handover not surfaced at completion. Plan: completion response/notification references the shared handover; customer notified when handover is saved | DONE (helperWorkService notices, group4RestWorkNotices.db.test.js) |
| 181 | Reschedule proposal | PARTIAL | `calendar.js` appointment reschedule-requests (only when the job has an appointment); bookings have their own | jobs hired without an appointment have no reschedule path. Plan: job-level proposal (`job_reschedule_proposals`), proposal-only like D-25 | DONE (migration 20261123170200_job_reschedule_proposals.sql, jobRescheduleService, /jobs/:id/reschedule-proposals, JobRescheduleProposals, group4RestJobReschedule.db.test.js) |
| 182 | No-show report | PARTIAL | `jobController.markJobNoShow` (either party, reason, notifies) | no time guard: either party can mark no-show before the job time. Plan: refuse before scheduled start (409 `no_show_too_early`) | DONE (jobStartGuard in jobController; tests in pr804TrackDJobArrivalNoShow.db.test.js, which also fixes its broken interval param) |
| 183 | Scope change request | PARTIAL | `workAgreements.js` change-orders (+ notifications, Slice C) | agreement-less jobs have no path (open call G4-22) | OPEN CALL G4-22 (not built) |
| 184 | Replacement handoff | PARTIAL | `bids.js` withdraw (pre-hire only); work records separate per helper (PR 805) | assigned helper cannot hand a job back. Plan: helper release request with reason before start; job returns to open, customer notified, payment untouched unless not yet captured (decision) | DONE (migration 20261123170300_job_handbacks.sql, jobHandbackService, POST /jobs/:id/hand-back, JobHandback, group4RestHandback.db.test.js; pre-start only, refused when money or a signed agreement is attached) |
| 185 | Support escalation | PARTIAL | `support_tickets` intake pattern (`consultantPracticeController.createSupportIntake`) | no job-linked helper escalation. Plan: `POST /helpers/me/jobs/:jobId/support` (assignment-checked, idempotent, notifies staff) + list | DONE (helperJobSupportService, HelperJobSupport on JobDetailPage, group4RestJobSupport.db.test.js) |
| 186 | Job earnings summary | PARTIAL | `HelperJobEarnings.jsx` via `GET /main-app/earnings` (per-job amount + status) | no per-job breakdown. Plan: per-job gross / platform fee / net / adjustments detail | DONE (helperJobEarningsService, HelperJobBreakdown, HelperPayoutTimeline, group4RestEarnings.db.test.js) |
| 187 | Payout timeline | PARTIAL | `GET /main-app/payouts/summary` has zero client callers | Plan: timeline on `/helper/payouts` from that endpoint | DONE (helperJobEarningsService, HelperJobBreakdown, HelperPayoutTimeline, group4RestEarnings.db.test.js) |
| 188 | Statement download | EXISTS | statement center / exports (`statementExports.js`, `helper_earnings` product) | none | - |
| 189 | Adjustment explanation | PARTIAL | adjustments exist server-side, not explained to the helper | Plan: per-job breakdown lines with plain-language reason codes | DONE (helperJobEarningsService, HelperJobBreakdown, HelperPayoutTimeline, group4RestEarnings.db.test.js) |
| 190 | Payment issue intake | PARTIAL | general support only | Plan: same intake as 185 with `kind=payment_issue`, category `helper_payment` | DONE (helperJobSupportService, HelperJobSupport on JobDetailPage, group4RestJobSupport.db.test.js) |
| 191 | Portfolio permission request | EXISTS | `helperWork.js` portfolio-requests | none | - |
| 192 | Review response | PARTIAL | `PUT /reviews/:id/respond` + `useReviews` hook, zero UI callers; reviewer not notified | Plan: helper "My reviews" page with respond; notify reviewer | DONE (helperReputationService, HelperReputationPanel, group4RestReputation.db.test.js) |
| 193 | Repeat customer follow-up | MISSING leg | no surface | Plan: list of the helper's past customers (completed jobs) + rate-limited "book me again" invite notification | DONE (migration 20261123170100_helper_rebook_invites.sql, helperRepeatCustomerService, HelperRepeatCustomers, group4RestRepeatCustomers.db.test.js) |
| 194 | Skill endorsement record | MISSING | none | Emile confirmed 2026-11-23 (directly, in chat): endorsements only from completed engagements, one per client per skill | DONE (migration 20261123170000_helper_skill_endorsements.sql, helperEndorsementService, JobSkillEndorsements, profile counts, group4RestEndorsements.db.test.js) |
| 195 | Quality feedback summary | PARTIAL | ratings exist, no helper-facing summary | Plan: avg, distribution, 90-day trend, response rate, changes-requested and no-show counts | DONE (helperReputationService, HelperReputationPanel, group4RestReputation.db.test.js) |
| 196 | Business application handoff | MISSING | business application exists, no helper carry-in | Emile confirmed 2026-11-23: helper portfolio/history carry as a read-only record | DONE (migration 20261123170400_helper_business_records.sql, helperBusinessTransitionService, /helpers/me/business-transition, HelperBusinessTransition, BusinessCreationWizard prefill, BusinessWorkspaceIntro, group4RestBusinessTransition.db.test.js) |
| 197 | Readiness milestones | MISSING | | as 196 | DONE (migration 20261123170400_helper_business_records.sql, helperBusinessTransitionService, /helpers/me/business-transition, HelperBusinessTransition, BusinessCreationWizard prefill, BusinessWorkspaceIntro, group4RestBusinessTransition.db.test.js) |
| 198 | Service migration preview | MISSING | | as 196 (preview only, nothing moves) | DONE (migration 20261123170400_helper_business_records.sql, helperBusinessTransitionService, /helpers/me/business-transition, HelperBusinessTransition, BusinessCreationWizard prefill, BusinessWorkspaceIntro, group4RestBusinessTransition.db.test.js) |
| 199 | Personal work preservation | MISSING | | as 196 (helper record stays personal; business gets a read-only reference) | DONE (migration 20261123170400_helper_business_records.sql, helperBusinessTransitionService, /helpers/me/business-transition, HelperBusinessTransition, BusinessCreationWizard prefill, BusinessWorkspaceIntro, group4RestBusinessTransition.db.test.js) |
| 200 | New workspace introduction | MISSING | | as 196 | DONE (migration 20261123170400_helper_business_records.sql, helperBusinessTransitionService, /helpers/me/business-transition, HelperBusinessTransition, BusinessCreationWizard prefill, BusinessWorkspaceIntro, group4RestBusinessTransition.db.test.js) |

## Order (highest value / lowest risk first)
1. 192 + 195 reviews page and quality summary
2. 179 + 180 notifications
3. 187 payout timeline, then 186 + 189 breakdown
4. 185 + 190 job-linked support intake
5. 177 + 182 time guards
6. 194 endorsements
7. 193 repeat customers
8. 181 job reschedule, 184 replacement handoff
9. 196-200 grow into ownership

## Conventions
- Server routes for helper-side items go under `/api/helpers/me/*` (`server/routes/helperWork.js`, which already enforces `helper.offer_services`).
- Migrations `server/migrations/YYYYMMDDHHMMSS_name.sql`, additive, `IF NOT EXISTS`.
- UI copy: keys under `helperWork.*` in all 20 `client/src/locales/*.json`; en/es/fr/ht/ar translated, others English fallback text; logical CSS properties only (RTL).
- Tests: `server/__tests__/group4Rest*.db.test.js`.

## Running tests
```
/workspace/pgbin/env/bin/pg_ctl -D /workspace/pgdata -o "-k /workspace/pgsock -p 5432 -c listen_addresses=127.0.0.1" -l /workspace/pgdata.log start
createdb -h 127.0.0.1 -U oxsteed pa_g41
cd server && DATABASE_URL=postgresql://oxsteed@127.0.0.1:5432/pa_g41?sslmode=disable NODE_ENV=test npm run migrate
ACCESS_TEST_DATABASE_URL=postgresql://oxsteed@127.0.0.1:5432/pa_g41?sslmode=disable npx jest --runInBand __tests__/group4Rest
cd ../client && npm run build:ci
```
(symlink node_modules from /workspace/old-file/{client,server}; remove before committing)

## Next step
CI green at b481d1540 (run 45227906181). Awaiting Emile's review and his calls on the open items in the PR body. Don't merge.
