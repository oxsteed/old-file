const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');

async function createPolicy(req, res) {
  try {
    const { businessId } = req.params;
    const { policyName, triggerCondition, escalationDelayMinutes, maxEscalationSteps, steps } = req.body;

    if (!policyName || !triggerCondition) {
      return sendValidationError(res, { policyName: 'Required', triggerCondition: 'Required' });
    }

    const policyResult = await query(
      `INSERT INTO escalation_policies
       (business_id, policy_name, trigger_condition, escalation_delay_minutes, max_escalation_steps, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [businessId, policyName, triggerCondition, escalationDelayMinutes || 5, maxEscalationSteps || 3]
    );

    const policyId = policyResult.rows[0].id;

    if (steps && steps.length) {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await query(
          `INSERT INTO escalation_steps
           (policy_id, step_number, escalate_to_team_id, escalate_to_agent_id, escalate_to_manager, wait_minutes, notify_method)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [policyId, i + 1, step.teamId || null, step.agentId || null, step.toManager || false,
           step.waitMinutes || 5, step.notifyMethod || 'email']
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
    const { policyId } = req.params;
    const { policyName, isActive } = req.body;

    const result = await query(
      `UPDATE escalation_policies
       SET policy_name = COALESCE($1, policy_name),
           is_active = COALESCE($2, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [policyName || null, isActive !== undefined ? isActive : null, policyId]
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
    const { policyId } = req.params;

    await query('DELETE FROM escalation_steps WHERE policy_id = $1', [policyId]);
    const result = await query(
      'DELETE FROM escalation_policies WHERE id = $1 RETURNING *',
      [policyId]
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
    const { policyId } = req.params;
    const { stepNumber, teamId, agentId, toManager, waitMinutes, notifyMethod } = req.body;

    if (stepNumber === undefined) {
      return sendValidationError(res, { stepNumber: 'Required' });
    }

    const result = await query(
      `INSERT INTO escalation_steps
       (policy_id, step_number, escalate_to_team_id, escalate_to_agent_id, escalate_to_manager, wait_minutes, notify_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [policyId, stepNumber, teamId || null, agentId || null, toManager || false, waitMinutes || 5, notifyMethod || 'email']
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('addStep error', { error: err.message });
    sendError(res, 500, 'Failed to add step');
  }
}

async function triggerEscalation(req, res) {
  try {
    const { conversationId } = req.params;
    const { policyId, reason } = req.body;

    const conv = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
    );

    if (!conv.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = conv.rows[0];

    const policy = await query(
      'SELECT * FROM escalation_policies WHERE id = $1',
      [policyId]
    );

    if (!policy.rows.length) return sendError(res, 404, 'Policy not found');

    const steps = await query(
      'SELECT * FROM escalation_steps WHERE policy_id = $1 ORDER BY step_number',
      [policyId]
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
        'SELECT manager_id FROM support_teams WHERE id = $1',
        [firstStep.escalate_to_team_id]
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
      [conversationId, conversation.business_id, policyId, conversation.agent_id, escalatedToId,
       escalatedToTeamId, reason || null]
    );

    if (escalatedToId) {
      await query(
        'UPDATE support_conversations SET agent_id = $1, status = $2 WHERE id = $3',
        [escalatedToId, 'escalated', conversationId]
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
    const { conversationId } = req.params;

    const result = await query(
      `SELECT eh.*, u1.name as from_agent_name, u2.name as to_agent_name
       FROM escalation_history eh
       LEFT JOIN support_agents sa1 ON eh.from_agent_id = sa1.id
       LEFT JOIN users u1 ON sa1.user_id = u1.id
       LEFT JOIN support_agents sa2 ON eh.to_agent_id = sa2.id
       LEFT JOIN users u2 ON sa2.user_id = u2.id
       WHERE eh.conversation_id = $1
       ORDER BY eh.created_at DESC`,
      [conversationId]
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
