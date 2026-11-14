'use strict';
const pool = require('../db');
const { sendNotification } = require('./notificationService');
const { recordIncident } = require('./incidentStore');
const COPY = {
 en: ['SOS Alert', 'SOS: acknowledgment overdue', 'Review SOS event {{id}} from user {{user}}.'],
 es: ['Alerta SOS', 'SOS: confirmación pendiente', 'Revisa el evento SOS {{id}} del usuario {{user}}.'],
 fr: ['Alerte SOS', 'SOS : accusé de réception en retard', 'Examinez le SOS {{id}} de l’utilisateur {{user}}.'],
 ht: ['Alèt SOS', 'SOS: konfimasyon an anreta', 'Revize evènman SOS {{id}} itilizatè {{user}} a.'],
 ar: ['تنبيه SOS', 'SOS: تأخر الإقرار', 'راجع تنبيه SOS رقم {{id}} من المستخدم {{user}}.'],
};
// Item 18: bounded SOS fan-out. At most this many admins are ever fetched
// for one event, and each send (first or escalation tier) notifies at most
// one tier of this size.
const SOS_RECIPIENT_POOL_MAX = 50;
const SOS_TIER_SIZE = 5;

async function notifySOS(event, { escalation = false, db = pool, notify = sendNotification } = {}) {
  // Item 18: fan-out is bounded. The recipient pool is capped at the
  // query (on-call first, then the rest by id), the first send goes to
  // the on-call admins only (one fallback tier of the pool when nobody
  // is on call), and each escalation notifies exactly one further tier:
  // escalation N notifies tier N of the same stable ordering, wrapping
  // to tier 0 only after every admin has had a turn, so an admin is
  // never re-notified while un-notified admins remain.
  const { rows } = await db.query(`SELECT u.id,u.preferred_language, COALESCE(p.safety_on_call,FALSE) AS on_call
    FROM users u LEFT JOIN admin_notification_prefs p ON p.admin_id=u.id
    WHERE u.role IN ('admin','super_admin') AND u.is_active=TRUE AND u.deleted_at IS NULL
      AND (u.role='super_admin' OR EXISTS (SELECT 1 FROM admin_permission_grants g
        WHERE g.grantee_id=u.id AND g.permissions ? 'manage_support' AND g.region_id IS NULL AND g.revoked_at IS NULL AND g.expires_at>NOW()))
    ORDER BY COALESCE(p.safety_on_call,FALSE) DESC, u.id
    LIMIT $1`, [SOS_RECIPIENT_POOL_MAX]);
  const onCall = rows.filter(r => r.on_call);
  let recipients;
  if (!escalation) {
    recipients = onCall.length ? onCall.slice(0, SOS_TIER_SIZE) : rows.slice(0, SOS_TIER_SIZE);
  } else {
    const tierCount = Math.max(1, Math.ceil(rows.length / SOS_TIER_SIZE));
    const tierIndex = (Math.max(1, Number(event.escalation_count) || 1)) % tierCount;
    recipients = rows.slice(tierIndex * SOS_TIER_SIZE, (tierIndex + 1) * SOS_TIER_SIZE);
  }
  const results = await Promise.allSettled(recipients.map(admin => notify({
    userId: admin.id, type: 'safety_sos', title: (COPY[admin.preferred_language] || COPY.en)[escalation ? 1 : 0],
    body: (COPY[admin.preferred_language] || COPY.en)[2].replace('{{id}}', String(event.id)).replace('{{user}}', String(event.user_id)),
    data: { lat: event.lat, lng: event.lng, userId: event.user_id, sosEventId: event.id, type: 'safety_sos' },
    action_url: `/admin/users/${event.user_id}`,
  })));
  // Item 19: count only a push/email acknowledgement as delivered. An
  // in-app row alone does not reach an operator who is not looking at the
  // centre, and `success` is true even when no row exists. A notify
  // implementation that returns no delivered breakdown (older injected
  // senders) falls back to `success` so existing callers keep working.
  const delivered = results.filter(r => r.status === 'fulfilled'
    && (r.value?.delivered
      ? (r.value.delivered.push === true || r.value.delivered.email === true)
      : r.value?.success === true)).length;
  if (!delivered || escalation) await recordIncident({
    type: 'safety_sos_unacknowledged', severity: 'critical', dedupeKey: `safety-sos:${event.id}`,
    message: `SOS event ${event.id} needs operator acknowledgment`, details: { sosEventId: event.id, delivered },
  });
  return { delivered };
}
async function escalateUnacknowledgedSOS({ db = pool, limit = 50, fence = null } = {}) {
  // Background-jobs audit #39: the fleet runner hands us the fence;
  // the claim and the escalation writes go through fence.db, so a
  // worker that lost its lease stops instead of re-escalating through
  // the raw pool. Without a fence (direct calls, tests) the supplied
  // db is used as before.
  const handle = fence ? fence.db : db;
  const { rows } = await handle.query(`WITH batch AS (
    SELECT id FROM safety_sos_events WHERE acknowledged_at IS NULL
      AND created_at < NOW()-INTERVAL '5 minutes'
      AND (last_escalated_at IS NULL OR last_escalated_at<NOW()-INTERVAL '15 minutes')
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1
  ) UPDATE safety_sos_events s SET last_escalated_at=NOW(), escalation_count=escalation_count+1
    FROM batch b WHERE s.id=b.id RETURNING s.*`, [Math.min(100, Math.max(1, parseInt(limit,10) || 50))]);
  for (const event of rows) await notifySOS(event, { escalation: true, db: handle });
  return { escalated: rows.length };
}
module.exports = { notifySOS, escalateUnacknowledgedSOS };
