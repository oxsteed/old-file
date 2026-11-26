'use strict';

// Group 11 item 571 (D-259): identity means the platform
// identity-verification state (Didit). This reuses the existing Didit
// integration (users.didit_status / didit_verified_at, plus the
// identity_verified / id_verified flags) and introduces no new vendor.
//
// "Verified" is deliberately stricter than the platform's general
// isDiditIdentitySatisfied gate: a user who skipped verification
// ('skipped') satisfies the general gate when enforcement is off, but
// has NOT verified their identity, so they cannot complete a tool
// pickup. Only a fresh Didit approval (2-year TTL, same as diditGate)
// or one of the verified flags counts.
//
// G11-A4 (D-605): the flags count only while their own verification
// time is fresh (users.identity_verified_at, 2-year TTL). Stripe
// Identity used to set the flags with no timestamp, so a flag alone
// bypassed the TTL forever; a flag with no (or a stale) timestamp is
// now fail-closed, and the user must re-verify. Didit approvals stamp
// identity_verified_at at the same instant as didit_verified_at, so
// the two paths expire together.
const { isDiditVerificationFresh } = require('./diditGate');

function rentalIdentityStatus(user) {
  if (!user) return { status: 'not_started', verified: false, verifiedAt: null };
  const diditStatus = user.didit_status || null;
  const diditVerifiedAt = user.didit_verified_at || null;
  const flagVerifiedAt = user.identity_verified_at || null;
  const diditFresh = diditStatus === 'verified' && isDiditVerificationFresh(diditVerifiedAt);
  const flagFresh = (user.identity_verified === true || user.id_verified === true)
    && isDiditVerificationFresh(flagVerifiedAt);
  // The reported time is the fresh verification that actually counts.
  const verifiedAt = diditFresh ? diditVerifiedAt : (flagFresh ? flagVerifiedAt : diditVerifiedAt);
  if (diditFresh || flagFresh) return { status: 'verified', verified: true, verifiedAt };
  if (diditStatus === 'skipped') return { status: 'skipped', verified: false, verifiedAt: diditVerifiedAt };
  if (['failed', 'declined', 'duplicate'].includes(diditStatus)) {
    return { status: 'failed', verified: false, verifiedAt: diditVerifiedAt };
  }
  if (['expired', 'abandoned', 'canceled', 'cancelled'].includes(diditStatus)) {
    return { status: 'expired', verified: false, verifiedAt: diditVerifiedAt };
  }
  if (diditStatus === 'verified') return { status: 'expired', verified: false, verifiedAt: diditVerifiedAt };
  if (!diditStatus) return { status: 'not_started', verified: false, verifiedAt: diditVerifiedAt };
  return { status: 'pending', verified: false, verifiedAt: diditVerifiedAt };
}

module.exports = { rentalIdentityStatus };
