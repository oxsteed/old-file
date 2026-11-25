'use strict';
// Shared helpers for the Groups 5-6 business owner / team member services.
// Route middleware (requireBusinessAccess + requirePermission) has already
// resolved the live business and membership; services re-check ownership
// inside transactions where a decision depends on it.
const AppError = require('../../utils/appError');
const logger = require('../../utils/logger');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, code, message) => { throw new AppError(message || code, status, code); };
const invalid = (field) => fail(400, 'validation_failed', field ? `Invalid ${field}` : 'Invalid input');
function text(value, max, { required = true, min = 1 } = {}) {
  if (value == null || value === '') { if (required) invalid(); return null; }
  if (typeof value !== 'string') invalid();
  const v = value.trim();
  if (v.length < min || v.length > max) invalid();
  return v;
}
function uuid(value, field) { if (!UUID.test(String(value || ''))) invalid(field); return String(value); }
function int(value, { min = 0, max = Number.MAX_SAFE_INTEGER, field } = {}) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) invalid(field);
  return n;
}
function isoDate(value, field) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid(field);
  return new Date(value).toISOString();
}
async function ownerOf(db, businessId) {
  const { rows: [b] } = await db.query('SELECT id, user_id FROM businesses WHERE id=$1 AND deleted_at IS NULL', [businessId]);
  if (!b) fail(404, 'not_found');
  return b;
}
async function activeMember(db, businessId, userId) {
  const b = await ownerOf(db, businessId);
  if (String(b.user_id) === String(userId)) return { owner: true, membership: null, business: b };
  const { rows: [m] } = await db.query(`SELECT id, role, job_role FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active'
    AND (access_valid_until IS NULL OR access_valid_until > NOW()) AND (expires_at IS NULL OR expires_at > NOW())`, [businessId, userId]);
  return m ? { owner: false, membership: m, business: b } : null;
}
// Best-effort, post-commit, idempotent notification. Types are registered in
// utils/notificationTypeCatalog.js and rendered from
// utils/businessTeamNotificationTemplates.js.
async function notify(userId, type, data, key, actionUrl) {
  if (!userId) return;
  try {
    const { sendNotification } = require('../notificationService');
    await sendNotification({ userId, type, data: data || {}, action_url: actionUrl || null, idempotencyKey: key });
  } catch (error) {
    logger.warn('Business team notification failed', { type, error: error.message });
  }
}
module.exports = { UUID, fail, invalid, text, uuid, int, isoDate, ownerOf, activeMember, notify };
