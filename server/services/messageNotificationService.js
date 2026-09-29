const db = require('../db');

function normalizeRecipientIds(recipientIds, senderId = null) {
  const senderKey = senderId == null ? null : String(senderId);
  const values = recipientIds == null
    ? []
    : Array.isArray(recipientIds)
      ? recipientIds
      : [...recipientIds];
  return [...new Set(values
    .filter((recipientId) => recipientId != null && String(recipientId) !== senderKey)
    .map((recipientId) => String(recipientId)))];
}

async function enqueueMessageNotification({
  dbClient = db,
  messageId,
  conversationId,
  recipientId,
  senderName,
  body,
  actionUrl,
}) {
  if (!messageId || !conversationId || !recipientId) return false;

  await dbClient.query(
    `INSERT INTO message_notification_outbox
       (message_id, conversation_id, recipient_id, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (message_id, recipient_id) DO NOTHING`,
    [
      messageId,
      conversationId,
      recipientId,
      JSON.stringify({
        conversationId,
        messageId,
        senderName: senderName || 'OxSteed',
        body: String(body || '').slice(0, 280),
        actionUrl: actionUrl || `/messages/${conversationId}`,
      }),
    ]
  );
  return true;
}

async function enqueueMessageNotifications({
  dbClient = db,
  messageId,
  conversationId,
  recipientIds,
  senderId,
  senderName,
  body,
  actionUrl,
}) {
  const recipients = normalizeRecipientIds(recipientIds, senderId);
  for (const recipientId of recipients) {
    await enqueueMessageNotification({
      dbClient,
      messageId,
      conversationId,
      recipientId,
      senderName,
      body,
      actionUrl,
    });
  }
  return recipients;
}

async function resolveConversationRecipients({ dbClient = db, conversationId, senderId }) {
  const { rows } = await dbClient.query(
    `SELECT customer_id, helper_id, business_id
       FROM conversations
      WHERE id = $1`,
    [conversationId]
  );
  const conversation = rows[0];
  if (!conversation) return { conversation: null, recipientIds: [] };

  const recipientIds = new Set([
    conversation.customer_id,
    conversation.helper_id,
  ].filter(Boolean));

  if (conversation.business_id) {
    const reps = await dbClient.query(
      `SELECT member_id
         FROM business_members
        WHERE business_id = $1 AND status = 'active'`,
      [conversation.business_id]
    );
    reps.rows.forEach((row) => recipientIds.add(row.member_id));
  }

  return {
    conversation,
    recipientIds: normalizeRecipientIds([...recipientIds], senderId),
  };
}

async function enqueueConversationMessageNotifications({
  dbClient = db,
  conversationId,
  messageId,
  senderId,
  senderName,
  body,
  actionUrl,
  recipientIds = null,
  bestEffort = false,
}) {
  try {
    const resolvedRecipientIds = recipientIds == null
      ? (await resolveConversationRecipients({ dbClient, conversationId, senderId })).recipientIds
      : normalizeRecipientIds(recipientIds, senderId);
    await enqueueMessageNotifications({
      dbClient,
      messageId,
      conversationId,
      recipientIds: resolvedRecipientIds,
      senderId,
      senderName,
      body,
      actionUrl,
    });
    return resolvedRecipientIds;
  } catch (error) {
    if (bestEffort) return [];
    throw error;
  }
}

// Compatibility wrapper for older callers. New message paths should pass a
// transaction client to enqueueConversationMessageNotifications directly so
// the message and notification intent commit together. Keep this wrapper
// synchronous with the durable insert; a timer here would reintroduce a crash
// window between the domain write and its outbox row.
function scheduleConversationMessageNotifications(options) {
  const operation = enqueueConversationMessageNotifications(options);
  if (options?.bestEffort) return operation.catch(() => []);
  return operation;
}

module.exports = {
  enqueueMessageNotification,
  enqueueMessageNotifications,
  enqueueConversationMessageNotifications,
  scheduleConversationMessageNotifications,
  resolveConversationRecipients,
};
