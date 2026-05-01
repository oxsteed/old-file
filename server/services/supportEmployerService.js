/**
 * Support employers — distinct orgs that employ support agents (business, helper-as-org, platform).
 * Conversations/queue remain keyed by businesses.id (customer-facing context); employment is per employer_id.
 */

const { query } = require('../db');
const logger = require('../utils/logger');

/** @typedef {'business'|'helper'|'platform'} EmployerKind */

const BUSINESS_ACCESS_SQL = `
  SELECT b.id FROM businesses b
  WHERE b.id = $1::uuid
    AND (
      b.user_id = $2::uuid
      OR b.owner_id = $2::uuid
      OR (b.admin_user_ids IS NOT NULL AND b.admin_user_ids @> $3::jsonb)
    )
  LIMIT 1
`;

/**
 * True if user may manage hiring/settings for this business (OxSteed business row).
 * Uses owner_id / admin_user_ids when present (support stack convention), else falls back to user_id.
 */
async function userCanManageBusiness(businessId, userId) {
  const { rows } = await query(BUSINESS_ACCESS_SQL, [
    businessId,
    userId,
    JSON.stringify([userId]),
  ]);
  return rows.length > 0;
}

async function userCanManageEmployer(employerId, userId, userRole) {
  const { rows } = await query(
    `SELECT id, kind, business_id, helper_user_id FROM support_employers WHERE id = $1`,
    [employerId]
  );
  if (!rows.length) return false;
  const e = rows[0];
  if (e.kind === 'platform') {
    return userRole === 'super_admin' || userRole === 'admin';
  }
  if (e.kind === 'helper') {
    return e.helper_user_id === userId;
  }
  if (e.kind === 'business' && e.business_id) {
    return userCanManageBusiness(e.business_id, userId);
  }
  return false;
}

/** @returns {Promise<{id: string, kind: EmployerKind, business_id: string|null, helper_user_id: string|null, display_name: string|null}|null>} */
async function getEmployerById(employerId) {
  const { rows } = await query(
    `SELECT id, kind, business_id, helper_user_id, display_name FROM support_employers WHERE id = $1`,
    [employerId]
  );
  return rows[0] || null;
}

/** Business-scoped employer (one row per business). */
async function ensureBusinessEmployer(businessId) {
  const existing = await query(
    `SELECT id FROM support_employers WHERE kind = 'business' AND business_id = $1`,
    [businessId]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const ins = await query(
    `INSERT INTO support_employers (kind, business_id)
     VALUES ('business', $1)
     RETURNING id`,
    [businessId]
  );
  return ins.rows[0].id;
}

/** Helper's personal support org (one per helper user). */
async function ensureHelperEmployer(helperUserId, displayName) {
  const existing = await query(
    `SELECT id FROM support_employers WHERE kind = 'helper' AND helper_user_id = $1`,
    [helperUserId]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const ins = await query(
    `INSERT INTO support_employers (kind, helper_user_id, display_name)
     VALUES ('helper', $1, COALESCE($2, 'Helper support'))
     RETURNING id`,
    [helperUserId, displayName || null]
  );
  return ins.rows[0].id;
}

async function getPlatformEmployerId() {
  const { rows } = await query(
    `SELECT id FROM support_employers WHERE kind = 'platform' ORDER BY created_at ASC LIMIT 1`
  );
  if (!rows.length) {
    const ins = await query(
      `INSERT INTO support_employers (kind, display_name) VALUES ('platform', 'OxSteed Platform') RETURNING id`
    );
    return ins.rows[0].id;
  }
  return rows[0].id;
}

/**
 * Resolve employer from API body (onboarding / admin).
 * @param {{ employer_id?: string, employer_kind?: string, business_id?: string, helper_user_id?: string }} body
 */
async function resolveEmployerIdFromBody(body, actingUserId, actingUserRole) {
  if (body.employer_id) {
    const ok = await userCanManageEmployer(body.employer_id, actingUserId, actingUserRole);
    if (!ok) {
      const err = new Error('FORBIDDEN_EMPLOYER');
      err.code = 'FORBIDDEN_EMPLOYER';
      throw err;
    }
    return body.employer_id;
  }

  const kind = (body.employer_kind || 'business').toLowerCase();

  if (kind === 'platform') {
    if (actingUserRole !== 'super_admin' && actingUserRole !== 'admin') {
      const err = new Error('FORBIDDEN_PLATFORM');
      err.code = 'FORBIDDEN_PLATFORM';
      throw err;
    }
    return getPlatformEmployerId();
  }

  if (kind === 'helper') {
    const hid = body.helper_user_id || actingUserId;
    if (hid !== actingUserId && actingUserRole !== 'super_admin' && actingUserRole !== 'admin') {
      const err = new Error('FORBIDDEN_HELPER_EMPLOYER');
      err.code = 'FORBIDDEN_HELPER_EMPLOYER';
      throw err;
    }
    return ensureHelperEmployer(hid, body.display_name);
  }

  const bid = body.business_id;
  if (!bid) {
    const err = new Error('BUSINESS_ID_REQUIRED');
    err.code = 'BUSINESS_ID_REQUIRED';
    throw err;
  }
  const can = await userCanManageBusiness(bid, actingUserId);
  if (!can) {
    const err = new Error('FORBIDDEN_BUSINESS');
    err.code = 'FORBIDDEN_BUSINESS';
    throw err;
  }
  return ensureBusinessEmployer(bid);
}

/** Employers the user may act as hiring manager for (for UI pickers). */
async function listEmployersForUser(userId, userRole) {
  const out = [];

  if (userRole === 'super_admin' || userRole === 'admin') {
    const plat = await query(
      `SELECT id, kind, business_id, helper_user_id, display_name FROM support_employers WHERE kind = 'platform' LIMIT 1`
    );
    if (plat.rows.length) out.push(plat.rows[0]);
  }

  const biz = await query(
    `SELECT e.id, e.kind, e.business_id, e.helper_user_id, e.display_name
     FROM support_employers e
     JOIN businesses b ON b.id = e.business_id
     WHERE e.kind = 'business'
       AND (
         b.user_id = $1::uuid
         OR b.owner_id = $1::uuid
         OR (b.admin_user_ids IS NOT NULL AND b.admin_user_ids @> $2::jsonb)
       )`,
    [userId, JSON.stringify([userId])]
  );
  out.push(...biz.rows);

  const hel = await query(
    `SELECT id, kind, business_id, helper_user_id, display_name
     FROM support_employers
     WHERE kind = 'helper' AND helper_user_id = $1`,
    [userId]
  );
  out.push(...hel.rows);

  return out;
}

/**
 * For a conversation's business_id, list employer ids that may staff it (business employer + platform).
 */
async function employerIdsForConversationBusiness(businessId) {
  const ids = [];
  const eid = await ensureBusinessEmployer(businessId);
  ids.push(eid);
  ids.push(await getPlatformEmployerId());
  return ids;
}

module.exports = {
  userCanManageBusiness,
  userCanManageEmployer,
  getEmployerById,
  ensureBusinessEmployer,
  ensureHelperEmployer,
  getPlatformEmployerId,
  resolveEmployerIdFromBody,
  listEmployersForUser,
  employerIdsForConversationBusiness,
  BUSINESS_ACCESS_SQL,
};
