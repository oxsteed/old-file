'use strict';

/**
 * server/controllers/businessConversationAssignmentController.js
 *
 * Claim / release / list-claims on business_conversations. Lets a team
 * member explicitly take responsibility for a customer thread so other
 * teammates know it's covered. Also writes an entry to business_audit_log
 * for every state change.
 *
 * Routes (all under /api/businesses/:businessId/...):
 *   POST   /messages/:conversationId/claim     - claim for current user
 *   POST   /messages/:conversationId/release   - release any current claim
 *   POST   /messages/:conversationId/reassign  - manager-only, reassign to another team member
 *   GET    /messages/assignments               - list of who has what claimed
 */

const pool = require('../db');
const { sendError, sendSuccess } = require('../utils/apiError');
const { logBusinessAction } = require('../services/businessAuditLog');
const socketService = require('../services/socketService');

function broadcast(businessId, event, payload) {
  try {
    socketService.broadcastToBusinessInbox(businessId, event, payload);
  } catch { /* non-fatal */ }
}

async function fetchConversation(businessId, conversationId, db = pool, lock = false) {
  const { rows } = await db.query(
    `SELECT id, business_id, assigned_to_user_id, assigned_at, status
       FROM business_conversations
      WHERE id = $1 AND business_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [conversationId, businessId]
  );
  return rows[0] || null;
}

exports.claimConversation = async function claimConversation(req, res, next) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const businessId = req.business && req.business.id;
    const { conversationId } = req.params;
    const userId = req.user.id;

    const { rows } = await client.query(
      `SELECT id, business_id, assigned_to_user_id, assigned_at, status
         FROM business_conversations
        WHERE id = $1 AND business_id = $2
        FOR UPDATE`,
      [conversationId, businessId]
    );
    const conv = rows[0] || null;
    if (!conv) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'Conversation not found', 'not_found');
    }
    if (conv.assigned_to_user_id && conv.assigned_to_user_id !== userId) {
      await client.query('ROLLBACK');
      return sendError(res, 409, 'Conversation already claimed by another team member.', 'already_claimed', {
        assigned_to_user_id: conv.assigned_to_user_id,
      });
    }

    await client.query(
      `UPDATE business_conversations
          SET assigned_to_user_id = $1,
              assigned_at = NOW(),
              updated_at = NOW()
        WHERE id = $2`,
      [userId, conversationId]
    );

    await logBusinessAction(req, {
      action: 'business.conversation.claimed',
      target_type: 'business_conversation',
      target_id: conversationId,
      before_state: { assigned_to_user_id: conv.assigned_to_user_id },
      after_state:  { assigned_to_user_id: userId },
      client,
      throwOnError: true,
    });
    await client.query('COMMIT');

    broadcast(businessId, 'business_inbox:claim_changed', {
      conversation_id: conversationId,
      assigned_to_user_id: userId,
      at: new Date().toISOString(),
    });

    return sendSuccess(res, { conversation_id: conversationId, assigned_to_user_id: userId });
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client?.release();
  }
};

exports.releaseConversation = async function releaseConversation(req, res, next) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const businessId = req.business && req.business.id;
    const { conversationId } = req.params;
    const userId = req.user.id;
    const role = req.businessRole;

    const conv = await fetchConversation(businessId, conversationId, client, true);
    if (!conv) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'Conversation not found', 'not_found');
    }
    if (!conv.assigned_to_user_id) {
      await client.query('COMMIT');
      return sendSuccess(res, { conversation_id: conversationId, assigned_to_user_id: null });
    }

    // Only the current claimer OR an owner/manager can release.
    if (conv.assigned_to_user_id !== userId && role !== 'owner' && role !== 'manager') {
      await client.query('ROLLBACK');
      return sendError(res, 403, 'Only the claimer or a manager can release this conversation.', 'forbidden');
    }

    await client.query(
      `UPDATE business_conversations
          SET assigned_to_user_id = NULL,
              assigned_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [conversationId]
    );

    await logBusinessAction(req, {
      action: 'business.conversation.released',
      target_type: 'business_conversation',
      target_id: conversationId,
      before_state: { assigned_to_user_id: conv.assigned_to_user_id },
      after_state:  { assigned_to_user_id: null },
      client,
      throwOnError: true,
    });
    await client.query('COMMIT');

    broadcast(businessId, 'business_inbox:claim_changed', {
      conversation_id: conversationId,
      assigned_to_user_id: null,
      at: new Date().toISOString(),
    });

    return sendSuccess(res, { conversation_id: conversationId, assigned_to_user_id: null });
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client?.release();
  }
};

exports.reassignConversation = async function reassignConversation(req, res, next) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const businessId = req.business && req.business.id;
    const { conversationId } = req.params;
    const role = req.businessRole;
    if (role !== 'owner' && role !== 'manager') {
      await client.query('ROLLBACK');
      return sendError(res, 403, 'Owner or manager required.', 'forbidden');
    }

    const newAssignee = req.body && req.body.user_id;
    if (!newAssignee) {
      await client.query('ROLLBACK');
      return sendError(res, 400, 'user_id is required', 'validation_failed');
    }

    // Sanity: newAssignee must be active team member or the owner.
    const { rows: ok } = await client.query(
      `SELECT 1
         FROM businesses b
         WHERE b.id = $1
           AND (
             b.user_id = $2
             OR EXISTS (
               SELECT 1 FROM business_members bm
               WHERE bm.business_id = b.id AND bm.member_id = $2 AND bm.status = 'active'
             )
           )`,
      [businessId, newAssignee]
    );
    if (!ok.length) {
      await client.query('ROLLBACK');
      return sendError(res, 400, 'Assignee is not a team member of this business.', 'invalid_assignee');
    }

    const conv = await fetchConversation(businessId, conversationId, client, true);
    if (!conv) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'Conversation not found', 'not_found');
    }

    await client.query(
      `UPDATE business_conversations
          SET assigned_to_user_id = $1,
              assigned_at = NOW(),
              updated_at = NOW()
        WHERE id = $2`,
      [newAssignee, conversationId]
    );

    await logBusinessAction(req, {
      action: 'business.conversation.reassigned',
      target_type: 'business_conversation',
      target_id: conversationId,
      before_state: { assigned_to_user_id: conv.assigned_to_user_id },
      after_state:  { assigned_to_user_id: newAssignee },
      client,
      throwOnError: true,
    });
    await client.query('COMMIT');

    broadcast(businessId, 'business_inbox:claim_changed', {
      conversation_id: conversationId,
      assigned_to_user_id: newAssignee,
      at: new Date().toISOString(),
    });

    return sendSuccess(res, { conversation_id: conversationId, assigned_to_user_id: newAssignee });
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client?.release();
  }
};

exports.listAssignments = async function listAssignments(req, res, next) {
  try {
    const businessId = req.business && req.business.id;
    const { rows } = await pool.query(
      `SELECT bc.id AS conversation_id,
              bc.assigned_to_user_id,
              bc.assigned_at,
              bc.last_message_at,
              bc.customer_name,
              bc.customer_email,
              bc.subject,
              u.first_name AS assignee_first_name,
              u.last_name  AS assignee_last_name
         FROM business_conversations bc
         LEFT JOIN users u ON u.id = bc.assigned_to_user_id
        WHERE bc.business_id = $1
          AND bc.assigned_to_user_id IS NOT NULL
          AND bc.status IN ('active', 'resolved')
        ORDER BY bc.assigned_at DESC NULLS LAST`,
      [businessId]
    );
    return sendSuccess(res, { assignments: rows });
  } catch (err) { next(err); }
};
