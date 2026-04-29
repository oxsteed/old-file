const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const { broadcastToConversation } = require('../services/socketService');
const logger = require('../utils/logger');

async function getMessages(req, res) {
  try {
    const { conversationId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const result = await query(
      `SELECT scm.*, u.name, u.avatar_url
       FROM support_conversation_messages scm
       LEFT JOIN users u ON scm.sender_id = u.id
       WHERE scm.conversation_id = $1
       ORDER BY scm.created_at DESC
       LIMIT $2 OFFSET $3`,
      [conversationId, parseInt(limit), parseInt(offset)]
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

    const result = await query(
      `UPDATE support_conversation_messages
       SET read_by_recipient = true, read_at = CURRENT_TIMESTAMP, status = 'read'
       WHERE id = $1 RETURNING *`,
      [messageId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Message not found');

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

    const msg = await query(
      'SELECT * FROM support_conversation_messages WHERE id = $1',
      [messageId]
    );

    if (!msg.rows.length) return sendError(res, 404, 'Message not found');

    await query(
      'DELETE FROM support_conversation_messages WHERE id = $1',
      [messageId]
    );

    await query(
      'UPDATE support_conversations SET message_count = message_count - 1 WHERE id = $1',
      [msg.rows[0].conversation_id]
    );

    broadcastToConversation(msg.rows[0].conversation_id, 'message_deleted', { messageId });

    res.json({ success: true, data: msg.rows[0] });
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

    const result = await query(
      `UPDATE support_conversation_messages
       SET content = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [content, messageId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Message not found');

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
    const { attachmentUrl, attachmentName } = req.body;

    if (!attachmentUrl) {
      return sendValidationError(res, { attachmentUrl: 'Required' });
    }

    const result = await query(
      `INSERT INTO support_conversation_messages
       (conversation_id, sender_id, message_type, content, attachment_url, attachment_name, is_agent)
       VALUES ($1, $2, 'attachment', $3, $4, $5, false)
       RETURNING *`,
      [conversationId, req.user.id, attachmentName || 'File', attachmentUrl, attachmentName || 'Attachment']
    );

    await query(
      'UPDATE support_conversations SET message_count = message_count + 1 WHERE id = $1',
      [conversationId]
    );

    broadcastToConversation(conversationId, 'attachment_uploaded', {
      messageId: result.rows[0].id,
      attachmentUrl,
      attachmentName
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

    await query(
      `UPDATE support_conversation_messages
       SET read_by_recipient = true, read_at = CURRENT_TIMESTAMP, status = 'read'
       WHERE conversation_id = $1 AND sender_id != $2`,
      [conversationId, req.user.id]
    );

    broadcastToConversation(conversationId, 'all_messages_read', {
      userId: req.user.id
    });

    res.json({ success: true, data: { status: 'all marked as read' } });
  } catch (err) {
    logger.error('markAllAsRead error', { error: err.message });
    sendError(res, 500, 'Failed to mark all as read');
  }
}

async function sendTypingIndicator(req, res) {
  try {
    const { conversationId } = req.params;

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
  getMessages, markAsRead, deleteMessage, editMessage, addAttachment,
  getUnreadCount, markAllAsRead, sendTypingIndicator
};
