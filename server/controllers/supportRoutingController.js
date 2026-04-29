/**
 * Support Routing Controller
 * Handles ticket creation with 3-layer routing
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');
const SupportRoutingService = require('../services/supportRoutingService');
const WebSocketService = require('../services/websocketService');

// Create support conversation (customer initiates)
exports.createConversation = async (req, res) => {
  try {
    const { customerId, visitorEmail, visitorName, message, category, priority } = req.body;
    const businessId = req.params.businessId;

    // Validate input
    if (!message?.trim() || !category) {
      return sendValidationError(res, { message: 'Message and category required' });
    }

    // Create conversation record
    const conversationQuery = `
      INSERT INTO support_conversations (
        customer_id, business_id, subject, category, priority, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'open', NOW())
      RETURNING id, created_at
    `;

    const conversationResult = await pool.query(conversationQuery, [
      customerId,
      businessId,
      `${category.charAt(0).toUpperCase() + category.slice(1)} Support Request`,
      category,
      priority || 'normal',
    ]);

    const ticketId = conversationResult.rows[0].id;

    // Add initial message with sender name and 180-day expiry tracking
    const messageQuery = `
      INSERT INTO support_messages
      (ticket_id, sender_type, sender_id, sender_name, content, message_type, created_at, expires_at)
      VALUES ($1, 'customer', $2, $3, $4, 'text', NOW(), NOW() + INTERVAL '180 days')
      RETURNING id
    `;

    await pool.query(messageQuery, [ticketId, customerId, visitorName, message]);

    // Layer 1-3 Routing
    const routing = await SupportRoutingService.routeTicket({
      customerId,
      businessId,
      category,
      message,
      priority: priority || 'normal',
    });

    let assignedAgentId = null;
    let response = {
      ticketId,
      routedTo: routing.routedTo,
      confidence: routing.confidence,
    };

    // If routed to agent, assign immediately
    if (routing.routedTo === 'agent' && routing.agentId) {
      assignedAgentId = routing.agentId;

      const assignQuery = `
        UPDATE support_conversations
        SET assigned_agent_id = $1, status = 'assigned'
        WHERE id = $2
      `;
      await pool.query(assignQuery, [assignedAgentId, ticketId]);

      response.assignedAgent = {
        id: routing.agent.id,
        name: `${routing.agent.first_name} ${routing.agent.last_name}`,
        email: routing.agent.email,
      };

      // Notify agent via WebSocket
      WebSocketService.notifyAgent(assignedAgentId, 'ticket:new-assignment', {
        ticketId,
        customerName: visitorName,
        customerEmail: visitorEmail,
        category,
        message,
        timestamp: new Date().toISOString(),
      });

      logger.info('Ticket routed to agent', {
        ticketId,
        agentId: assignedAgentId,
        category,
      });
    } else if (routing.routedTo === 'queue') {
      // Queue status update
      const queueQuery = `
        UPDATE support_conversations
        SET status = 'waiting_agent', queued_at = NOW()
        WHERE id = $1
      `;
      await pool.query(queueQuery, [ticketId]);

      response.message = 'Your request has been queued. An agent will help you shortly.';

      logger.info('Ticket queued', { ticketId, category });
    } else if (routing.routedTo === 'ai') {
      // AI response (handled by customer widget)
      response.message = 'Your request is being analyzed by our AI assistant.';
    }

    // Broadcast to admins
    WebSocketService.broadcastToAdmins('ticket:created', {
      ticketId,
      customer: { id: customerId, name: visitorName, email: visitorEmail },
      category,
      priority,
      routedTo: routing.routedTo,
      timestamp: new Date().toISOString(),
    });

    res.json(response);
  } catch (err) {
    logger.error('Create conversation error', { error: err.message });
    sendError(res, 500, 'Failed to create support conversation');
  }
};

// Get conversation details
exports.getConversation = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const query = `
      SELECT
        sc.id, sc.customer_id, sc.business_id, sc.subject, sc.category,
        sc.priority, sc.status, sc.assigned_agent_id, sc.created_at,
        sa.first_name as agent_first_name, sa.last_name as agent_last_name, sa.email as agent_email
      FROM support_conversations sc
      LEFT JOIN support_agents sa ON sc.assigned_agent_id = sa.id
      WHERE sc.id = $1
    `;

    const result = await pool.query(query, [ticketId]);
    if (result.rows.length === 0) {
      return sendError(res, 404, 'Conversation not found');
    }

    const conversation = result.rows[0];

    // Get messages (excluding soft-deleted messages, only active within 180-day window)
    const messagesQuery = `
      SELECT id, sender_type, sender_id, sender_name, content, message_type, created_at, expires_at
      FROM support_messages
      WHERE ticket_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC
    `;
    const messagesResult = await pool.query(messagesQuery, [ticketId]);

    res.json({
      conversation,
      messages: messagesResult.rows,
    });
  } catch (err) {
    logger.error('Get conversation error', { error: err.message });
    sendError(res, 500, 'Failed to fetch conversation');
  }
};

// Send message
exports.sendMessage = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { senderId, senderType, senderName, content } = req.body;

    if (!content?.trim()) {
      return sendValidationError(res, { content: 'Message cannot be empty' });
    }

    // Validate sender type
    if (!['customer', 'agent', 'system'].includes(senderType)) {
      return sendValidationError(res, { senderType: 'Invalid sender type' });
    }

    // Insert message with new schema (includes sender_name, message_type, expires_at for 180-day retention)
    const messageQuery = `
      INSERT INTO support_messages
      (ticket_id, sender_type, sender_id, sender_name, content, message_type, created_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, 'text', NOW(), NOW() + INTERVAL '180 days')
      RETURNING id, created_at
    `;

    const result = await db.query(messageQuery, [
      ticketId,
      senderType,
      senderId,
      senderName || 'Unknown',
      content.trim(),
    ]);

    // Update conversation last_message_at and status if customer responded while waiting
    if (senderType === 'customer') {
      const updateQuery = `
        UPDATE support_conversations
        SET status = 'in_progress', updated_at = NOW(), last_message_at = NOW()
        WHERE id = $1 AND status = 'waiting_customer'
      `;
      await db.query(updateQuery, [ticketId]);
    } else {
      // Update last_message_at for any message
      const updateQuery = `
        UPDATE support_conversations
        SET last_message_at = NOW()
        WHERE id = $1
      `;
      await db.query(updateQuery, [ticketId]);
    }

    // Broadcast message to ticket room via WebSocket
    WebSocketService.broadcastToTicket(ticketId, 'message:new', {
      ticketId,
      sender: {
        type: senderType,
        id: senderId,
        name: senderName || 'Unknown',
      },
      content: content.trim(),
      timestamp: result.rows[0].created_at,
    });

    logger.info('Message sent', {
      ticketId,
      messageId: result.rows[0].id,
      senderType,
    });

    res.json({
      messageId: result.rows[0].id,
      timestamp: result.rows[0].created_at,
      expiresAt: new Date(new Date().getTime() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    logger.error('Send message error', { error: err.message });
    sendError(res, 500, 'Failed to send message');
  }
};

// Update conversation status
exports.updateStatus = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status } = req.body;

    const validStatuses = ['open', 'assigned', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return sendValidationError(res, { status: 'Invalid status' });
    }

    const query = `
      UPDATE support_conversations
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [status, ticketId]);
    if (result.rows.length === 0) {
      return sendError(res, 404, 'Conversation not found');
    }

    // Broadcast status change
    WebSocketService.broadcastToTicket(ticketId, 'ticket:status-changed', {
      ticketId,
      status,
      timestamp: new Date().toISOString(),
    });

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Update status error', { error: err.message });
    sendError(res, 500, 'Failed to update status');
  }
};

// Assign ticket to agent
exports.assignToAgent = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { agentId } = req.body;

    // Verify agent exists and has capacity
    const agentQuery = `
      SELECT id, first_name, last_name FROM support_agents
      WHERE id = $1 AND is_active = true
    `;
    const agentResult = await pool.query(agentQuery, [agentId]);
    if (agentResult.rows.length === 0) {
      return sendError(res, 404, 'Agent not found or inactive');
    }

    // Assign
    const assignQuery = `
      UPDATE support_conversations
      SET assigned_agent_id = $1, status = 'assigned', updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(assignQuery, [agentId, ticketId]);

    // Notify agent via WebSocket
    WebSocketService.notifyAgent(agentId, 'ticket:assigned-to-you', {
      ticketId,
      timestamp: new Date().toISOString(),
    });

    // Notify customer
    WebSocketService.broadcastToTicket(ticketId, 'agent:assigned', {
      ticketId,
      agentName: `${agentResult.rows[0].first_name} ${agentResult.rows[0].last_name}`,
      timestamp: new Date().toISOString(),
    });

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Assign agent error', { error: err.message });
    sendError(res, 500, 'Failed to assign agent');
  }
};

// Get connection status (for admin dashboard)
exports.getStatus = async (req, res) => {
  try {
    const status = WebSocketService.getConnectionStatus();
    res.json(status);
  } catch (err) {
    logger.error('Get status error', { error: err.message });
    sendError(res, 500, 'Failed to fetch status');
  }
};
