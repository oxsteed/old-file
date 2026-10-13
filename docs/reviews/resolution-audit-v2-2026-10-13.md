# Resolution-status audit v2 — site-wide process flow review
**Date:** 2026-10-13 (audit completed ~03:10 UTC)
**Scope:** Re-verification of every finding in ~/workspace/reviews/site-wide-flow-review-2026-10-12-CONSOLIDATED.md (524 findings: 15 Critical, 140 High, 279 Medium, 88 Low, 2 Info) against the FRESH tip after pulling the default branch.
**Repo audited:** ~/workspace/old-file-tip at tip **1071a91d** (merge of PR #503), containing all twelve review-fix PRs: #492 fix/job-edit-scale, #493 fix/payment-layers, #494 fix/review-w1-criticals, #495 fix/review-w2-payments, #496 fix/review-w3-jobs, #497 fix/review-w4-security, #498 fix/review-w5-ops, #499 fix/review-w6-onboarding, #500 fix/review-w7-core, #501 fix/review-w8-profiles-credit, #502 fix/review-w9-credit-food, #503 fix/review-w10-messaging.
**Method:** 14 verification workers (3-4 areas each) re-located every finding in the CURRENT code by symbol/string/content search (report line numbers not trusted), consulted fix-branch diffs only as pointers, and classified each finding as RESOLVED / STILL BROKEN / PARTIAL / NEEDS LIVE VERIFICATION / UNCLEAR. A RESOLVED verdict required positive evidence in the fresh code; PR titles and branch names were never accepted alone. Read-only; no code changed.
**Priority declared:** long-term stability and quality over speed.

## Denominator note
Workers recorded 544 verdict-records vs 524 findings in the consolidated report. The delta comes from workers splitting combined entries and counting embedded needs-live items separately (same convention as the v1 audit). Counts below are verdict-records.

## Status counts (overall)

| Status | Count |
|---|---|
| RESOLVED | 185 |
| STILL BROKEN | 284 |
| PARTIAL | 47 |
| NEEDS LIVE VERIFICATION | 27 |
| UNCLEAR | 1 |
| **Total verdict-records** | **544** |

**Headline: 185 of 524 findings resolved (~35%). 14 of the 15 Criticals are resolved. The one remaining Critical is the admin credit-adjustment compliance bypass (sanctions-evasion vector).**

## Verdicts on all 15 Criticals

| # | Critical | Verdict | Evidence / fixer |
|---|---|---|---|
| P1-1 | QR payment-success webhook can never be delivered | **RESOLVED** | Connect contract now lists `checkout.session.completed` (`stripeWebhookContract.js:28-33`); connect route dispatches to `handleConnectedCheckoutEvent` → `applyQrPaymentSucceeded`. Commit 58c8ae25 (W5). |
| P1-2 | Kitchen cancel of card-mode food order issues no Stripe refund | **RESOLVED** | CASE includes `'card'` (`foodController.js:4075-4081`); refund branch covers pay_now+card (`:4293-4298`); transfer reversal + fee refund (`:1387-1409`). PR #494 (75dbdfa5). Caveat: already-cancelled orders have stranded money; agent console can refund manually. |
| P1-3 | Guest oxsteed_credit debited, payment_status requires_payment forever, no refund path | **RESOLVED** | Status flipped to `paid` after debit (`:3428-3433`); refund keyed on order reference (`:4261-4263`); migration `767_food_order_payment_repair.sql` repairs legacy rows. PR #494 (75dbdfa5). |
| P1-4 | Refresh-token absolute expiry never enforced server-side | **RESOLVED** | `refreshToken()` SELECTs `expires_at` + `absolute_expires_at` (`:832`), rejects past-expiry (`:842-868`), enforces absolute family deadline across rotations (`:813`), caps rotated rows (`:899-903`). Migration `765_session_absolute_expiry.sql`. PR #494 (b8d92f22). |
| P1-5 | Work agreements records room dead: double /api prefix | **RESOLVED** | Pages now call `/work-agreements/...` (no `/api` prefix) against axios baseURL `/api`. PR #494 (2c80ecec; complete endpoint 344d5f3d). |
| P1-6 | Agreement creation 400s without content; navigates to /agreements/undefined | **RESOLVED** | Client sends full `content`; server returns `{id, agreement, version}` (`workAgreementController.js:186`); client navigates `data?.id \|\| data?.agreement?.id`. PR #494. |
| P1-7 | AI agreement drafting 500s on nonexistent columns | **RESOLVED** | `draftAgreement` selects `assigned_helper_id, client_id` (`:764-772`) with party check; client populates draft fields. PR #494. |
| P2-8 | Credit-funded subscriptions have no cancel path | **RESOLVED** | `cancelSubscription` branches on NULL `stripe_subscription_id` → local `cancel_at_period_end`, no Stripe call; renewal worker honors it (`subscriptionCreditWorkers.js:75-82`); super-admin cancel with audit. PR #497 (8be8d7e2). |
| P3-9 | Admin credit adjustments bypass the compliance choke point | **STILL BROKEN** | `adminAdjustCredit` still calls `requestMoneyMovement(req, 'credit_adjustment', …)` with NO `evaluateFundingCompliance` (`oxsteedCreditController.js:669-690`); pending-action executor and `adjustCustomerCreditInTransaction` also unscreened. Two admins can still fund a never-KYC'd/sanctioned customer. |
| P3-10 | Self-delete leaves Stripe subscriptions billing forever | **RESOLVED** | `accountDeletionGuard.js:80-118` `cancelSubscriptionsForDeletion()` cancels live subs at Stripe before anonymization; failure aborts with 503; credit subs marked cancelled; user self-serve cancel exists. PR #494 (3a3e636e). |
| P3-11 | Self-delete strands credit and food-wallet balances | **RESOLVED** | `findFinancialBlockers()` blocks deletion 409 `account_has_balance` on nonzero balances/holds/pending payouts. PR #494 (3a3e636e). |
| P3-12 | Affiliate-payout "process" marks completed with zero money movement | **RESOLVED** | TODO gone; `sendAffiliatePayoutTransfer` performs real `stripe.transfers.create` (idempotent) before marking completed; unwired path 503s unless `PAYOUT_PROCESSOR_ENABLED`. |
| P3-13 | No Stripe dispute-evidence submission; every chargeback auto-lost | **RESOLVED** | `chargebackEvidenceService.js:183` calls `stripe.disputes.update`; `evidence_due_by` tracked; `chargebackEvidenceDeadline` auto-submit job wired (`backgroundWorkers.js:134`); admin `/super/chargebacks` endpoints. PR #494 (8c239e75). Note: actual Stripe-side delivery still needs live verification. |
| P3-14 | Booking-request deposits stranded in every terminal path | **RESOLVED** | `bookingDepositService.js` (P3-962): webhook booking-intent handler settles bookings on client death; `settleTerminalBooking` refund/void writer; wired on customer/helper/agent cancel; fenced 5-min sweeper covers decline/expiry/auto-release. |
| P3-15 | Crash-window silent drop of in-flight webhook events | **RESOLVED** | In-flight receipts now get 409 + `Retry-After: 60` (provider retries) instead of silent 200; 15-min reclaim reprocesses. P3-888. |

## Per-area summary

| Worker areas | Checked | Resolved | Still broken | Partial | Needs live | Unclear |
|---|---|---|---|---|---|---|
| Auth/session + session/device mgmt | 26 | 11 | 13 | 2 | 1 | 0 |
| Jobs lifecycle + agreements + disputes | 46 | 27 | 10 | 9 | 0 | 0 |
| Direct booking + availability + biz appointments | 31 | 12 | 14 | 5 | 0 | 0 |
| Profiles + search/discovery | 16 | 13 | 1 | 2 | 0 | 0 |
| Food/restaurant + POS + delivery/runner | 23 | 5 | 16 | 0 | 2 | 0 |
| OxSteed Credit + wallet/statement center | 20 | 10 | 9 | 1 | 0 | 0 |
| Messaging + notifications + in-chat commerce + email/SMS | 43 | 11 | 23 | 6 | 3 | 0 |
| Restaurant media + learn + file upload pipeline | 32 | 11 | 18 | 3 | 0 | 0 |
| QR payments + core payments + webhook infra | 46 | 24 | 18 | 4 | 0 | 0 |
| Featured placements + launch-gated + franchise + feature flags | 34 | 14 | 18 | 2 | 5 | 0 |
| Entity IDs/Didit + KYC/AML + onboarding gates + helper dashboard | 57 | 15 | 27 | 5 | 10 | 0 |
| Support flows + admin ops + privacy/audit | 41 | 3 | 36 | 2 | 3 | 0 |
| Subscriptions + referrals + loyalty/invoices + tool rental/consulting | 47 | 15 | 28 | 2 | 1 | 1 |
| Business hub + settings + background workers + rate limiting | 73 | 14 | 53 | 4 | 2 | 0 |
| **Total** | **544** | **185** | **284** | **47** | **27** | **1** |

## Complete RESOLVED list (185)

### Auth/session + session/device management (11)
- [Critical] Refresh-token absolute expiry never enforced — SELECTs expires_at+absolute_expires_at, rejects past-expiry, absolute family deadline across rotations, caps rotated rows; mig 765. PR #494 (b8d92f22).
- [High] Admin passkey registration dead end (admin_users table) — now queries users; client callers exist (`twoFactor.js:23-26`). PR #497.
- [High] User passkey zero-counter dead end — monotonic check only when stored.counter>0. PR #497.
- [Medium] Passkey login skips digital signature + consent records — new `loginAgreementService.js` writes both; called from passkey verifyAuthentication. PR #500.
- [Medium] Tokens emitted in JSON bodies — `wantsBodyTokens`: web clients get none; native-only emission. PR #500.
- [Medium] changePassword "keep current session" never fires — `currentSessionIdFromRequest` derives session from presented refresh token. PR #500.
- [Low] Cookie-only logout revokes only current session / Secure omitted — now invalidates ALL user sessions + `revokeAllUserTokens`; Secure on clear. PR #500.
- [Low] Cross-tab passkey ceremony race — `saveChallenge` deletes only expired challenges.
- [Low] Duplicate admin passkey auth entry points — duplicate routes removed.
- [High] listMySessions always 500s — mig 777 adds last_used_at/user_agent; `recordSessionContext` populates at login/2FA/refresh. PR #497 (caveat: passkey/registration/internal issuance sites don't record context).
- [High] Cookie-only logout never revokes access token server-side — `revokeAllUserTokens` + authenticate iat comparison. PR #500.

### Jobs lifecycle + work agreements + disputes (27)
- [Critical] Agreement pages double-/api prefix — pages call `/work-agreements/...` against baseURL `/api`. PR #494 (2c80ecec; complete endpoint 344d5f3d).
- [Critical] Agreement creation 400 / /agreements/undefined — client sends content; server returns `{id, agreement, version}`; client navigates `data?.id || data?.agreement?.id`. PR #494.
- [Critical] AI drafting 500 — selects `assigned_helper_id, client_id` with party check; client populates draft fields. PR #494.
- [High] 7-day accepted-job auto-expiry dead — mig 775 adds `jobs.accepted_at` + trigger; job rewritten hourly with 5-day warnings + notifications. PR #496 (c524c24c).
- [High] JobAutoExpiryWarning orphaned — now rendered in JobDetailPage. PR #496.
- [High] /jobs/:id/close with no client caller — `handleClose` + button added. PR #496.
- [High] Complaint barrier unreachable from job flow — "Open dispute" button + DisputeSubmissionModal + by-job agreement check + /agreements/new?jobId= link. PR #495 (P3-818).
- [High] Agreement: no job-surface entry point — create/view/sign links on JobDetailPage. PR #494.
- [High] Agreement: counterparty dead end — `notifyCounterparty` fired on create/version/change-orders with action_url. PR #494.
- [High] Agreement: evidence/vault/warranty/version lists never render — `getAgreement` returns all; page renders. PR #494.
- [High] Agreement: warranty-claim resolution UI missing — resolve/deny buttons. PR #494.
- [Medium] Agreement: signature images never display — query selects signature_data; page renders img. PR #494.
- [Medium] Agreement: approved change orders change nothing — `applyApprovedChangeOrder` updates job price/payment capture/Credit hold. PR #494.
- [Medium] Agreement: warranty terms never shown — rendered on page. PR #494.
- [Medium] Agreement: no warranty window enforcement — status + warranty_months gates in fileWarrantyClaim. PR #494.
- [Medium] Agreement: dead enums/columns — mig 783 narrows status CHECKs, drops disputed. PR #494.
- [Medium] Agreement: concurrent version 500 — FOR UPDATE serialization. PR #494.
- [Medium] Agreement: self-dealing stall — 400 "needs two different parties". PR #494.
- [Medium] Agreement: unilateral completion — both helper_completed_at + customer_completed_at required. PR #494.
- [Critical] Dispute evidence submission nonexistent — `chargebackEvidenceService.js:183` calls stripe.disputes.update; evidence_due_by tracked; deadline auto-submit job wired; admin /super/chargebacks endpoints. PR #494 (8c239e75).
- [High] Admin dispute resolve vocab mismatch — UI posts refund_customer/split_resolution/helper_wins/dismissed; server maps legacy aliases. PR #494.
- [High] Dispute freeze guards use nonexistent status — now ('open','under_review','in_progress'). PR #494.
- [Medium] Dispute counterparty lockout — isDisputeParty for both parties; accused notified with deep link. PR #495 (P3-817).
- [Medium] Credit dispute notification silence — notifyCreditDisputeCustomer on resolve/update/provisional. PR #495.
- [Medium] Dispute detail fields blank — disputeView.js selects full context fields. PR #495.
- [Medium] main_app_payment_disputes unresolvable — admin /payment-disputes list + decision. PR #495 (P3-821).
- [Medium] Evidence submission dies at review — accepts open + under_review. PR #495.

### Direct booking + availability (12)
- [High] Quote-flow requests ownerless — optionalAuth + user_id set; owner check works (anonymous still ownerless). PR #500.
- [High] Multi-crew bookings persist only crew[0] — new quote_request_crew table (mig 784); all crew rows persisted; busy query unions crew. PR #500.
- [High] Hold-less path ignores required_crew_size — full crew picked, advisory-locked, re-checked. PR #500.
- [High] Cancel never refunds — refundDirectPaymentOnCancel; credit auto-refund idempotency-keyed; off-platform flagged + support alert. PR #500.
- [Medium] Instant booking zero notifications — notifyDirectCustomer + notifyDirectSupport fire. PR #500.
- [Medium] pay-credit no client UI — Pay with OxSteed Credit button in case view. PR #500.
- [Medium] schedule/change unchecked times — checkDirectScheduleWindow rejects blackouts + crew overlap. PR #500.
- [Medium] payQuoteWithCredit hold-mode/non-atomic — hold 400s upfront; 3x retry; recordPending instead of false failure. PR #500.
- [Medium] metadata.flow user-controlled — server-forced 'direct'. PR #500.
- [Low] confirmProof sets completedAt not status — now sets both. PR #500.
- [Medium] business_staff_shifts never feed availability — bookingSlotEngine reads shifts. PR #500.
- [Medium] No between-appointment buffers in business engine — preparation_minutes pads both sides. PR #500.

### Profiles + search (13)
- [High] Vanity-slug 404s on dynamic endpoints — router.param('id') resolves slug→UUID for all /:id routes; client keys on helperUuid. PR #501.
- [High] helper_pro/broker invisible in directory — listHelpers role ANY ['helper','helper_pro','broker']. PR #501.
- [High] allow_booking unenforced — 403 BOOKING_DISABLED on both customer booking paths; client gates CTAs. PR #501.
- [High] Admin-hidden businesses in /helpers directory — mix-in requires is_hidden_by_admin=FALSE. PR #501.
- [Medium] Helper section visibility client-only — API withholds hidden sections server-side. PR #501.
- [Medium] SectionNav dead links — tabs gated on content length. PR #501.
- [Medium] /dashboard/edit-profile stub — redirects; stub file deleted. PR #501.
- [Medium] Duplicate listing-toggle endpoints — PATCH delegates to shared toggleListing. PR #501.
- [Medium] Template intake APIs launch-gated client-only — launchGate covers /api/maintenance-requests/public; controller 404s unlisted. PR #501.
- [Low] BusinessProfileEditPage.tsx dead code — deleted. PR #501.
- [Low] Legacy /profile/:id dead-end — links canonical profile. PR #501.
- [Low] No canonical-URL normalization — canonical replace effect to /helpers/<slug>. PR #501.
- [Low] Inconsistent /h/ vs /helpers/ convention — both emit /helpers/:slug. PR #501.

### Food/restaurant + POS + runner (5)
- [Critical] Card-mode kitchen cancel no Stripe refund — CASE includes 'card'; refund branch pay_now+card; transfer reversal + fee refund. PR #494 (75dbdfa5).
- [Critical] Guest oxsteed_credit requires_payment forever — status flipped to paid after debit; refund keyed on order reference; mig 767 repairs legacy rows. PR #494.
- [High] Abandoned pay_now orders — foodAbandonedOrderSweeper cancels >25h every 15 min; server gate blocks forward transitions for unpaid; active scope excludes unpaid. PR #502 (ef596e76).
- [Medium] Dead PATCH payment endpoint always 409 — endpoint deleted server + client. PR #502.
- [Medium] Agent console refund 422 traps — PAYMENT_MODE_ALIASES includes card; pay_now/card refund via refundFoodOrderCardPayment. PR #494.

### Credit + wallet (10)
- [High] Settlement void/dispute with in-flight payout strands — 409 credit_settlement_payout_in_flight guard; webhook path passes fromPayoutConfirmation; admin UI hides buttons in flight. PR #502.
- [High] Kill-switch bypass via feature-flag endpoint — 409 flag_rail_controlled for rail-controlled flags. (W4 e6b2c2c4)
- [Medium] Backfill failed rows never retried — requeue API + admin routes + housekeeping incident; frozen rail skips sweep. PR #502.
- [Medium] $500 adjustment cap race — advisory lock in approve transaction. PR #502.
- [Medium] Pending settlements no nudge/expiry — housekeeping incident >72h pending. PR #502.
- [Medium] Pending-action expiry lazy-only — expireStalePendingActions sweeper wired. PR #502.
- [Medium] Manual mark-paid over in-flight transfer — same payout_in_flight guard. PR #502.
- [High] Customer top-up no client UI — OxsteedCreditTopupPanel mounted in WalletPage. PR #499 (e937def9).
- [High] Per-transaction investigation page unreachable — StatementArchivePage links entries. PR #499.
- [Low] StatementExportPage dead form — functional request form. PR #499.

### Messaging + notifications + email/SMS (11)
- [High] Guest-chat AI fallback unimplemented — guestChatSessionTimeout.js activates ai_support_active transactionally; helperClaimSession accepts fallback states; drainMessageQueue invoked. PR #503.
- [High] Duplicate push fan-out — pushDelivered flag checked before each channel. PR #503.
- [High] Restaurant owner messaging own restaurant — 409 cannot_message_own_restaurant. PR #503.
- [Medium] No guest-chat retention — guestChatRetentionCleanup hard-deletes after 180d inactivity. PR #503.
- [Medium] message_notification_outbox dead letters — admin GET /failed + POST /retry + UI. PR #503.
- [Medium] pushsubscriptionchange never re-registers — rotate endpoint + sw handler. PR #503.
- [Medium] notifyMoneyMoment wallet_topup never fired — now fired on succeeded restaurant top-up. PR #503.
- [High] Checkr webhook crash — broken import removed; sendNotification + sendEmail with idempotency. PR #498.
- [High] SMTP unconfigured silently drops — Resend fallback; failure throws EmailDeliveryError. PR #498.
- [High] Credit notification outbox unfenced — lease_token fencing (mig 778). PR #498.
- [Medium] Template-render failure marks delivered — is_email_sent only on delivery success. PR #498.

### Media + learn + file upload (11)
- [High] Video upload terminal stall — 503 media_video_unavailable up front when no acceptance path. PR #503.
- [High] No upload timeout/cancel — AbortController per upload + cancel button + 60s stall watchdog. PR #503.
- [Medium] Auto-hidden posts silent — author notification + MediaModerationPanel appeal UI. PR #503.
- [Low] Stale waiting_configuration mapping — removed. PR #503.
- [High] Learn auto-publish on unwired workerMain.js — publishDueGuideVideos scheduled every 5 min in-API. PR #498.
- [Low] Duplicate expireVortexTokens entry — shared SCHEDULED_WORKERS. PR #498.
- [High] Agreement vault no storage + stored XSS — mig 776 file storage; safeHttpsUrl vetting; signed reads. PR #497.
- [High] Parcel proof hard-required ClamAV — follows platform scan policy. PR #498.
- [High] Chat attachment uploads no rate limiter — userUploadLimiter + conversationMessageLimiter. PR #497.
- [High] Cover-replacement orphans — storage_deletion_queue (mig 779) + enqueue on cover replacement. PR #498.
- [Medium] Agreement evidence partially covered under vault fix. PR #497.

### QR + core payments + webhook infra (24)
- [Critical] QR webhook undeliverable — connect contract lists checkout.session.completed; dispatch to handleConnectedCheckoutEvent → applyQrPaymentSucceeded. Commit 58c8ae25.
- [High] Payer success page dead end — reconcilePendingQrSession + retry button + expired/succeeded states.
- [Medium] PUBLIC_APP_URL unset — 503 qr_public_url_missing instead of 500.
- [Medium] Payment count "0 payments" — reads succeeded_count ?? payment_count.
- [Medium] Payee no notification — qrPaymentNotifications.js; fired on webhook + credit path.
- [Medium] 409 wrong-actor copy — payer gets recipientUnavailable; owner keeps connectRequired.
- [Low] Credit-payment fire-and-forget — conflict returns existing row's real state; client sends payment_method='credit'.
- [Critical] Affiliate processPayout false-completed — real stripe.transfers.create before completed; 503s unless PAYOUT_PROCESSOR_ENABLED.
- [High] User payout surface dead (req.user.helper_id) — reads now use req.user.id.
- [High] Affiliate self-serve payout — admin-only with financials grant; real Connect transfer; failed re-queues; stale-processing reclaim.
- [High] No void path for authorized payments — reservePaymentRefund assigns kind='void' for authorized intents.
- [High] Referral-credit deduction not transactional — wrapped in one transaction with idempotency key + advisory lock (mig 770).
- [High] PAYMENT_CAPTURE_ASYNC queues to unstarted worker — falls back to in-request capture with error log unless dedicated worker.
- [High] Tier-3 escrow capture silently no-ops — completeJobCore refuses without capture; reconciles from Stripe or 409.
- [Medium] payment_failed/canceled no status guard — WHERE status <> 'captured'; escrow reset only on flipped rows; credit released.
- [Medium] Async checkout events unhandled — platform handles async_payment_succeeded/failed/expired; connect covers QR.
- [Low] createConnectAccount orphan on concurrency — early return + per-user Stripe idempotency key.
- [Critical] Crash-window webhook silent drop — 409 + Retry-After: 60 instead of silent 200; 15-min reclaim reprocesses. P3-888.
- [High] Referral credit_applied double-applies on retry — referralCreditLedger.applyCreditToPayment in-transaction; released on fail/cancel.
- [High] Failed webhook receipts no recovery — super-admin list/replay/resolve API.
- [High] Didit webhook no stale-verdict protection — per-session watermark; stale verdicts skipped.
- [Low] Stale comment routes/didit.js — rewritten.
- [Critical] Booking deposits stranded — bookingDepositService.js; webhook booking-intent handler; idempotent refund/void writer; wired on customer/helper/agent cancel; fenced 5-min sweeper covers decline/expiry/auto-release. P3-962.

### Featured + launch-gated + franchise + flags (14)
- [High] Re-request after decline never re-enters queue — upsert CASE resets to requested; status display added. PR #503.
- [High] Approving second restaurant strands first — previous un-featured in same transaction. PR #503.
- [High] Sticky expired state / admin dead end — revoke ends expired; expiry-aware filter + renew. PR #503.
- [Medium] /api/home featured inconsistency — effective-featured predicate applied. PR #503.
- [Medium] declineRequest no status guard — guarded UPDATE, 409 on illegal. PR #503.
- [Medium] Paid-placement copy mismatch — copy corrected to no-fee. PR #503.
- [Medium] approve/contact lack status guards — guarded transitions. PR #503.
- [High] Unlaunched marketplace purchasable — /api/carts, /api/shared-carts, /api/job-kits mount launchGate() bound to productMarketplace (default false); /api/orders has no POST create. PR #497.
- [High] Public intakes accept caller status — stripPrivilegedIntakeFields middleware on all five public POSTs. PR #497.
- [High] Professional-ops intakes unthrottled — publicIntakeLimiter added. PR #497.
- [High] Consulting takes real money unlaunched — all 8 consulting routers behind requireConsultingLaunched (default false). PR #497.
- [High] Rail kill-switch bypass via generic PUT — 409 for oxsteed_credit_enabled. PR #497.
- [High] Subscription purchase server-live/client-dead — requireSubscriptionsLaunched + paymentsLimiter; CTAs conditional. PR #497.
- [High] Vortex renders launched while endpoints 503 — entry points mirror VITE_VORTEX_ENABLED (default false). PR #497.

### Entity/Didit + KYC + onboarding (15)
- [High] Didit auto-pass webhook never writes identity_verifications — anchorDiditVerified → linkVerificationToEntity upserts verified rows; auto-grant query matches. PR #503.
- [Medium] duplicate_of links never created — both duplicate branches call linkDuplicateIdentity. PR #503.
- [Medium] Schema/handler drift — webhook writes only chk_iv_status-valid values. PR #503.
- [Low] Stale skip comment — rewritten. PR #503.
- [High] Helper terms consent fabricated — POST /helper-registration/registration-terms records consent; verifyOTP 400s without it. PR #499.
- [High] Helper cannot mark job complete from UI — helper "Mark done" button. PR #496.
- [High] No my-assigned-jobs view — GET /api/jobs/me/list?role=helper + AssignedJobsPanel. PR #496.
- [High] PUT /api/bids/:id no client UI — useBids + EditBidModal. PR #496.
- [High] Instant payout no client UI — HelperPayoutsPage posts /payments/payout/instant. PR #496.
- [High] Deprecated POST /helper-registration/complete 500-trap — now 410 endpoint_retired. PR #497.
- [Medium] ID re-submit silently revokes approval — no longer resets id_verified. PR #499.
- [High] Background-check step unreachable — requireHelperStep('background') with reachable prereqs. PR #499.
- [High] Paid tier2 unreachable — saveTier checks isIdentityVerified across all three columns. PR #499.
- [High] Helpers go live unverified — listing toggles gated by requireListingEligible; directory/profile require onboarding_completed server-side. PR #499/#501.
- [Low] Didit skip comment duplicate — same rewrite. PR #503.

### Support + admin ops + privacy (3)
- [Critical] Self-delete leaves Stripe subscriptions billing — cancelSubscriptionsForDeletion cancels live subs at Stripe; failure aborts 503; credit subs marked cancelled; user self-serve cancel exists. PR #494 (3a3e636e).
- [Critical] Self-delete strands balances — findFinancialBlockers 409 account_has_balance on nonzero balances/holds/pending payouts. PR #494.
- [Medium] Agent booking cancel moves money — settleTerminalBookingSoon refunds/voids deposits. PR #494 (fcf6d1af).

### Subscriptions + referrals + loyalty + rental (15)
- [Critical] Credit-funded subscriptions no cancel path — NULL stripe_subscription_id branches to local cancel_at_period_end; renewal worker honors; super-admin cancel with audit. PR #497 (8be8d7e2).
- [High] Referrer paid twice — grantReferralReward idempotent via referralCreditLedger.postOnce + unique index (mig 770). PR #495.
- [High] Referral double-spend — credit reserved at PI creation in locked txn under per-user advisory lock; released by webhook on failure. PR #495.
- [Medium] customer.subscription.created owner resolution — metadata.user_id → stripe_customer_id fallback. PR #497.
- [Medium] Credit renewal worker unwired — scheduled in workers/scheduledWorkerSchedule.js; started by backgroundWorkers; flag-gated no-op. PR #497.
- [Medium] Stripe statuses unmapped — subscriptionStatus.js maps onto local enum. PR #497.
- [Medium] past_due cancel unavailable in-app — status IN (active,trialing,past_due). PR #497.
- [Medium] 409 already-in-progress branch dead — SELECT fetches cancel_at_period_end; check fires. PR #497.
- [Medium] Consulting Stripe rail end-to-end — client callers + aligned contract + webhook handler. PR #499 (b057fbf5).
- [Medium] Tool-rental deposits missing — invoice line with due→held→returned/withheld status; owner return/withhold with reason; terms v1.1. PR #499.
- [Medium] bookTimeSlot ungated on payment — 402 payment_required. PR #499.
- [Medium] Admin consulting invoices mark-paid dead — settlement + audit; route guarded. PR #499.
- [Medium] Legacy purchase 503 — Stripe PaymentIntent purchase + webhook completion. PR #499.
- [Medium] Invoice emails embed raw payment identifier — renders masked identifier only. (predates fix waves)
- [Medium] Consulting admin refund unreachable — refundPayment via processExternalRefund; issue_refunds guard. PR #499.

### Business hub + settings + workers + rate limiting (14)
- [Medium] Payout methods self-verifiable — 400 on user-supplied status except 'inactive'; is_primary requires verified. PR #498 (967738c4). CAVEAT: nothing writes status='verified', so methods can never leave pending — new functional gap.
- [Medium] Bank payout methods no payable destination — resolves from connect_accounts; fails closed 422/409 without Stripe account. PR #498 (884f3e55).
- [High] Delivery-tracking pipeline dead — 8 workers run in-API via scheduledWorkerSchedule.js + backgroundWorkers.js + workerTopology.js. PR #498 (400c8027).
- [High] Affiliate commission batch double-insert — ON CONFLICT (order_id, product_id) WHERE status<>'void'. PR #498 (e312e706).
- [High] PAYMENT_CAPTURE_ASYNC loaded trap — ignored with error log; captures in-request. PR #498.
- [Medium] clearStaleAvailableNow dead — scheduled every 15 min. PR #498.
- [Low] Duplicate expireVortexTokens entry — workerMain.js consumes shared SCHEDULED_WORKERS. PR #498.
- [Low] expireVortexTokens dead — now hourly in shared schedule. PR #498.
- [High] Cart checkout PI: no limiter + no idempotency — paymentsLimiter + idempotencyKey marketplace-order-pi:${order.id}. PR #497.
- [High] Subscription checkout: no limiter, unbounded minting — paymentsLimiter + windowed idempotencyKey. PR #497.
- [High] In-chat money moves on shared chat bucket — paymentsLimiter added. PR #497.
- [High] creditPurchaseLimiter dead on /food/card-payment/intent — paymentsLimiter + documenting comment. PR #497.
- [High] Route-local limiters in-memory — Redis-backed createStoreOption. PR #497.
- [High] conversationMessageLimiter mis-keyed — keyed per conversation/business/route + caller. PR #497.

## Complete PARTIAL list (47)

### Auth/session (2)
- revokeMySession: guard + is_current fixed, but the revoked session's access JWT is not added to the denylist (valid up to 15 min).
- Impersonation sessions: endImpersonation now revokes jti, but user-level actions (force-logout, password reset/change, suspension) explicitly do not terminate active impersonation sessions.

### Jobs/agreements/disputes (9)
- Duplicate quote systems: helperQuotes POST now gates job-exists/open/not-own; accepted chat quotes bridge to a bid. Remains: zero client references to /api/helper-quotes (UI-less).
- Job chat entry: openJobChat posts to a job-scoped thread, but the bare `<Link to="/messages">` remains.
- Tier-3 escrow helper-first strand: fixed via helperCompletionAutoConfirmJob auto-confirm + capture; escrow still 503-gated by design.
- Unilateral versioning: unsigned same-party proposal replaced-not-stacked with notification; still unilateral by design.
- Complaint barrier: UI-advisory only (by-job check + banner); no server-side gate in support/dispute flows.
- Agreement<->payment linkage: getAgreement returns payment/dispute context; chat agreements cross-link recordsRoomAgreementId; completion still doesn't release funds.
- Two agreement systems: cross-linked via recordsRoomAgreementId; still two systems by design.
- Dispute UI entry: job-page button exists; useDisputes has zero consumers; DisputeCenter has no open button.
- Re-open/30-day: one-open-at-a-time guard added; 30-day age window unenforced.

### Direct booking + availability (4)
- service-areas/availability endpoints: advisory ZIP coverage check added (warns, doesn't block); GET /direct/service-areas still zero client callers.
- Cross-surface double-booking: crossSurfaceBusy.js lets all engines read each other; accept-time check still business-surface-only.
- Direct ignores helper templates: time-off + buffers now honored; weekly templates still ignored.
- Reschedule bypasses enforceBookingRules: rejects cancelled, validates, re-checks conflicts; still no min-notice/past/terminal guards; route not mounted.
- (Booking-deposits critical: worker 3 flagged remaining paths, but worker 9 verified with positive evidence that the fenced 5-min sweeper covers decline/expiry/auto-release; verdict stands RESOLVED.)

### Profiles + search (2)
- Cancellation stats on slug URLs: everything else fixed; CancellationStats.jsx still passes the raw URL param, so the block silently nulls on slug URLs.
- Hero search autocomplete: skill suggestions now live; helper/business name lookup still not wired.

### Credit + wallet (1)
- [High] Settlement mark-paid: checker fixed (maker-checker routing, self-approval 403, no override). Remains TOCTOU: rail gate asserted at request time only, not at decide/execute (up to 24h TTL); payment_reference still free-text unverified.

### Messaging + notifications + email/SMS (6)
- Chat agreements terminal record: read-only pointer added; zero downstream write linkage.
- sendEmail {success:false}: sendEmailOrThrow built and quote-requests migrated; directCalendarReminders + consulting still swallow failures.
- Money-critical emails: payment_failed now eligible + emitted; subscription_renewed/cancelled/past_due allow-listed but zero emitters.
- Dispute emails: both parties notified in-app; dispute_update email has zero emitters.
- Failed food-order card payment: job-escrow branch notifies; food-order branch still silent.
- Two email/SMS stacks: Resend fallback mitigates; stacks still exist structurally.

### Media + learn + upload (4)
- Orphaned files: deletion queue + worker built, but only business/helper cover replacements enqueue; logo/gallery/restaurant-media still leak; worker env-gated.
- Support attachmentUrl laundering: malformed URLs rejected; /api/storage/ prefix accepted verbatim; arbitrary https hotlinking persists.
- Retention cleanup: job redacts content but never deletes storage objects.
- multer fileFilter: business-side fixed; helperProfile.js still plain Error → 500.

### Payments + webhook (4)
- payment_intent.succeeded guard: credit now transactional/idempotent, but a late retried succeeded event can still regress refunded→captured.
- Instant payouts: audit trail added; still no local payout row, no payout.* events, no retry path.
- payment_hold_status: lifecycle transitions added but nothing reads it; cancel guard still uses never-written escrow_status values.
- Didit freshness: 300s window + watermark; timestamp not cryptographically bound in V2/Original schemes.

### Featured + launch + flags (2)
- Stale client LAUNCH_VISIBILITY flags: genericQrGenerator consumed; affiliateRewards, businessHubProductCommerce zero consumers.
- Money-rail flags: generic-PUT bypass closed (dedicated rail endpoint required); dedicated path still single-super-admin; other DB flags single-admin flippable; env flags have no audit surface.

### Entity/KYC/onboarding (5)
- Helper onboarding skippable: creation/finalize/bids gated; booking eligibility and instant payout APIs don't re-check onboarding.
- Dead onboarding endpoints: 5 now have callers; 7 still zero callers.
- Directory fail-open: COALESCE default persists; blunted by onboarding_completed requirement.
- Three identity models: read side bridged; write side still fragmented (manual super-admin only).
- didit duplicate 403: in-app explanation added; raw API body still no recovery guidance.

### Support + admin ops (2)
- Enforcement full-account-lock: mounts expanded 2→4 routes; still not login/messaging/booking/checkout/food/top-ups.
- Subscription audit trail: adminCancel writes audit; user subscribe/cancel/renewal webhooks still audit-free.

### Subscriptions + referrals (2)
- Referral rewards fail-open: at-most-once now, but fire-and-forget; referrals_count can drift; no admin reconciliation surface.
- getPlans active-filter: silent-drop fallback unreachable with current schema.

### Business hub + workers + rate limiting (4)
- recurringJobScheduler: NOT EXISTS guard narrows duplicate spawns; TOCTOU window remains on multi-replica.
- Cron thundering herd: seconds spread; */10 job still collides at :40/:50.
- Affiliate calculate/process limiters: process admin-only + strictLimiter; calculate global-only.
- Messaging mutations: attachments limited; conversation creation/reactions/archive/edit no dedicated limiter.

## Notable still-broken clusters (for sequencing)
- **Admin audit-log column mismatch** (support worker): no migration ever adds the missing columns; removeBid/removeReview/restoreReview, refundFoodOrder, and auditAdminRead all still 500 on live-shaped INSERTs. One migration (or six INSERT rewrites) resolves four Highs at once.
- **P3-9 admin credit adjustments compliance bypass** (the remaining Critical): no evaluateFundingCompliance on the credit_adjustment path at any layer.
- **In-chat commerce Highs** (messaging worker): zero fixes across all 12 PRs — open-forever payment requests + POP double-pay is the top sequencing candidate in that area.
- **Business hub** (worker 14): all 14 findings still broken; no fix PR touched these files.
- **Business appointment booking** (worker 3): all 14 findings still broken; no fix PR touched these files.
- **Loyalty program** (worker 13): all 14 findings still broken; zero fixes across all 12 PRs.
- **KYC/AML perimeter** (worker 11): restaurant top-ups, agent adjustments, dispute provisional credit, partner funding, conversions all still bypass screening.
- **Support flows** (worker 12): all 7 findings still broken (complaint barrier still client-only).
- **Settlement mark-paid TOCTOU** (worker 6): rail gate at request time only.
- **New functional gap introduced by a fix**: payout methods can never leave `pending` (nothing writes status='verified') — fail-closed but the verification path is absent (worker 14).
