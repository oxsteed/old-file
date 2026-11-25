'use strict';
// Group 7 (items 301-350): property manager access. Owner/manager members of
// the business administer every property; other members (and only members)
// act on a property through an active property_staff_assignments row.
const { fail, invalid } = require('../businessOwner/common');

const ADMIN_ROLES = new Set(['owner', 'manager']);
const ACTIVE_ASSIGNMENT = `a.status='active' AND a.starts_at <= NOW() AND (a.ends_at IS NULL OR a.ends_at > NOW())`;
const isAdmin = role => ADMIN_ROLES.has(role);
const cents = (v, field, { required = false } = {}) => {
  if (v == null || v === '') { if (required) invalid(field); return null; }
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1e10) invalid(field);
  return n;
};
const day = (v, field, { required = false } = {}) => {
  if (v == null || v === '') { if (required) invalid(field); return null; }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v))) invalid(field);
  return v;
};
const oneOf = (v, set, field, dflt) => { if (v == null || v === '') { if (dflt !== undefined) return dflt; invalid(field); } if (!set.includes(v)) invalid(field); return v; };

async function property(db, businessId, propertyId, { lock = false } = {}) {
  const { rows: [p] } = await db.query(`SELECT * FROM properties WHERE id::text=$1 AND business_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [String(propertyId), businessId]);
  if (!p) fail(404, 'not_found');
  return p;
}
// Roles the user holds on the property, or 404 (never reveal existence).
async function propertyAccess(db, businessId, propertyId, user, role, { adminOnly = false } = {}) {
  const p = await property(db, businessId, propertyId);
  if (isAdmin(role)) return { property: p, admin: true, roles: ['admin'] };
  if (adminOnly) fail(404, 'not_found');
  const { rows } = await db.query(`SELECT a.role FROM property_staff_assignments a JOIN business_members m ON m.business_id=a.business_id AND m.member_id=a.user_id AND m.status='active' AND (m.access_valid_until IS NULL OR m.access_valid_until > NOW()) AND (m.expires_at IS NULL OR m.expires_at > NOW())
    WHERE a.property_id=$1 AND a.user_id=$2 AND ${ACTIVE_ASSIGNMENT}`, [p.id, user]);
  if (!rows.length) fail(404, 'not_found');
  return { property: p, admin: false, roles: rows.map(r => r.role) };
}
async function requestAccess(db, businessId, requestId, user, role, opts = {}) {
  const { rows: [r] } = await db.query(`SELECT * FROM property_maintenance_requests WHERE id::text=$1 AND business_id=$2 ${opts.lock ? 'FOR UPDATE' : ''}`, [String(requestId), businessId]);
  if (!r) fail(404, 'not_found');
  if (isAdmin(role)) return { request: r, admin: true };
  if (!r.property_id || opts.adminOnly) fail(404, 'not_found');
  await propertyAccess(db, businessId, r.property_id, user, role);
  return { request: r, admin: false };
}
// Active assignees on a property (people who should hear about it).
async function propertyPeople(db, propertyId, roles = ['manager', 'coverage', 'building_staff']) {
  const { rows } = await db.query(`SELECT DISTINCT a.user_id FROM property_staff_assignments a WHERE a.property_id=$1 AND a.user_id IS NOT NULL AND a.role = ANY($2) AND ${ACTIVE_ASSIGNMENT}`, [propertyId, roles]);
  return rows.map(r => r.user_id);
}
module.exports = { ADMIN_ROLES, ACTIVE_ASSIGNMENT, isAdmin, cents, day, oneOf, property, propertyAccess, requestAccess, propertyPeople };
