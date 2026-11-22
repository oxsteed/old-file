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

// Group 10 Slice H (items 541-545): close the engagement.
// The final deliverable checklist (541) is computed from the milestone
// board, change requests, feedback, and the closeout record below — it
// needs no table of its own. Closeout confirmation (542) is a two-party
// agreement on a completed engagement: the consultant confirms and the
// client confirms, and closed_at is stamped when both have. The
// follow-up schedule (543) books post-close check-ins. The client
// feedback request (544) asks the client for feedback through the
// existing authenticated feedback endpoint (Slice E, item 529). The
// engagement archive (545) freezes a closed engagement: it leaves the
// active lists, keeps its record readable, and restores on unarchive.
// Decisions D-138..D-145 in persona-roadmap-decisions.md.

const BIGINT_RE = /^\d+$/;
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const FOLLOW_UP_KINDS = new Set(['check_in', 'review', 'renewal', 'other']);

function validSessionId(value) {
  return typeof value === 'string' && BIGINT_RE.test(value);
}

function validFollowUpId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// The engagement's effective status: an archived engagement still
// reports the status it held before archiving, so the checklist reads
// the same before and after the archive.
function effectiveStatus(session) {
  if (!session) return null;
  if (session.status === 'archived') return session.status_before_archive || 'completed';
  return session.status;
}

function presentCloseout(row) {
  if (!row) return null;
  return {
    sessionId: String(row.session_id),
    consultantConfirmedAt: row.consultant_confirmed_at,
    consultantConfirmedBy: row.consultant_confirmed_by
      ? String(row.consultant_confirmed_by) : null,
    clientConfirmedAt: row.client_confirmed_at,
    clientConfirmedBy: row.client_confirmed_by
      ? String(row.client_confirmed_by) : null,
    closedAt: row.closed_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function presentFollowUp(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    dueAt: row.due_at,
    kind: row.kind,
    note: row.note,
    status: row.status,
    createdBy: String(row.created_by),
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function presentFeedbackRequest(row, submittedAt) {
  if (!row) return null;
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    requestedBy: String(row.requested_by),
    requestedAt: row.requested_at,
    note: row.note,
    submittedAt: submittedAt || null,
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

async function emailParty(email, subject, heading, body) {
  if (!email) return;
  try {
    const html = renderOxSteedEmail({ subject, heading, body });
    await sendEmail({ to: email, subject, html });
  } catch (err) {
    logger.warn('Consulting closeout email failed', { email, subject, error: err.message });
  }
}

async function consultantEmail(consultantId) {
  if (!consultantId) return null;
  const { rows: [row] } = await db.query('SELECT email FROM users WHERE id = $1', [consultantId]);
  return row?.email || null;
}

async function loadCloseout(client, sessionId) {
  const { rows: [row] } = await client.query(
    'SELECT * FROM consulting_closeouts WHERE session_id = $1', [sessionId],
  );
  return row || null;
}

async function loadFollowUps(client, sessionId) {
  const { rows } = await client.query(
    `SELECT * FROM consulting_follow_ups
      WHERE session_id = $1 ORDER BY due_at ASC, created_at ASC`,
    [sessionId],
  );
  return rows;
}

async function loadFeedbackRequests(client, sessionId) {
  const { rows } = await client.query(
    `SELECT * FROM consulting_feedback_requests
      WHERE session_id = $1 ORDER BY requested_at DESC, created_at DESC`,
    [sessionId],
  );
  return rows;
}

// The request is satisfied when the client has left session feedback
// (Slice E endpoint, item 529). Feedback predating the request counts
// too: a client who already spoke does not need asking again.
async function loadFeedbackSubmittedAt(client, sessionId) {
  const { rows: [row] } = await client.query(
    `SELECT MIN(created_at) AS first_at FROM consulting_session_feedback
      WHERE session_id = $1`,
    [sessionId],
  );
  return row?.first_at || null;
}

// Final deliverable checklist (541), computed live. Required items gate
// the archive; recommended items (feedback, follow-ups) are shown but
// never block it.
async function computeChecklist(client, session) {
  const sessionId = session.id;
  const { rows: deliverables } = await client.query(
    'SELECT id, status FROM consulting_deliverables WHERE session_id = $1',
    [sessionId],
  );
  const { rows: [pendingChanges] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM consulting_change_requests
      WHERE session_id = $1 AND status = 'pending'`,
    [sessionId],
  );
  const closeout = await loadCloseout(client, sessionId);
  const feedbackSubmittedAt = await loadFeedbackSubmittedAt(client, sessionId);
  const { rows: [feedbackReq] } = await client.query(
    'SELECT COUNT(*)::int AS n FROM consulting_feedback_requests WHERE session_id = $1',
    [sessionId],
  );
  const { rows: [followUpCount] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM consulting_follow_ups
      WHERE session_id = $1 AND status = 'scheduled'`,
    [sessionId],
  );

  const total = deliverables.length;
  const accepted = deliverables.filter((d) => d.status === 'accepted').length;
  const undelivered = deliverables.filter(
    (d) => d.status === 'pending' || d.status === 'in_progress',
  ).length;
  const completed = effectiveStatus(session) === 'completed';

  const items = [
    {
      key: 'engagement_completed', required: true, met: completed,
      label: 'Engagement completed',
      detail: completed
        ? 'The engagement was marked completed.'
        : 'The engagement must be marked completed before closeout.',
    },
    {
      key: 'all_drafts_delivered', required: true, met: undelivered === 0,
      label: 'All milestones delivered',
      detail: total === 0
        ? 'No milestones on this engagement.'
        : undelivered === 0
          ? `All ${total} milestone${total === 1 ? '' : 's'} delivered.`
          : `${undelivered} of ${total} milestone${total === 1 ? '' : 's'} still in progress.`,
    },
    {
      key: 'all_milestones_accepted', required: true, met: accepted === total,
      label: 'All milestones accepted',
      detail: total === 0
        ? 'No milestones on this engagement.'
        : accepted === total
          ? `All ${total} milestone${total === 1 ? '' : 's'} accepted by the client.`
          : `${accepted} of ${total} milestone${total === 1 ? '' : 's'} accepted.`,
    },
    {
      key: 'no_open_change_requests', required: true, met: pendingChanges.n === 0,
      label: 'No open change requests',
      detail: pendingChanges.n === 0
        ? 'No change requests are open.'
        : `${pendingChanges.n} change request${pendingChanges.n === 1 ? ' is' : 's are'} still open.`,
    },
    {
      key: 'consultant_confirmed', required: true, met: !!closeout?.consultant_confirmed_at,
      label: 'Consultant confirmed closeout',
      detail: closeout?.consultant_confirmed_at
        ? 'The consultant confirmed the closeout.'
        : 'The consultant has not confirmed the closeout yet.',
    },
    {
      key: 'client_confirmed', required: true, met: !!closeout?.client_confirmed_at,
      label: 'Client confirmed closeout',
      detail: closeout?.client_confirmed_at
        ? 'The client confirmed the closeout.'
        : 'The client has not confirmed the closeout yet.',
    },
    {
      key: 'feedback_requested', required: false, met: feedbackReq.n > 0,
      label: 'Feedback requested from the client',
      detail: feedbackReq.n > 0
        ? 'The client was asked for feedback.'
        : 'No feedback request has been sent yet.',
    },
    {
      key: 'feedback_received', required: false, met: !!feedbackSubmittedAt,
      label: 'Client feedback received',
      detail: feedbackSubmittedAt
        ? 'The client left feedback on the engagement.'
        : 'The client has not left feedback yet.',
    },
    {
      key: 'follow_up_scheduled', required: false, met: followUpCount.n > 0,
      label: 'Follow-up scheduled',
      detail: followUpCount.n > 0
        ? `${followUpCount.n} follow-up${followUpCount.n === 1 ? ' is' : 's are'} scheduled.`
        : 'No follow-up check-in is scheduled yet.',
    },
  ];
  return {
    items,
    archiveEligible: items.every((item) => !item.required || item.met),
    closeout: presentCloseout(closeout),
  };
}

// GET /contractor/sessions/:sessionId/closeout
// GET /business-launch/sessions/:sessionId/closeout
// GET /admin/sessions/:sessionId/closeout
// The closeout record (541/542/543/544): checklist, confirmations,
// follow-ups, and feedback requests. Parties and admins only —
// participants read the engagement record through the export, not
// the closeout.
async function getCloseout(req, res) {
  const { sessionId } = req.params;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const session = await loadSession(db, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const type = actorForSession(req, session);
    if (!type) return res.status(403).json({ error: 'Session not found' });
    const checklist = await computeChecklist(db, session);
    const followUps = await loadFollowUps(db, sessionId);
    const requests = await loadFeedbackRequests(db, sessionId);
    const submittedAt = await loadFeedbackSubmittedAt(db, sessionId);
    return res.json({
      session: {
        ...session,
        id: String(session.id),
        archived: session.status === 'archived',
        effectiveStatus: effectiveStatus(session),
      },
      checklist: checklist.items,
      archiveEligible: checklist.archiveEligible,
      closeout: checklist.closeout,
      followUps: followUps.map(presentFollowUp),
      feedbackRequests: requests.map((row) => presentFeedbackRequest(row, submittedAt)),
      feedbackReceivedAt: submittedAt,
    });
  } catch (err) {
    logger.error('Consulting get closeout failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to load the closeout' });
  }
}

// POST /contractor/sessions/:sessionId/closeout/confirm
// POST /business-launch/sessions/:sessionId/closeout/confirm
// POST /admin/sessions/:sessionId/closeout/confirm
// Closeout confirmation (542): each party confirms once. The admin
// confirms on the client's behalf only (the D-115 rule), never for the
// consultant. Requires a completed engagement; closeout is agreement,
// not a second completion mechanism.
async function confirmCloseout(req, res) {
  const { sessionId } = req.params;
  const note = String(req.body?.note || '').trim() || null;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  if (note && note.length > 500) return res.status(400).json({ error: 'A closeout note is at most 500 characters', code: 'note_too_long' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (!type) return { status: 403, body: { error: 'Session not found' } };
      if (session.status === 'archived') {
        return { status: 409, body: { error: 'The engagement is archived', code: 'engagement_archived' } };
      }
      if (session.status === 'paused') {
        return { status: 409, body: { error: 'The engagement is paused', code: 'engagement_paused' } };
      }
      if (effectiveStatus(session) !== 'completed') {
        return { status: 409, body: { error: 'The engagement must be completed before closeout', code: 'engagement_not_completed' } };
      }
      // The side confirming: consultant confirms for themselves; the
      // client confirms for themselves; an admin confirms for the
      // client only.
      const side = type === 'consultant' ? 'consultant' : 'client';
      const closeout = await loadCloseout(client, sessionId);
      const alreadyConfirmed = side === 'consultant'
        ? closeout?.consultant_confirmed_at
        : closeout?.client_confirmed_at;
      if (alreadyConfirmed) {
        return { status: 409, body: { error: 'Closeout has already been confirmed by this side', code: 'already_confirmed' } };
      }
      const consultantAt = side === 'consultant' ? new Date() : closeout?.consultant_confirmed_at || null;
      const clientAt = side === 'client' ? new Date() : closeout?.client_confirmed_at || null;
      const closedAt = consultantAt && clientAt ? new Date() : null;
      const { rows: [updated] } = await client.query(
        `INSERT INTO consulting_closeouts
           (session_id, consultant_confirmed_at, consultant_confirmed_by,
            client_confirmed_at, client_confirmed_by, closed_at, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id) DO UPDATE SET
           consultant_confirmed_at = EXCLUDED.consultant_confirmed_at,
           consultant_confirmed_by = EXCLUDED.consultant_confirmed_by,
           client_confirmed_at = EXCLUDED.client_confirmed_at,
           client_confirmed_by = EXCLUDED.client_confirmed_by,
           closed_at = EXCLUDED.closed_at,
           note = COALESCE(EXCLUDED.note, consulting_closeouts.note),
           updated_at = NOW()
         RETURNING *`,
        [sessionId,
          consultantAt, side === 'consultant' ? req.user.id : closeout?.consultant_confirmed_by || null,
          clientAt, side === 'client' ? req.user.id : closeout?.client_confirmed_by || null,
          closedAt, note],
      );
      await recordEvent(client, {
        sessionId,
        eventType: 'closeout_confirmed',
        actorId: req.user.id,
        actorRole: type,
        summary: side === 'consultant'
          ? 'The consultant confirmed the closeout.'
          : 'The client confirmed the closeout.',
        metadata: { side, closed: !!closedAt },
      });
      if (closedAt) {
        await recordEvent(client, {
          sessionId,
          eventType: 'closeout_completed',
          actorId: req.user.id,
          actorRole: type,
          summary: 'Both parties confirmed the closeout. The engagement is closed.',
          metadata: { side },
        });
      }
      return { status: 200, body: { closeout: presentCloseout(updated), session, side, closed: !!closedAt } };
    });
    if (result.status === 200) {
      const { closeout, session, side, closed } = result.body;
      const otherId = side === 'consultant' ? session.user_id : session.consultant_assigned_id;
      const otherEmail = side === 'consultant'
        ? session.email : await consultantEmail(session.consultant_assigned_id);
      await notifyUser(otherId, 'consulting_closeout_confirmed',
        side === 'consultant' ? 'Your consultant confirmed the closeout' : 'Your client confirmed the closeout',
        closed
          ? 'Both parties confirmed the closeout. The engagement is now closed.'
          : side === 'consultant'
            ? 'Your consultant confirmed the closeout. Confirm it yourself to close the engagement.'
            : 'Your client confirmed the closeout. Confirm it yourself to close the engagement.',
        { sessionId: String(session.id) });
      await emailParty(otherEmail,
        side === 'consultant' ? 'Your consultant confirmed the closeout' : 'Your client confirmed the closeout',
        side === 'consultant' ? 'Your consultant confirmed the closeout' : 'Your client confirmed the closeout',
        closed
          ? 'Both parties confirmed the closeout. The engagement is now closed.'
          : 'One side has confirmed the closeout. Open the engagement to confirm it yourself.');
      delete result.body.session;
      delete result.body.side;
      delete result.body.closed;
      result.body.closed = closed;
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting confirm closeout failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to confirm the closeout' });
  }
}

// POST /contractor/sessions/:sessionId/follow-ups
// Follow-up schedule (543): the consultant books a post-close
// check-in against a completed engagement.
async function createFollowUp(req, res) {
  const { sessionId } = req.params;
  const dueAt = String(req.body?.due_at || '').trim();
  const kind = String(req.body?.kind || '').trim();
  const note = String(req.body?.note || '').trim() || null;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  if (!FOLLOW_UP_KINDS.has(kind)) return res.status(400).json({ error: 'Invalid follow-up kind', code: 'invalid_kind' });
  const due = new Date(dueAt);
  if (!dueAt || Number.isNaN(due.getTime())) return res.status(400).json({ error: 'A follow-up needs a due date and time', code: 'due_required' });
  if (due <= new Date()) return res.status(400).json({ error: 'A follow-up must be due in the future', code: 'due_in_past' });
  if (note && note.length > 500) return res.status(400).json({ error: 'A follow-up note is at most 500 characters', code: 'note_too_long' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'consultant') {
        return { status: 403, body: { error: 'Only the assigned consultant can schedule follow-ups' } };
      }
      if (session.status === 'archived') {
        return { status: 409, body: { error: 'The engagement is archived', code: 'engagement_archived' } };
      }
      if (session.status === 'paused') {
        return { status: 409, body: { error: 'The engagement is paused', code: 'engagement_paused' } };
      }
      if (effectiveStatus(session) !== 'completed') {
        return { status: 409, body: { error: 'Follow-ups are scheduled on completed engagements', code: 'engagement_not_completed' } };
      }
      const { rows: [created] } = await client.query(
        `INSERT INTO consulting_follow_ups (session_id, due_at, kind, note, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [sessionId, due.toISOString(), kind, note, req.user.id],
      );
      await recordEvent(client, {
        sessionId,
        eventType: 'follow_up_scheduled',
        actorId: req.user.id,
        actorRole: type,
        summary: `A ${kind.replace('_', '-')} follow-up was scheduled for ${due.toISOString().slice(0, 10)}.`,
        metadata: { followUpId: String(created.id), kind, dueAt: due.toISOString() },
      });
      return { status: 201, body: { followUp: presentFollowUp(created), session } };
    });
    if (result.status === 201) {
      const { followUp, session } = result.body;
      const kindLabel = { check_in: 'check-in', review: 'review', renewal: 'renewal', other: 'follow-up' }[followUp.kind] || 'follow-up';
      await notifyUser(session.user_id, 'consulting_follow_up_scheduled',
        'A follow-up check-in is scheduled',
        `Your consultant scheduled a ${kindLabel} for ${String(followUp.dueAt).slice(0, 10)}.`,
        { sessionId: String(session.id), followUpId: followUp.id });
      await emailParty(session.email, 'A follow-up check-in is scheduled',
        'A follow-up check-in is scheduled',
        `Your consultant scheduled a ${kindLabel} for ${String(followUp.dueAt).slice(0, 10)}.`);
      delete result.body.session;
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting create follow-up failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to schedule the follow-up' });
  }
}

// PATCH /contractor/sessions/:sessionId/follow-ups/:followUpId
// The consultant marks a follow-up done or cancels it. Only a
// scheduled follow-up moves; done and cancelled are terminal.
async function updateFollowUp(req, res) {
  const { sessionId, followUpId } = req.params;
  const next = String(req.body?.status || '').trim();
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  if (!validFollowUpId(followUpId)) return res.status(400).json({ error: 'Invalid follow-up id' });
  if (next !== 'done' && next !== 'cancelled') {
    return res.status(400).json({ error: 'A follow-up can only be marked done or cancelled', code: 'invalid_transition' });
  }
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'consultant') {
        return { status: 403, body: { error: 'Only the assigned consultant can update follow-ups' } };
      }
      if (session.status === 'archived') {
        return { status: 409, body: { error: 'The engagement is archived', code: 'engagement_archived' } };
      }
      const { rows: [row] } = await client.query(
        'SELECT * FROM consulting_follow_ups WHERE id = $1 AND session_id = $2',
        [followUpId, sessionId],
      );
      if (!row) return { status: 404, body: { error: 'Follow-up not found' } };
      if (row.status !== 'scheduled') {
        return { status: 409, body: { error: `This follow-up is already ${row.status}`, code: 'invalid_transition' } };
      }
      const stamp = next === 'done' ? 'completed_at' : 'cancelled_at';
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_follow_ups
            SET status = $1, ${stamp} = NOW(), updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [next, followUpId],
      );
      await recordEvent(client, {
        sessionId,
        eventType: next === 'done' ? 'follow_up_done' : 'follow_up_cancelled',
        actorId: req.user.id,
        actorRole: type,
        summary: next === 'done'
          ? 'A follow-up check-in was completed.'
          : 'A follow-up check-in was cancelled.',
        metadata: { followUpId: String(updated.id), kind: updated.kind },
      });
      return { status: 200, body: { followUp: presentFollowUp(updated) } };
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting update follow-up failed', { sessionId, followUpId, error: err.message });
    return res.status(500).json({ error: 'Failed to update the follow-up' });
  }
}

// GET /contractor/follow-ups
// The consultant's due list (543): scheduled follow-ups across their
// engagements, soonest first. No sweeper sends due notifications; this
// list is the surface a consultant checks.
async function listMyFollowUps(req, res) {
  const status = String(req.query?.status || 'scheduled').trim();
  const dueBefore = String(req.query?.due_before || '').trim();
  const dueAfter = String(req.query?.due_after || '').trim();
  if (!['scheduled', 'done', 'cancelled', 'all'].includes(status)) {
    return res.status(400).json({ error: 'Invalid follow-up status filter' });
  }
  try {
    const conditions = ['cs.consultant_assigned_id = $1'];
    const values = [req.user.id];
    let idx = 2;
    if (status !== 'all') {
      conditions.push(`f.status = $${idx}`);
      values.push(status);
      idx += 1;
    }
    if (dueBefore) {
      const parsed = new Date(dueBefore);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid due_before date' });
      conditions.push(`f.due_at <= $${idx}`);
      values.push(parsed.toISOString());
      idx += 1;
    }
    if (dueAfter) {
      const parsed = new Date(dueAfter);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid due_after date' });
      conditions.push(`f.due_at >= $${idx}`);
      values.push(parsed.toISOString());
      idx += 1;
    }
    const { rows } = await db.query(
      `SELECT f.*, cs.business_name, cs.first_name, cs.last_name
         FROM consulting_follow_ups f
         JOIN consulting_sessions cs ON cs.id = f.session_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY f.due_at ASC, f.created_at ASC
        LIMIT 100`,
      values,
    );
    return res.json({
      followUps: rows.map((row) => ({
        ...presentFollowUp(row),
        businessName: row.business_name,
        clientName: `${row.first_name || ''} ${row.last_name || ''}`.trim() || null,
      })),
    });
  } catch (err) {
    logger.error('Consulting list follow-ups failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to load follow-ups' });
  }
}

// POST /contractor/sessions/:sessionId/feedback-request
// Client feedback request (544): the consultant asks the client for
// feedback at closeout. Submission stays the existing authenticated
// feedback endpoint (Slice E, item 529); the request is satisfied when
// a session feedback row exists. One open request per session.
async function requestFeedback(req, res) {
  const { sessionId } = req.params;
  const note = String(req.body?.note || '').trim() || null;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  if (note && note.length > 500) return res.status(400).json({ error: 'A feedback request note is at most 500 characters', code: 'note_too_long' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'consultant') {
        return { status: 403, body: { error: 'Only the assigned consultant can request feedback' } };
      }
      if (session.status === 'archived') {
        return { status: 409, body: { error: 'The engagement is archived', code: 'engagement_archived' } };
      }
      if (session.status === 'paused') {
        return { status: 409, body: { error: 'The engagement is paused', code: 'engagement_paused' } };
      }
      if (effectiveStatus(session) !== 'completed') {
        return { status: 409, body: { error: 'Feedback is requested on completed engagements', code: 'engagement_not_completed' } };
      }
      const submittedAt = await loadFeedbackSubmittedAt(client, sessionId);
      if (submittedAt) {
        return { status: 409, body: { error: 'The client has already left feedback', code: 'feedback_already_received' } };
      }
      const existing = await loadFeedbackRequests(client, sessionId);
      if (existing.length > 0) {
        return { status: 409, body: { error: 'A feedback request is already open', code: 'feedback_request_open' } };
      }
      const { rows: [created] } = await client.query(
        `INSERT INTO consulting_feedback_requests (session_id, requested_by, note)
         VALUES ($1, $2, $3) RETURNING *`,
        [sessionId, req.user.id, note],
      );
      await recordEvent(client, {
        sessionId,
        eventType: 'feedback_requested',
        actorId: req.user.id,
        actorRole: type,
        summary: 'The consultant requested feedback from the client.',
        metadata: { requestId: String(created.id) },
      });
      return { status: 201, body: { feedbackRequest: presentFeedbackRequest(created, null), session } };
    });
    if (result.status === 201) {
      const { feedbackRequest, session } = result.body;
      await notifyUser(session.user_id, 'consulting_feedback_requested',
        'Your consultant requested your feedback',
        'Your consultant asked for your feedback on the engagement. Open your milestone board to leave it.',
        { sessionId: String(session.id), requestId: feedbackRequest.id });
      await emailParty(session.email, 'Your consultant requested your feedback',
        'Your consultant requested your feedback',
        'Your consultant asked for your feedback on the engagement. Open your milestone board to leave a rating and a note.');
      delete result.body.session;
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting request feedback failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to request feedback' });
  }
}

// POST /contractor/sessions/:sessionId/archive
// POST /admin/sessions/:sessionId/archive
// Engagement archive (545): a closed engagement leaves the active
// lists. Archive requires the closeout to be complete (both parties
// confirmed); the client cannot archive, and an admin confirms on the
// client's behalf only. The status becomes 'archived' with the
// pre-archive status kept, so unarchive restores it.
async function archiveEngagement(req, res) {
  const { sessionId } = req.params;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'consultant' && type !== 'admin') {
        return { status: 403, body: { error: 'Only the assigned consultant or an administrator can archive an engagement' } };
      }
      if (session.status === 'archived') {
        return { status: 409, body: { error: 'The engagement is already archived', code: 'already_archived' } };
      }
      if (session.status === 'paused') {
        return { status: 409, body: { error: 'The engagement is paused', code: 'engagement_paused' } };
      }
      // Archive requires the whole required checklist (541), which
      // includes both closeout confirmations (542): the checklist is
      // the gate, and the response names what is still missing.
      const checklist = await computeChecklist(client, session);
      if (!checklist.archiveEligible) {
        return {
          status: 409,
          body: {
            error: 'The final deliverable checklist is not complete',
            code: 'checklist_incomplete',
            unmet: checklist.items.filter((item) => item.required && !item.met).map((item) => item.key),
          },
        };
      }
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_sessions
            SET status = 'archived', archived_at = NOW(), archived_by = $1,
                status_before_archive = $2, updated_at = NOW()
          WHERE id = $3 RETURNING *`,
        [req.user.id, session.status, sessionId],
      );
      await recordEvent(client, {
        sessionId,
        eventType: 'engagement_archived',
        actorId: req.user.id,
        actorRole: type,
        summary: 'The engagement was archived.',
        metadata: { statusBeforeArchive: session.status },
      });
      return { status: 200, body: { session: updated } };
    });
    if (result.status === 200) {
      const { session } = result.body;
      const actorIsConsultant = String(session.consultant_assigned_id) === String(req.user.id);
      await notifyUser(session.user_id, 'consulting_engagement_archived',
        'Your engagement was archived',
        'Your engagement was archived. Its record stays available to you.',
        { sessionId: String(session.id) });
      await emailParty(session.email, 'Your engagement was archived',
        'Your engagement was archived',
        'Your engagement was archived. Its record stays available on your milestone board.');
      if (!actorIsConsultant && session.consultant_assigned_id) {
        await notifyUser(session.consultant_assigned_id, 'consulting_engagement_archived',
          'An engagement was archived',
          'An engagement you worked on was archived. Its record stays available.',
          { sessionId: String(session.id) });
      }
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting archive engagement failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to archive the engagement' });
  }
}

// POST /contractor/sessions/:sessionId/unarchive
// POST /admin/sessions/:sessionId/unarchive
// Unarchive restores the pre-archive status (usually 'completed') and
// clears the archive bookkeeping.
async function unarchiveEngagement(req, res) {
  const { sessionId } = req.params;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'consultant' && type !== 'admin') {
        return { status: 403, body: { error: 'Only the assigned consultant or an administrator can unarchive an engagement' } };
      }
      if (session.status !== 'archived') {
        return { status: 409, body: { error: 'The engagement is not archived', code: 'not_archived' } };
      }
      const restored = session.status_before_archive || 'completed';
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_sessions
            SET status = $1, archived_at = NULL, archived_by = NULL,
                status_before_archive = NULL, updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [restored, sessionId],
      );
      await recordEvent(client, {
        sessionId,
        eventType: 'engagement_unarchived',
        actorId: req.user.id,
        actorRole: type,
        summary: `The engagement was unarchived (${restored}).`,
        metadata: { restoredStatus: restored },
      });
      return { status: 200, body: { session: updated } };
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting unarchive engagement failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to unarchive the engagement' });
  }
}

module.exports = {
  getCloseout,
  confirmCloseout,
  createFollowUp,
  updateFollowUp,
  listMyFollowUps,
  requestFeedback,
  archiveEngagement,
  unarchiveEngagement,
};
