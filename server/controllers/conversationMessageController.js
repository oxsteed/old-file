const pool = require('../db');
const { query } = pool;
const { sendError, sendValidationError } = require('../utils/apiError');
const { broadcastToConversation } = require('../services/socketService');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');
const { withTransaction } = require('../utils/transaction');

async function loadAuthorizedConversation(req, conversationId) {
  const { businessId } = req.params;
  if (!businessId || !req.user?.id) return null;
  const canAccess = await supportEmployerService.userCanAccessBusinessConversations(
    businessId,
    req.user.id,
    req.user.role
  );
  if (!canAccess) return null;
  const result = await query(
    'SELECT id, business_id, customer_id, agent_id, status FROM support_conversations WHERE id = $1 AND business_id = $2',
    [conversationId, businessId]
  );
  return result.rows[0] || null;
}

async function loadAuthorizedMessage(req, messageId) {
  const { businessId } = req.params;
  if (!businessId || !req.user?.id) return null;
  const canAccess = await supportEmployerService.userCanAccessBusinessConversations(
    businessId,
    req.user.id,
    req.user.role
  );
  if (!canAccess) return null;
  const result = await query(
    `SELECT scm.*, sc.business_id, sc.customer_id, sc.agent_id, sc.status AS conversation_status
     FROM support_conversation_messages scm
     JOIN support_conversations sc ON sc.id = scm.conversation_id
     WHERE scm.id = $1 AND sc.business_id = $2`,
    [messageId, businessId]
  );
  return result.rows[0] || null;
}

async function getMessages(req, res) {
  try {
    const { conversationId } = req.params;
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    if (!(await loadAuthorizedConversation(req, conversationId))) return sendError(res, 403, 'Access denied');

    const result = await query(
      `SELECT scm.*, u.name, u.avatar_url
       FROM support_conversation_messages scm
       LEFT JOIN users u ON scm.sender_id = u.id
       WHERE scm.conversation_id = $1
       ORDER BY scm.created_at DESC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getMessages error', { error: err.message });
    sendError(res, 500, 'Failed to get messages');
  }
}

async function markAsRead(req, res) {
  try {
    const { messageId } = req.params;

    const message = await loadAuthorizedMessage(req, messageId);
    if (!message) return sendError(res, 403, 'Access denied');

    // Only the recipient (i.e. not the original sender) may mark a message as read.
    if (message.sender_id === req.user.id) {
      return sendError(res, 403, 'Access denied');
    }

    const result = await query(
      `UPDATE support_conversation_messages
       SET read_by_recipient = true, read_at = CURRENT_TIMESTAMP, status = 'read'
       WHERE id = $1 AND conversation_id = $2
       RETURNING *`,
      [messageId, message.conversation_id]
    );

    const msg = result.rows[0];
    broadcastToConversation(msg.conversation_id, 'message_read', {
      messageId: msg.id,
      readAt: msg.read_at
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('markAsRead error', { error: err.message });
    sendError(res, 500, 'Failed to mark as read');
  }
}

async function deleteMessage(req, res) {
  try {
    const { messageId } = req.params;
    const message = await loadAuthorizedMessage(req, messageId);
    if (!message) return sendError(res, 403, 'Access denied');

    // Only the original sender (or a platform admin) may delete their own message.
    const isOwner = message.sender_id === req.user.id;
    const isPlatformAdmin = ['admin', 'super_admin'].includes(req.user.role);
    if (!isOwner && !isPlatformAdmin) {
      return sendError(res, 403, 'Access denied');
    }

    await query(
      'DELETE FROM support_conversation_messages WHERE id = $1 AND conversation_id = $2',
      [messageId, message.conversation_id]
    );

    await query(
      'UPDATE support_conversations SET message_count = message_count - 1 WHERE id = $1',
      [message.conversation_id]
    );

    broadcastToConversation(message.conversation_id, 'message_deleted', { messageId });

    res.json({ success: true, data: message });
  } catch (err) {
    logger.error('deleteMessage error', { error: err.message });
    sendError(res, 500, 'Failed to delete message');
  }
}

async function editMessage(req, res) {
  try {
    const { messageId } = req.params;
    const { content } = req.body;

    if (!content) {
      return sendValidationError(res, { content: 'Required' });
    }

    const message = await loadAuthorizedMessage(req, messageId);
    if (!message) return sendError(res, 403, 'Access denied');

    // Only the original sender (or a platform admin) may edit their own message.
    const isOwner = message.sender_id === req.user.id;
    const isPlatformAdmin = ['admin', 'super_admin'].includes(req.user.role);
    if (!isOwner && !isPlatformAdmin) {
      return sendError(res, 403, 'Access denied');
    }

    const result = await query(
      `UPDATE support_conversation_messages
       SET content = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND conversation_id = $3
       RETURNING *`,
      [content, messageId, message.conversation_id]
    );

    broadcastToConversation(result.rows[0].conversation_id, 'message_edited', {
      messageId: result.rows[0].id,
      content: result.rows[0].content
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('editMessage error', { error: err.message });
    sendError(res, 500, 'Failed to edit message');
  }
}

async function addAttachment(req, res) {
  try {
    const { conversationId } = req.params;
    const { attachmentUrl, attachmentName } = req.body || {};
    const normalizedAttachmentName = String(attachmentName || '').trim();

    if (!attachmentUrl || String(attachmentUrl).length > 2048) {
      return sendValidationError(res, { attachmentUrl: 'Required' });
    }
    if (normalizedAttachmentName.length > 255) {
      return sendValidationError(res, { attachmentName: 'Must be 255 characters or fewer' });
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(String(attachmentUrl));
    } catch {
      return sendValidationError(res, { attachmentUrl: 'Must be a valid HTTPS URL' });
    }
    if (parsedUrl.protocol !== 'https:') {
      return sendValidationError(res, { attachmentUrl: 'Must be a valid HTTPS URL' });
    }
    const conversation = await loadAuthorizedConversation(req, conversationId);
    if (!conversation) return sendError(res, 403, 'Access denied');

    const storedAttachmentName = normalizedAttachmentName || 'Attachment';
    const normalizedAttachmentUrl = parsedUrl.toString();
    const result = await withTransaction(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO support_conversation_messages
         (conversation_id, sender_id, message_type, content, attachment_url, attachment_name, is_agent)
         VALUES ($1, $2, 'attachment', $3, $4, $5, false)
         RETURNING *`,
        [conversationId, req.user.id, normalizedAttachmentName || 'File', normalizedAttachmentUrl, storedAttachmentName]
      );

      await client.query(
        'UPDATE support_conversations SET message_count = message_count + 1 WHERE id = $1',
        [conversationId]
      );
      return inserted;
    }, 'add_support_conversation_attachment');

    broadcastToConversation(conversationId, 'attachment_uploaded', {
      messageId: result.rows[0].id,
      attachmentUrl: normalizedAttachmentUrl,
      attachmentName: storedAttachmentName,
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('addAttachment error', { error: err.message });
    sendError(res, 500, 'Failed to add attachment');
  }
}

async function getUnreadCount(req, res) {
  try {
    const { conversationId } = req.params;
    if (!(await loadAuthorizedConversation(req, conversationId))) return sendError(res, 403, 'Access denied');
    const result = await query(
      `SELECT COUNT(*) as unread_count
       FROM support_conversation_messages
       WHERE conversation_id = $1 AND read_by_recipient = false AND sender_id != $2`,
      [conversationId, req.user.id]
    );

    res.json({ success: true, data: { unreadCount: parseInt(result.rows[0].unread_count) } });
  } catch (err) {
    logger.error('getUnreadCount error', { error: err.message });
    sendError(res, 500, 'Failed to get unread count');
  }
}

async function markAllAsRead(req, res) {
  try {
    const { conversationId } = req.params;
    if (!(await loadAuthorizedConversation(req, conversationId))) return sendError(res, 403, 'Access denied');
    await query(
      `UPDATE support_conversation_messages
       SET read_by_recipient = true, read_at = CURRENT_TIMESTAMP, status = 'read'
       WHERE conversation_id = $1 AND sender_id != $2`,
      [conversationId, req.user.id]
    );

    broadcastToConversation(conversationId, 'all_messages_read', { userId: req.user.id });

    res.json({ success: true, data: { status: 'all marked as read' } });
  } catch (err) {
    logger.error('markAllAsRead error', { error: err.message });
    sendError(res, 500, 'Failed to mark all as read');
  }
}

async function sendTypingIndicator(req, res) {
  try {
    const { conversationId } = req.params;
    if (!(await loadAuthorizedConversation(req, conversationId))) return sendError(res, 403, 'Access denied');
    broadcastToConversation(conversationId, 'typing_indicator', {
      userId: req.user.id,
      isTyping: true
    });

    res.json({ success: true, data: { status: 'typing indicator sent' } });
  } catch (err) {
    logger.error('sendTypingIndicator error', { error: err.message });
    sendError(res, 500, 'Failed to send typing indicator');
  }
}

module.exports = {
  getMessages,
  markAsRead,
  deleteMessage,
  editMessage,
  addAttachment,
  getUnreadCount,
  markAllAsRead,
  sendTypingIndicator
};
