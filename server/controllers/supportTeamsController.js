const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');

async function canAccessBusiness(req, businessId, manage = false) {
  if (!businessId) return false;
  if (supportEmployerService.isPlatformAdmin(req.user?.role)) return true;
  return manage
    ? supportEmployerService.userCanAdministrateBusiness(businessId, req.user.id)
    : supportEmployerService.userCanAccessBusinessConversations(businessId, req.user.id, req.user.role);
}

async function getTeamForBusiness(teamId, businessId) {
  const result = await query(
    'SELECT * FROM support_teams WHERE id = $1 AND business_id = $2 AND is_active = true',
    [teamId, businessId]
  );
  return result.rows[0] || null;
}

async function createTeam(req, res) {
  try {
    const { businessId } = req.params;
    const { teamName, teamType, description, managerId } = req.body;

    if (!(await canAccessBusiness(req, businessId, true))) return sendError(res, 403, 'Access denied');
    if (!teamName || String(teamName).trim().length > 120 || (teamType != null && String(teamType).length > 50) || (description != null && String(description).length > 5000)) {
      return sendValidationError(res, { teamName: 'Required and must be 120 characters or fewer' });
    }

    const result = await query(
      `INSERT INTO support_teams
       (business_id, team_name, team_type, description, manager_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [businessId, String(teamName).trim(), teamType ? String(teamType).trim() : null, description ? String(description).trim() : null, managerId || null]
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

    if (!(await canAccessBusiness(req, businessId))) return sendError(res, 403, 'Access denied');

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
    const { businessId, teamId } = req.params;
    const { teamName, description, managerId } = req.body;

    if (!(await getTeamForBusiness(teamId, businessId))) return sendError(res, 404, 'Team not found');
    if (!(await canAccessBusiness(req, businessId, true))) return sendError(res, 403, 'Access denied');
    if ((teamName != null && String(teamName).trim().length > 120) || (description != null && String(description).length > 5000)) {
      return sendValidationError(res, { teamName: 'Must be 120 characters or fewer', description: 'Must be 5000 characters or fewer' });
    }

    const result = await query(
      `UPDATE support_teams
       SET team_name = COALESCE($1, team_name),
           description = COALESCE($2, description),
           manager_id = COALESCE($3, manager_id)
      WHERE id = $4 AND business_id = $5 RETURNING *`,
      [teamName != null ? String(teamName).trim() || null : null, description != null ? String(description).trim() || null : null, managerId || null, teamId, businessId]
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
    const { businessId, teamId } = req.params;
    const { agentId, role } = req.body;

    if (!(await getTeamForBusiness(teamId, businessId))) return sendError(res, 404, 'Team not found');
    if (!(await canAccessBusiness(req, businessId, true))) return sendError(res, 403, 'Access denied');
    if (!agentId || (role != null && !['member', 'lead', 'supervisor', 'manager'].includes(String(role).toLowerCase()))) {
      return sendValidationError(res, { agentId: 'Required', role: 'Invalid team member role' });
    }

    const agent = await query(
      `SELECT sa.id FROM support_agents sa
       JOIN support_employers se ON se.id = sa.employer_id
       WHERE sa.id = $1 AND sa.status = 'active'
         AND (se.kind = 'platform' OR se.business_id = $2)
       LIMIT 1`,
      [agentId, businessId]
    );
    if (!agent.rows.length) return sendError(res, 400, 'Agent is not active for this business');

    const result = await query(
      `INSERT INTO team_members (team_id, agent_id, role, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING *`,
      [teamId, agentId, role ? String(role).toLowerCase() : 'member']
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('addMember error', { error: err.message });
    sendError(res, 500, 'Failed to add member');
  }
}

async function removeMember(req, res) {
  try {
    const { businessId, memberId } = req.params;

    const member = await query(
      `SELECT tm.id, st.business_id
       FROM team_members tm JOIN support_teams st ON st.id = tm.team_id
       WHERE tm.id = $1 AND st.business_id = $2`,
      [memberId, businessId]
    );
    if (!member.rows.length) return sendError(res, 404, 'Member not found');
    if (!(await canAccessBusiness(req, businessId, true))) return sendError(res, 403, 'Access denied');

    const result = await query(
      `UPDATE team_members SET is_active = false, left_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND EXISTS (
         SELECT 1 FROM support_teams st WHERE st.id = team_members.team_id AND st.business_id = $2
       ) RETURNING *`,
      [memberId, businessId]
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
    const { businessId, teamId } = req.params;
    const { skillName, minProficiencyLevel, isPrimary } = req.body;

    if (!(await getTeamForBusiness(teamId, businessId))) return sendError(res, 404, 'Team not found');
    if (!(await canAccessBusiness(req, businessId, true))) return sendError(res, 403, 'Access denied');
    if (!skillName || String(skillName).trim().length > 100 || (minProficiencyLevel != null && !['beginner', 'intermediate', 'advanced', 'expert'].includes(String(minProficiencyLevel).toLowerCase()))) {
      return sendValidationError(res, { skillName: 'Required and must be 100 characters or fewer', minProficiencyLevel: 'Invalid proficiency level' });
    }

    const result = await query(
      `INSERT INTO team_skills (team_id, skill_name, min_proficiency_level, is_primary)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [teamId, String(skillName).trim(), minProficiencyLevel ? String(minProficiencyLevel).toLowerCase() : 'intermediate', isPrimary === true]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('addSkill error', { error: err.message });
    sendError(res, 500, 'Failed to add skill');
  }
}

async function getTeamMetrics(req, res) {
  try {
    const { businessId, teamId } = req.params;
    const { days = 30 } = req.query;

    if (!(await getTeamForBusiness(teamId, businessId))) return sendError(res, 404, 'Team not found');
    if (!(await canAccessBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    const boundedDays = Math.min(365, Math.max(1, Number.parseInt(days, 10) || 30));

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
      [teamId, boundedDays]
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
