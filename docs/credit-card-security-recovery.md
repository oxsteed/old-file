# Credit card security and recovery

Implementation date: 2026-10-05. This document describes the new code, not a
production launch approval. Existing restricted-value ledger and launch controls
remain authoritative; these cards are not general-purpose bank cards.

## Customer behavior

| Action | Guardrail |
| --- | --- |
| Freeze / report lost or stolen | Immediate owner-authorized block; no emailed code delays emergency protection. |
| Unfreeze | Only a customer-origin freeze; fresh password, enrolled TOTP and emailed code. Staff/system/legacy freezes require review. |
| Found after reporting | Records the discovery; the retired credential remains permanently disabled. |
| Replacement | Durable queue, unique replacement, initially inactive with no spend credential. |
| Activate | Fresh verification; physical cards also require their printed activation code. |
| Set/reset PIN | Fresh verification bound to the exact new PIN/reset action. |
| View history | Owner-only, bounded pages; private staff evidence is omitted. |

Lost, stolen, revoked and expired states cannot change lifecycle state through
the API or a direct database update. Recovering a physical card does not restore
its old credential. Replacement failures never undo retirement or move money.
The existing ordinary virtual-card issuance flow remains unchanged.

## Verification and retries

- Codes expire in ten minutes and are single-use. Challenges bind owner, card,
  action, payload, authenticated session, email and authentication configuration.
- Five failures cause a fifteen-minute lock; resends have a sixty-second cooldown.
  Rejected verification attempts commit their counters before returning errors.
- Only verified active owners can start verification. Impersonated sessions are
  denied. Passwordless accounts use support rather than bypassing verification.
- Passwords, PINs and emailed codes are not stored in replay receipts, history,
  client storage or logs. Challenge codes/payloads use keyed hashes.
- Final requests require an idempotency key. Same-key retries replay a sanitized
  receipt and refresh card state; they never re-reveal a spend credential or
  resurrect a subsequently blocked card. A changed action or payload conflicts.
- API clients must adopt the challenge-plus-final-request flow for activation,
  unfreeze and PIN changes. Older callers lacking proof fail closed; this change
  does not introduce a weaker compatibility bypass.
- Failed email delivery burns the grant and leaves the card unchanged.
- Kiosk PIN failures are persisted separately after financial rollback. Row
  locks accumulate concurrent guesses and enforce the existing five-attempt
  lockout. Concurrent PIN resets/retirement do not penalize new credentials.
  Direct transaction-level helpers are internal; production callers must use the
  public transaction wrappers to retain this failure-accounting behavior.

## Operator workflow

1. Open Super Admin > OxSteed Credit > Cards. Filter for the customer and expand
   Security history for actor, time, reason, correlation, IP and state evidence.
2. Review the retired card and replacement state. Ready means *inactive*, not
   payout-ready or spending-ready. The owner must verify activation.
3. For a failed replacement, resolve the underlying owner/account restriction
   first. Authorize another attempt with a review reason. Retries are audited
   and cannot reactivate the original credential.
4. Monitor the existing Credit notification worker heartbeat, backlog and failed
   deliveries. Replacement work runs in bounded batches with row locks and
   durable retries; terminal errors appear in card history and customer notices.
5. Rail suspension pauses replacement issuance, but committed security notices
   continue draining. Notices use the existing idempotent notification service,
   mandatory transactional email and retryable outbox. No second ledger exists.

Security history is append-only. The worker removes expired authentication
challenges only after thirty days, in bounded batches; it does not remove audit
events or replay receipts. Existing sent-notification retention remains intact.

## Deployment and acceptance

- Apply additive migration `681_credit_card_security_recovery.sql` with the
  normal migration runner before starting the updated application. Do not edit
  historical migrations or backfill authentication grants/freeze provenance.
- Existing legacy freezes deliberately require staff review. Historical audit
  evidence remains unchanged; new account-status revocations carry the owner
  reference so security notices reach the correct customer.
- Verification uses the existing runtime email service, JWT secret and enrolled
  TOTP decryption configuration. No live credential was retrieved or changed
  during this implementation. Missing email/crypto configuration fails closed.
- After deployment, verify the exact revision and migration readiness, worker
  heartbeat, and a consented owner flow using a controlled account. Check actual
  email delivery, single-use activation and customer/admin history. Do not run
  synthetic financial fixtures against production.

## Verification evidence

Commands run against local code / synthetic isolated data:

- Client `npm run verify:i18n`, `npm run typecheck`, `npm run build:ci`.
- Focused card/security/notification/rail Jest tests: five suites, 73 tests pass.
- Real PostgreSQL rehearsal: migration application/replay, concurrent restore,
  immutable retirement, durable replacement failure, inactive activation,
  action-bound PIN reset, concurrent kiosk lockout, zero rejected-spend ledger
  entries, notification uniqueness and owner/staff privacy.
  The final fresh database applied all 676 migration files successfully, then
  replayed the migration runner successfully before the concurrency rehearsal.
- Browser regression fixture: all five languages, RTL, mobile/desktop, both
  themes, reduced motion, verification, found-card/history, retired-card controls
  and replacement activation. Existing browser suites pass; live authenticated
  admin scenarios are skipped without their configured test environment.
- Full server run: 380 suites / 4,130 tests passed, three suites skipped; one existing video suite
  has three failures because this Mac has no `/usr/bin/ffmpeg`. CI installs it.

`server/scripts/credit-card-security-rehearsal.js` refuses remote databases and
any database name other than disposable localhost `credit_card_security_test`.
CI applies the full migration chain twice and runs this real-database rehearsal.
Local fixture results do not prove live email delivery or production deployment.
