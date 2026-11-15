"use strict";
const { tNotif } = require('../utils/i18n');
const { sendNotification } = require('./notificationService');
const { broadcastToUser } = require('./socketService');
const logger = require('../utils/logger');

// Persist the in-app notification with its creator state change. Delivery
// uses the shared preferences/push/email system after commit. Financial
// journal notices additionally retain their existing durable Credit outbox.
async function queueCreatorNotification(client, { userId, event, referenceId, version = '', data = {} }) {
  if (!userId) return null;
  const { rows: users } = await client.query(
    `SELECT u.preferred_language, np.*,
            -- Item 12/33: the in-app master toggle and the per-type opt-out
            -- for this type gate queueing too, not just sendNotification:
            -- the queue inserts the row directly, so prefAllows alone
            -- cannot suppress it.
            EXISTS (SELECT 1 FROM notification_type_opt_outs
                     WHERE user_id = u.id
                       AND notification_type = 'media_creator_update'
                       AND channel = 'in_app') AS type_opted_out
       FROM users u
      LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE u.id = $1 AND u.is_active = TRUE AND u.is_banned = FALSE AND u.deleted_at IS NULL`, [userId]
  );
  if (!users[0] || users[0].in_app_media_creator_update === false
    || users[0].in_app_notifications === false || users[0].type_opted_out) return null;
  const copy = tNotif('media_creator_update', users[0].preferred_language || 'en');
  const payload = { event, reference_id: referenceId, ...data };
  const deliveryKey = `media_creator:${event}:${referenceId}:${userId}:${version}`;
  const { rows } = await client.query(
    `INSERT INTO notifications (user_id,type,title,body,data,action_url,delivery_key)
      VALUES ($1,'media_creator_update',$2,$3,$4::jsonb,'/media/creator',$5)
      ON CONFLICT (delivery_key) WHERE delivery_key IS NOT NULL DO NOTHING RETURNING *`,
    [userId, copy.title, copy.body, JSON.stringify(payload), deliveryKey]
  );
  return rows[0] ? { ...rows[0], userId, idempotencyKey: deliveryKey } : null;
}

async function deliverCreatorNotification(notification) {
  if (!notification) return;
  try {
    broadcastToUser(notification.userId, 'notification:new', notification);
    await sendNotification({ userId: notification.userId, type: 'media_creator_update', title: notification.title,
      data: notification.data, action_url: '/media/creator', idempotencyKey: notification.idempotencyKey });
  } catch (err) { logger.warn('Media creator notification delivery failed', { message: err.message }); }
}
module.exports = { queueCreatorNotification, deliverCreatorNotification };
