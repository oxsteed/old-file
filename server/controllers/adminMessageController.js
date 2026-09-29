/**
 * Admin Messaging Controller
 *
 * Handles the full admin→user and user→admin messaging flow.
 * Separate from the regular message controller so admin conversations are
 * clearly scoped and audited.
 *
 * Routes (all require requireAdmin):
 *   GET  /api/admin/messages/conversations
 *   GET  /api/admin/messages/conversations/:userId
 *   POST /api/admin/messages/conversations/:userId/send
 */

const db             = require('../db');
const logger         = require('../utils/logger');
const socketService  = require('../services/socketService');
const { logAdminAction } = require('../services/auditService');
const { sanitizeMessage } = require('../utils/messageSanitizer');
const { enqueueMessageNotification } = require('../services/messageNotificationService');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getClientMessageId(req) {
  return req.get?.('Idempotency-Key')
    || req.body?.clientMessageId
    || req.body?.client_message_id
    || null;
}

/**
 * GET /api/admin/messages/conversations
 * Returns all conversations that have at least one admin participant.
 * Super-admins see all; regular admins see only their own.
 */
exports.listConversations = async (req, res) => {
  try {
    const adminId  = req.user.id;
    const isSuper  = req.user.role === 'super_admin';
    const { limit = 50, offset = 0 } = req.query;
    const limitN  = Math.min(Math.max(1, parseInt(limit, 10)  || 50), 200);
    const offsetN = Math.min(1_000_000, Math.max(0, parseInt(offset, 10) || 0));
    const q = String(req.query.q || '').trim().slice(0, 120);

    const rows = await db.query(
      `SELECT
         c.id,
         c.status,
         c.last_message_at,
         c.created_at,
         -- The non-admin participant
         u.id          AS user_id,
         u.first_name  AS user_first_name,
         u.last_name   AS user_last_name,
         u.email       AS user_email,
         u.role        AS user_role,
         -- Admin participant
         a.id          AS admin_id,
         a.first_name  AS admin_first_name,
         a.last_name   AS admin_last_name,
         -- Last message preview
         (SELECT content FROM messages
          WHERE conversation_id = c.id
          ORDER BY created_at DESC LIMIT 1) AS last_message,
         -- Unread count (messages not from the current admin)
         (SELECT COUNT(*) FROM messages
          WHERE conversation_id = c.id
            AND sender_id != $1
            AND is_read = FALSE)::int AS unread_count
       FROM conversations c
       -- admin is always stored as customer_id
       JOIN users a ON a.id = c.customer_id AND a.role IN ('admin','super_admin')
       -- non-admin user is helper_id
       JOIN users u ON u.id = c.helper_id  AND u.role NOT IN ('admin','super_admin')
       WHERE c.job_id IS NULL
         AND ($2 OR c.customer_id = $1)
         AND ($3 = '' OR u.first_name ILIKE $4 OR u.last_name ILIKE $4 OR u.email ILIKE $4)
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT $5 OFFSET $6`,
      [adminId, isSuper, q, `%${q}%`, limitN, offsetN]
    );

    const total = await db.query(
      `SELECT COUNT(*) FROM conversations c
       JOIN users a ON a.id = c.customer_id AND a.role IN ('admin','super_admin')
       JOIN users u ON u.id = c.helper_id  AND u.role NOT IN ('admin','super_admin')
       WHERE c.job_id IS NULL
         AND ($1 OR c.customer_id = $2)
         AND ($3 = '' OR u.first_name ILIKE $4 OR u.last_name ILIKE $4 OR u.email ILIKE $4)`,
      [isSuper, adminId, q, `%${q}%`]
    );

    res.json({
      conversations: rows.rows,
      total:         parseInt(total.rows[0].count),
      limit:         limitN,
      offset:        offsetN,
    });
  } catch (err) {
    logger.error('adminMessages.listConversations error', { err: err.message });
    res.status(500).json({ error: 'Failed to load conversations.' });
  }
};

/**
 * GET /api/admin/messages/conversations/:userId
 * Returns the full message thread between the current admin and a specific user.
 * Creates the conversation if it doesn't exist yet.
 */
exports.getThread = async (req, res) => {
  try {
    const adminId  = req.user.id;
    const { userId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const limitN  = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const offsetN = Math.min(1_000_000, Math.max(0, parseInt(offset, 10) || 0));

    // Verify target user (must not be soft-deleted — reinstate first if scheduled for deletion)
    const { rows: targetRows } = await db.query(
      `SELECT id, first_name, last_name, email, role FROM users
       WHERE id::text = $1 AND deleted_at IS NULL`,
      [String(userId)]
    );
    if (!targetRows.length) return res.status(404).json({ error: 'User not found.' });

    // Find conversation (admin is customer_id, user is helper_id, job_id IS NULL)
    const { rows: convRows } = await db.query(
      `SELECT id FROM conversations
       WHERE job_id IS NULL AND customer_id = $1 AND helper_id = $2
       LIMIT 1`,
      [adminId, userId]
    );

    if (!convRows.length) {
      // No conversation yet - return empty thread with user info
      return res.json({
        conversation_id: null,
        user:            targetRows[0],
        messages:        [],
        total:           0,
      });
    }

    const conversationId = convRows[0].id;

    // Mark unread messages as read
    await db.query(
      `UPDATE messages SET is_read = TRUE, updated_at = NOW()
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE`,
      [conversationId, adminId]
    );

    const { rows: msgs } = await db.query(
      `SELECT m.id, m.sender_id, m.content, m.message_type, m.is_read,
              m.created_at, m.updated_at,
              u.first_name AS sender_first_name, u.last_name AS sender_last_name,
              u.role AS sender_role
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC
       LIMIT $2 OFFSET $3`,
      [conversationId, limitN, offsetN]
    );

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM messages WHERE conversation_id = $1`,
      [conversationId]
    );

    res.json({
      conversation_id: conversationId,
      user:            targetRows[0],
      messages:        msgs,
      total:           parseInt(countRows[0].count),
    });
  } catch (err) {
    logger.error('adminMessages.getThread error', { err: err.message });
    res.status(500).json({ error: 'Failed to load thread.' });
  }
};

/**
 * POST /api/admin/messages/conversations/:userId/send
 * Send a message from an admin to a user.
 * Also emits `admin:message` socket event to the target user.
 */
exports.send = async (req, res) => {
  try {
    const adminId  = req.user.id;
    const { userId } = req.params;
    const rawContent = (req.body.content || '').trim();
    const clientMessageId = getClientMessageId(req);

    if (!rawContent) return res.status(400).json({ error: 'Message content is required.' });
    if (rawContent.length > 4000) return res.status(400).json({ error: 'Message must be 4000 characters or fewer.' });
    if (clientMessageId && !UUID_RE.test(String(clientMessageId).trim())) {
      return res.status(400).json({ error: 'clientMessageId must be a valid UUID' });
    }

    const content = sanitizeMessage(rawContent);

    // Verify target user (must not be soft-deleted)
    const { rows: targetRows } = await db.query(
      `SELECT id, first_name, last_name, email, role FROM users
       WHERE id::text = $1 AND deleted_at IS NULL`,
      [String(userId)]
    );
    if (!targetRows.length) return res.status(404).json({ error: 'User not found.' });
    if (['admin', 'super_admin'].includes(targetRows[0].role)) {
      return res.status(400).json({ error: 'Cannot send messages to admin accounts.' });
    }

    const client = await db.connect();
    let conversationId, msgRow, replayed = false;
    try {
      await client.query('BEGIN');

      // Find-or-create admin conversation (SELECT FOR UPDATE to prevent duplicates)
      const { rows: existing } = await client.query(
        `SELECT id FROM conversations
         WHERE job_id IS NULL AND customer_id = $1 AND helper_id = $2
         LIMIT 1 FOR UPDATE`,
        [adminId, userId]
      );

      if (existing.length) {
        conversationId = existing[0].id;
      } else {
        const { rows: newConv } = await client.query(
          `INSERT INTO conversations (customer_id, helper_id, job_id, status)
           VALUES ($1, $2, NULL, 'active')
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [adminId, userId]
        );
        conversationId = newConv[0]?.id;
        if (!conversationId) {
          const { rows: raced } = await client.query(
            `SELECT id FROM conversations
             WHERE job_id IS NULL AND customer_id = $1 AND helper_id = $2
             LIMIT 1 FOR UPDATE`,
            [adminId, userId]
          );
          conversationId = raced[0]?.id;
        }
      }

      if (!conversationId) throw new Error('Failed to resolve admin conversation');

      const { rows: inserted } = await client.query(
        `INSERT INTO messages (conversation_id, sender_id, content, message_type, client_message_id)
         VALUES ($1, $2, $3, 'system', $4)
         ON CONFLICT (conversation_id, client_message_id)
         WHERE client_message_id IS NOT NULL DO NOTHING
         RETURNING id, created_at`,
        [conversationId, adminId, content, clientMessageId]
      );
      msgRow = inserted[0];
      replayed = !msgRow && Boolean(clientMessageId);
      if (!msgRow && clientMessageId) {
        const { rows: existingMessage } = await client.query(
          `SELECT id, created_at FROM messages
           WHERE conversation_id = $1 AND client_message_id = $2`,
          [conversationId, clientMessageId]
        );
        msgRow = existingMessage[0];
      }
      if (!msgRow) throw new Error('Message insert did not return a row');

      if (!replayed) {
        await client.query(
          `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [conversationId]
        );
        await enqueueMessageNotification({
          dbClient: client,
          messageId: msgRow.id,
          conversationId,
          recipientId: userId,
          senderName: 'OxSteed Admin',
          body: content,
          actionUrl: `/messages/${conversationId}`,
        });
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const messagePayload = {
      id:              msgRow.id,
      conversation_id: conversationId,
      sender_id:       adminId,
      content,
      message_type:    'system',
      is_read:         false,
      created_at:      msgRow.created_at,
      sender_first_name: req.user.first_name,
      sender_last_name:  req.user.last_name,
      sender_role:       req.user.role,
    };

    if (!replayed) {
      // Standard inbox event (user's MessagesPage picks this up)
      socketService.broadcastToUser(userId, 'message:new', {
        conversationId,
        message: { ...messagePayload, sender_name: 'OxSteed Admin' },
      });

      // Dedicated admin:message event so user can show a distinct notification
      socketService.broadcastToUser(userId, 'admin:message', {
        conversationId,
        message: messagePayload,
        admin: {
          id:         adminId,
          first_name: req.user.first_name,
          last_name:  req.user.last_name,
          role:       req.user.role,
        },
      });

      await logAdminAction({
        adminId,
        action:      'admin_message_sent',
        targetType:  'user',
        targetId:    userId,
        description: `Admin message sent to ${targetRows[0].email}`,
        after: {
          conversation_id: conversationId,
          message_id:      msgRow.id,
          preview:         content.slice(0, 100),
        },
        req,
      });
    }

    res.status(replayed ? 200 : 201).json({
      conversation_id: conversationId,
      message_id:      msgRow.id,
      created_at:      msgRow.created_at,
      ...(replayed ? { idempotent: true } : {}),
    });
  } catch (err) {
    logger.error('adminMessages.send error', { err: err.message });
    res.status(500).json({ error: 'Failed to send message.' });
  }
};
