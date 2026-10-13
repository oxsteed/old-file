/**
 * Central rules for Didit identity gating (API + skip endpoint).
 *
 * DIDIT_ALLOW_USER_SKIP - default 'false': users may POST /didit/skip only
 * when the deployment explicitly opts into the non-verifying path. This keeps
 * a missing environment setting fail-closed.
 *
 * didit_enforcement_required (per user) - when true, only verified satisfies
 * the gate; skip is blocked and API routes require verified.
 */

function diditAllowUserSkip() {
  return process.env.DIDIT_ALLOW_USER_SKIP === 'true';
}

// Didit approvals are valid for two years from the provider-approved time.
// Keep this fixed and fail closed when the timestamp is missing or malformed;
// callers must require a fresh verification before granting protected access.
const DIDIT_VERIFICATION_TTL_YEARS = 2;

function isDiditVerificationFresh(verifiedAt, now = new Date()) {
  if (!verifiedAt) return false;
  const verifiedDate = new Date(verifiedAt);
  if (Number.isNaN(verifiedDate.getTime())) return false;
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - DIDIT_VERIFICATION_TTL_YEARS);
  return verifiedDate > cutoff;
}

/** User row must include didit_status and didit_enforcement_required */
function isDiditIdentitySatisfied(user) {
  if (!user) return false;
  const ds = user.didit_status || 'pending';
  if (user.didit_enforcement_required) {
    return ds === 'verified' && isDiditVerificationFresh(user.didit_verified_at);
  }
  return (ds === 'verified' && isDiditVerificationFresh(user.didit_verified_at)) || ds === 'skipped';
}

module.exports = {
  diditAllowUserSkip,
  isDiditVerificationFresh,
  isDiditIdentitySatisfied,
};
