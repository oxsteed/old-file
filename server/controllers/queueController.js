// Queue Controller
// Manages support queue: FIFO routing, queue status, next available agent routing

const { query } = require('../utils/db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

// Get queue status for a business
async function getQueueStatus(req, res) {
  try {
    const { businessId } = req.params;

    // Verify access
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [businessId, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length) return sendError(res, 403, 'Access denied');

    // Get queue stats
    const queueStats = await query(
      `SELECT
        COUNT(*) as total_waiting,
        SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent_count,
        SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_count,
        SUM(CASE WHEN priority = 'normal' THEN 1 ELSE 0 END) as normal_count,
        SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END) as low_count,
        MIN(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - sq.queued_at))/60) as longest_wait_minutes
      FROM support_queue sq
      WHERE sq.business_id = $1 AND sq.status = 'waiting'`,
      [businessId]
    );

    // Get available agents
    const agents = await query(
      `SELECT
        COUNT(*) as total_agents,
        SUM(CASE WHEN is_available = true THEN 1 ELSE 0 END) as available_agents,
        SUM(CASE WHEN is_available = false THEN 1 ELSE 0 END) as busy_agents
      FROM support_agents
      WHERE business_id = $1 AND status = 'active'`,
      [businessId]
    );

    // Get next items in queue
    const queueItems = await query(
      `SELECT
        sq.id, sq.conversation_id, sq.priority,
        sc.subject, sc.customer_id, u.name as customer_name,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - sq.queued_at))/60 as wait_minutes
      FROM support_queue sq
      JOIN support_conversations sc ON sq.conversation_id = sc.id
      LEFT JOIN users u ON sc.customer_id = u.id
      WHERE sq.business_id = $1 AND sq.status = 'waiting'
      ORDER BY
        CASE sq.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        sq.queued_at ASC
      LIMIT 10`,
      [businessId]
    );

    res.json({
      success: true,
      data: {
        queueStats: queueStats.rows[0],
        agentStats: agents.rows[0],
        nextInQueue: queueItems.rows
      }
    });
  } catch (err) {
    logger.error('getQueueStatus error', { error: err.message });
    sendError(res, 500, 'Failed to get queue status');
  }
}

// Get next available agent (round-robin FIFO)
async function getNextAvailableAgent(req, res) {
  try {
    const { businessId } = req.params;

    // Find next available agent (priority-based)
    const agents = await query(
      `SELECT
        sa.id, sa.user_id, u.name,
        COUNT(ca.id) as active_chats
      FROM support_agents sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN conversation_assignments ca ON sa.id = ca.agent_id AND ca.status = 'active'
      WHERE sa.business_id = $1
      AND sa.status = 'active'
      AND sa.is_available = true
      GROUP BY sa.id, sa.user_id, u.name, sa.max_concurrent_chats
      HAVING COUNT(ca.id) < sa.max_concurrent_chats
      ORDER BY COUNT(ca.id) ASC, sa.id ASC
      LIMIT 1`,
      [businessId]
    );

    if (!agents.rows.length) {
      return res.json({
        success: true,
        data: null, // No agents available
        message: 'No available agents'
      });
    }

    res.json({ success: true, data: agents.rows[0] });
  } catch (err) {
    logger.error('getNextAvailableAgent error', { error: err.message });
    sendError(res, 500, 'Failed to get next agent');
  }
}

// Route next conversation from queue to available agent
async function routeNextConversation(req, res) {
  try {
    const { businessId } = req.params;

    // Get next waiting conversation (by priority, then FIFO)
    const convResult = await query(
      `SELECT sq.id as queue_id, sq.conversation_id
      FROM support_queue sq
      WHERE sq.business_id = $1 AND sq.status = 'waiting'
      ORDER BY
        CASE sq.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        sq.queued_at ASC
      LIMIT 1`,
      [businessId]
    );

    if (!convResult.rows.length) {
      return res.json({
        success: true,
        data: null,
        message: 'No conversations in queue'
      });
    }

    const { conversation_id } = convResult.rows[0];

    // Get next available agent
    const agents = await query(
      `SELECT
        sa.id, sa.user_id, u.name,
        COUNT(ca.id) as active_chats
      FROM support_agents sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN conversation_assignments ca ON sa.id = ca.agent_id AND ca.status = 'active'
      WHERE sa.business_id = $1
      AND sa.status = 'active'
      AND sa.is_available = true
      GROUP BY sa.id, sa.user_id, u.name, sa.max_concurrent_chats
      HAVING COUNT(ca.id) < sa.max_concurrent_chats
      ORDER BY COUNT(ca.id) ASC, sa.id ASC
      LIMIT 1`,
      [businessId]
    );

    if (!agents.rows.length) {
      return res.json({
        success: true,
        data: null,
        message: 'No available agents'
      });
    }

    const agent = agents.rows[0];

    // Assign conversation to agent
    const assignment = await query(
      `INSERT INTO conversation_assignments
       (conversation_id, agent_id, business_id, assignment_type, claimed_at, status)
       VALUES ($1, $2, $3, 'auto', CURRENT_TIMESTAMP, 'active')
       RETURNING *`,
      [conversation_id, agent.id, businessId]
    );

    // Update conversation
    await query(
      `UPDATE support_conversations
       SET agent_id = $1, status = 'in_progress', assigned_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [agent.id, conversation_id]
    );

    // Update queue
    await query(
      `UPDATE support_queue
       SET status = 'assigned', routed_to_agent_id = $1, claimed_at = CURRENT_TIMESTAMP
       WHERE conversation_id = $2`,
      [agent.id, conversation_id]
    );

    logger.info('Conversation routed to agent', {
      conversationId: conversation_id,
      agentId: agent.id
    });

    res.json({
      success: true,
      data: {
        assignment: assignment.rows[0],
        agent: agent
      }
    });
  } catch (err) {
    logger.error('routeNextConversation error', { error: err.message });
    sendError(res, 500, 'Failed to route conversation');
  }
}

// Remove conversation from queue
async function removeFromQueue(req, res) {
  try {
    const { conversationId } = req.params;
    const { reason } = req.body;

    const result = await query(
      `UPDATE support_queue
       SET status = 'removed', removed_at = CURRENT_TIMESTAMP, reason_removed = $1
       WHERE conversation_id = $2
       RETURNING *`,
      [reason || 'unknown', conversationId]
    );

    if (!result.rows.length) {
      return sendError(res, 404, 'Queue item not found');
    }

    logger.info('Removed from queue', { conversationId, reason });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('removeFromQueue error', { error: err.message });
    sendError(res, 500, 'Failed to remove from queue');
  }
}

// Get queue analytics
async function getQueueAnalytics(req, res) {
  try {
    const { businessId } = req.params;
    const { hours = 24 } = req.query;

    // Verify access
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [businessId, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length) return sendError(res, 403, 'Access denied');

    // Get analytics
    const analytics = await query(
      `SELECT
        COUNT(*) as total_conversations_routed,
        AVG(EXTRACT(EPOCH FROM (claimed_at - queued_at))/60) as avg_wait_to_agent_minutes,
        MIN(EXTRACT(EPOCH FROM (claimed_at - queued_at))/60) as min_wait_minutes,
        MAX(EXTRACT(EPOCH FROM (claimed_at - queued_at))/60) as max_wait_minutes,
        SUM(CASE WHEN routing_strategy = 'round_robin' THEN 1 ELSE 0 END) as round_robin_count,
        SUM(CASE WHEN routing_strategy = 'skill_based' THEN 1 ELSE 0 END) as skill_based_count,
        SUM(CASE WHEN routing_strategy = 'manual' THEN 1 ELSE 0 END) as manual_count
      FROM support_queue
      WHERE business_id = $1
      AND claimed_at > CURRENT_TIMESTAMP - INTERVAL '1 hour' * $2`,
      [businessId, parseInt(hours)]
    );

    res.json({ success: true, data: analytics.rows[0] });
  } catch (err) {
    logger.error('getQueueAnalytics error', { error: err.message });
    sendError(res, 500, 'Failed to get analytics');
  }
}

module.exports = {
  getQueueStatus,
  getNextAvailableAgent,
  routeNextConversation,
  removeFromQueue,
  getQueueAnalytics
};
