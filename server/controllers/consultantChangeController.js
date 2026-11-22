'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
const { sendNotification } = require('../services/notificationService');
const { withTransaction } = require('../utils/transaction');
const {
  loadSession,
  actorForSession,
  notifyUser,
} = require('./consultantDeliverableController');

// Group 10 Slice F (items 531-535): handle changes.
// A change request (scope revision, deadline adjustment, additional fee)
// is filed by either party to an engagement session and decided by the
// other party; the requester never decides their own request, and an
// admin decides only when the client is the decider (the D-115 rule).
// Approval applies the change in the same transaction: scope rewrites
// the milestone text (or the session description for engagement-level
// scope), a deadline moves the milestone due date, and an additional fee
// records a DRAFT consulting invoice — no money moves, no charge.
// Approving a scope/deadline change on an accepted milestone re-opens it
// (the D-125 revision path). One open request per session/type/target.
// Engagement pause (535) is a session status with a resume path; while
// paused, milestone moves, draft deliveries, acceptances, and change
// approvals are blocked. Change history (534) is the append-only
// consulting_engagement_events table plus the change requests
// themselves. Decisions D-126..D-131 in persona-roadmap-decisions.md.

const BIGINT_RE = /^\d+$/;
const REQUEST_TYPES = new Set(['scope_revision', 'deadline_adjustment', 'additional_fee']);
const PAUSE_BLOCKED_STATUSES = new Set(['completed', 'cancelled', 'archived']);

function validSessionId(value) {
  return typeof value === 'string' && BIGINT_RE.test(value);
}

function validRequestId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function isDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

function presentChangeRequest(row, session) {
  if (!row) return null;
  const consultantId = session?.consultant_assigned_id ?? row.session_consultant_id;
  const requestedByRole = consultantId && String(row.requested_by) === String(consultantId)
    ? 'consultant'
    : 'client';
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    deliverableId: row.deliverable_id == null ? null : String(row.deliverable_id),
    deliverableName: row.deliverable_name || null,
    requestedBy: String(row.requested_by),
    requestedByRole,
    requestType: row.request_type,
    status: row.status,
    title: row.title,
    reason: row.reason,
    newTitle: row.new_title,
    newDescription: row.new_description,
    newDueDate: row.new_due_date ? String(row.new_due_date).slice(0, 10) : null,
    amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
    currency: row.currency,
    invoiceId: row.invoice_id == null ? null : String(row.invoice_id),
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function presentEvent(row) {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    eventType: row.event_type,
    actorId: row.actor_id ? String(row.actor_id) : null,
    actorRole: row.actor_role,
    summary: row.summary,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

async function recordEvent(client, { sessionId, eventType, actorId, actorRole, summary, metadata }) {
  await client.query(
    `INSERT INTO consulting_engagement_events
       (session_id, event_type, actor_id, actor_role, summary, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, eventType, actorId || null, actorRole || null, summary, JSON.stringify(metadata || {})],
  );
}

async function loadChangeRequest(client, sessionId, requestId) {
  if (!validRequestId(requestId)) return null;
  const { rows: [row] } = await client.query(
    `SELECT cr.*, d.name AS deliverable_name,
            s.user_id AS session_user_id, s.consultant_assigned_id AS session_consultant_id
       FROM consulting_change_requests cr
       LEFT JOIN consulting_deliverables d ON d.id = cr.deliverable_id
       LEFT JOIN consulting_sessions s ON s.id = cr.session_id
      WHERE cr.id = $1 AND cr.session_id = $2`,
    [requestId, sessionId],
  );
  return row || null;
}

async function loadDeliverable(client, sessionId, deliverableId) {
  if (!BIGINT_RE.test(String(deliverableId))) return null;
  const { rows: [row] } = await client.query(
    `SELECT * FROM consulting_deliverables WHERE id = $1 AND session_id = $2`,
    [deliverableId, sessionId],
  );
  return row || null;
}

async function emailParty(email, subject, heading, body) {
  if (!email) return;
  try {
    const html = renderOxSteedEmail({ subject, heading, body });
    await sendEmail({ to: email, subject, html });
  } catch (err) {
    logger.warn('Consulting change email failed', { email, subject, error: err.message });
  }
}

async function consultantEmail(consultantId) {
  if (!consultantId) return null;
  const { rows: [row] } = await db.query('SELECT email FROM users WHERE id = $1', [consultantId]);
  return row?.email || null;
}

function changeLabel(request) {
  if (request.request_type === 'deadline_adjustment') return 'deadline adjustment';
  if (request.request_type === 'additional_fee') return 'additional fee';
  return 'scope revision';
}

// POST /contractor/sessions/:sessionId/change-requests
// POST /business-launch/sessions/:sessionId/change-requests
// Either party files a change request (531-533). An admin is not a party
// and cannot file one.
async function createChangeRequest(req, res) {
  const { sessionId } = req.params;
  const requestType = String(req.body?.request_type || '').trim();
  const deliverableId = req.body?.deliverable_id == null || req.body.deliverable_id === ''
    ? null : String(req.body.deliverable_id);
  const title = String(req.body?.title || '').trim() || null;
  const reason = String(req.body?.reason || '').trim();
  const newTitle = String(req.body?.new_title || '').trim() || null;
  const newDescription = String(req.body?.new_description || '').trim() || null;
  const newDueDate = String(req.body?.new_due_date || '').trim() || null;
  const amountCents = req.body?.amount_cents == null ? null : Number(req.body.amount_cents);
  const currency = String(req.body?.currency || 'USD').trim().toUpperCase() || 'USD';
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  if (!REQUEST_TYPES.has(requestType)) return res.status(400).json({ error: 'Invalid change request type', code: 'invalid_request_type' });
  if (reason.length < 10) return res.status(400).json({ error: 'A reason of at least 10 characters is required', code: 'reason_required' });
  if (requestType === 'deadline_adjustment') {
    if (!deliverableId || !BIGINT_RE.test(deliverableId)) return res.status(400).json({ error: 'A deadline adjustment needs a milestone', code: 'deliverable_required' });
    if (!newDueDate || !isDateStr(newDueDate)) return res.status(400).json({ error: 'A deadline adjustment needs a new due date', code: 'due_date_required' });
  }
  if (requestType === 'scope_revision' && !newTitle && !newDescription) {
    return res.status(400).json({ error: 'A scope revision needs a new title or a new description', code: 'scope_required' });
  }
  if (requestType === 'additional_fee' && (!Number.isInteger(amountCents) || amountCents <= 0)) {
    return res.status(400).json({ error: 'An additional fee needs an amount in cents above zero', code: 'amount_required' });
  }
  if (currency.length !== 3) return res.status(400).json({ error: 'Currency must be a 3-letter code', code: 'invalid_currency' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'consultant' && type !== 'client') {
        return { status: 403, body: { error: 'Only the consultant or the client can request a change' } };
      }
      // Slice H (545): an archived engagement takes no new change requests.
      if (session.status === 'archived') {
        return { status: 409, body: { error: 'The engagement is archived', code: 'engagement_archived' } };
      }
      let deliverable = null;
      if (deliverableId) {
        deliverable = await loadDeliverable(client, sessionId, deliverableId);
        if (!deliverable) return { status: 404, body: { error: 'Deliverable not found' } };
      }
      const { rows: [created] } = await client.query(
        `INSERT INTO consulting_change_requests
           (session_id, deliverable_id, requested_by, request_type, title, reason,
            new_title, new_description, new_due_date, amount_cents, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [sessionId, deliverableId, req.user.id, requestType, title, reason,
          newTitle, newDescription, newDueDate, amountCents, currency],
      );
      await recordEvent(client, {
        sessionId,
        eventType: 'change_requested',
        actorId: req.user.id,
        actorRole: type,
        summary: `A ${changeLabel(created)} was requested${deliverable ? ` for "${deliverable.name}"` : ''}.`,
        metadata: { requestId: String(created.id), requestType, deliverableId },
      });
      return { status: 201, body: { changeRequest: presentChangeRequest({ ...created, deliverable_name: deliverable?.name || null }, session), session } };
    });
    if (result.status === 201) {
      const { changeRequest, session } = result.body;
      const requesterIsConsultant = String(session.consultant_assigned_id) === String(req.user.id);
      const deciderId = requesterIsConsultant ? session.user_id : session.consultant_assigned_id;
      const deciderEmail = requesterIsConsultant ? session.email : await consultantEmail(session.consultant_assigned_id);
      await notifyUser(deciderId, 'consulting_change_requested',
        'A change was requested on your engagement',
        `A ${changeLabel(changeRequest)} was requested. Review it on the milestone board.`,
        { sessionId: String(session.id), requestId: changeRequest.id });
      await emailParty(deciderEmail, 'A change was requested on your engagement',
        'A change was requested on your engagement',
        `A ${changeLabel(changeRequest)} was requested. Open the milestone board to review it.`);
      delete result.body.session;
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An open change request already exists for this', code: 'change_request_open' });
    }
    logger.error('Consulting create change request failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to request the change' });
  }
}

// GET /contractor/sessions/:sessionId/change-requests
// GET /business-launch/sessions/:sessionId/change-requests
// GET /admin/sessions/:sessionId/change-requests
// One handler for all three routers; the actor check is shared with the
// Slice E board.
async function listChangeRequests(req, res) {
  const { sessionId } = req.params;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const session = await loadSession(db, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const type = actorForSession(req, session);
    if (!type) return res.status(403).json({ error: 'Session not found' });
    const { rows } = await db.query(
      `SELECT cr.*, d.name AS deliverable_name,
            s.user_id AS session_user_id, s.consultant_assigned_id AS session_consultant_id
         FROM consulting_change_requests cr
         LEFT JOIN consulting_deliverables d ON d.id = cr.deliverable_id
         LEFT JOIN consulting_sessions s ON s.id = cr.session_id
        WHERE cr.session_id = $1
        ORDER BY cr.created_at DESC, cr.id DESC`,
      [sessionId],
    );
    return res.json({ changeRequests: rows.map(presentChangeRequest) });
  } catch (err) {
    logger.error('Consulting list change requests failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to list change requests' });
  }
}

// POST .../change-requests/:requestId/approve
// POST .../change-requests/:requestId/reject
// The decider is the party that did NOT file the request. An admin
// decides only when the client is the decider (the D-115 rule); the
// consultant's decision is the consultant's own.
function decideChangeRequest(decision) {
  return async (req, res) => {
    const { sessionId, requestId } = req.params;
    const decisionReason = String(req.body?.decision_reason || '').trim();
    if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
    if (decision === 'rejected' && decisionReason.length < 10) {
      return res.status(400).json({ error: 'A rejection needs a reason of at least 10 characters', code: 'reason_required' });
    }
    try {
      const result = await withTransaction(db, async (client) => {
        const session = await loadSession(client, sessionId);
        if (!session) return { status: 404, body: { error: 'Session not found' } };
        const type = actorForSession(req, session);
        if (!type) return { status: 403, body: { error: 'Session not found' } };
        // Slice H (545): an archived engagement takes no decisions.
        if (session.status === 'archived') {
          return { status: 409, body: { error: 'The engagement is archived', code: 'engagement_archived' } };
        }
        const request = await loadChangeRequest(client, sessionId, requestId);
        if (!request) return { status: 404, body: { error: 'Change request not found' } };
        if (request.status !== 'pending') {
          return { status: 409, body: { error: `This change request is already ${request.status}`, code: 'invalid_transition' } };
        }
        // The requester never decides their own request.
        if (String(request.requested_by) === String(req.user.id)) {
          return { status: 403, body: { error: 'You cannot decide your own change request', code: 'cannot_decide_own' } };
        }
        const requesterIsConsultant = String(session.consultant_assigned_id) === String(request.requested_by);
        // The decider is the other party: the client decides a
        // consultant-filed request, the consultant decides a client-filed
        // one. The requester-owns check above already bars the requester;
        // the actor check bars strangers. Only the admin needs an extra
        // rule: admins act for the client only (the D-115 rule).
        const deciderIsClient = requesterIsConsultant;
        // Admins act for the client only; the consultant decides for
        // themselves and no one decides for them.
        if (type === 'admin' && !deciderIsClient) {
          return { status: 403, body: { error: 'Only the assigned consultant can decide this change request' } };
        }
        if (decision === 'approved' && session.status === 'paused') {
          return { status: 409, body: { error: 'The engagement is paused', code: 'engagement_paused' } };
        }
        let invoiceId = null;
        let deliverable = null;
        if (request.deliverable_id) {
          deliverable = await loadDeliverable(client, sessionId, request.deliverable_id);
        }
        if (decision === 'approved') {
          if (request.request_type === 'scope_revision') {
            if (deliverable) {
              await client.query(
                `UPDATE consulting_deliverables
                    SET name = COALESCE($1, name), description = COALESCE($2, description),
                        status = CASE WHEN status = 'accepted' THEN 'in_progress' ELSE status END,
                        accepted_by = CASE WHEN status = 'accepted' THEN NULL ELSE accepted_by END,
                        accepted_at = CASE WHEN status = 'accepted' THEN NULL ELSE accepted_at END,
                        updated_at = NOW()
                  WHERE id = $3`,
                [request.new_title, request.new_description, deliverable.id],
              );
            } else if (request.new_description) {
              await client.query(
                `UPDATE consulting_sessions SET description = $1, updated_at = NOW() WHERE id = $2`,
                [request.new_description, sessionId],
              );
            }
          }
          if (request.request_type === 'deadline_adjustment' && deliverable) {
            await client.query(
              `UPDATE consulting_deliverables
                  SET due_date = $1,
                      status = CASE WHEN status = 'accepted' THEN 'in_progress' ELSE status END,
                      accepted_by = CASE WHEN status = 'accepted' THEN NULL ELSE accepted_by END,
                      accepted_at = CASE WHEN status = 'accepted' THEN NULL ELSE accepted_at END,
                      updated_at = NOW()
                WHERE id = $2`,
              [request.new_due_date, deliverable.id],
            );
          }
          if (request.request_type === 'additional_fee') {
            // A draft invoice is the record of the agreed fee (G10-6).
            // It is never sent or paid by approval; charging stays a
            // separate step and no money moves here.
            const { rows: [invoice] } = await client.query(
              `INSERT INTO consulting_invoices
                 (purchase_id, user_id, invoice_number, amount_cents, issued_date,
                  due_date, status, customer_email, customer_name, service_tier)
               VALUES (NULL, $1, $2, $3, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
                       'draft', $4, $5, NULL)
               RETURNING id`,
              [session.user_id, `CONS-${Date.now()}`, request.amount_cents,
                session.email, `${session.first_name || ''} ${session.last_name || ''}`.trim() || session.email],
            );
            invoiceId = invoice.id;
          }
        }
        const { rows: [updated] } = await client.query(
          `UPDATE consulting_change_requests
              SET status = $1, decided_by = $2, decided_at = NOW(),
                  decision_reason = $3, invoice_id = $4, updated_at = NOW()
            WHERE id = $5 RETURNING *`,
          [decision, req.user.id, decision === 'rejected' ? decisionReason : null, invoiceId, request.id],
        );
        await recordEvent(client, {
          sessionId,
          eventType: decision === 'approved' ? 'change_approved' : 'change_rejected',
          actorId: req.user.id,
          actorRole: type,
          summary: `A ${changeLabel(request)} was ${decision}${deliverable ? ` for "${deliverable.name}"` : ''}${decision === 'approved' && request.request_type === 'additional_fee' ? ' and recorded as a draft invoice' : ''}${decision === 'approved' && deliverable && deliverable.status === 'accepted' && request.request_type !== 'additional_fee' ? ' and the milestone was re-opened' : ''}.`,
          metadata: { requestId: String(request.id), requestType: request.request_type, deliverableId: request.deliverable_id, invoiceId },
        });
        const presented = presentChangeRequest({ ...updated, deliverable_name: deliverable?.name || null }, session);
        return { status: 200, body: { changeRequest: presented, session, requesterId: String(request.requested_by) } };
      });
      if (result.status === 200) {
        const { changeRequest, session, requesterId } = result.body;
        const requesterIsConsultant = String(session.consultant_assigned_id) === requesterId;
        const requesterEmail = requesterIsConsultant
          ? await consultantEmail(session.consultant_assigned_id) : session.email;
        await notifyUser(requesterId, decision === 'approved' ? 'consulting_change_approved' : 'consulting_change_rejected',
          decision === 'approved' ? 'Your change request was approved' : 'Your change request was declined',
          `Your ${changeLabel(changeRequest)} was ${decision}.`,
          { sessionId: String(session.id), requestId: changeRequest.id });
        await emailParty(requesterEmail,
          decision === 'approved' ? 'Your change request was approved' : 'Your change request was declined',
          decision === 'approved' ? 'Your change request was approved' : 'Your change request was declined',
          `Your ${changeLabel(changeRequest)} was ${decision}.`);
        delete result.body.session;
        delete result.body.requesterId;
      }
      return res.status(result.status).json(result.body);
    } catch (err) {
      logger.error('Consulting decide change request failed', { sessionId, requestId, error: err.message });
      return res.status(500).json({ error: 'Failed to decide the change request' });
    }
  };
}

// POST .../change-requests/:requestId/withdraw
// The requester (or an admin) withdraws a pending request.
async function withdrawChangeRequest(req, res) {
  const { sessionId, requestId } = req.params;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (!type) return { status: 403, body: { error: 'Session not found' } };
      const request = await loadChangeRequest(client, sessionId, requestId);
      if (!request) return { status: 404, body: { error: 'Change request not found' } };
      if (request.status !== 'pending') {
        return { status: 409, body: { error: `This change request is already ${request.status}`, code: 'invalid_transition' } };
      }
      if (type !== 'admin' && String(request.requested_by) !== String(req.user.id)) {
        return { status: 403, body: { error: 'Only the requester can withdraw this change request' } };
      }
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_change_requests
            SET status = 'withdrawn', updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [request.id],
      );
      await recordEvent(client, {
        sessionId,
        eventType: 'change_withdrawn',
        actorId: req.user.id,
        actorRole: type,
        summary: `A ${changeLabel(request)} was withdrawn.`,
        metadata: { requestId: String(request.id), requestType: request.request_type },
      });
      return { status: 200, body: { changeRequest: presentChangeRequest(updated, session) } };
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting withdraw change request failed', { sessionId, requestId, error: err.message });
    return res.status(500).json({ error: 'Failed to withdraw the change request' });
  }
}

// GET /contractor/sessions/:sessionId/history
// GET /business-launch/sessions/:sessionId/history
// GET /admin/sessions/:sessionId/history
// Change history (534): every change request with its decision, plus
// the append-only engagement events, newest first.
async function getEngagementHistory(req, res) {
  const { sessionId } = req.params;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const session = await loadSession(db, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const type = actorForSession(req, session);
    if (!type) return res.status(403).json({ error: 'Session not found' });
    const { rows: requests } = await db.query(
      `SELECT cr.*, d.name AS deliverable_name,
            s.user_id AS session_user_id, s.consultant_assigned_id AS session_consultant_id
         FROM consulting_change_requests cr
         LEFT JOIN consulting_deliverables d ON d.id = cr.deliverable_id
         LEFT JOIN consulting_sessions s ON s.id = cr.session_id
        WHERE cr.session_id = $1
        ORDER BY cr.created_at DESC, cr.id DESC`,
      [sessionId],
    );
    const { rows: events } = await db.query(
      `SELECT * FROM consulting_engagement_events
        WHERE session_id = $1 ORDER BY created_at DESC, id DESC`,
      [sessionId],
    );
    return res.json({
      changeRequests: requests.map(presentChangeRequest),
      events: events.map(presentEvent),
    });
  } catch (err) {
    logger.error('Consulting engagement history failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to load the change history' });
  }
}

// POST /contractor/sessions/:sessionId/pause
// POST /business-launch/sessions/:sessionId/pause
// POST /admin/sessions/:sessionId/pause
// Engagement pause (535): either party or an admin pauses the
// engagement. The pre-pause status is kept so resume restores it.
async function pauseEngagement(req, res) {
  const { sessionId } = req.params;
  const reason = String(req.body?.reason || '').trim();
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  if (reason.length < 10) return res.status(400).json({ error: 'A reason of at least 10 characters is required', code: 'reason_required' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (!type) return { status: 403, body: { error: 'Session not found' } };
      if (session.status === 'paused') {
        return { status: 409, body: { error: 'The engagement is already paused', code: 'already_paused' } };
      }
      if (PAUSE_BLOCKED_STATUSES.has(session.status)) {
        return { status: 409, body: { error: `A ${session.status} engagement cannot be paused`, code: 'invalid_transition' } };
      }
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_sessions
            SET status = 'paused', paused_at = NOW(), paused_by = $1,
                pause_reason = $2, status_before_pause = $3, updated_at = NOW()
          WHERE id = $4 RETURNING *`,
        [req.user.id, reason, session.status, sessionId],
      );
      await recordEvent(client, {
        sessionId,
        eventType: 'engagement_paused',
        actorId: req.user.id,
        actorRole: type,
        summary: 'The engagement was paused.',
        metadata: { reason, statusBeforePause: session.status },
      });
      return { status: 200, body: { session: updated } };
    });
    if (result.status === 200) {
      const { session } = result.body;
      const otherId = String(session.user_id) === String(req.user.id)
        ? session.consultant_assigned_id : session.user_id;
      await notifyUser(otherId, 'consulting_engagement_paused',
        'The engagement was paused',
        'The engagement was paused. Milestone work and change approvals are on hold until it resumes.',
        { sessionId: String(session.id) });
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting pause engagement failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to pause the engagement' });
  }
}

// POST /contractor/sessions/:sessionId/resume
// POST /business-launch/sessions/:sessionId/resume
// POST /admin/sessions/:sessionId/resume
// Resume restores the status the engagement held before the pause.
async function resumeEngagement(req, res) {
  const { sessionId } = req.params;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (!type) return { status: 403, body: { error: 'Session not found' } };
      if (session.status !== 'paused') {
        return { status: 409, body: { error: 'The engagement is not paused', code: 'not_paused' } };
      }
      const restored = session.status_before_pause || 'pending';
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_sessions
            SET status = $1, paused_at = NULL, paused_by = NULL,
                pause_reason = NULL, status_before_pause = NULL, updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [restored, sessionId],
      );
      await recordEvent(client, {
        sessionId,
        eventType: 'engagement_resumed',
        actorId: req.user.id,
        actorRole: type,
        summary: `The engagement resumed (${restored}).`,
        metadata: { restoredStatus: restored },
      });
      return { status: 200, body: { session: updated } };
    });
    if (result.status === 200) {
      const { session } = result.body;
      const otherId = String(session.user_id) === String(req.user.id)
        ? session.consultant_assigned_id : session.user_id;
      await notifyUser(otherId, 'consulting_engagement_resumed',
        'The engagement resumed',
        'The engagement resumed. Milestone work and change approvals are open again.',
        { sessionId: String(session.id) });
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting resume engagement failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to resume the engagement' });
  }
}

module.exports = {
  createChangeRequest,
  listChangeRequests,
  decideChangeRequest,
  withdrawChangeRequest,
  getEngagementHistory,
  pauseEngagement,
  resumeEngagement,
};
