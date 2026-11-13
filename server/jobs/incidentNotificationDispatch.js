 'use strict';

const pool = require('../db');
const logger = require('../utils/logger');

// Domain 7 #28: one failing row used to abort the whole incident-dispatch
// batch for the tick (the throw inside dispatchRecordedIncident propagated
// out of the loop, so the remaining claimed rows waited for the next 60s
// tick). Rows are not lost — the lease expires and they are re-selected —
// only delayed. Each row is now attempted independently: a failure is
// logged and counted, and the loop continues with the next row.
async function dispatchPendingIncidentNotifications({ db = pool, limit = 50 } = {}) {
  const { rows } = await db.query(`SELECT * FROM incident_log WHERE resolved_at IS NULL AND severity='critical'
    AND notification_claimed_at IS NOT NULL
    AND (last_notified_at IS NULL OR last_notified_at < notification_claimed_at)
    AND (dispatch_lease_until IS NULL OR dispatch_lease_until < NOW())
    ORDER BY notification_claimed_at, id LIMIT $1`, [Math.min(100, Math.max(1, parseInt(limit, 10) || 50))]);
  const alerts = require('../services/incidentAlertService');
  let dispatched = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await alerts.dispatchRecordedIncident({ ...row, timestamp: row.last_seen_at });
      if (result.dispatched) dispatched++;
    } catch (err) {
      failed++;
      logger.error('Incident dispatch row failed (continuing with remaining rows)', {
        incidentId: row.id,
        type: row.type,
        error: err.message,
      });
    }
  }
  return { examined: rows.length, dispatched, failed };
}
module.exports = { dispatchPendingIncidentNotifications };
