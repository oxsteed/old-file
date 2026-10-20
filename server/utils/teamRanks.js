'use strict';

/**
 * server/utils/teamRanks.js
 *
 * Shared role-rank ordering for team-management guardrails (staff review
 * S-03/S-09). Mirrors ROLE_RANK in middleware/requireBusinessAccess —
 * owner > manager > representative > support_agent > employee.
 *
 * Rule of thumb: an actor may only invite, edit, remove or re-permission
 * members whose role ranks strictly BELOW their own. Owners (rank top)
 * may act on anyone; changes involving a manager are therefore owner-only
 * in practice, because a manager's peers are not below them.
 */

const ROLE_RANK = {
  owner: 5,
  manager: 4,
  representative: 3,
  support_agent: 2,
  employee: 1,
};

function roleRank(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, role) ? ROLE_RANK[role] : null;
}

/**
 * True when `actorRole` outranks `targetRole` (owner outranks everyone).
 * Unknown roles fail closed.
 */
function canActOnRole(actorRole, targetRole) {
  if (actorRole === 'owner') return true;
  const actor = roleRank(actorRole);
  const target = roleRank(targetRole);
  if (actor == null || target == null) return false;
  return target < actor;
}

/**
 * Best-effort resolution of the caller's role on a business, without a DB
 * hit: business ownership wins, then the role attached by
 * requireBusinessAccess (req.businessRole), then any effective_role the
 * legacy bizIdAccess attachment carries. Returns null when the role cannot
 * be determined from the request (callers decide whether that fails open
 * to the route-level gate or closed).
 */
function resolveActorRole(req, ownerId) {
  if (req && req.user && ownerId && String(req.user.id) === String(ownerId)) {
    return 'owner';
  }
  if (req && req.businessRole) return req.businessRole;
  if (req && req.business && req.business.effective_role) return req.business.effective_role;
  return null;
}

module.exports = { ROLE_RANK, roleRank, canActOnRole, resolveActorRole };
