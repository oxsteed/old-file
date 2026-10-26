'use strict';

/**
 * P1-267: retention for the guest profile-chat tables.
 *
 * guest_profile_chat_inbound (guest name, email, phone) and its children
 * (guest_profile_chat_messages, verification, read cursors, intakes, queue and
 * monitoring rows, all ON DELETE CASCADE) previously had no expiry at all.
 * Sessions with no activity for GUEST_CHAT_RETENTION_DAYS (default 180, the
 * same window as support messages) are hard-deleted in bounded batches.
 * A claimed session's conversation copy lives in `conversations` and follows
 * that table's own per-user retention, so it is unaffected.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const DEFAULT_DAYS = 180;
const BATCH = 500;
const MAX_BATCHES = 40;

function retentionDays(env = process.env) {
  const n = Number.parseInt(env.GUEST_CHAT_RETENTION_DAYS, 10);
  return Number.isFinite(n) && n >= 30 ? n : DEFAULT_DAYS;
}

async function cleanupGuestChatRetention({ db = pool, env = process.env } = {}) {
  await db.query(`DELETE FROM order_sms_budgets WHERE (user_id,order_key,day) IN
    (SELECT user_id,order_key,day FROM order_sms_budgets WHERE day<CURRENT_DATE-7 LIMIT 2000)`);
  const days = retentionDays(env);
  let deleted = 0;
  for (let i = 0; i < MAX_BATCHES; i += 1) {
    const { rowCount } = await db.query(
      `DELETE FROM guest_profile_chat_inbound
        WHERE id IN (
          SELECT id FROM guest_profile_chat_inbound
           WHERE COALESCE(last_activity_at, created_at) < NOW() - ($1::int * INTERVAL '1 day')
           ORDER BY COALESCE(last_activity_at, created_at)
           LIMIT ${BATCH}
           FOR UPDATE SKIP LOCKED
        )`,
      [days]
    );
    deleted += rowCount || 0;
    if (!rowCount || rowCount < BATCH) break;
  }
  logger.info('Guest chat retention cleanup completed', { deleted, retentionDays: days });
  return { success: true, deleted, retentionDays: days };
}

module.exports = { cleanupGuestChatRetention, retentionDays, cronExpression: '25 2 * * *' };
