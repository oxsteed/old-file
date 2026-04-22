const pool          = require('../db');
const socketService = require('../services/socketService');
const logger        = require('../utils/logger');

/**
 * Guest profile inquiries (visitors without accounts) — guest_profile_chat_inbound.
 */
function mapGuestInquiryRow(r) {
  return {
      id: `guest-${r.id}`,
      is_guest_inquiry: true,
      job_id: null,
      customer_id: null,
      helper_id: r.helper_id,
      business_id: r.business_id,
      status: 'active',
      last_message_at: r.created_at,
      created_at: r.created_at,
      updated_at: r.created_at,
      other_user_name: r.guest_name,
      other_user_id: null,
      job_title: null,
      last_message:
        r.message.length > 140 ? `${r.message.slice(0, 137)}…` : r.message,
      last_message_sender_id: null,
      helper_business_name: null,
      conversation_business_name: r.conversation_business_name,
      unread_count: 1,
      guest_email: r.guest_email,
      guest_message_full: r.message,
    };
}

const getGuestInquiries = async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    if (!['helper', 'helper_pro', 'broker'].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const filterBizId = req.query.business_id ? parseInt(req.query.business_id, 10) || null : null;

    let result;
    if (filterBizId) {
      result = await pool.query(
        `SELECT g.id, g.helper_id, g.business_id, g.guest_name, g.guest_email, g.message, g.created_at,
                cb.business_name AS conversation_business_name
         FROM guest_profile_chat_inbound g
         LEFT JOIN businesses cb ON cb.id = g.business_id AND cb.is_active = TRUE
         WHERE g.business_id = $1 AND (
           g.helper_id = $2 OR EXISTS (
             SELECT 1 FROM business_members bm
             WHERE bm.business_id = g.business_id AND bm.member_id = $2 AND bm.status = 'active'
           )
         )
         ORDER BY g.created_at DESC
         LIMIT 100`,
        [filterBizId, userId]
      );
    } else {
      result = await pool.query(
        `SELECT g.id, g.helper_id, g.business_id, g.guest_name, g.guest_email, g.message, g.created_at,
                cb.business_name AS conversation_business_name
         FROM guest_profile_chat_inbound g
         LEFT JOIN businesses cb ON cb.id = g.business_id AND cb.is_active = TRUE
         WHERE g.helper_id = $1
            OR (
              g.business_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM business_members bm
                WHERE bm.business_id = g.business_id AND bm.member_id = $1 AND bm.status = 'active'
              )
            )
         ORDER BY g.created_at DESC
         LIMIT 100`,
        [userId]
      );
    }

    const rows = result.rows.map(mapGuestInquiryRow);
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching guest inquiries', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch guest inquiries' });
  }
};

/**
 * GET /api/messages/guest-inquiries/:id — one guest inquiry (owner or active business rep).
 */
const getGuestInquiryById = async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    if (!['helper', 'helper_pro', 'broker'].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const inquiryId = req.params.id;
    if (!inquiryId || typeof inquiryId !== 'string') {
      return res.status(400).json({ error: 'Invalid inquiry id' });
    }

    const rowRes = await pool.query(
      `SELECT g.id, g.helper_id, g.business_id, g.guest_name, g.guest_email, g.message, g.created_at,
              cb.business_name AS conversation_business_name
       FROM guest_profile_chat_inbound g
       LEFT JOIN businesses cb ON cb.id = g.business_id AND cb.is_active = TRUE
       WHERE g.id = $1`,
      [inquiryId]
    );

    const r = rowRes.rows[0];
    if (!r) return res.status(404).json({ error: 'Not found' });

    let allowed = String(r.helper_id) === String(userId);
    if (!allowed && r.business_id != null) {
      const rep = await pool.query(
        `SELECT 1 FROM business_members bm
         WHERE bm.business_id = $1 AND bm.member_id = $2 AND bm.status = 'active'`,
        [r.business_id, userId]
      );
      allowed = rep.rows.length > 0;
    }

    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    res.json(mapGuestInquiryRow(r));
  } catch (error) {
    logger.error('Error fetching guest inquiry', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch guest inquiry' });
  }
};

// Get all conversations for the current user (including business rep access)
// Optional query params: ?business_id=<id> to filter by business
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const filterBizId = req.query.business_id ? parseInt(req.query.business_id, 10) || null : null;

    const params = [userId];
    let bizFilter = '';
    if (filterBizId) {
      params.push(filterBizId);
      bizFilter = ` AND c.business_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT c.id, c.job_id, c.customer_id, c.helper_id, c.business_id, c.status,
              c.last_message_at, c.created_at, c.updated_at,
              CASE
                WHEN c.customer_id = $1 THEN h.first_name || ' ' || h.last_name
                WHEN c.helper_id   = $1 THEN cu.first_name || ' ' || cu.last_name
                ELSE cu.first_name || ' ' || cu.last_name
              END AS other_user_name,
              CASE
                WHEN c.customer_id = $1 THEN c.helper_id
                WHEN c.helper_id   = $1 THEN c.customer_id
                ELSE c.customer_id
              END AS other_user_id,
              j.title AS job_title,
              lm.content AS last_message,
              lm.sender_id AS last_message_sender_id,
              -- helper's primary business name
              hb.business_name AS helper_business_name,
              -- business tied to this specific conversation (when business_id is set)
              cb.business_name AS conversation_business_name,
              uc.cnt AS unread_count
       FROM conversations c
       LEFT JOIN users h  ON c.helper_id   = h.id
       LEFT JOIN users cu ON c.customer_id = cu.id
       LEFT JOIN jobs j   ON c.job_id      = j.id
       LEFT JOIN businesses hb ON hb.user_id = c.helper_id AND hb.is_primary = TRUE AND hb.is_active = TRUE
       LEFT JOIN businesses cb ON cb.id = c.business_id AND cb.is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT content, sender_id
         FROM messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
       ) lm ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt
         FROM messages
         WHERE conversation_id = c.id AND sender_id != $1 AND is_read = FALSE
       ) uc ON TRUE
       WHERE (
         c.customer_id = $1
         OR c.helper_id = $1
         OR (c.business_id IS NOT NULL AND EXISTS(
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = c.business_id AND bm.member_id = $1 AND bm.status = 'active'
         ))
       ) AND c.status = 'active'${bizFilter}
       ORDER BY c.last_message_at DESC NULLS LAST`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching conversations', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
};

// Get or create a conversation
const getOrCreateConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { helperId, jobId, businessId } = req.body;

    if (!helperId) return res.status(400).json({ error: 'Helper ID is required' });

    // Validate that helperId is actually a helper account
    const helperCheck = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role IN ('helper', 'helper_pro', 'broker')`,
      [helperId]
    );
    if (helperCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid helper ID' });
    }

    // Prevent users from messaging themselves
    if (String(userId) === String(helperId)) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    const bizId = businessId ? parseInt(businessId, 10) || null : null;

    let result;
    if (jobId) {
      result = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND helper_id = $2 AND job_id = $3',
        [userId, helperId, jobId]
      );
    } else if (bizId) {
      result = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND helper_id = $2 AND job_id IS NULL AND business_id = $3',
        [userId, helperId, bizId]
      );
    } else {
      result = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND helper_id = $2 AND job_id IS NULL AND business_id IS NULL',
        [userId, helperId]
      );
    }

    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    }

    let newConv;
    if (jobId) {
      newConv = await pool.query(
        'INSERT INTO conversations (customer_id, helper_id, job_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *',
        [userId, helperId, jobId]
      );
    } else if (bizId) {
      newConv = await pool.query(
        'INSERT INTO conversations (customer_id, helper_id, business_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *',
        [userId, helperId, bizId]
      );
    } else {
      newConv = await pool.query(
        'INSERT INTO conversations (customer_id, helper_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
        [userId, helperId]
      );
    }

    if (newConv.rows.length) {
      return res.status(201).json(newConv.rows[0]);
    }
    // Concurrent insert: fetch the row that already exists
    const existing = await pool.query(
      jobId
        ? 'SELECT * FROM conversations WHERE customer_id = $1 AND helper_id = $2 AND job_id = $3'
        : bizId
        ? 'SELECT * FROM conversations WHERE customer_id = $1 AND helper_id = $2 AND job_id IS NULL AND business_id = $3'
        : 'SELECT * FROM conversations WHERE customer_id = $1 AND helper_id = $2 AND job_id IS NULL AND business_id IS NULL',
      jobId ? [userId, helperId, jobId] : bizId ? [userId, helperId, bizId] : [userId, helperId]
    );
    if (!existing.rows[0]) return res.status(500).json({ error: 'Failed to create conversation' });
    res.json(existing.rows[0]);
  } catch (error) {
    logger.error('Error creating conversation', { err: error.message });
    res.status(500).json({ error: 'Failed to create conversation' });
  }
};

// Get messages for a conversation
const getMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0,  0);

    // Verify user is part of conversation (direct participant or active business rep)
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id, c.business_id FROM conversations c
       WHERE c.id = $1 AND (
         c.customer_id = $2
         OR c.helper_id = $2
         OR (c.business_id IS NOT NULL AND EXISTS(
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = c.business_id AND bm.member_id = $2 AND bm.status = 'active'
         ))
       )`,
      [conversationId, userId]
    );
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    // Mark inbound messages as read, get count so we only emit when needed
    const readResult = await pool.query(
      `UPDATE messages
       SET is_read = TRUE, read_at = NOW()
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE
       RETURNING id`,
      [conversationId, userId]
    );

    // Notify the sender that their messages were seen
    if (readResult.rows.length > 0) {
      socketService.broadcastToConversation(conversationId, 'messages:read', {
        conversationId,
        readBy: userId,
        readAt: new Date().toISOString(),
      });
    }

    const result = await pool.query(
      `SELECT m.*, u.first_name || ' ' || u.last_name AS sender_name
       FROM messages m
       LEFT JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching messages', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

// Get metadata for a single conversation (name, business name, job title)
const getConversationMeta = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const result = await pool.query(
      `SELECT
         c.id, c.job_id, c.customer_id, c.helper_id, c.business_id, c.status,
         CASE
           WHEN c.customer_id = $2 THEN h.first_name || ' ' || h.last_name
           WHEN c.helper_id   = $2 THEN cu.first_name || ' ' || cu.last_name
           ELSE cu.first_name || ' ' || cu.last_name
         END AS other_user_name,
         CASE
           WHEN c.customer_id = $2 THEN c.helper_id
           WHEN c.helper_id   = $2 THEN c.customer_id
           ELSE c.customer_id
         END AS other_user_id,
         j.title AS job_title,
         hb.business_name AS helper_business_name,
         cb.business_name AS conversation_business_name
       FROM conversations c
       LEFT JOIN users h  ON c.helper_id   = h.id
       LEFT JOIN users cu ON c.customer_id = cu.id
       LEFT JOIN jobs j   ON c.job_id      = j.id
       LEFT JOIN businesses hb ON hb.user_id = c.helper_id AND hb.is_primary = TRUE AND hb.is_active = TRUE
       LEFT JOIN businesses cb ON cb.id = c.business_id AND cb.is_active = TRUE
       WHERE c.id = $1 AND (
         c.customer_id = $2
         OR c.helper_id = $2
         OR (c.business_id IS NOT NULL AND EXISTS(
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = c.business_id AND bm.member_id = $2 AND bm.status = 'active'
         ))
       )`,
      [conversationId, userId]
    );

    if (result.rows.length === 0) return res.status(403).json({ error: 'Access denied' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error fetching conversation meta', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
};

// Send a message
const sendMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const content = (req.body.content || '').trim();

    if (!content) return res.status(400).json({ error: 'Message content is required' });
    if (content.length > 4000) return res.status(400).json({ error: 'Message too long (max 4000 chars)' });

    // Verify user is part of conversation (direct participant or active business rep)
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id, c.business_id, b.business_name
       FROM conversations c
       LEFT JOIN businesses b ON b.id = c.business_id AND b.is_active = TRUE
       WHERE c.id = $1 AND (
         c.customer_id = $2
         OR c.helper_id = $2
         OR (c.business_id IS NOT NULL AND EXISTS(
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = c.business_id AND bm.member_id = $2 AND bm.status = 'active'
         ))
       )`,
      [conversationId, userId]
    );
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    const result = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *',
      [conversationId, userId, content]
    );

    // Update conversation last_message_at
    await pool.query(
      'UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [conversationId]
    );

    // When messaging in a business-context conversation, the sender appears as the business
    // (applies to the owner AND any active representatives)
    const { business_id, business_name } = conv.rows[0];
    const senderName = (business_id && business_name)
      ? business_name
      : `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim();
    const messagePayload = { ...result.rows[0], sender_name: senderName };

    // Broadcast to the conversation room — both participants see it in real-time
    // if they currently have the thread open.
    socketService.broadcastToConversation(conversationId, 'message:new', {
      conversationId,
      message: messagePayload,
    });

    // Notify the appropriate recipient(s) via their personal room so inbox pages
    // update even when they're not currently in the conversation thread.
    const { customer_id, helper_id } = conv.rows[0];

    // Collect all active rep IDs for this business conversation
    let repIds = [];
    if (business_id) {
      const repsRes = await pool.query(
        `SELECT member_id FROM business_members
         WHERE business_id = $1 AND status = 'active'`,
        [business_id]
      );
      repIds = repsRes.rows.map(r => r.member_id).filter(id => id !== userId);
    }

    if (userId === customer_id) {
      // Customer sent — notify the helper/owner
      socketService.broadcastToUser(helper_id, 'message:new', { conversationId, message: messagePayload });
    } else if (userId === helper_id) {
      // Owner sent — notify the customer
      socketService.broadcastToUser(customer_id, 'message:new', { conversationId, message: messagePayload });
    } else {
      // Rep sent — notify the customer; also ping the owner so they see it in their inbox
      socketService.broadcastToUser(customer_id, 'message:new', { conversationId, message: messagePayload });
      socketService.broadcastToUser(helper_id, 'message:new', { conversationId, message: messagePayload });
    }

    // Notify all other active reps so their inbox refreshes in real time
    for (const repId of repIds) {
      if (repId !== helper_id) { // owner already notified above
        socketService.broadcastToUser(repId, 'message:new', { conversationId, message: messagePayload });
      }
    }

    res.status(201).json(messagePayload);
  } catch (error) {
    logger.error('Error sending message', { err: error.message });
    res.status(500).json({ error: 'Failed to send message' });
  }
};

// Delete a message (only the sender can delete)
const deleteMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;

    // Verify message exists and user is the sender
    const msgResult = await pool.query(
      `SELECT m.id, m.sender_id, m.conversation_id
       FROM messages m
       WHERE m.id = $1 AND m.conversation_id = $2`,
      [messageId, conversationId]
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = msgResult.rows[0];
    if (message.sender_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    // Delete the message
    await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);

    // Broadcast delete event to the conversation room
    socketService.broadcastToConversation(conversationId, 'message:deleted', {
      conversationId,
      messageId,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting message', { err: error.message });
    res.status(500).json({ error: 'Failed to delete message' });
  }
};

// Edit a message (only the sender can edit)
const editMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;
    const content = (req.body.content || '').trim();

    if (!content) return res.status(400).json({ error: 'Message content is required' });
    if (content.length > 4000) return res.status(400).json({ error: 'Message too long (max 4000 chars)' });

    // Verify message exists and user is the sender
    const msgResult = await pool.query(
      `SELECT m.id, m.sender_id, m.conversation_id
       FROM messages m
       WHERE m.id = $1 AND m.conversation_id = $2`,
      [messageId, conversationId]
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = msgResult.rows[0];
    if (message.sender_id !== userId) {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }

    // Update the message
    const result = await pool.query(
      `UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [content, messageId]
    );

    const updatedMessage = result.rows[0];

    // Broadcast edit event to the conversation room
    socketService.broadcastToConversation(conversationId, 'message:updated', {
      conversationId,
      message: updatedMessage,
    });

    res.json(updatedMessage);
  } catch (error) {
    logger.error('Error editing message', { err: error.message });
    res.status(500).json({ error: 'Failed to edit message' });
  }
};

module.exports = {
  getConversations,
  getGuestInquiries,
  getGuestInquiryById,
  getOrCreateConversation,
  getConversationMeta,
  getMessages,
  sendMessage,
  deleteMessage,
  editMessage,
};
