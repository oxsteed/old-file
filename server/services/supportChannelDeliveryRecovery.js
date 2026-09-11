'use strict';

const db = require('../db');
const logger = require('../utils/logger');

const STALE_MINUTES = 15;
const BATCH_SIZE = 100;

/**
 * Recover provider attempts interrupted by a process restart or network hang.
 * The conditional update is its own concurrency guard: only one replica can
 * transition a stale sending row to failed, leaving retry in the agent UI.
 */
async function recoverStaleSupportChannelDeliveries() {
  const result = await db.query(
    `UPDATE support_channel_deliveries
     SET status = 'failed',
         error_code = 'delivery_timeout',
         error_message = 'Provider delivery timed out; retry is available',
         updated_at = NOW()
     WHERE id IN (
       SELECT id
       FROM support_channel_deliveries
       WHERE status = 'sending'
         AND updated_at < NOW() - ($1::integer * INTERVAL '1 minute')
       ORDER BY updated_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     RETURNING id, message_id`,
    [STALE_MINUTES, BATCH_SIZE]
  );

  for (const row of result.rows) {
    if (!row.message_id) continue;
    await db.query(
      `UPDATE support_conversation_messages
       SET status = 'failed', updated_at = NOW()
       WHERE id = $1 AND status = 'sending'`,
      [row.message_id]
    );
  }

  const recovered = result.rows.length;
  if (recovered > 0) logger.warn('Recovered stale support channel deliveries', { recovered });
  return { recovered };
}

module.exports = {
  STALE_MINUTES,
  BATCH_SIZE,
  recoverStaleSupportChannelDeliveries,
};
