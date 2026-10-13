# Reviews: code-fixable classification
Generated 2026-10-12 ~3:30 PM ET by Grok Bot. Source: review md + /workspace/reviews-implementation-scorecard.md. ID = part + md line (e.g. P1-109).
A = pure code in repo; B = code + ops/config/credentials/infra; C = not code (live verification, legal, vendor, product).

Counts: A 506, B 13, C 5.


## A — Code-only


### P1 1. Auth/session

- P1-109 [Critical] Refresh-token absolute expiry never enforced server-side. — `authController.js:792-879`
- P1-110 [High] Admin passkey registration is a dead end. — `passkeyController.js:135`
- P1-111 [High] User passkey sign-in dead-ends for zero-counter authenticators. — `userPasskeyController.js:304`
- P1-112 [Medium] rememberMe (30d) silently degrades to 7 days on first refresh. — `authController.js:859`
- P1-113 [Medium] Passkey login skips the per-login digital signature + consent records (login_agreements, user_consents written by login(… — `authController.js:441-474`
- P1-114 [Medium] Server still emits accessToken+refreshToken in the JSON body on every session-issuing endpoint (authController.js:512,68… — `authController.js:512,687,877`
- P1-115 [Medium] changePassword's "keep current session" logic never fires — `authController.js:1830`
- P1-116 [Low] Cookie-only logout revokes only the current session (other devices stay live); — `—`
- P1-117 [Low] Cross-tab passkey ceremony race — `—`
- P1-118 [Low/Info] Duplicate admin passkey auth entry points (routes/auth.js /auth/login/passkey/* vs index.js:501 /api/2fa/passkeys/authen… — `routes/auth.js`

### P1 2. Jobs lifecycle

- P1-128 [Critical] Agreement client pages are entirely non-functional — `client/src/api/axios.js:4`
- P1-129 [High] Even with URLs fixed, agreement creation would still 400 — `NewWorkAgreementPage.jsx:54-59`
- P1-130 [High] AI agreement drafting broken server-side — `workAgreementController.js:541-543`
- P1-131 [High] The 7-day auto-expiry of accepted jobs is dead — `acceptedJobExpiryJob.js:25-36`
- P1-132 [High] JobAutoExpiryWarning.tsx is orphaned (zero imports in client/src); — `JobAutoExpiryWarning.tsx`
- P1-133 [High] POST /api/jobs/:id/close has no client caller (zero references in client/src); — `—`
- P1-134 [Medium] Duplicate, disconnected quote systems — `helperQuotes.js POST /`
- P1-135 [Medium] (partial) Job states matched/negotiating are unreachable dead states — `bidController.js:93-95`
- P1-136 [Medium] Job chat has no UI entry point — `JobDetailPage.jsx:878`
- P1-137 [Medium] The complaint barrier is unreachable from the job flow — `—`
- P1-138 [Medium] Tier-3 escrow for jobs is unreachable (BidAcceptanceModal.jsx renders only off_platform; — `BidAcceptanceModal.jsx`

### P1 3. Work agreements records room

- P1-147 [Critical] Agreement creation always fails — `client/src/pages/NewWorkAgreementPage.jsx:48-60`
- P1-148 [Critical] AI drafting always 500s — `workAgreementController.js:538-543`
- P1-149 [High] No entry point from any job surface — `client/src/App.jsx:702`
- P1-150 [High] Counterparty dead end — `—`
- P1-151 [High] Evidence, vault, warranty-claim, and version lists never render — `WorkAgreementPage.jsx`
- P1-152 [High] Warranty claims have no resolution path in the UI — `—`
- P1-153 [High] Unilateral versioning stalls activation — `workAgreementController.js:178-184`
- P1-154 [High] Complaint barrier unenforced (merged into Top 10 #10). — `—`
- P1-155 [Medium] Signed signature images never display — `WorkAgreementPage.jsx:219`
- P1-156 [Medium] Approved change orders change nothing — `—`
- P1-157 [Medium] Warranty terms collected but never shown — `WorkAgreementPage.jsx`
- P1-158 [Medium] Warranty claims have no window enforcement — `workAgreementController.js:462`
- P1-159 [Medium] Dead enum values and dead column — `—`
- P1-160 [Medium] Agreement <-> payment/release unlinked — `—`
- P1-161 [Medium] Concurrent version creation can 500 — `—`
- P1-162 [Medium] Self-dealing stall — `—`
- P1-163 [Medium] Two parallel "agreement" systems can leak/confuse — `chatAgreementsController.js`
- P1-164 [Medium] Unilateral completion — `—`

### P1 4. Direct booking

- P1-173 [High] Quote-flow requests are always ownerless, so the customer can never manage them (merged into Top 10 #7). — `—`
- P1-174 [High] Multi-crew bookings persist only crew[0] as assigned_to (merged into Top 10 #7). — `—`
- P1-175 [High] The hold-less book path ignores required_crew_size (merged into Top 10 #7). — `—`
- P1-176 [High] Cancelling a paid booking never refunds. — `directController.js:1545-1559`
- P1-177 [Medium] Instant booking sends zero notifications — `directSlotEngine.js`
- P1-178 [Medium] POST /api/direct/requests/:id/pay-credit has no client UI (routes/direct.js:108; — `routes/direct.js:108`
- P1-179 [Medium] GET /api/direct/service-areas and POST /api/direct/service-availability have no client UI (routes/direct.js:90-91); — `routes/direct.js:90-91`
- P1-180 [Medium] Customer-facing scheduleRequest/changeRequest accept concrete scheduledStartAt/End with no calendar-block or availabilit… — `directController.js:1588-1645`
- P1-181 [Medium] payQuoteWithCredit advertises a hold mode it cannot honor and the spend-then-update is non-atomic — `directController.js:2865`
- P1-182 [Medium] Public createQuoteRequest accepts user-controlled metadata.flow (quoteRequestsController.js:266), which bypasses the DB … — `quoteRequestsController.js:266`
- P1-183 [Low] Lifecycle stalls after payment — `directController.js:1798-1830`

### P1 5. Availability/scheduling

- P1-192 [High] Cross-surface double-booking — `—`
- P1-193 [Medium] business_staff_shifts never feed availability — `businessStaffScheduleController.js`
- P1-194 [Medium] Direct ignores helper personal blocks, templates, and buffers entirely (zero references in directSlotEngine.js/directCon… — `directSlotEngine.js`
- P1-195 [Medium] No between-appointment buffers in the business engine either (bookingSlotEngine.js:207-219 uses bare overlaps()); — `bookingSlotEngine.js:207-219`

### P1 6. Helper/business profiles + public visibility controls

- P1-202 [High] Vanity-slug profile URLs silently lose pricing, availability, cancellation stats, and the Pay button. — `helpersController.js:718-725`
- P1-203 [High] helper_pro/broker profiles are reachable but invisible in the directory — `helpersController.js:217-218`
- P1-204 [High] allow_booking is unenforced end-to-end — `settingsPrivacyController.js:27-42`
- P1-205 [High] Admin-hidden businesses still appear as cards in the /helpers directory — `helpersController.js:523-536`
- P1-206 [Medium] Helper section visibility (show_services, etc.) is a client-only gate — `HelperBusinessProfilePage.tsx:447-466`
- P1-207 [Medium] SectionNav dead links — `HelperBusinessProfilePage.tsx:354-362`
- P1-208 [Medium] /dashboard/edit-profile is an unfinished stub, reachable and linked — `client/src/pages/HelperProfileEditPage.tsx:61-97`
- P1-209 [Medium] Two duplicate listing-toggle endpoints with different labels (PUT /api/helpers/me/listing "online/offline" vs PATCH /api… — `—`
- P1-210 [Medium] Template intake APIs are launch-gated client-side only — `launchScope.js:122-137`
- P1-211 [Low] BusinessProfileEditPage.tsx is dead code (307 lines, never imported) since /business/edit-profile redirects to Business … — `BusinessProfileEditPage.tsx`
- P1-212 [Low] Legacy /profile/:id is a dead-end page — `PublicProfile.jsx:60-174`
- P1-213 [Low] No canonical-URL normalization for helper profiles (unlike businesses); — `—`

### P1 7. Search and discovery

- P1-222 [Medium] /discover is a dead route — `utils/launchScope.js:91`
- P1-223 [Medium] The helper directory hero search has no live autocomplete — `SearchBar.tsx:35-51`
- P1-224 [Low] Restaurant typeahead only suggests from the first loaded page (FoodHomePage.jsx:339-358). — `FoodHomePage.jsx:339-358`
- P1-225 [Low] Inconsistent profile-URL convention — `helpersController.js:486`

### P1 8. Food/restaurant

- P1-234 [Critical] Kitchen cancel/refund of a card-mode paid order issues no Stripe refund and leaves payment_status='paid' (merged into To… — `—`
- P1-235 [Critical] Guest oxsteed_credit — `foodController.js:3921-3924`
- P1-236 [High] Abandoned pay_now orders sit in received/requires_payment indefinitely in the merchant's active feed; — `server/bootstrap/backgroundWorkers.js:152`
- P1-237 [Medium] PATCH /food/restaurants/:restaurantId/orders/:orderId/payment is a dead endpoint — it always throws 409 (server/routes/f… — `server/routes/food.js:132`

### P1 9. OxSteed Credit

- P1-247 [High] Single super-admin can mark an approved settlement paid with no rail gate, no checker, no Stripe verification (merged in… — `—`
- P1-248 [High] Voiding/disputing a settlement with an in-flight Stripe payout strands it terminally. — `oxsteedCreditAdminService.js:1581-1587`
- P1-249 [Medium] Backfill rows parked as failed are never retried and never surfaced; — `oxsteedCreditSubBankService.js:458-527`
- P1-250 [Medium] Daily $500 adjustment cap has a concurrency race — `agentCreditAdjustmentController.js:188-208`
- P1-251 [Medium] Single-super-admin orgs can never complete maker-checker approvals — `admin.js:470-472`
- P1-252 [Medium] Cycle-created pending settlements have no nudge or expiry — `—`
- P1-253 [Medium] Pending-action expiry is lazy-only; — `oxsteedCreditPendingActionService.js:492-509`
- P1-254 [Medium] Manual mark-paid can record a false payment reference over an in-flight Stripe transfer — `—`
- P1-255 [Medium] A refund backfill can post without its redemption counterpart being replayed — `oxsteedCreditSubBankService.js:386-410`

### P1 10. Messaging/chat

- P1-264 [High] Guest-chat AI fallback state machine is unimplemented — `jobs/guestChatSessionTimeout.js:59-68`
- P1-265 [Medium] Duplicate push fan-out — `services/notificationService.js`
- P1-266 [Medium] Restaurant owner can message their own restaurant; — `foodController.js:6548-6550`
- P1-267 [Medium] No retention enforcement for guest chat tables — `—`
- P1-268 [Medium] message_notification_outbox terminal failed rows are dead letters with no admin visibility or retry — `jobs/messageNotificationOutbox.js:44`
- P1-269 [Medium] pushsubscriptionchange never re-registers with the server — `client/public/sw.js`
- P1-270 [Low] notifyMoneyMoment('wallet_topup') is documented but never fired (client/src/utils/pwaInstall.js:11,117; — `client/src/utils/pwaInstall.js:11,117`

### P1 12. Restaurant media

- P1-285 [High] Video upload accepted (HTTP 202) when no safety path can ever clear it; — `mediaAssetController.js:204-250`
- P1-286 [High] No timeout or cancel for in-flight uploads; — `client/src/api/media.js:27-44`
- P1-287 [Medium] Auto-hidden posts are silent to the author; — `mediaController.js:2265-2345`
- P1-288 [Low] Stale client asset-state mapping — `—`

### P1 13. QR payments

- P1-298 [High] Payer success page is a dead end (and every successful payer hits it, given the above). — `PayByQrPage.jsx`
- P1-299 [Medium] PUBLIC_APP_URL unset breaks QR codes and checkout; — `qrPayments.js:81`
- P1-300 [Medium] Payment count always shows "0 payments" — `QrPaySetupPage.jsx:395-397`
- P1-301 [Medium] Payee gets no notification of a received payment — `qrPayments.js`
- P1-302 [Medium] 409 message addresses the wrong actor — `qrPayments.js:98-103`
- P1-303 [Low] Credit-payment path (payQrWithCredit, qrPayments.js:619-669) has no client UI — `qrPayments.js:619-669`

### P1 14. Featured placements

- P1-312 [High] Re-requesting after a decline never re-enters the queue. — `businessMarketingController.js:143-147`
- P1-313 [High] Approving a second restaurant of the same business strands the first. — `FeaturedPlacementReview.jsx:248-260`
- P1-314 [High] Sticky expired state, admin dead end — `FeaturedPlacementReview.jsx:188-190`
- P1-315 [Medium] Latent inconsistency — `mainAppController.js:584-585,602-603`
- P1-316 [Medium] declineRequest has no status guard — `—`
- P1-317 [Medium] Copy/code mismatch — `PromotePage.jsx:1336`
- P1-318 [Medium] approve and contact lack server-side status guards (e.g. — `—`

### P1 15. Universal entity IDs + Didit identity verification

- P1-331 [High] Silently broken auto-pass (merged into Top 10 #9). — `—`
- P1-332 [Medium] duplicate_of entity links are never created live — `diditController.js:157-172`
- P1-333 [Medium] Latent schema/handler drift — `webhookController.js:1371,1501`
- P1-334 [Medium] Stale comment, verify current policy — `routes/didit.js:10-12`

### P1 16. Learn/guide videos

- P1-345 [High] No staleness alerting on the pending queue — `—`
- P1-346 [Medium] URL-string dedupe, not video-ID dedupe — `—`
- P1-347 [Medium] Flags have no interim effect — `—`
- P1-348 [Medium] Admin queues truncate silently at 200 rows (adminListVideoSubmissions :1313, adminListVideoFlags :1560, newest-first) wh… — `—`
- P1-349 [Medium] Resubmission loop after flag-delete — `—`
- P1-350 [Low] Per-submission worker failures are silent (rollback with no log line in publishDueGuideVideos); — `—`
- P1-351 [Low] Duplicate schedule entry — `workerMain.js:216-217`

### P1 17. Support flows

- P1-360 [High] Complaint barrier is client-only and bypassable (merged into Top 10 #10). — `—`
- P1-361 [High] Promised ticket reopen does not exist. — `supportController.js:718`
- P1-362 [Medium] Warranty claim filed with no notice to the counterparty (fileWarrantyClaim :467-487, resolveWarrantyClaim :507-534) — `—`
- P1-363 [Medium] Claim status under_review is unreachable (merged with agreements-area finding) — `—`
- P1-364 [Medium] support_tickets have no SLA or stale handling — `—`
- P1-365 [Medium] "Reply to this email" is a dead end — `supportController.js:882-884`
- P1-366 [Low] updateStatus allows any->any transitions (:679-690) with no guard or reopen audit (e.g. — `—`

### P2 1. Admin/super-admin operational flows

- P2-453 [High] Admin bid/review moderation can never complete (Top 10 #3). — `—`
- P2-454 [High] Admin food-order refund succeeds at Stripe but returns 500 and writes no audit (Top 10 #4). — `—`
- P2-455 [High] Timed user suspensions never auto-lift (Top 10 #5). — `—`
- P2-456 [High] The super-admin "Restrict" action is a dead flag — `server/controllers/superAdminController.js:738,751`
- P2-457 [High] Enforcement-system "full account lock" enforced on exactly 2 routes — `controllers/enforcementController.js:150-153`
- P2-458 [Medium] Settings change-request maker-checker is bypassable — `superAdminController.js:2313`
- P2-459 [Medium] Credit dispute provisional credit and resolution compensation bypass maker-checker — `oxsteedCreditController.js:813-870`
- P2-460 [Medium] "Flag business for review" is a dead end — `businessModerationController.js:358-386`
- P2-461 [Medium] Purpose-bound read audit for admin food orders never records — `adminFoodOrdersController.js:14-23`
- P2-462 [Medium] Agent booking cancel requires issue_refunds but moves no money — `agentBookingActions.js`
- P2-463 [Medium] Restriction types checkout and all are dead — `checkRestrictions.js:14-24`
- P2-464 [Medium] Business moderation audit failures are swallowed — `businessModerationController.js:104-108,368-374,459-464`
- P2-465 [Low] suspendUser only disconnects sockets; — `—`
- P2-466 [Low] Admin food-order refund 400s for oxsteed_credit payment_mode (adminFoodOrdersController.js:125-166) — pass-1 gap — `adminFoodOrdersController.js:125-166`

### P2 2. Helper dashboard and helper onboarding

- P2-476 [High] Onboarding pre-completed at OTP; — `—`
- P2-477 [High] Helper terms consent is fabricated — `AccountForm.tsx:215,538-559`
- P2-478 [High] Helper cannot mark a job complete from the UI; — `JobDetailPage.jsx:575-583`
- P2-479 [High] No "my assigned jobs" view — `jobController.js:1286`
- P2-480 [High] PUT /api/bids/:id (edit bid) has no client UI (bidController.js:266-289); — `bidController.js:266-289`
- P2-481 [High] POST /api/payments/payout/instant has no client UI (paymentController.js:465+) — `paymentController.js:465+`
- P2-482 [High] Deprecated public POST /helper-registration/complete is a live 500-trap — `routes/helperRegistration.js:27`
- P2-483 [Medium] 13 dead onboarding endpoints (merged with onboarding-area M1) — `—`
- P2-484 [Medium] Re-submitting ID verification silently revokes an approved verification — `superAdminController.js:956`
- P2-485 [Medium] No job_started notification — `jobController.js:940-1008`
- P2-486 [Medium] W9 completion gates nothing — `middleware/auth.js:40`
- P2-487 [Medium] Directory fail-open on listing toggle — `helpersController.js:220`
- P2-488 [Medium] Connect banner "ready" ignores payouts_enabled — `HelperStripeConnectBanner.jsx:40`

### P2 3. Business hub and merchant/restaurant dashboard

- P2-498 [High] Team remove/approve/deny 503 behind VORTEX_ENABLED (default off) while UI presents them unconditionally — `routes/businessTeam.js:24`
- P2-499 [High] Manager invite/revoke 404s — `routes/businesses.js:152-153`
- P2-500 [High] No way to block bookings for time off — `bookingSlotEngine.js:169,305`
- P2-501 [High] Business-appointment lifecycle has zero notifications and the controller's sendNotification is a log-only placeholder — `businessAppointmentsController.js:418-421`
- P2-502 [Medium] UI role labels diverge from server enforcement both directions — `en.json:6401`
- P2-503 [Medium] Two revenue figures on the same merchant dashboard disagree by definition — `FoodMerchantPage.jsx:2130-2148`
- P2-504 [Medium] Kiosk quote/create divergence — `foodController.js:2302-2323`
- P2-505 [Medium] Two availability computations disagree — `bookingController.js:856-913`
- P2-506 [Medium] Payout notification gaps — `restaurantPayoutService.js:464-488,570-572`
- P2-507 [Medium] Invoice markInvoicePaid (businessInvoiceController.js:230-270) and voidInvoice (:828+) notify nobody, though money-affec… — `businessInvoiceController.js:230-270`
- P2-508 [Medium] Email invite to a non-account user is silent — `businessMembersController.js:86-99`
- P2-509 [Medium] Dead endpoints, latent footguns — `bookingSlotEngine.js:163`
- P2-510 [Medium] Publish readiness goes stale post-publish — `businessController.js:486`
- P2-511 [Low] Dead BusinessHubComplete.jsx (169 lines, zero imports, no route). — `BusinessHubComplete.jsx`

### P2 4. Delivery/runner flows and restaurant POS

- P2-523 [High] Merchant "Refund" button dead twice over (Top 10 #8). — `—`
- P2-524 [High] Merchant "Merge"/"Split" buttons 404 on double-prefixed URLs (Top 10 #8). — `—`
- P2-525 [High] Generic POS refund on terminal-card order fails open (Top 10 #8). — `—`
- P2-526 [High] Parcel-delivery driver payouts don't exist (Top 10 #10). — `—`
- P2-527 [High] Runner settlement endpoints have no client UI (routes/restaurants.js:314,316,317,312) — `routes/restaurants.js:314,316,317,312`
- P2-528 [Medium] cash_collection_required frozen at task creation (foodController.js:836); — `foodController.js:836`
- P2-529 [Medium] Restaurant-runner proof is self-attested and formally bypassable — `restaurantRunnerController.js:486-491`
- P2-530 [Medium] Runner cash collection is self-reported with no remittance reconciliation — `—`
- P2-531 [Medium] Food-delivery live tracking is write-only — `RestaurantRunnerPage.jsx:2`
- P2-532 [Medium] No self-serve driver onboarding for parcel delivery — `localDeliveryDispatchService.js:85-95`
- P2-533 [Medium] POS shift-close ignores cash refunds — `restaurantAppFlowController.js:3262-3269`
- P2-534 [Medium] Agent console refund button invites rejected actions — `Customer360Panel.jsx:304-307`
- P2-535 [Medium] POS offline-sync pipeline is server-only — `routes/restaurants.js:245-248`
- P2-536 [Medium] Runner page swallows the proof-required error — `RestaurantRunnerPage.jsx`
- P2-537 [Low] Dead code — `restaurantAppFlowController.js:7169-7171,7225`
- P2-538 [Low] Dead branch — `—`
- P2-539 [Low] Field mismatch — `RestaurantRunnerPage.jsx:24`

### P2 5. Wallet and statement center

- P2-549 [High] Customer top-up (fiat money IN) has no client UI; — `WalletPage.jsx:155-158`
- P2-550 [High] Per-transaction investigation page is unreachable — `App.jsx:622`
- P2-551 [Medium] Accessible-view CSV permanently disabled for restaurant-credit statements — `statementProducts.js:19-26`
- P2-552 [Medium] On-demand monthly issuance skips the 72-hour grace window — `statementIssuancePolicy.js:40`
- P2-553 [Medium] Wallet "Last statement balance/date" is live-computed, not the issued document — `oxsteedCreditService.js:3726-3765`
- P2-554 [Medium] /oxsteed-credit "Monthly statements" panel hides amendment state — `OxsteedCreditPage.jsx:324-352`
- P2-555 [Medium] /wallet shows only the first currency with no picker (WalletPage.jsx:54), contradicting the page's own "one glance at ev… — `WalletPage.jsx:54`
- P2-556 [Low] StatementExportPage without a jobId renders a permanently dead form (StatementExportPanel.jsx:52); — `StatementExportPanel.jsx:52`
- P2-557 [Low] Archive artifact row crashes on falsy artifact.state (StatementArchivePage.jsx:257 TypeError -> error boundary); — `StatementArchivePage.jsx:257`
- P2-558 [Low] No "Back to wallet" link from /oxsteed-credit; — `—`

### P2 6. Subscriptions and referrals

- P2-569 [Critical] Credit-funded subscriptions have no cancel path (Top 10 #1). — `—`
- P2-570 [High] Referrer paid twice per referred user (Top 10 #7). — `—`
- P2-571 [High] Referral credit double-spend across payment intents (Top 10 #7). — `—`
- P2-572 [High] customer.subscription.created can never succeed — `webhookController.js:638-640`
- P2-574 [High] Stripe subscription statuses written verbatim into a Postgres ENUM that does not cover them — `001_initial_schema.sql:23-30`
- P2-575 [Medium] Duplicate active subscriptions possible — `subscriptionController.js:119-134`
- P2-576 [Medium] Invalid referral codes fail silently — `authController.js:1051`
- P2-577 [Medium] The referral discount is funded by the helper, not the platform — `paymentController.js:311-313`
- P2-578 [Medium] past_due Stripe subscribers cannot cancel in-app — `—`
- P2-579 [Medium] Referral rewards are fail-open with no reconciliation — `referralController.js:61-63`
- P2-580 [Medium] Referral code farming has no guards — `—`
- P2-581 [Low] cancelSubscription's 409 "already in progress" branch is dead — `—`
- P2-582 [Low] Credit checkout returns no url, but useSubscription.createCheckout (useSubscription.js:39-44) unconditionally does windo… — `useSubscription.js:39-44`
- P2-583 [Low] getPlans silently drops the active-filter when plans has neither active nor is_active (subscriptionController.js:36-38). — `subscriptionController.js:36-38`

### P2 7. Onboarding and verification gates

- P2-593 [High] Helper onboarding entirely skippable (merged with helper-dashboard H1; — `—`
- P2-594 [High] Background-check onboarding step permanently unreachable (403 forever) — `routes/helperRegistration.js:64-68`
- P2-595 [High] Paid helper tier2 permanently unreachable — `helperRegistrationController.js:739-753`
- P2-596 [High] Helpers go live with empty profile and zero verification (merged with helper-dashboard H4; — `routes/helpers.js:22`
- P2-597 [Medium] 13 dead onboarding endpoints (merged with helper-dashboard M8; — `—`
- P2-598 [Medium] requireEmailVerified covers only jobs/bids/helper-registration (routes/bids.js:22, routes/jobs.js:47, routes/helperRegis… — `routes/bids.js:22`
- P2-599 [Medium] checkRestrictions('checkout') defined but mounted nowhere (checkRestrictions.js:78); — `checkRestrictions.js:78`
- P2-600 [Medium] requireTermsAcceptance mounted nowhere (middleware/requireTermsAcceptance.js); — `middleware/requireTermsAcceptance.js`
- P2-601 [Medium] requirePlatformApproval mounted nowhere (middleware/requirePlatformApproval.js); — `middleware/requirePlatformApproval.js`
- P2-602 [Medium] No cleanup for abandoned pending_registrations — `—`
- P2-603 [Medium] Three parallel identity models unreconciled (theme #5) — `superAdminController.js:953-975`
- P2-604 [Medium] Didit latent lockout trap — `middleware/auth.js:217-227`
- P2-605 [Low] didit_status='duplicate' fails the API gate (diditGate.js:17-23) with no in-app explanation; — `diditGate.js:17-23`
- P2-606 [Low] Stale comment in routes/didit.js:10-12 contradicts diditAllowUserSkip() (same class as pass 1's finding). — `routes/didit.js:10-12`

### P2 8. Settings, saved items, favorites, reviews

- P2-616 [High] Payout methods are self-verifiable — `PayoutController.js:214-243`
- P2-617 [High] The master "Order Updates" email toggle is ignored by the primary notification path — `EmailPreferences.jsx`
- P2-618 [Medium] 12 notification-preference toggles are dead — `notificationController.js:176-187`
- P2-619 [Medium] email_frequency (daily/weekly/off) is misleading — `emailDigestBatch.js:72-78`
- P2-620 [Medium] sms_notifications and push_notifications master toggles honored nowhere — `smsNotificationService.js:70-95`
- P2-621 [Medium] Quiet-hours push suppression unwireable — `notificationService.js:87`
- P2-622 [Medium] PUT /calendar/notification-preferences has no client UI (zero callers) — `—`
- P2-623 [Medium] SMS per-type preferences dead — `smsNotificationService.js:19-42`
- P2-624 [Medium] allow_scheduling is a dead privacy toggle (same class as pass-1's allow_booking) — `settingsPrivacyController.js:46-49`
- P2-625 [Medium] allow_live_chat is a client-only gate — `profileChatRouting.js:52`
- P2-626 [Medium] Changing your phone number keeps phone_verified=TRUE — `authController.js:1701`
- P2-627 [Medium] Adding a second payout method 500s — `PayoutController.js:183`
- P2-628 [Medium] Bank payout methods store only last-four fragments, so they have no payable destination — `affiliatePayoutsController.js:313-315`
- P2-629 [Medium] Restaurant/dish favorites are server endpoints with no client UI — `routes/food.js:69-72`
- P2-630 [Medium] A business owner can unilaterally delete any review on their business — `reviewsController.js:272-317`
- P2-631 [Medium] Business-review "new review" notification silently never sends — `reviewsController.js:80-94`
- P2-632 [Medium] Two parallel owner-response systems diverge — `reviewsController.js:209-271`
- P2-633 [Medium] No in-app dispute/report path for job/business reviews — `reviewModerationController.js:77-84`
- P2-634 [Medium] Food reviews have no edit, delete, respond, or dispute flow — `foodController.js:6258`
- P2-635 [Medium] Tool reviews have no eligibility check — `toolReviewsController.js:35-79`
- P2-636 [Medium] Saved-helpers list shows unlisted/admin-hidden helpers — `lifeDashboardController.js:613-649`
- P2-637 [Low] adminHideReview recalculates avg_rating/total_reviews but not search_rank_boost (reviewController.js:252-293 vs :86-121)… — `reviewController.js:252-293`
- P2-638 [Low] Dashboard saved-helpers unsave button is hover-only (Dashboard.jsx:1804, opacity-0 group-hover:opacity-100) — unreachabl… — `Dashboard.jsx:1804`
- P2-639 [Low] toggleFavorite for tools has no tool-existence check (toolFavoritesController.js:21-55); — `toolFavoritesController.js:21-55`
- P2-640 [Low] businessReviewMgmtController.js is dead code (never required; — `businessReviewMgmtController.js`
- P2-641 [Low] marketing_emails honored only by customerReengagementJob.js:48; — `customerReengagementJob.js:48`

### P2 9. Launch-gated product areas and franchise

- P2-652 [High] Unlaunched marketplace purchasable (Top 10 #2). — `—`
- P2-653 [High] Five unauthenticated public intake endpoints accept caller-supplied status — `beautyOperationsController.js:306`
- P2-654 [High] POST /api/professional-operations/public/:businessId/intakes is unauthenticated AND unthrottled (routes/professionalOper… — `routes/professionalOperations.js:9`
- P2-655 [High] Submitted intakes go nowhere observable — `BusinessHubPage.jsx:1810-1876`
- P2-656 [Medium] intake_enabled displayed but never enforced — `maintenanceRequestController.js:131-152`
- P2-657 [Medium] Assigned maintenance helper cannot discover the assignment — `routes/maintenanceRequests.js:8-19`
- P2-658 [Medium] Franchise initial fee ($25,000) and marketing fee (2%) recorded but never collected — `franchiseController.js:266-280`
- P2-659 [Medium] Franchise royalty territory matching is fuzzy with arbitrary winner — `jobController.js:1141-1153`
- P2-660 [Medium] Franchise agreement "signing" is admin-asserted; — `routes/franchise.js:38`
- P2-661 [Medium] convertToJob bypasses job-posting guards and drops the tenant — `maintenanceRequestController.js:466-556`
- P2-662 [Medium] Template-intake redirect not wired to its flag — `launchScope.js:126-130`
- P2-663 [Medium] The "$0.99/month" template billing model has no implementation — `templateController.js:192-197`
- P2-664 [Low] Franchise royalty only fires on job completion (jobController.js:1134); — `jobController.js:1134`

### P2 10. In-chat commerce paths

- P2-675 [High] Payment requests open-forever; — `—`
- P2-676 [High] createMessengerGuestBooking signed-in branch ignores idempotency — `chatController.js:1900-1907`
- P2-677 [High] Guest messenger booking creates the appointment before the durable booking_request, and a mirror failure orphans it — `chatController.js:2117-2162`
- P2-678 [Medium] Accepted/approved quotes never expire; — `chatQuotesController.js:1029-1031`
- P2-679 [Medium] reviseQuote has no status gate — `chatQuotesController.js:849`
- P2-680 [Medium] reviseAgreement has no status gate — `chatAgreementsController.js:590`
- P2-681 [Medium] Quote payment metadata attachable to any quote_id with no ownership/thread validation — `services/chatOxsteedCreditPayment.js:118-158`
- P2-682 [Medium] Refund of a chat credit payment doesn't roll back quote paid metadata — `chatOxsteedCreditPaymentController.js:886-1180`
- P2-683 [Medium] A declined required_before_schedule agreement has no customer-side exit — `chatAgreements.js:189-198`
- P2-684 [Medium] acceptBookingRequest keeps the accept but silently skips the appointment on non-rollback failures — `bookingRequestLifecycle.js:1009-1020`
- P2-685 [Medium] respondAgreement has no user-room socket fan-out for token-only acceptance — `chatAgreementsController.js:480-588`
- P2-686 [Low] linkBookingToChat is dead code (exported chatBookingRequestsController.js:798, zero callers). — `chatBookingRequestsController.js:798`
- P2-687 [Low] Intakes are one-shot and guest-only by construction (chatClientIntakeController.js:121, :80-86) — a second round of ques… — `chatClientIntakeController.js:121`
- P2-688 [Low] Accepted chat agreements are a terminal record with zero downstream linkage (migration 534; — `chatAgreementsController.js`

### P3 1. Core payments engine

- P3-786 [High] The entire user payout surface is dead — `server/controllers/PayoutController.js:14,96,160,214,241,270`
- P3-787 [High] Affiliate self-serve payout (POST /api/affiliate-payouts/:payoutId/process) — `server/controllers/affiliatePayoutsController.js:281-428`
- P3-788 [High] No void path for authorized (uncaptured) payments — `paymentRefundReconciliation.js`
- P3-789 [High] Referral-credit deduction on payment_intent.amount_capturable_updated is not transactional with the authorized status up… — `server/controllers/webhookController.js:818-845`
- P3-792 [Medium] capturePayment COMMITs its SERIALIZABLE txn before the Stripe capture — `server/controllers/paymentController.js:600-640`
- P3-793 [Medium] payment_intent.succeeded marks Tier-3 captured + releases escrow with no credit_applied deduction and WHERE status != 'c… — `server/controllers/webhookController.js:886-900`
- P3-794 [Medium] (partial) payment_intent.payment_failed / payment_intent.canceled update with no status guard — `server/controllers/webhookController.js:978-986,1029-1037`
- P3-795 [Medium] Cancel guard checks payments.escrow_status IN ('authorized','held','disputed'), but authorized/held are never written to… — `server/services/jobCancellationService.js:99-108`
- P3-796 [Medium] No audit trail or user notification on payout-destination changes (only logger.info) — `server/controllers/PayoutController.js`
- P3-797 [Medium] createPaymentIntent has no job-status check — `server/controllers/paymentController.js:236-280`
- P3-798 [Medium] disconnectConnectAccount — `server/controllers/paymentController.js:688-722`
- P3-799 [Medium] Every createPaymentIntent does a live stripe.accounts.retrieve on the helper and fails ALL Tier-3 payment creation on St… — `server/controllers/paymentController.js:50-92`
- P3-800 [Medium] Instant payouts — `server/controllers/paymentController.js:465-560`
- P3-801 [Medium] Contract lists checkout.session.async_payment_succeeded/async_payment_failed/expired but the switch has no handlers -> a… — `server/config/stripeWebhookContract.js:19-22`
- P3-802 [Medium] payment_hold_status is write-only (zero readers) — `server/services/paymentRefundService.js`
- P3-803 [Low] payments.status='released' referenced but never written (dead enum value in live paths). — `—`
- P3-804 [Low] Lost-dispute dispute_lost ledger entries post against the payee in platform_ledger while the debit lands on the helper's… — `—`
- P3-805 [Low] Concurrent createConnectAccount can orphan a second Stripe Express account (ON CONFLICT (user_id) keeps the first id). — `server/controllers/paymentController.js:190-200`

### P3 2. Disputes full lifecycle

- P3-814 [Critical] No Stripe evidence submission anywhere — `server/controllers/webhookController.js:1075-1125`
- P3-815 [High] Admin resolve UI/server vocabulary mismatch — `client/src/admin/pages/DisputeResolve.jsx:44-58,88-95`
- P3-816 [High] Freeze guards test ('open','in_progress') instead of ('open','under_review') in completeJob, closeJob, and reservePaymen… — `server/controllers/jobController.js:1039,1224`
- P3-817 [High] Counterparty locked out of their own dispute — `server/controllers/disputeController.js:335-337,380,~410,~560`
- P3-818 [High] No UI entry point to open a job dispute — `DisputeSubmissionModal.tsx`
- P3-819 [High] Credit dispute lifecycle is notification-silent — `server/services/oxsteedCreditDisputeService.js`
- P3-820 [High] Dispute detail/admin pages render fields the API never returns (job_title, job_amount, against_user_name, resolution_not… — `—`
- P3-821 [High] main_app_payment_disputes is a third, unresolvable dispute system — `server/controllers/mainAppController.js:2490`
- P3-822 [Medium] Disputes re-openable after resolution; — `server/controllers/disputeController.js:178-182`
- P3-823 [Medium] Evidence submission silently dies at review — `—`
- P3-824 [Medium] Server never emits dispute:message; — `—`
- P3-825 [Medium] split_resolution parks escrow in 'split_refund', which zero code reads — `server/utils/disputeResolution.js:12`
- P3-826 [Medium] Enforcement appeals have no admin UI — `—`
- P3-827 [Medium] Credit admin SLA display (10 business days) contradicts the server SLA (72h with critical incidents). — `client/src/admin/pages/super/oxsteedCredit/DisputesPage.jsx:22`
- P3-828 [Medium] Dead dispute code, some dangerous — `—`
- P3-829 [Medium] Dispute evidence immutability is opt-in and unused — `—`
- P3-830 [Medium] Status column unconstrained — `—`
- P3-831 [Medium] DisputeResolutionPage.jsx is a legal-policy page despite its name; — `DisputeResolutionPage.jsx`
- P3-832 [Low] getAllDisputes single-status filter; — `—`
- P3-833 [Low] startReview is one-way — `—`

### P3 3. Email and SMS notification pipeline

- P3-842 [High] Checkr webhook crashes on every completed report — `verificationController.js:5`
- P3-844 [High] sendEmail returns {success:false} instead of throwing and most direct callers ignore it — `quoteRequestsController.js:139`
- P3-845 [High] Money-critical failure emails never send — `notificationService.js:196-213`
- P3-846 [High] The credit notification outbox missed the stale-worker fencing migration 592 gave the other two outboxes — `server/jobs/oxsteedCreditNotificationOutbox.js`
- P3-847 [Medium] Dispute emails never sent — `—`
- P3-848 [Medium] No refund notification of any kind — `—`
- P3-849 [Medium] Tier-3 payer gets no payment receipt — `paymentController.js`
- P3-850 [Medium] Failed food-order card payment notifies nobody — `webhookController.js:932-990`
- P3-851 [Medium] food_order_ready never emailed despite the code comment claiming one call covers email. — `server/controllers/foodController.js:1558`
- P3-852 [Medium] calendar_notifications rows marked 'failed' are never retried and have no admin surface. — `server/controllers/calendarNotificationController.js:270-282`
- P3-853 [Medium] PII in plaintext logs — `utils/email.js:260,295,298,301`
- P3-854 [Medium] Template-render failure in sendNotification -> email silently lost while the outer call returns {success:true}, so outbo… — `server/services/notificationService.js:236-242,310-325`
- P3-855 [Medium] supportWaitService.js:80-88 hardcodes the founder alert recipient; — `supportWaitService.js:80-88`
- P3-856 [Medium] notifications table has no retention purge (only user-initiated deletes); — `—`
- P3-857 [Low] OTP resend cooldown is written before send success, so a Resend outage still blocks retry for 60s. — `server/controllers/authController.js:722-733`
- P3-858 [Low] Welcome-email Resend idempotency key welcome:${user.id} has no timestamp — `—`
- P3-859 [Low] Two parallel email systems and two parallel SMS stacks with different guarantee semantics (the SMTP one likely dead). — `—`
- P3-860 [Low] Raw-HTML reminder emails bypass the branded template and have no text part. — `—`

### P3 4. Background workers and scheduled jobs inventory

- P3-870 [High] Affiliate commission batch double-insert race (see Top 10 #10). — `server/jobs/affiliateCommissionBatch.js:36-105`
- P3-873 [Medium] jobs/emailDigestBatch.js is a shipped feature never wired — `jobs/emailDigestBatch.js`
- P3-874 [Medium] recurringJobScheduler has no fenced lock (server/jobs/recurringJobScheduler.js:38-60) — `server/jobs/recurringJobScheduler.js:38-60`
- P3-875 [Medium] Weekly/digest notifications send without idempotency keys (weeklySummary.js:82-94, plannedNeedsScheduler.js, discoverDig… — `weeklySummary.js:82-94`
- P3-876 [Low] Duplicate expireVortexTokens entry in workerMain.js:216-217 (latent; — `workerMain.js:216-217`
- P3-877 [Low] expireVortexTokens dead -> expired business_invite_tokens never marked revoked (redemption enforces expires_at server-si… — `—`
- P3-878 [Low] passkeyWorkers.cleanupExpiredChallenges dead (growth bounded by saveChallenge per-user delete). — `—`
- P3-879 [Low] Per-minute cron thundering herd at shared seconds (:20 and :55); — `—`

### P3 5. Webhook infrastructure

- P3-888 [Critical] Crash-window silent drop (see Top 15 #7). — `server/controllers/webhookController.js:456-460,553-559`
- P3-889 [High] Referral credit_applied double-applies on webhook retry after partial failure — `webhookController.js:828-842`
- P3-890 [High] checkout.session.async_payment_succeeded/async_payment_failed/expired are in the contract but unhandled — `server/controllers/webhookController.js:568-1145`
- P3-891 [High] Failed inbound webhook receipts have no operational recovery — `server/controllers/webhookController.js:508-518`
- P3-892 [High] Didit webhook has no stale-verdict protection — `webhookController.js:1252-1282`
- P3-893 [Medium] Didit freshness timestamp is not bound to the signature in any of the three accepted schemes — `server/controllers/webhookController.js:1193-1250,1253`
- P3-894 [Medium] Telematics adapters have no timestamp freshness check; — `server/controllers/deliveryTelematicsWebhookController.js:283-330`
- P3-895 [Medium] Checkr has no envelope and no recency guard — `server/controllers/verificationController.js:118-160`
- P3-896 [Medium] Unset webhook secrets for Checkr, support channels, and telematics produce zero startup signal (utils/validateEnv.js omi… — `utils/validateEnv.js`
- P3-897 [Medium] Stripe Identity webhook has no dedupe envelope and no stale guard — `server/controllers/verificationController.js:245-304`
- P3-898 [Low] payment_intent.succeeded job branch re-sends the "payment released" helper notification on every retry-after-partial-fai… — `server/controllers/webhookController.js:900-908`
- P3-899 [Low] utils/webhookVerification.js is dead code (only its own doc comment references it). — `utils/webhookVerification.js`
- P3-900 [Low] Stale comment at routes/didit.js:16-18 misdirects future webhook work to the unwired handler (pass 1 #9). — `routes/didit.js:16-18`
- P3-901 [Low] webhook_event_receipts and webhook_event_watermarks have no retention/cleanup — `—`
- P3-902 [Low] Two live Didit routes (/api/webhooks/didit and legacy /api/didit/webhook) — `—`
- P3-903 [Low] Support channel computes payload_hash but never compares it — `—`

### P3 6. File upload and media pipeline

- P3-912 [High] Agreement "vault" has no file storage at all and accepts unvalidated URL strings that render raw — `server/controllers/workAgreementController.js:383-460`
- P3-913 [High] Logistics shipment documents are write-only — `server/controllers/logisticsShipmentsController.js:57-81`
- P3-916 [High] Chat attachment uploads have no rate limiter — `server/routes/messages.js:95`
- P3-917 [Medium] Self-selected public purposes on POST /api/upload/* let any authenticated user mint permanent public URLs for arbitrary … — `server/routes/upload.js:28-52`
- P3-918 [Medium] EXIF/GPS stripped only for restaurant-media and media-creator photos; — `server/controllers/restaurantMediaController.js:739`
- P3-919 [Medium] No limitInputPixels on any sharp pipeline — `—`
- P3-920 [Medium] Inconsistent malware posture — `server/middleware/validateFileUpload.js`
- P3-922 [Medium] Job creation accepts arbitrary media_urls from the request body with no URL validation — `server/controllers/jobController.js:103-108`
- P3-923 [Medium] Support messages accept caller-supplied attachmentUrl verbatim when it starts with /api/storage/ — `server/controllers/supportConversationsController.js:111-128`
- P3-924 [Medium] No per-user/per-day storage quota on any upload surface (generic /api/upload — `—`
- P3-925 [Medium] Partial upload failures silently drop files — `server/controllers/beautyOperationsController.js:294-303`
- P3-926 [Medium] Retention cleanup deletes DB rows only and misses the active table — `cleanupOldMessages.js`
- P3-927 [Low] /chat/transcribe accepts base64 audio_data in JSON, bypassing multer's 10 MB/type checks (blunted by the 1 MB express.js… — `express.json`
- P3-928 [Low] Dead if (!key) branches — `—`
- P3-929 [Low] Client/server media-type mismatch on job posts — `client/src/pages/PostJobPage.jsx:1010-1017`
- P3-930 [Low] Direct draft assets (direct-draft-assets/<draftId>/) never cleaned if the draft is abandoned; — `—`
- P3-931 [Low] businessProfileImages/helperProfile multer fileFilter errors aren't mapped to JSON 400s (raw Error propagates). — `—`

### P3 7. Feature flags and launch-visibility system

- P3-940 [High] Unlaunched consulting product takes real money — `routes/consulting.js`
- P3-941 [High] Credit-rail kill switch bypass via the generic feature-flag PUT (see Top 15 #8). — `server/routes/admin.js:277`
- P3-942 [High] Subscription purchase flow is server-live but client-dead — `Dashboard.jsx:1525`
- P3-943 [High] Client renders the entire Vortex surface as launched while every backing endpoint 503s by default — `businessTeam.js`
- P3-944 [Medium] 16 of 17 seeded feature_flags keys are dead, some contradict each other (referral_system_enabled=true vs referral_progra… — `server/migrations/001_initial_schema.sql:651-658`
- P3-945 [Medium] Three client LAUNCH_VISIBILITY flags declared but consumed nowhere — `—`
- P3-946 [Medium] maintenance_mode, new_user_registrations, require_id_verification are admin-editable but read by nothing at runtime. — `—`
- P3-947 [Medium] feature_flags.rollout_pct column exists with zero readers — `—`
- P3-948 [Medium] Client/server contradiction on media launch state — `server/middleware/launchGate.js:47-49`
- P3-949 [Medium] Env flags have no admin surface and no audit; — `—`
- P3-950 [Medium] DIDIT_ALLOW_USER_SKIP defaults to **open** (!== 'false' -> skip allowed, server/utils/diditGate.js:13) — `server/utils/diditGate.js:13`
- P3-952 [Low] LAUNCH_GATE_DISABLED=true is a global kill switch for all launch gates (env-only, acceptable, but re-opens every unlaunc… — `server/middleware/launchGate.js:53-55`
- P3-953 [Low] getLaunchRedirect rewrites /orders/:id -> /orders and specialty intake paths unconditionally, not wired to any flag. — `—`

### P3 8. Business appointment booking flow

- P3-962 [Critical] Booking-request deposits stranded in every terminal path (see Top 15 #6). — `server/controllers/mobileController.js:580-728`
- P3-963 [High] The customer booking page 404s for every customer — `BookServicePage.jsx:194-211`
- P3-964 [High] no_show capacity semantics split across four guards -> phantom accepts and permanently blocked slots — `server/controllers/businessAppointmentsController.js:18-31`
- P3-965 [High] updateAppointmentStatus allows any->any transitions with zero guards — `server/controllers/businessAppointmentsController.js:225-262`
- P3-966 [High] Cancellation policy, late-cancel fee, and require-payment-upfront are dead config — `server/services/bookingSlotEngine.js:62-90`
- P3-967 [Medium] Two cancel paths diverge — `client/src/pages/AppointmentCalendarView.jsx:284-285,300-301`
- P3-968 [Medium] No staff-reassignment path — `—`
- P3-969 [Medium] Reschedule bypasses enforceBookingRules (not mounted on that route) — `server/controllers/businessAppointmentsController.js:54-60,292-372`
- P3-970 [Medium] POST .../reschedule and POST .../cancel have zero client callers (hub uses PUT status). — `—`
- P3-971 [Medium] No staff-facing create-appointment UI — `—`
- P3-972 [Medium] releaseStaleAcceptedBookings flips accepted -> accepted_cancelled after the scheduled end even when the service was deli… — `server/controllers/bookingController.js:1483-1543`
- P3-973 [Medium] Accept/create lock mismatch — `server/services/bookingRequestLifecycle.js:888`
- P3-974 [Medium] autoPostExpiredBooking converts an expired booking with a possibly-paid deposit into a public job with no deposit linkag… — `server/services/bookingRequestLifecycle.js:64-140`
- P3-975 [Low] rescheduleAppointment hardcodes rescheduled_by_type='business' (mislabels if ever opened to customers). — `—`
- P3-976 [Low] createAppointment ignores req.bookingValidation and re-derives from the body (drift risk). — `—`
- P3-977 [Low] Waitlist is manual-only — `—`

### P3 9. Loyalty program + invoices and receipts

- P3-986 [High] Loyalty redemption is fully built server-side but has zero client UI — `server/controllers/foodController.js:975-1028,2978-2994`
- P3-987 [High] Redeemed loyalty points are never restored on cancel/refund — `server/controllers/foodController.js:923-973`
- P3-988 [High] Super-admin invoice mark-paid/status endpoints bypass every guard the business-side path enforces — `server/routes/invoices.js:95-170`
- P3-989 [High] Recurring-billing generateInvoice is non-transactional with no duplicate-period guard — `server/controllers/businessRecurringBillingController.js:141-175`
- P3-990 [Medium] Earn can silently never happen — `—`
- P3-991 [Medium] Earn has no payment check — `—`
- P3-992 [Medium] The entire business loyalty-tier system is decorative — `CustomerLoyaltyManager.jsx`
- P3-993 [Medium] customer_loyalty_segments (migration 224) has zero writers; — `services/pricingSignals.js:56-63`
- P3-994 [Medium] customer_offers (CHECK includes source='loyalty') has exactly one reader and zero writers — `—`
- P3-995 [Medium] Job (Tier-3) payments have no receipt delivery at all — `server/controllers/paymentController.js:372-387`
- P3-997 [Medium] Credit top-ups (fiat money-in) have no receipt — `—`
- P3-998 [Low] Business invoices have no discount/fee line-item types — `server/utils/businessInvoiceHelpers.js:20-31`
- P3-999 [Low] Tool-rental createInvoice runs its idempotency replay check before the owner check — `—`
- P3-1000 [Low] Earn base includes tip, delivery fee, service fee, tax — `server/controllers/foodController.js:2482,893`

### P3 10. KYC/AML perimeter

- P3-1009 [Critical] Admin credit adjustments bypass the entire compliance choke point (see Top 15 #1). — `server/controllers/oxsteedCreditController.js:662-690`
- P3-1010 [High] Restaurant top-ups bypass the fiat compliance choke point (see Top 15 #14). — `server/services/restaurantTopupService.js:456-530`
- P3-1011 [High] Agent adjustments (<$50, single actor, auto-applied) and dispute provisional credit bypass all KYC/AML gates — `server/routes/agentCreditAdjustments.js:16`
- P3-1012 [High] Restaurant wallet load requests credit customers with no identity/sanctions check — `server/controllers/restaurantCreditAdminController.js:712-800`
- P3-1013 [High] The credit-rail identity-verification request has no client UI; — `server/routes/oxsteedCredit.js:30`
- P3-1014 [High] The Didit auto-grant tier path is dead code — `identityVerificationService.js:264`
- P3-1015 [High] Partner funding (credit_partner_funding) has no sanctions screening (only the rail gate); — `server/services/oxsteedCreditPendingActionService.js:320-333`
- P3-1016 [Medium] 2-year Didit TTL unenforced at the API gate and participant activation — `utils/diditGate.js:17-23`
- P3-1017 [Medium] No SLA for identity verifications or sanctions screenings (only compliance cases have sla_due_at + breach incidents) — `—`
- P3-1018 [Medium] Zero user notification across the verification lifecycle — `—`
- P3-1019 [Medium] No escalation or appeal on verification rejection — `complianceCaseService.js:35-42`
- P3-1020 [Medium] Sanctions vendor interface receives no identity attributes — `sanctionsScreeningService.js:163`
- P3-1021 [Medium] Currency conversions don't screen sanctions (inconsistent with restaurant conversions, which screen both directions). — `server/services/oxsteedCreditCurrencyConversionService.js:446+`
- P3-1022 [Medium] Cancellation-fee helper transfers — `server/services/cancellationFeeService.js:128-168`
- P3-1023 [Medium] Affiliate payouts carry no identity gate at all — `server/controllers/affiliatePayoutsController.js:283-340`
- P3-1024 [Medium] Tax-identity perimeter incomplete — `server/controllers/mainAppController.js:2970-2978`
- P3-1025 [Low] status='expired' on oxsteed_credit_identity_verifications never written (expiry is lazy). — `—`
- P3-1026 [Low] Tier-3 escrow release doesn't check payouts_enabled (latent; — `—`
- P3-1027 [Low] Sanctions queue email resolution only for customers; — `—`
- P3-1028 [Info] Sanctions posture is fail-closed to the point of per-customer daily admin clearance — `—`

### P3 11. Data export, deletion, privacy + audit logging as a system

- P3-1039 [Critical] (partial) Self-delete leaves active Stripe subscriptions billing forever (see Top 15 #2). — `server/routes/privacy.js`
- P3-1040 [Critical] (partial) Self-delete strands oxsteed_credit and food-wallet balances (see Top 15 #3). — `server/routes/privacy.js`
- P3-1041 [High] scheduledDeletionJob can never hard-delete a user with admin_audit_log rows — `server/jobs/scheduledDeletionJob.js:188`
- P3-1042 [High] CCPA/opt-out intake is dead — `server/controllers/ccpaController.js`
- P3-1043 [High] The user data export is materially incomplete — `server/routes/privacy.js`
- P3-1044 [High] Restaurant wallet-payout admin approve/reject has no audit trail — `restaurantPayoutService.js`
- P3-1045 [Medium] Marketplace cart checkout -> paid has no audit trail — `cartCheckoutController.js`
- P3-1046 [Medium] Subscription subscribe/cancel/renewal events have no audit trail — `subscriptionController.js`
- P3-1047 [Medium] Parcel delivery checkout/refund has no audit trail — `localDeliveryController.js`
- P3-1048 [Medium] Consulting payment intents (real Stripe charges) have no audit trail — `consultingPaymentController.js`
- P3-1049 [Medium] Kitchen-cancel food refunds lack actor-stamped audit events — `foodController.js:4174`
- P3-1050 [Medium] Referral reward grants (platform money) have no audit trail — `referralController.js`
- P3-1051 [Medium] Tier-3 job payment-intent creation and escrow capture have no audit trail — `paymentController.js`
- P3-1052 [Medium] security_audit_log has writers but no detailed reader — `server/controllers/adminOperationsController.js:183`
- P3-1053 [Medium] booking_request_audit_log (3 writers), invoice_audit_log (1 writer), calendar_audit_log (2 writers) have zero readers. — `—`
- P3-1054 [Medium] No retention sweeps for sessions, OTPs, or notifications — `—`
- P3-1055 [Medium] compileUserData queries nonexistent payments.user_id (table uses payer_id/payee_id) — `server/controllers/ccpaController.js:545`
- P3-1056 [Low] server/middleware/services/auditService.js (swallow-all logAdminAction) is dead code; — `server/middleware/services/auditService.js`
- P3-1057 [Low] consulting_audit_log, dispute_evidence_audit, helper_location_audits have zero writers and zero readers — `—`
- P3-1058 [Low] Self-delete writes its audit record into user_consents (consent_type='account_deletion'), which the hard-delete job late… — `—`

### P3 12. Tool rental / tool-owner flows + consulting payment flows

- P3-1067 [High] Consulting Stripe payment rail is dead end-to-end — `server/controllers/consultingPaymentController.js:156-159`
- P3-1068 [High] Tool-rental deposits are an unenforceable fiction — `server/routes/toolRentals.js:288-289`
- P3-1069 [High] Consulting sessions are not gated on payment — `server/controllers/consultantSchedulingController.js:230-330`
- P3-1070 [High] Admin consulting invoices can never be marked paid — `server/controllers/adminConsultingController.js:155,709`
- P3-1071 [High] Legacy consulting purchase endpoint is a permanent 503 (feature_disabled "until Stripe integration is added"), and the S… — `server/controllers/allPhasesConsultingController.js:225-232`
- P3-1072 [Medium] Tool-rental double-booking race — `toolBookingsController.js:107-120`
- P3-1073 [Medium] No cancel path after payment_confirmed — `server/controllers/toolBookingsController.js:224-232`
- P3-1074 [Medium] Invoice emails embed the owner's full decrypted payment identifier in plaintext (full bank-account details over email fo… — `server/controllers/invoiceController.js:176`
- P3-1075 [Medium] TermsAcceptanceModal has zero client callers — `—`
- P3-1076 [Medium] Admin ConsultingPayments.jsx hardcodes package prices that diverge from DB seeds — `ConsultingPayments.jsx`
- P3-1077 [Medium] ToolOwnerDashboard "gross earnings" derived client-side from total_price of confirmed/completed bookings, but payments a… — `—`
- P3-1078 [Medium] Tool-rental payment confirmation is unilateral owner self-attestation (owner auth only); — `server/controllers/invoiceController.js:confirmPayment`
- P3-1079 [Medium] No return/handover flow — `server/migrations/079b_option_c_payment_system.sql`
- P3-1080 [Medium] POST /api/consulting/refund (admin) operates on the unreachable Stripe path — `server/routes/consultingPayment.js:18`
- P3-1081 [Medium] Tool-rental analytics POST /tool-rentals/analytics/track is public behind only generalLimiter — `server/routes/toolRentals.js:642`
- P3-1082 [Low] Dead sendBookingApproved email branch — `server/controllers/toolBookingsController.js:243`
- P3-1083 [Low] GET /api/tool-rentals/:toolId/availability is public and unauthenticated by design (noted only). — `—`

### P3 13. Rate limiting and abuse inventory

- P3-1092 [High] Cart checkout payment-intent — `server/controllers/cartCheckoutController.js:187`
- P3-1093 [High] Subscription checkout mints Stripe sessions with no dedicated limiter and no idempotency — `server/controllers/subscriptionController.js:197`
- P3-1094 [High] In-chat money moves ride a shared per-IP chat bucket — `server/routes/chat.js:140,143`
- P3-1095 [High] creditPurchaseLimiter is dead on the route it's mounted on — `server/routes/food.js:125`
- P3-1096 [High] Route-local limiters use the in-memory store, including kiosk cash-out — `server/routes/direct.js:19,35,48`
- P3-1097 [High] conversationMessageLimiter mis-keyed on routes without a :conversationId param — `server/middleware/rateLimiter.js`
- P3-1098 [Medium] Invoice money routes have only the global limiter — `server/routes/invoices.js:51,58,68`
- P3-1099 [Medium] Mobile invoice/booking payment-intent + confirm-payment — `server/routes/mobile.js:22,23,32,33`
- P3-1100 [Medium] Affiliate POST /calculate and POST /:payoutId/process (money-out records + stripe.payouts.create) — `server/routes/affiliatePayouts.js:17,18`
- P3-1101 [Medium] Restaurant wallet-payout request (money-out) — `server/routes/restaurantPayouts.js:60-65`
- P3-1102 [Medium] Direct POST /requests/:id/pay-credit (credit spend) — `server/routes/direct.js:108`
- P3-1103 [Medium] Parcel delivery checkout x2 (Stripe session minting) — `server/routes/localDelivery.js:22,33`
- P3-1104 [Medium] Marketplace POST /api/orders/:orderId/cancel triggers a real Stripe refund with only the global limiter. — `server/routes/orders.js:9`
- P3-1105 [Medium] Admin/agent refund endpoints do real Stripe refunds with only the global limiter — `—`
- P3-1106 [Medium] Messaging mutation routes with no dedicated limiter — `server/routes/messages.js:52,73,79,88,91,95`
- P3-1108 [Medium] discoverLimiter/discoverAuthLimiter resolve identity via Bearer-token only, while every other limiter uses cookie+Bearer — `server/middleware/rateLimiter.js`
- P3-1109 [Low] GET /auth/internal-access/config has no dedicated limiter (discloses whether the internal-access gate is enforced). — `server/routes/auth.js:45`
- P3-1110 [Low] No server.requestTimeout/headersTimeout/keepAliveTimeout set — `—`
- P3-1111 [Low] POST /api/subscription/portal (billing-portal session minting) — `server/routes/subscription.js:14`
- P3-1112 [Low] POST /api/api-products/:productId/subscribe — `—`
- P3-1113 [Low] Fragile pattern — `routes/qrPayments.js:56-60`

### P3 14. Session and device management

- P3-1125 [High] The only session-list endpoint always 500s — `server/controllers/adminSelfSettingsController.js:46-57`
- P3-1126 [Medium] No user-facing session management at all — `—`
- P3-1127 [Medium] revokeMySession skips the denylist (access JWT valid 15 min post-revoke); — `—`
- P3-1128 [Medium] Cookie-only logout never revokes the access token server-side — `server/controllers/authController.js:884-962`
- P3-1129 [Medium] invalidateUserSessions (utils/modeRole.js:174) skips denylist on role/mode switches (login mode-change, profile, switchR… — `utils/modeRole.js:174`
- P3-1130 [Medium] Impersonation sessions are immune to all user-level revocation — `server/middleware/auth.js:114-139`
- P3-1131 [Medium] Restaurant device tokens never expire and can't be rotated — `server/controllers/restaurantAppFlowController.js:2793`
- P3-1132 [Medium] sessions grows unbounded (INSERT per login + per refresh, no sweeper; — `jobs/scheduledDeletionJob.js:219`
- P3-1133 [Medium] delivery_tracking_devices has register+list but no pause/revoke/delete (CHECK lists 'paused'/'revoked' but nothing write… — `—`
- P3-1134 [Medium] refreshToken() never checks is_active/is_suspended — `—`
- P3-1135 [Low] Expired pairing codes/pending device rows accumulate, no cleanup. — `—`
- P3-1136 [Low] sessions.id is SERIAL despite migration 200's own comment demanding random IDs. — `—`
- P3-1137 [Low] regenerated_from_session_id/parent_session_id never written. — `—`
- P3-1138 [Low] Admins can't see other users' sessions (force-logout is blind, though audited). — `—`

## B — Code + ops/config


### P1 13. QR payments

- P1-297 [Critical] The QR payment-success webhook can never be delivered; — `577_qr_payments.sql` — Code: route connected-account events to QR handler. Ops: Stripe Connect webhook endpoint/event config, live delivery check.

### P1 16. Learn/guide videos

- P1-344 [High] Auto-publish depends on an unwired worker. — `node workerMain.js` — Code: register worker in index.js/backgroundWorkers. Ops: or run workerMain.js in Coolify.

### P2 6. Subscriptions and referrals

- P2-573 [High] Credit-subscription renewal worker unwired in production — `workerMain.js:220` — Code: register renewal worker in main process. Ops: or start workerMain.js.

### P3 1. Core payments engine

- P3-785 [Critical] PayoutController.processPayout marks affiliate payouts completed with zero money movement ("wire the real processor here… — `server/controllers/PayoutController.js:355-432` — Code: wire real payout processor. Vendor/ops: payout processor account + PAYOUT_PROCESSOR_ENABLED.
- P3-790 [High] PAYMENT_CAPTURE_ASYNC=true -> captures queue to Redis consumed only by unstarted workerMain.js:46 -> payments stuck auth… — `workerMain.js:46` — Code: run capture consumer in main process or refuse async without consumer. Ops: start workerMain.js or keep PAYMENT_CAPTURE_ASYNC off.
- P3-791 [High] Tier-3 authorized exists only via the Connect webhook, whose dashboard registration the code merely comments about; — `server/controllers/jobController.js:1032-1041` — Code: make completeJob fail loudly / fallback. Ops: register Connect webhook endpoint in Stripe dashboard.

### P3 3. Email and SMS notification pipeline

- P3-843 [High] The nodemailer/SMTP email system is likely unconfigured and silently drops appointment, calendar, food-guest, and credit… — `emailService.js:63-79` — Code: make emailService fail loudly / route via Resend. Ops: SMTP credentials in prod.

### P3 4. Background workers and scheduled jobs inventory

- P3-869 [High] The entire delivery-tracking pipeline is dead in production — `workerMain.js:197-211` — Code: move 8 workers into main process. Ops: or start workerMain.js.
- P3-871 [High] PAYMENT_CAPTURE_ASYNC=true is a loaded trap — `workerMain.js` — Same as 790.
- P3-872 [Medium] clearStaleAvailableNow is dead (only in workerMain.js:211) — `workerMain.js:211` — Code: register worker in main process. Ops: or start workerMain.js.

### P3 6. File upload and media pipeline

- P3-914 [High] Orphaned files everywhere; — `businessProfileImageController.js:107` — Code: sweeper + delete-on-replace. Ops: enable cleanup worker env.
- P3-915 [High] Parcel-delivery proof upload hard-requires ClamAV — `server/controllers/localDeliveryProofController.js:12-19` — Code: fallback/clear error. Ops: provision ClamAV (CLAMAV_HOST).

### P3 13. Rate limiting and abuse inventory

- P3-1107 [Medium] trust proxy = 2 hops (server/index.js:220, TRUST_PROXY_HOPS=2) — `server/index.js:220` — Code: lock origin/validate CF headers. Infra: firewall origin to Cloudflare only.

## C — Not code


### P1 1. Auth/session

- P1-119 [Info] Admin sign-in digital-signature field (Emile supplied his full name 2026-10-02) not found in current admin Login page or… — `—` — Product/live check: is admin signature field planned.

### P3 6. File upload and media pipeline

- P3-921 [Medium] Intake photos (maintenance/beauty/creative/trades) are world-readable by design (PUBLIC_KEY_PREFIXES, server/utils/stora… — `server/utils/storage.js:88-101` — Privacy/legal + product decision on public intake photos.

### P3 7. Feature flags and launch-visibility system

- P3-951 [Medium] FEATURE_PAYMENTS_ENABLED default-off splits the payments surface confusingly — `routes/payments.js` — Product decision on FEATURE_PAYMENTS_ENABLED scope.

### P3 9. Loyalty program + invoices and receipts

- P3-996 [Medium] Subscription receipts unverifiable from code — `—` — Live verification of Stripe dashboard receipt settings.

### P3 14. Session and device management

- P3-1124 [High] A DB trigger silently enforces single-live-session-per-user (see Top 15 #15). — `server/migrations/200_session_fixation_prevention.sql:20-24` — Product decision: single-session-per-user intended?
