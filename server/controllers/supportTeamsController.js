const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

async function createTeam(req, res) {
  try {
    const { businessId } = req.params;
    const { teamName, teamType, description, managerId } = req.body;

    if (!teamName) {
      return sendValidationError(res, { teamName: 'Required' });
    }

    const result = await query(
      `INSERT INTO support_teams
       (business_id, team_name, team_type, description, manager_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [businessId, teamName, teamType || null, description || null, managerId || null]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('createTeam error', { error: err.message });
    sendError(res, 500, 'Failed to create team');
  }
}

async function listTeams(req, res) {
  try {
    const { businessId } = req.params;

    const result = await query(
      'SELECT * FROM support_teams WHERE business_id = $1 AND is_active = true ORDER BY team_name',
      [businessId]
    );

    const teams = [];
    for (const team of result.rows) {
      const members = await query(
        'SELECT * FROM team_members WHERE team_id = $1 AND is_active = true',
        [team.id]
      );
      const skills = await query(
        'SELECT * FROM team_skills WHERE team_id = $1',
        [team.id]
      );
      teams.push({ ...team, members: members.rows, skills: skills.rows });
    }

    res.json({ success: true, data: teams });
  } catch (err) {
    logger.error('listTeams error', { error: err.message });
    sendError(res, 500, 'Failed to list teams');
  }
}

async function updateTeam(req, res) {
  try {
    const { teamId } = req.params;
    const { teamName, description, managerId } = req.body;

    const result = await query(
      `UPDATE support_teams
       SET team_name = COALESCE($1, team_name),
           description = COALESCE($2, description),
           manager_id = COALESCE($3, manager_id)
       WHERE id = $4 RETURNING *`,
      [teamName || null, description || null, managerId || null, teamId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Team not found');
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('updateTeam error', { error: err.message });
    sendError(res, 500, 'Failed to update team');
  }
}

async function addMember(req, res) {
  try {
    const { teamId } = req.params;
    const { agentId, role } = req.body;

    if (!agentId) {
      return sendValidationError(res, { agentId: 'Required' });
    }

    const result = await query(
      `INSERT INTO team_members (team_id, agent_id, role, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING *`,
      [teamId, agentId, role || 'member']
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('addMember error', { error: err.message });
    sendError(res, 500, 'Failed to add member');
  }
}

async function removeMember(req, res) {
  try {
    const { memberId } = req.params;

    const result = await query(
      `UPDATE team_members SET is_active = false, left_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [memberId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Member not found');
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('removeMember error', { error: err.message });
    sendError(res, 500, 'Failed to remove member');
  }
}

async function addSkill(req, res) {
  try {
    const { teamId } = req.params;
    const { skillName, minProficiencyLevel, isPrimary } = req.body;

    if (!skillName) {
      return sendValidationError(res, { skillName: 'Required' });
    }

    const result = await query(
      `INSERT INTO team_skills (team_id, skill_name, min_proficiency_level, is_primary)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [teamId, skillName, minProficiencyLevel || 'intermediate', isPrimary || false]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('addSkill error', { error: err.message });
    sendError(res, 500, 'Failed to add skill');
  }
}

async function getTeamMetrics(req, res) {
  try {
    const { teamId } = req.params;
    const { days = 30 } = req.query;

    const result = await query(
      `SELECT
        COUNT(*) as total_members,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_members
      FROM team_members
      WHERE team_id = $1`,
      [teamId]
    );

    const performance = await query(
      `SELECT
        SUM(conversations_handled) as total_conversations,
        SUM(conversations_resolved) as total_resolved,
        ROUND(AVG(avg_csat_score), 2) as avg_csat,
        ROUND(100.0 * AVG(sla_compliance_percent), 2) as sla_compliance
      FROM team_daily_performance
      WHERE team_id = $1 AND performance_date > CURRENT_DATE - INTERVAL '1 day' * $2`,
      [teamId, parseInt(days)]
    );

    res.json({
      success: true,
      data: {
        members: result.rows[0],
        performance: performance.rows[0]
      }
    });
  } catch (err) {
    logger.error('getTeamMetrics error', { error: err.message });
    sendError(res, 500, 'Failed to get team metrics');
  }
}

module.exports = {
  createTeam, listTeams, updateTeam, addMember, removeMember,
  addSkill, getTeamMetrics
};
