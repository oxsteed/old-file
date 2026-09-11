'use strict';

const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');

const MAX_LIST_LIMIT = 500;
const DEFAULT_NOTIFICATION_COOLDOWN_MINUTES = 15;

function incidentDedupeKey(type, severity, suppliedKey) {
  const key = String(suppliedKey || '').trim();
  if (key) return key.slice(0, 128);
  return crypto
    .createHash('sha256')
    .update(`${String(type || '').trim()}:${String(severity || '').trim()}`)
    .digest('hex');
}

function normalizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return details;
}

async function recordIncident({ type, severity, message, details = {}, dedupeKey = null }) {
  const normalizedType = String(type || '').trim().slice(0, 100);
  const normalizedSeverity = String(severity || '').trim().slice(0, 20);
  const normalizedMessage = String(message || '').trim().slice(0, 10000);
  if (!normalizedType || !normalizedSeverity || !normalizedMessage) {
    return { persisted: false, error: 'Incident type, severity, and message are required' };
  }

  try {
    const result = await db.query(
      `INSERT INTO incident_log
         (type, severity, message, details, dedupe_key, occurrence_count, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, 1, NOW(), NOW())
       ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL
       DO UPDATE SET
         severity = EXCLUDED.severity,
         message = EXCLUDED.message,
         details = EXCLUDED.details,
         occurrence_count = incident_log.occurrence_count + 1,
         last_seen_at = NOW()
       RETURNING id, type, severity, message, details, dedupe_key,
                 occurrence_count, created_at, last_seen_at,
                 acknowledged_at, acknowledged_by, resolved_at, resolution_notes,
                 last_notified_at, notification_count`,
      [
        normalizedType,
        normalizedSeverity,
        normalizedMessage,
        JSON.stringify(normalizeDetails(details)),
        incidentDedupeKey(normalizedType, normalizedSeverity, dedupeKey),
      ]
    );
    const incident = result.rows[0] || null;
    if (!incident?.id) return { persisted: true, incident, notificationClaimed: false };

    // Claiming is conditional, so only one replica can dispatch notifications
    // during the cooldown window for a given open incident.
    const claim = await db.query(
      `UPDATE incident_log
       SET last_notified_at = NOW(), notification_count = notification_count + 1
       WHERE id = $1 AND resolved_at IS NULL
         AND (last_notified_at IS NULL OR last_notified_at <= NOW() - ($2::integer * INTERVAL '1 minute'))
       RETURNING id, last_notified_at, notification_count`,
      [incident.id, DEFAULT_NOTIFICATION_COOLDOWN_MINUTES]
    );
    return {
      persisted: true,
      incident,
      notificationClaimed: Boolean(claim.rows[0]),
    };
  } catch (error) {
    // Monitoring must never take down the request or alert loop when the
    // optional durability migration is still rolling out.
    logger.error('Failed to persist incident alert', {
      type: normalizedType,
      error: error.message,
    });
    return { persisted: false, error: error.message };
  }
}

async function listIncidents({ hours = 24, limit = 100 } = {}) {
  const safeHours = Math.min(720, Math.max(1, Number.parseInt(hours, 10) || 24));
  const safeLimit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 100));
  const result = await db.query(
    `SELECT id, type, severity, message, details, dedupe_key,
            occurrence_count, created_at, last_seen_at,
            acknowledged_at, acknowledged_by, resolved_at, resolution_notes,
            last_notified_at, notification_count
     FROM incident_log
     WHERE last_seen_at >= NOW() - ($1::integer * INTERVAL '1 hour')
     ORDER BY last_seen_at DESC, id DESC
     LIMIT $2`,
    [safeHours, safeLimit]
  );
  return result.rows || [];
}

async function acknowledgeIncident(id, adminId) {
  const result = await db.query(
    `UPDATE incident_log
     SET acknowledged_at = COALESCE(acknowledged_at, NOW()),
         acknowledged_by = COALESCE(acknowledged_by, $2)
     WHERE id = $1 AND resolved_at IS NULL
     RETURNING id, type, severity, message, details, dedupe_key,
               occurrence_count, created_at, last_seen_at,
               acknowledged_at, acknowledged_by, resolved_at, resolution_notes,
               last_notified_at, notification_count`,
    [id, adminId]
  );
  return result.rows[0] || null;
}

async function resolveIncident(id, adminId, resolutionNotes = null) {
  const result = await db.query(
    `UPDATE incident_log
     SET resolved_at = COALESCE(resolved_at, NOW()),
         resolution_notes = COALESCE(NULLIF($2, ''), resolution_notes),
         acknowledged_at = COALESCE(acknowledged_at, NOW()),
         acknowledged_by = COALESCE(acknowledged_by, $3)
     WHERE id = $1 AND resolved_at IS NULL
     RETURNING id, type, severity, message, details, dedupe_key,
               occurrence_count, created_at, last_seen_at,
               acknowledged_at, acknowledged_by, resolved_at, resolution_notes,
               last_notified_at, notification_count`,
    [id, resolutionNotes == null ? '' : String(resolutionNotes), adminId]
  );
  return result.rows[0] || null;
}

module.exports = {
  DEFAULT_NOTIFICATION_COOLDOWN_MINUTES,
  incidentDedupeKey,
  recordIncident,
  listIncidents,
  acknowledgeIncident,
  resolveIncident,
};
