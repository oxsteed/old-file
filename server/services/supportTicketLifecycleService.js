'use strict';

const db = require('../db');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');
const { logAdminAction } = require('./auditService');

const TRANSITIONS = {
  open: new Set(['assigned', 'in_progress', 'waiting_user', 'resolved']),
  assigned: new Set(['open', 'in_progress', 'waiting_user', 'resolved']),
  in_progress: new Set(['waiting_user', 'resolved', 'closed']),
  waiting_user: new Set(['in_progress', 'resolved', 'closed']),
  resolved: new Set(['closed', 'open']),
  closed: new Set(['open']),
};

async function transitionTicket({ ticketId, actor, status, ownerOnly = false, req }) {
  if (!actor?.id) throw new AppError('Authentication required', 401, 'authentication_required');
  if (!ownerOnly && !['admin', 'super_admin'].includes(actor.role)) {
    throw new AppError('Admin access required', 403, 'admin_required');
  }
  if (!Object.hasOwn(TRANSITIONS, status) || (ownerOnly && status !== 'open')) {
    throw new AppError('Invalid ticket status', 400, 'invalid_ticket_status');
  }
  return withTransaction(db, async client => {
    const { rows: [before] } = await client.query(
      `SELECT t.*, u.preferred_language
         FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.id = $1 ${ownerOnly ? 'AND t.user_id = $2' : ''}
        FOR UPDATE OF t`, ownerOnly ? [ticketId, actor.id] : [ticketId],
    );
    if (!before) throw new AppError('Ticket not found', 404, 'ticket_not_found');
    if (ownerOnly && !['resolved', 'closed'].includes(before.status)) {
      throw new AppError('Only resolved or closed tickets can be reopened.', 409, 'ticket_not_reopenable');
    }
    if (before.status === status) return { ticket: before, replayed: true };
    if (!TRANSITIONS[before.status]?.has(status)) {
      throw new AppError('This ticket status change is not allowed.', 409, 'invalid_status_transition');
    }
    const { rows: [ticket] } = await client.query(
      `UPDATE support_tickets SET status = $2::text, updated_at = now(),
         resolved_at = CASE WHEN $2::text = 'resolved' THEN now() WHEN $2::text = 'open' THEN NULL ELSE resolved_at END,
         closed_at = CASE WHEN $2::text = 'closed' THEN now() WHEN $2::text = 'open' THEN NULL ELSE closed_at END
       WHERE id = $1 AND status = $3 RETURNING *`, [ticketId, status, before.status],
    );
    if (!ticket) throw new AppError('Ticket changed during update', 409, 'ticket_state_conflict');
    const reopened = status === 'open' && ['resolved', 'closed'].includes(before.status);
    const { rows: [event] } = await client.query(
      `INSERT INTO support_ticket_events (ticket_id, actor_id, event_type, before_status, after_status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [ticketId, actor.id, reopened ? 'reopened' : 'status_changed', before.status, status],
    );
    if (!ownerOnly) await logAdminAction({
      client, adminId: actor.id, action: reopened ? 'support_ticket_reopened' : 'support_ticket_status_changed',
      targetType: 'support_ticket', targetId: ticketId, before: { status: before.status },
      after: { status }, req, throwOnError: true,
    });
    return { ticket: { ...ticket, preferred_language: before.preferred_language }, eventId: event.id, replayed: false };
  }, 'support_ticket_transition');
}

module.exports = { transitionTicket };
