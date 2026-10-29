// Which operations tool the desk shows, and whether the ops query has to change.
// allowedKeys is the permission-filtered module list (screens only for display
// staff). A requested manager tool must not become the active tool: the board
// would hide, the panel would not mount, and the unauthorized query would
// survive refresh.

export function resolveOperationsDesk(requestedOps, allowedKeys) {
  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys || []);
  const requested = typeof requestedOps === 'string' && requestedOps.length > 0 ? requestedOps : null;
  if (requested && allowed.has(requested)) {
    return { active: requested, rewrite: false, nextOps: requested };
  }
  const active = allowed.size === 1 ? allowed.values().next().value : null;
  return { active, rewrite: requested != null, nextOps: active };
}
