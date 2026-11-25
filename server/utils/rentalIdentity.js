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
const { isDiditVerificationFresh } = require('./diditGate');

function rentalIdentityStatus(user) {
  if (!user) return { status: 'not_started', verified: false, verifiedAt: null };
  const diditStatus = user.didit_status || null;
  const verifiedAt = user.didit_verified_at || null;
  const verified = (diditStatus === 'verified' && isDiditVerificationFresh(verifiedAt))
    || user.identity_verified === true
    || user.id_verified === true;
  if (verified) return { status: 'verified', verified: true, verifiedAt };
  if (diditStatus === 'skipped') return { status: 'skipped', verified: false, verifiedAt };
  if (['failed', 'declined', 'duplicate'].includes(diditStatus)) {
    return { status: 'failed', verified: false, verifiedAt };
  }
  if (['expired', 'abandoned', 'canceled', 'cancelled'].includes(diditStatus)) {
    return { status: 'expired', verified: false, verifiedAt };
  }
  if (diditStatus === 'verified') return { status: 'expired', verified: false, verifiedAt };
  if (!diditStatus) return { status: 'not_started', verified: false, verifiedAt };
  return { status: 'pending', verified: false, verifiedAt };
}

module.exports = { rentalIdentityStatus };
