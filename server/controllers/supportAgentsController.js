// Support Agents Controller
// Manages agent lifecycle: hiring, onboarding, status changes, availability tracking

const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');

async function listAgents(req, res) {
  try {
    const { businessId } = req.params;
    const { status, role, department } = req.query;

    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    const employerId = await supportEmployerService.ensureBusinessEmployer(businessId);

    let sql = `
      SELECT
        sa.id, sa.employer_id, sa.business_id, sa.user_id,
        u.name, u.email, u.avatar_url,
        sa.hire_date, sa.status, sa.role, sa.department,
        sa.max_concurrent_chats, sa.is_available,
        sa.total_conversations_handled, sa.total_resolved_count,
        sa.avg_rating, sa.created_at, sa.updated_at
      FROM support_agents sa
      JOIN users u ON sa.user_id = u.id
      WHERE sa.employer_id = $1
    `;
    const params = [employerId];

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
    res.json({ success: true, agents: result.rows, data: result.rows });
  } catch (err) {
    logger.error('listAgents error', { error: err.message });
    sendError(res, 500, 'Failed to list agents');
  }
}

async function getAgent(req, res) {
  try {
    const { agentId } = req.params;

    const result = await query(
      `SELECT
        sa.id, sa.employer_id, sa.business_id, sa.user_id,
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

    if (req.user.id !== agent.user_id) {
      const canManage = await supportEmployerService.userCanManageEmployer(
        agent.employer_id,
        req.user.id,
        req.user.role
      );
      if (!canManage) return sendError(res, 403, 'Access denied');
    }

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

async function hireAgent(req, res) {
  try {
    const { applicationId } = req.params;
    const { businessId } = req.body;

    if (!businessId) {
      return sendValidationError(res, { businessId: 'Required' });
    }

    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    const employerId = await supportEmployerService.ensureBusinessEmployer(businessId);

    const appResult = await query(
      'SELECT * FROM agent_applications WHERE id = $1 AND employer_id = $2',
      [applicationId, employerId]
    );
    if (!appResult.rows.length) return sendError(res, 404, 'Application not found');

    const app = appResult.rows[0];
    if (app.status !== 'pending') {
      return sendError(res, 400, 'Application already processed');
    }

    const existing = await query(
      'SELECT id FROM support_agents WHERE user_id = $1 AND employer_id = $2',
      [app.user_id, employerId]
    );
    if (existing.rows.length) {
      return sendError(res, 400, 'User is already an agent');
    }

    const agentResult = await query(
      `INSERT INTO support_agents
       (employer_id, business_id, user_id, hire_date, status, role)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'active', 'agent')
       RETURNING *`,
      [employerId, businessId, app.user_id]
    );

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

async function updateAgentStatus(req, res) {
  try {
    const { agentId } = req.params;
    const { status } = req.body;

    const validStatuses = ['active', 'inactive', 'paused', 'training'];
    if (!validStatuses.includes(status)) {
      return sendValidationError(res, { status: 'Invalid status' });
    }

    const agentResult = await query(
      'SELECT employer_id FROM support_agents WHERE id = $1',
      [agentId]
    );
    if (!agentResult.rows.length) return sendError(res, 404, 'Agent not found');

    const { employer_id: employerId } = agentResult.rows[0];
    const canManage = await supportEmployerService.userCanManageEmployer(
      employerId,
      req.user.id,
      req.user.role
    );
    if (!canManage) return sendError(res, 403, 'Access denied');

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

async function setAgentAvailability(req, res) {
  try {
    const { agentId } = req.params;
    const { isAvailable, reason } = req.body;

    if (typeof isAvailable !== 'boolean') {
      return sendValidationError(res, { isAvailable: 'Must be boolean' });
    }

    const agentResult = await query(
      'SELECT * FROM support_agents WHERE id = $1',
      [agentId]
    );
    if (!agentResult.rows.length) return sendError(res, 404, 'Agent not found');

    const agent = agentResult.rows[0];

    if (req.user.id !== agent.user_id) {
      const canManage = await supportEmployerService.userCanManageEmployer(
        agent.employer_id,
        req.user.id,
        req.user.role
      );
      if (!canManage) return sendError(res, 403, 'Access denied');
    }

    const result = await query(
      `UPDATE support_agents SET is_available = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [isAvailable, agentId]
    );

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

    const agentResult = await query(
      'SELECT id FROM support_agents WHERE id = $1',
      [agentId]
    );
    if (!agentResult.rows.length) return sendError(res, 404, 'Agent not found');

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

async function getAvailabilityLog(req, res) {
  try {
    const { agentId } = req.params;
    const { limit = 50 } = req.query;

    const result = await query(
      `SELECT * FROM agent_availability_log
       WHERE agent_id = $1
       ORDER BY status_changed_at DESC
       LIMIT $2`,
      [agentId, parseInt(limit, 10)]
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
