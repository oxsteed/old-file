# OxSteed Security Audit — Implementation Tracker
> Source: Perplexity Computer Security Audit, April 9, 2026  
> Overall Risk Rating: **HIGH** | 185 total findings

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 10    | ⬜ Pending |
| HIGH     | 42    | ⬜ Pending |
| MEDIUM   | 63    | ⬜ Pending |
| LOW      | 51    | ⬜ Pending |
| INFO     | 19    | ⬜ Pending |

> **Status legend:** ⬜ Pending | 🔧 In Progress | ✅ Fixed | ⏭ Deferred

---

## CRITICAL (10 findings)

### C-01 — Checkr webhook has no signature verification
- **File:** `controllers/verificationController.js` → `checkrWebhook()`
- **Impact:** Anyone can POST a fake `report.completed` to grant any user a background_clear badge.
- **Fix:** Verify HMAC signature using `CHECKR_API_KEY` on the raw request body before processing.
- **Status:** ⬜

---

### C-02 — Stripe Identity webhook has no signature verification
- **File:** `controllers/verificationController.js` → `identityWebhook()`
- **Impact:** Any unauthenticated caller can mark any user as `identity_verified`.
- **Fix:** Apply `stripe.webhooks.constructEvent()` with raw body + `STRIPE_WEBHOOK_SECRET`.
- **Status:** ⬜

---

### C-03 — Any authenticated user can open a dispute for any job
- **File:** `controllers/disputeController.js` → `openDispute()`
- **Impact:** Users can interfere with others' transactions; trigger fund holds; pollute moderation queue.
- **Fix:** Query `jobs WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)` before inserting.
- **Status:** ⬜

---

### C-04 — Didit webhook signature check is optional (bypassed if secret missing)
- **File:** `controllers/diditController.js` → `handleWebhook()`
- **Impact:** If `DIDIT_WEBHOOK_SECRET` is not set, all webhooks accepted without authentication.
- **Fix:** Make check mandatory; return 500/503 if secret is missing.
- **Status:** ⬜

---

### C-05 — Didit webhook HMAC compared with `!==` (not timing-safe)
- **File:** `controllers/diditController.js` → `handleWebhook()`
- **Impact:** Timing side-channel allows progressive HMAC guessing.
- **Fix:** `crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(signature, 'hex'))`
- **Status:** ⬜

---

### C-06 — SQL injection risk via unvalidated pagination in jobController
- **File:** `controllers/jobController.js` → `getJobs()`
- **Impact:** `NaN` from non-numeric input causes unexpected 500s; malformed queries.
- **Fix:** `parseInt()` on `page` and `limit`; add input validation.
- **Status:** ⬜

---

### C-07 — Dockerfile runs as root
- **File:** `Dockerfile`
- **Impact:** RCE attacker gets full container filesystem access as UID 0.
- **Fix:** Add `RUN addgroup --system app && adduser --system --ingroup app app` and `USER app` before `CMD`.
- **Status:** ⬜

---

### C-08 — `migrate.js` uses `rejectUnauthorized: false` in production
- **File:** `server/migrate.js`
- **Impact:** TLS used but server cert not validated — MITM possible during migrations.
- **Fix:** Change to `rejectUnauthorized: true`, matching `db.js` logic.
- **Status:** ⬜

---

### C-09 — `authService.js` does not validate `JWT_SECRET` at startup
- **File:** `server/services/authService.js`
- **Impact:** If deployed with placeholder secret, tokens can be forged — complete auth bypass.
- **Fix:** Add startup guard; validate presence and minimum entropy; fail fast if missing.
- **Status:** ⬜

---

### C-10 — `.env.example` contains live Stripe key prefixes as placeholders
- **File:** `server/.env.example`
- **Impact:** Developers copy `sk_live_` values; accidental commit exposes production Stripe key.
- **Fix:** Change to `sk_test_REPLACE_ME` and `pk_test_REPLACE_ME`.
- **Status:** ⬜

---

## HIGH (42 findings)

### H-01 — Public support ticket submission has no rate limiting
- **File:** `routes/support.js` → `POST /request`
- **Fix:** Apply `authLimiter` (or dedicated `supportLimiter`) to `POST /request`.
- **Status:** ⬜

### H-02 — Chat feedback endpoint has no auth or rate limiting
- **File:** `routes/chat.js` → `POST /feedback`
- **Fix:** Add rate limiting; validate/sanitize `pageContext.path`; restrict `value` to known enum.
- **Status:** ⬜

### H-03 — Hard-delete of `skills_lookup` records not gated behind `requireSuperAdmin`
- **File:** `routes/admin.js` → `DELETE /skills-lookup/:id`
- **Fix:** Gate `?hard=true` path behind `requireSuperAdmin`.
- **Status:** ⬜

### H-04 — Checkr webhook route lacks raw-body preservation
- **File:** `routes/verification.js` → `POST /webhooks/checkr`
- **Fix:** Apply `express.raw({ type: 'application/json' })` and verify HMAC.
- **Status:** ⬜

### H-05 — Stripe Identity webhook lacks raw-body preservation
- **File:** `routes/verification.js` → `POST /webhooks/identity`
- **Fix:** Apply `express.raw({ type: 'application/json' })` before handler.
- **Status:** ⬜

### H-06 — `loginWith2FA` and `validate2FA` have no brute-force protection
- **File:** `controllers/authController.js`, `controllers/twoFactorController.js`
- **Fix:** Add per-user attempt counters with exponential backoff or lockout.
- **Status:** ⬜

### H-07 — `getMyPayments` constructs SQL column name from user input (fragile)
- **File:** `controllers/paymentController.js` → `getMyPayments()`
- **Fix:** Use separate queries instead of dynamic column names.
- **Status:** ⬜

### H-08 — `refundPayment` role check excludes `super_admin`
- **File:** `controllers/paymentController.js` → `refundPayment()`
- **Fix:** Change to `!['admin','super_admin'].includes(req.user.role)`.
- **Status:** ⬜

### H-09 — `requestOTP` stores OTP in plaintext, no rate limiting
- **File:** `controllers/authController.js` → `requestOTP()`
- **Fix:** Store OTPs as SHA-256 hashes; add per-IP and per-email rate limiting.
- **Status:** ⬜

### H-10 — `verifyOTP` comparison is not timing-safe
- **File:** `controllers/authController.js` → `verifyOTP()`
- **Fix:** `crypto.timingSafeEqual` after length-checking both buffers.
- **Status:** ⬜

### H-11 — `reviewReport` sends warning to reporter instead of reported user
- **File:** `controllers/adminController.js` → `reviewReport()`
- **Fix:** Change notification target from `reporter_id` to the content creator's ID.
- **Status:** ⬜

### H-12 — `getConnectStatus` returns all columns including internal Stripe keys
- **File:** `controllers/paymentController.js` → `getConnectStatus()`
- **Fix:** Select only `onboarding_complete`, `charges_enabled`, `payouts_enabled`.
- **Status:** ⬜

### H-13 — Client email returned in public job listing
- **File:** `controllers/jobController.js` → `getJobs()`
- **Fix:** Remove `u.email` from SELECT; return only non-PII fields in public feed.
- **Status:** ⬜

### H-14 — Client email returned in single job fetch
- **File:** `controllers/jobController.js` → `getJob()`
- **Fix:** Include `client_email` only when requester is client or assigned helper.
- **Status:** ⬜

### H-15 — `SELECT *` exposes sensitive fields in `getMyJobs`
- **File:** `controllers/jobController.js` → `getMyJobs()`
- **Fix:** Replace `SELECT *` with explicit column list.
- **Status:** ⬜

### H-16 — `RETURNING *` exposes exact GPS coordinates in `createJob`
- **File:** `controllers/jobController.js` → `createJob()`
- **Fix:** Use `RETURNING` with explicit column list excluding exact coordinates.
- **Status:** ⬜

### H-17 — SSRF risk via user-controlled `OLLAMA_URL`
- **File:** `controllers/chatController.js`
- **Fix:** Validate `OLLAMA_URL` at startup against an allowlist; use safe default.
- **Status:** ⬜

### H-18 — Hardcoded internal service URL in source code
- **File:** `controllers/chatController.js`
- **Fix:** Remove hardcoded hostname; use empty string or localhost as fallback.
- **Status:** ⬜

### H-19 — `adminHideReview` missing in-controller role verification
- **File:** `controllers/reviewController.js` → `adminHideReview()`
- **Fix:** Add in-controller role assertion for defense-in-depth.
- **Status:** ⬜

### H-20 — Admin ticket endpoints lack in-controller role verification
- **File:** `controllers/supportController.js` (8 functions)
- **Fix:** Add controller-level role guards for defense-in-depth.
- **Status:** ⬜

### H-21 — IDOR: `getJobBids` exposes all bids without ownership verification
- **File:** `controllers/bidController.js` → `getJobBids()`
- **Fix:** Verify requester is job owner (`client_id`) or admin before returning bids.
- **Status:** ⬜

### H-22 — IDOR: `getPreferredByCount` accepts helperId from URL without access control
- **File:** `controllers/plannedNeedsController.js` → `getPreferredByCount()`
- **Fix:** Remove `helperId` param override; always use `req.user.id`.
- **Status:** ⬜

### H-23 — JWT algorithm not pinned in `auth.js`
- **File:** `server/middleware/auth.js` → `authenticate()`
- **Fix:** Add `algorithms: ['HS256']` to `jwt.verify` options.
- **Status:** ⬜

### H-24 — JWT algorithm not pinned in `adminAuth.js`
- **File:** `server/middleware/adminAuth.js`
- **Fix:** Audit `authService.verifyToken`; confirm or add algorithm pinning.
- **Status:** ⬜

### H-25 — `requireTermsAcceptance` fails open on DB error
- **File:** `server/middleware/requireTermsAcceptance.js`
- **Fix:** Return `res.status(503)` on infrastructure errors instead of calling `next()`.
- **Status:** ⬜

### H-26 — `requireOnboardingStep` fails open on unknown step values
- **File:** `server/middleware/helperOnboardingMiddleware.js`
- **Fix:** Deny (403) on unrecognized values.
- **Status:** ⬜

### H-27 — `requireTier` fails open on unknown tier values
- **File:** `server/middleware/helperOnboardingMiddleware.js`
- **Fix:** Deny (403) on unrecognized tier values.
- **Status:** ⬜

### H-28 — Socket.IO room architecture relies on absence of client join handlers (undocumented)
- **File:** `server/services/socketService.js`, `server/index.js`
- **Fix:** Document as intentional; add explicit comment blocking client join events.
- **Status:** ⬜

### H-29 — Email template interpolates user-controlled data as raw HTML
- **File:** `server/services/notificationService.js` → `buildEmailTemplate()`
- **Fix:** HTML-encode `title`, `body`, and `firstName` before interpolation.
- **Status:** ⬜

### H-30 — `action_url` interpolated into email `href` without sanitization
- **File:** `server/services/notificationService.js` → `buildEmailTemplate()`
- **Fix:** Assert `action_url` starts with `/`; HTML-encode before use.
- **Status:** ⬜

### H-31 — Dockerfile uses `npm install` instead of `npm ci`
- **File:** `Dockerfile`
- **Fix:** Replace with `npm ci --omit=dev` for server.
- **Status:** ⬜

### H-32 — CI pipeline uses `npm install` (supply chain risk)
- **File:** `.github/workflows/ci.yml`
- **Fix:** Replace with `npm ci` in all CI steps.
- **Status:** ⬜

### H-33 — `speakeasy` is unmaintained with known timing vulnerabilities
- **File:** `server/package.json`
- **Fix:** Replace with `otplib` (actively maintained, RFC 6238 compliant, constant-time).
- **Status:** ⬜

### H-34 — `trust proxy` set to 1 — needs documentation for CDN changes
- **File:** `server/index.js`
- **Fix:** Document as intentional; re-evaluate when adding CDN.
- **Status:** ⬜

### H-35 — TOTP secret stored in plaintext
- **File:** `022_add_two_factor_auth.sql`
- **Fix:** Encrypt TOTP secrets at rest using application-layer AES-256.
- **Status:** ⬜

### H-36 — 2FA backup codes stored in plaintext
- **File:** `022_add_two_factor_auth.sql`
- **Fix:** Store as `bcrypt`/`argon2` hashes with constant-time comparison.
- **Status:** ⬜

### H-37 — Raw OTP code stored in `pending_registrations`
- **File:** `018_customer_registration_flow.sql`
- **Fix:** Store OTPs as SHA-256 hashes; compare at verification time.
- **Status:** ⬜

### H-38 — Raw refresh tokens stored in sessions table
- **File:** `025_merge_legacy_unique_fields.sql`, `026_fix_auth_schema.sql`
- **Fix:** Store hashed refresh tokens (SHA-256); compare hashes on refresh.
- **Status:** ⬜

### H-39 — IP addresses stored in plaintext across multiple tables (GDPR)
- **File:** Migrations 005, 018, 022, 025, 026, 049
- **Fix:** Hash IPs consistently using the `last_known_ip_hash` pattern from `001_initial_schema`.
- **Status:** ⬜

### H-40 — `terms_acceptance_ip` stored in plaintext
- **File:** `018_customer_registration_flow.sql`
- **Fix:** Hash using established pattern.
- **Status:** ⬜

### H-41 — `plans.tier` column never added — downstream migrations fail
- **File:** `001_initial_schema.sql`, `010`, `032`
- **Fix:** Add `plans.tier` via a new migration before `010`.
- **Status:** ⬜

### H-42 — `dispute_evidence.dispute_id` UUID vs `disputes.id` SERIAL type conflict
- **File:** `015_phase4_create_disputes.sql`, `025_merge_legacy_unique_fields.sql`
- **Fix:** Align types: either change `disputes.id` to UUID or `evidence.dispute_id` to INTEGER.
- **Status:** ⬜

---

## MEDIUM (63 findings)

### M-01 — `GET /jobs` and `GET /jobs/:id` fully public, no auth
- **File:** `routes/jobs.js`
- **Fix:** Document as intentional or add auth; audit controller for field scoping.
- **Status:** ⬜

### M-02 — `GET /bids/recent` public with no auth
- **Fix:** Review controller for sensitive fields; add rate limiting.
- **Status:** ⬜

### M-03 — `GET /privacy/data-categories` public with no rate limiting
- **Fix:** Add rate limiter.
- **Status:** ⬜

### M-04 — Helper registration OTP endpoints have no rate limiting
- **File:** `routes/helperRegistration.js`
- **Fix:** Apply `authLimiter` to all helper registration OTP routes.
- **Status:** ⬜

### M-05 — `POST /didit/webhook` no raw-body check at route level (duplicate endpoint)
- **File:** `routes/didit.js`
- **Fix:** Add `express.raw()` or remove duplicate/legacy endpoint.
- **Status:** ⬜

### M-06 — Helper discovery routes have no rate limiting
- **File:** `routes/helpers.js` (8 endpoints)
- **Fix:** Add general API rate limiter to all helper discovery routes.
- **Status:** ⬜

### M-07 — Geo endpoints rely on undocumented global limiter, no per-route guard
- **File:** `routes/geo.js`
- **Fix:** Add route-level `geoLimiter` as defense-in-depth.
- **Status:** ⬜

### M-08 — `POST /payments/refund` has no admin role check at route level
- **File:** `routes/payments.js`
- **Fix:** Add `requireAdmin` or `requireSuperAdmin` at route level.
- **Status:** ⬜

### M-09 — `GET /jobs` accepts unvalidated query parameters
- **File:** `routes/jobs.js`
- **Fix:** Add `express-validator` middleware at route level.
- **Status:** ⬜

### M-10 — File upload MIME type and size restrictions unverified at route level
- **File:** `routes/disputes.js`, `routes/jobs.js`, `routes/helperRegistration.js`
- **Fix:** Verify upload middleware enforces MIME allowlist and size caps.
- **Status:** ⬜

### M-11 — `loginWith2FA` has no server-side session tying 2FA to prior password auth
- **File:** `controllers/authController.js`
- **Fix:** Issue short-lived `mfa_challenge_token` at step 1; require it at step 2.
- **Status:** ⬜

### M-12 — `login()` exposes `userId` in response, enabling 2FA enumeration
- **File:** `controllers/authController.js`
- **Fix:** Return opaque `mfa_challenge_token` instead of raw `userId`.
- **Status:** ⬜

### M-13 — `verifyOTP` has no brute-force protection
- **Fix:** Apply 3-attempt lockout with 1-hour cooldown (match `verifyRegistrationOTP`).
- **Status:** ⬜

### M-14 — `disputeController.submitEvidence` uses dynamic SQL column name
- **Fix:** Use explicit allowlist object: `{ helper: 'evidence_helper', customer: 'evidence_poster' }`.
- **Status:** ⬜

### M-15 — `issueManualRefund` leaks internal Stripe error messages to client
- **Fix:** Log full error server-side; return generic error to client.
- **Status:** ⬜

### M-16 — `superAdminController.getUsers` has fragile WHERE clause construction
- **Fix:** Refactor into single `conditions` array assembled before WHERE clause.
- **Status:** ⬜

### M-17 — Didit webhook signature verification operates on re-serialized body
- **File:** `controllers/webhookController.js`
- **Fix:** Use `verifySignatureOriginal` which HMACs the raw request body.
- **Status:** ⬜

### M-18 — `requestOTP` does not confirm email exists before sending
- **Fix:** Add `SELECT` check first, similar to `forgotPassword`.
- **Status:** ⬜

### M-19 — `getDashboardStats` uses template literal interpolation for SQL
- **Fix:** Use static conditional queries or separate queries.
- **Status:** ⬜

### M-20 — Helper registration OTP verification has no lockout (attempts column unused)
- **File:** `controllers/helperRegistrationController.js`
- **Fix:** Check and increment `otp_attempts`; lock after 3 failed attempts.
- **Status:** ⬜

### M-21 — OTP generated with `Math.random()` (not CSPRNG)
- **Fix:** Replace with `crypto.randomInt(100000, 1000000)`.
- **Status:** ⬜

### M-22 — Mass assignment: `reserved_amount` writable via `updatePlannedNeed`
- **Fix:** Remove from `req.body` acceptance; only update via `addToFund()` or payment events.
- **Status:** ⬜

### M-23 — No magic-byte validation on job media upload
- **Fix:** Add magic-byte validation using `file-type` npm package.
- **Status:** ⬜

### M-24 — Profile photo stored as base64 in DB when S3 unavailable
- **Fix:** Require S3 in production; validate file content with magic bytes.
- **Status:** ⬜

### M-25 — Geo controller leaks Google Maps API errors to logs
- **Fix:** Use structured logger; sanitize API error details before logging.
- **Status:** ⬜

### M-26 — No pagination on `getJobBids`
- **Fix:** Add `LIMIT`/`OFFSET` pagination.
- **Status:** ⬜

### M-27 — Notification preferences dynamic SET clause (fragile pattern)
- **Fix:** Use explicit CASE expressions or separate update queries per toggle.
- **Status:** ⬜

### M-28 — Support ticket `category` not validated against allowlist
- **Fix:** Validate `category` against an allowlist.
- **Status:** ⬜

### M-29 — Admin `listTickets` status/priority filters not validated
- **Fix:** Validate against allowlists; return 400 for unrecognized values.
- **Status:** ⬜

### M-30 — `createJob` 500 error leaks raw PostgreSQL error message
- **Fix:** Return generic message to client; log full error server-side only.
- **Status:** ⬜

### M-31 — `bidController` uses `console.error` instead of structured logger
- **Fix:** Switch to structured logger.
- **Status:** ⬜

### M-32 — `profileChatMessage` creates conversations with arbitrary user IDs
- **Fix:** Verify `helperId` refers to a user with `role = 'helper'` before creating.
- **Status:** ⬜

### M-33 — No JWT algorithm pinning in `generateTokens()`
- **Fix:** Add `{ algorithm: 'HS256' }` to `jwt.sign` options.
- **Status:** ⬜

### M-34 — Upload middleware relies on browser-supplied MIME type
- **File:** `server/middleware/upload.js`
- **Fix:** Add magic-byte validation using `file-type`.
- **Status:** ⬜

### M-35 — Rate limiters bypassable via `X-Forwarded-For` spoofing
- **File:** `server/middleware/rateLimiter.js`
- **Fix:** Enforce strict `trust proxy`; add explicit `keyGenerator`.
- **Status:** ⬜

### M-36 — `hashTIN` uses unsalted SHA-256
- **File:** `server/utils/encryption.js`
- **Fix:** Use HMAC-SHA256 with dedicated key, or `scrypt`/`argon2` with per-row salt.
- **Status:** ⬜

### M-37 — Encryption key used without length validation
- **Fix:** Add startup check: `assert Buffer.from(key, 'hex').length === 32`.
- **Status:** ⬜

### M-38 — `ENCRYPTION_KEY` not in `validateEnv.js` required list
- **Fix:** Add `ENCRYPTION_KEY` to the `REQUIRED` array.
- **Status:** ⬜

### M-39 — Unescaped user data injected into JSON-LD block
- **File:** `server/middleware/prerenderHelperProfile.js`
- **Fix:** Replace `</script>` with `<\/script>` inside JSON strings.
- **Status:** ⬜

### M-40 — Unsanitized user content in HTML email body
- **File:** `server/utils/email.js`
- **Fix:** HTML-escape all interpolated values before insertion.
- **Status:** ⬜

### M-41 — User-controlled job title inserted into SMS body without sanitization
- **File:** `server/utils/sms.js`
- **Fix:** Strip control characters; cap length before use in message bodies.
- **Status:** ⬜

### M-42 — `userModel.findById` returns `SELECT u.*` including sensitive fields
- **Fix:** Enumerate non-sensitive columns explicitly.
- **Status:** ⬜

### M-43 — `userModel.findByEmail` returns `SELECT *` including password hash
- **Fix:** Create `findByEmailForAuth` returning only `id, email, password_hash, role, is_active, is_banned`.
- **Status:** ⬜

### M-44 — `userModel.findByUsername` returns `SELECT *`
- **Fix:** Use explicit column list excluding sensitive fields.
- **Status:** ⬜

### M-45 — `paymentModel.findByUserId` returns `SELECT *` including fee breakdowns
- **Fix:** Explicit column list returning only user-facing fields.
- **Status:** ⬜

### M-46 — `authService.js` is a stub — decentralized token logic
- **Fix:** Centralize all token generation and verification in `authService`.
- **Status:** ⬜

### M-47 — `feeService.js` in-memory cache has no staleness guard
- **Fix:** Add health-check gate; retry on failure; surface warning to operators.
- **Status:** ⬜

### M-48 — `matchService.js` bulk-insert dynamic SQL fragile on large arrays
- **Fix:** Add runtime check on array length before query construction.
- **Status:** ⬜

### M-49 — DB connection pool max of 10 — starvation risk under load
- **Fix:** Increase `max`; add per-IP WebSocket connection limit.
- **Status:** ⬜

### M-50 — `weeklySummary.js` hardcoded role strings not matching ROLES constants
- **Fix:** Import `ROLES` constants; use parameterized `IN` clause.
- **Status:** ⬜

### M-51 — `plannedNeedsScheduler.js` no deduplication guard on auto-publish
- **Fix:** Wrap INSERT + UPDATE in DB transaction; add `UNIQUE` on `jobs.planned_need_id`.
- **Status:** ⬜

### M-52 — `sendBulkNotification` failures silently discarded
- **Fix:** Log failed `userId` values; persist for retry on critical notifications.
- **Status:** ⬜

### M-53 — EIN stored in VARCHAR without encryption enforcement
- **Fix:** Rename to `ein_encrypted`; add application-layer validation.
- **Status:** ⬜

### M-54 — `tin_encrypted` column name doesn't enforce encryption
- **Fix:** Add application-layer validation to verify data is actually encrypted.
- **Status:** ⬜

### M-55 — No Row Level Security (RLS) anywhere in schema
- **Fix:** Enable RLS on: `sessions`, `messages`, `conversations`, `support_tickets`, `w9_records`.
- **Status:** ⬜

### M-56 — Missing `NOT NULL` on `admin_id` in `005_admin.sql`
- **Fix:** Align with `001`'s `NOT NULL` constraint.
- **Status:** ⬜

### M-57 — `feature_flags` schema divergence: `is_enabled` vs `enabled`
- **Fix:** Standardize on one column name across all definitions.
- **Status:** ⬜

### M-58 — `platform_settings` schema divergence: no `id` column at runtime
- **Fix:** Add migration to add `id` column or update application code.
- **Status:** ⬜

### M-59 — No index on `expires_at` for OTP cleanup
- **Fix:** Add composite index; implement reliable cleanup job.
- **Status:** ⬜

### M-60 — `IF NOT EXISTS` masks schema differences with different types
- **File:** `048_helper_coords.sql`, `029_add_pending_reg_user_tracking.sql`
- **Fix:** Use `ALTER COLUMN` to change types explicitly.
- **Status:** ⬜

### M-61 — `admin_audit_log` schema conflict: BIGSERIAL+TEXT vs UUID+UUID
- **Fix:** Align schema definitions; add migration to reconcile types.
- **Status:** ⬜

### M-62 — `dispute_messages` created twice with incompatible schemas
- **Fix:** Consolidate into single authoritative schema; add missing columns via `ALTER TABLE`.
- **Status:** ⬜

### M-63 — `jobs` table created twice with incompatible schemas
- **Fix:** Add missing columns via `ALTER TABLE`; consolidate schema definitions.
- **Status:** ⬜

---

## LOW (51 findings)

### L-01 — `POST /auth/check-zip` and `POST /auth/waitlist` no rate limiting
- **Fix:** Apply `authLimiter`.
- **Status:** ⬜

### L-02 — `GET /reviews/users/:userId` public with no rate limiting
- **Fix:** Add rate limiting.
- **Status:** ⬜

### L-03 — `GET /verification/badges/:userId` public with no rate limiting
- **Fix:** Add rate limiting; consider authentication.
- **Status:** ⬜

### L-04 — `feeConfig.js` routes missing explicit `authenticate` middleware
- **Fix:** Add `authenticate` before `requireAdmin`, matching `disputes.js` pattern.
- **Status:** ⬜

### L-05 — Inline DB queries in route handlers
- **File:** `routes/admin.js`, `routes/toolRentals.js`, `routes/userSkills.js`, `routes/privacy.js`
- **Fix:** Refactor into dedicated controller files.
- **Status:** ⬜

### L-06 — `POST /chat/message` is fully public with only `chatLimiter`
- **Fix:** Review `chatLimiter` window/limit; document as intentional.
- **Status:** ⬜

### L-07 — Misleading comment contradicts actual middleware on `GET /plannedNeeds/templates`
- **Fix:** Correct the comment to match the actual code.
- **Status:** ⬜

### L-08 — Helper availability/pricing/slots expose scheduling data publicly
- **Fix:** Add rate limiting; consider auth for scheduling data.
- **Status:** ⬜

### L-09 — `setup2FA` returns raw TOTP secret; unconfirmed secrets persist
- **Fix:** Delete unconfirmed secrets after a timeout; ensure HTTPS-only transmission.
- **Status:** ⬜

### L-10 — Backup code entropy is 32 bits (below NIST recommendation)
- **Fix:** Increase to `crypto.randomBytes(6)` or `crypto.randomBytes(8)`.
- **Status:** ⬜

### L-11 — `getUserBadges` undocumented public endpoint pattern
- **Fix:** Add explicit comment documenting as intentionally public.
- **Status:** ⬜

### L-12 — `verifyOTP` returns 404 for non-existent users (account enumeration)
- **Fix:** Return same message regardless, matching `forgotPassword` pattern.
- **Status:** ⬜

### L-13 — `checkEmail` confirms account existence without auth (bulk enumeration)
- **Fix:** Add rate limiting or CAPTCHA.
- **Status:** ⬜

### L-14 — Multiple controllers use `console.error` instead of structured logger
- **File:** 12 controllers
- **Fix:** Standardize on `logger.error` across all controllers.
- **Status:** ⬜

### L-15 — `getJobs` unvalidated sort parameter falls back silently
- **Fix:** Return 400 for unrecognized sort values.
- **Status:** ⬜

### L-16 — Both client and helper can trigger job state transitions
- **File:** `controllers/jobController.js`
- **Fix:** Restrict: helper marks done, client confirms completion.
- **Status:** ⬜

### L-17 — `assignHelper` doesn't verify `helper_id` is an actual helper
- **Fix:** Verify `helper_id` corresponds to user with `role = 'helper'`.
- **Status:** ⬜

### L-18 — `resendOTP` allows email lookup with no rate limiting
- **Fix:** Add per-email rate limiting.
- **Status:** ⬜

### L-19 — Pagination params not integer-clamped in multiple controllers
- **File:** `bidController.js`, `notificationController.js`, `reviewController.js`
- **Fix:** `parseInt()`; enforce maximum limits.
- **Status:** ⬜

### L-20 — Referral controller exposes referred user IDs and join dates
- **Fix:** Remove user UUIDs and PII; return only aggregate count.
- **Status:** ⬜

### L-21 — Geo controller caches raw user queries, LRU eviction missing
- **Fix:** Add LRU cache eviction; normalize query strings.
- **Status:** ⬜

### L-22 — Deprecated `completeRegistration` still exported and reachable
- **Fix:** Remove or explicitly disable.
- **Status:** ⬜

### L-23 — W9 signature data stored without format/size validation
- **Fix:** Add size limit and format check.
- **Status:** ⬜

### L-24 — Admin reply includes admin email in message record
- **Fix:** Replace admin email with generic 'OxSteed Support' identifier.
- **Status:** ⬜

### L-25 — `getCommunityStats` fragile positional parameter reuse
- **Fix:** Build conditions array once; derive all WHERE clauses from it.
- **Status:** ⬜

### L-26 — Two redundant auth middlewares with inconsistent behavior
- **File:** `authenticate.js` vs `auth.js`
- **Fix:** Remove `authenticate.js`; import directly from `auth.js`.
- **Status:** ⬜

### L-27 — `requireRole` duplicated in `auth.js` and `requireRole.js`
- **Fix:** Consolidate into single implementation.
- **Status:** ⬜

### L-28 — Audit log records `req.ip` without trust-proxy awareness
- **Fix:** Normalize IP extraction; validate against known proxy configuration.
- **Status:** ⬜

### L-29 — Non-fatal audit failure silently swallowed
- **Fix:** Forward to structured logger; trigger alert on persistent failures.
- **Status:** ⬜

### L-30 — `getPublicUrl` constructs unvalidated S3 path
- **Fix:** Assert `key` matches expected pattern before constructing URL.
- **Status:** ⬜

### L-31 — `noScript` regex in `validate.js` easily bypassed
- **Fix:** Remove rule (rely on sanitize middleware) or replace with proper allowlist.
- **Status:** ⬜

### L-32 — Email validation regex is overly permissive
- **Fix:** Use stricter regex or `validator.js`.
- **Status:** ⬜

### L-33 — `requireRole.js` imports but does not use `isInGroup`
- **Fix:** Wire in or remove the unused import.
- **Status:** ⬜

### L-34 — Logger logs full request path including potential PII
- **Fix:** Normalize/redact sensitive path segments in production logs.
- **Status:** ⬜

### L-35 — `email.js` logs recipient email address to stdout
- **Fix:** Remove or replace with masked address or message ID.
- **Status:** ⬜

### L-36 — `sms.js` logs raw Twilio error messages (phone number PII)
- **Fix:** Use structured logger; redact phone numbers from error messages.
- **Status:** ⬜

### L-37 — `jobModel.getPublicFeed` limit has no max enforcement
- **Fix:** `limit = Math.min(parseInt(limit) || 20, 100)`.
- **Status:** ⬜

### L-38 — `jobModel.getPublicFeed` radiusMiles not capped
- **Fix:** `radiusMiles = Math.min(parseFloat(radiusMiles) || 25, 100)`.
- **Status:** ⬜

### L-39 — `fuzzCoords` uses `Math.random()` (non-cryptographic PRNG)
- **Fix:** Use `crypto.randomInt()`; confirm fuzz only applied at creation.
- **Status:** ⬜

### L-40 — `auditService.js` doesn't normalize IPv6-mapped IPv4
- **Fix:** Normalize IPs before hashing (strip `::ffff:` prefix).
- **Status:** ⬜

### L-41 — `authService.js` doesn't specify JWT algorithm in `jwt.verify()`
- **Fix:** Add `{ algorithms: ['HS256'] }`.
- **Status:** ⬜

### L-42 — DB SSL only enabled for `NODE_ENV === 'production'`
- **Fix:** Enable SSL by default; opt out via explicit `sslmode=disable`.
- **Status:** ⬜

### L-43 — `.env.example` `DIDIT_WORKFLOW_ID` contains real-looking UUID
- **Fix:** Verify and rotate if real; replace with placeholder string.
- **Status:** ⬜

### L-44 — `termsConfig.js` version dates mismatch `userModel.create`
- **Fix:** Use a single source of truth for terms version.
- **Status:** ⬜

### L-45 — Dockerfile client built with `npm install` (not `npm ci`)
- **Fix:** Replace with `npm ci`.
- **Status:** ⬜

### L-46 — Webhook routes mounted before rate limiting (undocumented)
- **Fix:** Document as intentional; verify all webhook routes enforce signature verification.
- **Status:** ⬜

### L-47 — Missing indexes on FK columns (DoS vector)
- **File:** Migrations 017, 021, 005, 023, 049
- **Fix:** Add indexes on all FK columns.
- **Status:** ⬜

### L-48 — Missing transaction wrappers on DDL-heavy migrations
- **File:** 18 migrations listed
- **Fix:** Wrap all multi-statement migrations in `BEGIN`/`COMMIT`.
- **Status:** ⬜

### L-49 — Placeholder Stripe IDs in production migration
- **File:** `032_update_plans_pricing.sql`
- **Fix:** Use environment variables for Stripe IDs; add runtime validation.
- **Status:** ⬜

### L-50 — `helper_profiles` created twice; 019's `IF NOT EXISTS` skipped
- **Fix:** Verify migration `033` runs successfully.
- **Status:** ⬜

### L-51 — Plans/subscriptions seeded with inconsistent pricing
- **Fix:** Create single authoritative migration for plan pricing.
- **Status:** ⬜

---

## INFO (19 findings)

### I-01 — `optionalAuth` may 401 on expired tokens instead of falling through
- **Fix:** Verify `authenticate` behavior on expired tokens; wrap in try/catch.
- **Status:** ⬜

### I-02 — `POST /auth/refresh` uses `authLimiter` not `strictLimiter`
- **Fix:** Evaluate whether `strictLimiter` should apply to refresh.
- **Status:** ⬜

### I-03 — No input validation middleware on any route file
- **Fix:** Add `express-validator` or `zod` declarative validation at route level.
- **Status:** ⬜

### I-04 — `updateSetting` has no allowlist on `key` parameter
- **Fix:** Maintain explicit allowlist of modifiable keys.
- **Status:** ⬜

### I-05 — ✅ `createCheckout` price is server-authoritative (no fix needed)
- **Status:** ✅

### I-06 — ✅ `createPaymentIntent` amount from DB not client (no fix needed)
- **Status:** ✅

### I-07 — `SELECT *` in internal queries
- **Fix:** Use specific column lists.
- **Status:** ⬜

### I-08 — `console.error` instead of structured logger across 8 controllers
- **Fix:** Standardize on structured logger.
- **Status:** ⬜

### I-09 — OTP comparison not timing-safe in `helperRegistrationController`
- **Fix:** Use `crypto.timingSafeEqual` for completeness.
- **Status:** ⬜

### I-10 — `sanitize.js` regex tag stripping has known bypasses
- **Fix:** Use `DOMPurify` or `sanitize-html` with allowlist for rich-text.
- **Status:** ⬜

### I-11 — CSP `styleSrc` includes `'unsafe-inline'`
- **Fix:** Migrate to CSS hashes or nonces.
- **Status:** ⬜

### I-12 — CSP `imgSrc` allows `https:` wildcard
- **Fix:** Restrict to known CDN origins and `data:`/`blob:`.
- **Status:** ⬜

### I-13 — `JWT_SECRET` minimum length check is weak (32 chars, no entropy)
- **Fix:** Increase to 64 characters minimum; document `openssl rand -hex 32`.
- **Status:** ⬜

### I-14 — Push notification payload not size-validated
- **Fix:** Validate payload size before sending (Web Push ~4 KB limit).
- **Status:** ⬜

### I-15 — `feeCalculator.js` cache exported but never implemented
- **Fix:** Document as unimplemented or remove dead code.
- **Status:** ⬜

### I-16 — Coordinate fuzzing `+/-2 miles` may be insufficient for rural areas
- **Fix:** Consider `+/-5 miles` for low-density areas.
- **Status:** ⬜

### I-17 — `matchService.js` WKT string uses interpolation without `parseFloat` coercion
- **Fix:** Add `parseFloat()` as safety measure.
- **Status:** ⬜

### I-18 — `roles.js` naming inconsistency; `'both'` role missing from constants
- **Fix:** Reconcile role values; add `'both'` to constants or remove from queries.
- **Status:** ⬜

### I-19 — No Resend API key validation — silent email failures
- **Fix:** Add retry mechanism and alerting for critical notification types.
- **Status:** ⬜

---

## Migration Ordering Failures (9 blockers — fresh install broken)

| # | Migration File | Problem | PostgreSQL Error |
|---|---------------|---------|-----------------|
| 1 | `001_onboarding_tiers_tier3.sql` | `ALTER TABLE pending_registrations` — table doesn't exist until migration #12 | `relation "pending_registrations" does not exist` |
| 2 | `001_onboarding_tiers_tier3.sql` | FK `pending_registrations.user_id INTEGER` vs `users.id UUID` | `foreign key columns incompatible types` |
| 3 | `010_phase3_create_plans.sql` | INSERT references `plans.tier` column — never added by `001` | `column "tier" does not exist` |
| 4 | `005_admin.sql` | INSERT uses `feature_flags.enabled` but runtime column is `is_enabled` | `column "enabled" does not exist` |
| 5 | `023_create_platform_settings_and_feature_flags.sql` | Same `enabled` vs `is_enabled` error | `column "enabled" does not exist` |
| 6 | `020_add_consent_indexes.sql` | Index on `user_consents.created_at` but column is `accepted_at` | `column "created_at" does not exist` |
| 7 | `025_merge_legacy_unique_fields.sql` | UUID/INTEGER FK mismatch + missing `referral_code` + missing `market_id` | Multiple errors |
| 8 | `032_update_plans_pricing.sql` | References `plans.tier` and `plans.active` — neither exists | `column "tier" does not exist` |
| 9 | `030_update_plan_prices_stripe_ids.sql` | No hard error but `plans.tier` never added — data permanently incomplete | Data integrity failure |

**Resolution:** Renumber migrations, reconcile column names and type conflicts before any fresh deployment.

---

## Production Readiness Checklist

- [ ] Dockerfile: Add non-root user (`USER app`)
- [ ] Dockerfile + CI: Replace `npm install` with `npm ci`
- [ ] `migrate.js`: Set `rejectUnauthorized: true`
- [ ] DB SSL: Enable for all environments (not only `production`)
- [ ] DB pool: Increase `max` beyond 10 connections
- [ ] `validateEnv.js`: Add `ENCRYPTION_KEY` to required list
- [ ] `.env.example`: Change Stripe placeholders to `sk_test_REPLACE_ME`
- [ ] `JWT_SECRET`: Enforce 64-char minimum; add entropy check
- [ ] Replace `speakeasy` with `otplib`
- [ ] `trust proxy`: Document and re-evaluate before adding CDN
- [ ] Fix 9 migration ordering failures before any fresh install
- [ ] Enable RLS on sensitive tables
- [ ] Standardize all controllers on structured logger
