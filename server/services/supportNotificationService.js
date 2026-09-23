'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');

const SUPPORT_STAFF_ROLES = ['admin', 'super_admin'];

async function resolveSupportStaffIds(dbClient = db) {
  const { rows } = await dbClient.query(
    `SELECT id
       FROM users
      WHERE role = ANY($1::text[])
        AND is_active = TRUE
        AND deleted_at IS NULL`,
    [SUPPORT_STAFF_ROLES],
  );
  return rows.map((row) => row.id).filter(Boolean);
}

function normalizeRecipientIds(recipientIds, senderId) {
  const senderKey = senderId == null ? null : String(senderId);
  return [...new Set((recipientIds || [])
    .filter((recipientId) => recipientId != null && String(recipientId) !== senderKey)
    .map((recipientId) => String(recipientId)))];
}

/**
 * Deliver support-ticket notifications after the ticket transaction commits.
 * Notification failures are intentionally isolated from the message response.
 */
function scheduleSupportMessageNotifications({
  ticketId,
  messageId,
  senderId = null,
  recipientIds = null,
  body,
  title = 'New support message',
  actionUrl = '/support/agent',
}) {
  if (!ticketId || !messageId) return false;

  setImmediate(async () => {
    try {
      const resolvedRecipients = recipientIds == null
        ? await resolveSupportStaffIds()
        : recipientIds;
      const recipients = normalizeRecipientIds(resolvedRecipients, senderId);
      await Promise.allSettled(recipients.map((userId) => sendNotification({
        userId,
        type: 'new_message',
        title,
        body: String(body || '').slice(0, 280),
        data: {
          supportTicketId: String(ticketId),
          messageId: String(messageId),
        },
        action_url: actionUrl,
        idempotencyKey: `support-ticket-message:${ticketId}:${messageId}:${userId}`,
      })));
    } catch (error) {
      logger.warn('Support ticket notification scheduling failed', {
        ticketId,
        messageId,
        error: error.message,
      });
    }
  });
  return true;
}

module.exports = {
  resolveSupportStaffIds,
  scheduleSupportMessageNotifications,
};
