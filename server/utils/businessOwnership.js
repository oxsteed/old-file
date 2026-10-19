const { resolveBusinessAccess } = require('../services/scopeModel');

// Preserve the legacy helpers' return shapes and domain policies. The shared
// resolver supplies ownership/membership; it does not invent platform-admin
// access or silently change which legacy paths include deleted businesses.
function businessFields(row) {
  return { id: row.id, business_name: row.business_name, is_primary: row.is_primary, tax_rate: row.tax_rate };
}
function isOwner(row, userId) { return !!row?.owner_id && String(row.owner_id).toLowerCase() === String(userId).toLowerCase(); }
async function ownedBusiness(userId, bizId) {
  const row = await resolveBusinessAccess(userId, bizId, { includeDeleted: true });
  return isOwner(row, userId) ? businessFields(row) : null;
}
async function canEditProfile(userId, bizId) {
  const row = await resolveBusinessAccess(userId, bizId, { includeDeleted: true });
  return row && (isOwner(row, userId) || row.effective_role === 'manager') ? { id: row.id, owner_id: row.owner_id } : null;
}
async function canAccessBusinessTeam(userId, bizId) {
  const row = await resolveBusinessAccess(userId, bizId, { includeDeleted: true });
  return row ? { id: row.id, owner_id: row.owner_id } : null;
}
async function canManageBusinessFinance(userId, bizId) {
  const row = await resolveBusinessAccess(userId, bizId);
  return row && (isOwner(row, userId) || row.effective_role === 'manager') ? { ...businessFields(row), owner_id: row.owner_id } : null;
}
async function canAccessBusiness(userId, bizId, roles = ['owner','manager']) {
  if (!userId || bizId == null) return false;
  const allowed = Array.isArray(roles) && roles.length ? roles : ['owner','manager'];
  // Keep the documented historical any-active-member team behavior.
  return !!(await (allowed.some(role => !['owner','manager'].includes(role))
    ? canAccessBusinessTeam(userId, bizId) : canEditProfile(userId, bizId)));
}
module.exports = { ownedBusiness, canEditProfile, canAccessBusiness, canAccessBusinessTeam, canManageBusinessFinance };
