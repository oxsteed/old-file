# Review fix progress

> **Merge status (2026-10-12):** PRs #492–#503 are all merged into `old-files-claude`.
> Tip after #503: `1071a91d`. Docs PR #504 tip: `9ccb8b8d`.
> **Audit v2** (`resolution-audit-v2-2026-10-13.md`, audited at `1071a91d`): **185 resolved / 47 partial / 284 still broken / 27 needs live / 1 unclear**. **14 of 15 Criticals resolved**; remaining Critical is **P3-1009** (intentionally excluded).
> **Next:** W11 (33 IDs after W10.5 reconciliation), then W12–W19 — see `reviews-remaining-waves-handoff.md`.

Status values:
- **fixed (PR#)**: only once the PR is green.
- **in PR (PR#, CI pending)**: code is in a PR whose CI has not finished.
- **deferred (reason)**
- **skipped**: P3-1009 (owner excluded), or category C.

## W1: PR #494 (fix/review-w1-criticals), CI green (Oct 12, 4:00 PM ET)
These IDs are all **fixed (PR #494)**:
- **Auth:** P1-109
- **Work agreements:** P1-128, P1-129, P1-130, P1-147, P1-148, P1-149, P1-150, P1-151, P1-152, P1-153, P1-155, P1-157, P1-158, P1-161, P1-162
- **Food:** P1-234, P1-235
- **Subscriptions:** P2-569, P2-578
- **Chargebacks:** P3-814
- **Webhooks:** P3-888
- **Booking deposits:** P3-962, P3-974
- **Self-delete:** P3-1039, P3-1040 (C item, safe-default block as directed)

## Not yet started (later waves)
- P1-154, P1-160, P1-360
- P1-156: covered by #492
- W5–W6+ items
- P1-160 (agreement↔payment link, medium) deferred from W2 to the medium wave

## Skipped
- P3-1009: excluded by owner
- Category C: P1-119, P3-921, P3-951, P3-996, P3-1124

## W2 — PR #495 (fix/review-w2-payments), CI green 4:21 PM ET Oct 12, 2026
Fixed: P2-570, P2-571, P2-572, P2-574, P3-786, P3-787, P3-788, P3-789, P3-815, P3-816, P3-817, P3-818, P3-819, P3-820, P3-821, P3-870, P3-889, P3-890, P3-891, P3-892
Migrations 770–774. Ops: DISPUTE_EVIDENCE_WINDOW_DAYS, PAYMENT_REFUND_MAX_RECONCILIATION_ATTEMPTS; subscribe the platform endpoint to checkout.session.async_payment_succeeded/failed and expired.

## W3 — PR #496 (fix/review-w3-jobs), CI green 4:40 PM ET Oct 12, 2026
Fixed: P1-131, P1-132, P1-133, P2-478, P2-479, P2-480, P2-481
Migration 775. Ops: HELPER_COMPLETION_CONFIRM_HOURS (default 72); new worker helper-completion-auto-confirm registered in backgroundWorkers.js.

## W4 — PR #497 (fix/review-w4-security), CI green 5:19 PM ET Oct 12, 2026
Fixed: P1-110, P1-111, P2-482, P2-616, P2-652, P2-653, P2-654, P3-912, P3-916, P3-940, P3-941, P3-942, P3-943, P3-1092, P3-1093, P3-1094, P3-1095, P3-1096, P3-1097, P3-1107 (code side), P3-1125
Migrations 776–777. Ops: ORIGIN_SHARED_SECRET (+ Cloudflare transform rule), VITE_VORTEX_ENABLED with VORTEX_ENABLED, CONSULTING_ENABLED, SUBSCRIPTIONS_ENABLED.
Moved to W5: P2-476, P2-477, P2-593, P2-594, P2-595, P2-596, P3-1067, P3-1068, P3-1069, P3-1070, P3-1071.

## W5 — PR #498 (fix/review-w5-ops), CI green 5:45 PM ET Oct 12, 2026
Fixed (code side; B items' ops listed in the PR): P1-297, P1-344, P2-573, P3-785, P3-790, P3-791, P3-842, P3-843, P3-844, P3-845, P3-846, P3-869, P3-871, P3-872, P3-914, P3-915
Migrations 778–779. Ops: Connect webhook checkout events, DEDICATED_WORKER_PROCESS, STORAGE_CLEANUP_ENABLED, PAYOUT_PROCESSOR_ENABLED (funded balance), optional CLAMAV_HOST.

## W6: PR #499 (fix/review-w6-onboarding), CI green 6:07 PM ET Oct 12, 2026
Fixed (#499): P2-476, P2-477, P2-593, P2-594, P2-595, P2-596, P3-1067, P3-1068, P3-1069, P3-1070, P3-1071, P2-549, P2-550.
Migrations: 780 (consulting invoice paid record), 781 (tool-rental deposits). Next free migration number: 782.
Ops:
- Keep payment_intent.succeeded and payment_intent.canceled on the Stripe webhook.
- Set VITE_STRIPE_PUBLISHABLE_KEY for the consulting card pay and wallet top-up UIs.
- Existing helpers who lack verified identity or a terms record must finish the checklist before they can re-list.

## Next: medium/low waves (W7 done; continuing from P1 §6)

## W7 — PR #500 (fix/review-w7-core), CI green 6:37 PM ET Oct 12, 2026
Fixed (31): P1-112, P1-113, P1-114, P1-115, P1-116, P1-117, P1-118, P1-134, P1-135, P1-136, P1-137, P1-138, P1-159, P1-160, P1-163, P1-164, P1-173, P1-174, P1-175, P1-176, P1-177, P1-178, P1-179, P1-180, P1-181, P1-182, P1-183, P1-192, P1-193, P1-194, P1-195.
Migrations 782 (job state guard), 783 (agreement mutual completion + enum cleanup, drops work_agreements.disputed), 784 (quote_request_crew, backfilled).
Checks: Server+Client Verification, Postgres rehearsal, Media harness, CodeQL all pass. Bugbot skipped (no run).
Ops: none required. Behavior changes to review: passkey login now requires terms checkbox + typed signature (P1-113); helpers can't self-complete escrow jobs with authorized payment (P1-138); off-platform paid Direct cancels email support for a manual refund (P1-176); business preparation_minutes now act as turnaround buffer and staff shifts restrict slots (P1-193/195).

## W8 — PR #501 (fix/review-w8-profiles-credit) — CI GREEN 2026-10-12 6:58 PM ET
Fixed: P1-202, P1-203, P1-204, P1-205, P1-206, P1-207, P1-208, P1-209, P1-210, P1-211, P1-212, P1-213, P1-222, P1-225
No migrations (next free: 785). Media harness failed once on a registry 429 (infra), green on rerun.
Deferred to next wave: P1-223, P1-224, P1-236, P1-237, P1-247..P1-255.

## W9 — PR #502 (fix/review-w9-credit-food) — CI GREEN 2026-10-12 7:17 PM ET (break-glass removal re-green ~8:15 PM ET)
Fixed: P1-223, P1-224, P1-236, P1-237, P1-247, P1-248, P1-249, P1-250, P1-251, P1-252, P1-253, P1-254, P1-255
No migrations (next free: 785). New env (optional): CREDIT_PENDING_SETTLEMENT_AGING_HOURS (72), FOOD_ABANDONED_PAY_NOW_HOURS (25). P1-251 follow-up (Emile): the single-admin break-glass was removed; maker-checker always needs two distinct admins.

## W10 — PR #503 (fix/review-w10-messaging) — CI GREEN 2026-10-12 ~8:05 PM ET
Fixed: P1-264, P1-265, P1-266, P1-267, P1-268, P1-269, P1-270, P1-285, P1-286, P1-287, P1-288, P1-298, P1-299, P1-300, P1-301, P1-302, P1-303, P1-312, P1-313, P1-314, P1-315, P1-316, P1-317, P1-318, P1-331, P1-332, P1-333, P1-334
No migrations (next free: 785). Ops: PUBLIC_APP_URL absolute (required for QR); GUEST_CHAT_RETENTION_DAYS (optional, 180); MEDIA_VIDEO_WORKER_ENABLED=1 for video uploads; QR_CREDIT_ENABLED gates the Credit pay button.
Stopped here per Emile; remaining waves planned in docs/reviews/reviews-remaining-waves-handoff.md.

## Audit v2 summary (2026-10-13, tip `1071a91d`)
Source: `docs/reviews/resolution-audit-v2-2026-10-13.md`.
- Verdict-records: **185 RESOLVED / 47 PARTIAL / 284 STILL BROKEN / 27 NEEDS LIVE / 1 UNCLEAR** (544 total vs 524 findings; workers split combined entries).
- Criticals: **14/15 RESOLVED**. Still broken on purpose: **P3-1009** (admin credit adjustments skip KYC/sanctions — owner excluded).
- Headline: ~35% of findings resolved by W1–W10 + #492/#493.

## W10.5 — `fix/review-w10_5-post-merge` (merged PR #505, commit `4150d9ea`)
Implemented from audit v2:
1. Stripe Connect `account.updated` and processor paths now verify payout methods only when `payouts_enabled`; regressions demote methods to pending and user self-verify remains blocked.
2. Migration **785** adds the idempotent admin audit-log writer columns and per-session access-token hash index.
3. Settlement execution re-checks the Credit rail inside the locked transaction, validates payment references, and removes the maker-checker threshold bypass. Two distinct admins remain required.
4. Session issuance stores the access-token hash and `revokeMySession` immediately denies the revoked access token.
5. Added idempotent dispute update, subscription renewal/cancellation/past-due, and failed food-order card payment notifications.
Validation: focused server suite 100/100 passed; client `npm run build:ci` passed; GitHub checks for PR #505 passed. Migration rehearsal reached the existing baseline failure at migration 001 before W10.5 could run locally (no `DATABASE_URL` was configured). P3-1009 remains skipped.

## W11 — same continuation branch as PR #505 (in progress)
Reconciled against audit v2 after PR #505: P2-453 and P2-454 are closed by W10.5, leaving 33 active IDs. Current fixes cover Learn video queue visibility/dedupe/observability, support ticket reopen and guarded transitions, warranty-claim notifications and review state, job-start notifications, and payout-readiness UI gating. Remaining W11 admin and onboarding paths will be completed before opening the W11 PR.

## W12 — same continuation branch as PR #505 (in progress)
Reconciled the 39 W12 IDs against `resolution-audit-v2-2026-10-13.md`; the audit has no per-ID replacement list for this area, so the handoff IDs remain the source of truth. This pass fixes merchant POS split/merge/refund URL routing, replaces the business-appointment log-only notifier with idempotent participant notifications for create/status/cancel/reschedule, adds idempotent owner notifications for business invoice paid/void transitions, and hardens statement archive rendering when an artifact has no state. Remaining business hub, runner settlement, and statement issuance items stay open for subsequent W12 commits.

## W13 — same continuation branch as PR #505 (in progress)
Reconciled the W13 handoff list against audit v2; the audit records the booking-deposit and webhook crash-window items as resolved, so the active W13 work is the remaining subscription, preference, onboarding, payout, favorite, and review items listed in the handoff. This pass makes plan listing fail closed when the active catalog column is absent and makes the existing email and push master toggles effective in the primary notification path. Remaining W13 items stay open for subsequent continuation commits.

## W14 — same continuation branch as PR #505 (in progress)
Reconciled the 38 W14 handoff IDs against audit v2; the active list remains the handoff source for launch-gated, in-chat commerce, and payment-engine items. This pass enforces the property-maintenance `intake_enabled` setting and adds a dedicated authenticated assigned-helper queue so assigned helpers can discover their work without changing requester history semantics. Remaining W14 money, quote, franchise, and chat-booking items stay open.
### W15 reconciliation (2026-10-13)

Reconciled the 44 W15 IDs against `resolution-audit-v2-2026-10-13.md` before implementation. Existing W10.5/W13 work already covers the failed food-order card notification and dispute update emitter; the current batch closes the admin dispute multi-status filter, adds idempotency to weekly summary notifications, and fences the recurring-job worker with a PostgreSQL advisory lock. Booking-deposit and webhook crash-window findings referenced by the audit are already resolved in earlier waves. Remaining W15 findings stay open for follow-up batches.

## W16 reconciliation (2026-10-13)

Reconciled the 38 W16 IDs against `resolution-audit-v2-2026-10-13.md`; no matching ID rows were present in the audit snapshot, so the handoff list remains authoritative. This batch validates job media URLs against the existing storage allowlist, allows authenticated customers to reach the booking endpoint while binding appointments to their account, and enforces legal appointment status transitions with row locking. Remaining upload, feature-flag, and booking items stay open for follow-up batches.

## W17 reconciliation (2026-10-13)

Reconciled the 33 W17 IDs against `resolution-audit-v2-2026-10-13.md`; no matching ID rows were present in that snapshot, so the handoff list remains authoritative. This batch makes recurring invoice generation transactional and idempotent per billing record, with a database fence and same-day replay protection. Remaining loyalty, receipt, and KYC/AML findings stay open for follow-up batches.

## W18 reconciliation (2026-10-13)

Reconciled the 45 W18 IDs against `resolution-audit-v2-2026-10-13.md`; no matching rows were present in that snapshot, so the handoff list remains authoritative. This batch exposes the previously unwired CCPA/CPRA request intake, expands verified privacy exports with optional messages, payments, and invoices sections, and corrects the payment export key from the nonexistent `payments.user_id` to payer/payee ownership. Remaining audit-trail, tool-rental, and rate-limit inventory stays open for follow-up batches.

## W19 reconciliation (2026-10-13)

Reconciled the 13 W19 IDs against `resolution-audit-v2-2026-10-13.md`; no matching rows were present in that snapshot. The access-token denylist path for individually revoked admin sessions was already present from W10.5; this batch adds scheduled cleanup for expired sessions, privacy export challenges, and expired restaurant pairing codes while preserving fail-safe behavior on older installations. Remaining device-management and impersonation inventory stays open for follow-up work.

## Post-wave follow-up (2026-10-13)

Continued the same branch after W19 for two unresolved W15 notification/auth findings: OTP resend timestamps are now written only after a successful email/SMS delivery, and template-render failures return an explicit failed delivery result so notifications are not reported as successful. Focused auth and notification regressions remain covered by the existing test suites.

The follow-up also adds dedicated authenticated/conversation rate limits to message edits, deletes, reactions, archive/restore, and block removal, closing the W18 messaging-mutation abuse gap without changing message authorization.

Refresh-token follow-up: refresh rotation now re-checks the account's active and suspension state before issuing a replacement session, so deactivated or actively suspended users cannot mint new access tokens. Expired suspensions remain eligible for refresh and are handled by the existing auth middleware cleanup path.

Rate-limit follow-up: money-moving invoice, mobile payment, affiliate payout, restaurant wallet-payout, Direct credit, delivery checkout, marketplace cancellation, admin/agent refund, subscription portal, and API-product subscription routes now use the strict abuse limiter before authentication. Discover search now keys its authenticated bucket from the same verified cookie-or-Bearer identity used by the rest of the limiter system, and internal-access configuration is bounded.

Delivery-device follow-up: driver tracking devices now support owner pause and revoke actions, operations can manage fleet devices, and revocation/pausing transitions active assignments with an audit event. Revoked devices cannot be reactivated by their former owner; they must be re-registered by operations.

Restaurant-device follow-up: paired restaurant credentials now expire after 90 days, pairing assigns the expiry, and an authorized restaurant manager can rotate a paired device token. Expired credentials are rejected before device routes run. Migration 786 adds the nullable expiry column and index for older installations.

Session-chain follow-up: refresh rotation now records the consumed session id in both session-chain lineage columns when those nullable columns exist, preserving the existing absolute-deadline behavior and allowing refresh ancestry to be audited.

Impersonation follow-up: impersonation requests now honor the target user's token-revocation marker in addition to the existing per-impersonation JTI and database ended-at checks, so account security actions terminate delegated sessions too.

Session-management follow-up: signed-in users now have `/api/users/me/sessions` and `DELETE /api/users/me/sessions/:sessionId` for listing and revoking their own sessions, with current-session protection and the existing access-token denylist. The expiry sweeper predicate now references both session lifecycle flags while retaining expired-row cleanup.

Email privacy follow-up: transactional email logs no longer include recipient addresses or full provider error payloads; subjects and bounded status/error fields remain available for operations. This closes the plaintext recipient PII finding without changing delivery behavior.

Support alert follow-up: live-support wait alerts now use `SUPPORT_ALERT_EMAIL`, then `SUPPORT_EMAIL`, with `support@oxsteed.com` as the safe default. The alert remains idempotent and retryable without a founder-specific recipient embedded in code.

Food-order notification follow-up: signed-in `food_order_ready` notifications now carry a stable delivery key and are included in the transactional email allow-list, so the ready event reaches email and retries remain idempotent. Focused `foodOrderLoop` regression tests pass.

Tier-3 payment follow-up: successful job-payment webhooks now emit a localized, idempotent `payment_receipt` notification to the payer, using the persisted payer id and the payment intent as the delivery key. Focused Stripe webhook and food-card suites pass.

Calendar notification follow-up: failed calendar reminders now retain bounded retry metadata and are retried with exponential backoff. Operators can list failures and requeue one through authenticated, permission-gated admin endpoints. Migration 787 is idempotent.

Refund notification follow-up: successful and failed Tier-3 refund/void settlements now notify the payer with localized, idempotent `refund` or `refund_failed` events, including reconciliation retries. Focused refund reconciliation tests pass.

Dispute email follow-up: counterparty, under-review, and resolved dispute events now use localized notification templates in the email allow-list. The legacy resolution path now supplies `body`, action data, and per-party idempotency keys instead of dropping its message field.

Notification retention follow-up: the scheduled deletion worker now purges read notifications after a bounded configurable window (default 180 days, clamped to 30–730), while retaining unread rows until one year. The cleanup is optional-safe on older installations.

Email reliability follow-up: welcome-email provider idempotency now includes the account creation timestamp, and direct calendar reminders use the shared escaped OxSteed template with a stable per-recipient delivery key. Focused reminder and welcome-idempotency tests pass.

Tier-3 receipt follow-up: protected job PaymentIntents now set Stripe `receipt_email` from the authenticated payer, alongside the in-app receipt notification, so provider receipts do not depend on our notification pipeline.

Provider consolidation follow-up: platform email delivery now always uses the shared Resend path while per-user SMTP remains an explicit opt-in, and legacy OTP/job-alert SMS wrappers delegate to the single configured Twilio implementation. Focused email, SMS, and food-notification regressions pass.

