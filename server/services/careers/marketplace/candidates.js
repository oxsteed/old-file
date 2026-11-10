'use strict';

// New-matching-candidate alerts and talent shortlists
// (docs/careers/marketplace.md §13). Both sit on top of the existing
// talent-search consent model: only workers whose profile visibility is
// "searchable" (or who already worked with the business, for shortlists)
// are ever counted or listed; mutes, bans and search locks apply.
// Alert notices carry a COUNT and the alert name only — never names,
// distances or facts — and link back to the logged talent search.

const { AppError } = require('../../../middleware/errorHandler');
const { codeList } = require('../validation');
const { locationsInScope } = require('../access');
const { businessPoint, isKnownTo } = require('../talent');
const { logAccess } = require('../shareLedger');
const plans = require('./plans');
const { deliver } = require('./delivery');
const { cleanUserText, requireId, notFound } = require('./common');

const MAX_RADIUS_KM = 100;

async function parseAlert(db, access, body) {
  const name = cleanUserText(body.name, 80).text;
  if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name this alert' });
  const c = body.criteria && typeof body.criteria === 'object' ? body.criteria : {};
  const radius = c.radius_km == null ? 25 : Number(c.radius_km);
  if (!Number.isFinite(radius) || radius < 1 || radius > MAX_RADIUS_KM) throw new AppError('Validation failed', 400, 'validation_failed', { 'criteria.radius_km': `Between 1 and ${MAX_RADIUS_KM} km` });
  const near = c.near_location === 'business' ? 'business' : Number(c.near_location);
  if (near !== 'business') {
    if (!Number.isInteger(near) || near <= 0) throw new AppError('Validation failed', 400, 'validation_failed', { 'criteria.near_location': 'Pick a store or your business location' });
    const { rows: [store] } = await db.query(
      `SELECT l.id FROM restaurant_locations l JOIN food_restaurants fr ON fr.id = l.restaurant_id WHERE l.id = $1 AND fr.business_id = $2`,
      [near, access.businessId]
    );
    if (!store || !locationsInScope(access, [near])) throw notFound('Store not found');
  }
  let openingId = null;
  if (body.opening_id != null && body.opening_id !== '') {
    openingId = requireId(body.opening_id, 'Opening not found');
    const { rows: [o] } = await db.query('SELECT id FROM career_openings WHERE id = $1 AND business_id = $2', [openingId, access.businessId]);
    if (!o) throw notFound('Opening not found');
  }
  return {
    name,
    openingId,
    criteria: { near_location: near, radius_km: radius, skills: codeList(c.skills, 10), available_now: Boolean(c.available_now) },
  };
}

async function listAlerts(db, businessId) {
  const { rows } = await db.query(
    `SELECT a.id, a.name, a.opening_id, a.criteria, a.paused, a.last_run_at, a.created_at,
            (SELECT COUNT(*)::int FROM career_candidate_alert_hits h WHERE h.alert_id = a.id) AS matched
       FROM career_candidate_alerts a WHERE a.business_id = $1 ORDER BY a.created_at DESC`,
    [businessId]
  );
  return rows;
}

async function createAlert(db, { access, actor, body }) {
  const v = await parseAlert(db, access, body);
  const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM career_candidate_alerts WHERE business_id = $1', [access.businessId]);
  await plans.assertWithin(db, access.businessId, 'candidate_alerts', n);
  const { rows: [row] } = await db.query(
    `INSERT INTO career_candidate_alerts (business_id, opening_id, created_by, name, criteria) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [access.businessId, v.openingId, actor.id, v.name, JSON.stringify(v.criteria)]
  );
  return row;
}

async function updateAlert(db, { access, alertId, body }) {
  const id = requireId(alertId, 'Alert not found');
  const { rows: [existing] } = await db.query('SELECT * FROM career_candidate_alerts WHERE id = $1 AND business_id = $2', [id, access.businessId]);
  if (!existing) throw notFound('Alert not found');
  const v = body.criteria || body.name ? await parseAlert(db, access, { name: existing.name, criteria: existing.criteria, opening_id: existing.opening_id, ...body }) : null;
  const { rows: [row] } = await db.query(
    `UPDATE career_candidate_alerts SET name = COALESCE($3, name), criteria = COALESCE($4, criteria), paused = COALESCE($5, paused)
      WHERE id = $1 AND business_id = $2 RETURNING *`,
    [id, access.businessId, v?.name || null, v ? JSON.stringify(v.criteria) : null, typeof body.paused === 'boolean' ? body.paused : null]
  );
  return row;
}

async function deleteAlert(db, { access, alertId }) {
  const { rowCount } = await db.query('DELETE FROM career_candidate_alerts WHERE id = $1 AND business_id = $2', [requireId(alertId, 'Alert not found'), access.businessId]);
  if (!rowCount) throw notFound('Alert not found');
  return { deleted: true };
}

async function pointFor(db, alert) {
  const near = alert.criteria?.near_location;
  if (near === 'business') return businessPoint(db, alert.business_id);
  const { rows: [l] } = await db.query('SELECT latitude, longitude FROM restaurant_locations WHERE id = $1', [near]);
  return l && l.latitude != null ? { latitude: Number(l.latitude), longitude: Number(l.longitude) } : null;
}

/** Hourly job: count new searchable matches per alert and notify the creator. */
async function runCandidateAlerts(db, { limit = 200 } = {}) {
  const { rows: alerts } = await db.query(
    `SELECT a.* FROM career_candidate_alerts a JOIN businesses b ON b.id = a.business_id
      WHERE NOT a.paused AND b.is_business_verified = TRUE AND b.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM career_talent_search_locks k WHERE k.business_id = a.business_id AND k.released_at IS NULL)
        AND a.last_run_at < NOW() - INTERVAL '55 minutes'
      ORDER BY a.last_run_at LIMIT $1`,
    [limit]
  );
  let notified = 0;
  for (const alert of alerts) {
    const point = await pointFor(db, alert);
    const startedAt = new Date();
    if (point) {
      const c = alert.criteria || {};
      const { rows: hits } = await db.query(
        `INSERT INTO career_candidate_alert_hits (alert_id, user_id)
         SELECT $1, p.user_id
           FROM career_profiles p
           JOIN career_profile_share_current sc ON sc.user_id = p.user_id AND sc.visibility = 'searchable'
           JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL AND COALESCE(u.is_banned, FALSE) = FALSE
           JOIN geo_postal_centroids gc ON gc.id = p.postal_centroid_id
          WHERE ST_DWithin(gc.geog, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
            AND NOT EXISTS (SELECT 1 FROM career_profile_mutes m WHERE m.user_id = p.user_id AND m.business_id = $2)
            AND NOT EXISTS (SELECT 1 FROM business_members bm WHERE bm.business_id = $2 AND bm.member_id = p.user_id AND bm.status = 'active')
            AND (cardinality($6::text[]) = 0 OR p.skill_codes && $6::text[] OR p.desired_roles && $6::text[])
            AND (NOT $7::boolean OR p.available_now_until > NOW())
         ON CONFLICT DO NOTHING
         RETURNING user_id`,
        [alert.id, alert.business_id, point.longitude, point.latitude, Number(c.radius_km || 25) * 1000, c.skills || [], Boolean(c.available_now)]
      );
      if (hits.length && alert.created_by) {
        const r = await deliver(db, {
          userId: alert.created_by,
          type: 'career_candidate_alert',
          params: { count: hits.length, alertName: alert.name },
          actionUrl: `/business/${alert.business_id}/careers?tab=talent&alert=${alert.id}`,
          deliveryKey: `career_cand_alert:${alert.id}:${startedAt.toISOString().slice(0, 13)}`,
          channels: ['in_app', 'email', 'push'],
        });
        if (r.inserted) notified += 1;
      }
    }
    await db.query('UPDATE career_candidate_alerts SET last_run_at = $2 WHERE id = $1', [alert.id, startedAt]);
  }
  return { alerts: alerts.length, notified };
}

// ── Shortlists ──────────────────────────────────────────────────────────────

async function listShortlists(db, businessId) {
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.created_at, (SELECT COUNT(*)::int FROM career_talent_shortlist_members m WHERE m.shortlist_id = s.id) AS members
       FROM career_talent_shortlists s WHERE s.business_id = $1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC`,
    [businessId]
  );
  return rows;
}

async function createShortlist(db, { access, actor, body }) {
  const name = cleanUserText(body.name, 80).text;
  if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name this list' });
  const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM career_talent_shortlists WHERE business_id = $1 AND deleted_at IS NULL', [access.businessId]);
  await plans.assertWithin(db, access.businessId, 'shortlists', n);
  const { rows: [row] } = await db.query(
    'INSERT INTO career_talent_shortlists (business_id, name, created_by) VALUES ($1, $2, $3) RETURNING id, name, created_at',
    [access.businessId, name, actor.id]
  );
  return row;
}

async function deleteShortlist(db, { access, shortlistId }) {
  const { rowCount } = await db.query(
    'UPDATE career_talent_shortlists SET deleted_at = NOW() WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
    [requireId(shortlistId, 'List not found'), access.businessId]
  );
  if (!rowCount) throw notFound('List not found');
  await db.query('DELETE FROM career_talent_shortlist_members WHERE shortlist_id = $1', [shortlistId]);
  return { deleted: true };
}

async function ownShortlist(db, access, shortlistId) {
  const { rows: [s] } = await db.query(
    'SELECT id FROM career_talent_shortlists WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
    [requireId(shortlistId, 'List not found'), access.businessId]
  );
  if (!s) throw notFound('List not found');
  return s;
}

async function visibleTo(db, businessId, userId) {
  const { rows: [muted] } = await db.query('SELECT 1 FROM career_profile_mutes WHERE user_id = $1 AND business_id = $2', [userId, businessId]);
  if (muted) return false;
  const { rows: [sc] } = await db.query('SELECT visibility FROM career_profile_share_current WHERE user_id = $1', [userId]);
  if (sc?.visibility === 'searchable') return true;
  return Boolean(await isKnownTo(db, businessId, userId));
}

async function addMember(db, { access, actor, shortlistId, body }) {
  const s = await ownShortlist(db, access, shortlistId);
  const userId = String(body.user_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new AppError('Validation failed', 400, 'validation_failed', { user_id: 'Pick a person' });
  if (!(await visibleTo(db, access.businessId, userId))) throw notFound('Person not found');
  await db.query(
    `INSERT INTO career_talent_shortlist_members (shortlist_id, user_id, added_by, note) VALUES ($1, $2, $3, $4)
     ON CONFLICT (shortlist_id, user_id) DO UPDATE SET note = EXCLUDED.note`,
    [s.id, userId, actor.id, cleanUserText(body.note, 500).text || null]
  );
  return { added: true };
}

async function removeMember(db, { access, shortlistId, userId }) {
  const s = await ownShortlist(db, access, shortlistId);
  await db.query('DELETE FROM career_talent_shortlist_members WHERE shortlist_id = $1 AND user_id = $2', [s.id, String(userId)]);
  return { removed: true };
}

/** Members, re-checked for consent at read time; access is logged. */
async function listMembers(db, { access, viewer, shortlistId }) {
  const s = await ownShortlist(db, access, shortlistId);
  const { rows } = await db.query(
    `SELECT m.user_id, m.note, m.added_at, u.first_name, u.last_name, p.headline, p.skill_codes, p.available_now_until, p.show_online_status
       FROM career_talent_shortlist_members m
       JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
       LEFT JOIN career_profiles p ON p.user_id = m.user_id
      WHERE m.shortlist_id = $1 ORDER BY m.added_at DESC`,
    [s.id]
  );
  const out = [];
  for (const r of rows) {
    if (!(await visibleTo(db, access.businessId, r.user_id))) {
      out.push({ user_id: r.user_id, hidden: true, added_at: r.added_at });
      continue;
    }
    await logAccess(db, { viewerUserId: viewer.id, businessId: access.businessId, subjectUserId: r.user_id, context: 'talent_pool', factTypes: [] });
    out.push({
      user_id: r.user_id,
      display_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      headline: r.headline,
      skill_codes: r.skill_codes || [],
      available_now: Boolean(r.show_online_status && r.available_now_until && new Date(r.available_now_until) > new Date()),
      note: r.note,
      added_at: r.added_at,
    });
  }
  return out;
}

module.exports = {
  listAlerts,
  createAlert,
  updateAlert,
  deleteAlert,
  runCandidateAlerts,
  listShortlists,
  createShortlist,
  deleteShortlist,
  addMember,
  removeMember,
  listMembers,
};
