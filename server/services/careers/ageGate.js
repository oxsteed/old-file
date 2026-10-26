'use strict';

// 18+ gate (careers spec R9, Q9) and the identity check before accepting
// an offer (§14 Didit). Age comes from the existing age verification
// (growth_subject_eligibility, migration 99991); no date of birth is ever
// stored by Careers. Fails closed: no row means not confirmed.

const { AppError } = require('../../middleware/errorHandler');
const { isDiditVerificationFresh } = require('../../utils/diditGate');

async function isAdultConfirmed(db, userId) {
  if (!userId) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM growth_subject_eligibility
      WHERE user_id = $1 AND adult_confirmed = TRUE AND revoked_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

async function assertAdult(db, userId) {
  if (!(await isAdultConfirmed(db, userId))) {
    throw new AppError('Confirm you are 18 or older to use Careers', 403, 'age_verification_required', {
      age: 'Careers is for people 18 and older',
    });
  }
}

// Careers requires a real Didit verification: a "skipped" status does
// not count here, unlike some marketplace flows.
async function isIdentityVerified(db, userId) {
  const { rows: [user] } = await db.query('SELECT didit_status, didit_verified_at FROM users WHERE id = $1', [userId]);
  return Boolean(user && user.didit_status === 'verified' && isDiditVerificationFresh(user.didit_verified_at));
}

module.exports = { isAdultConfirmed, assertAdult, isIdentityVerified };
