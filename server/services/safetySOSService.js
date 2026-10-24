'use strict';
const pool = require('../db');
const { sendNotification } = require('./notificationService');
const { recordIncident } = require('./incidentStore');

async function notifySOS(event, { escalation = false, db = pool, notify = sendNotification } = {}) {
  const { rows } = await db.query(`SELECT u.id, COALESCE(p.safety_on_call,FALSE) AS on_call
    FROM users u LEFT JOIN admin_notification_prefs p ON p.admin_id=u.id
    WHERE u.role IN ('admin','super_admin') AND u.is_active=TRUE AND u.deleted_at IS NULL
      AND (u.role='super_admin' OR EXISTS (SELECT 1 FROM admin_permission_grants g
        WHERE g.grantee_id=u.id AND g.permissions ? 'manage_support' AND g.revoked_at IS NULL AND g.expires_at>NOW()))
    ORDER BY COALESCE(p.safety_on_call,FALSE) DESC, u.id`);
  const onCall = rows.filter(r => r.on_call);
  const recipients = !escalation && onCall.length ? onCall : rows;
  const results = await Promise.allSettled(recipients.map(admin => notify({
    userId: admin.id, type: 'safety_sos', title: escalation ? 'SOS: acknowledgment overdue' : 'SOS Alert',
    body: `User ${event.user_id} triggered an SOS. Review and acknowledge event ${event.id}.`,
    data: { lat: event.lat, lng: event.lng, userId: event.user_id, sosEventId: event.id, type: 'safety_sos' },
    action_url: `/admin/users/${event.user_id}`,
  })));
  const delivered = results.filter(r => r.status === 'fulfilled' && r.value?.success === true).length;
  if (!delivered || escalation) await recordIncident({
    type: 'safety_sos_unacknowledged', severity: 'critical', dedupeKey: `safety-sos:${event.id}`,
    message: `SOS event ${event.id} needs operator acknowledgment`, details: { sosEventId: event.id, delivered },
  });
  return { delivered };
}
async function escalateUnacknowledgedSOS({ db = pool, limit = 50 } = {}) {
  const { rows } = await db.query(`WITH batch AS (
    SELECT id FROM safety_sos_events WHERE acknowledged_at IS NULL
      AND created_at < NOW()-INTERVAL '5 minutes'
      AND (last_escalated_at IS NULL OR last_escalated_at<NOW()-INTERVAL '15 minutes')
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1
  ) UPDATE safety_sos_events s SET last_escalated_at=NOW(), escalation_count=escalation_count+1
    FROM batch b WHERE s.id=b.id RETURNING s.*`, [Math.min(100, Math.max(1, parseInt(limit,10) || 50))]);
  for (const event of rows) await notifySOS(event, { escalation: true, db });
  return { escalated: rows.length };
}
module.exports = { notifySOS, escalateUnacknowledgedSOS };
