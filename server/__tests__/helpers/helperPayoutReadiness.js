'use strict';

// Synthetic provider results for disposable database fixtures. This supplies
// payout evidence only; callers must separately establish identity, terms,
// and an effective helper grant. Never bypass the real access middleware.
async function seedHelperPayoutReadiness(db, userId) {
  await db.query(
    `UPDATE users SET w9_completed = TRUE, didit_status = 'verified',
                      didit_verified_at = NOW() WHERE id = $1`,
    [userId],
  );
  await db.query(
    `INSERT INTO connect_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete)
     VALUES ($1, $2, TRUE, TRUE, TRUE)
     ON CONFLICT (user_id) DO UPDATE SET charges_enabled = TRUE,
       payouts_enabled = TRUE, onboarding_complete = TRUE`,
    [userId, `acct_fixture_${String(userId).replace(/-/g, '')}`],
  );
}

module.exports = { seedHelperPayoutReadiness };
