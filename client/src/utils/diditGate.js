// Client mirror of server/utils/diditGate.js (Domain 6 B3, 2026-11-17).
//
// ProtectedRoute used to treat any didit_status === 'verified' as
// satisfied, ignoring the server's 2-year freshness rule, so a user with a
// stale verification rendered helper-activation pages the server then
// 403'd (dead page behind a satisfied-looking gate). Keep the two halves
// identical: verified only counts while fresh; a missing or malformed
// didit_verified_at fails closed, exactly like the server.
// user.didit_verified_at reaches the client via formatAuthUser
// (server/controllers/authController.js) and the passthrough user payload
// in AuthContext, so no context change is needed for this gate.

export const DIDIT_VERIFICATION_TTL_YEARS = 2;

export function isDiditVerificationFresh(verifiedAt, now = new Date()) {
  if (!verifiedAt) return false;
  const verifiedDate = new Date(verifiedAt);
  if (Number.isNaN(verifiedDate.getTime())) return false;
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - DIDIT_VERIFICATION_TTL_YEARS);
  return verifiedDate > cutoff;
}

export function diditGateSatisfied(user) {
  if (!user?.email_verified) return true;
  const ds = user.didit_status || 'pending';
  if (user.didit_enforcement_required) {
    return ds === 'verified' && isDiditVerificationFresh(user.didit_verified_at);
  }
  return (ds === 'verified' && isDiditVerificationFresh(user.didit_verified_at)) || ds === 'skipped';
}
