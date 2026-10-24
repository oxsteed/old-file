 'use strict';
const pool = require('../db');
async function dispatchPendingIncidentNotifications({ db = pool, limit = 50 } = {}) {
  const { rows } = await db.query(`SELECT * FROM incident_log WHERE resolved_at IS NULL AND severity='critical'
    AND notification_claimed_at IS NOT NULL
    AND (last_notified_at IS NULL OR last_notified_at < notification_claimed_at)
    AND (dispatch_lease_until IS NULL OR dispatch_lease_until < NOW())
    ORDER BY notification_claimed_at, id LIMIT $1`, [Math.min(100, Math.max(1, parseInt(limit, 10) || 50))]);
  const alerts = require('../services/incidentAlertService');
  let dispatched = 0;
  for (const row of rows) {
    const result = await alerts.dispatchRecordedIncident({ ...row, timestamp: row.last_seen_at });
    if (result.dispatched) dispatched++;
  }
  return { examined: rows.length, dispatched };
}
module.exports = { dispatchPendingIncidentNotifications };
