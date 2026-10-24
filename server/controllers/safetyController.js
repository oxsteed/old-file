const db     = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');

// ─── POST /api/safety/sos ─────────────────────────────────────────────────────
// Body: { lat, lng, contact_name, contact_phone, job_id? }
// Also accepts legacy iOS payload fields { latitude, longitude }.
// Records the SOS event, notifies any matched job parties, and returns OK so
// the iOS safety timer can confirm dispatch.
// ─────────────────────────────────────────────────────────────────────────────

exports.sendSOS = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      lat: latInput,
      lng: lngInput,
      latitude,
      longitude,
      contact_name  = null,
      contact_phone = null,
      job_id        = null,
    } = req.body || {};
    const lat = latInput ?? latitude ?? null;
    const lng = lngInput ?? longitude ?? null;

    const { rows: [event] } = await db.query(
      `INSERT INTO safety_sos_events (user_id,lat,lng,contact_name,contact_phone,job_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [userId, lat, lng, contact_name, contact_phone, job_id]);
    if (!event) throw new Error('SOS event was not persisted');
    await require('../services/safetySOSService').notifySOS(event);

    // ── 3. Notify the other party on the linked job (if any) ───
    if (job_id) {
      const { rows: jobRows } = await db.query(
        `SELECT client_id AS customer_id, assigned_helper_id AS helper_id FROM jobs WHERE id = $1 LIMIT 1`,
        [job_id]
      ).catch(() => ({ rows: [] }));

      if (jobRows.length && [jobRows[0].customer_id, jobRows[0].helper_id].some(id => String(id) === String(userId))) {
        const job          = jobRows[0];
        const otherPartyId = String(job.customer_id) === String(userId) ? job.helper_id : job.customer_id;
        if (otherPartyId) {
          await sendNotification({
            userId:     otherPartyId,
            type:       'safety_sos',
            title:      '🆘 Safety Alert',
            body:       'Your job partner triggered an SOS. Check on them immediately.',
            data:       { userId, lat, lng, job_id, type: 'safety_sos' },
            action_url: `/jobs/${job_id}`,
          }).catch(err =>
            logger.warn('[Safety] Failed to notify job partner', { err: err.message })
          );
        }
      }
    }

    logger.info('[Safety] SOS dispatched', { userId, lat, lng, job_id });
    return res.json({ success: true, eventId: event.id, message: 'SOS alert recorded.' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/safety/sos (admin only) ────────────────────────────────────────
exports.listSOS = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT s.*, u.first_name, u.last_name, u.email
       FROM safety_sos_events s
       JOIN users u ON u.id = s.user_id
       ORDER BY s.created_at DESC
       LIMIT 100`
    ).catch(() => ({ rows: [] }));

    return res.json({ events: rows });
  } catch (err) {
    next(err);
  }
};

exports.acknowledgeSOS = async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin' && !(await require('../middleware/adminAuth').hasGlobalGrant(req.user.id, 'manage_support'))) {
      return res.status(403).json({ error: 'A global support grant is required.' });
    }
    if (!/^[1-9][0-9]*$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid SOS event id' });
    const { rows: [event] } = await db.query(`UPDATE safety_sos_events
      SET acknowledged_at=COALESCE(acknowledged_at,NOW()), acknowledged_by=COALESCE(acknowledged_by,$2)
      WHERE id=$1 RETURNING *`, [req.params.id, req.user.id]);
    if (!event) return res.status(404).json({ error: 'SOS event not found' });
    await require('../services/incidentStore').resolveOpenIncidentsByDedupeKeys([`safety-sos:${event.id}`], 'SOS acknowledged by an operator');
    return res.json({ event });
  } catch (err) { next(err); }
};
