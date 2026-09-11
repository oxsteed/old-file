'use strict';

const db = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');
const supportEmployerService = require('../services/supportEmployerService');

const MAX_LIMIT = 100;

function parseLimit(value) {
  return Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(value, 10) || 50));
}

function parseOffset(value) {
  return Math.max(0, Number.parseInt(value, 10) || 0);
}

async function canAccessBusiness(req, businessId) {
  if (!businessId) return supportEmployerService.isPlatformAdmin(req.user?.role);
  return supportEmployerService.userCanAccessBusinessConversations(
    businessId,
    req.user.id,
    req.user.role
  );
}

async function listReviews(req, res) {
  const businessId = req.query.business_id || req.query.businessId || null;
  const status = String(req.query.status || 'pending').trim().toLowerCase();
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);

  if (!['pending', 'completed', 'all'].includes(status)) {
    return sendValidationError(res, { status: 'Must be pending, completed, or all' });
  }
  if (!(await canAccessBusiness(req, businessId))) return sendError(res, 403, 'Access denied');

  const params = [businessId || null];
  const statusSql = status === 'pending'
    ? 'AND qa.id IS NULL'
    : status === 'completed'
      ? 'AND qa.id IS NOT NULL'
      : '';
  params.push(limit, offset);

  try {
    const result = await db.query(
      `SELECT
         sc.id AS conversation_id,
         sc.business_id,
         sc.subject,
         sc.status,
         sc.priority,
         sc.created_at,
         sc.updated_at,
         sc.resolved_at,
         sc.closed_at,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''), cu.email, sc.guest_name, 'Customer') AS customer_name,
         COALESCE(cu.email, sc.guest_email) AS customer_email,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''), au.email, 'Unassigned') AS agent_name,
         qa.id AS qa_review_id,
         qa.score AS qa_score,
         qa.notes AS qa_notes,
         qa.reviewer_id AS qa_reviewer_id,
         qa.created_at AS qa_created_at,
         qa.updated_at AS qa_updated_at,
         COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', ru.first_name, ru.last_name)), ''), ru.email) AS qa_reviewer_name
       FROM support_conversations sc
       LEFT JOIN users cu ON cu.id = sc.customer_id
       LEFT JOIN support_agents sa ON sa.id = sc.agent_id
       LEFT JOIN users au ON au.id = sa.user_id
       LEFT JOIN support_conversation_qa_reviews qa ON qa.conversation_id = sc.id
       LEFT JOIN users ru ON ru.id = qa.reviewer_id
       WHERE sc.status IN ('resolved', 'closed')
         AND ($1::integer IS NULL OR sc.business_id = $1::integer)
         ${statusSql}
       ORDER BY COALESCE(sc.closed_at, sc.resolved_at, sc.updated_at) DESC
       LIMIT $2 OFFSET $3`,
      params
    );
    return res.json({
      success: true,
      reviews: result.rows,
      pagination: { limit, offset, returned: result.rows.length, hasMore: result.rows.length === limit },
    });
  } catch (err) {
    logger.error('listSupportQualityReviews error', { error: err.message });
    return sendError(res, 500, 'Failed to load support QA reviews');
  }
}

async function saveReview(req, res) {
  const { conversationId } = req.params;
  const score = Number(req.body?.score);
  const notes = req.body?.notes == null ? null : String(req.body.notes).trim();

  if (!Number.isInteger(score) || score < 0 || score > 100) {
    return sendValidationError(res, { score: 'Must be a whole number from 0 to 100' });
  }
  if (notes && notes.length > 2000) {
    return sendValidationError(res, { notes: 'Must be 2000 characters or fewer' });
  }

  try {
    const conversationResult = await db.query(
      `SELECT id, business_id, subject, status
       FROM support_conversations
       WHERE id = $1`,
      [conversationId]
    );
    if (!conversationResult.rows.length) return sendError(res, 404, 'Conversation not found');
    const conversation = conversationResult.rows[0];
    if (!['resolved', 'closed'].includes(conversation.status)) {
      return sendError(res, 409, 'Only completed conversations can receive a QA review');
    }
    if (!(await canAccessBusiness(req, conversation.business_id))) return sendError(res, 403, 'Access denied');

    const result = await db.query(
      `INSERT INTO support_conversation_qa_reviews
         (conversation_id, reviewer_id, score, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversation_id) DO UPDATE SET
         reviewer_id = EXCLUDED.reviewer_id,
         score = EXCLUDED.score,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING id, conversation_id, reviewer_id, score, notes, created_at, updated_at`,
      [conversationId, req.user.id, score, notes || null]
    );

    await logAdminAction({
      adminId: req.user.id,
      action: 'support_conversation_qa_review_saved',
      targetType: 'support_conversation',
      targetId: conversationId,
      description: 'Support QA review saved',
      after: { score, notesProvided: Boolean(notes) },
      req,
    });
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('saveSupportQualityReview error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to save support QA review');
  }
}

module.exports = { listReviews, saveReview };
