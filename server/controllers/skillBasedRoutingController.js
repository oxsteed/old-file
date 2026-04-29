const { query } = require('../utils/db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

async function findAgentBySkills(req, res) {
  try {
    const { businessId } = req.params;
    const { requiredSkills } = req.body;

    if (!requiredSkills || !requiredSkills.length) {
      return sendValidationError(res, { requiredSkills: 'Required array of skills' });
    }

    const result = await query(
      `SELECT
        sa.id, sa.user_id, u.name,
        COUNT(ag.skill_name) as matching_skills,
        AVG(CAST(CASE ag.proficiency_level WHEN 'expert' THEN 3 WHEN 'intermediate' THEN 2 ELSE 1 END AS FLOAT)) as avg_proficiency,
        COUNT(ca.id) as active_chats
      FROM support_agents sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN agent_skills ag ON sa.id = ag.agent_id
      LEFT JOIN conversation_assignments ca ON sa.id = ca.agent_id AND ca.status = 'active'
      WHERE sa.business_id = $1
      AND sa.status = 'active'
      AND sa.is_available = true
      AND (ag.skill_name = ANY($2) OR COUNT(ag.skill_name) = 0)
      GROUP BY sa.id, sa.user_id, u.name
      HAVING COUNT(ag.skill_name) > 0
      ORDER BY COUNT(ag.skill_name) DESC, AVG(CAST(CASE ag.proficiency_level WHEN 'expert' THEN 3 WHEN 'intermediate' THEN 2 ELSE 1 END AS FLOAT)) DESC, COUNT(ca.id) ASC
      LIMIT 1`,
      [businessId, JSON.stringify(requiredSkills)]
    );

    if (!result.rows.length) {
      return res.json({ success: true, data: null, message: 'No agents with required skills' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('findAgentBySkills error', { error: err.message });
    sendError(res, 500, 'Failed to find agent');
  }
}

async function findTeamBySkills(req, res) {
  try {
    const { businessId } = req.params;
    const { requiredSkills } = req.body;

    if (!requiredSkills || !requiredSkills.length) {
      return sendValidationError(res, { requiredSkills: 'Required array of skills' });
    }

    const result = await query(
      `SELECT
        st.id, st.team_name,
        COUNT(DISTINCT ts.skill_name) as matching_skills,
        COUNT(DISTINCT tm.agent_id) as team_size
      FROM support_teams st
      LEFT JOIN team_skills ts ON st.id = ts.team_id
      LEFT JOIN team_members tm ON st.id = tm.team_id AND tm.is_active = true
      WHERE st.business_id = $1
      AND st.is_active = true
      AND (ts.skill_name = ANY($2) OR COUNT(DISTINCT ts.skill_name) = 0)
      GROUP BY st.id, st.team_name
      HAVING COUNT(DISTINCT ts.skill_name) > 0
      ORDER BY COUNT(DISTINCT ts.skill_name) DESC, COUNT(DISTINCT tm.agent_id) DESC
      LIMIT 1`,
      [businessId, JSON.stringify(requiredSkills)]
    );

    if (!result.rows.length) {
      return res.json({ success: true, data: null, message: 'No teams with required skills' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('findTeamBySkills error', { error: err.message });
    sendError(res, 500, 'Failed to find team');
  }
}

async function routeBySkills(req, res) {
  try {
    const { conversationId } = req.params;
    const { requiredSkills } = req.body;

    const conv = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
    );

    if (!conv.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = conv.rows[0];

    const agent = await query(
      `SELECT
        sa.id, sa.user_id, u.name,
        COUNT(ag.skill_name) as matching_skills
      FROM support_agents sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN agent_skills ag ON sa.id = ag.agent_id
      WHERE sa.business_id = $1
      AND sa.status = 'active'
      AND sa.is_available = true
      AND (ag.skill_name = ANY($2) OR COUNT(ag.skill_name) = 0)
      GROUP BY sa.id, sa.user_id, u.name
      HAVING COUNT(ag.skill_name) > 0
      ORDER BY COUNT(ag.skill_name) DESC, sa.id ASC
      LIMIT 1`,
      [conversation.business_id, JSON.stringify(requiredSkills)]
    );

    if (!agent.rows.length) {
      return res.json({ success: true, data: null, message: 'No matching agents' });
    }

    const agentId = agent.rows[0].id;

    const assignment = await query(
      `INSERT INTO conversation_assignments
       (conversation_id, agent_id, business_id, assignment_type, claimed_at, status)
       VALUES ($1, $2, $3, 'auto', CURRENT_TIMESTAMP, 'active')
       RETURNING *`,
      [conversationId, agentId, conversation.business_id]
    );

    await query(
      'UPDATE support_conversations SET agent_id = $1, status = $2 WHERE id = $3',
      [agentId, 'in_progress', conversationId]
    );

    await query(
      `UPDATE support_queue
       SET routed_to_agent_id = $1, routing_strategy = 'skill_based', claimed_at = CURRENT_TIMESTAMP
       WHERE conversation_id = $2`,
      [agentId, conversationId]
    );

    logger.info('Routed by skills', { conversationId, agentId });

    res.json({ success: true, data: { assignment: assignment.rows[0], agent: agent.rows[0] } });
  } catch (err) {
    logger.error('routeBySkills error', { error: err.message });
    sendError(res, 500, 'Failed to route by skills');
  }
}

async function getAgentSkillMatrix(req, res) {
  try {
    const { businessId } = req.params;

    const result = await query(
      `SELECT
        sa.id, sa.user_id, u.name,
        JSON_AGG(JSON_BUILD_OBJECT('skill', ag.skill_name, 'proficiency', ag.proficiency_level, 'years', ag.years_of_experience)) as skills
      FROM support_agents sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN agent_skills ag ON sa.id = ag.agent_id
      WHERE sa.business_id = $1 AND sa.status = 'active'
      GROUP BY sa.id, sa.user_id, u.name
      ORDER BY u.name`,
      [businessId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getAgentSkillMatrix error', { error: err.message });
    sendError(res, 500, 'Failed to get skill matrix');
  }
}

async function getCoverageBySkill(req, res) {
  try {
    const { businessId } = req.params;

    const result = await query(
      `SELECT
        ag.skill_name,
        COUNT(DISTINCT ag.agent_id) as agents_with_skill,
        SUM(CASE WHEN ag.proficiency_level = 'expert' THEN 1 ELSE 0 END) as experts,
        SUM(CASE WHEN ag.proficiency_level = 'intermediate' THEN 1 ELSE 0 END) as intermediate,
        SUM(CASE WHEN ag.proficiency_level = 'beginner' THEN 1 ELSE 0 END) as beginners
      FROM agent_skills ag
      JOIN support_agents sa ON ag.agent_id = sa.id
      WHERE sa.business_id = $1
      GROUP BY ag.skill_name
      ORDER BY COUNT(DISTINCT ag.agent_id) DESC`,
      [businessId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getCoverageBySkill error', { error: err.message });
    sendError(res, 500, 'Failed to get skill coverage');
  }
}

module.exports = {
  findAgentBySkills, findTeamBySkills, routeBySkills,
  getAgentSkillMatrix, getCoverageBySkill
};
