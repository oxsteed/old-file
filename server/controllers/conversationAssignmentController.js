// Conversation Assignment Controller
// Manages ticket assignment: claiming, reassigning, releasing conversations to agents

const pool = require('../db');
const { query } = pool;
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');
const WebSocketService = require('../services/websocketService');
const { logAdminAction } = require('../services/auditService');
const { withTransaction } = require('../utils/transaction');
const {
  TERMINAL_CONVERSATION_STATUS_SQL,
  isTerminalConversationStatus,
} = require('../services/supportConversationTerminal');

function broadcastAssignment(conversationId, event, payload = {}) {
  const data = {
    ticketId: conversationId,
    conversationId,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  WebSocketService.broadcastToTicket(conversationId, event, data);
  WebSocketService.broadcastToAdmins('support:conversation-updated', data);
}

// Agent claims a conversation from queue
async function claimConversation(req, res) {
  try {
    const { businessId, conversationId } = req.params;

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1 AND ($2::integer IS NULL OR business_id = $2::integer)',
      [conversationId, businessId || null]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];
    const agent = await supportEmployerService.findAgentForConversationBusiness(
      conversation.business_id,
      req.user.id
    );
    if (!agent) return sendError(res, 403, 'Not an agent for this support queue');
    if (isTerminalConversationStatus(conversation.status)) {
      return sendError(res, 409, 'Closed conversations cannot be assigned');
    }

    const assignment = await withTransaction(pool, async (client) => {
      // Locking both records serializes capacity checks and competing claims.
      const lockedAgent = await client.query(
        `SELECT id, is_available, max_concurrent_chats
         FROM support_agents
         WHERE id = $1 AND status = 'active'
         FOR UPDATE`,
        [agent.id]
      );
      if (!lockedAgent.rows.length || !lockedAgent.rows[0].is_available) {
        const error = new Error('AGENT_UNAVAILABLE');
        error.code = 'AGENT_UNAVAILABLE';
        throw error;
      }

      const activeChats = await client.query(
        `SELECT COUNT(*)::integer AS chat_count
         FROM conversation_assignments
         WHERE agent_id = $1 AND status = 'active'`,
        [agent.id]
      );
      if (activeChats.rows[0].chat_count >= lockedAgent.rows[0].max_concurrent_chats) {
        const error = new Error('AGENT_CAPACITY');
        error.code = 'AGENT_CAPACITY';
        throw error;
      }

      const claimedConversation = await client.query(
        `UPDATE support_conversations
         SET agent_id = $1,
             status = 'in_progress',
             assigned_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
           AND agent_id IS NULL
           AND ($3::integer IS NULL OR business_id = $3::integer)
           AND status NOT IN (${TERMINAL_CONVERSATION_STATUS_SQL}, 'pending_verification')
         RETURNING id`,
        [agent.id, conversationId, businessId || null]
      );
      if (!claimedConversation.rows.length) {
        const error = new Error('CONVERSATION_ALREADY_ASSIGNED');
        error.code = 'CONVERSATION_ALREADY_ASSIGNED';
        throw error;
      }

      const assignResult = await client.query(
        `INSERT INTO conversation_assignments
         (conversation_id, agent_id, business_id, assignment_type, claimed_at, status)
         VALUES ($1, $2, $3, 'auto', CURRENT_TIMESTAMP, 'active')
         RETURNING *`,
        [conversationId, agent.id, conversation.business_id]
      );

      await client.query(
        `UPDATE support_queue
         SET status = 'assigned', routed_to_agent_id = $1, claimed_at = CURRENT_TIMESTAMP
         WHERE conversation_id = $2 AND business_id = $3`,
        [agent.id, conversationId, conversation.business_id]
      );

      await client.query(
        `INSERT INTO queue_events
         (queue_id, business_id, conversation_id, event_type, to_agent_id, event_reason)
         SELECT id, business_id, $2, 'claimed', $1, 'Agent self-claimed'
         FROM support_queue WHERE conversation_id = $2 AND business_id = $3`,
        [agent.id, conversationId, conversation.business_id]
      );

      return assignResult.rows[0];
    }, 'support_conversation_claim');

    logger.info('Conversation claimed by agent', {
      conversationId,
      agentId: agent.id
    });
    void logAdminAction({
      adminId: req.user.id,
      action: 'support_conversation_assignment_changed',
      targetType: 'support_conversation',
      targetId: conversationId,
      description: 'Support conversation claimed by agent',
      before: { agentId: null },
      after: { agentId: agent.id },
      req,
    });

    broadcastAssignment(conversationId, 'agent:joined', {
      agentId: agent.id,
      message: 'A support specialist joined the conversation.',
    });

    res.json({ success: true, data: assignment });
  } catch (err) {
    if (err.code === 'AGENT_UNAVAILABLE') {
      return sendError(res, 409, 'Agent is not available');
    }
    if (err.code === 'AGENT_CAPACITY') {
      return sendError(res, 409, 'Agent at max capacity');
    }
    if (err.code === 'CONVERSATION_ALREADY_ASSIGNED') {
      return sendError(res, 409, 'Conversation already assigned');
    }
    logger.error('claimConversation error', { error: err.message });
    sendError(res, 500, 'Failed to claim conversation');
  }
}

// Manually assign conversation to specific agent
async function assignToAgent(req, res) {
  try {
    const { businessId, conversationId } = req.params;
    const { agentId } = req.body;

    if (!agentId) {
      return sendValidationError(res, { agentId: 'Required' });
    }

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1 AND ($2::integer IS NULL OR business_id = $2::integer)',
      [conversationId, businessId || null]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];
    const canManage = supportEmployerService.isPlatformAdmin(req.user.role)
      || await supportEmployerService.userCanAdministrateBusiness(conversation.business_id, req.user.id);
    if (!canManage) return sendError(res, 403, 'Access denied');
    if (isTerminalConversationStatus(conversation.status)) {
      return sendError(res, 409, 'Closed conversations cannot be assigned');
    }

    const employerIds = await supportEmployerService.employerIdsForConversationBusiness(
      conversation.business_id
    );
    const agentResult = await query(
      `SELECT * FROM support_agents WHERE id = $1 AND employer_id = ANY($2::uuid[])`,
      [agentId, employerIds]
    );
    if (!agentResult.rows.length) return sendError(res, 404, 'Agent not found');

    const agent = agentResult.rows[0];

    // Check capacity
    const activeChats = await query(
      `SELECT COUNT(*) as chat_count
       FROM conversation_assignments
       WHERE agent_id = $1 AND status = 'active'`,
      [agentId]
    );

    if (activeChats.rows[0].chat_count >= agent.max_concurrent_chats) {
      return sendError(res, 400, 'Agent at max capacity');
    }

    // Unassign previous agent if any
    if (conversation.agent_id) {
      await query(
        `UPDATE conversation_assignments
         SET status = 'completed', released_at = CURRENT_TIMESTAMP
         WHERE conversation_id = $1 AND business_id = $2 AND status = 'active'`,
        [conversationId, conversation.business_id]
      );
    }

    // Assign to new agent
    const assignResult = await query(
      `INSERT INTO conversation_assignments
       (conversation_id, agent_id, business_id, assigned_by, assignment_type, claimed_at, status)
       VALUES ($1, $2, $3, $4, 'manual', CURRENT_TIMESTAMP, 'active')
       RETURNING *`,
      [conversationId, agentId, conversation.business_id, req.user.id]
    );

    // Update conversation
    await query(
      `UPDATE support_conversations
       SET agent_id = $1, status = 'in_progress', assigned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND business_id = $3`,
      [agentId, conversationId, conversation.business_id]
    );

    // Update queue
    await query(
      `UPDATE support_queue
       SET routed_to_agent_id = $1, routing_strategy = 'manual'
       WHERE conversation_id = $2`,
      [agentId, conversationId]
    );

    // Log event
    await query(
      `INSERT INTO queue_events
       (queue_id, business_id, conversation_id, event_type, to_agent_id, event_reason)
       SELECT id, business_id, $2, 'routed', $1, 'Manually assigned by admin'
       FROM support_queue WHERE conversation_id = $2 AND business_id = $3`,
      [agentId, conversationId, conversation.business_id]
    );

    logger.info('Conversation assigned to agent', {
      conversationId,
      agentId,
      assignedBy: req.user.id
    });
    void logAdminAction({
      adminId: req.user.id,
      action: 'support_conversation_assignment_changed',
      targetType: 'support_conversation',
      targetId: conversationId,
      description: 'Support conversation assigned to agent',
      before: { agentId: conversation.agent_id || null },
      after: { agentId },
      req,
    });

    WebSocketService.notifyAgent(agentId, 'ticket:new-assignment', {
      ticketId: conversationId,
      conversationId,
    });
    broadcastAssignment(conversationId, 'agent:joined', {
      agentId,
      message: 'A support specialist joined the conversation.',
    });

    res.json({ success: true, data: assignResult.rows[0] });
  } catch (err) {
    logger.error('assignToAgent error', { error: err.message });
    sendError(res, 500, 'Failed to assign conversation');
  }
}

// Reassign to different agent
async function reassignAgent(req, res) {
  try {
    const { businessId, conversationId } = req.params;
    const { newAgentId, reason } = req.body;

    if (!newAgentId) {
      return sendValidationError(res, { newAgentId: 'Required' });
    }

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1 AND ($2::integer IS NULL OR business_id = $2::integer)',
      [conversationId, businessId || null]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];
    const canManage = supportEmployerService.isPlatformAdmin(req.user.role)
      || await supportEmployerService.userCanAdministrateBusiness(conversation.business_id, req.user.id);
    if (!canManage) return sendError(res, 403, 'Access denied');
    if (isTerminalConversationStatus(conversation.status)) {
      return sendError(res, 409, 'Closed conversations cannot be assigned');
    }

    if (!conversation.agent_id) {
      return sendError(res, 400, 'Conversation not assigned');
    }

    const employerIds = await supportEmployerService.employerIdsForConversationBusiness(
      conversation.business_id
    );
    const newAgentResult = await query(
      `SELECT * FROM support_agents WHERE id = $1 AND employer_id = ANY($2::uuid[])`,
      [newAgentId, employerIds]
    );
    if (!newAgentResult.rows.length) return sendError(res, 404, 'New agent not found');

    const newAgent = newAgentResult.rows[0];

    // Check capacity
    const activeChats = await query(
      `SELECT COUNT(*) as chat_count
       FROM conversation_assignments
       WHERE agent_id = $1 AND status = 'active'`,
      [newAgentId]
    );

    if (activeChats.rows[0].chat_count >= newAgent.max_concurrent_chats) {
      return sendError(res, 400, 'New agent at max capacity');
    }

    // Release from current agent
    await query(
      `UPDATE conversation_assignments
       SET status = 'completed', released_at = CURRENT_TIMESTAMP,
           duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - claimed_at))::INTEGER
         WHERE conversation_id = $1 AND business_id = $2 AND status = 'active'`,
      [conversationId, conversation.business_id]
    );

    // Assign to new agent
    const assignResult = await query(
      `INSERT INTO conversation_assignments
       (conversation_id, agent_id, business_id, assigned_by, assignment_type, claimed_at, status)
       VALUES ($1, $2, $3, $4, 'manual', CURRENT_TIMESTAMP, 'active')
       RETURNING *`,
      [conversationId, newAgentId, conversation.business_id, req.user.id]
    );

    // Update conversation
    await query(
      `UPDATE support_conversations
       SET agent_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND business_id = $3`,
      [newAgentId, conversationId, conversation.business_id]
    );

    // Log event
    await query(
      `INSERT INTO queue_events
       (queue_id, business_id, conversation_id, event_type, from_agent_id, to_agent_id, event_reason)
       SELECT id, business_id, $2, 'reassigned', $3, $1, $4
       FROM support_queue WHERE conversation_id = $2 AND business_id = $5`,
      [newAgentId, conversationId, conversation.agent_id, reason || null, conversation.business_id]
    );

    logger.info('Conversation reassigned', {
      conversationId,
      fromAgentId: conversation.agent_id,
      toAgentId: newAgentId
    });
    void logAdminAction({
      adminId: req.user.id,
      action: 'support_conversation_assignment_changed',
      targetType: 'support_conversation',
      targetId: conversationId,
      description: 'Support conversation reassigned to another agent',
      before: { agentId: conversation.agent_id },
      after: { agentId: newAgentId },
      req,
    });

    WebSocketService.notifyAgent(newAgentId, 'ticket:new-assignment', {
      ticketId: conversationId,
      conversationId,
    });
    broadcastAssignment(conversationId, 'agent:changed', {
      previousAgentId: conversation.agent_id,
      agentId: newAgentId,
    });

    res.json({ success: true, data: assignResult.rows[0] });
  } catch (err) {
    logger.error('reassignAgent error', { error: err.message });
    sendError(res, 500, 'Failed to reassign conversation');
  }
}

// Release conversation (agent stops working on it)
async function releaseConversation(req, res) {
  try {
    const { businessId, conversationId } = req.params;
    const { reason } = req.body;

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1 AND ($2::integer IS NULL OR business_id = $2::integer)',
      [conversationId, businessId || null]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];
    let allowed = false;
    if (conversation.agent_id) {
      const ag = await query(
        'SELECT 1 FROM support_agents WHERE id = $1 AND user_id = $2',
        [conversation.agent_id, req.user.id]
      );
      allowed = ag.rows.length > 0;
    }
    if (!allowed && supportEmployerService.isPlatformAdmin(req.user.role)) {
      allowed = true;
    }
    if (!allowed) {
      allowed = await supportEmployerService.userCanAdministrateBusiness(
        conversation.business_id,
        req.user.id
      );
    }
    if (!allowed) return sendError(res, 403, 'Access denied');
    if (isTerminalConversationStatus(conversation.status)) {
      return sendError(res, 409, 'Closed conversations cannot be assigned');
    }

    // Complete assignment
    const assignment = await query(
      `UPDATE conversation_assignments
       SET status = 'released', released_at = CURRENT_TIMESTAMP,
           duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - claimed_at))::INTEGER
       WHERE conversation_id = $1 AND business_id = $2 AND status = 'active'
       RETURNING *`,
      [conversationId, conversation.business_id]
    );

    // Put back in queue (but not back to waiting state if already resolved)
    if (!isTerminalConversationStatus(conversation.status)) {
      await query(
        `UPDATE support_conversations
         SET agent_id = NULL,
             status = 'waiting_for_agent',
             live_wait_started_at = CURRENT_TIMESTAMP,
             live_wait_expires_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes',
             live_wait_ended_at = NULL,
             founder_alert_sent_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND business_id = $2`,
        [conversationId, conversation.business_id]
      );

      await query(
        `UPDATE support_queue
         SET status = 'waiting', routed_to_agent_id = NULL, removed_at = NULL
         WHERE conversation_id = $1 AND business_id = $2`,
        [conversationId, conversation.business_id]
      );
    }

    // Log event
    await query(
      `INSERT INTO queue_events
       (queue_id, business_id, conversation_id, event_type, from_agent_id, event_reason)
       SELECT id, business_id, $2, 'released', $1, $3
       FROM support_queue WHERE conversation_id = $2 AND business_id = $4`,
      [conversation.agent_id, conversationId, reason || null, conversation.business_id]
    );

    logger.info('Conversation released', { conversationId });
    void logAdminAction({
      adminId: req.user.id,
      action: 'support_conversation_assignment_changed',
      targetType: 'support_conversation',
      targetId: conversationId,
      description: 'Support conversation released back to the queue',
      before: { agentId: conversation.agent_id || null },
      after: { agentId: null },
      req,
    });

    broadcastAssignment(conversationId, 'agent:left', {
      previousAgentId: conversation.agent_id,
      message: 'This conversation returned to the support queue.',
    });

    res.json({ success: true, data: assignment.rows[0] });
  } catch (err) {
    logger.error('releaseConversation error', { error: err.message });
    sendError(res, 500, 'Failed to release conversation');
  }
}

// Get agent's active assignments
async function getAgentAssignments(req, res) {
  try {
    const { businessId, agentId } = req.params;

    const agentResult = await query(
      `SELECT id, user_id, employer_id
       FROM support_agents
       WHERE id = $1 AND business_id = $2`,
      [agentId, businessId]
    );
    if (!agentResult.rows.length) return sendError(res, 404, 'Agent not found');

    const agent = agentResult.rows[0];
    const isSelf = agent.user_id === req.user.id;
    const isPlatformAdmin = supportEmployerService.isPlatformAdmin(req.user.role);
    const canManage = isSelf || isPlatformAdmin || await supportEmployerService.userCanManageEmployer(
      agent.employer_id,
      req.user.id,
      req.user.role
    );
    if (!canManage) return sendError(res, 403, 'Access denied');

    const result = await query(
      `SELECT
        ca.id, ca.conversation_id, ca.agent_id,
        sc.subject, sc.customer_id,
        COALESCE(
          NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
          u.email
        ) as customer_name,
        sc.status, sc.priority, sc.created_at,
        ca.claimed_at
      FROM conversation_assignments ca
      JOIN support_conversations sc ON ca.conversation_id = sc.id
      LEFT JOIN users u ON sc.customer_id = u.id
      WHERE ca.agent_id = $1
        AND ca.business_id = $2
        AND sc.business_id = $2
        AND ca.status = 'active'
      ORDER BY ca.claimed_at ASC`,
      [agentId, businessId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getAgentAssignments error', { error: err.message });
    sendError(res, 500, 'Failed to get assignments');
  }
}

module.exports = {
  claimConversation,
  assignToAgent,
  reassignAgent,
  releaseConversation,
  getAgentAssignments
};
