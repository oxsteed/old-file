const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const { enqueueMessageNotification, enqueueConversationMessageNotifications } = require('../services/messageNotificationService');
const { withTransaction } = require('../utils/transaction');

function getClientRequestId(req) {
  const value = req.get?.('Idempotency-Key')
    || req.body?.clientRequestId
    || req.body?.client_request_id
    || null;
  if (!value) return null;
  const id = String(value).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : false;
}

/**
 * Check if any admins are online via Socket.IO
 */
async function getOnlineAdminCount() {
  const adminSocketCount = await socketService.getSocketCount('admins');
  return adminSocketCount > 0 ? adminSocketCount : 0;
}

/**
 * POST /api/support-chat/initiate
 *
 * Initiates a support chat session. Routes to live admin if admins are online,
 * otherwise creates a support ticket and returns escalation info.
 */
async function initiateSupportChat(req, res) {
  try {
    const { message, visitorName, visitorEmail } = req.body;
    const userId = req.user?.id; // Null for guests
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      return res.status(400).json({ error: 'clientRequestId must be a valid UUID', code: 'validation_failed' });
    }
    
    // Validate input
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (!visitorName || !visitorName.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!visitorEmail || !visitorEmail.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const adminCount = await getOnlineAdminCount();

    // The legacy live-chat tables require an authenticated customer_id and
    // sender_id. Guests use the verified support escalation flow instead of
    // reaching a guaranteed database failure.
    if (!userId) {
      return handleTicketEscalation(req, res, visitorName, visitorEmail, message, null, clientRequestId);
    }
    
    if (adminCount > 0) {
      // Route to live admin support
      return handleLiveAdminChat(req, res, userId, visitorName, visitorEmail, message, clientRequestId);
    } else {
      // No admins online - escalate to support ticket
      return handleTicketEscalation(req, res, visitorName, visitorEmail, message, userId, clientRequestId);
    }
  } catch (err) {
    logger.error('initiateSupport Chat error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to initiate support chat' });
  }
}

/**
 * Handle live chat with admin
 */
async function handleLiveAdminChat(req, res, userId, visitorName, visitorEmail, message, clientRequestId = null) {
  try {
    // Find an admin to assign as "helper" for this support conversation
    // Prefer super_admin, then regular admin
    const { rows: [admin] } = await pool.query(
      `SELECT u.id FROM users u
       WHERE u.role IN ('super_admin', 'admin')
       AND u.is_active = TRUE
       AND u.deleted_at IS NULL
       ORDER BY u.role = 'super_admin' DESC
       LIMIT 1`
    );

    if (!admin) {
      // No active admin found, escalate to ticket
      return handleTicketEscalation(req, res, visitorName, visitorEmail, message, userId, clientRequestId);
    }

    let conversationId = null;
    let replayed = false;
    if (clientRequestId) {
      const { rows: existing } = await pool.query(
        `SELECT id FROM conversations
          WHERE customer_id = $1 AND support_client_request_id = $2
          LIMIT 1`,
        [userId, clientRequestId],
      );
      conversationId = existing[0]?.id || null;
      replayed = Boolean(conversationId);
    }

    // Create a support conversation
    // For support chats, customer_id is the visitor and helper_id is the admin
    if (!conversationId) {
      const { rows } = await pool.query(
        `INSERT INTO conversations (
          customer_id, helper_id, job_id, status, created_at, last_message_at, support_client_request_id
        ) VALUES ($1, $2, NULL, $3, NOW(), NOW(), $4)
        ON CONFLICT (customer_id, support_client_request_id)
        WHERE support_client_request_id IS NOT NULL DO NOTHING
        RETURNING id`,
        [userId || null, admin.id, 'active', clientRequestId]
      );
      conversationId = rows[0]?.id || null;
      if (!conversationId && clientRequestId) {
        const { rows: replay } = await pool.query(
          `SELECT id FROM conversations
            WHERE customer_id = $1 AND support_client_request_id = $2
            LIMIT 1`,
          [userId, clientRequestId],
        );
        conversationId = replay[0]?.id || null;
        replayed = Boolean(conversationId);
      }
    }
    if (!conversationId) throw new Error('Failed to create support conversation');

    // Insert the message and durable notification intent atomically. The
    // realtime broadcast remains a post-commit side effect.
    const transactionResult = await withTransaction(pool, async (client) => {
      const { rows: messageRows } = await client.query(
        `INSERT INTO messages (
          conversation_id, sender_id, content, client_message_id
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (conversation_id, client_message_id)
        WHERE client_message_id IS NOT NULL DO NOTHING
        RETURNING id`,
        [conversationId, userId, message, clientRequestId]
      );
      let messageId = messageRows[0]?.id || null;
      const wasReplayed = !messageId && Boolean(clientRequestId);
      if (wasReplayed) {
        const { rows: existingMessage } = await client.query(
          `SELECT id FROM messages
             WHERE conversation_id = $1 AND client_message_id = $2
             LIMIT 1`,
          [conversationId, clientRequestId]
        );
        messageId = existingMessage[0]?.id || null;
      }
      if (!messageId) throw new Error('Failed to create support message');
      if (!wasReplayed) {
        await client.query(
          `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [conversationId]
        );
        await enqueueMessageNotification({
          dbClient: client,
          messageId,
          conversationId,
          recipientId: admin.id,
          senderName: visitorName || 'OxSteed customer',
          body: message,
          actionUrl: `/messages/${conversationId}`,
        });
      }
      return { messageId, wasReplayed };
    }, 'support_live_message');
    replayed = transactionResult.wasReplayed;

    // Notify all online admins about new support chat
    if (!replayed) {
      socketService.broadcastToAdmins('support:new_chat', {
        conversationId,
        visitorName,
        visitorEmail,
        message,
        userId,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(replayed ? 200 : 201).json({
      success: true,
      routedTo: 'live_admin',
      conversationId,
      message: 'Connected with support team',
      timestamp: new Date().toISOString(),
      idempotent: replayed,
    });
  } catch (err) {
    logger.error('handleLiveAdminChat error', { message: err.message });
    // Fall back to ticket escalation if chat creation fails
    handleTicketEscalation(req, res, visitorName, visitorEmail, message, userId, clientRequestId);
  }
}

/**
 * Handle support ticket escalation
 */
async function handleTicketEscalation(
  req,
  res,
  visitorName,
  visitorEmail,
  message,
  userId = null,
  clientRequestId = null,
) {
  try {
    let ticket = null;
    let replayed = false;
    if (clientRequestId) {
      const { rows } = await pool.query(
        'SELECT id, ticket_number FROM support_tickets WHERE client_request_id = $1 LIMIT 1',
        [clientRequestId],
      );
      ticket = rows[0] || null;
      replayed = Boolean(ticket);
    }
    if (!ticket) {
      const { rows } = await pool.query(
        `INSERT INTO support_tickets (
          user_id, name, email, subject, category, status, priority, source, client_request_id
        ) VALUES ($1, $2, $3, 'Support request', 'general', 'open', 'normal', 'widget', $4)
        ON CONFLICT (client_request_id)
        WHERE client_request_id IS NOT NULL DO NOTHING
        RETURNING id, ticket_number`,
        [userId, visitorName, visitorEmail, clientRequestId]
      );
      ticket = rows[0] || null;
      if (!ticket && clientRequestId) {
        const { rows: replay } = await pool.query(
          'SELECT id, ticket_number FROM support_tickets WHERE client_request_id = $1 LIMIT 1',
          [clientRequestId],
        );
        ticket = replay[0] || null;
        replayed = Boolean(ticket);
      }
    }
    if (!ticket) throw new Error('Failed to create support ticket');

    // Insert initial ticket message
    const { rows: messageRows } = await pool.query(
      `INSERT INTO support_messages (
        ticket_id, sender_id, sender_name, sender_email, content, is_internal, is_from_admin, client_message_id
      ) VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $6)
      ON CONFLICT (ticket_id, client_message_id)
      WHERE client_message_id IS NOT NULL DO NOTHING
      RETURNING id`,
      [ticket.id, userId, visitorName, visitorEmail, message, clientRequestId]
    );
    if (!messageRows.length && clientRequestId) replayed = true;

    // Send email notification to support inbox + every admin/super_admin.
    if (!replayed) {
      try {
        const emailService = require('../utils/email');
        await emailService.sendEmail({
          to: 'support@oxsteed.com',
          subject: `New Support Request from ${visitorName}`,
          text: `Name: ${visitorName}\nEmail: ${visitorEmail}\nMessage: ${message}`,
        });

        const { rows: admins } = await pool.query(
          `SELECT email, first_name FROM users WHERE role IN ('admin', 'super_admin') AND email IS NOT NULL`
        );
        await Promise.all(admins.map((admin) =>
          emailService.sendEmail({
            to: admin.email,
            subject: `[Ticket #${ticket.ticket_number}] New support ticket opened`,
            text: `Hi ${admin.first_name || 'there'},\n\nA new support ticket has been opened via chat escalation.\n\nTicket number: #${ticket.ticket_number}\nVisitor: ${visitorName} (${visitorEmail})\nMessage: ${message}\n\nView in Admin Dashboard: https://app.oxsteed.com/admin/support`,
          }).catch((err) => { logger.warn('Failed to email admin about new ticket', { message: err.message, admin: admin.email }); })
        ));
      } catch (emailErr) {
        logger.warn('Failed to send support ticket email notification', { message: emailErr.message });
      }
    }

    res.status(replayed ? 200 : 201).json({
      success: true,
      routedTo: 'support_ticket',
      ticketNumber: ticket.ticket_number,
      message: 'Your request has been recorded. We\'ll get back to you soon.',
      timestamp: new Date().toISOString(),
      idempotent: replayed,
    });
  } catch (err) {
    logger.error('handleTicketEscalation error', { message: err.message });
    res.status(500).json({ error: 'Failed to create support request' });
  }
}

/**
 * POST /api/support-chat/messages
 *
 * Send a message in support chat (guest or authenticated user)
 */
async function sendSupportMessage(req, res) {
  try {
    const { conversationId, message } = req.body;
    const userId = req.user?.id;
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      return res.status(400).json({ error: 'clientRequestId must be a valid UUID', code: 'validation_failed' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Sign in to continue a live support chat' });
    }

    if (!conversationId || !message || !message.trim()) {
      return res.status(400).json({ error: 'Conversation ID and message are required' });
    }

    // Verify user has access to this conversation (customer, helper, or admin)
    const { rows: [conv] } = await pool.query(
      `SELECT id, customer_id, helper_id, status FROM conversations
       WHERE id = $1 AND (customer_id = $2 OR helper_id = $2)`,
      [conversationId, userId]
    );

    if (!conv) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { msg, replayed } = await withTransaction(pool, async (client) => {
      const { rows: inserted } = await client.query(
        `INSERT INTO messages (
          conversation_id, sender_id, content, client_message_id
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (conversation_id, client_message_id)
        WHERE client_message_id IS NOT NULL DO NOTHING
        RETURNING id, content, created_at`,
        [conversationId, userId, message, clientRequestId]
      );
      let msg = inserted[0] || null;
      const replayed = !msg && Boolean(clientRequestId);
      if (!msg && clientRequestId) {
        const { rows: existing } = await client.query(
          `SELECT id, content, created_at FROM messages
            WHERE conversation_id = $1 AND client_message_id = $2`,
          [conversationId, clientRequestId],
        );
        msg = existing[0] || null;
      }
      if (!msg) throw new Error('Failed to send message');
      if (!replayed) {
        await client.query(
          `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [conversationId]
        );
        await enqueueConversationMessageNotifications({
          dbClient: client,
          messageId: msg.id,
          conversationId,
          recipientIds: [conv.customer_id, conv.helper_id],
          senderId: userId,
          senderName: 'OxSteed customer',
          body: message,
          actionUrl: `/messages/${conversationId}`,
        });
      }
      return { msg, replayed };
    }, 'support_followup_message');

    if (!msg) return res.status(500).json({ error: 'Failed to send message' });

    if (!replayed) {

      // Emit via Socket.IO to both participants.
      socketService.broadcastToConversation(conversationId, 'message:new', {
        conversationId,
        messageId: msg.id,
        senderId: userId,
        content: message,
        timestamp: msg.created_at,
      });
    }

    res.status(replayed ? 200 : 201).json({
      success: true,
      messageId: msg.id,
      timestamp: msg.created_at,
      idempotent: replayed,
    });
  } catch (err) {
    logger.error('sendSupportMessage error', { message: err.message });
    res.status(500).json({ error: 'Failed to send message' });
  }
}

/**
 * GET /api/support-chat/admin-status
 * 
 * Check if admins are currently online
 */
async function getAdminStatus(req, res) {
  try {
    const onlineCount = await getOnlineAdminCount();
    res.json({
      adminsOnline: onlineCount > 0,
      onlineCount,
      estimatedWaitTime: onlineCount > 0 ? '< 2 minutes' : null,
    });
  } catch (err) {
    logger.error('getAdminStatus error', { message: err.message });
    res.status(500).json({ error: 'Failed to get admin status' });
  }
}

module.exports = {
  initiateSupportChat,
  sendSupportMessage,
  getAdminStatus,
};
