'use strict';
const pool = require('../db');
const VIEWS = ['customer_cancellation_stats', 'helper_cancellation_stats'];
async function refresh(client = pool) {
  for (const name of VIEWS) {
    const started = Date.now();
    // Historical indexes are not UNIQUE, so CONCURRENTLY is unsupported.
    // Refresh commits before the log is updated; failures never claim freshness.
    await client.query(`REFRESH MATERIALIZED VIEW ${name}`);
    await client.query(`UPDATE mv_refresh_log SET last_refreshed_at=NOW(),next_refresh_at=NOW()+interval '1 hour',refresh_duration_ms=$2 WHERE view_name=$1`, [name, Date.now() - started]);
  }
}
async function freshness(name, client = pool) {
  if (!VIEWS.includes(name)) throw new Error('Unknown cancellation statistics view');
  const { rows } = await client.query('SELECT MAX(last_refreshed_at) AS last_refreshed_at FROM mv_refresh_log WHERE view_name=$1', [name]);
  const last = rows[0]?.last_refreshed_at || null;
  return { last_refreshed_at: last, stale: !last || Date.now() - new Date(last).getTime() > 2 * 60 * 60 * 1000 };
}
module.exports = { refresh, freshness };
