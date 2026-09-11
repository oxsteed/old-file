'use strict';

const pool = require('../db');
const WebSocketService = require('./websocketService');
const { sendNotification } = require('./notificationService');
const logger = require('../utils/logger');
const { TERMINAL_CONVERSATION_STATUS_SQL } = require('./supportConversationTerminal');

const ADVISORY_LOCK_KEY = 379;
const ADVISORY_LOCK_SCOPE = 4;
const BATCH_SIZE = 100;

/**
 * Deliver due follow-up reminders once. The advisory lock prevents duplicate
 * fan-out when multiple app replicas run the same cron schedule. The marker is
 * written only after the notification path succeeds, so a transient failure
 * remains eligible for a later retry.
 */
async function processSupportFollowUpReminders() {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = Boolean((await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [ADVISORY_LOCK_KEY, ADVISORY_LOCK_SCOPE]
    )).rows[0]?.locked);
    if (!locked) return { locked: false, notified: 0 };

    const { rows } = await client.query(
      `SELECT r.id, r.conversation_id, r.assigned_to, r.note, r.due_at,
              sc.business_id, sc.subject,
              COALESCE(r.assigned_to, sa.user_id) AS recipient_user_id
       FROM support_follow_up_reminders r
       JOIN support_conversations sc ON sc.id = r.conversation_id
       LEFT JOIN support_agents sa ON sa.id = sc.agent_id
       WHERE r.status = 'pending'
         AND r.due_at <= NOW()
         AND r.notified_at IS NULL
         AND sc.status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})
       ORDER BY r.due_at ASC
       LIMIT ${BATCH_SIZE}`
    );

    let notified = 0;
    for (const reminder of rows) {
      try {
        const title = 'Support follow-up due';
        const body = `${reminder.subject || 'A support conversation'} needs follow-up${reminder.note ? `: ${reminder.note}` : '.'}`;
        if (reminder.recipient_user_id) {
          await sendNotification({
            userId: reminder.recipient_user_id,
            type: 'support_follow_up_due',
            title,
            body,
            data: {
              conversationId: reminder.conversation_id,
              reminderId: reminder.id,
              businessId: reminder.business_id,
            },
            action_url: '/admin/support/chat',
          });
        } else {
          WebSocketService.broadcastToAdmins('support:follow-up-due', {
            conversationId: reminder.conversation_id,
            reminderId: reminder.id,
            businessId: reminder.business_id,
            subject: reminder.subject,
            dueAt: reminder.due_at,
            note: reminder.note || null,
          });
        }

        const result = await client.query(
          `UPDATE support_follow_up_reminders
           SET notified_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'pending' AND notified_at IS NULL
           RETURNING id`,
          [reminder.id]
        );
        if (result.rows.length) notified += 1;
      } catch (error) {
        logger.warn('Support follow-up reminder notification failed', {
          reminderId: reminder.id,
          conversationId: reminder.conversation_id,
          error: error.message,
        });
      }
    }

    return { locked: true, notified };
  } catch (error) {
    logger.error('Support follow-up reminder worker failed', { error: error.message });
    throw error;
  } finally {
    try {
      if (locked) await client.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [ADVISORY_LOCK_KEY, ADVISORY_LOCK_SCOPE]
      );
    } finally {
      client.release();
    }
  }
}

module.exports = { processSupportFollowUpReminders };
