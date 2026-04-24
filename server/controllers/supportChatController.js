const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');

/**
 * Check if any admins are online via Socket.IO
 */
function getOnlineAdminCount() {
  const adminSocketCount = socketService.getSocketCount('admins');
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

    const adminCount = getOnlineAdminCount();
    
    if (adminCount > 0) {
      // Route to live admin support
      return handleLiveAdminChat(req, res, userId, visitorName, visitorEmail, message);
    } else {
      // No admins online - escalate to support ticket
      return handleTicketEscalation(req, res, visitorName, visitorEmail, message);
    }
  } catch (err) {
    logger.error('initiateSupport Chat error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to initiate support chat' });
  }
}

/**
 * Handle live chat with admin
 */
async function handleLiveAdminChat(req, res, userId, visitorName, visitorEmail, message) {
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
      return handleTicketEscalation(req, res, visitorName, visitorEmail, message);
    }

    // Create a support conversation
    // For support chats, customer_id is the visitor and helper_id is the admin
    const { rows: [conv] } = await pool.query(
      `INSERT INTO conversations (
        customer_id, helper_id, job_id, status, created_at, last_message_at
      ) VALUES ($1, $2, NULL, $3, NOW(), NOW())
      RETURNING id`,
      [userId || null, admin.id, 'active']
    );

    // Insert the initial message
    await pool.query(
      `INSERT INTO messages (
        conversation_id, sender_id, sender_name, content, created_at
      ) VALUES ($1, $2, $3, $4, NOW())`,
      [conv.id, userId || null, visitorName, message]
    );

    // Notify all online admins about new support chat
    socketService.broadcastToAdmins('support:new_chat', {
      conversationId: conv.id,
      visitorName,
      visitorEmail,
      message,
      userId,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      routedTo: 'live_admin',
      conversationId: conv.id,
      message: 'Connected with support team',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('handleLiveAdminChat error', { message: err.message });
    // Fall back to ticket escalation if chat creation fails
    handleTicketEscalation(req, res, visitorName, visitorEmail, message);
  }
}

/**
 * Handle support ticket escalation
 */
async function handleTicketEscalation(req, res, visitorName, visitorEmail, message) {
  try {
    // Create support ticket
    const { rows: [ticket] } = await pool.query(
      `INSERT INTO support_tickets (
        status, priority, created_at, source, visitor_name, visitor_email
      ) VALUES ('open', 'medium', NOW(), 'chat_widget', $1, $2)
      RETURNING id, ticket_number`,
      [visitorName, visitorEmail]
    );

    // Insert initial ticket message
    await pool.query(
      `INSERT INTO support_messages (
        ticket_id, sender_type, sender_name, message, is_internal, created_at
      ) VALUES ($1, 'visitor', $2, $3, FALSE, NOW())`,
      [ticket.id, visitorName, message]
    );

    // Send email notification to support team
    try {
      const emailService = require('../utils/email');
      await emailService.sendEmail({
        to: 'support@oxsteed.com',
        subject: `New Support Request from ${visitorName}`,
        text: `Name: ${visitorName}\nEmail: ${visitorEmail}\nMessage: ${message}`,
      });
    } catch (emailErr) {
      logger.warn('Failed to send support ticket email notification', { message: emailErr.message });
    }

    res.json({
      success: true,
      routedTo: 'support_ticket',
      ticketNumber: ticket.ticket_number,
      message: 'Your request has been recorded. We\'ll get back to you soon.',
      timestamp: new Date().toISOString(),
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

    // Insert message
    const { rows: [msg] } = await pool.query(
      `INSERT INTO messages (
        conversation_id, sender_id, sender_name, content, created_at
      ) VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, content, created_at`,
      [conversationId, userId, req.user?.first_name || 'Support Team', message]
    );

    // Update conversation last_message_at
    await pool.query(
      `UPDATE conversations SET last_message_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );

    // Emit via Socket.IO to both participants
    socketService.broadcastToConversation(conversationId, 'message:new', {
      conversationId,
      messageId: msg.id,
      senderId: userId,
      content: message,
      timestamp: msg.created_at,
    });

    res.json({
      success: true,
      messageId: msg.id,
      timestamp: msg.created_at,
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
    const onlineCount = getOnlineAdminCount();
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
