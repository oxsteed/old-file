# Self-audit 2026-11-03: PR #668 money-admin batch

Scope: the money-admin batch merged as PR #668 (merge 74a5bfd3b, Nov 2), as it stands on base tip 8524169ce (Nov 3). PR #668 itself was client UI only (25 files, no server routes). This audit therefore traces each new UI surface through to the pre-existing server endpoint it calls, and judges the pair, not the UI alone.

Areas: payment disputes queue, credit backfill queue, hold capture, settlement payout execution (plus settlement create, transition, and reversal, which share the same page), FX currency quotes, compliance appeal decisions (plus the other compliance queue decisions on the same page), chargeback list/submit, subscription cancel admin.

Method: two independent passes, as required. Pass 1 traced every UI call to its route, controller, and service, checking dual control, step-up binding, idempotency, status predicates, audit logging, and UI/backend consistency. Pass 2 re-verified each candidate finding against the exact code (step-up verify semantics, pending-action resolvers, trigger definitions, job locks) and dropped anything that did not survive that check. No product code was changed for this item. No finding below is speculative: each names the file and line that creates the mechanism.

Status key used below: dual control means a second, distinct admin must approve before money moves (the OxSteed Credit pending-action queue). Step-up means a fresh TOTP challenge. "Bound" means the challenge was issued for, and verified against, the exact amount.

## Per-area verdicts

### 1. Payment disputes queue: weakest dual control in the batch

- UI: `client/src/admin/pages/super/PaymentDisputes.jsx` (list, decide form, confirm dialog, transition map mirroring the server).
- Server: `server/routes/admin.js:209-210` (requireAdmin plus `manage_disputes` permission only, no rate limiter, no step-up, no impersonation guard), `server/controllers/paymentDisputeAdminController.js`.
- Strengths: decisions run in a transaction with `FOR UPDATE` row lock (line 68), the transition map is enforced server side with 409 on illegal moves (lines 16-20, 71), every decision is audit logged with before/after status (lines 85-95), and the filer is notified (lines 101-108).
- Gaps: see F1, F2, F6.

### 2. Credit backfill queue: replay engine is sound, the operator action is not audited

- UI: `client/src/admin/pages/super/OxsteedCreditBackfill.jsx` and the wrapper `client/src/admin/pages/super/oxsteedCredit/BackfillPage.jsx`.
- Server: `server/routes/admin.js:698-710`, `server/services/oxsteedCreditSubBankService.js:590-636`.
- Strengths: replay uses a deterministic dual-posting idempotency key so replays cannot double post, rows are drained with `FOR UPDATE SKIP LOCKED`, refunds wait for their original debit to replay first, and a frozen rail skips the sweep instead of burning retry attempts.
- Gaps: see F4.

### 3. Hold capture: strongest surface in the batch

- UI: `client/src/admin/pages/super/OxsteedCreditCustomerDetail.jsx:180-229` (reason required, step-up issued for the hold amount, idempotency key per hold).
- Server: `server/routes/admin.js:288`, `server/controllers/oxsteedCreditController.js:608-639` (through the maker-checker queue), `server/services/oxsteedCreditService.js:3238-3418` (capture in transaction).
- Strengths: maker step-up is amount bound because the payload carries `amountCents` (controller lines 165-190); capture requires the hold to be `active`, unexpired, and amount exact unless the debit-then-adjust path applies; the capture key is claimed under savepoint with 409 on conflict; expiry flips the hold and audits it instead of capturing stale value; the checker re-runs the same executor with the original idempotency key.
- Gap: see F9 (impersonation guard missing on this one route, inconsistent with sibling money routes).

### 4. Settlement payout execution: executor is strong, maker binding has a hole

- UI: `client/src/admin/pages/super/oxsteedCredit/SettlementsPage.jsx:239-360` (create, status transition, payout queue, reversal, reconciliation, CSV export).
- Server: `server/routes/admin.js:621-630` (create, status, payout), `server/services/oxsteedCreditPendingActionService.js` (maker-checker), `server/services/oxsteedCreditAdminService.js:2807-2950` (payout executor).
- Strengths: payout executes only for `approved` settlements with `payout_status = 'none'`, enforced by a conditional update that 409s on a lost race; net must be positive; partner reserve must meet floor plus ratio; sanctions are screened with fail-closed provider errors; the Stripe transfer uses the deterministic key `credit-settlement-payout:<settlement id>`; the payable is reserved while the transfer is in flight; webhook confirmation re-verifies transfer amount and settlement id against Stripe.
- Gaps: see F3, F7, F10.

### 5. FX currency quotes: math is exact, amount proof is not

- UI: `client/src/admin/pages/super/oxsteedCredit/CurrencyQuotesPage.jsx` (live-rate mode and manual-rate mode, lookup by id only, no list).
- Server: `server/routes/admin.js:591-592`, `server/controllers/oxsteedCreditController.js:2565-2620`, `server/services/oxsteedCreditCurrencyConversionService.js:229-340`.
- Strengths: target amount must equal the exact BigInt half-up computation from the stated rate (math mismatch is 400); expiry is capped at 24 hours and must be in the future; source plus fee must stay under the transaction limit; creation goes through the maker-checker queue, so no quote exists until a second admin approves.
- Gaps: see F3, F8, F11.

### 6. Compliance appeal decisions: step-up present, second admin absent

- UI: `client/src/admin/pages/super/oxsteedCredit/CompliancePage.jsx:96-119` (step-up challenge, then decision post with an Idempotency-Key header).
- Server: `server/routes/admin.js:713-717`, `server/controllers/oxsteedCreditController.js:1419-1470`, `server/services/identityVerificationService.js:464-540`.
- Strengths: appeal decisions require a fresh TOTP step-up (`compliance_verification_decision` is a TOTP-only action type, `server/services/stepupChallengeService.js:119-140`); the appeal predicate is strict (status must be `rejected` and `appeal_status` must be `pending`, enforced both in the select and in the update guard, so a second decision 409s); approving an appeal does NOT grant a funding tier, it resets tier to 0 and returns the case to `pending` for re-review; the decision is audit logged with before/after state and the customer is notified under a decision-scoped idempotency key.
- Gaps: see F5.

### 7. Chargebacks: evidence submission is final at Stripe and single-admin

- UI: `client/src/admin/pages/super/Chargebacks.jsx` (open/all toggle, pager with a real total, submit button hidden once submitted).
- Server: `server/routes/admin.js:252-271`, `server/services/chargebackEvidenceService.js:174-271`, `server/jobs/chargebackEvidenceDeadline.js:13-60`.
- Strengths: the list now returns a total so the queue tail is reachable; manual submit 409s when evidence was already submitted; the deadline job is fenced with a job lock, stages evidence on first sight, and auto-submits within 24 hours of the deadline so a dispute is never silently forfeited; failed staging is recorded as a reconciliation exception.
- Gaps: see F6 (shared pattern) and F12.

### 8. Subscription cancel admin: ID entry only, no preview, no step-up

- UI: `client/src/admin/pages/super/SubscriptionsAdminPage.jsx` (hand-typed id, confirm dialog carrying a reason field, result display after the fact).
- Server: `server/routes/admin.js:270`, `server/controllers/subscriptionController.js:609-675`.
- Strengths: a reason is required server side (400 without it); the Stripe cancel runs before the local update so a Stripe failure does not mark the row cancelled; the local update is guarded by `status <> 'cancelled'`; the action is audit logged with before/after status and emits a domain event.
- Gaps: see F6 (shared pattern) and F13.

## Findings, ranked by money impact

### F1 (high). Payment dispute approval accepts an unverified refund reference, and the filer is told the dispute is approved
- Mechanism: `server/controllers/paymentDisputeAdminController.js:50,56` stores whatever string the admin types as `refundReference` and treats its presence as satisfying the closure rule. Nothing looks that string up in payments, credit transactions, or refunds, and no follow-up task is created. The decision then notifies the filer (lines 101-108) that the dispute moved to `approved`/`resolved`.
- Consequence: an admin can close a dispute as approved with a fabricated or mistyped reference while no money ever moves, and the filer has a system message saying the dispute was approved.
- Recommended fix: resolve the reference to a real refund record (or require the refund to be created through the linked refund tool from the decision screen) before an approved/resolved decision commits. Effort: medium.

### F2 (high). Support ticket closure auto-resolves payment disputes with no refund evidence, no admin audit row, and no filer notice
- Mechanism: `server/migrations/773_main_app_payment_dispute_lifecycle.sql:8-21` (trigger `trg_main_app_payment_dispute_sync_ticket`). Closing the linked support ticket flips any `open` or `under_review` dispute to `resolved`, including disputes whose admin queue still shows them as awaiting a decision. The trigger writes no admin audit row, sends no notification, and does not apply the F1 closure rule (no refund reference, no no-refund reason).
- Consequence: the Finding-37 closure guard in the admin decision path is bypassed by an ordinary support action, and the resolution is invisible in the admin audit trail.
- Recommended fix: have the trigger set a distinct status (or require the admin decision path) instead of `resolved`, and record the ticket-driven closure in the admin audit log. Effort: small.

### F3 (high). Maker step-up is amount bound only when the payload carries `amountCents`, so settlement approval and FX quote maker proofs are unbound
- Mechanism: `server/controllers/oxsteedCreditController.js:165-190` (`requestMoneyMovement`) passes `expectedAmountCents` to `verifyStepupChallenge` only when `payload.amountCents` is a positive safe integer. Settlement approval payloads carry `settlementId`, `targetStatus`, and `reason` but no `amountCents` (`server/controllers/oxsteedCreditController.js:2471-2480`); FX quote payloads carry `sourceAmountMinorUnits`, not `amountCents` (`server/controllers/oxsteedCreditController.js:2565-2620`). `server/services/stepupChallengeService.js:380-425` verifies the amount only when the caller passes one, so a challenge issued for 1 cent verifies for a maker request of any size in both flows. The checker side is bound for settlements (the resolver reads `net_cents`, `server/services/oxsteedCreditPendingActionService.js:207-235`) but not for FX quotes (the same resolver checks `amountCents`, settlement net, and withdrawal amount only, and returns null for quotes), so FX quotes are unbound on both sides.
- Consequence: the TOTP proof does not cryptographically tie the maker (or, for FX, the checker) to the amount they approved. A second admin and the visible payload are the only remaining controls.
- Recommended fix: bind settlement maker verification to the settlement net at maker time, and teach both resolvers and the maker path to use `sourceAmountMinorUnits` for FX quotes. Effort: small.

### F4 (medium). Backfill requeue is unaudited, has no step-up, and "requeue all" requeues more than the screen shows
- Mechanism: `server/routes/admin.js:704-710` posts to `requeueParkedDualPostingBackfill` (`server/services/oxsteedCreditSubBankService.js:610-636`), which updates rows with no `logAdminAction` call, no step-up check, and no impersonation guard. The UI confirm text counts the loaded page (`client/src/admin/pages/super/OxsteedCreditBackfill.jsx:139-145`), but when the operator picks "all" the UI sends `ids: null`, and the server then requeues every `failed` row with no filter. The parked list itself takes no offset (`listParkedDualPostingBackfill`, same file lines 590-609), so rows past the limit are visible only as a total, never as rows, yet "requeue all" requeues them blind.
- Consequence: a single super-admin click replays failed money postings that were never displayed, with no audit record of who did it.
- Recommended fix: log the requeue with actor and row count, require step-up, and either page the parked list with an offset or make "requeue all" send the explicit ids it counted. Effort: small.

### F5 (medium). Compliance decisions are single-admin, including sanctions clears, and the compliance routes lack the impersonation guard
- Mechanism: `server/routes/admin.js:713-717` mounts the verification, appeal, sanction, and case routes with only `requireSuperAdmin` plus the mutation limiter. No route carries `rejectImpersonated`, unlike the pending-action, hold-capture, payout, and reversal routes. Sanction clearing (`decideAdminComplianceSanction`, `server/controllers/oxsteedCreditController.js:1448-1460`) is therefore one admin plus one TOTP away from clearing a sanctions hit, and the appeal path inherits the same single-admin shape (mitigated by the re-review design noted above, but the later verification decision that actually grants a tier is also single-admin).
- Consequence: the highest-stakes compliance action on the rail has no second pair of eyes.
- Recommended fix: add `rejectImpersonated` to the four compliance routes now, and route sanction clears through the maker-checker queue. Effort: small for the guard, medium for the queue change.

### F6 (medium). Payment disputes, chargebacks, and subscription cancels share the same missing guards: no step-up, no limiter, no impersonation guard
- Mechanism: `server/routes/admin.js:209-210` (disputes), `:258-271` (chargebacks), `:270` (subscriptions). Each is guarded by role/permission alone. Contrast with the credit money routes on the same file, which carry `creditAdminMutationLimiter` and usually `rejectImpersonated`.
- Consequence: a single compromised admin credential can decide the whole dispute queue, submit final evidence at Stripe, or cancel subscriptions, with no second factor beyond login and no brute-force throttle on the mutation endpoints.
- Recommended fix: add the mutation limiter and `rejectImpersonated` to all three routes, and a step-up challenge for dispute approvals and subscription cancels. Effort: small.

### F7 (medium). A single admin can void or dispute an approved settlement with no step-up, and the UI implies otherwise
- Mechanism: `server/controllers/oxsteedCreditController.js:2461-2500` (`transitionAdminSettlement`) routes only `approved` and `paid` targets through the maker-checker queue; every other target executes immediately via `transitionSettlement`. The transition map allows `approved` to `voided` and `approved` to `disputed` (`server/services/oxsteedCreditAdminService.js:1607-1612`). The UI requests a step-up challenge for every transition (`client/src/admin/pages/super/oxsteedCredit/SettlementsPage.jsx:280-310`), but the server ignores the step-up fields for non-money targets, so the operator's proof is theater for void/dispute. Voiding an approved settlement kills its payout path (the payout-in-flight guard only blocks voiding once a payout is `initiated` or `paid`).
- Consequence: one admin can destroy an approved payout obligation without a second admin or a verified step-up.
- Recommended fix: require step-up (and ideally a checker) for `voided` and `disputed` targets on `approved` settlements. Effort: small.

### F8 (medium). FX manual rates have no plausibility bound, and the checker screen hides the rate
- Mechanism: `server/services/oxsteedCreditCurrencyConversionService.js:229-280` validates that the target amount matches the stated rate exactly, but never compares the rate to any market rate, so a rate 100 times the market rate passes as long as the arithmetic is consistent. In manual mode the provider reference is free text supplied by the maker; in live mode the reference is synthesized as `provider:from:to:quotedAt` (`server/controllers/oxsteedCreditController.js:2573-2600`), not a provider-issued quote id, so the checker cannot re-verify the rate with the provider. On the checker screen, `client/src/admin/pages/super/oxsteedCredit/ApprovalsPage.jsx:81-92` builds its summary from `amountCents` (absent for quotes) and `customerId`, so source amount, target amount, and rate appear only inside the expandable raw JSON.
- Consequence: the checker approves a conversion whose economics are visible only if they expand and read raw JSON.
- Recommended fix: surface source amount, target amount, rate, and fee in the checker summary row, and warn (or bound) when a manual rate deviates from the live rate by more than a configured band. Effort: medium.

### F9 (low). Hold capture route lacks the impersonation guard its sibling money routes carry
- Mechanism: `server/routes/admin.js:288` mounts hold capture with `requireSuperAdmin`, `noStoreCreditResponse`, and `creditAdminMutationLimiter`, but not `rejectImpersonated`, while the payout route (`:630`), reversal route, refund route, loads, and adjustments all carry it.
- Consequence: inconsistent enforcement; an impersonated session that is blocked from every sibling money move can still capture a hold (subject to the maker-checker queue and its own step-up).
- Recommended fix: add `rejectImpersonated` to the hold capture route. Effort: small.

### F10 (low). Settlement payout can be queued for a settlement that is not approved, and for one that does not exist
- Mechanism: `server/routes/admin.js:630-690` checks for an already-queued payout and verifies the maker step-up (bound to `net_cents` when the settlement is found), but never checks settlement status at maker time; the `approved` check lives only in the executor (`server/services/oxsteedCreditAdminService.js:2815-2830`). When the settlement row is missing, the pre-read skips amount binding entirely (the route comment says so) and the pending action is still queued; the checker approval then fails at execution with 404 after the checker's step-up has been consumed.
- Consequence: wasted checker effort and a doomed pending row, not a money loss, because the executor still refuses non-approved settlements.
- Recommended fix: return 404/409 at maker time when the settlement is missing or not approved. Effort: small.

### F11 (low). FX quotes and subscriptions still have no list endpoint, so created items are hard to find again
- Mechanism: FX quotes expose only create and get-by-id (`server/routes/admin.js:591-592`); subscriptions expose only cancel-by-id (`:270`). The FX page shows the pending-action id after queueing, not the quote id, and the quote id exists only after checker approval, so an operator who loses the id has no way to list quotes. The subscription page states the gap in its own copy (`client/src/admin/pages/super/SubscriptionsAdminPage.jsx:33-42,72-78`).
- Consequence: operational, not monetary: items can be created and then effectively lost to the UI.
- Recommended fix: add admin list endpoints for both, or surface the created quote id in the pending-action receipt. Effort: medium.

### F12 (low). Chargeback manual submit races the auto-submit job, and neither Stripe call carries an idempotency key
- Mechanism: `server/services/chargebackEvidenceService.js:228-235` (`submitEvidence`) reads the row without `FOR UPDATE`, checks `evidence_submitted_at`, then calls `pushEvidence`, which calls Stripe without an idempotency key (`:174-210`). The deadline job (`server/jobs/chargebackEvidenceDeadline.js:25-50`) selects the same unsubmitted rows under its own job lock, which does not cover manual submits. Two submitters can therefore both pass the check and both call Stripe; the local row resolves last-writer-wins while Stripe sees two submissions.
- Consequence: duplicate evidence submission attempts at Stripe, with provider-dependent handling, rather than a guaranteed single submission.
- Recommended fix: take a row lock in `submitEvidence` and pass a deterministic Stripe idempotency key per dispute. Effort: small.

### F13 (low). Subscription cancel confirmation shows only the id, and the Stripe-first ordering leaves a window with no reconciliation
- Mechanism: the confirm dialog message carries only the typed id (`client/src/admin/pages/super/SubscriptionsAdminPage.jsx:140-149`); no user, plan, or status preview is fetched before confirmation, so a typo cancels the wrong subscription. Server side, Stripe is cancelled first and the local update follows (`server/controllers/subscriptionController.js:609-675`); if the local transaction fails, the local row stays `active` while Stripe is cancelled, and nothing in this path retries or reconciles that state. A retry does recover (Stripe `resource_missing` is tolerated), but only if someone retries.
- Consequence: wrong-subscription cancels by typo, and cancelled-at-Stripe but active-locally rows until a human retries.
- Recommended fix: fetch and display the subscription (user, plan, status) in the confirm dialog, and add a reconciliation check for Stripe-cancelled but locally active rows. Effort: medium.

### F14 (low, UI/backend mismatch). Compliance decision posts carry an Idempotency-Key the server ignores
- Mechanism: `client/src/admin/pages/super/oxsteedCredit/CompliancePage.jsx:118` sends an Idempotency-Key header, but `decideAdminComplianceIdentityAppeal` and its sibling decision handlers never read it. The strict status predicate still prevents a double decision (the second attempt 409s), but a lost first response looks like a failure even though the decision applied.
- Consequence: operator confusion and possible duplicate manual retries, not double application.
- Recommended fix: either honor the header server side or stop sending it and surface the 409-as-applied case in the UI. Effort: small.

## What is sound (kept out of the findings deliberately)

- Maker-checker core: distinct checker enforced with 403 on self-approval, single-admin break-glass gated on both a flag defaulting off and fewer than two active super-admins, lazy expiry with 409, rejection requires a reason, decisions are locked with `FOR UPDATE`, double approval replays stored execution refs instead of moving money twice, and idempotency-key conflicts across different payloads fail closed with 409 (`server/services/oxsteedCreditPendingActionService.js`).
- Checker-time compliance re-evaluation for loads, adjustments, and refunds, so a maker-time pass up to 24 hours old cannot execute against a new sanctions hit or tier change.
- Settlement payout executor guards listed in section 4, including the reserve floor, sanctions screen, and webhook amount verification.
- Backfill replay idempotency, row locking, and refund ordering.
- Hold capture amount-exactness, expiry handling, and capture-key claiming.

## Honest gaps in this audit

- Code reading only. No live database, no running server, and no test suite run were part of this pass, because the task is review-only and no product code changed. Findings that depend on runtime behavior (notably F12, the Stripe handling of a second evidence submission) are framed as races with provider-dependent outcomes, not as proven double effects.
- The PR #668 UI was verified against the routes it calls, but the admin UI was not clicked through in a browser; UI claims rest on reading the page components.
- Chargeback evidence content (whether the assembled evidence is persuasive) was not judged; only the submission lifecycle was audited.
- The single-super-admin break-glass flag value in production was not checked; the audit assumes the documented default (off) and the fewer-than-two-admins gate.

## Appendix: Oct 25 item #26 dependency sweep

Method: for each table, grepped all server code (including jobs, workers, services, controllers, routes, and tests), all migrations, and all client code for the table name; checked foreign keys pointing at the table across migrations; checked for views and materialized views mentioning it. Archive docs under `docs/archive/` were excluded as evidence of live use (they describe history, not current code), except where noted. No table was dropped and no drop migration was written. Drops need Emile's per-table call.

Verdicts in one line each:

- legal_documents family: DROP AS A UNIT, except keep legal_document_drafts, legal_audit_log, and user_legal_acceptances. Evidence: no server or client code outside migrations and tests queries legal_documents, legal_document_versions, legal_document_sections, legal_section_versions, legal_document_approvals, legal_change_notifications, legal_notification_tracking, legal_document_translations, legal_section_translations, legal_translation_status, legal_compliance_holds, legal_dispute_references, or legal_data_retention. The live legal flow uses drafts plus bundled content for published terms (`server/routes/legalDocuments.js:108-135`) and user_legal_acceptances plus legal_audit_log for acceptances (`server/controllers/legalDocumentsController.js:62,437,604`).
- business_revenue_summary: DROP. Evidence: defined in migration 228 with indexes, zero references in server or client code; business analytics now runs on the metrics layer, not this summary table.
- schema_audit: DROP. Evidence: defined in migration 072, which itself inserts the only known row at migrate time; zero references in server or client code and no foreign keys pointing at it.
- admin_activity_log: DROP. Evidence: defined in migration 016, zero references in server or client code; current admin auditing writes to admin_audit_log (`server/services/auditService.js:64`), not this table.
- invoice_idempotency_log: DROP. Evidence: defined in migration 081 with an index added in 189; the only non-migration mentions are a comment in 189 suggesting a cleanup job that no code implements, and zero references in server or client code.
- affiliate_metrics: DROP. Evidence: defined in migration 131 with indexes, zero references in server or client code; affiliate payouts and dashboards use other tables, and the only prose mentions are in archived contributor guides.
- product_promotions: DROP. Evidence: defined in migration 218 with indexes, zero references in server or client code; live promotion code uses food_restaurant_promotions (`server/controllers/foodController.js:971,4342,7081`), not this table.
- conversion_metrics_snapshots: DROP. Evidence: defined in migration 108, zero references in server or client code and no foreign keys pointing at it.

Dependency notes that constrain the drops:

- legal_documents cannot be dropped alone. Migration 624 hardened foreign keys from legal_compliance_holds and legal_data_retention to legal_documents with ON DELETE RESTRICT, and the 145-148 family tables reference legal_documents and legal_document_sections with CASCADE. The family must drop in dependency order (children first) or not at all.
- legal_document_drafts, legal_audit_log, and user_legal_acceptances must stay. Drafts carry the live publish flow (create, edit, approval request, publish in `server/routes/legalDocuments.js:28-44,201-333`); legal_audit_log carries the admin audit list and writes; user_legal_acceptances carries every acceptance and history read. Migration 587 confirms the controller uses the document_type model of user_legal_acceptances, not a foreign key to legal_documents, so keeping acceptances does not block dropping legal_documents.
- legal_compliance_holds appears in one test (`server/__tests__/ws5-audit-evidence.test.js`); that test needs updating or removal as part of any family drop, it is not evidence of production use.
- No views or materialized views reference any of the eight items. No foreign key outside the legal family points at any of the seven non-legal tables.
- Before any drop, confirm with a production row count that the tables are empty or that their rows are genuinely unneeded. This sweep proves no code reads them; it does not prove they hold no rows worth preserving.
