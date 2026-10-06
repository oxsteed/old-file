'use strict';

// Admin self-service settings: the logged-in admin's own profile,
// sessions, notification preferences, and API keys.

const db = require('../db');
const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// ── Profile ────────────────────────────────────────────────────────────────

async function getMyProfile(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT id, first_name, last_name, email, phone, avatar_url, role,
              preferred_language, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]) throw new AppError('User not found', 404, 'not_found');
    res.json(rows[0]);
  } catch (err) { next(err); }
}

async function updateMyProfile(req, res, next) {
  try {
    const { first_name, last_name, phone, preferred_language } = req.body;
    const { rows } = await db.query(
      `UPDATE users SET
         first_name = COALESCE($2, first_name),
         last_name = COALESCE($3, last_name),
         phone = COALESCE($4, phone),
         preferred_language = COALESCE($5, preferred_language),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, email, phone, preferred_language`,
      [req.user.id, first_name || null, last_name || null, phone || null, preferred_language || null]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
}

// ── Sessions ───────────────────────────────────────────────────────────────

async function listMySessions(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT id, created_at, expires_at, last_used_at, ip_address, user_agent,
              (id = $2) AS is_current
       FROM sessions
       WHERE user_id = $1 AND is_valid = true AND is_revoked = false
       ORDER BY last_used_at DESC NULLS LAST`,
      [req.user.id, req.sessionId || null]
    );
    res.json({ sessions: rows });
  } catch (err) { next(err); }
}

async function revokeMySession(req, res, next) {
  try {
    const { sessionId } = req.params;
    if (sessionId === req.sessionId) {
      throw new AppError('Cannot revoke your current session', 400, 'cannot_revoke_current');
    }
    const { rowCount } = await db.query(
      `UPDATE sessions SET is_valid = false, is_revoked = true
       WHERE id = $1 AND user_id = $2`,
      [sessionId, req.user.id]
    );
    if (!rowCount) throw new AppError('Session not found', 404, 'not_found');
    res.json({ revoked: true });
  } catch (err) { next(err); }
}

// ── Notification preferences ─────────────────────────────────────────────

async function getMyNotificationPrefs(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT notify_payout_failures, notify_incidents, notify_new_admins,
              notify_disputes, email_notifications, sms_notifications
       FROM admin_notification_prefs WHERE admin_id = $1`,
      [req.user.id]
    );
    res.json(rows[0] || {
      notify_payout_failures: true,
      notify_incidents: true,
      notify_new_admins: false,
      notify_disputes: true,
      email_notifications: true,
      sms_notifications: false,
    });
  } catch (err) { next(err); }
}

async function updateMyNotificationPrefs(req, res, next) {
  try {
    const {
      notify_payout_failures, notify_incidents, notify_new_admins,
      notify_disputes, email_notifications, sms_notifications,
    } = req.body;
    const { rows } = await db.query(
      `INSERT INTO admin_notification_prefs
         (admin_id, notify_payout_failures, notify_incidents, notify_new_admins,
          notify_disputes, email_notifications, sms_notifications, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (admin_id) DO UPDATE SET
         notify_payout_failures = EXCLUDED.notify_payout_failures,
         notify_incidents = EXCLUDED.notify_incidents,
         notify_new_admins = EXCLUDED.notify_new_admins,
         notify_disputes = EXCLUDED.notify_disputes,
         email_notifications = EXCLUDED.email_notifications,
         sms_notifications = EXCLUDED.sms_notifications,
         updated_at = NOW()
       RETURNING *`,
      [
        req.user.id,
        notify_payout_failures !== false,
        notify_incidents !== false,
        notify_new_admins === true,
        notify_disputes !== false,
        email_notifications !== false,
        sms_notifications === true,
      ]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
}

// ── API keys ───────────────────────────────────────────────────────────────

async function listMyApiKeys(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT id, name, prefix, created_at, last_used_at, expires_at, revoked_at
       FROM admin_api_keys WHERE admin_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ keys: rows });
  } catch (err) { next(err); }
}

async function createMyApiKey(req, res, next) {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      throw new AppError('Key name is required', 400, 'name_required');
    }
    const rawKey = `oxsk_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.slice(0, 12);
    const { rows } = await db.query(
      `INSERT INTO admin_api_keys (admin_id, name, key_hash, prefix, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING id, name, prefix, created_at`,
      [req.user.id, String(name).trim().slice(0, 100), keyHash, prefix]
    );
    // Return the raw key once; it is never stored in plaintext.
    res.status(201).json({ ...rows[0], key: rawKey });
  } catch (err) { next(err); }
}

async function revokeMyApiKey(req, res, next) {
  try {
    const { keyId } = req.params;
    const { rowCount } = await db.query(
      `UPDATE admin_api_keys SET revoked_at = NOW()
       WHERE id = $1 AND admin_id = $2 AND revoked_at IS NULL`,
      [keyId, req.user.id]
    );
    if (!rowCount) throw new AppError('Key not found', 404, 'not_found');
    res.json({ revoked: true });
  } catch (err) { next(err); }
}

// ── Tab preferences ────────────────────────────────────────────────────────

async function getMyTabPrefs(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT tab_key, is_essential FROM admin_tab_prefs WHERE admin_id = $1`,
      [req.user.id]
    );
    const prefs = {};
    for (const r of rows) prefs[r.tab_key] = r.is_essential;
    res.json({ prefs });
  } catch (err) { next(err); }
}

async function updateMyTabPrefs(req, res, next) {
  try {
    const { prefs } = req.body;
    if (!prefs || typeof prefs !== 'object') {
      throw new AppError('prefs object is required', 400, 'prefs_required');
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const [tabKey, isEssential] of Object.entries(prefs)) {
        if (typeof tabKey !== 'string' || tabKey.length > 100) continue;
        await client.query(
          `INSERT INTO admin_tab_prefs (admin_id, tab_key, is_essential, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (admin_id, tab_key) DO UPDATE SET
             is_essential = EXCLUDED.is_essential, updated_at = NOW()`,
          [req.user.id, tabKey, isEssential === true]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ saved: true });
  } catch (err) { next(err); }
}

module.exports = {
  getMyProfile,
  updateMyProfile,
  listMySessions,
  revokeMySession,
  getMyNotificationPrefs,
  updateMyNotificationPrefs,
  listMyApiKeys,
  createMyApiKey,
  revokeMyApiKey,
  getMyTabPrefs,
  updateMyTabPrefs,
};
