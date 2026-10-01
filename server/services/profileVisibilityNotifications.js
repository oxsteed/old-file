// server/services/profileVisibilityNotifications.js
// Workstream B: owner notifications for admin profile-visibility changes.
//
// Creates a profile_visibility_owner_notifications row (idempotent via
// delivery_key) and dispatches through notificationService.sendNotification
// with type 'profile_visibility_changed'. There is no registration point
// for this type in utils/i18n, so we pass English title/body with the
// profile name interpolated; the notification service falls back to the
// provided strings.
//
// This service never throws to its caller: every failure is recorded on
// the notification row (status='failed', attempts, last_error) for the
// retry job (server/jobs/profileVisibilityNotificationRetry.js).

'use strict';

const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');
const notificationService = require('./notificationService');

const PROFILE_TYPES = ['helper', 'business', 'restaurant'];

function notifError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// Resolve the owning user_id for a profile, plus a display name for the
// message body. Returns { ownerUserId, displayName } or null when the
// profile row is missing.
async function resolveOwner(profileType, profileId) {
  const id = String(profileId);
  if (profileType === 'helper') {
    const { rows } = await db.query(
      `SELECT hp.user_id AS owner_id,
              COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS display_name
         FROM helper_profiles hp
         JOIN users u ON u.id = hp.user_id
        WHERE hp.user_id::text = $1
        LIMIT 1`,
      [id]
    );
    return rows[0] ? { ownerUserId: rows[0].owner_id, displayName: rows[0].display_name } : null;
  }
  if (profileType === 'business') {
    const { rows } = await db.query(
      `SELECT user_id AS owner_id, business_name AS display_name
         FROM businesses
        WHERE id::text = $1
        LIMIT 1`,
      [id]
    );
    return rows[0] ? { ownerUserId: rows[0].owner_id, displayName: rows[0].display_name } : null;
  }
  if (profileType === 'restaurant') {
    const { rows } = await db.query(
      `SELECT fr.owner_user_id AS owner_id,
              COALESCE(fr.display_name, b.business_name) AS display_name
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
        WHERE fr.id::text = $1
        LIMIT 1`,
      [id]
    );
    return rows[0] ? { ownerUserId: rows[0].owner_id, displayName: rows[0].display_name } : null;
  }
  return null;
}

function buildCopy(profileType, isVisible, displayName) {
  const label = displayName || 'your profile';
  if (isVisible) {
    return {
      title: 'Your profile is visible again',
      body: `OxSteed has restored public visibility for ${label}. No action is needed.`,
    };
  }
  return {
    title: 'Your profile was hidden by OxSteed',
    body: `OxSteed has hidden ${label} from public listings. If you have questions, contact support.`,
  };
}

/**
 * Notify the owner of a visibility change.
 *
 * Idempotent: the delivery row is created with ON CONFLICT (delivery_key)
 * DO NOTHING; if the key was already seen we report delivered=true with
 * the existing row (the change was already notified).
 *
 * Never throws to the caller; failures are recorded on the row and picked
 * up by the retry job.
 */
async function notifyOwnerOfVisibilityChange({ profileType, profileId, isVisible, actorId, idempotencyKey }) {
  const type = String(profileType || '').toLowerCase();
  if (!PROFILE_TYPES.includes(type)) {
    throw notifError(400, 'invalid_profile_type', 'profile_type must be helper, business, or restaurant.');
  }
  if (typeof isVisible !== 'boolean') {
    throw notifError(400, 'invalid_is_visible', 'is_visible must be a boolean.');
  }
  const action = isVisible ? 'restored' : 'hidden';
  const deliveryKey = (idempotencyKey && String(idempotencyKey).trim())
    ? String(idempotencyKey).trim().slice(0, 255)
    : `pv-${type}-${String(profileId)}-${action}-${crypto.randomUUID()}`.slice(0, 255);

  let owner;
  try {
    owner = await resolveOwner(type, profileId);
  } catch (err) {
    logger.error('profileVisibilityNotifications: owner lookup failed', { err, profileType: type, profileId });
    return { delivered: false, reason: 'owner_lookup_failed' };
  }
  if (!owner || !owner.ownerUserId) {
    return { delivered: false, reason: 'owner_not_found' };
  }

  // Idempotent delivery-row creation.
  const { rows: inserted } = await db.query(
    `INSERT INTO profile_visibility_owner_notifications
       (profile_type, profile_id, action, recipient_user_id, delivery_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (delivery_key) DO NOTHING
     RETURNING *`,
    [type, String(profileId), action, owner.ownerUserId, deliveryKey]
  );
  let row = inserted[0];
  if (!row) {
    const existing = await db.query(
      'SELECT * FROM profile_visibility_owner_notifications WHERE delivery_key = $1 LIMIT 1',
      [deliveryKey]
    );
    row = existing.rows[0];
    if (!row) return { delivered: false, reason: 'row_unresolvable' };
    return { delivered: true, duplicate: true, notification: row };
  }

  const copy = buildCopy(type, isVisible, owner.displayName);
  const mark = async (status, lastError) => {
    const { rows } = await db.query(
      `UPDATE profile_visibility_owner_notifications
          SET status = $2, attempts = attempts + 1,
              last_error = $3,
              sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
        WHERE id = $1
        RETURNING *`,
      [row.id, status, lastError ? String(lastError).slice(0, 2000) : null]
    );
    return rows[0] || null;
  };

  try {
    const result = await notificationService.sendNotification({
      userId: owner.ownerUserId,
      type: 'profile_visibility_changed',
      title: copy.title,
      body: copy.body,
      data: {
        profile_type: type,
        profile_id: String(profileId),
        is_visible: isVisible,
        actor_id: actorId || null,
      },
      idempotencyKey: deliveryKey,
    });
    if (result && result.success) {
      const updated = await mark('sent', null);
      return { delivered: true, notification: updated || row };
    }
    const updated = await mark('failed', (result && (result.error || result.reason)) || 'send_failed');
    return { delivered: false, notification: updated || row, reason: 'send_failed' };
  } catch (err) {
    logger.error('profileVisibilityNotifications: send failed', { err, deliveryKey });
    const updated = await mark('failed', err.message).catch(() => null);
    return { delivered: false, notification: updated || row, reason: err.message };
  }
}

module.exports = {
  notifyOwnerOfVisibilityChange,
  resolveOwner,
};
