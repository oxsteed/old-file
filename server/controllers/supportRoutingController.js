/**
 * Support Routing Controller
 * Handles ticket creation with 3-layer routing
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');
const SupportRoutingService = require('../services/supportRoutingService');
const WebSocketService = require('../services/websocketService');
const { waitingState } = require('../services/supportWaitService');
const supportConversationsController = require('./supportConversationsController');
const supportEmployerService = require('../services/supportEmployerService');
const { withTransaction } = require('../utils/transaction');
const {
  TERMINAL_CONVERSATION_STATUS_SQL,
  isTerminalConversationStatus,
} = require('../services/supportConversationTerminal');
const { getClientRequestId } = require('../utils/idempotency');

async function canViewConversation(conversation, user) {
  if (!conversation || !user) return false;
  if (supportEmployerService.isPlatformAdmin(user.role)) return true;
  if (conversation.customer_id === user.id) return true;

  if (conversation.agent_id) {
    const { rows } = await pool.query(
      'SELECT 1 FROM support_agents WHERE id = $1 AND user_id = $2 AND status = \'active\'',
      [conversation.agent_id, user.id]
    );
    if (rows.length) return true;
  }

  return supportEmployerService.userCanAccessBusinessConversations(
    conversation.business_id,
    user.id,
    user.role
  );
}

async function canManageConversation(conversation, user) {
  if (!conversation || !user) return false;
  if (supportEmployerService.isPlatformAdmin(user.role)) return true;

  if (conversation.agent_id) {
    const { rows } = await pool.query(
      'SELECT 1 FROM support_agents WHERE id = $1 AND user_id = $2 AND status = \'active\'',
      [conversation.agent_id, user.id]
    );
    if (rows.length) return true;
  }

  return supportEmployerService.userCanAdministrateBusiness(
    conversation.business_id,
    user.id
  );
}

function assignedAgentFromRow(row) {
  if (!row?.agent_id) return null;
  const name = [row.agent_first_name, row.agent_last_name].filter(Boolean).join(' ').trim();
  return {
    id: row.agent_id,
    name: name || row.agent_name || row.agent_email || 'Support specialist',
    email: row.agent_email || null,
  };
}

async function loadConversationMessages(ticketId) {
  const { rows } = await pool.query(
    `SELECT id, sender_id, content, message_type, attachment_url, attachment_name, is_agent, created_at
     FROM support_conversation_messages
     WHERE conversation_id = $1
       AND message_type <> 'internal_note'
     ORDER BY created_at ASC`,
    [ticketId]
  );
  return rows;
}

async function findOrCreateActiveConversation({ customerId, businessId, category, priority }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
      [customerId, businessId]
    );

    const existingResult = await client.query(
      `SELECT
         sc.id, sc.status, sc.agent_id,
         COALESCE(
           NULLIF(BTRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''),
           au.email
         ) AS agent_name,
         au.first_name AS agent_first_name,
         au.last_name AS agent_last_name,
         au.email AS agent_email
       FROM support_conversations sc
       LEFT JOIN support_agents sa ON sa.id = sc.agent_id
       LEFT JOIN users au ON au.id = sa.user_id
       WHERE sc.customer_id = $1
         AND sc.business_id = $2
         AND sc.status IN ('open', 'in_progress', 'waiting_for_customer', 'waiting_for_agent')
       ORDER BY sc.updated_at DESC, sc.created_at DESC
       LIMIT 1`,
      [customerId, businessId]
    );

    let conversation = existingResult.rows[0] || null;
    if (!conversation) {
      const { rows } = await client.query(
        `INSERT INTO support_conversations (
           customer_id, business_id, subject, description, category, priority, status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'open', NOW(), NOW())
         RETURNING id, status, agent_id`,
        [
          customerId,
          businessId,
          'Live Support Request',
          'Customer opened live support.',
          category,
          priority,
        ]
      );
      conversation = rows[0];
    }

    await client.query('COMMIT');
    return { conversation, resumed: existingResult.rows.length > 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function routeConversation({ ticketId, customerId, businessId, category, message, priority, visitorName, visitorEmail }) {
  const routing = await SupportRoutingService.routeTicket({
    customerId,
    businessId,
    category,
    message,
    priority,
  });

  const response = {
    ticketId,
    routedTo: routing.routedTo,
    confidence: routing.confidence,
  };

  if (routing.routedTo === 'agent' && routing.agentId) {
    const assigned = await withTransaction(pool, async (client) => {
      const assignmentResult = await client.query(
        `UPDATE support_conversations
         SET agent_id = $1, status = 'in_progress', assigned_at = COALESCE(assigned_at, NOW()), updated_at = NOW()
         WHERE id = $2
           AND agent_id IS NULL
           AND status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})
           AND (
             SELECT COUNT(*)
             FROM support_conversations active_conversations
             WHERE active_conversations.agent_id = $1
               AND active_conversations.status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})
               AND active_conversations.id <> $2
           ) < COALESCE((
             SELECT max_concurrent_chats FROM support_agents WHERE id = $1
           ), 3)
         RETURNING id`,
        [routing.agentId, ticketId]
      );

      if (!assignmentResult.rows.length) return false;

      await client.query(
        `INSERT INTO conversation_assignments
         (conversation_id, agent_id, business_id, assignment_type, claimed_at, status)
         SELECT $1, $2, $3, 'auto', NOW(), 'active'
         WHERE NOT EXISTS (
           SELECT 1 FROM conversation_assignments
           WHERE conversation_id = $1 AND status = 'active'
         )`,
        [ticketId, routing.agentId, businessId]
      );
      return true;
    }, 'support_auto_route_assignment');

    if (assigned) {
      response.assignedAgent = {
        id: routing.agent.id,
        name: [routing.agent.first_name, routing.agent.last_name].filter(Boolean).join(' ').trim()
          || routing.agent.email
          || 'Support specialist',
        email: routing.agent.email || null,
      };

      WebSocketService.notifyAgent(routing.agentId, 'ticket:new-assignment', {
        ticketId,
        customerName: visitorName,
        customerEmail: visitorEmail,
        category,
        message,
        timestamp: new Date().toISOString(),
      });
    } else {
      // The agent filled up between availability lookup and assignment.
      // Use the normal queue path rather than promising a live response.
      response.routedTo = 'queue';
    }
  }

  if (response.routedTo !== 'agent') {
    const { rows: waitingRows } = await pool.query(
      `UPDATE support_conversations
       SET status = 'waiting_for_agent',
           live_wait_started_at = COALESCE(live_wait_started_at, NOW()),
           live_wait_expires_at = COALESCE(live_wait_expires_at, NOW() + INTERVAL '5 minutes'),
           updated_at = NOW()
       WHERE id = $1
       RETURNING status, agent_id, live_wait_expires_at, live_wait_ended_at`,
      [ticketId]
    );
    await pool.query(
      `INSERT INTO support_queue (business_id, conversation_id, priority, status, queued_at)
       VALUES ($1, $2, $3, 'waiting', NOW())
       ON CONFLICT DO NOTHING`,
      [businessId, ticketId, priority]
    );
    response.routedTo = 'queue';
    response.message = 'Your request is in the support queue. An agent will help you shortly.';
    const waitingConversation = waitingRows[0] || (await pool.query(
      `SELECT status, agent_id, live_wait_expires_at, live_wait_ended_at
       FROM support_conversations WHERE id = $1`,
      [ticketId]
    )).rows[0];
    response.waiting = waitingState(waitingConversation);
  }

  WebSocketService.broadcastToAdmins('ticket:created', {
    ticketId,
    customer: { id: customerId, name: visitorName, email: visitorEmail },
    category,
    priority,
    routedTo: response.routedTo,
    timestamp: new Date().toISOString(),
  });

  return response;
}

// Establish or resume the signed-in customer's live support session. This is
// intentionally idempotent so refreshes and React Strict Mode cannot create
// duplicate empty tickets.
exports.connectConversation = async (req, res) => {
  try {
    const customerId = req.user.id;
    const businessId = req.params.businessId;
    const category = 'support_request';
    const priority = 'normal';
    const visitorName = req.user.name
      || [req.user.first_name, req.user.last_name].filter(Boolean).join(' ').trim()
      || req.user.email
      || 'Customer';
    const visitorEmail = req.user.email || null;

    const { conversation: existing, resumed } = await findOrCreateActiveConversation({
      customerId,
      businessId,
      category,
      priority,
    });
    if (existing?.agent_id) {
      return res.json({
        ticketId: existing.id,
        routedTo: 'agent',
        resumed,
        assignedAgent: assignedAgentFromRow(existing),
        messages: await loadConversationMessages(existing.id),
      });
    }

    const ticketId = existing.id;

    // A reconnect must not route an already waiting conversation again. The
    // customer may refresh or reconnect while the worker is coordinating an
    // agent; repeating routing would duplicate broadcasts and notifications.
    if (resumed && !existing.agent_id && existing.status !== 'open') {
      return res.json({
        ticketId,
        routedTo: existing.status === 'waiting_for_agent' ? 'queue' : 'message',
        resumed: true,
        waiting: waitingState(existing),
        messages: await loadConversationMessages(ticketId),
      });
    }

    const response = await routeConversation({
      ticketId,
      customerId,
      businessId,
      category,
      message: 'Customer requested live support.',
      priority,
      visitorName,
      visitorEmail,
    });

    response.resumed = resumed;
    response.messages = await loadConversationMessages(ticketId);
    return res.json(response);
  } catch (err) {
    logger.error('Connect support conversation error', { error: err.message, userId: req.user?.id });
    return sendError(res, 500, 'Failed to connect to support');
  }
};

// Create support conversation (customer initiates)
exports.createConversation = async (req, res) => {
  try {
    const { visitorEmail, visitorName, message, category, priority } = req.body || {};
    const customerId = req.user.id;
    const businessId = req.params.businessId;
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';
    const normalizedCategory = typeof category === 'string' ? category.trim().toLowerCase() : '';
    const normalizedPriority = typeof priority === 'string' ? priority.trim().toLowerCase() : 'normal';
    const normalizedVisitorName = typeof visitorName === 'string' ? visitorName.trim().slice(0, 255) : '';
    const normalizedVisitorEmail = typeof visitorEmail === 'string' ? visitorEmail.trim().slice(0, 255) : '';
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      return sendValidationError(res, { clientRequestId: 'Must be a valid UUID' });
    }
    const validCategories = new Set(['billing', 'technical', 'sales', 'account', 'general', 'support_request', 'escalation']);
    const validPriorities = new Set(['low', 'normal', 'high', 'urgent']);

    // Validate input
    if (!normalizedMessage || normalizedMessage.length > 5000 || !validCategories.has(normalizedCategory)) {
      return sendValidationError(res, {
        message: 'Message is required and must be 5000 characters or fewer',
        category: 'Invalid support category',
      });
    }
    if (!validPriorities.has(normalizedPriority)) {
      return sendValidationError(res, { priority: 'Invalid priority' });
    }
    if (visitorEmail != null && (String(visitorEmail).trim().length > 255 || !normalizedVisitorEmail || !/^\S+@\S+\.\S+$/.test(normalizedVisitorEmail))) {
      return sendValidationError(res, { visitorEmail: 'Must be a valid email address' });
    }
    if (visitorName != null && (String(visitorName).trim().length > 255 || !normalizedVisitorName)) {
      return sendValidationError(res, { visitorName: 'Must not be empty' });
    }

    // Create the durable conversation and first message before routing. Both
    // customer and admin surfaces read these same tables.
    const conversationQuery = clientRequestId ? `
      INSERT INTO support_conversations (
        customer_id, business_id, subject, description, category, priority, status, created_at, client_request_id
      ) VALUES ($1, $2, $3, $4, $5, $6, 'open', NOW(), $7)
      ON CONFLICT (client_request_id)
      WHERE client_request_id IS NOT NULL DO NOTHING
      RETURNING id, created_at, status, agent_id
    ` : `
      INSERT INTO support_conversations (
        customer_id, business_id, subject, description, category, priority, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'open', NOW())
      RETURNING id, created_at
    `;

    // Persist the opening message in the canonical conversation message table.
    const messageQuery = `
      INSERT INTO support_conversation_messages
      (conversation_id, sender_id, content, message_type, is_agent, created_at)
      VALUES ($1, $2, $3, 'text', false, NOW())
      RETURNING id
    `;

    const createdConversation = await withTransaction(pool, async (client) => {
      const conversationResult = await client.query(conversationQuery, [
        customerId,
        businessId,
        `${normalizedCategory.charAt(0).toUpperCase() + normalizedCategory.slice(1)} Support Request`,
        normalizedMessage,
        normalizedCategory,
        normalizedPriority,
        ...(clientRequestId ? [clientRequestId] : []),
      ]);

      if (!conversationResult.rows[0] && clientRequestId) {
        const existing = await client.query(
          `SELECT id, created_at, status, agent_id
             FROM support_conversations
            WHERE customer_id = $1 AND client_request_id = $2
            LIMIT 1`,
          [customerId, clientRequestId],
        );
        if (!existing.rows[0]) throw new Error('Support conversation retry could not be recovered');
        return { ...existing.rows[0], replayed: true };
      }

      const ticketId = conversationResult.rows[0].id;
      const openingMessageQuery = clientRequestId ? `
        INSERT INTO support_conversation_messages
        (conversation_id, sender_id, content, message_type, is_agent, created_at, client_message_id)
        VALUES ($1, $2, $3, 'text', false, NOW(), $4)
        ON CONFLICT (conversation_id, client_message_id)
        WHERE client_message_id IS NOT NULL DO NOTHING
        RETURNING id
      ` : messageQuery;
      await client.query(openingMessageQuery, [
        ticketId,
        customerId,
        normalizedMessage,
        ...(clientRequestId ? [clientRequestId] : []),
      ]);
      await client.query(
        `UPDATE support_conversations
         SET message_count = 1, customer_message_count = 1, updated_at = NOW()
         WHERE id = $1`,
        [ticketId]
      );

      return { ...conversationResult.rows[0], replayed: false };
    }, 'create_support_conversation');

    const ticketId = createdConversation.id;

    if (createdConversation.replayed) {
      return res.status(200).json({
        ticketId,
        routedTo: createdConversation.agent_id ? 'agent' : 'queue',
        resumed: true,
        idempotent: true,
      });
    }

    // Layer 1-3 Routing
    const routing = await SupportRoutingService.routeTicket({
      customerId,
      businessId,
      category: normalizedCategory,
      message: normalizedMessage,
      priority: normalizedPriority,
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
        SET agent_id = $1, status = 'in_progress', assigned_at = NOW(), updated_at = NOW()
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
        customerName: normalizedVisitorName,
        customerEmail: normalizedVisitorEmail,
        category: normalizedCategory,
        message: normalizedMessage,
        timestamp: new Date().toISOString(),
      });

      logger.info('Ticket routed to agent', {
        ticketId,
        agentId: assignedAgentId,
        category: normalizedCategory,
      });
    } else if (routing.routedTo === 'queue') {
      const { rows: waitingRows } = await pool.query(
        `UPDATE support_conversations
         SET status = 'waiting_for_agent',
             live_wait_started_at = COALESCE(live_wait_started_at, NOW()),
             live_wait_expires_at = COALESCE(live_wait_expires_at, NOW() + INTERVAL '5 minutes'),
             updated_at = NOW()
         WHERE id = $1
         RETURNING status, agent_id, live_wait_expires_at, live_wait_ended_at`,
        [ticketId]
      );
      await pool.query(
        `INSERT INTO support_queue (business_id, conversation_id, priority, status, queued_at)
         VALUES ($1, $2, $3, 'waiting', NOW())
         ON CONFLICT DO NOTHING`,
        [businessId, ticketId, normalizedPriority]
      );

      response.message = 'Your request has been queued. An agent will help you shortly.';
      const waitingConversation = waitingRows[0] || (await pool.query(
        `SELECT status, agent_id, live_wait_expires_at, live_wait_ended_at
         FROM support_conversations WHERE id = $1`,
        [ticketId]
      )).rows[0];
      response.waiting = waitingState(waitingConversation);

      logger.info('Ticket queued', { ticketId, category: normalizedCategory });
    } else if (routing.routedTo === 'ai') {
      // AI response (handled by customer widget)
      response.message = 'Your request is being analyzed by our AI assistant.';
    }

    // Broadcast to admins
    WebSocketService.broadcastToAdmins('ticket:created', {
      ticketId,
      customer: { id: customerId, name: normalizedVisitorName, email: normalizedVisitorEmail },
      category: normalizedCategory,
      priority: normalizedPriority,
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
        sc.priority, sc.status, sc.agent_id, sc.created_at,
        au.first_name as agent_first_name, au.last_name as agent_last_name, au.email as agent_email
      FROM support_conversations sc
      LEFT JOIN support_agents sa ON sc.agent_id = sa.id
      LEFT JOIN users au ON au.id = sa.user_id
      WHERE sc.id = $1
    `;

    const result = await pool.query(query, [ticketId]);
    if (result.rows.length === 0) {
      return sendError(res, 404, 'Conversation not found');
    }

    const conversation = result.rows[0];
    if (!(await canViewConversation(conversation, req.user))) {
      return sendError(res, 403, 'Access denied');
    }

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
  req.params.conversationId = req.params.ticketId;
  req.body = {
    ...req.body,
    content: req.body.content || req.body.message,
    isInternal: false,
  };
  return supportConversationsController.addMessage(req, res);
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

    const conversationResult = await pool.query(
      'SELECT id, business_id, customer_id, agent_id, status FROM support_conversations WHERE id = $1',
      [ticketId]
    );
    if (!conversationResult.rows.length) {
      return sendError(res, 404, 'Conversation not found');
    }
    if (!(await canManageConversation(conversationResult.rows[0], req.user))) {
      return sendError(res, 403, 'Access denied');
    }
    if (isTerminalConversationStatus(conversationResult.rows[0].status)) {
      return sendError(res, 409, 'Closed conversations cannot change status');
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

    const conversationResult = await pool.query(
      'SELECT id, business_id, customer_id, agent_id, status FROM support_conversations WHERE id = $1',
      [ticketId]
    );
    if (!conversationResult.rows.length) {
      return sendError(res, 404, 'Conversation not found');
    }
    const canAssign = supportEmployerService.isPlatformAdmin(req.user.role)
      || await supportEmployerService.userCanAdministrateBusiness(
        conversationResult.rows[0].business_id,
        req.user.id
      );
    if (!canAssign) return sendError(res, 403, 'Access denied');
    if (isTerminalConversationStatus(conversationResult.rows[0].status)) {
      return sendError(res, 409, 'Closed conversations cannot be assigned');
    }

    // Manual assignment must use the same connected, fresh, capacity-aware
    // eligibility view as automatic routing.
    const availability = await SupportRoutingService.getLiveAvailability(
      conversationResult.rows[0].business_id
    );
    const selectedAgent = availability.liveAgents.find((agent) => agent.id === agentId);
    if (!selectedAgent) {
      return sendError(res, 409, 'Agent is not live-ready or has no remaining capacity');
    }

    // Verify the selected agent still exists and is active before writing.
    const agentQuery = `
      SELECT sa.id, u.first_name, u.last_name
      FROM support_agents sa
      JOIN users u ON u.id = sa.user_id
      WHERE sa.id = $1 AND sa.status = 'active' AND sa.is_available = true AND u.is_active = true
    `;
    const agentResult = await pool.query(agentQuery, [agentId]);
    if (agentResult.rows.length === 0) {
      return sendError(res, 404, 'Agent not found or inactive');
    }

    // Assign
    const assignQuery = `
      UPDATE support_conversations
      SET agent_id = $1, status = 'in_progress', assigned_at = NOW(), updated_at = NOW()
      WHERE id = $2
        AND status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})
        AND (
          SELECT COUNT(*)
          FROM support_conversations active_conversations
          WHERE active_conversations.agent_id = $1
            AND active_conversations.status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL})
            AND active_conversations.id <> $2
        ) < COALESCE((
          SELECT max_concurrent_chats FROM support_agents WHERE id = $1
        ), 3)
      RETURNING *
    `;

    const result = await pool.query(assignQuery, [agentId, ticketId]);
    if (!result.rows.length) {
      return sendError(res, 409, 'Agent reached capacity before assignment completed');
    }

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
    const availability = await SupportRoutingService.getLiveAvailability(null);

    res.json({
      ...status,
      agents: availability.liveAvailableAgents,
      liveAvailableAgents: availability.liveAvailableAgents,
      onlineAgents: availability.onlineAgents,
      availableCapacity: availability.availableCapacity,
      markedAvailableAgents: availability.markedAvailableAgents,
      diagnostics: availability.diagnostics,
      socketAgents: status.agents,
    });
  } catch (err) {
    logger.error('Get status error', { error: err.message });
    sendError(res, 500, 'Failed to fetch status');
  }
};
