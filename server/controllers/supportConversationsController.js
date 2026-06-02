// Support Conversations Controller
// Manages support tickets: creation, assignment, status updates, resolution

const { query, withTransaction } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');

// Create a new support conversation/ticket
async function createConversation(req, res) {
  try {
    const { businessId, subject, description, category, priority } = req.body;

    if (!businessId || !subject) {
      return sendValidationError(res, {
        businessId: 'Required',
        subject: 'Required'
      });
    }

    const validCategories = ['billing', 'technical', 'sales', 'account', 'general'];
    if (category && !validCategories.includes(category)) {
      return sendValidationError(res, { category: 'Invalid category' });
    }

    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    if (priority && !validPriorities.includes(priority)) {
      return sendValidationError(res, { priority: 'Invalid priority' });
    }

    // Get SLA targets for this priority
    const slaResult = await query(
      `SELECT first_response_target_minutes, resolution_target_hours
       FROM support_sla_targets
       WHERE business_id = $1 AND priority = $2`,
      [businessId, priority || 'normal']
    );

    let slaFirstResponseTarget = null;
    let slaResolutionTarget = null;

    if (slaResult.rows.length) {
      const sla = slaResult.rows[0];
      const now = new Date();
      slaFirstResponseTarget = new Date(now.getTime() + sla.first_response_target_minutes * 60000);
      slaResolutionTarget = new Date(now.getTime() + sla.resolution_target_hours * 3600000);
    }

    // Create conversation
    const result = await query(
      `INSERT INTO support_conversations
       (business_id, customer_id, subject, description, category, priority,
        status, sla_first_response_target, sla_resolution_target)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8)
       RETURNING *`,
      [
        businessId,
        req.user.id,
        subject,
        description || null,
        category || 'general',
        priority || 'normal',
        slaFirstResponseTarget,
        slaResolutionTarget
      ]
    );

    const conversation = result.rows[0];

    // Add to queue
    await query(
      `INSERT INTO support_queue
       (business_id, conversation_id, priority, status)
       VALUES ($1, $2, $3, 'waiting')`,
      [businessId, conversation.id, priority || 'normal']
    );

    logger.info('Support conversation created', {
      conversationId: conversation.id,
      customerId: req.user.id
    });

    res.json({ success: true, data: conversation, ticketId: conversation.id, conversation });
  } catch (err) {
    logger.error('createConversation error', { error: err.message });
    sendError(res, 500, 'Failed to create conversation');
  }
}

// Get conversations for a business
async function listConversations(req, res) {
  try {
    const { businessId } = req.params;
    const { status, priority, agentId, limit = 50, offset = 0 } = req.query;

    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    let sql = `
      SELECT
        sc.id, sc.business_id, sc.customer_id,
        u.name as customer_name, u.email as customer_email,
        sc.subject, sc.description, sc.category, sc.priority,
        sc.status, sc.agent_id, sa.user_id as agent_user_id,
        au.name as agent_name,
        sc.message_count, sc.customer_message_count, sc.agent_message_count,
        sc.created_at, sc.updated_at, sc.resolved_at,
        sc.sla_first_response_breached, sc.sla_resolution_breached
      FROM support_conversations sc
      LEFT JOIN users u ON sc.customer_id = u.id
      LEFT JOIN support_agents sa ON sc.agent_id = sa.id
      LEFT JOIN users au ON sa.user_id = au.id
      WHERE sc.business_id = $1
    `;

    const params = [businessId];

    if (status) {
      sql += ` AND sc.status = $${params.length + 1}`;
      params.push(status);
    }
    if (priority) {
      sql += ` AND sc.priority = $${params.length + 1}`;
      params.push(priority);
    }
    if (agentId) {
      sql += ` AND sc.agent_id = $${params.length + 1}`;
      params.push(agentId);
    }

    sql += ` ORDER BY sc.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await query(sql, params);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('listConversations error', { error: err.message });
    sendError(res, 500, 'Failed to list conversations');
  }
}

// Get single conversation details
async function getConversation(req, res) {
  try {
    const { conversationId } = req.params;

    const result = await query(
      `SELECT
        sc.*,
        u.name as customer_name, u.email as customer_email,
        sa.id as agent_id, au.name as agent_name
      FROM support_conversations sc
      LEFT JOIN users u ON sc.customer_id = u.id
      LEFT JOIN support_agents sa ON sc.agent_id = sa.id
      LEFT JOIN users au ON sa.user_id = au.id
      WHERE sc.id = $1`,
      [conversationId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = result.rows[0];

    const canBiz = await supportEmployerService.userCanManageBusiness(
      conversation.business_id,
      req.user.id
    );
    let isAssignedAgent = false;
    if (conversation.agent_id) {
      const ag = await query('SELECT user_id FROM support_agents WHERE id = $1', [conversation.agent_id]);
      isAssignedAgent = ag.rows.length && ag.rows[0].user_id === req.user.id;
    }
    if (!canBiz && req.user.id !== conversation.customer_id && !isAssignedAgent) {
      return sendError(res, 403, 'Access denied');
    }

    // Get messages
    const messages = await query(
      `SELECT
        id, conversation_id, sender_id, message_type, content,
        is_agent, is_ai, status, read_at, created_at
      FROM support_conversation_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC`,
      [conversationId]
    );

    res.json({
      success: true,
      data: {
        ...conversation,
        messages: messages.rows
      }
    });
  } catch (err) {
    logger.error('getConversation error', { error: err.message });
    sendError(res, 500, 'Failed to get conversation');
  }
}

// Update conversation status
async function updateConversationStatus(req, res) {
  try {
    const { conversationId } = req.params;
    const { status, resolutionStatus, internalNotes } = req.body;

    if (!status) {
      return sendValidationError(res, { status: 'Required' });
    }

    const validStatuses = ['open', 'in_progress', 'waiting_for_customer', 'waiting_for_agent', 'resolved', 'closed', 'escalated'];
    if (!validStatuses.includes(status)) {
      return sendValidationError(res, { status: 'Invalid status' });
    }

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];

    const can = await supportEmployerService.userCanManageBusiness(
      conversation.business_id,
      req.user.id
    );
    if (!can) return sendError(res, 403, 'Access denied');

    // Update status
    let updateSql = `
      UPDATE support_conversations
      SET status = $1, updated_at = CURRENT_TIMESTAMP
    `;
    const params = [status];

    if (status === 'resolved' || status === 'closed') {
      updateSql += `, resolved_at = CURRENT_TIMESTAMP, resolution_status = $${params.length + 1}`;
      params.push(resolutionStatus || 'resolved');
    }

    if (internalNotes) {
      updateSql += `, internal_notes = $${params.length + 1}`;
      params.push(internalNotes);
    }

    updateSql += ` WHERE id = $${params.length + 1} RETURNING *`;
    params.push(conversationId);

    const result = await query(updateSql, params);

    logger.info('Conversation status updated', { conversationId, status });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('updateConversationStatus error', { error: err.message });
    sendError(res, 500, 'Failed to update conversation');
  }
}

// Add message to conversation
async function addMessage(req, res) {
  try {
    const { conversationId } = req.params;
    const { content, messageType = 'text', attachmentUrl, attachmentName } = req.body;

    if (!content) {
      return sendValidationError(res, { content: 'Required' });
    }

    // Get conversation
    const convResult = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
    );
    if (!convResult.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = convResult.rows[0];

    let isAssignedAgent = false;
    if (conversation.agent_id) {
      const ag = await query('SELECT user_id FROM support_agents WHERE id = $1', [conversation.agent_id]);
      isAssignedAgent = ag.rows.length && ag.rows[0].user_id === req.user.id;
    }
    if (req.user.id !== conversation.customer_id && !isAssignedAgent) {
      const can = await supportEmployerService.userCanManageBusiness(
        conversation.business_id,
        req.user.id
      );
      if (!can) return sendError(res, 403, 'Access denied');
    }

    const isAgent = isAssignedAgent;

    // Add message
    const result = await query(
      `INSERT INTO support_conversation_messages
       (conversation_id, sender_id, message_type, content, attachment_url, attachment_name, is_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [conversationId, req.user.id, messageType, content, attachmentUrl || null, attachmentName || null, isAgent]
    );

    // Update conversation message counts
    const countCol = isAgent ? 'agent_message_count' : 'customer_message_count';
    await query(
      `UPDATE support_conversations
       SET message_count = message_count + 1, ${countCol} = ${countCol} + 1
       WHERE id = $1`,
      [conversationId]
    );

    // Auto-transition status if customer sends message while waiting_for_customer
    if (!isAgent && conversation.status === 'waiting_for_customer') {
      await query(
        'UPDATE support_conversations SET status = $1 WHERE id = $2',
        ['in_progress', conversationId]
      );
    }

    logger.info('Message added to conversation', {
      conversationId,
      isAgent,
      messageType
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('addMessage error', { error: err.message });
    sendError(res, 500, 'Failed to add message');
  }
}

// Get conversation stats for a business
async function getConversationStats(req, res) {
  try {
    const { businessId } = req.params;

    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    const result = await query(
      `SELECT
        COUNT(*) as total_conversations,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_conversations,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_conversations,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_conversations,
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_resolution_hours
      FROM support_conversations
      WHERE business_id = $1`,
      [businessId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('getConversationStats error', { error: err.message });
    sendError(res, 500, 'Failed to get stats');
  }
}

module.exports = {
  createConversation,
  listConversations,
  getConversation,
  updateConversationStatus,
  addMessage,
  getConversationStats
};
