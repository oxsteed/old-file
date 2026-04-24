const pool          = require('../db');
const socketService = require('../services/socketService');
const logger        = require('../utils/logger');
const { sanitizeMessage } = require('../utils/messageSanitizer');
const { sendNotification } = require('../services/notificationService');
const { uploadFile, getSignedDownloadUrl, getPublicUrl } = require('../utils/storage');

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
// Optional query params: ?business_id=<id> to filter by business, ?include_archived=true to show archived
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const filterBizId = req.query.business_id ? parseInt(req.query.business_id, 10) || null : null;
    const includeArchived = req.query.include_archived === 'true';

    const params = [userId];
    let bizFilter = '';
    if (filterBizId) {
      params.push(filterBizId);
      bizFilter = ` AND c.business_id = $${params.length}`;
    }

    // By default, exclude archived conversations; add filter to include them if requested
    const archivedFilter = includeArchived ? '' : ' AND c.archived_at IS NULL';

    const result = await pool.query(
      `SELECT c.id, c.job_id, c.customer_id, c.helper_id, c.business_id, c.status,
              c.archived_at, c.last_message_at, c.created_at, c.updated_at,
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
       ) AND c.status = 'active'${bizFilter}${archivedFilter}
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
    const jobIdParam = jobId || null;

    // Use a single consolidated query that handles all three cases with conditional WHERE
    const result = await pool.query(
      `SELECT * FROM conversations
       WHERE customer_id = $1 AND helper_id = $2
         AND (
           (job_id = $3)
           OR (job_id IS NULL AND business_id = $4)
           OR (job_id IS NULL AND business_id IS NULL AND $3 IS NULL AND $4 IS NULL)
         )`,
      [userId, helperId, jobIdParam, bizId]
    );

    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    }

    // Try to insert the conversation with the appropriate parameters
    const newConv = await pool.query(
      `INSERT INTO conversations (customer_id, helper_id, job_id, business_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [userId, helperId, jobIdParam, bizId]
    );

    if (newConv.rows.length) {
      return res.status(201).json(newConv.rows[0]);
    }

    // Concurrent insert: fetch the row that was inserted by another request
    const existing = await pool.query(
      `SELECT * FROM conversations
       WHERE customer_id = $1 AND helper_id = $2
         AND (
           (job_id = $3)
           OR (job_id IS NULL AND business_id = $4)
           OR (job_id IS NULL AND business_id IS NULL AND $3 IS NULL AND $4 IS NULL)
         )`,
      [userId, helperId, jobIdParam, bizId]
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
       WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
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

// Search messages in a conversation by keyword and/or sender
const searchMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const q = (req.query.q || '').trim().slice(0, 200);
    const sender = (req.query.sender || 'all').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    // Verify user is part of conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id FROM conversations c
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

    const { customer_id, helper_id } = conv.rows[0];

    // Build query based on filters
    let whereClause = `m.conversation_id = $1 AND m.deleted_at IS NULL`;
    const params = [conversationId];

    // Filter by keyword if provided
    if (q) {
      params.push(`%${q}%`);
      whereClause += ` AND m.content ILIKE $${params.length}`;
    }

    // Filter by sender if specified (me = current user, helper = the other helper/customer)
    if (sender === 'me') {
      params.push(userId);
      whereClause += ` AND m.sender_id = $${params.length}`;
    } else if (sender === 'helper') {
      const otherId = userId === customer_id ? helper_id : customer_id;
      params.push(otherId);
      whereClause += ` AND m.sender_id = $${params.length}`;
    }

    // Combine count + select into one query using a CTE (Common Table Expression)
    // This avoids two round-trips to the database for the same filtered data
    params.push(limit);
    params.push(offset);
    const result = await pool.query(
      `WITH filtered_messages AS (
         SELECT m.*, u.first_name || ' ' || u.last_name AS sender_name,
                COUNT(*) OVER() AS total
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.id
         WHERE ${whereClause}
       )
       SELECT * FROM filtered_messages
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total) : 0;

    res.json({
      results: result.rows,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    logger.error('Error searching messages', { err: error.message });
    res.status(500).json({ error: 'Failed to search messages' });
  }
};

// Send a message
const sendMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const rawContent = (req.body.content || '').trim();

    if (!rawContent) return res.status(400).json({ error: 'Message content is required' });
    if (rawContent.length > 4000) return res.status(400).json({ error: 'Message too long (max 4000 chars)' });

    // Sanitize message to prevent XSS
    const content = sanitizeMessage(rawContent);

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

    // Send notifications based on user preferences (async, non-blocking)
    setImmediate(async () => {
      try {
        const notifData = { conversationId, senderName };
        if (userId === customer_id) {
          // Customer sent — notify the helper/owner
          await sendNotification({
            userId: helper_id,
            type: 'new_message',
            title: 'New message from ' + senderName,
            body: content.length > 100 ? content.slice(0, 97) + '…' : content,
            data: notifData,
            action_url: `/messages/${conversationId}`,
          });
        } else if (userId === helper_id) {
          // Owner sent — notify the customer
          await sendNotification({
            userId: customer_id,
            type: 'new_message',
            title: 'New message from ' + senderName,
            body: content.length > 100 ? content.slice(0, 97) + '…' : content,
            data: notifData,
            action_url: `/messages/${conversationId}`,
          });
        } else {
          // Rep sent — notify the customer and owner
          await Promise.all([
            sendNotification({
              userId: customer_id,
              type: 'new_message',
              title: 'New message from ' + senderName,
              body: content.length > 100 ? content.slice(0, 97) + '…' : content,
              data: notifData,
              action_url: `/messages/${conversationId}`,
            }),
            sendNotification({
              userId: helper_id,
              type: 'new_message',
              title: 'New message from ' + senderName,
              body: content.length > 100 ? content.slice(0, 97) + '…' : content,
              data: notifData,
              action_url: `/messages/${conversationId}`,
            }),
          ]);
        }
        // Notify all other reps
        for (const repId of repIds) {
          if (repId !== userId && repId !== helper_id) {
            await sendNotification({
              userId: repId,
              type: 'new_message',
              title: 'New message from ' + senderName,
              body: content.length > 100 ? content.slice(0, 97) + '…' : content,
              data: notifData,
              action_url: `/messages/${conversationId}`,
            });
          }
        }
      } catch (err) {
        logger.error('Failed to send chat notifications', { err: err.message, conversationId });
      }
    });

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
      `SELECT m.id, m.sender_id, m.conversation_id, m.deleted_at
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

    if (message.deleted_at) {
      return res.status(400).json({ error: 'Message is already deleted' });
    }

    // Soft delete the message (set deleted_at timestamp)
    await pool.query(
      'UPDATE messages SET deleted_at = NOW() WHERE id = $1',
      [messageId]
    );

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
    const rawContent = (req.body.content || '').trim();

    if (!rawContent) return res.status(400).json({ error: 'Message content is required' });
    if (rawContent.length > 4000) return res.status(400).json({ error: 'Message too long (max 4000 chars)' });

    // Sanitize message content to prevent XSS
    const content = sanitizeMessage(rawContent);

    // Verify message exists and user is the sender
    const msgResult = await pool.query(
      `SELECT m.id, m.sender_id, m.conversation_id, m.deleted_at
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

    if (message.deleted_at) {
      return res.status(400).json({ error: 'Cannot edit a deleted message' });
    }

    // Update the message with edited_at timestamp
    const result = await pool.query(
      `UPDATE messages SET content = $1, edited_at = NOW() WHERE id = $2 RETURNING *`,
      [content, messageId]
    );

    const updatedMessage = result.rows[0];

    // Broadcast edit event to the conversation room
    socketService.broadcastToConversation(conversationId, 'message:edited', {
      conversationId,
      message: updatedMessage,
    });

    res.json(updatedMessage);
  } catch (error) {
    logger.error('Error editing message', { err: error.message });
    res.status(500).json({ error: 'Failed to edit message' });
  }
};

// Add a reaction to a message
const addReaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;
    const { reaction } = req.body;

    // Validate reaction type
    const validReactions = ['thumbs_up', 'heart', 'laugh', 'sad', 'angry', 'wow'];
    if (!reaction || !validReactions.includes(reaction)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }

    // Verify user is part of conversation
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

    // Verify message exists and belongs to this conversation
    const msg = await pool.query(
      `SELECT id FROM messages WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL`,
      [messageId, conversationId]
    );
    if (msg.rows.length === 0) return res.status(404).json({ error: 'Message not found' });

    // Insert or ignore if reaction already exists (upsert behavior)
    const result = await pool.query(
      `INSERT INTO message_reactions (message_id, user_id, reaction)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id, reaction) DO NOTHING
       RETURNING *`,
      [messageId, userId, reaction]
    );

    // Fetch all reactions for this message to broadcast the updated state
    const reactionsResult = await pool.query(
      `SELECT reaction, COUNT(*) as count, array_agg(user_id) as users
       FROM message_reactions
       WHERE message_id = $1
       GROUP BY reaction`,
      [messageId]
    );

    // Broadcast reaction update to all participants in the conversation
    socketService.broadcastToConversation(conversationId, 'message:reaction', {
      conversationId,
      messageId,
      reaction,
      userId,
      allReactions: reactionsResult.rows,
    });

    res.status(201).json({ reaction, allReactions: reactionsResult.rows });
  } catch (error) {
    logger.error('Error adding reaction', { err: error.message });
    res.status(500).json({ error: 'Failed to add reaction' });
  }
};

// Remove a reaction from a message
const removeReaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;
    const { reaction } = req.body;

    // Validate reaction type
    const validReactions = ['thumbs_up', 'heart', 'laugh', 'sad', 'angry', 'wow'];
    if (!reaction || !validReactions.includes(reaction)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }

    // Verify user is part of conversation
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

    // Remove the reaction
    const deleteResult = await pool.query(
      `DELETE FROM message_reactions
       WHERE message_id = $1 AND user_id = $2 AND reaction = $3
       RETURNING *`,
      [messageId, userId, reaction]
    );

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reaction not found' });
    }

    // Fetch updated reactions for this message
    const reactionsResult = await pool.query(
      `SELECT reaction, COUNT(*) as count, array_agg(user_id) as users
       FROM message_reactions
       WHERE message_id = $1
       GROUP BY reaction`,
      [messageId]
    );

    // Broadcast reaction update
    socketService.broadcastToConversation(conversationId, 'message:reaction_removed', {
      conversationId,
      messageId,
      reaction,
      userId,
      allReactions: reactionsResult.rows,
    });

    res.json({ reaction, allReactions: reactionsResult.rows });
  } catch (error) {
    logger.error('Error removing reaction', { err: error.message });
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
};

// Archive a conversation
const archiveConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { reason } = req.body;

    // Verify user is part of conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id FROM conversations c
       WHERE c.id = $1 AND (c.customer_id = $2 OR c.helper_id = $2)`,
      [conversationId, userId]
    );
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    // Archive the conversation
    const result = await pool.query(
      `UPDATE conversations
       SET archived_at = NOW()
       WHERE id = $1 AND archived_at IS NULL
       RETURNING *`,
      [conversationId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Conversation is already archived' });
    }

    // Log the archival event
    await pool.query(
      `INSERT INTO conversation_archive_log (conversation_id, user_id, action, reason)
       VALUES ($1, $2, 'archived', $3)`,
      [conversationId, userId, reason || null]
    );

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error archiving conversation', { err: error.message });
    res.status(500).json({ error: 'Failed to archive conversation' });
  }
};

// Restore an archived conversation
const restoreConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    // Verify user is part of conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id FROM conversations c
       WHERE c.id = $1 AND (c.customer_id = $2 OR c.helper_id = $2)`,
      [conversationId, userId]
    );
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    // Restore the conversation
    const result = await pool.query(
      `UPDATE conversations
       SET archived_at = NULL
       WHERE id = $1 AND archived_at IS NOT NULL
       RETURNING *`,
      [conversationId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Conversation is not archived' });
    }

    // Log the restoration event
    await pool.query(
      `INSERT INTO conversation_archive_log (conversation_id, user_id, action)
       VALUES ($1, $2, 'restored')`,
      [conversationId, userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error restoring conversation', { err: error.message });
    res.status(500).json({ error: 'Failed to restore conversation' });
  }
};

// Get archived conversations for the current user
const getArchivedConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const result = await pool.query(
      `SELECT c.id, c.job_id, c.customer_id, c.helper_id, c.business_id, c.status,
              c.archived_at, c.last_message_at,
              CASE
                WHEN c.customer_id = $1 THEN h.first_name || ' ' || h.last_name
                WHEN c.helper_id   = $1 THEN cu.first_name || ' ' || cu.last_name
                ELSE cu.first_name || ' ' || cu.last_name
              END AS other_user_name,
              j.title AS job_title
       FROM conversations c
       LEFT JOIN users h  ON c.helper_id   = h.id
       LEFT JOIN users cu ON c.customer_id = cu.id
       LEFT JOIN jobs j   ON c.job_id      = j.id
       WHERE (c.customer_id = $1 OR c.helper_id = $1)
         AND c.archived_at IS NOT NULL
       ORDER BY c.archived_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM conversations
       WHERE (customer_id = $1 OR helper_id = $1) AND archived_at IS NOT NULL`,
      [userId]
    );

    res.json({
      archived: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
      hasMore: offset + limit < parseInt(countResult.rows[0].count),
    });
  } catch (error) {
    logger.error('Error fetching archived conversations', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch archived conversations' });
  }
};

// Get all reactions for a message
const getMessageReactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;

    // Verify user is part of conversation
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

    // Fetch all reactions and details
    const result = await pool.query(
      `SELECT
         mr.reaction,
         COUNT(*) as count,
         array_agg(json_build_object('user_id', u.id, 'name', u.first_name || ' ' || u.last_name))
           FILTER (WHERE u.id IS NOT NULL) as users,
         BOOL_OR(mr.user_id = $2) as user_reacted
       FROM message_reactions mr
       LEFT JOIN users u ON mr.user_id = u.id
       WHERE mr.message_id = $1
       GROUP BY mr.reaction`,
      [messageId, userId]
    );

    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching reactions', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch reactions' });
  }
};

module.exports = {
  getConversations,
  getGuestInquiries,
  getGuestInquiryById,
  getOrCreateConversation,
  getConversationMeta,
  getMessages,
  searchMessages,
  sendMessage,
  deleteMessage,
  editMessage,
  addReaction,
  removeReaction,
  getMessageReactions,
  archiveConversation,
  restoreConversation,
  getArchivedConversations,
  uploadAttachment,
};

/**
 * POST /api/messages/conversations/:conversationId/attachments
 * Upload a file attachment for a conversation message.
 * Returns { url, key, name, size, mimeType } for the frontend to send as a message.
 * Images are returned as public S3 URLs; other files as signed 1-hour download URLs.
 */
async function uploadAttachment(req, res) {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    // Verify the user is a participant of this conversation
    const conv = await pool.query(
      `SELECT c.customer_id, c.helper_id, c.business_id
       FROM conversations c
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

    const { buffer, originalname, mimetype, size } = req.file;
    const key = await uploadFile(buffer, 'chat-attachments', originalname, mimetype);

    if (!key) {
      // S3 not configured — return a base64 data-URL fallback (dev only)
      const b64 = buffer.toString('base64');
      return res.json({
        url:      `data:${mimetype};base64,${b64}`,
        key:      null,
        name:     originalname,
        size,
        mimeType: mimetype,
      });
    }

    const isImage = mimetype.startsWith('image/');
    const url = isImage
      ? getPublicUrl(key)
      : await getSignedDownloadUrl(key, 3600);

    return res.json({ url, key, name: originalname, size, mimeType: mimetype });
  } catch (err) {
    logger.error('uploadAttachment error', { err: err.message });
    return res.status(500).json({ error: 'Upload failed' });
  }
}
