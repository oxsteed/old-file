'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');

const SUPPORT_STAFF_ROLES = ['admin', 'super_admin'];

// Item 10: cap every admin fan-out. A new ticket used to notify every
// active admin/super_admin with no LIMIT; 25 bounds the blast radius
// while still covering any realistic on-call rotation.
const SUPPORT_STAFF_ALERT_LIMIT = 25;

/**
 * Shared admin-recipient scoping for support alerts (item 10; reused by
 * the SLA breach fan-out in item 21 and by every later batch that needs
 * to reach support staff).
 *
 * - Only active, non-deleted admins/super_admins with the global
 *   manage_support grant (super_admins unconditionally), mirroring the
 *   staff gate in safetySOSService.
 * - On-call staff first: when at least one admin has
 *   admin_notification_prefs.safety_on_call, only the on-call staff are
 *   returned; otherwise every support-granted admin (capped) so an
 *   unstaffed rotation never drops the alert entirely.
 */
async function resolveSupportStaffIds(dbClient = db) {
  const { rows } = await dbClient.query(
    `SELECT u.id, COALESCE(p.safety_on_call, FALSE) AS on_call
       FROM users u
       LEFT JOIN admin_notification_prefs p ON p.admin_id = u.id
      WHERE u.role = ANY($1::text[])
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
        AND (u.role = 'super_admin' OR EXISTS (
          SELECT 1 FROM admin_permission_grants g
           WHERE g.grantee_id = u.id
             AND g.permissions ? 'manage_support'
             AND g.region_id IS NULL
             AND g.revoked_at IS NULL
             AND g.expires_at > NOW()
        ))
      ORDER BY COALESCE(p.safety_on_call, FALSE) DESC, u.id
      LIMIT $2`,
    [SUPPORT_STAFF_ROLES, SUPPORT_STAFF_ALERT_LIMIT],
  );
  const onCall = rows.filter((row) => row.on_call);
  const scoped = onCall.length > 0 ? onCall : rows;
  return scoped.map((row) => row.id).filter(Boolean);
}

function normalizeRecipientIds(recipientIds, senderId) {
  const senderKey = senderId == null ? null : String(senderId);
  return [...new Set((recipientIds || [])
    .filter((recipientId) => recipientId != null && String(recipientId) !== senderKey)
    .map((recipientId) => String(recipientId)))];
}

/**
 * Shared staff fan-out for support alerts (item 21 breach notices and any
 * later staff-wide alert). One sendNotification per resolved staff member
 * with a per-recipient idempotency key, so a retry cannot duplicate the
 * in-app row, push, or email. A single recipient failure never blocks
 * the rest; failures are counted and warn-logged, never thrown.
 */
async function notifySupportStaff({
  type,
  title,
  body,
  data = {},
  action_url = '/support/agent',
  idempotencyKeyPrefix,
  // Callers that fan out over many entities (e.g. the SLA sweeper) pass
  // pre-resolved recipientIds so staff are resolved once per sweep,
  // not once per entity. Otherwise the helper resolves them itself.
  recipientIds = null,
  dbClient = db,
}) {
  const resolvedIds = recipientIds == null
    ? await resolveSupportStaffIds(dbClient)
    : normalizeRecipientIds(recipientIds, null);
  const results = await Promise.allSettled(resolvedIds.map((userId) => sendNotification({
    userId,
    type,
    title,
    body: String(body || '').slice(0, 280),
    data,
    action_url,
    idempotencyKey: `${idempotencyKeyPrefix}:${userId}`,
  })));
  const notified = results.filter(
    (result) => result.status === 'fulfilled' && result.value?.success !== false,
  ).length;
  const failed = results.length - notified;
  if (failed > 0) {
    logger.warn('Support staff notification fan-out had failures', { type, notified, failed });
  }
  return { notified, failed, recipients: resolvedIds.length };
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
  notifySupportStaff,
  SUPPORT_STAFF_ALERT_LIMIT,
};
