/**
 * Central rules for Didit identity gating (API + skip endpoint).
 *
 * DIDIT_ALLOW_USER_SKIP - default 'true': users may POST /didit/skip to set
 * didit_status=skipped even when DIDIT_API_KEY is set. Set to 'false' to
 * require Didit whenever the integration is configured (legacy strict mode).
 *
 * didit_enforcement_required (per user) - when true, only verified satisfies
 * the gate; skip is blocked and API routes require verified.
 */

function diditAllowUserSkip() {
  return process.env.DIDIT_ALLOW_USER_SKIP !== 'false';
}

/** User row must include didit_status and didit_enforcement_required */
function isDiditIdentitySatisfied(user) {
  if (!user) return false;
  const ds = user.didit_status || 'pending';
  if (user.didit_enforcement_required) {
    return ds === 'verified';
  }
  return ds === 'verified' || ds === 'skipped';
}

module.exports = {
  diditAllowUserSkip,
  isDiditIdentitySatisfied,
};
