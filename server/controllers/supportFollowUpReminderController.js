'use strict';

const db = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');
const supportEmployerService = require('../services/supportEmployerService');

const VALID_STATUSES = new Set(['pending', 'completed', 'cancelled']);

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function canAccessConversation(req, conversationId) {
  const { rows } = await db.query(
    `SELECT id, business_id, agent_id
     FROM support_conversations
     WHERE id = $1`,
    [conversationId]
  );
  if (!rows.length) return { conversation: null, allowed: false };
  const conversation = rows[0];
  if (supportEmployerService.isPlatformAdmin(req.user.role)) return { conversation, allowed: true };

  const agentResult = conversation.agent_id
    ? await db.query('SELECT user_id FROM support_agents WHERE id = $1', [conversation.agent_id])
    : { rows: [] };
  const isAssignedAgent = agentResult.rows[0]?.user_id === req.user.id;
  const canManageBusiness = !isAssignedAgent && conversation.business_id
    ? await supportEmployerService.userCanAdministrateBusiness(conversation.business_id, req.user.id)
    : false;
  return { conversation, allowed: isAssignedAgent || canManageBusiness };
}

async function listReminders(req, res) {
  const conversationId = req.query.conversation_id || req.query.conversationId || null;
  const businessId = req.query.business_id || req.query.businessId || null;
  const status = String(req.query.status || 'pending').trim().toLowerCase();

  if (!VALID_STATUSES.has(status) && status !== 'all') {
    return sendValidationError(res, { status: 'Must be pending, completed, cancelled, or all' });
  }
  try {
    if (conversationId) {
      const access = await canAccessConversation(req, conversationId);
      if (!access.conversation) return sendError(res, 404, 'Conversation not found');
      if (!access.allowed) return sendError(res, 403, 'Access denied');
    } else if (!(businessId
      ? await supportEmployerService.userCanAccessBusinessConversations(businessId, req.user.id, req.user.role)
      : supportEmployerService.isPlatformAdmin(req.user.role))) {
      return sendError(res, 403, 'Access denied');
    }

    const params = [conversationId, businessId || null];
    const statusSql = status === 'all' ? '' : 'AND r.status = $3';
    if (status !== 'all') params.push(status);
    const limitParam = `$${params.push(Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50)))}`;
    const { rows } = await db.query(
      `SELECT r.id, r.conversation_id, r.created_by, r.assigned_to, r.due_at,
              r.note, r.status, r.completed_at, r.completed_by, r.created_at, r.updated_at,
              COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''), cu.email, sc.guest_name, 'Customer') AS customer_name,
              sc.subject,
              COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''), au.email, 'Unassigned') AS assigned_to_name
       FROM support_follow_up_reminders r
       JOIN support_conversations sc ON sc.id = r.conversation_id
       LEFT JOIN users cu ON cu.id = sc.customer_id
       LEFT JOIN users au ON au.id = r.assigned_to
       WHERE ($1::uuid IS NULL OR r.conversation_id = $1::uuid)
         AND ($2::integer IS NULL OR sc.business_id = $2::integer)
         ${statusSql}
       ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.due_at ASC
       LIMIT ${limitParam}`,
      params
    );
    return res.json({ success: true, reminders: rows });
  } catch (err) {
    logger.error('listSupportFollowUpReminders error', { error: err.message });
    return sendError(res, 500, 'Failed to load support follow-up reminders');
  }
}

async function createReminder(req, res) {
  const { conversationId } = req.params;
  const dueAt = parseDate(req.body?.dueAt ?? req.body?.due_at);
  const note = req.body?.note == null ? null : String(req.body.note).trim();
  const assignedTo = req.body?.assignedTo || req.body?.assigned_to || null;

  if (!dueAt) return sendValidationError(res, { dueAt: 'A valid due date and time is required' });
  if (dueAt.getTime() < Date.now() - 60_000) return sendValidationError(res, { dueAt: 'Due date cannot be in the past' });
  if (dueAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) return sendValidationError(res, { dueAt: 'Due date must be within one year' });
  if (note && note.length > 2000) return sendValidationError(res, { note: 'Must be 2000 characters or fewer' });

  try {
    const access = await canAccessConversation(req, conversationId);
    if (!access.conversation) return sendError(res, 404, 'Conversation not found');
    if (!access.allowed) return sendError(res, 403, 'Access denied');
    if (assignedTo) {
      const assignee = await db.query('SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [assignedTo]);
      if (!assignee.rows.length) return sendValidationError(res, { assignedTo: 'Active assignee not found' });
    }

    const { rows } = await db.query(
      `INSERT INTO support_follow_up_reminders
         (conversation_id, created_by, assigned_to, due_at, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, conversation_id, created_by, assigned_to, due_at, note, status, completed_at, completed_by, created_at, updated_at`,
      [conversationId, req.user.id, assignedTo, dueAt.toISOString(), note || null]
    );
    await logAdminAction({
      adminId: req.user.id,
      action: 'support_follow_up_reminder_created',
      targetType: 'support_conversation',
      targetId: conversationId,
      description: 'Support follow-up reminder created',
      after: { reminderId: rows[0].id, dueAt: rows[0].due_at, assignedTo: assignedTo || null },
      req,
    });
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('createSupportFollowUpReminder error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to create support follow-up reminder');
  }
}

async function updateReminder(req, res) {
  const { reminderId } = req.params;
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!VALID_STATUSES.has(status)) return sendValidationError(res, { status: 'Must be pending, completed, or cancelled' });

  try {
    const existing = await db.query(
      `SELECT r.id, r.conversation_id, r.status, sc.business_id
       FROM support_follow_up_reminders r
       JOIN support_conversations sc ON sc.id = r.conversation_id
       WHERE r.id = $1`,
      [reminderId]
    );
    if (!existing.rows.length) return sendError(res, 404, 'Reminder not found');
    const access = await canAccessConversation(req, existing.rows[0].conversation_id);
    if (!access.allowed) return sendError(res, 403, 'Access denied');

    const { rows } = await db.query(
      `UPDATE support_follow_up_reminders
       SET status = $1,
           completed_at = CASE WHEN $1 = 'completed' THEN COALESCE(completed_at, NOW()) ELSE NULL END,
           completed_by = CASE WHEN $1 = 'completed' THEN $2 ELSE NULL END,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, conversation_id, created_by, assigned_to, due_at, note, status, completed_at, completed_by, created_at, updated_at`,
      [status, req.user.id, reminderId]
    );
    await logAdminAction({
      adminId: req.user.id,
      action: 'support_follow_up_reminder_updated',
      targetType: 'support_conversation',
      targetId: existing.rows[0].conversation_id,
      description: `Support follow-up reminder marked ${status}`,
      before: { status: existing.rows[0].status },
      after: { status },
      req,
    });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('updateSupportFollowUpReminder error', { reminderId, error: err.message });
    return sendError(res, 500, 'Failed to update support follow-up reminder');
  }
}

module.exports = { listReminders, createReminder, updateReminder };
