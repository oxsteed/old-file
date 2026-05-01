// Conversation Assignment Controller
// Manages ticket assignment: claiming, reassigning, releasing conversations to agents

const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');

// Agent claims a conversation from queue
async function claimConversation(req, res) {
  try {
    const { conversationId } = req.params;

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];

    const employerIds = await supportEmployerService.employerIdsForConversationBusiness(
      conversation.business_id
    );
    const agentResult = await query(
      `SELECT sa.* FROM support_agents sa
       WHERE sa.user_id = $1 AND sa.employer_id = ANY($2::uuid[])
       ORDER BY sa.created_at ASC
       LIMIT 1`,
      [req.user.id, employerIds]
    );
    if (!agentResult.rows.length) return sendError(res, 403, 'Not an agent');

    const agent = agentResult.rows[0];

    // Check if agent is available
    if (!agent.is_available) {
      return sendError(res, 400, 'Agent is not available');
    }

    // Check if agent has capacity
    const activeChats = await query(
      `SELECT COUNT(*) as chat_count
       FROM conversation_assignments
       WHERE agent_id = $1 AND status = 'active'`,
      [agent.id]
    );

    if (activeChats.rows[0].chat_count >= agent.max_concurrent_chats) {
      return sendError(res, 400, 'Agent at max capacity');
    }

    // Check if already assigned
    if (conversation.agent_id) {
      return sendError(res, 400, 'Conversation already assigned');
    }

    // Assign conversation to agent
    const assignResult = await query(
      `INSERT INTO conversation_assignments
       (conversation_id, agent_id, business_id, assignment_type, claimed_at, status)
       VALUES ($1, $2, $3, 'auto', CURRENT_TIMESTAMP, 'active')
       RETURNING *`,
      [conversationId, agent.id, conversation.business_id]
    );

    // Update conversation with agent
    await query(
      `UPDATE support_conversations
       SET agent_id = $1, status = 'in_progress', assigned_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [agent.id, conversationId]
    );

    // Remove from queue
    await query(
      `UPDATE support_queue
       SET status = 'assigned', routed_to_agent_id = $1, claimed_at = CURRENT_TIMESTAMP
       WHERE conversation_id = $2`,
      [agent.id, conversationId]
    );

    // Log queue event
    await query(
      `INSERT INTO queue_events
       (queue_id, business_id, conversation_id, event_type, to_agent_id, event_reason)
       SELECT id, business_id, $2, 'claimed', $1, 'Agent self-claimed'
       FROM support_queue WHERE conversation_id = $2`,
      [agent.id, conversationId]
    );

    logger.info('Conversation claimed by agent', {
      conversationId,
      agentId: agent.id
    });

    res.json({ success: true, data: assignResult.rows[0] });
  } catch (err) {
    logger.error('claimConversation error', { error: err.message });
    sendError(res, 500, 'Failed to claim conversation');
  }
}

// Manually assign conversation to specific agent
async function assignToAgent(req, res) {
  try {
    const { conversationId } = req.params;
    const { agentId } = req.body;

    if (!agentId) {
      return sendValidationError(res, { agentId: 'Required' });
    }

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];

    const canManage = await supportEmployerService.userCanManageBusiness(
      conversation.business_id,
      req.user.id
    );
    if (!canManage) return sendError(res, 403, 'Access denied');

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
         WHERE conversation_id = $1 AND status = 'active'`,
        [conversationId]
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
       WHERE id = $2`,
      [agentId, conversationId]
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
       FROM support_queue WHERE conversation_id = $2`,
      [agentId, conversationId]
    );

    logger.info('Conversation assigned to agent', {
      conversationId,
      agentId,
      assignedBy: req.user.id
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
    const { conversationId } = req.params;
    const { newAgentId, reason } = req.body;

    if (!newAgentId) {
      return sendValidationError(res, { newAgentId: 'Required' });
    }

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];

    const canManage = await supportEmployerService.userCanManageBusiness(
      conversation.business_id,
      req.user.id
    );
    if (!canManage) return sendError(res, 403, 'Access denied');

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
       WHERE conversation_id = $1 AND status = 'active'`,
      [conversationId]
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
       WHERE id = $2`,
      [newAgentId, conversationId]
    );

    // Log event
    await query(
      `INSERT INTO queue_events
       (queue_id, business_id, conversation_id, event_type, from_agent_id, to_agent_id, event_reason)
       SELECT id, business_id, $2, 'reassigned', $3, $1, $4
       FROM support_queue WHERE conversation_id = $2`,
      [newAgentId, conversationId, conversation.agent_id, reason || null]
    );

    logger.info('Conversation reassigned', {
      conversationId,
      fromAgentId: conversation.agent_id,
      toAgentId: newAgentId
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
    const { conversationId } = req.params;
    const { reason } = req.body;

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
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
    if (!allowed) {
      allowed = await supportEmployerService.userCanManageBusiness(
        conversation.business_id,
        req.user.id
      );
    }
    if (!allowed) return sendError(res, 403, 'Access denied');

    // Complete assignment
    const assignment = await query(
      `UPDATE conversation_assignments
       SET status = 'released', released_at = CURRENT_TIMESTAMP,
           duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - claimed_at))::INTEGER
       WHERE conversation_id = $1 AND status = 'active'
       RETURNING *`,
      [conversationId]
    );

    // Put back in queue (but not back to waiting state if already resolved)
    if (conversation.status !== 'resolved' && conversation.status !== 'closed') {
      await query(
        `UPDATE support_conversations
         SET agent_id = NULL, status = 'waiting_for_agent', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [conversationId]
      );

      await query(
        `UPDATE support_queue
         SET status = 'waiting', routed_to_agent_id = NULL, removed_at = NULL
         WHERE conversation_id = $1`,
        [conversationId]
      );
    }

    // Log event
    await query(
      `INSERT INTO queue_events
       (queue_id, business_id, conversation_id, event_type, from_agent_id, event_reason)
       SELECT id, business_id, $2, 'released', $1, $3
       FROM support_queue WHERE conversation_id = $2`,
      [conversation.agent_id, conversationId, reason || null]
    );

    logger.info('Conversation released', { conversationId });

    res.json({ success: true, data: assignment.rows[0] });
  } catch (err) {
    logger.error('releaseConversation error', { error: err.message });
    sendError(res, 500, 'Failed to release conversation');
  }
}

// Get agent's active assignments
async function getAgentAssignments(req, res) {
  try {
    const { agentId } = req.params;

    const result = await query(
      `SELECT
        ca.id, ca.conversation_id, ca.agent_id,
        sc.subject, sc.customer_id, u.name as customer_name,
        sc.status, sc.priority, sc.created_at,
        ca.claimed_at
      FROM conversation_assignments ca
      JOIN support_conversations sc ON ca.conversation_id = sc.id
      LEFT JOIN users u ON sc.customer_id = u.id
      WHERE ca.agent_id = $1 AND ca.status = 'active'
      ORDER BY ca.claimed_at ASC`,
      [agentId]
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
