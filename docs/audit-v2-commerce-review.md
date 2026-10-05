# Commerce, consulting, corporate operations, logistics, and Learn review: tabs 18–34

Review date: 2026-10-03. Source anchor: `e47531c76b320c8145e15415774d05d698b456d1`, verified after the shared checkout advanced through `893f1bc3` from `a056524d`. The implementation files underlying tabs 18–34 were compared across the latest advance and were unchanged; route/index locations were refreshed. Repository: `/Users/oxsteed/Documents/GitHub/6`. Applicable root `AGENTS.md`, README, and RUNBOOK were read. No nested AGENTS.md was found in the reviewed directories. This review changes only this document; it uses source, migration definitions, and test source, without credentials, provider calls, database access, production actions, or product edits.

The previous `docs/admin-super-admin-full-audit-2026-10-02.md` is a discovery baseline, not evidence that a defect remains. Current source is cited below using repository-relative `file:line` locations. Migration citations establish intended schema, not deployed schema. Tests mentioned as existing were inspected, not executed in this review. Acceptance tests are proposed work, not claimed passes. Scenarios and performance thresholds are explicit planning assumptions for 3,500 worldwide employees and six million users; they are not measured production behavior or a complete certification.

Current-reality correction: at the resumed 22:30 UTC snapshot, the user reports CI run `37147612778` failed and main is investigating; readiness was healthy at `661/661` with `gitSHA: null`. Those are user-provided observations, not checks performed here. The earlier green runs, including `37110020289`, are historical to that snapshot. Readiness without a deployment SHA does not identify the served source revision. The Customer360 mock repair at `4fe5470d`, localization debt/gating at `25790585`, and process-state registry/Redis fencing work at `893f1bc3` remain acknowledged. Legal `thisMonth` repair and the new scale harness are not repeated as unresolved old defects. Provider Health is owned by the main review; Restaurant Top-up Approvals is included as the explicitly added finance scope. Tab-specific limitations below do not assert that wider repairs failed.

Finding labels: **CONFIRMED DEFECT** means a demonstrable present source contract or logic error; it does not imply observed production exploitation. **DESIGN GAP** means a missing or insufficient capability in the inspected workflow. **UNVERIFIED** identifies a consequential runtime or deployment question that source alone cannot settle. Proposed endpoints and screen controls are recommendations, not existing features.

## Coverage and actual routes

Routes are verified in `client/src/admin/adminRouteManifest.js:41–58`; the additional approvals route is at `:112`. API mounts are in `server/index.js`; each review names its concrete router/controller paths.

| Tab | Actual browser route | Current page source | API route and implementation files |
| --- | --- | --- | --- |
| 18 Businesses | `/admin/businesses` | `client/src/admin/pages/BusinessModeration.jsx` | `server/routes/admin.js`; `server/controllers/businessModerationController.js` |
| 19 Tool Rentals | `/admin/tool-rentals` | `client/src/admin/pages/ToolRentalModeration.jsx` | `server/routes/admin.js`; `server/controllers/businessModerationController.js`; owner path `server/routes/toolRentals.js` |
| 20 Planned Needs | `/admin/planned-needs` | `client/src/admin/pages/PlannedNeedsAdmin.jsx` | `server/routes/admin.js`; `server/controllers/businessModerationController.js`; `server/controllers/plannedNeedsController.js`; `server/jobs/plannedNeedsScheduler.js` |
| 21 Payments | `/admin/payments` | `client/src/admin/pages/PaymentsList.jsx` | `server/routes/admin.js`; `server/controllers/paymentsAdminController.js`; `server/routes/payments.js`; `server/services/paymentRefundService.js` |
| 22 Orders | `/admin/orders` | `client/src/admin/pages/OrderManagement.jsx`; `client/src/admin/components/OrderDetailModal.jsx` | `server/routes/adminOrders.js`; `server/controllers/adminOrdersController.js`; `server/services/marketplaceRefundService.js` |
| 23 Templates | `/admin/templates` | `client/src/admin/pages/TemplateManagement.jsx` | `server/routes/templates.js`; `server/controllers/templateController.js` |
| 24 Consulting | `/admin/consulting` | `client/src/admin/pages/ConsultingDashboard.jsx` | `server/routes/consultingAdmin.js`; `server/controllers/adminConsultingController.js` |
| 25 Consulting Pay | `/admin/consulting/payments` | `client/src/admin/pages/ConsultingPayments.jsx` | `server/routes/consultingAdmin.js`; `server/routes/consultingPayment.js`; `server/controllers/adminConsultingController.js`; `server/controllers/consultingPaymentController.js`; `server/services/externalRefundService.js` |
| 26 Scheduling | `/admin/consulting/scheduler` | `client/src/admin/pages/ConsultingScheduler.jsx` | `server/routes/consultingAdmin.js`; `server/routes/consultantScheduling.js`; `server/controllers/adminConsultingController.js`; `server/controllers/consultantSchedulingController.js` |
| 27 Business Launch | `/admin/consulting/business-launch` | `client/src/admin/pages/BusinessLaunchAdmin.jsx`; `client/src/admin/pages/BusinessLaunchRequestDetail.jsx` | `server/routes/businessLaunch.js`; `server/controllers/businessLaunchController.js`; `server/controllers/businessLaunchNotesController.js` |
| 28 Consulting Sessions | `/admin/consulting/sessions` | `client/src/admin/pages/ConsultingSessionsAdmin.jsx`; `client/src/admin/pages/ConsultingSessionDetail.jsx` | `server/routes/consultingAdmin.js`; `server/controllers/adminConsultingController.js` |
| 29 Org Chart | `/admin/corporate/org-chart` | `client/src/admin/pages/super/CorporateOrgChart.jsx` | `server/routes/corporateRoles.js`; `server/controllers/corporateRolesController.js`; `server/services/corporateRolesService.js` |
| 30 Corporate Titles | `/admin/corporate/assignments` | `client/src/admin/pages/super/CorporateAssignments.jsx` | `server/routes/corporateRoles.js`; `server/controllers/corporateRolesController.js`; `server/services/corporateRolesService.js` |
| 31 Logistics Ops | `/admin/logistics` | `client/src/admin/pages/logistics/LogisticsAdminDashboard.jsx` | `server/routes/logisticsAdmin.js`; `server/controllers/logisticsAdminController.js`; `server/middleware/requireInternalLogisticsWorkspace.js`; `server/services/logisticsAccessService.js`; `server/services/logisticsStateMachine.js` |
| 32 Learn Submissions | `/admin/learn/submissions` | `client/src/admin/pages/LearnSubmissionsAdmin.jsx` | `server/routes/learn.js`; `server/controllers/learnController.js` (including `publishDueGuideVideos`) |
| 33 Learn Product Links | `/admin/learn/product-links` | `client/src/admin/pages/LearnProductLinksAdmin.jsx` | `server/routes/learn.js`; `server/controllers/learnController.js`; `server/services/learnTagging.js` |
| 34 Learn AI Suggestions | `/admin/learn/ai-suggestions` | `client/src/admin/pages/LearnAiSuggestionsAdmin.jsx` | `server/routes/learn.js`; `server/controllers/learnController.js`; `server/services/learnTagging.js` |
| Additional finance scope: Restaurant Top-up Approvals | `/admin/super/restaurant-topups` | `client/src/admin/pages/super/RestaurantTopupApprovals.jsx` | `server/routes/adminRestaurantTopups.js`; `server/controllers/adminRestaurantTopupController.js`; `server/services/restaurantTopupService.js`; customer route `server/routes/restaurantTopups.js` |

## 18. Businesses

### Route and business purpose

`/admin/businesses` is the account moderation workspace for finding businesses, inspecting ownership and activity, changing availability, recording concerns, and soft deletion. At enterprise scale it should produce defensible business decisions and investigations, with clear distinctions between a business, its owner, and the owner's other businesses. It is already implemented.

### Verified current implementation

`client/src/admin/pages/BusinessModeration.jsx:243` loads paged, cancellable results and preserves previous data on error. Importantly, `:282` now sends `{reason, confirmed: true}` for deletion: the earlier missing-confirmation defect is repaired. `server/routes/admin.js:94` protects the list and mutations with current admin authentication and `manage_users`. `server/controllers/businessModerationController.js:90` conditionally changes active state and returns 409 on a competing change; `:446` performs soft deletion. `server/migrations/161_business_moderation_enhancements.sql:4` supplies moderation/deletion fields. `server/__tests__/businessDeletionT18Repro.test.js:27` covers confirmed deletion and `:44` rejects an unconfirmed request. These are source safeguards, not a live deletion trial.

### Concrete flaws and gaps

**T18-1 — CONFIRMED DEFECT, medium:** the activity filter is accepted but never used. The UI sends it at `BusinessModeration.jsx:247`; the controller destructures it at `businessModerationController.js:9` but predicates at `:13–22` address only search, active state, and deletion. A dormant-business saved investigation would therefore include businesses outside the intended criterion.

**T18-2 — CONFIRMED DEFECT, medium:** commercial indicators are not business-specific measurements. The projection at `businessModerationController.js:37` returns a null category, `:43` hardcodes earnings to zero, and `:42` counts jobs assigned to the owner. Two businesses sharing an owner inherit the same job count regardless of actual business attribution. Zero cannot truthfully mean no earnings when no earnings aggregation was performed.

**T18-3 — CONFIRMED DEFECT, high:** flagging can report success without retaining the flag. `businessModerationController.js:368` writes only an admin audit action, catches failure at `:377`, and returns “flagged for review” at `:379`. No durable investigation row is created in this path. The operator receives affirmative confirmation even if the only attempted record failed.

**T18-4 — DESIGN GAP, medium:** note editing has no stale-version protection. Despite its safeguard comment, the UPDATE at `businessModerationController.js:405` predicates only on ID. A row lock or version comparison is absent, and deletion does not predicate on `deleted_at IS NULL` at `:448`. Repeated deletions and competing notes need explicit outcomes. The existing conditional active-state update solves a narrower race and should remain.

### Expansion failure scenario

A regional fraud team investigates 800 interconnected businesses after a campaign. Owner-level job counts imply activity at every linked business, the dormant filter fails to narrow the queue, and one flag request loses its audit record. Another team overwrites investigation notes. Staff can mistakenly close a case as unprofitable or inactive without reliable evidence or a persistent case to hand over.

### Required changes and operator design

Implement an explicit business activity predicate and business-attributed aggregates, or return null plus a measurement-status field. Replace flag-as-log with a transactionally persisted moderation case carrying reason, assignee, severity, status, and next review date. Add expected versions to note/state commands, retain deletion history, and make audit failure visible. Regional delegation needs a scoped query/target policy: current `requirePermission` deliberately accepts global grants (`server/middleware/adminAuth.js:126`), so a country dropdown alone cannot authorize regional operations. Link the case to Business360, ownership changes, active jobs, and settlements before suspension.

### Operator design recommendations

Keep the business table but place a jurisdiction/team scope selector, result snapshot time, and “business measures” explanation above it. KPI cards should count matching non-deleted businesses, active businesses, open moderation cases, and cases overdue for review. Replace the misleading earnings zero with “not measured” until a business ledger aggregate exists; label owner job totals explicitly during migration.

Rows need business ID/name, owner, operating location, membership count, verified business activity, active/deleted state, case severity, and latest moderation decision. Search should run on the server across business ID/name and authorized owner identifiers. Add activity period, open-case, assigned-team, and review-due filters; save “Dormant, no open work” and “Flagged, awaiting evidence” views with query scope.

Open a drawer with Identity and memberships, Commercial dependencies, Moderation timeline, and Case tasks. Flag creates an assigned case; notes append investigation entries rather than replacing one paragraph. Suspend/reactivate and soft-delete remain individual actions. Confirmation must preview affected active jobs, memberships, and unresolved money, require a reason, and submit the current version. Permit bulk case assignment after a selected-ID preview; exclude bulk deletion.

On 409 show the competing decision beside the draft and require rereading dependencies. Audit persistence failure leaves the action unresolved, with a trace ID and retry status. No matches suggests clearing activity/date filters; no access names `manage_users`; unavailable data retains the last snapshot with actions disabled. Mobile cards prioritize identity/state/case due date, with the full dependency drawer accessible by keyboard. Use logical alignment and isolated IDs/emails for RTL; focus returns to the reviewed row after closing.

### Acceptance tests and owner

Business Trust Operations should own decision policy; the Business API function should own data attribution and case integrity. Test two businesses belonging to one owner with disjoint jobs: each receives its own counts, and unknown earnings remains null. Activity filters must change both list and total. Inject audit/case persistence failure: no false flag success. Competing notes must yield one committed edit and a 409. Preserve existing deletion tests and add a browser payload assertion. A scoped operator must be unable to mutate a foreign target by ID; load-test representative indexed searches before agreeing a sub-second queue target.

## 19. Tool Rentals

### Route and business purpose

`/admin/tool-rentals` moderates peer equipment listings. The business purpose is to stop unsafe or misleading supply while preserving rental obligations and evidence. Listing visibility, the owner's willingness to rent, existing bookings, and safety enforcement are different states; this tab currently represents most of them through a single availability flag.

### Verified current implementation

`server/routes/admin.js:123` requires admin authentication and `manage_operations`. `server/controllers/businessModerationController.js:132` returns listing, rate, condition, location, and owner fields; `:167` uses a conditional availability update with a 409 conflict response. The client `client/src/admin/pages/ToolRentalModeration.jsx` implements search, availability filtering, pagination, and a reason-confirmed toggle. The wider owner API already validates money and peer attestation at `server/routes/toolRentals.js:245` and `:281`. `server/migrations/208_tool_rental_peer_agreement.sql` establishes agreement-related data; booking and review schemas exist in migrations `075b_tool_booking.sql` and `074b_tool_reviews.sql`. `server/__tests__/toolRentals.test.js:33` checks required attestation; `:48` checks availability updates preserve prices.

### Concrete flaws and gaps

**T19-1 — CONFIRMED DEFECT, high:** an owner can undo an administrator's hide by updating the same `is_available` field. Moderation changes it at `businessModerationController.js:168`; the authenticated owner update accepts availability at `toolRentals.js:272` and writes it at `:523`. There is no independent administrative hold predicate in that write. The race safeguard does not protect a later valid owner request. This proves a reversible enforcement mechanism, not that a live owner has exploited it.

**T19-2 — DESIGN GAP, high:** moderation decisions cannot distinguish safety suspension from voluntary unavailability. The list at `businessModerationController.js:133` projects one flag; the toggle at `:179` logs enabled/disabled actions with an optional reason. It creates no durable hold classification, expiry, evidence attachment, or assigned case. “Hidden” is insufficient information for a return-to-service decision on damaged equipment.

**T19-3 — CONFIRMED DEFECT, medium:** success can survive lost moderation evidence. Audit failures are swallowed at `businessModerationController.js:184`, after the state update. The response at `:185` confirms hiding even when its historical reason was not retained. Because this action can affect income and safety, a mere application log is not an adequate substitute for a committed decision record.

**T19-4 — DESIGN GAP, medium:** the admin projection at `businessModerationController.js:132` excludes deposit/replacement value, current booking exposure, and agreement evidence, although the owner API validates those fields. Its raw page/limit parsing at `:120–143` lacks bounds. Visibility controls therefore operate without showing the financial and contractual dependencies already represented elsewhere.

### Expansion failure scenario

An equipment recall affects 1,200 listings across regions. Moderators hide the affected equipment, but routine owner edits make some available again. Staff cannot see which tools are currently rented or require safe return instructions. A six-million-user marketplace amplifies each resumed listing's reach; the failure is enforcement-state ownership, not an absence of rental infrastructure.

### Required changes and operator design

Add an administrator-owned moderation state, separate from owner availability, and require both to permit browsing or new bookings. Expose a command such as `POST /api/admin/tool-rentals/:id/moderation-decisions` with desired state, reason code, case ID, expected version, and review date. Preserve the current conditional-update protection. A hold should block new rentals without silently cancelling existing bookings or releasing deposits. Reuse booking, agreement, dispute, and refund services for those consequences. Bound pagination and make audit plus hold persistence atomic; unauthorized owner writes must never clear a moderation hold.

### Operator design recommendations

Replace the binary availability header with “Rental listing safety” and a visible market scope and last successful refresh. Four cards should measure publicly rentable listings, administrative holds, unresolved safety cases, and active bookings on held equipment. Do not calculate those values from the visible page; request scoped aggregates. The current Hide/Show control becomes a state-specific “Place hold” or “Review release” action.

The queue should include tool ID/name, category, owner availability, administrative status, city, rate currency, deposit exposure, active rental count, complaint count, and next safety review. Add brand/model, category, market, hold reason, booking exposure, and report-age filters beside server search. Saved views should include “Recall: active rentals” and “Release requested: evidence missing.”

A drawer should show images/description, attestation and agreement version, booking timeline, deposit/refund dependencies, reports, and the moderation case. Releasing a hold requires required repair/inspection evidence and a preview of publication eligibility. Holding equipment previews affected bookings and produces a communication task. Allow bulk recall holds only after an exact selected-ID/model preview; bulk release requires individual evidence and should be unavailable initially.

If the owner changes availability during review, display both changes and preserve the independent hold. Retry a timed-out command by command ID, then read the decision rather than toggling again. A true empty queue says no listings meet the recall criteria; no access names the operations grant; failed booking exposure shows “dependency unavailable” and disables release. Mobile cards keep tool/state/exposure first; a full-screen detail view supports image descriptions, labeled controls, keyboard focus, and RTL text without reversing serial numbers or rate amounts.

### Acceptance tests and owner

Marketplace Safety should be accountable, with Rentals Engineering implementing enforcement. Owner reactivation of a held tool must leave it excluded from browsing and new booking, while existing booking records remain readable. Competing moderation decisions yield one result and 409. A recall bulk preview must list exactly the applied IDs and preserve per-item evidence. Failed audit writes must roll back the hold command or return an explicit unresolved result. Test deposits and active bookings in the drawer; retain existing price-preservation and attestation tests. Evaluate bounded pages against a million-listing synthetic dataset, including oldest unresolved reports.

## 20. Planned Needs

### Route and business purpose

`/admin/planned-needs` supervises future work and recurring activation. Operators must know whether a need is waiting, intentionally paused, ready to publish, or already linked to a live job. The correct intervention depends on which lifecycle has started; stopping automation is not equivalent to cancelling an accepted job or returning money.

### Verified current implementation

`client/src/admin/pages/PlannedNeedsAdmin.jsx:24` parses date-only values locally, avoiding a common display shift. `server/routes/admin.js:127` protects supervision with `manage_operations`. The earlier pause defect is repaired: `server/controllers/businessModerationController.js:245` now sets `is_paused = TRUE`. `server/jobs/plannedNeedsScheduler.js:44` locks and rechecks status, linked job, and pause before publication; `:176` and `:198` exclude paused candidates. `server/__tests__/plannedNeedsT20Repro.test.js:30` covers durable pause and later cases exercise locked eligibility. `server/migrations/156_planned_needs_pause.sql` supplies pause state. Force cancellation at `businessModerationController.js:284` remains conditional on nonterminal state.

### Concrete flaws and gaps

**T20-1 — CONFIRMED DEFECT, medium:** the admin list cannot reveal the repaired pause state. Its SELECT at `businessModerationController.js:208–213` omits `is_paused`, while a cancelled auto-publish returns to `planned`. Operators see apparently ordinary planned work that the scheduler will deliberately skip. The success message at `:261` also describes only a reset, without exposing the durable pause consequence.

**T20-2 — DESIGN GAP, high:** force cancellation and published-job handling remain disconnected. The handler reads `published_job_id` at `businessModerationController.js:275`, updates only the need, and returns the previously read ID at `:299`. Its broad nonterminal predicate can accept a state that changed to published after the initial read. The linked job may therefore survive as intended, but the returned dependency can be stale. The UI warning about surviving jobs is useful and should remain; a canonical refreshed dependency is still needed.

**T20-3 — DESIGN GAP, medium:** publication uses a locked eligibility record but candidate content from an earlier SELECT. The lock at `plannedNeedsScheduler.js:45` reads only lifecycle fields; title, description, cost, and preferred helper are used from `need` at `:60–68`. An edit between candidate collection and lock acquisition can publish superseded commercial content. This is a current stale-content window, not a claim that the existing duplicate-publication guard is absent.

**T20-4 — DESIGN GAP, medium:** the scheduler loads all due candidates at `plannedNeedsScheduler.js:185–201` and iterates sequentially at `:204`. There is no LIMIT in this candidate query. At global volume the admin queue needs publication latency and failure visibility; it currently returns due-date-sorted rows without activation lag, last attempt, or attempt owner. Whether today's worker volume is problematic is UNVERIFIED.

### Expansion failure scenario

A fleet operator imports 30,000 recurring maintenance needs. Staff pause suspicious records during review and edit estimates as prices change. The admin queue hides the pause distinction, older candidate data can become published descriptions, and due items accumulate behind sequential processing. A support agent then cancels a need while a separate team continues its published job.

### Required changes and operator design

Include pause state and published-job state in list/detail responses. Read publication content under the existing row lock, not from the earlier candidate snapshot. Add bounded scheduling batches, idempotent attempt records, error classification, and activation lag metrics. Implement separate commands for pause, resume, cancel-future-recurrence, and linked-job escalation; resume should preview the next activation date and require the latest version. Persist reasons and refresh dependency IDs after the mutation. Integrate Job Operations and payment cancellation policy without having this tab directly refund funds or erase completed work.

### Operator design recommendations

Use an “Activation supervision” header containing market/timezone, scheduler heartbeat, and queue snapshot time. KPIs should count paused needs, eligible needs already past activation time, attempts failed in the selected window, and published needs requiring a separate job decision. Define activation time as due date minus lead time in the agreed service timezone, rather than equating due date with publication deadline.

Add columns for need ID/title, customer, due date, activation date, recurrence, pause reason, automation state, linked job state, last attempt, and activation lag. Search title/customer/need ID on the server; filter pause state, due range, recurrence type, failed attempt, and published-job existence. Saved views should include “Paused: review due” and “Activation overdue: no job.”

The drawer should show schedule and recurrence chain, latest editable content, reserved/estimated amounts labeled by meaning, preferred-helper eligibility, publication attempts, and linked-job actions. Existing cancel-autopublish becomes “Pause activation”; resume previews immediate publication if activation is already overdue. Force-cancel confirmation must explicitly say whether a live job continues and offer a linked escalation task. Bulk pause can be allowed with a reason and selected-ID preview; prohibit bulk linked-job cancellation.

On a publication race, reread the canonical job ID and switch to job follow-up. A failed resume keeps the pause visible and retains the draft reason. Empty means no needs in the chosen activation window; no access names `manage_operations`; missing scheduler health marks automation unknown and suppresses “all clear.” On mobile use a dated agenda with pause and lag badges. Announce state changes and conflicts, keep date-only fields stable in RTL, and provide keyboard access to recurrence/history sections.

### Acceptance tests and owner

Service Operations owns activation policy; Scheduling Engineering owns publication correctness. After pause, two scheduler passes must create no job and the admin row must show paused. Editing cost/title between candidate selection and locking must publish the latest committed values. Simultaneous publication and cancellation must return the actual linked job and a truthful continuation warning. Process a 30,000-item synthetic workload in bounded batches with no duplicate jobs; every failure remains discoverable. Validate recurrence cancellation leaves historical jobs intact and an overdue resume preview accurately predicts immediate activation.

## 21. Payments

### Route and business purpose

`/admin/payments` is the marketplace job-payment read workspace, exposing payer, payee, job, gross amount, platform fee, payout, and status. It is one financial domain, not a consolidated view of Consulting Pay, Orders, logistics costs, restaurant wallets, or Credit. Staff need traceable financial evidence and a clear route into exception handling.

### Verified current implementation

`server/routes/admin.js:137` requires `view_financials`; `client/src/admin/pages/PaymentsList.jsx:44` has cancellable loading and a dedicated permission state at `:77`. `server/controllers/paymentsAdminController.js:6` now clamps page/limit and `:15` includes the entire date-to day using a half-open boundary. Its list and count use the same participant joins at `:34` and `:42`, so the older count-mismatch recommendation is not current. Refunds are separately protected by `issue_refunds` at `server/routes/payments.js:33`. `server/services/paymentRefundService.js:28` requires idempotency; `:56` reserves attempts transactionally. Migration `597_payment_refund_reconciliation.sql` and `server/__tests__/paymentRefundReconciliation.test.js:38` support partial-refund accounting.

### Concrete flaws and gaps

**T21-1 — DESIGN GAP, high:** refund and reconciliation state are absent from the table contract. `paymentsAdminController.js:22–24` returns status and terminal timestamps but not cumulative refunds or outstanding refund attempts. The refund service updates cumulative value at `paymentRefundService.js:182`; partial refunds intentionally need not set full `refunded` status. A captured/released row therefore cannot establish its remaining refundable amount or whether an external operation is unresolved.

**T21-2 — DESIGN GAP, medium:** financial discovery is limited to status and creation dates. `paymentsAdminController.js:8–19` has no payment ID, provider ID, participant, job, refund-attempt, or exception search. Although provider identifiers are selected at `:23`, the main table at `PaymentsList.jsx:172–179` does not provide an investigation workflow for them. A user presenting a provider receipt cannot efficiently locate the authoritative payment.

**T21-3 — DESIGN GAP, high:** the page and projection have no currency contract. Formatting at `PaymentsList.jsx:28` always uses USD and the selected payment fields at `paymentsAdminController.js:22` omit currency. This may be a legitimate USD-only domain today; foreign-currency support is not assumed. Worldwide expansion must explicitly preserve USD restrictions or carry currency/minor-unit metadata rather than interpreting a global amount as USD by accident.

**T21-4 — UNVERIFIED, medium:** inner participant joins at `paymentsAdminController.js:34–35` exclude rows whose payer/payee is absent. The corrected count faithfully follows the same rule, but completeness of historical finance evidence depends on deployed retention/FK behavior. Source inspection does not establish that such orphaned rows exist. Audit a synthetic deletion/retention fixture before deciding whether participant joins should be left joins with retained identity snapshots.

### Expansion failure scenario

Support receives hundreds of refund inquiries after an external-provider timeout. Some payments remain captured with partial refunds and reserved attempts. Staff using this table see normal statuses and totals, search by date alone, and may hand cases to the wrong financial domain. Repeating a refund from another workspace must reuse the original intent, not infer eligibility from the row color.

### Required changes and operator design

Add a finance detail endpoint with payment identity, currency policy, provider references, immutable accounting history, cumulative refund, remaining capacity, and attempt/reconciliation state. Reuse the durable refund service and the separate refund grant; do not embed an unguarded refund write in the list API. Provide scoped indexed search and keyset ordering `(created_at, id)`. Link Job Operations and reconciliation exceptions by payment ID, while explicitly linking to other payment domains. Return a server snapshot timestamp and a completeness indicator if participant retention affects results.

### Operator design recommendations

Title the screen “Job payments” and show the ledger/domain scope, selected creation/settlement window, currency policy, and last successful snapshot. KPI cards should report gross captured, net retained after settled refunds, refund amount awaiting resolution, and exception count. Define each metric by settlement state and currency; counts and amounts must use the complete filtered query rather than the current page.

Rows should retain payer/payee/job but add payment ID, currency, captured amount, cumulative refunded amount, refundable remainder, provider attempt state, and exception link. Search by exact payment/job/provider identifiers plus authorized participant fields. Offer creation-versus-settlement date basis and saved views “Provider outcome unknown,” “Partial refund inquiry,” and “Released, reconciliation exception.”

A drawer should separate Payment identity, Amount breakdown, Provider events, Refund attempts, and Job/dispute dependencies. Copying identifiers, opening a case, or exporting selected read evidence are row actions. Refund is visible only with `issue_refunds`, then fetches fresh remaining capacity and previews amount, fee reversal, reason, and original intent ID before confirmation. Permit bulk case assignment; prohibit bulk refunds from this list.

An unresolved provider result displays the existing attempt with “check outcome,” not a fresh refund button. A 409 refreshes capacity and preserves the entered reason. Empty means no payments for this domain/window; lack of financial authority shows its dedicated access panel; provider evidence unavailable leaves ledger amounts visible with investigation actions restricted. Mobile cards lead with ID/net/refund state and expose breakdown on tap. Keep monetary columns and provider IDs directionally stable in RTL and announce refreshed outcomes without clearing keyboard selection.

### Acceptance tests and owner

Payments Operations should own exception triage; Payments Engineering owns monetary projections. Test a partial refund, full refund, reserved attempt, and timeout: each must render distinct truthful remaining capacity. Replay the same refund intent and verify one provider operation. Test date-to boundaries and participant-retention fixtures; assert no cross-domain totals are mislabeled consolidated revenue. If USD-only, non-USD records/commands must be rejected explicitly; if supported, currencies must never aggregate without conversion provenance. Retain current refund tests and add detail/list contract tests, including denied financial read versus denied refund write.

## 22. Orders

### Route and business purpose

`/admin/orders` manages product marketplace fulfillment, order detail, shipping, cancellation, and refunds. Its operational record is a product order with line items and shipment evidence, not a service job payment or logistics purchase order. Fulfillment and financial state must agree without preventing investigation of resolved orders.

### Verified current implementation

`server/routes/adminOrders.js:8` requires `manage_operations`; `:23` additionally requires `issue_refunds`. `server/controllers/adminOrdersController.js:13` bounds list size and `:67` applies matching search to totals. Shipping and cancellation now correctly invoke `withTransaction(pool, operation)` at `:229` and `:339`; the prior transaction-signature defect is repaired. Refunded details remain readable at `:130`. Refunds call the durable marketplace refund service at `:294`, return 202 for unsettled outcomes, and include cumulative refunded amount at `:316`. `server/migrations/603_marketplace_order_state_integrity.sql:26` guards terminal transitions. Existing repro tests at `server/__tests__/adminOrdersT22Repro.test.js:33` and `:112` cover repaired transaction/read behavior.

### Concrete flaws and gaps

**T22-1 — CONFIRMED DEFECT, high:** detail unconditionally parses a JSONB address as JSON text. `adminOrdersController.js:174` calls `JSON.parse(order.shipping_address)`, while `server/migrations/129_marketplace_orders_transactions.sql:13` declares JSONB. A normal decoded object is not valid JSON text for this call and causes the whole detail request to fail. The refunded-read repair does not fix this independent address contract.

**T22-2 — CONFIRMED DEFECT, medium:** shipping state errors become server failures rather than actionable conflicts. `adminOrdersController.js:239` rejects only cancelled status before forcing `processing` at `:247`. Migration 603 correctly rejects pending→processing and completed/refunded resurrection. Consequently those invalid requests hit the generic catch/error response rather than a prevalidated 409. The database prevents corrupt transitions; the API still misrepresents routine invalid-state requests.

**T22-3 — DESIGN GAP, medium:** carrier input is not persisted with shipment data. It is read at `adminOrdersController.js:222`; the order UPDATE at `:247` stores tracking number and timestamp only. It enters the action-log details but does not become canonical carrier evidence returned by detail at `:192`. Shipment investigation cannot depend on reconstructing the most recent free-form event.

**T22-4 — DESIGN GAP, high:** detail selects one arbitrary transaction at `adminOrdersController.js:145` and only the latest twenty action-log entries at `:151`. There is no continuation in that response. Even with durable refunds elsewhere, this drawer does not establish a complete financial/event history, or distinguish the canonical transaction from another attempt. That matters for partial refunds and long-running disputes.

### Expansion failure scenario

A holiday batch produces 50,000 paid orders and thousands of address/shipping inquiries. Normal address-bearing orders fail detail retrieval; staff attempt shipping from stale statuses and see generic 500s. Refund recovery operates correctly in its service, yet truncated drawer history leaves operators unable to explain which transaction or shipment was acted on.

### Required changes and operator design

Accept decoded JSONB objects and handle legacy strings deliberately. Validate shipping/cancellation transitions before writes, condition writes on expected state/version, and map database transition conflicts to 409. Require carrier/tracking evidence appropriate to the fulfillment method. Use an explicit canonical transaction or a paged attempt collection, and expose durable refund attempts plus complete paged action history. Keep terminal guards, transaction fixes, and paid-order refund-before-cancel logic (`adminOrdersController.js:353`). Add shipment tasks that link delivery/logistics references where present instead of assuming every product order shares a logistics lane.

### Operator design recommendations

The header should say “Product order fulfillment,” with warehouse/market scope, order-versus-event date basis, and snapshot freshness. KPI cards should distinguish paid awaiting shipment, shipments overdue, unresolved refund attempts, and completed net sales. Current aggregate revenue by completed order is a fulfillment measure; label it accordingly until accounting reconciles refunds and currency.

Keep order/customer/status/amount rows and add fulfillment deadline, carrier/tracking, canonical payment state, refund remainder, and assigned exception. Search exact order/provider/tracking IDs and customer fields; filter shipment age, warehouse, paid-unshipped, refund state, and delivery exception. Save “Paid, dispatch overdue” and “Refund accepted, provider pending” views with server-side paging.

The detail drawer should contain customer/address, line-item quantities and fulfillment, totals/currency, payment attempts, shipping milestones, and a paged action history. Mark shipped requires eligible paid state and carrier/tracking preview. Cancel remains for unpaid eligible orders; paid orders route to a refund preview showing remainder and idempotency identity. Bulk assignment or export is reasonable; bulk shipment requires per-order tracking validation and a result report, while bulk financial writes remain unavailable.

On address decode failure show a recoverable address section error rather than lose all detail. On 409 reload the current order and display the proposed transition alongside it. For 202 refund results retain the attempt and poll its status, preserving the command identity on retry. Empty differentiates no orders from no matches; no access identifies operations versus refund capability; provider unavailable preserves fulfillment evidence. Mobile uses item cards and a full-screen drawer; keyboard actions have labeled buttons, and addresses/identifiers receive correct RTL isolation.

### Acceptance tests and owner

Commerce Fulfillment owns this workflow; Commerce Payments owns refund linkage. Test decoded JSONB, legacy JSON text, and null addresses: all valid cases return detail. Ship pending, completed, refunded, and cancelled orders: each returns a typed conflict without mutation; paid shipment persists carrier/tracking. Concurrent shipping/cancellation produces one allowed transition. Detail must expose more than twenty events through continuation and choose the intended transaction. Preserve existing refunded-order and transaction tests, then verify timeout/replay produces one refund intent and a visible unresolved status rather than a second money movement.

## 23. Templates

### Route and business purpose

`/admin/templates` administers profile presentation pricing and exceptional user access. It combines preview, pricing, grants, revocation, and statistics. Revenue-affecting pricing and time-bounded access need coherent policies: a grant start date must mean something, and ending one grant must not accidentally invalidate another valid entitlement.

### Verified current implementation

`client/src/admin/pages/TemplateManagement.jsx:94` provides a pricing modal with preview and retained save errors at `:112`. Current grant routes require `manage_settings` at `server/routes/templates.js:35`, `:44`, and the revoke route; the older missing-grant allegation is repaired. Statistics use `manage_operations` at `:31`. `server/controllers/templateController.js:352` revokes only an active access record. `:192` rejects new lifetime purchases. `server/migrations/168_remove_lifetime_template_pricing.sql:5` zeroes historical lifetime prices. `server/__tests__/permissionGatesT11T12T23T25.test.js:39` inspects grant middleware. Preview and guarded APIs already exist and should be retained.

### Concrete flaws and gaps

**T23-1 — CONFIRMED DEFECT, medium:** the pricing UI submits `is_active` at `TemplateManagement.jsx:108`, but `templateController.js:204–210` never accepts it and the UPDATE at `:219–225` never writes it. An operator can “save” a listing activation change that the server silently ignores. Either remove the input or implement the field and return its persisted value.

**T23-2 — CONFIRMED DEFECT, high:** future-dated grants are immediately usable. Grant creation stores `start_date` at `templateController.js:330`, but both `getMyAccess` at `:36` and paid-template activation at `:130` filter only active status and expiry. Neither requires `start_date <= NOW()`. The start-date form therefore promises a restriction not enforced by the authoritative access path.

**T23-3 — CONFIRMED DEFECT, medium:** revoking one access row resets active business/helper templates regardless of other valid access. `templateController.js:361–369` changes every matching profile to default after the row revocation, without recomputing remaining entitlement. Those writes are also separate from the initial update, so a failure can leave an inconsistent partially revoked presentation.

**T23-4 — CONFIRMED DEFECT, medium:** zero pricing is replaced by default paid values. The modal initializes `monthly_price_cents || 999` and `lifetime_price_cents || 4999` at `TemplateManagement.jsx:95–96`; table cells repeat this at `:223` and `:229`. Migration 168 deliberately sets lifetime prices to zero, while lifetime purchases are removed. The editor can display an invented $49.99 legacy price and write it back during an unrelated edit.

### Expansion failure scenario

Marketing schedules template entitlements for a launch next month, while support grants temporary access to resolve a complaint. Customers can activate the future grant today. When support revokes its temporary record, the customer's independently valid entitlement is ignored and public profiles revert. Meanwhile zero-price legacy fields appear paid in the editor, complicating revenue and promotion review.

### Required changes and operator design

Centralize effective entitlement evaluation across listing, activation, revocation, and expiry using start/end bounds. Recompute entitlement and presentation atomically on revocation; preserve another qualifying grant. Validate finite nonnegative integer cents and start-before-expiry, use nullish defaults, and remove deprecated lifetime pricing from ordinary edits. Implement a versioned activity command or remove unsupported controls. Make pricing and grant decisions durable with reasons, affected-user preview, and effective date; use existing previews and grant guards rather than rebuilding them. Corporate permissions and ordinary admin grants remain separate responsibilities.

### Operator design recommendations

Keep the Pricing, Grants, and Statistics subviews, with a header describing market/currency policy and the last catalog/entitlement snapshot. Pricing KPIs should count active paid templates, free templates, scheduled price releases, and release conflicts. Grant KPIs should count effective, future, expiring soon, and revoked records according to the same server evaluator.

Pricing rows show slug, preview, current monthly price, active state, next effective price, and last approved revision. Remove ordinary lifetime editing; provide a read-only legacy entitlement section when needed. Grant rows show user, template, source, starts/ends, effective access, and decision reason. Search users/templates on the server and save views “Starts next month” and “Expiry within seven days.”

A detail drawer should expose template preview, pricing history, every entitlement source, affected business/helper profiles, and the decision trail. Price edits preview old/new cents and affected subscriptions before scheduling a release. Grant creation confirms recipient, bounded dates, source/reason, and current entitlement overlap. Revocation previews whether effective access actually ends and which profiles would revert. Bulk operations may schedule a reviewed price release or export grants; mass entitlement revocation requires an exact impact preview and separate reviewed job.

Conflicts retain the draft beside the latest catalog revision. Partial failures show which entitlement/presentation transaction needs recovery; retry by decision identity. Empty grant results explain selected dates/status; no access distinguishes pricing/grants from statistics; catalog unavailable hides previews and disables release. On mobile place preview and effective price together, then open full-screen entitlement history. Label date semantics and use keyboard-accessible dialogs; isolate slugs and currencies in RTL while preserving localized labels.

### Acceptance tests and owner

Profile Commerce owns pricing policy; Entitlements Engineering owns evaluation. A future grant must not appear usable or activate before its start. Revoke one of two overlapping valid grants: the profile stays active; revoke the last: it reverts transactionally. An injected failure rolls back both access and presentation writes. Saving zero cents must retain zero, and editing unrelated fields must not resurrect lifetime pricing. An active-state save must persist or reject explicitly. Preserve permission tests and add merged entitlement, effective-date, and pricing-preview contract coverage with Marketing approval for release semantics.

## 24. Consulting

### Route and business purpose

`/admin/consulting` is the consulting intake and assignment dashboard. It should convert an inquiry into accountable contact, appropriate specialist assignment, and a real appointment. This screen is the intake workbench; Consulting Sessions owns delivery, Scheduling owns reservations, and Consulting Pay owns financial investigation.

### Verified current implementation

`client/src/admin/pages/ConsultingDashboard.jsx:374` uses abortable loading, and `:404` confirms contact changes. `server/routes/consultingAdmin.js:13` wires request listing; `:18` wires assignment behind authenticated admin checks. `server/controllers/adminConsultingController.js:16` implements search/status/paging; `:101` lists active consultants with workload counts. `server/migrations/103_consulting_all_phases.sql:2` defines consultants separately from users, and `:37` adds the consultant-record reference. Status values are validated at `adminConsultingController.js:534`. These are existing capabilities; bounded queue navigation, assignment integrity, and delivery handover need further work.

### Concrete flaws and gaps

**T24-1 — CONFIRMED DEFECT, high:** dashboard discovery covers only the newest 200 requests. `ConsultingDashboard.jsx:376` hardcodes that limit, discards the API total/offset, and searches/filters locally at `:391`. A request outside that slice cannot be found through the page's search, although the server already supports searching the full dataset. This is an operator completeness error rather than an absent backend search feature.

**T24-2 — CONFIRMED DEFECT, high:** assignment marks an inquiry scheduled without creating a reservation or recording appointment time. `adminConsultingController.js:69` sets `consultant_id` and `status = 'scheduled'`, while Scheduling updates `consultant_assigned_id` at `:553`. They are separate references with different schema meanings, not interchangeable field spellings. `consulting_sessions_scheduled` is a separate table (`103_consulting_all_phases.sql:46`), used by payment and completion. Assignment can therefore produce a scheduled dashboard record without a usable appointment.

**T24-3 — DESIGN GAP, high:** active-consultant listing is stronger than the assignment write. Listing limits candidates to active at `adminConsultingController.js:109`, but assignment checks only existence at `:65`. It does not reserve capacity, validate current active state, or condition on request version/status. A stale dropdown or direct request can bypass the selection criteria. No claim is made that current staff have done so.

**T24-4 — DESIGN GAP, high:** requests, assignment, and dashboard statistics use admin-role checks without a corresponding capability grant (`consultingAdmin.js:7–19`). The same stats response includes financial totals (`adminConsultingController.js:598`) while invoice reads correctly use `view_financials`. This creates an inconsistent financial-read boundary within consulting, requiring an explicit intake-versus-finance response policy.

### Expansion failure scenario

A global campaign creates 4,000 inquiries. Staff search only the newest 200, then assign a consultant who has stopped taking work since the dropdown loaded. The request becomes “scheduled,” but payment cannot proceed because no scheduled-session record exists. Other teams interpret scheduled counts as booked capacity and plan staffing against inaccurate demand.

### Required changes and operator design

Connect existing server search/paging to the dashboard. Define one canonical consultant identity contract and an assignment command with expected version, active eligibility, capacity check, and audit. Assignment should create an assigned intake state; scheduling should use the reservation service. Separate operational aggregates from protected financial totals. Introduce contact tasks and next-contact deadlines, linked to appointment and delivery records without duplicating their services.

### Operator design recommendations

Retain the current dashboard and detail modal, but put team/market scope, intake date range, and snapshot time in the header. Replace blended conversion figures with pending unassigned inquiries, first contact overdue, assigned awaiting booking, and confirmed appointments. Define contact overdue from an explicit contact deadline; “scheduled” must mean a canonical reservation exists.

The queue needs inquiry ID, client/business, tier, help areas, age, contact state, assigned specialist, eligibility warning, next contact date, and appointment link. Move search and tier/status filters to the server; add language, specialty, assignment, and contact deadline. Save “Unassigned: specialist needed” and “Contacted: booking missing” views across the full dataset.

The drawer should show intake answers, contact attempts, consultant eligibility/capacity, assignment history, and linked scheduling/payment/delivery status. Mark contacted requires a recorded attempt or reason; assign previews specialist fit and current workload. Archive previews unfinished contact and booking tasks and requires a reason. Allow bulk task assignment, not bulk scheduling or irreversible closure.

On a capacity/version conflict show refreshed candidates and preserve the operator's notes. A committed assignment followed by communication failure stays assigned with a delivery-retry task. Empty means no matching inquiries, with clear filter reset; no access identifies intake capability; unavailable consultant data leaves the inquiry readable but disables assignment. Mobile cards prioritize overdue contact and booking gaps. Replace clickable-only actions with labeled keyboard buttons, use logical drawer placement for RTL, and isolate client email and appointment IDs from surrounding translated text.

### Acceptance tests and owner

Consulting Intake Operations is accountable; Consulting Workflow Engineering owns the record contract. Find an inquiry older than the newest 200 through search and saved views. Assignment must not increment confirmed appointments until booking succeeds. A consultant deactivated after list load cannot receive an assignment; competing assignments return a version conflict. An intake-only admin must not receive financial totals. Verify assignment-to-booking-to-payment-to-delivery identifiers remain consistent through the complete synthetic workflow, with contact and archive reasons retained.

## 25. Consulting Pay

### Route and business purpose

`/admin/consulting/payments` combines package configuration, purchases, invoices, and manual billing. It should distinguish package price, purchased entitlement, collected money, invoice delivery, and refund outcome. These concepts currently share a screen but are not one interchangeable accounting record.

### Verified current implementation

`client/src/admin/pages/ConsultingPayments.jsx:205` has abortable loading. Current invoice generation and package writes require `manage_operations` at `server/routes/consultingAdmin.js:24` and `:30`; financial reads require `view_financials` at `:26–28`. Consulting refunds now require `issue_refunds` at `server/routes/consultingPayment.js:18`, repairing the prior role-only allegation. `server/controllers/consultingPaymentController.js:54` checks payment ownership; `:107` uses a deterministic provider key. `:186` validates paid amount/currency before completion. Migration `622_audit_remediation_ws3.sql:19` establishes the active-payment uniqueness backstop; `599_consulting_payment_terminal_integrity.sql:10` protects refunded state. `server/__tests__/ws3-consulting-chat.test.js:90` covers intent idempotency and guarded insertion.

### Concrete flaws and gaps

**T25-1 — CONFIRMED DEFECT, high:** manual invoice recipient identity is transient. `server/controllers/adminConsultingController.js:664` accepts client name/email, but the INSERT at `:689` stores neither those fields nor a linked user/purchase. They appear only in the immediate response/email. Later listing at `:643–648` derives identity through `ci.user_id`; a manual invoice created by this path cannot recover its recipient from that relation. This is loss of billing context, not merely a cosmetic missing column.

**T25-2 — CONFIRMED DEFECT, medium:** purchase and invoice history are silently capped. `adminConsultingController.js:627` limits purchases to 100 and `:650` invoices to 200 with no continuation. `ConsultingPayments.jsx:211–212` loads those collections as the screen's history. An older unpaid invoice or disputed purchase becomes inaccessible through this page.

**T25-3 — CONFIRMED DEFECT, high:** deactivating a package does not prevent payment by known package ID. Public selection checks activity at `consultingPaymentController.js:13`, but intent creation selects by ID alone at `:80–83`, then uses its price. The administrator's inactive toggle is therefore a discovery restriction, not an enforced sales restriction.

**T25-4 — DESIGN GAP, medium:** package writes lack server price/unit validation and synchronized field semantics. `adminConsultingController.js:783–792` accepts base price directly and maps `session_count` into `duration_hours`. Migration `109_consulting_payments.sql:19` initially copies legacy name/price into newer columns, while purchase history selects legacy package `name` at `adminConsultingController.js:622`. Editing package name/base price does not establish that every consumer sees the same commercial revision.

### Expansion failure scenario

Consulting sales issue thousands of manual invoices and retire an obsolete package. Older invoices drop off the page, recipient information cannot be reconstructed from invoice rows, and a cached package identifier still creates payment intents. Finance cannot reliably reconcile invoice-to-customer-to-entitlement across the enlarged program.

### Required changes and operator design

Persist invoice recipient snapshots and package revision/currency; require an idempotency identity and reject same-key/different-payload reuse. Page full purchase/invoice history with customer/status/date search. Validate effective package activity and integer cents during intent creation. Define sessions versus hours separately, synchronize commercial fields or expose one canonical schema, and append package release history. Reuse existing provider settlement/refund safeguards and link invoice delivery failures to an accountable retry task.

### Operator design recommendations

Retain the three working areas but give Packages, Purchases, and Invoices independent loading and access states; the current combined Promise.all makes one unavailable collection block everything. The header should declare consulting currency, billing period, and each collection's snapshot time. KPIs should distinguish collected net funds, unsettled provider attempts, unpaid invoices past due, and remaining purchased sessions; define them from authoritative records, not visible rows.

Package rows need ID/revision, name, active selling state, integer-cent price/currency, included session count, duration, and effective date. Purchase rows need client, entitlement, collected amount, usage balance, and refund state. Invoice rows need durable recipient, number, issued/due dates, balance, and delivery outcome. Add exact invoice/payment/customer search, package and due-age filters, and saved “Overdue: undelivered” and “Refund pending” views.

A drawer should join recipient snapshot, package terms, purchase allocation, provider events, invoice revisions, and delivery attempts. Package edits preview commercial changes; manual invoice creation previews recipient and amount before reserving its request ID. Refund confirmation uses freshly read provider settlement and remaining capacity. Bulk billing is a reviewed job with per-recipient preview; bulk refund is excluded.

On timeout, recover the original invoice/refund by request identity. On package conflict retain the draft against the new revision. An empty invoice filter explains the due-date window; no-access states separately identify finance-read and package-write grants; delivery/provider unavailable leaves persisted billing evidence readable. Mobile places recipient/amount/due state first, with labeled tab controls and keyboard dialogs. RTL keeps invoice numbers and currency amounts isolated while retaining translated billing labels.

### Acceptance tests and owner

Consulting Finance Operations owns billing truth; Consulting Payments Engineering owns package and invoice contracts. Create a manual invoice and reload it: recipient and package terms must survive. Find invoice 201 and purchase 101 through paging. An inactive package must reject intent creation even by direct ID. Negative/fractional cents and ambiguous sessions-versus-hours writes must fail validation. Concurrent invoice replay produces one durable invoice and rejects changed payload. Retain existing refund-grant and provider amount/currency tests; add separate-screen unavailable-state tests so a package outage does not hide invoice evidence.

## 26. Scheduling

### Route and business purpose

`/admin/consulting/scheduler` is the staff calendar and pending-booking workbench. It should reserve an eligible consultant's actual time, communicate a confirmed appointment, and preserve rescheduling history. A date placed on an intake record is insufficient to prove a calendar reservation or entitlement to paid service.

### Verified current implementation

`client/src/admin/pages/ConsultingScheduler.jsx:338` loads requests and consultants with cancellation; `:109` converts selected local date/time to an ISO timestamp. Availability and booking APIs already exist under `/api/scheduling` (`server/routes/consultantScheduling.js:7–19`). `server/controllers/consultantSchedulingController.js:251` checks session ownership for non-admin booking, `:260` applies consultant platform approval for non-admin callers, and `:280` checks available slots. Its conditional write at `:304` checks overlapping scheduled sessions. Migration `107_consultant_availability.sql:68` defines available-slot calculation; `103_consulting_all_phases.sql:46` supplies scheduled records. These capabilities should be integrated, not rebuilt as another calendar.

### Concrete flaws and gaps

**T26-1 — CONFIRMED DEFECT, high:** the admin scheduler bypasses the existing booking service. Its submit at `ConsultingScheduler.jsx:110` PATCHes request status and `scheduled_at`, handled by `adminConsultingController.js:551–557`. That path performs no availability/overlap check and creates no scheduled-session record. The guarded `/scheduling/.../book-slot` path exists, but this screen does not call it.

**T26-2 — CONFIRMED DEFECT, high:** navigating weeks does not query the requested week. `ConsultingScheduler.jsx:340` loads the newest 200 inquiries once; `:356–358` merely changes local week state. An older intake with a current appointment can be absent from the calendar. There is no calendar-range response establishing completeness.

**T26-3 — CONFIRMED DEFECT, medium:** “Send calendar invite” sends the reminder handler. `server/routes/consultingAdmin.js:41` routes `/send-invite` to `sendSessionReminder`; `adminConsultingController.js:826–830` builds a plain HTML reminder, with no calendar artifact in that invocation. The button's outcome is misnamed. It also reads persisted session fields, not unsaved modal values (`ConsultingScheduler.jsx:126–129`).

**T26-4 — DESIGN GAP, medium:** time interpretation follows the operator's browser rather than an explicit appointment timezone (`ConsultingScheduler.jsx:109`, `:247`). Meanwhile booking defaults to America/New_York at `consultantSchedulingController.js:315`. Those are different contracts. A global dispatcher can schedule the wrong instant even when each conversion is locally valid. Real multi-transaction overlap safety requires database concurrency verification; the NOT EXISTS check alone is not certification.

### Expansion failure scenario

Dispatchers in New York and Dubai schedule the same specialist during a peak week. Both admin writes succeed because they bypass reservation checks. Their local time inputs refer to different instants, and the calendar may omit a client whose original inquiry is older than the latest 200. Customers receive reminder emails marketed as invitations without a durable booking.

### Required changes and operator design

Add a bounded calendar-range API based on canonical reservations, then route staff booking/rescheduling through the existing slot service with appropriate operational authority. Store timezone, UTC instant, duration, consultant user/record identity, and parent session ID explicitly. Enforce overlap invariants across simultaneous transactions. Implement versioned reschedule/cancel commands with communication outbox and a real calendar artifact; otherwise relabel the action reminder. Keep ownership, approval, and available-slot checks, extending documented admin overrides with reason and history.

### Operator design recommendations

The header should expose calendar timezone, week/date range, consultant/team scope, and reservation snapshot time. Replace request-count cards with unbooked inquiries awaiting scheduling, confirmed hours/capacity, conflicts needing action, and invitations not delivered. A reservation counts confirmed only when the canonical record exists.

Use consultant columns or lanes in the week view, plus an accessible agenda alternative. Each event shows client, start/end, timezone, booking status, payment prerequisite, and invite outcome. The unscheduled queue shows inquiry ID, preferred dates, language, tier, eligible specialists, and waiting age. Server filters should cover consultant, region, booking status, date range, and missing payment/communication; save “Next 48 hours: invite missing” and “Unbooked: preferred date passed.”

The scheduling drawer should show client preference, consultant availability, eligibility, entitlement, proposed slot, and reschedule history. Pick an actual returned slot instead of a free-form time alone. Confirmation previews client/consultant timezone renderings, duration, replaced reservation, and invitation recipient. Bulk task assignment and reminder preparation are allowed; bulk booking without individual slot reservation is not.

On slot conflict refresh alternatives without discarding contact notes. A booking committed but email failed remains confirmed with a retryable invitation task. Empty weeks say no reservations in that range; no-access distinguishes calendar read from scheduling authority; availability unavailable disables confirmation while retaining existing appointments. Mobile defaults to agenda, not a compressed seven-column grid. Events become keyboard buttons with readable time ranges, translated weekday labels, and deliberate RTL chronological navigation.

### Acceptance tests and owner

Consulting Dispatch owns schedule policy; Scheduling Engineering owns reservations. An intake outside the latest 200 must appear in its appointment week. Two concurrent bookings of an overlapping slot must yield one reservation and one typed conflict. Test DST gaps/repeated times and dispatchers in different browser zones: persisted UTC and client rendering must agree. A real invitation contains the confirmed slot and calendar artifact; failed delivery remains visible without cancelling booking. Verify staff scheduling creates the scheduled record required by payment and completion.

## 27. Business Launch

### Route and business purpose

`/admin/consulting/business-launch` manages founder intake, implementation phases, local consultant referrals, notes, and customer communication. It should explain what setup work is committed, who owns each deliverable, and whether the founder is waiting for a consultant, a document, or a decision. Referral estimates are not proof of collected money or regulatory completion.

### Verified current implementation

`client/src/admin/pages/BusinessLaunchAdmin.jsx:105` performs abortable server paging with country, state, urgency, package, status, and search. `server/routes/businessLaunch.js:57–82` protects list, detail, status, and assignment with `manage_operations`; messaging separately requires `message_users` at `:111`. `server/controllers/businessLaunchController.js:364` locks the request during assignment; `:404` checks referral capacity and `:409` minimum package value. `:451` records referral history. Status changes write an audit row transactionally at `:558`. Migration `248_consultant_contractor_network.sql:5` defines coverage, capacity, and revenue-cut fields. Existing notes and request detail are real workflow foundations.

### Concrete flaws and gaps

**T27-1 — CONFIRMED DEFECT, high:** the joined list query uses ambiguous columns. `businessLaunchController.js:204–216` selects unqualified `email`, `created_at`, and `updated_at`; the FROM at `:217–219` joins users and contractor profiles, which share those names. Search at `:185` similarly leaves first name/last name/email unqualified. PostgreSQL cannot resolve these against the joined relations. The separate count query can succeed while the actual list fails. Contractor timestamps are explicitly present in `248_consultant_contractor_network.sql:24`.

**T27-2 — DESIGN GAP, high:** assignment locks one request, not shared consultant capacity. `businessLaunchController.js:374–385` reads the consultant without a capacity lock, then counts active referrals at `:396`. Two transactions assigning different requests can both observe one remaining slot. The existing capacity check is valuable but does not serialize this shared-resource decision.

**T27-3 — DESIGN GAP, high:** status updates validate values but not transitions or content version. `businessLaunchController.js:521` defines allowed statuses; `:535` reads without locking and `:551` updates by ID alone. Staff can advance to completed without checked phase evidence or overwrite a concurrently cancelled state. Audit is present; it records the command without guaranteeing the prerequisite business outcome.

**T27-4 — CONFIRMED DEFECT, medium:** CSV export covers the current page while the UI displays total matching requests. `BusinessLaunchAdmin.jsx:146` maps only `requests`, a 20-row page from `:106`. Quotes are escaped at `:157`, but spreadsheet formula prefixes are not neutralized. This is a source-level export safety/completeness limitation, not an allegation about an actual exported malicious row.

### Expansion failure scenario

A founder program opens in twelve countries. List retrieval fails on its joined projection; assignments arriving through other flows overfill a popular specialist. A stale quick-status action marks a request completed despite outstanding launch tasks. A manager exports twenty visible rows believing they represent the whole selected program.

### Required changes and operator design

Qualify projection/filter columns and share predicates between count/list. Reserve consultant capacity transactionally with an agreed eligibility policy. Add phase prerequisites, expected versions, and explicit reversal/archival transitions. Provide safe paged/full export jobs with clear scope and CSV neutralization. Connect referral history, delivery tasks, consultant capacity, messaging outcomes, and package financial records; label cuts as estimates until settlement exists.

### Operator design recommendations

Preserve the existing country/state filters but display authorized market scope, query snapshot, and program/package revision in the header. KPIs should count unassigned founders, first-contact deadlines missed, kickoff booked, blocked implementation deliverables, and ready-for-launch requests. Derive readiness from accepted required deliverables rather than a manually selected completed status.

Queue columns should include founder/business, request ID, market, package, urgency, phase, consultant acceptance, next milestone/deadline, blocking reason, and last customer response. Add assignment/capacity, overdue milestone, missing evidence, and language filters. Save “Kickoff pending: referral not accepted” and “Implementation blocked: founder response needed.” Export must offer explicitly labeled current page or complete filtered job.

The drawer should have intake and scope, phase checklist with evidence, consultant referral/cut preview, founder communications, internal notes, and decision history. Assignment previews live capacity, coverage fit, and estimated cut; phase completion previews required deliverables and unresolved blockers. Archive requires a disposition and previews live tasks. Bulk assignment of operations tasks is permitted; consultant referrals and final completion remain individually reviewed.

On capacity conflict return refreshed matched consultants. On stale phase changes show new evidence/status and preserve the draft note. Message failure creates a retry task without changing implementation completion. Empty says no founders match market/phase; no access distinguishes operations from message capability; unavailable referral matching leaves intake and notes readable. Mobile uses a milestone card and full-screen checklist. Ensure keyboard checklist navigation, clearly separate internal/customer notes, and isolate country codes and monetary estimates in RTL.

### Acceptance tests and owner

Founder Program Operations owns phase acceptance; Contractor Operations owns capacity. Run actual PostgreSQL list/search fixtures with users and profiles: no ambiguous-column errors and matching totals. Concurrent assignment at one remaining slot must admit exactly one request. Completion without required accepted evidence must fail. A stale status update returns 409 and preserves audit truth. Export all filtered rows with explicit count, neutralize formula prefixes, and verify twenty-row page exports are labeled. These tests are proposed; no dedicated Business Launch end-to-end proof was established by inspected test source.

## 28. Consulting Sessions

### Route and business purpose

`/admin/consulting/sessions` oversees consulting delivery, completion, no-shows, notes, and follow-up. Operators need a consistent view of promised appointment, actual attendance, deliverables, customer action items, and purchased entitlement consumption. The same client may also have founder-program work; that dependency should be linked rather than conflated with this session's completion.

### Verified current implementation

`client/src/admin/pages/ConsultingSessionsAdmin.jsx:223` provides abortable server paging/search. Completion and cancellation use confirmation dialogs at `:244`; failures are rethrown to keep confirmation open. `client/src/admin/pages/ConsultingSessionDetail.jsx:27` resets state when sessions change, repairing cross-session note/consultant bleed. `server/routes/consultingAdmin.js:33–40` exposes list/detail, completion, no-show, and communication. `server/controllers/adminConsultingController.js:191` lists the main session table; `:267` exposes detail. Scheduled attendance is separately stored in `server/migrations/103_consulting_all_phases.sql:46`, and follow-up tracking is extended by `106_consulting_session_followups.sql`. Existing action-item integration should remain.

### Concrete flaws and gaps

**T28-1 — CONFIRMED DEFECT, high:** completion changes a different table from the one displayed. `adminConsultingController.js:403` finds a scheduled record, and `:415` updates only `consulting_sessions_scheduled`. The list at `:232` still reads `consulting_sessions`, so a successful complete action can reload a still-scheduled row. No-show at `:460` has the same split. Sessions created manually at `:501` without a scheduled record cannot complete through this handler at all.

**T28-2 — CONFIRMED DEFECT, high:** the detail assignment dropdown returns consultant record IDs but writes a user UUID field. Consultant listing projects `c.*` at `adminConsultingController.js:104`; `ConsultingSessionDetail.jsx:50–51` sends the selected value as `consultant_assigned_id`. Its options must be reconciled with `consulting_sessions.consultant_assigned_id`, defined as UUID referencing users (`102_consulting_sessions.sql:49`). The intake assignment path uses the separate `consultant_id` reference. These identifiers require explicit normalization.

**T28-3 — DESIGN GAP, high:** completion/no-show lack current-state conditions and delivery evidence. UPDATE predicates at `adminConsultingController.js:417` and `:463` are only scheduled-record ID. Generic detail writes at `:316` also accept status without the validated transition contract used by another handler. Confirmation guards user intent but cannot prevent stale attendance changes or prove delivered service.

**T28-4 — DESIGN GAP, medium:** follow-up claims have no delivery history in this command. `adminConsultingController.js:845–860` sends a generic email without an idempotency identity or persisted follow-up attempt; no email still reaches the success response. Completion promises an automatic follow-up at `:429`, while this admin view exposes no accountable delivery outcome or retry task. Existing follow-up workers are not presumed absent; their integration into this screen remains unproven.

### Expansion failure scenario

Several hundred specialists finish sessions after a global training campaign. Attendance writes succeed, but the main list remains scheduled. Supervisors mark the same items again, and support sends duplicate follow-ups. A manually created session has no scheduled record and fails completion. Purchased entitlement usage and customer communications cannot be reconciled from this screen's status.

### Required changes and operator design

Use one versioned attendance/completion command that synchronizes canonical session and reservation state transactionally. Require permitted source state, actual attendance/deliverable evidence, and entitlement linkage. Normalize consultant record/user IDs in API responses and writes. Persist communication attempts with stable intent IDs and retry status. Keep the existing per-session state reset and confirmation dialogs, adding detail freshness rather than rebuilding them.

### Operator design recommendations

The header should display delivery team, scheduled/completed date basis, and snapshot freshness. KPIs should count sessions due today, attendance undecided after end time, completed with outstanding deliverables, no-shows awaiting disposition, and failed follow-ups. All derive from reconciled reservation/delivery records rather than the main table's status alone.

Rows need session/client, consultant, tier, scheduled interval, attendance, deliverable completion, entitlement usage, next action, and communication outcome. Add filters for specialist, appointment date, attendance pending, deliverable overdue, and follow-up failed alongside current search. Save “Ended: attendance missing” and “Completed: action items outstanding.”

The drawer should separate appointment/payment prerequisites, attendance evidence, deliverables/action items, internal notes, customer-visible summary, and communication history. Completion requires an outcome and delivered-item checklist; no-show requires attendance evidence and customer disposition; cancellation previews appointment and financial dependencies. Consultant reassignment previews identity and reservation consequences. Allow bulk follow-up task assignment or preparation, while completion/refunds remain individual evidence-based commands.

A split-record conflict shows both authoritative states and a reconciliation task. A failed completion retains its evidence draft; a delivery timeout retrieves the previous communication intent rather than sending again. Empty means no sessions for the selected delivery window; no-access distinguishes viewing from attendance commands; payment/communication unavailable preserves delivery notes and blocks dependent actions. Mobile focuses on today's appointments and outstanding deliverables. Use keyboard-accessible tabs and confirmation focus management; keep time intervals and consultant IDs stable in RTL.

### Acceptance tests and owner

Consulting Delivery Operations owns attendance/deliverable policy; Workflow Engineering owns reconciliation. Completion must update list, reservation, and entitlement view consistently, exactly once. A manual session must be scheduled or return an explicit prerequisite error before completion. Test consultant record-to-user mapping with realistic distinct IDs. Concurrent complete/no-show commands must yield one accepted transition and one 409. Follow-up without a recipient must not report delivery; replay must not duplicate email intent. Confirm existing per-session state reset still prevents notes from leaking between drawers.

## 29. Org Chart

### Route and business purpose

`/admin/corporate/org-chart` should let leadership and People Operations understand accountable reporting relationships across countries. Its current implementation is a department/title directory, not a reporting-line graph. That distinction matters when finding the person responsible for a country incident or an unstaffed department.

### Verified current implementation

The API already requires both an administrator and `manage_admin_accounts`; it is not an unguarded employee directory (`server/routes/corporateRoles.js:44`). The controller includes global assignments when a country is selected, returns reporting-manager IDs, groups assignments by department, and also returns the entire flat dataset (`server/controllers/corporateRolesController.js:787`, `server/controllers/corporateRolesController.js:792`, `server/controllers/corporateRolesController.js:809`). The UI instead groups by seniority (`client/src/admin/pages/super/CorporateOrgChart.jsx:41`). Migration 246 stores manager references and assignment start/end timestamps (`server/migrations/246_corporate_hierarchy.sql:485`). Corporate assignment data also feeds effective corporate permissions; this screen must not imply that a displayed title is equivalent to an admin grant.

### Concrete flaws and gaps

- CONFIRMED DEFECT: country requests can resolve out of order. Every keystroke changes the query, but `load` has neither cancellation nor a request-generation check before `setChart`; an earlier country's response can overwrite the newer selection (`client/src/admin/pages/super/CorporateOrgChart.jsx:116`, `client/src/admin/pages/super/CorporateOrgChart.jsx:133`, `client/src/admin/pages/super/CorporateOrgChart.jsx:153`).
- DESIGN GAP: reporting edges are available but unused. Seniority groups do not establish who manages whom, and the page provides no manager traversal or orphan-manager exception view (`client/src/admin/pages/super/CorporateOrgChart.jsx:41`, `server/controllers/corporateRolesController.js:792`).
- DESIGN GAP: “active” means assignment active only. The query does not filter inactive users, titles, departments, or future assignment starts; `total_assignments` is not distinct employee headcount (`server/controllers/corporateRolesController.js:784`, `server/controllers/corporateRolesController.js:790`, `server/controllers/corporateRolesController.js:831`). Whether background lifecycle processes keep these flags synchronized is UNVERIFIED; the read path itself makes no such guarantee.
- CONFIRMED DEFECT: initial API failure can display both an error and the empty-directory state, because null chart data enters the same branch as zero assignments (`client/src/admin/pages/super/CorporateOrgChart.jsx:159`, `client/src/admin/pages/super/CorporateOrgChart.jsx:169`).

### Expansion failure scenario

With 3,500 employees holding multiple country/global assignments, a director switches markets during an incident and sees a stale directory under the new country label. A seniority grouping suggests authority but cannot reveal that the responsible manager has left. Duplicate assignments inflate apparent coverage while an operational reporting gap remains hidden.

### Required changes and operator design

Extend `GET /org-chart` with department/search/cursor options, explicit snapshot time, distinct-person and assignment counts, and lifecycle exceptions. Provide bounded manager-subtree retrieval rather than transmitting both full grouped and flat copies. Define whether inactive/future assignments belong in an exception view. Sequence client requests; label retained results stale after failure. Keep assignment mutation in the separately governed Titles workflow.

### Operator design recommendations

Use a header containing selected country, whether global assignments are included, department scope, and the server's snapshot time. Offer two explicitly named modes: “Reporting relationships” and “Title directory.” This resolves the present seniority-only visualization without pretending that incomplete reporting data can produce a trustworthy tree. KPI cards should show distinct active people, active assignments, positions without a manager, and inactive-person assignments; define their denominators in tooltips.

Place a searchable country selector and department/person/title filters above a bounded directory. Columns should be person, title, department, assignment geography, named reporting manager, effective start, and lifecycle exception. Save views such as “Country leadership including global roles” and “Manager references needing repair.” In graph mode, expand one manager subtree at a time and include a text-table equivalent, not a mandatory pan-and-zoom canvas.

Selecting a person opens a drawer with all assignments, reporting chain, subordinate counts, source validity warnings, and recent assignment changes. Row actions are view manager, open assignment history, and request a correction through Corporate Titles. Bulk actions may create reconciliation tasks for selected exceptions, with a preview of assignment IDs and assigned People Operations reviewer; they must not silently change managers or permissions.

If a country response is stale, freeze its scope label and offer reload. Empty means no matching valid assignments; unavailable means directory retrieval failed, never “no employees.” No-access should explain the restricted directory capability without revealing employee records. On mobile, show a searchable reporting-chain list. Keep names readable in either direction, use logical indentation in RTL, and expose department expansion state to keyboard and screen-reader users.

### Acceptance tests and owner

People Operations owns reporting-data definitions; Corporate Identity Engineering owns implementation. Resolve country responses in reverse order and require the final selection's data and label to agree. Seed multiple assignments for one person and verify distinct headcount versus assignment count. Cover a future start, inactive user, missing manager, and cross-country/global manager. Initial 503 must render unavailable without an empty-workforce assertion. A 3,500-person fixture must support bounded directory/subtree retrieval and keyboard traversal. These are proposed acceptance tests, not measured production capacity.

## 30. Corporate Titles

### Route and business purpose

`/admin/corporate/assignments` administers internal titles, their geographic scope, reporting managers, and permission overrides. It is an access-affecting personnel workflow, not merely an org-chart label editor. Corporate permissions and ordinary admin capability grants are explicitly independent (`server/services/corporateRolesService.js:13`); operators need both meanings explained.

### Verified current implementation

Assignment writes and overrides require `manage_admin_accounts` (`server/routes/corporateRoles.js:38`, `server/routes/corporateRoles.js:41`). Creation checks an active internal-staff target, active title, C-suite restrictions, and caller seniority, then writes an audit record inside its transaction (`server/controllers/corporateRolesController.js:413`, `server/controllers/corporateRolesController.js:449`, `server/controllers/corporateRolesController.js:504`). Updates lock the current assignment (`server/controllers/corporateRolesController.js:541`). The current list uses abortable requests and explicit end-assignment confirmation; those features exist (`client/src/admin/pages/super/CorporateAssignments.jsx:295`, `client/src/admin/pages/super/CorporateAssignments.jsx:321`). Migration 246 supplies assignment and override persistence rather than a client-only role registry.

### Concrete flaws and gaps

- CONFIRMED DEFECT, access-sensitive: the override anti-escalation check only examines entries whose effect equals exactly `allow`, but persistence converts every non-`deny` value into `allow`. An authorized lower-level admin can submit an unsupported effect for a known permission they do not hold, bypass the intended check, and persist an allow override, provided the other assignment-management guards pass (`server/controllers/corporateRolesController.js:715`, `server/controllers/corporateRolesController.js:743`). This concerns corporate permission escalation, not automatic possession of all ordinary admin grants.
- CONFIRMED DEFECT: assignment retrieval stops at 500, returns no continuation/total, and the page accepts that array as the complete list (`server/controllers/corporateRolesController.js:364`, `client/src/admin/pages/super/CorporateAssignments.jsx:309`). The 501st matching assignment cannot be reached through pagination.
- DESIGN GAP: manager validation checks existence only on creation; there is no self-reporting/cycle or active-staff validation, while update accepts a manager reference without repeating even that application-level check (`server/controllers/corporateRolesController.js:480`, `server/controllers/corporateRolesController.js:578`). The foreign key protects referential existence, not reporting integrity.
- DESIGN GAP: a row lock serializes writes but does not reject a stale editor. Update has no expected revision predicate and can overwrite a newer country, manager, or note (`server/controllers/corporateRolesController.js:562`, `server/controllers/corporateRolesController.js:572`).

### Expansion failure scenario

Regional administrators concurrently reorganize several hundred positions. The capped list hides older assignments, stale forms reverse manager changes, and an unsupported override effect turns an intended anti-escalation boundary into a bypass. Org Chart then reflects a misleading structure while downstream corporate-gated functions use the altered permissions.

### Required changes and operator design

Reject unknown override effects before any authorization or deletion, validate known codes atomically, and evaluate the validated canonical payload. Preserve existing seniority/C-suite safeguards. Add assignment revision checks, bounded cursor retrieval, manager-graph validation, and an effective-permission preview endpoint showing both corporate effects and separately managed admin grants. Do not silently replace unknown-code overrides with an incomplete set.

### Operator design recommendations

The header should identify personnel scope, active-versus-ended mode, and last fetched revision. KPI cards should count distinct staff, active assignments, overrides expiring soon, and reporting-integrity exceptions, using server totals beyond the existing 500-row cap. Search staff identity alongside department, title, country/global scope, regional boundary, assignment status, and override presence. Saved views should include “Acting appointments expiring” and “Assignments with exceptional permissions.”

The list needs staff, title/seniority, department, geography, manager, start/end dates, override count, and latest actor. Open a drawer with personnel eligibility, assignment details, reporting chain, permission inheritance, and audit history. Its permission tab must show the proposed before/after effective corporate set and clearly separate ordinary admin grants. Conflicting assignments should be surfaced rather than hidden behind a single title badge.

Allow create, edit scope/manager, end assignment, and replace overrides only when the existing capability and seniority rules permit them. Every access-changing preview identifies newly allowed codes, removed denies, geographic changes, affected employee, and reason. C-suite controls should visibly require the super-admin path. Bulk manager transfer may be proposed with cycle validation and per-row results; bulk permission grants require a distinct reviewed workflow, not list checkboxes plus immediate save.

A stale drawer must present the competing revision and preserve the operator's proposed changes for comparison. Region-service failure must disable region selection with a retry notice, not look like no regions exist. Empty means no matching assignments; no-access must not reveal the staff catalog. Mobile should use labeled assignment cards with a full-screen permission comparison. Make allow/deny states textual, keyboard-selectable, and RTL-safe; never communicate privilege changes through color alone.

### Acceptance tests and owner

Identity/Security Engineering owns the override fix; People Operations owns assignment policy. Submit `ALLOW`, null, and arbitrary effects as a non-super admin lacking the target permission: all must return 400 with no override or audit mutation. Retest valid allow denial and legitimate deny. Traverse 501+ assignments without loss. Reject self-manager, inactive external manager, and a two-person cycle. Concurrent edits must produce one success and a 409 requiring re-preview. Verify an ended assignment stops contributing corporate permissions after the documented cache-invalidation boundary. No dedicated corporate suite was identified in the inspected test filenames; these checks remain required, not claimed passing.

## 31. Logistics Ops

### Route and business purpose

`/admin/logistics` is the operational entry point for sourcing, pooled procurement, purchase orders, shipments, warehouse receiving, claims, and compliance. It currently provides navigation and aggregate status counts, rather than a dispatcher work queue. Financial outcomes depend on the linked procurement, pricing, refund-case, and landed-cost workflows.

### Verified current implementation

The server mounts this API behind authentication (`server/index.js:525`). Stats require the operations workspace, whose middleware rechecks active database approval and route-specific access for non-admin staff; admin roles explicitly bypass that workspace check (`server/routes/logisticsAdmin.js:39`, `server/middleware/requireInternalLogisticsWorkspace.js:54`, `server/middleware/requireInternalLogisticsWorkspace.js:63`). Pricing writes now require super-admin, and request admin flags derive from the authenticated role (`server/routes/logisticsAdmin.js:28`, `server/routes/logisticsAdmin.js:122`). The client has abortable loading and a retry state (`client/src/admin/pages/logistics/LogisticsAdminDashboard.jsx:68`, `client/src/admin/pages/logistics/LogisticsAdminDashboard.jsx:97`). Existing lifecycle validators and migration 605 protect purchase-order state transitions; `server/__tests__/moneyStateIntegrityMigrations.test.js:67` checks the encoded graph. Buyer trade restrictions fail closed on evaluation error, but are not staff-scope controls (`server/services/logisticsAccessService.js:39`, `server/services/logisticsAccessService.js:163`).

### Concrete flaws and gaps

- CONFIRMED DEFECT: “active receipts” includes every warehouse receipt, including closed ones. The displayed label is active, but the aggregate has no status predicate (`client/src/admin/pages/logistics/LogisticsAdminDashboard.jsx:112`, `server/controllers/logisticsAdminController.js:43`). Migration 247 explicitly gives receipts lifecycle status (`server/migrations/247_oxsteed_logistics.sql:652`).
- DESIGN GAP: all six stats queries are global, without country, lane, warehouse, time-window, or staff-assignment scope (`server/controllers/logisticsAdminController.js:37`). Workspace admission is present; regional segregation inside this endpoint is not. Whether global visibility is an approved business policy is UNVERIFIED, not an asserted unauthorized-data exploit.
- DESIGN GAP: status counts contain no deadline, ETA breach, exception age, owner, or recoverable next action. The dashboard cannot prioritize a customs hold over an ordinary in-transit shipment (`client/src/admin/pages/logistics/LogisticsAdminDashboard.jsx:101`, `server/controllers/logisticsAdminController.js:40`).
- DESIGN GAP: navigation hides only the super-admin control tile; operations versus compliance and admin-only downstream capabilities are not represented (`client/src/admin/pages/logistics/LogisticsAdminDashboard.jsx:74`, `server/routes/logisticsAdmin.js:131`). Existing server rejection remains important, but the landing page promises “full control” beyond some users' allowed workspace.

### Expansion failure scenario

A regional dispatcher receives worldwide aggregate workload and navigates into inaccessible compliance screens. Closed receipts appear active while a shipment's customs deadline expires unnoticed. At six million users, procurement customer impact cannot be determined from status totals, and local operators cannot establish which incident deserves immediate escalation.

### Required changes and operator design

Extend stats with approved staff scope, documented receipt/on-hand definitions, and snapshot time. Add a paged exception endpoint joining PO, shipment, compliance, warehouse, and claim references with an accountable team and deadline. Reuse existing state machines and compliance approval commands rather than introducing generic “set status” actions. Keep global administrative scope explicit, not accidentally inferred from buyer-policy code.

### Operator design recommendations

The header should contain lane/market and depot scope, reporting interval, last refresh, and the operator's workspace. Replace the undifferentiated navigation grid with a compact capability-aware module menu and a primary “Needs intervention” queue. KPIs should count shipments past promised ETA, customs holds past review deadline, open receiving discrepancies, and unresolved claims past SLA. Label receipts as open receiving records or historical receipts according to the actual query; show on-hand inventory only from a stock model that accounts for outbound allocations.

Queue columns should include exception type, PO/shipment reference, supplier, origin/destination, current milestone, deadline/age, financial exposure currency, assigned operator, and blocking prerequisite. Filters cover lane, depot, exception category, supplier, priority, and assignment; saved views include “Customs deadline today,” “Receiving variance,” and “Supplier handoff overdue.”

A drawer should show the linked procurement-to-delivery chain, milestone evidence, customs documents, inventory variance, claim history, and customer impact. Row actions open the authoritative module, assign an investigation, request missing documents, or propose the next legal transition. Compliance release remains confined to the compliance route. Bulk assignment and reminder preparation require a selection preview and per-item outcomes; do not bulk clear customs or approve payments from aggregate cards.

On conflict, reload the milestone and explain which prerequisite changed. Partial module failure should mark that KPI unavailable rather than zero; retain unaffected queues with their freshness labels. Empty means no actionable exceptions in scope, while no-access explains the missing workspace. Mobile prioritizes deadlines and depot scanning links. Ensure status/priority text accompanies color, tables have readable headers, and RTL layouts preserve shipment references and origin-to-destination meaning.

### Acceptance tests and owner

Global Logistics Operations owns queue definitions; Supply Chain Engineering owns delivery. Closed receipts must be excluded from the active count. Seed two regions and prove each scope's totals and queue agree with its approved access policy. Revoke a staff workspace while its session remains valid and require rejection. Operations-only users must see an accurate capability menu and be denied compliance release. A PO prohibited transition must remain blocked by existing guards. Mock one unavailable source and require an unavailable KPI, not zero. Measure exception-query latency on realistic shipment history; existing migration tests do not establish operational throughput.

## 32. Learn Submissions

### Route and business purpose

`/admin/learn/submissions` reviews user-authored guides, community videos, and flagged videos. It is a publication and content-safety workspace: approved instructions and attached commercial tools reach the Learn catalog and connect to Product Links, AI Suggestions, and Tool Rentals. Guide review and video review have different current state models and must not be treated as equivalent.

### Verified current implementation

List, detail, and decision APIs require authentication, admin access, and `moderate_content` (`server/routes/learn.js:136`). Guide lists have bounded pagination and totals, and a separate full-detail endpoint exists (`server/controllers/learnController.js:417`, `server/controllers/learnController.js:436`). The client already uses abortable list requests and retains data on retry (`client/src/admin/pages/LearnSubmissionsAdmin.jsx:286`). Submission persistence includes full instructions, license notes, and reviewer metadata (`server/migrations/282_guide_submissions.sql:12`). Video decisions have an existing conflict test, and a bounded 24-hour publication worker exists (`server/__tests__/learnGuideVideos.test.js:297`, `server/controllers/learnController.js:1394`); those features should be extended, not rebuilt.

### Concrete flaws and gaps

- CONFIRMED DEFECT: the expanded guide receives the list summary, not the full-detail response. The list omits intro, steps, skills, tools, video, and license; expansion passes `sub` directly and never calls the available detail endpoint (`server/controllers/learnController.js:405`, `client/src/admin/pages/LearnSubmissionsAdmin.jsx:94`, `client/src/admin/pages/LearnSubmissionsAdmin.jsx:724`). Operators can approve without seeing the substantive instructions.
- CONFIRMED DEFECT: guide review neither locks/checks pending state nor requires a revision. It updates by ID alone, so concurrent or repeated approvals/rejections can replace a prior decision and approval can republish (`server/controllers/learnController.js:473`, `server/controllers/learnController.js:488`). The video conflict guard does not cover this guide path.
- CONFIRMED DEFECT: publication failure is swallowed behind a savepoint, yet approval commits and returns success with null `published_guide_id`; the client ignores that field and closes the review (`server/controllers/learnController.js:502`, `server/controllers/learnController.js:508`, `client/src/admin/pages/LearnSubmissionsAdmin.jsx:305`). An approved-but-unpublished recovery case is invisible.
- CONFIRMED DEFECT, latent detail-rendering path: tools iteration shadows translator `t` with a tool object, then calls that object for buy/rent labels (`client/src/admin/pages/LearnSubmissionsAdmin.jsx:169`, `client/src/admin/pages/LearnSubmissionsAdmin.jsx:175`). Once full tool data is supplied, linked tools trigger a render error.

### Expansion failure scenario

At six million users, moderation reviews summary cards while unsafe steps remain unseen. Two reviewers race, a guide's decision changes after publication, and a publish failure looks completed. The 24-hour video deadline makes queue visibility urgent; adding employees without a reliable review/recovery model increases throughput of mistakes, not safe publication.

### Required changes and operator design

Fetch full detail before enabling a guide decision. Add pending-state/revision enforcement, append-only decision records, and a durable publication intent with explicit failed/retry states and a stable submission-to-guide link. Correct the translator shadow. Preserve existing video and flag endpoints; add deadline and escalation fields to their queues, and test actual publication/decision concurrency rather than assuming mocked sequential tests prove it.

### Operator design recommendations

Use separate Guide Review, Video Deadline, Video Flags, and Publication Recovery tabs. The header should identify review language/category and freshness. KPIs count pending guides, videos nearing the 24-hour publication boundary, unresolved severe flags, and approved guides lacking successful publication; “approved” must not be a synonym for “live.” Add filters for language, category, submitter, risk classification, review assignment, and deadline, with saved views for “Unreviewed videos due soon” and “Approved: publication failed.”

Guide rows should show title, contributor, category, submission age, assigned reviewer, current decision, and publication outcome. The detail drawer must fetch and display full ordered steps, introduction, video preview, tool destinations, attribution/license note, and prior review/publication events. A persistent decision panel should require the relevant safety/licensing review evidence and make the content revision being approved visible. Video and flag drawers should display the affected guide, report reason, current playlist placement, and publication deadline.

Allow individual approve/reject with reason, video block/approve, existing flag dispositions, and retry of a failed publication intent. Bulk assignment and escalation are suitable; bulk approval of unseen content is not. Preview destructive video deletion and guide movement with affected catalog references. Keep decisions disabled while detail retrieval fails.

On 409, show the new decision and preserve an unsent note; on publication failure, leave a recoverable case rather than closing as success. Empty queues should name the selected content type and filters. No-access explains moderation scope without exposing submitter identities; unavailable detail must not look like an instruction-free guide. Mobile uses a full-screen readable step viewer and sticky decision controls. Keyboard focus, caption/transcript access, and bidirectional step numbering are necessary for multilingual moderation.

### Acceptance tests and owner

Content Safety owns review policy; Learn Engineering owns publication integrity. Assert expanding a summary fetches full detail and approval stays disabled until it succeeds. Render linked tool objects without errors. Race approve/reject and replay approve: one decision and at most one catalog publication must survive. Inject catalog failure and require a visible recovery case with successful idempotent retry. Preserve existing video conflict behavior and test worker/block overlap with a real transactional database. Accessibility acceptance includes keyboard review of a long RTL guide with captions and preserved draft notes.
## 33. Learn Product Links

### Business purpose and observed implementation

This registry changes the buying and rental destinations attached to learning guides without publishing a new mobile application. It is a commercial-content control, not an inventory reservation or evidence that a partner still sells the item. Moderation permission gates its endpoints (`server/routes/learn.js:162`). The admin UI supports link types, activation, guide/global overrides, compliance indicators and, in the final source refresh, shared typeahead. The API currently returns the complete matching collection (`server/controllers/learnController.js:616`); its public counterpart returns active overrides and substitutes an empty collection on query failure (`server/controllers/learnController.js:605`).

### Findings, expansion scenario and required changes

**P1 confirmed validation flaw:** affiliate-domain validation uses a regular-expression prefix rather than a parsed exact hostname (`server/controllers/learnController.js:660`). A hostname beginning with an allowed domain but continuing into an attacker-controlled suffix can satisfy that prefix. Update also validates selected changed fields, not the complete resulting record (`server/controllers/learnController.js:701`), so a type-only conversion can retain an incompatible old URL. Validate the merged record with URL parsing, approved protocols, exact host boundaries and a server-owned link-type contract. Do not equate a green client badge with legal compliance or availability.

**P2 evidence and scale gaps:** registry edits/deactivation/permanent deletion do not write an explicit admin audit event in these handlers. The permanent-delete option erases the record instead of preserving destination history (`server/controllers/learnController.js:744`). Bounded API search, pagination and revision-aware saves are required before thousands of guides and regional destination variants exist. The public empty fallback cannot distinguish a genuine empty registry from a failed refresh; clients need a versioned last-known catalog and an unavailable marker. A widespread bad override must be traceable to affected guides and reversible by a new version, not by deleting historical evidence.

### Operator design recommendations

Use a destination-review queue, with saved views for invalid destinations, newly changed links, missing disclosures, inactive items still referenced and overdue partner verification. Filters cover guide ID, global versus scoped override, link type, merchant domain, country, locale, status and last verification time. Rows show the product name, exact parsed host, guide coverage, active state, disclosure requirement, destination version, verification age and accountable editor. Keep the fully expanded destination in a selectable text field; shortening the visible host can conceal the very error the reviewer needs to detect.

Selecting a row opens a two-column drawer: stored configuration on one side and the actual customer-facing guide card on the other. Include source guide, global fallback, both buy/rent destinations and disclosure text. Mark “destination valid,” “partner availability unverified” and “inventory availability” as separate facts. Test-link navigation must be an explicit external action with safe opener handling; it must not automatically fetch arbitrary destinations from the server.

The save preview compares old and new URLs, type, scope and activation, lists impacted guide IDs and requires a reason for destination replacement. Deactivation remains available during a partner incident, while permanent deletion is withheld where evidence retention applies. Conflicting edits display the committed version without overwriting the operator draft. A timed-out save shows its command reference and a reload/status action before resubmission. On mobile, prioritize the parsed host and impact count rather than hiding them behind an overflow menu. Announce validation errors and provide keyboard access to every disclosure check.

### Acceptance, owner and closure evidence

Content Commerce owns the URL contract; Security owns adversarial hostname tests. Test suffix-host tricks, embedded credentials, unsupported protocols, invalid type-only conversions and conflicting edits. Test global/scoped precedence, old-version rollback, last-known refresh during outage and discovery of an item beyond the first page. Record one complete audited correction and verify web/mobile representations. Affiliate policy review belongs to the responsible business/legal owner; syntax tests cannot certify it.

## 34. Learn AI Suggestions

### Business purpose and observed implementation

This is a human review queue for generated tool, material and service suggestions. It already provides approve/reject controls rather than allowing the model to publish everything. Lists validate status and return the newest 200 suggestions (`server/controllers/learnController.js:956`). Approval locks the suggestion and checks pending state; tools also lock the guide before merging (`server/controllers/learnController.js:987`). Rejection has a conditional pending predicate (`server/controllers/learnController.js:1068`). These are useful existing concurrency protections, not missing functionality to rebuild.

### Findings, expansion scenario and required changes

**P1 confirmed publication-contract gap:** approved tool/material suggestions copy generated buy/rent destinations into the guide without the full Product Links URL/compliance validation (`server/controllers/learnController.js:1034`). Human approval does not make an unsafe protocol or misleading merchant destination safe. Apply the same server-owned destination rules to every publication path, including imported/generated records. For service suggestions, verify a real target guide and preview that approving the suggestion changes its category rather than merely attaching a service recommendation.

**P2 queue/evidence gaps:** there is no cursor or total in the 200-row response; an influx of recent suggestions can indefinitely hide old pending work. Stored reviewer/time is useful but not a complete revision/provenance history: retain model/config version, generating guide version, source record IDs, evaluated destinations, rejection reason and applied diff. Confidence is a model output, not a calibrated safety probability. Separate it from actual eligibility and evidence. Introduce duplicate clustering and revision staleness checks; a suggestion generated for an older guide must not silently overwrite a newer classification.

### Operator design recommendations

Create a review station with three explicit views: pending review, blocked by validation and decided history. Queue columns identify guide, suggestion kind, proposed object, current guide revision, generation age, source provenance completeness and validation outcome. Filters include oldest first, category, language, model/config version, invalid destination and duplicate group. Show backlog totals and oldest age from the entire authorized predicate, not merely the newest 200 loaded rows. Route batches to named reviewers, but do not provide approve-all for mixed unverified suggestions.

The detail panel places the current guide beside the proposed exact change. For a service, show the category before/after and downstream discovery effect. For tools/materials, show the precise new item, normalized destinations, duplicate detection and whether it refers to Direct equipment or peer rentals. Expand model rationale as untrusted text; it cannot instruct the operator or application to bypass a check. Confidence is labelled “model-reported,” while independently checked facts appear in a separate evidence list.

Approve opens a preview with guide version, suggestion ID and permitted publication effect. Missing or unsafe destinations prevent publication and offer edit/reject/escalate paths. Reject requires a structured reason plus optional explanatory notes for future prompt evaluation. After another reviewer acts, disable stale commands and display the committed outcome and actor. A guide changed since generation remains reviewable, but approval requires a refreshed comparison. Mobile uses stacked current/proposed panels; screen readers receive named fields and decision results rather than color-only badges. Returning to the queue retains its cursor and skips only records actually resolved.

### Acceptance, owner and closure evidence

Knowledge Products and AI Governance jointly own this queue. Prove competing decisions yield one publication, a failed guide update rolls back approval, unsafe generated URLs cannot publish, and an outdated guide revision conflicts. Seed more than 200 pending records and reach the oldest one. Test missing guides, duplicates, regeneration after rejection and five-language decision messages. Track false approvals, reviewer throughput and disputed recommendations; neither a confidence score nor a successful API response is a readiness certificate.
