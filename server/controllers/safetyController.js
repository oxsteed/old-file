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

    // ── 1. Store the SOS event ──────────────────────────────────
    await db.query(
      `INSERT INTO safety_sos_events
         (user_id, lat, lng, contact_name, contact_phone, job_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT DO NOTHING`,
      [userId, lat ?? null, lng ?? null, contact_name, contact_phone, job_id ?? null]
    ).catch(() => {
      // Table may not exist yet (pre-migration) — log but don't block the response
      logger.warn('[Safety] safety_sos_events table missing; event not persisted', { userId });
    });

    // ── 2. Notify platform admins ───────────────────────────────
    const { rows: admins } = await db.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 5`
    ).catch(() => ({ rows: [] }));

    const locationText = (lat && lng)
      ? `Location: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
      : 'Location unavailable';

    await Promise.allSettled(
      admins.map(a =>
        sendNotification({
          userId:     a.id,
          type:       'safety_sos',
          title:      '🆘 SOS Alert',
          body:       `User ${userId} triggered an SOS. ${locationText}`,
          data:       { userId, lat, lng, job_id, type: 'safety_sos' },
          action_url: `/admin/users/${userId}`,
        })
      )
    );

    // ── 3. Notify the other party on the linked job (if any) ───
    if (job_id) {
      const { rows: jobRows } = await db.query(
        `SELECT customer_id, helper_id FROM jobs WHERE id = $1 LIMIT 1`,
        [job_id]
      ).catch(() => ({ rows: [] }));

      if (jobRows.length) {
        const job          = jobRows[0];
        const otherPartyId = job.customer_id === userId ? job.helper_id : job.customer_id;
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
    return res.json({ success: true, message: 'SOS alert sent.' });
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
