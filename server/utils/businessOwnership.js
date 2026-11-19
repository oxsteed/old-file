const { resolveBusinessAccess } = require('../services/scopeModel');
const permissionsService = require('../services/permissionsService');

// Finance permission codes (migration 245). Read codes admit a member to
// finance reads; write codes gate finance writes. Role defaults + membership
// overrides decide the effective set (permissionsService); the owner holds
// every code. Managers hold the read codes and invoices.create by default
// but NOT payouts.manage or refunds.approve, so payout management and
// refund approval stay owner-or-explicitly-granted.
const FINANCE_READ_CODES = ['invoices.view', 'payments.view', 'payouts.view'];
const FINANCE_WRITE_CODE = 'invoices.create';

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
// G-8: finance reads are code-gated, not role-gated. An owner reads; any
// active member whose effective permissions include a finance read code
// (role default or an explicit membership override) reads; a manager with
// a deny override on every read code does not. Kept separate from
// canManageBusinessFinance, which other surfaces still use for writes.
async function canReadBusinessFinance(userId, bizId) {
  const row = await resolveBusinessAccess(userId, bizId);
  if (!row) return null;
  if (isOwner(row, userId)) return { ...businessFields(row), owner_id: row.owner_id };
  if (!row.effective_role) return null;
  const { permissions } = await permissionsService.getEffectivePermissions({
    businessId: row.id, userId, role: row.effective_role, membershipId: row.membership_id,
  });
  return permissionsService.hasAny(permissions, FINANCE_READ_CODES)
    ? { ...businessFields(row), owner_id: row.owner_id } : null;
}
// G-8: finance writes are code-gated. Defaults: managers hold
// invoices.create, so expense/quote/recurring/invoice writes are unchanged
// for them; payouts.manage and refunds.approve are NOT manager defaults,
// so payout management and refund approval need an explicit grant.
async function canWriteBusinessFinance(userId, bizId, code = FINANCE_WRITE_CODE) {
  const row = await resolveBusinessAccess(userId, bizId);
  if (!row) return null;
  if (isOwner(row, userId)) return { ...businessFields(row), owner_id: row.owner_id };
  if (!row.effective_role) return null;
  const { permissions } = await permissionsService.getEffectivePermissions({
    businessId: row.id, userId, role: row.effective_role, membershipId: row.membership_id,
  });
  return permissionsService.hasAny(permissions, [code])
    ? { ...businessFields(row), owner_id: row.owner_id } : null;
}
async function canAccessBusiness(userId, bizId, roles = ['owner','manager']) {
  if (!userId || bizId == null) return false;
  const allowed = Array.isArray(roles) && roles.length ? roles : ['owner','manager'];
  // Keep the documented historical any-active-member team behavior.
  return !!(await (allowed.some(role => !['owner','manager'].includes(role))
    ? canAccessBusinessTeam(userId, bizId) : canEditProfile(userId, bizId)));
}
module.exports = { ownedBusiness, canEditProfile, canAccessBusiness, canAccessBusinessTeam, canManageBusinessFinance, canReadBusinessFinance, canWriteBusinessFinance, FINANCE_READ_CODES, FINANCE_WRITE_CODE };
