'use strict';

// Shared TOTP replay guard (Domain 6 auth finding #7).
//
// A TOTP code stays valid for its 30-second step, so the same code could
// previously verify at every channel (login 2FA, fresh-auth mint, TOTP
// setup/verify, payout-method step-up, card security, growth approvals)
// until the step rolled over. Only the admin credit step-up recorded the
// used counter. Every verify site now consumes the current step counter
// in totp_used_counters after a successful verification; a second
// presentation in the same step is rejected.
//
// The consume is one atomic upsert: the INSERT succeeds (one row
// returned) only when the new counter is strictly greater than the
// stored max, so two concurrent verifications of the same code cannot
// both succeed. Callers pass either the shared pool or a transaction
// client; inside a transaction the consume commits or rolls back with
// the caller's work.
//
// The recorded counter is the CURRENT time step, matching the previous
// admin step-up pattern (stepupChallengeService.verifyTotpPresentation).
// Residual, by construction of that pattern: a code generated in step C
// but first presented in step C+1 (otplib window 1) records C+1, so a
// replay in step C+2 still verifies against the window and passes the
// counter check. The same-step replay, the realistic shoulder-surf/log
// case, is closed at every site.

const TOTP_TIME_STEP_SECONDS = 30;

/**
 * Consume the current TOTP time-step counter for a user.
 * @param {object} db - pg pool or transaction client with .query
 * @param {string} userId
 * @returns {Promise<boolean>} true when the counter was fresh and is now
 *   recorded; false when this step's counter was already consumed (replay).
 */
async function consumeTotpCounter(db, userId) {
  const counter = Math.floor(Date.now() / (TOTP_TIME_STEP_SECONDS * 1000));
  const { rows } = await db.query(
    `INSERT INTO totp_used_counters (user_id, max_counter, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET max_counter = EXCLUDED.max_counter, updated_at = NOW()
     WHERE EXCLUDED.max_counter > totp_used_counters.max_counter
     RETURNING max_counter`,
    [userId, counter]
  );
  return rows.length === 1;
}

module.exports = { consumeTotpCounter, TOTP_TIME_STEP_SECONDS };
