const cron = require('node-cron');
const db = require('../db');
const { withChatTransaction } = require('../services/chatTransactionService');
const logger = require('../utils/logger');

/**
 * Every 1 minute (every :00 second)
 * Check for guest chat sessions in "waiting_for_helper" state that have exceeded their 5-minute response deadline.
 * Transition them to "ai_fallback_pending" state and notify available helpers.
 *
 * This cron job ensures reliability across server restarts — timeouts are database-driven, not in-memory.
 */
const startGuestChatSessionTimeoutJob = () => {
  cron.schedule('* * * * *', async () => {
    try {
      // Find all sessions waiting for helper whose deadline has passed
      const { rows: staleSessions } = await db.query(
        `SELECT id, guest_id, guest_name, last_activity_at
         FROM guest_profile_chat_inbound
         WHERE session_status = 'waiting_for_helper'
           AND helper_response_deadline IS NOT NULL
           AND helper_response_deadline < CURRENT_TIMESTAMP
         LIMIT 100`
      );

      if (staleSessions.length === 0) {
        return; // No sessions to timeout
      }

      logger.info('Guest chat sessions timing out', {
        sessionCount: staleSessions.length
      });

      let succeeded = 0;
      let failed = 0;

      for (const session of staleSessions) {
        try {
          // Transition session to ai_fallback_pending within a transaction
          await withChatTransaction(async (client) => {
            // Get current session state with lock
            const current = await client.query(
              `SELECT session_status, helper_response_deadline FROM guest_profile_chat_inbound
               WHERE id = $1 FOR UPDATE`,
              [session.id]
            );

            // Double-check the session is still waiting and deadline has passed
            // (another process might have claimed it)
            if (current.rows[0].session_status !== 'waiting_for_helper' ||
                new Date(current.rows[0].helper_response_deadline) > new Date()) {
              return; // Session was claimed or deadline was updated, skip
            }

            // Update session status
            await client.query(
              `UPDATE guest_profile_chat_inbound
               SET session_status = $1,
                   ai_fallback_triggered_at = CURRENT_TIMESTAMP,
                   last_activity_at = CURRENT_TIMESTAMP
               WHERE id = $2`,
              ['ai_fallback_pending', session.id]
            );

            // Log the timeout event
            await client.query(
              `INSERT INTO chat_monitoring_log (session_id, event_type, metadata)
               VALUES ($1, $2, $3)`,
              [session.id, 'ai_fallback_triggered_timeout', JSON.stringify({
                guest_name: session.guest_name,
                deadline_elapsed: true,
                triggered_by: 'cron'
              })]
            );
          }, 'guest_chat_session_timeout');

          succeeded++;
        } catch (err) {
          failed++;
          logger.error('Failed to timeout guest chat session', {
            sessionId: session.id,
            guestName: session.guest_name,
            error: err.message
          });
        }
      }

      logger.info('Guest chat session timeout job complete', {
        succeeded,
        failed,
        total: staleSessions.length
      });
    } catch (err) {
      logger.error('Guest chat session timeout job failed', {
        error: err.message
      });
    }
  });
};

module.exports = { startGuestChatSessionTimeoutJob };
