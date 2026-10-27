'use strict';

// Consent ledger for the career profile (careers spec §6.3, §9.3, Q5, Q14).
// Every change in who may see the profile is an append-only event; the
// current state is a projection the app reads.

const crypto = require('crypto');
const pool = require('../../db');
const { AppError } = require('../../middleware/errorHandler');
const { VISIBILITY_LEVELS, FACT_TYPES } = require('../careerCatalog');

const POLICY_VERSION = 'careers-share-2026-10';

function hash(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function requestMeta(req) {
  const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null;
  const ua = req?.headers?.['user-agent'] || null;
  return { ipHash: hash(ip ? String(ip).split(',')[0].trim() : null), uaHash: hash(ua) };
}

async function ensureProfile(db, userId) {
  await db.query('INSERT INTO career_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  await db.query('INSERT INTO career_profile_share_current (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
}

async function recordEvent(db, { userId, action, audience = {}, factTypes = [], req = null }) {
  const { ipHash, uaHash } = requestMeta(req);
  const { rows: [event] } = await db.query(
    `INSERT INTO career_profile_share_events (user_id, action, audience, fact_types, policy_version, ip_hash, user_agent_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [userId, action, JSON.stringify(audience), factTypes, POLICY_VERSION, ipHash, uaHash]
  );
  await db.query('UPDATE career_profile_share_current SET last_event_id = $2, updated_at = NOW() WHERE user_id = $1', [userId, event.id]);
  return event;
}

async function setVisibility(db, userId, visibility, { req } = {}) {
  if (!VISIBILITY_LEVELS.includes(visibility)) {
    throw new AppError('Unsupported visibility', 400, 'validation_failed', { visibility: 'Choose a visibility level' });
  }
  await ensureProfile(db, userId);
  await db.query('UPDATE career_profiles SET visibility = $2, updated_at = NOW() WHERE user_id = $1', [userId, visibility]);
  await db.query('UPDATE career_profile_share_current SET visibility = $2 WHERE user_id = $1', [userId, visibility]);
  return recordEvent(db, { userId, action: visibility === 'private' ? 'revoke' : 'set_visibility', audience: { visibility }, req });
}

async function setCareerOffersOptIn(db, userId, optIn, { req } = {}) {
  await ensureProfile(db, userId);
  await db.query('UPDATE career_profiles SET career_offers_opt_in = $2, updated_at = NOW() WHERE user_id = $1', [userId, Boolean(optIn)]);
  await db.query('UPDATE career_profile_share_current SET career_offers_opt_in = $2 WHERE user_id = $1', [userId, Boolean(optIn)]);
  return recordEvent(db, { userId, action: optIn ? 'career_offers_opt_in' : 'career_offers_opt_out', req });
}

async function hideFacts(db, userId, factTypes, { req } = {}) {
  const clean = [...new Set((factTypes || []).filter((f) => FACT_TYPES.includes(f)))];
  await ensureProfile(db, userId);
  await db.query('UPDATE career_profiles SET hidden_fact_types = $2, updated_at = NOW() WHERE user_id = $1', [userId, clean]);
  await db.query('UPDATE career_profile_share_current SET hidden_fact_types = $2 WHERE user_id = $1', [userId, clean]);
  return recordEvent(db, { userId, action: 'hide_facts', factTypes: clean, req });
}

async function shareWithApplication(db, userId, { applicationId, businessId, openingId, factTypes, req }) {
  await ensureProfile(db, userId);
  return recordEvent(db, {
    userId,
    action: 'share_with_application',
    audience: { application_id: applicationId, business_id: businessId, opening_id: openingId },
    factTypes,
    req,
  });
}

async function muteBusiness(db, userId, businessId, { req } = {}) {
  await ensureProfile(db, userId);
  await db.query('INSERT INTO career_profile_mutes (user_id, business_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, businessId]);
  // A mute also expires that business's open invitations.
  await db.query(
    `UPDATE career_invitations SET status = 'declined', responded_at = NOW()
      WHERE user_id = $1 AND business_id = $2 AND status IN ('sent','viewed')`,
    [userId, businessId]
  );
  return recordEvent(db, { userId, action: 'mute_business', audience: { business_id: businessId }, req });
}

async function unmuteBusiness(db, userId, businessId, { req } = {}) {
  await db.query('DELETE FROM career_profile_mutes WHERE user_id = $1 AND business_id = $2', [userId, businessId]);
  return recordEvent(db, { userId, action: 'unmute', audience: { business_id: businessId }, req });
}

async function logAccess(db, { viewerUserId, businessId, subjectUserId, context, applicationId = null, factTypes = [] }) {
  const runner = db || pool;
  await runner.query(
    `INSERT INTO career_profile_access_log (viewer_user_id, business_id, subject_user_id, context, application_id, fact_types)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [viewerUserId || null, businessId || null, subjectUserId, context, applicationId, factTypes]
  );
}

module.exports = {
  POLICY_VERSION,
  hash,
  requestMeta,
  ensureProfile,
  recordEvent,
  setVisibility,
  setCareerOffersOptIn,
  hideFacts,
  shareWithApplication,
  muteBusiness,
  unmuteBusiness,
  logAccess,
};
