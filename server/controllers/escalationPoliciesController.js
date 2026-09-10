const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');

async function canManageBusiness(req, businessId) {
  if (!businessId) return false;
  if (supportEmployerService.isPlatformAdmin(req.user?.role)) return true;
  return supportEmployerService.userCanAdministrateBusiness(businessId, req.user.id);
}

async function canAccessBusiness(req, businessId) {
  if (!businessId) return false;
  if (supportEmployerService.isPlatformAdmin(req.user?.role)) return true;
  return supportEmployerService.userCanAccessBusinessConversations(businessId, req.user.id, req.user.role);
}

async function getPolicyForBusiness(policyId, businessId) {
  const result = await query(
    'SELECT * FROM escalation_policies WHERE id = $1 AND business_id = $2',
    [policyId, businessId]
  );
  return result.rows[0] || null;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function createPolicy(req, res) {
  try {
    const { businessId } = req.params;
    const { policyName, triggerCondition, escalationDelayMinutes, maxEscalationSteps, steps } = req.body;

    if (!(await canManageBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    if (!policyName || !triggerCondition || String(policyName).trim().length > 120 || String(triggerCondition).trim().length > 120 || (steps != null && (!Array.isArray(steps) || steps.length > 20))) {
      return sendValidationError(res, { policyName: 'Required and must be 120 characters or fewer', triggerCondition: 'Required and must be 120 characters or fewer', steps: 'Must be an array with no more than 20 steps' });
    }
    if (steps?.some((step) => {
      const waitMinutes = Number(step?.waitMinutes ?? 5);
      return !step || !Number.isInteger(waitMinutes) || waitMinutes < 1 || waitMinutes > 1440 || (step.notifyMethod != null && String(step.notifyMethod).length > 50);
    })) {
      return sendValidationError(res, { steps: 'Each step must contain valid waitMinutes and notifyMethod values' });
    }

    const policyResult = await query(
      `INSERT INTO escalation_policies
       (business_id, policy_name, trigger_condition, escalation_delay_minutes, max_escalation_steps, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [businessId, String(policyName).trim(), String(triggerCondition).trim(), boundedInteger(escalationDelayMinutes, 5, 1, 1440), boundedInteger(maxEscalationSteps, 3, 1, 20)]
    );

    const policyId = policyResult.rows[0].id;

    if (steps && steps.length) {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await query(
          `INSERT INTO escalation_steps
           (policy_id, step_number, escalate_to_team_id, escalate_to_agent_id, escalate_to_manager, wait_minutes, notify_method)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [policyId, i + 1, step.teamId || null, step.agentId || null, step.toManager === true,
           boundedInteger(step.waitMinutes, 5, 1, 1440), step.notifyMethod ? String(step.notifyMethod).trim() : 'email']
        );
      }
    }

    res.json({ success: true, data: policyResult.rows[0] });
  } catch (err) {
    logger.error('createPolicy error', { error: err.message });
    sendError(res, 500, 'Failed to create policy');
  }
}

async function listPolicies(req, res) {
  try {
    const { businessId } = req.params;

    if (!(await canManageBusiness(req, businessId))) return sendError(res, 403, 'Access denied');

    const result = await query(
      'SELECT * FROM escalation_policies WHERE business_id = $1 ORDER BY created_at DESC',
      [businessId]
    );

    const policies = [];
    for (const policy of result.rows) {
      const stepsResult = await query(
        'SELECT * FROM escalation_steps WHERE policy_id = $1 ORDER BY step_number',
        [policy.id]
      );
      policies.push({ ...policy, steps: stepsResult.rows });
    }

    res.json({ success: true, data: policies });
  } catch (err) {
    logger.error('listPolicies error', { error: err.message });
    sendError(res, 500, 'Failed to list policies');
  }
}

async function updatePolicy(req, res) {
  try {
    const { businessId, policyId } = req.params;
    const { policyName, isActive } = req.body;

    if (!(await getPolicyForBusiness(policyId, businessId))) return sendError(res, 404, 'Policy not found');
    if (!(await canManageBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    if (policyName != null && String(policyName).trim().length > 120) {
      return sendValidationError(res, { policyName: 'Must be 120 characters or fewer' });
    }
    if (isActive != null && typeof isActive !== 'boolean') {
      return sendValidationError(res, { isActive: 'Must be a boolean' });
    }

    const result = await query(
      `UPDATE escalation_policies
       SET policy_name = COALESCE($1, policy_name),
           is_active = COALESCE($2, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND business_id = $4 RETURNING *`,
      [policyName != null ? String(policyName).trim() || null : null, isActive !== undefined ? isActive : null, policyId, businessId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Policy not found');
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('updatePolicy error', { error: err.message });
    sendError(res, 500, 'Failed to update policy');
  }
}

async function deletePolicy(req, res) {
  try {
    const { businessId, policyId } = req.params;

    if (!(await getPolicyForBusiness(policyId, businessId))) return sendError(res, 404, 'Policy not found');
    if (!(await canManageBusiness(req, businessId))) return sendError(res, 403, 'Access denied');

    await query(
      `DELETE FROM escalation_steps
       WHERE policy_id = $1 AND EXISTS (
         SELECT 1 FROM escalation_policies ep
         WHERE ep.id = escalation_steps.policy_id AND ep.business_id = $2
       )`,
      [policyId, businessId]
    );
    const result = await query(
      'DELETE FROM escalation_policies WHERE id = $1 AND business_id = $2 RETURNING *',
      [policyId, businessId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Policy not found');
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('deletePolicy error', { error: err.message });
    sendError(res, 500, 'Failed to delete policy');
  }
}

async function addStep(req, res) {
  try {
    const { businessId, policyId } = req.params;
    const { stepNumber, teamId, agentId, toManager, waitMinutes, notifyMethod } = req.body;

    if (!(await getPolicyForBusiness(policyId, businessId))) return sendError(res, 404, 'Policy not found');
    if (!(await canManageBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    if (!Number.isInteger(Number(stepNumber)) || Number(stepNumber) < 1 || Number(stepNumber) > 20 || (notifyMethod != null && String(notifyMethod).length > 50)) {
      return sendValidationError(res, { stepNumber: 'Must be an integer from 1 to 20', notifyMethod: 'Must be 50 characters or fewer' });
    }

    const result = await query(
      `INSERT INTO escalation_steps
       (policy_id, step_number, escalate_to_team_id, escalate_to_agent_id, escalate_to_manager, wait_minutes, notify_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [policyId, Number(stepNumber), teamId || null, agentId || null, toManager === true,
       boundedInteger(waitMinutes, 5, 1, 1440), notifyMethod ? String(notifyMethod).trim() : 'email']
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('addStep error', { error: err.message });
    sendError(res, 500, 'Failed to add step');
  }
}

async function triggerEscalation(req, res) {
  try {
    const { businessId, conversationId } = req.params;
    const { policyId, reason } = req.body;

    if (!(await canManageBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    if (!policyId || (reason != null && String(reason).length > 2000)) {
      return sendValidationError(res, { policyId: 'Required', reason: 'Must be 2000 characters or fewer' });
    }

    const conv = await query(
      'SELECT * FROM support_conversations WHERE id = $1 AND business_id = $2',
      [conversationId, businessId]
    );

    if (!conv.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = conv.rows[0];

    const policy = await query(
      'SELECT * FROM escalation_policies WHERE id = $1 AND business_id = $2 AND is_active = true',
      [policyId, businessId]
    );

    if (!policy.rows.length) return sendError(res, 404, 'Policy not found');

    const steps = await query(
      `SELECT es.* FROM escalation_steps es
       JOIN escalation_policies ep ON ep.id = es.policy_id
       WHERE es.policy_id = $1 AND ep.business_id = $2
       ORDER BY es.step_number`,
      [policyId, businessId]
    );

    if (!steps.rows.length) {
      return sendError(res, 400, 'No escalation steps defined');
    }

    const firstStep = steps.rows[0];
    let escalatedToId = null;
    let escalatedToTeamId = null;

    if (firstStep.escalate_to_agent_id) {
      escalatedToId = firstStep.escalate_to_agent_id;
    } else if (firstStep.escalate_to_team_id) {
      escalatedToTeamId = firstStep.escalate_to_team_id;
      const team = await query(
        'SELECT manager_id FROM support_teams WHERE id = $1 AND business_id = $2 AND is_active = true',
        [firstStep.escalate_to_team_id, businessId]
      );
      if (team.rows.length && team.rows[0].manager_id) {
        escalatedToId = team.rows[0].manager_id;
      }
    } else if (firstStep.escalate_to_manager) {
      const employerIds = await supportEmployerService.employerIdsForConversationBusiness(
        conversation.business_id
      );
      const team = await query(
        'SELECT sa.id FROM support_agents sa WHERE sa.role = $1 AND sa.employer_id = ANY($2::uuid[]) LIMIT 1',
        ['manager', employerIds]
      );
      if (team.rows.length) {
        escalatedToId = team.rows[0].id;
      }
    }

    const historyResult = await query(
      `INSERT INTO escalation_history
       (conversation_id, business_id, escalation_policy_id, from_agent_id, to_agent_id, to_team_id, escalation_step_number, escalation_reason)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
       RETURNING *`,
      [conversationId, businessId, policyId, conversation.agent_id, escalatedToId,
       escalatedToTeamId, reason ? String(reason).trim() : null]
    );

    if (escalatedToId) {
      await query(
        'UPDATE support_conversations SET agent_id = $1, status = $2 WHERE id = $3 AND business_id = $4',
        [escalatedToId, 'escalated', conversationId, businessId]
      );
    }

    logger.info('Escalation triggered', { conversationId, policyId });

    res.json({ success: true, data: historyResult.rows[0] });
  } catch (err) {
    logger.error('triggerEscalation error', { error: err.message });
    sendError(res, 500, 'Failed to trigger escalation');
  }
}

async function getEscalationHistory(req, res) {
  try {
    const { businessId, conversationId } = req.params;

    if (!(await canAccessBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    const conversation = await query(
      'SELECT id FROM support_conversations WHERE id = $1 AND business_id = $2',
      [conversationId, businessId]
    );
    if (!conversation.rows.length) return sendError(res, 404, 'Conversation not found');

    const result = await query(
      `SELECT eh.*, u1.name as from_agent_name, u2.name as to_agent_name
       FROM escalation_history eh
       LEFT JOIN support_agents sa1 ON eh.from_agent_id = sa1.id
       LEFT JOIN users u1 ON sa1.user_id = u1.id
       LEFT JOIN support_agents sa2 ON eh.to_agent_id = sa2.id
       LEFT JOIN users u2 ON sa2.user_id = u2.id
       WHERE eh.conversation_id = $1 AND eh.business_id = $2
       ORDER BY eh.created_at DESC`,
      [conversationId, businessId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getEscalationHistory error', { error: err.message });
    sendError(res, 500, 'Failed to get escalation history');
  }
}

module.exports = {
  createPolicy, listPolicies, updatePolicy, deletePolicy,
  addStep, triggerEscalation, getEscalationHistory
};
