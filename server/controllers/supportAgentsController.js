// Support Agents Controller
// Manages agent lifecycle: hiring, onboarding, status changes, availability tracking

const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

// Get all agents for a business
async function listAgents(req, res) {
  try {
    const { businessId } = req.params;
    const { status, role, department } = req.query;

    // Verify user has access to this business
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [businessId, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length) return sendError(res, 403, 'Access denied');

    let sql = `
      SELECT
        sa.id, sa.business_id, sa.user_id,
        u.name, u.email, u.avatar_url,
        sa.hire_date, sa.status, sa.role, sa.department,
        sa.max_concurrent_chats, sa.is_available,
        sa.total_conversations_handled, sa.total_resolved_count,
        sa.avg_rating, sa.created_at, sa.updated_at
      FROM support_agents sa
      JOIN users u ON sa.user_id = u.id
      WHERE sa.business_id = $1
    `;
    const params = [businessId];

    if (status) {
      sql += ` AND sa.status = $${params.length + 1}`;
      params.push(status);
    }
    if (role) {
      sql += ` AND sa.role = $${params.length + 1}`;
      params.push(role);
    }
    if (department) {
      sql += ` AND sa.department = $${params.length + 1}`;
      params.push(department);
    }

    sql += ' ORDER BY sa.created_at DESC';

    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('listAgents error', { error: err.message });
    sendError(res, 500, 'Failed to list agents');
  }
}

// Get single agent details
async function getAgent(req, res) {
  try {
    const { agentId } = req.params;

    const result = await query(
      `SELECT
        sa.id, sa.business_id, sa.user_id,
        u.name, u.email, u.avatar_url,
        sa.hire_date, sa.status, sa.role, sa.department,
        sa.max_concurrent_chats, sa.is_available,
        sa.total_conversations_handled, sa.total_resolved_count,
        sa.avg_rating, sa.created_at, sa.updated_at
      FROM support_agents sa
      JOIN users u ON sa.user_id = u.id
      WHERE sa.id = $1`,
      [agentId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Agent not found');

    const agent = result.rows[0];

    // Verify access (business owner/admin or the agent themselves)
    if (req.user.id !== agent.user_id) {
      const access = await query(
        'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
        [agent.business_id, req.user.id, JSON.stringify([req.user.id])]
      );
      if (!access.rows.length) return sendError(res, 403, 'Access denied');
    }

    // Get agent skills
    const skillsResult = await query(
      `SELECT skill_name, proficiency_level, years_of_experience, verified
       FROM agent_skills WHERE agent_id = $1 ORDER BY skill_name`,
      [agentId]
    );

    res.json({
      success: true,
      data: {
        ...agent,
        skills: skillsResult.rows
      }
    });
  } catch (err) {
    logger.error('getAgent error', { error: err.message });
    sendError(res, 500, 'Failed to get agent');
  }
}

// Hire a new agent (approve application)
async function hireAgent(req, res) {
  try {
    const { applicationId } = req.params;
    const { businessId } = req.body;

    if (!businessId) {
      return sendValidationError(res, { businessId: 'Required' });
    }

    // Verify user is business owner/admin
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [businessId, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length) return sendError(res, 403, 'Access denied');

    // Get application
    const appResult = await query(
      'SELECT * FROM agent_applications WHERE id = $1 AND business_id = $2',
      [applicationId, businessId]
    );
    if (!appResult.rows.length) return sendError(res, 404, 'Application not found');

    const app = appResult.rows[0];
    if (app.status !== 'pending') {
      return sendError(res, 400, 'Application already processed');
    }

    // Check if user is already an agent for this business
    const existing = await query(
      'SELECT id FROM support_agents WHERE user_id = $1 AND business_id = $2',
      [app.user_id, businessId]
    );
    if (existing.rows.length) {
      return sendError(res, 400, 'User is already an agent');
    }

    // Create agent record
    const agentResult = await query(
      `INSERT INTO support_agents
       (business_id, user_id, hire_date, status, role)
       VALUES ($1, $2, CURRENT_TIMESTAMP, 'active', 'agent')
       RETURNING *`,
      [businessId, app.user_id]
    );

    // Update application status
    await query(
      `UPDATE agent_applications
       SET status = 'hired', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [req.user.id, applicationId]
    );

    logger.info('Agent hired', { agentId: agentResult.rows[0].id, userId: app.user_id });

    res.json({ success: true, data: agentResult.rows[0] });
  } catch (err) {
    logger.error('hireAgent error', { error: err.message });
    sendError(res, 500, 'Failed to hire agent');
  }
}

// Update agent status (active, inactive, paused, training)
async function updateAgentStatus(req, res) {
  try {
    const { agentId } = req.params;
    const { status } = req.body;

    const validStatuses = ['active', 'inactive', 'paused', 'training'];
    if (!validStatuses.includes(status)) {
      return sendValidationError(res, { status: 'Invalid status' });
    }

    // Get agent and verify access
    const agentResult = await query(
      'SELECT business_id FROM support_agents WHERE id = $1',
      [agentId]
    );
    if (!agentResult.rows.length) return sendError(res, 404, 'Agent not found');

    const { business_id } = agentResult.rows[0];
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [business_id, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length) return sendError(res, 403, 'Access denied');

    // Update status
    const result = await query(
      `UPDATE support_agents SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [status, agentId]
    );

    logger.info('Agent status updated', { agentId, status });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('updateAgentStatus error', { error: err.message });
    sendError(res, 500, 'Failed to update agent status');
  }
}

// Set agent availability (available/busy)
async function setAgentAvailability(req, res) {
  try {
    const { agentId } = req.params;
    const { isAvailable, reason } = req.body;

    if (typeof isAvailable !== 'boolean') {
      return sendValidationError(res, { isAvailable: 'Must be boolean' });
    }

    // Get agent
    const agentResult = await query(
      'SELECT * FROM support_agents WHERE id = $1',
      [agentId]
    );
    if (!agentResult.rows.length) return sendError(res, 404, 'Agent not found');

    const agent = agentResult.rows[0];

    // Verify access (agent themselves or manager)
    if (req.user.id !== agent.user_id) {
      const access = await query(
        'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
        [agent.business_id, req.user.id, JSON.stringify([req.user.id])]
      );
      if (!access.rows.length) return sendError(res, 403, 'Access denied');
    }

    // Update availability
    const result = await query(
      `UPDATE support_agents SET is_available = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [isAvailable, agentId]
    );

    // Log availability change
    const status = isAvailable ? 'available' : 'offline';
    await query(
      `INSERT INTO agent_availability_log (agent_id, status, reason)
       VALUES ($1, $2, $3)`,
      [agentId, status, reason || null]
    );

    logger.info('Agent availability changed', { agentId, isAvailable });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('setAgentAvailability error', { error: err.message });
    sendError(res, 500, 'Failed to set availability');
  }
}

// Add skill to agent
async function addAgentSkill(req, res) {
  try {
    const { agentId } = req.params;
    const { skillName, proficiencyLevel, yearsOfExperience } = req.body;

    if (!skillName) {
      return sendValidationError(res, { skillName: 'Required' });
    }

    const validLevels = ['beginner', 'intermediate', 'expert'];
    if (proficiencyLevel && !validLevels.includes(proficiencyLevel)) {
      return sendValidationError(res, { proficiencyLevel: 'Invalid level' });
    }

    // Check agent exists
    const agentResult = await query(
      'SELECT id FROM support_agents WHERE id = $1',
      [agentId]
    );
    if (!agentResult.rows.length) return sendError(res, 404, 'Agent not found');

    // Insert or update skill
    const result = await query(
      `INSERT INTO agent_skills (agent_id, skill_name, proficiency_level, years_of_experience)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (agent_id, skill_name) DO UPDATE SET
        proficiency_level = $3,
        years_of_experience = $4
       RETURNING *`,
      [agentId, skillName, proficiencyLevel || 'intermediate', yearsOfExperience || null]
    );

    logger.info('Skill added to agent', { agentId, skillName });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('addAgentSkill error', { error: err.message });
    sendError(res, 500, 'Failed to add skill');
  }
}

// Get agent availability log
async function getAvailabilityLog(req, res) {
  try {
    const { agentId } = req.params;
    const { limit = 50 } = req.query;

    const result = await query(
      `SELECT * FROM agent_availability_log
       WHERE agent_id = $1
       ORDER BY status_changed_at DESC
       LIMIT $2`,
      [agentId, parseInt(limit)]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getAvailabilityLog error', { error: err.message });
    sendError(res, 500, 'Failed to get availability log');
  }
}

module.exports = {
  listAgents,
  getAgent,
  hireAgent,
  updateAgentStatus,
  setAgentAvailability,
  addAgentSkill,
  getAvailabilityLog
};
