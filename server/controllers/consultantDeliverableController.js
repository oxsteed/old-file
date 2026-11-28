'use strict';

const crypto = require('node:crypto');
const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
const { sendNotification } = require('../services/notificationService');
const { withTransaction } = require('../utils/transaction');
const { uploadFile, getSignedDownloadUrl, deleteFile } = require('../utils/storage');
const { enqueueStorageDeletion } = require('../services/storageCleanupService');

// Group 10 Slice E (items 526-530): deliver work.
// The milestone board runs on consulting_deliverables, the session-scoped
// milestone entity (name, type, due date, status). Start-engagement seeds
// the board from the approved proposal (the D-118 handoff): one session
// per engaged referral, deliverables copied from the approved version.
// The consultant moves milestones forward and delivers drafts; documents
// exchange on a milestone with the business-launch attachment pattern
// (visibility + sha256 + 900s signed URLs); the client leaves feedback
// and accepts milestones. Acceptance is the client's own act and is
// final; change requests go through Slice F. Decisions D-119..D-125 in
// persona-roadmap-decisions.md.
//
// Group 10 Slice G (536-540): maintain confidentiality. Participants
// (site_contact / observer) read the board and the documents shared
// with them; documents gain 'limited' visibility with named shares
// plus an expiry that is enforced at list and download time.
// Decisions D-132..D-137 in persona-roadmap-decisions.md.

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const BIGINT_RE = /^\d+$/;

// Consultant-driven moves. Acceptance is client-only (acceptDeliverable).
// 'overdue' is a display state, never a transition target.
const STATUS_TRANSITIONS = {
  pending: ['in_progress'],
  in_progress: ['draft_delivered', 'completed'],
  draft_delivered: ['in_progress', 'completed'],
  completed: [],
  accepted: [],
  overdue: [],
};
const ACCEPTABLE_FROM = new Set(['draft_delivered', 'completed']);
const DOCUMENT_VISIBILITIES = new Set(['shared', 'client_only', 'consultant_only', 'internal']);

function validRequestId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function validSessionId(value) {
  return typeof value === 'string' && BIGINT_RE.test(value);
}

function isAdmin(req) {
  return req?.user?.role === 'admin' || req?.user?.role === 'super_admin';
}

function isDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

// Actor on an engagement session: 'admin', 'client' (session owner),
// 'consultant' (assigned consultant), or null for anyone else.
function actorForSession(req, session) {
  if (!req?.user || !session) return null;
  if (isAdmin(req)) return 'admin';
  if (session.user_id && String(session.user_id) === String(req.user.id)) return 'client';
  if (session.consultant_assigned_id && String(session.consultant_assigned_id) === String(req.user.id)) return 'consultant';
  return null;
}

// The client owner rule for a referral, identical to Slice D: the request
// owner by user_id, or a guest submission recovered by verified email.
function isClientOwner(req, referral) {
  if (!req?.user || !referral) return false;
  if (isAdmin(req)) return true;
  if (referral.user_id && String(referral.user_id) === String(req.user.id)) return true;
  if (!referral.user_id && req.user.email_verified && referral.email
    && String(referral.email).toLowerCase() === String(req.user.email || '').toLowerCase()) return true;
  return false;
}

function visibleClause(type) {
  if (type === 'admin') return 'TRUE';
  if (type === 'client') return `visibility IN ('shared', 'client_only')`;
  if (type === 'consultant') return `visibility IN ('shared', 'consultant_only')`;
  if (type === 'participant') return `(
    visibility = 'shared'
    OR (visibility = 'limited' AND EXISTS (
      SELECT 1 FROM consulting_document_shares s
       WHERE s.document_id = d.id AND s.user_id = $2
    ))
  )`;
  return 'FALSE';
}

// Group 10 Slice G (536): an active participant row for this session
// and user, or null. Removal is soft, so a removed row never matches.
async function loadActiveParticipant(client, sessionId, userId) {
  if (!userId) return null;
  const { rows: [row] } = await client.query(
    `SELECT * FROM consulting_session_participants
      WHERE session_id = $1 AND user_id = $2 AND removed_at IS NULL`,
    [sessionId, userId],
  );
  return row || null;
}

// The actor on a session, participant-aware: 'admin', 'client',
// 'consultant', 'participant' (with .participantRole), or null.
// The mutation handlers keep using actorForSession, which does not
// know participants, so a participant can never upload, move, accept,
// or file: those handlers see null and refuse.
async function resolveSessionActor(client, req, session) {
  const type = actorForSession(req, session);
  if (type) return { type, participantRole: null };
  if (!req?.user?.id) return { type: null, participantRole: null };
  const participant = await loadActiveParticipant(client, session.id, req.user.id);
  if (!participant) return { type: null, participantRole: null };
  return { type: 'participant', participantRole: participant.role };
}

async function loadSession(client, sessionId) {
  const { rows: [session] } = await client.query(
    `SELECT id, user_id, email, first_name, last_name, business_name,
            consultant_assigned_id, status, current_phase, referral_id,
            description, paused_at, paused_by, pause_reason,
            status_before_pause, archived_at, archived_by,
            status_before_archive, created_at, updated_at
       FROM consulting_sessions WHERE id = $1`,
    [sessionId],
  );
  return session || null;
}

async function loadReferral(client, requestId) {
  const { rows: [referral] } = await client.query(
    `SELECT id, user_id, email, first_name, last_name, phone, business_name,
            consultant_assigned_id, consultant_assignment_status
       FROM consulting_requests WHERE id = $1`,
    [requestId],
  );
  return referral || null;
}

async function loadDeliverable(client, sessionId, deliverableId) {
  if (!BIGINT_RE.test(String(deliverableId))) return null;
  const { rows: [row] } = await client.query(
    `SELECT * FROM consulting_deliverables WHERE id = $1 AND session_id = $2`,
    [deliverableId, sessionId],
  );
  return row || null;
}

// Group 10 Slice G (537, 539): expired documents stay listed
// (flagged) for the uploader and for admins, so the expiry can be
// renewed; every other party stops seeing them at expiry. 'limited'
// documents carry their named share list so the board can show who
// can see them.
async function loadDocumentsFor(client, deliverableId, type, userId) {
  const { rows } = await client.query(
    `SELECT d.id, d.deliverable_id, d.uploaded_by, d.original_name, d.content_type,
            d.size_bytes, d.visibility, d.expires_at, d.created_at,
            (d.expires_at IS NOT NULL AND d.expires_at <= NOW()) AS expired
       FROM consulting_deliverable_documents d
      WHERE d.deliverable_id = $1 AND d.deleted_at IS NULL AND (${visibleClause(type)})
        AND (d.expires_at IS NULL OR d.expires_at > NOW()
             OR d.uploaded_by = $2 OR $3::boolean)
      ORDER BY d.created_at DESC, d.id DESC`,
    [deliverableId, userId, type === 'admin'],
  );
  const limitedIds = rows.filter((row) => row.visibility === 'limited').map((row) => row.id);
  const sharesByDoc = {};
  if (limitedIds.length > 0) {
    const { rows: shareRows } = await client.query(
      `SELECT document_id, user_id FROM consulting_document_shares
        WHERE document_id = ANY($1)`,
      [limitedIds],
    );
    for (const share of shareRows) {
      (sharesByDoc[String(share.document_id)] ||= []).push(String(share.user_id));
    }
  }
  return rows.map((row) => ({
    id: String(row.id),
    deliverableId: String(row.deliverable_id),
    uploadedBy: String(row.uploaded_by),
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    visibility: row.visibility,
    expiresAt: row.expires_at,
    expired: row.expired === true,
    sharedWith: sharesByDoc[String(row.id)] || [],
    createdAt: row.created_at,
  }));
}

async function presentDeliverable(client, row, type, userId) {
  const documents = await loadDocumentsFor(client, row.id, type, userId);
  const { rows: [feedback] } = await client.query(
    `SELECT COUNT(*)::int AS count, MAX(session_quality_rating) AS latest_rating
       FROM consulting_session_feedback WHERE deliverable_id = $1`,
    [row.id],
  );
  return {
    ...row,
    id: String(row.id),
    session_id: String(row.session_id),
    documents,
    feedback_count: feedback?.count || 0,
    latest_rating: feedback?.latest_rating ?? null,
  };
}

// S-D2 (D-731): this helper used to pass `message` and `metadata`,
// which sendNotification silently drops (it reads `body`/`data`), so
// all 15 types arrived title-only with an empty body and no link. The
// params are now the names sendNotification reads, plus the action URL
// each call site passes for its recipient's side (client portal or
// contractor dashboard).
async function notifyUser({ userId, type, title, body, data, actionUrl }) {
  if (!userId) return;
  try {
    await sendNotification({
      userId: String(userId), type, title, body, data: data || {}, action_url: actionUrl || null,
    });
  } catch (err) {
    logger.warn('Consulting deliverable notification failed', { userId, type, error: err.message });
  }
}

async function emailParty(email, subject, heading, body) {
  if (!email) return;
  try {
    const html = renderOxSteedEmail({ subject, heading, body });
    await sendEmail({ to: email, subject, html });
  } catch (err) {
    logger.warn('Consulting deliverable email failed', { email, subject, error: err.message });
  }
}

// POST /contractor/referrals/:requestId/start-engagement
// The D-118 handoff: an engaged referral becomes a working session, and
// the approved proposal's deliverables seed the milestone board. One
// session per referral (unique index on referral_id); a second call 409s.
async function startEngagement(req, res) {
  const requestId = req.params.requestId;
  if (!validRequestId(requestId)) return res.status(400).json({ error: 'Invalid request id' });
  try {
    const result = await withTransaction(db, async (client) => {
      const referral = await loadReferral(client, requestId);
      if (!referral) return { status: 404, body: { error: 'Request not found' } };
      const assigned = referral.consultant_assigned_id
        && String(referral.consultant_assigned_id) === String(req.user?.id);
      if (!isAdmin(req) && !assigned) return { status: 403, body: { error: 'Only the assigned consultant can start the engagement' } };
      if (referral.consultant_assignment_status !== 'engaged') {
        return { status: 409, body: { error: 'The referral is not engaged yet', code: 'referral_not_engaged' } };
      }
      const existing = await client.query(
        'SELECT id FROM consulting_sessions WHERE referral_id = $1', [requestId],
      );
      if (existing.rows.length > 0) {
        return { status: 409, body: { error: 'The engagement already has a session', code: 'session_exists', sessionId: String(existing.rows[0].id) } };
      }
      const { rows: [approved] } = await client.query(
        `SELECT * FROM consulting_engagement_proposals
          WHERE request_id = $1 AND status = 'approved'
          ORDER BY version DESC LIMIT 1`,
        [requestId],
      );
      if (!approved) {
        return { status: 409, body: { error: 'No approved proposal to start from', code: 'no_approved_proposal' } };
      }
      const { rows: [session] } = await client.query(
        `INSERT INTO consulting_sessions
           (user_id, email, first_name, last_name, business_name, phone,
            consultant_assigned_id, status, current_phase, referral_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 1, $8)
         RETURNING *`,
        [referral.user_id, referral.email, referral.first_name, referral.last_name,
          referral.business_name || null, referral.phone || null,
          referral.consultant_assigned_id, requestId],
      );
      const { rows: proposalDeliverables } = await client.query(
        `SELECT * FROM consulting_proposal_deliverables
          WHERE proposal_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [approved.id],
      );
      const seeded = [];
      for (const item of proposalDeliverables) {
        const { rows: [created] } = await client.query(
          `INSERT INTO consulting_deliverables
             (session_id, name, description, deliverable_type, due_date, status,
              source_proposal_id, source_proposal_deliverable_id)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
           RETURNING *`,
          [session.id, item.title, item.description || null, item.deliverable_type,
            item.due_date || null, approved.id, item.id],
        );
        seeded.push(created);
      }
      return { status: 201, body: { session, deliverables: seeded } };
    });
    if (result.status === 201 && result.body.session?.user_id) {
      await notifyUser({
        userId: result.body.session.user_id, type: 'consulting_engagement_started',
        title: 'Your engagement has started',
        body: 'Your consultant started work on your engagement. Your milestone board is ready.',
        actionUrl: '/consulting/portal',
      });
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'The engagement already has a session', code: 'session_exists' });
    }
    logger.error('Consulting start engagement failed', { requestId, error: err.message });
    return res.status(500).json({ error: 'Failed to start the engagement' });
  }
}

// GET /contractor/engagements
// The consultant's engagement sessions, newest first, with board counts.
// Archived engagements are hidden by default (?archived=true lists them).
async function listMyEngagements(req, res) {
  const archived = String(req.query?.archived || '').trim() === 'true';
  try {
    const { rows } = await db.query(
      `SELECT cs.*,
              cr.business_name AS referral_business_name,
              (SELECT COUNT(*)::int FROM consulting_deliverables d WHERE d.session_id = cs.id) AS deliverable_count,
              (SELECT COUNT(*)::int FROM consulting_deliverables d WHERE d.session_id = cs.id AND d.status = 'accepted') AS accepted_count
         FROM consulting_sessions cs
         LEFT JOIN consulting_requests cr ON cr.id = cs.referral_id
        WHERE cs.consultant_assigned_id = $1
          AND ($2::boolean OR cs.status <> 'archived')
        ORDER BY cs.created_at DESC LIMIT 50`,
      [req.user.id, archived],
    );
    return res.json({ engagements: rows.map((row) => ({ ...row, id: String(row.id) })) });
  } catch (err) {
    logger.error('Consulting list engagements failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to load engagements' });
  }
}

// GET /business-launch/requests/:id/session
// The client entry point to the milestone board: the session behind an
// engaged referral, with its deliverables.
async function getEngagementSession(req, res) {
  const requestId = req.params.id;
  if (!validRequestId(requestId)) return res.status(400).json({ error: 'Invalid request id' });
  try {
    const referral = await loadReferral(db, requestId);
    if (!referral) return res.status(404).json({ error: 'Request not found' });
    if (!isClientOwner(req, referral)) return res.status(403).json({ error: 'Only the request owner can view the engagement' });
    const { rows: [session] } = await db.query(
      'SELECT * FROM consulting_sessions WHERE referral_id = $1', [requestId],
    );
    if (!session) return res.status(404).json({ error: 'The engagement has not started yet', code: 'session_not_started' });
    const type = isAdmin(req) ? 'admin' : 'client';
    const { rows: deliverableRows } = await db.query(
      'SELECT * FROM consulting_deliverables WHERE session_id = $1 ORDER BY due_date ASC NULLS LAST, id ASC',
      [session.id],
    );
    const deliverables = [];
    for (const row of deliverableRows) deliverables.push(await presentDeliverable(db, row, type, req.user.id));
    return res.json({ session: { ...session, id: String(session.id) }, deliverables });
  } catch (err) {
    logger.error('Consulting get engagement session failed', { requestId, error: err.message });
    return res.status(500).json({ error: 'Failed to load the engagement' });
  }
}

// GET deliverables for a session (consultant, client, or admin leg).
// The same handler serves all three routers; the actor check decides.
async function listDeliverables(req, res) {
  const sessionId = req.params.sessionId;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const session = await loadSession(db, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    // Group 10 Slice G (536): participants read the board too.
    const { type } = await resolveSessionActor(db, req, session);
    if (!type) return res.status(403).json({ error: 'Only the session client, consultant, participants, or an administrator can view deliverables' });
    const { rows } = await db.query(
      'SELECT * FROM consulting_deliverables WHERE session_id = $1 ORDER BY due_date ASC NULLS LAST, id ASC',
      [sessionId],
    );
    const deliverables = [];
    for (const row of rows) deliverables.push(await presentDeliverable(db, row, type, req.user.id));
    return res.json({ session: { ...session, id: String(session.id) }, deliverables });
  } catch (err) {
    logger.error('Consulting list deliverables failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to load deliverables' });
  }
}

// PATCH /contractor/sessions/:sessionId/deliverables/:deliverableId/status
// Consultant-only milestone moves along the machine in STATUS_TRANSITIONS.
async function updateDeliverableStatus(req, res) {
  const { sessionId, deliverableId } = req.params;
  const next = String(req.body?.status || '').trim();
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const session = await loadSession(db, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const type = actorForSession(req, session);
    if (type !== 'consultant') {
      return res.status(403).json({ error: 'Only the assigned consultant can move milestones' });
    }
    // Slice F (535): a paused engagement takes no milestone moves.
    if (session.status === 'paused') {
      return res.status(409).json({ error: 'The engagement is paused', code: 'engagement_paused' });
    }
    // Slice H (545): an archived engagement takes no milestone moves.
    if (session.status === 'archived') {
      return res.status(409).json({ error: 'The engagement is archived', code: 'engagement_archived' });
    }
    const deliverable = await loadDeliverable(db, sessionId, deliverableId);
    if (!deliverable) return res.status(404).json({ error: 'Deliverable not found' });
    const allowed = STATUS_TRANSITIONS[deliverable.status] || [];
    if (!allowed.includes(next)) {
      return res.status(409).json({ error: `Cannot move a ${deliverable.status} milestone to ${next || 'empty'}`, code: 'invalid_transition' });
    }
    // The completion timestamp is computed here (not in a CASE reusing $1):
    // pg's untyped-parameter inference rejects a parameter used both as
    // the SET value and inside the CASE in the same statement.
    const completedDate = next === 'completed' ? new Date() : deliverable.completed_date;
    const { rows: [updated] } = await db.query(
      `UPDATE consulting_deliverables
          SET status = $1, completed_date = $2, updated_at = NOW()
        WHERE id = $3 RETURNING *`,
      [next, completedDate, deliverable.id],
    );
    return res.json({ deliverable: await presentDeliverable(db, updated, 'consultant', req.user.id) });
  } catch (err) {
    logger.error('Consulting update deliverable status failed', { sessionId, deliverableId, error: err.message });
    return res.status(500).json({ error: 'Failed to update the milestone' });
  }
}

// POST /contractor/sessions/:sessionId/deliverables/:deliverableId/deliver-draft
// Draft delivery (528): the consultant puts a draft in front of the
// client with a note. A note or an attached document is required, so a
// draft delivery always carries something to review.
async function deliverDraft(req, res) {
  const { sessionId, deliverableId } = req.params;
  const note = String(req.body?.draft_note || '').trim();
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'consultant') return { status: 403, body: { error: 'Only the assigned consultant can deliver a draft' } };
      // Slice F (535): a paused engagement takes no draft deliveries.
      if (session.status === 'paused') return { status: 409, body: { error: 'The engagement is paused', code: 'engagement_paused' } };
      // Slice H (545): an archived engagement takes no draft deliveries.
      if (session.status === 'archived') return { status: 409, body: { error: 'The engagement is archived', code: 'engagement_archived' } };
      const deliverable = await loadDeliverable(client, sessionId, deliverableId);
      if (!deliverable) return { status: 404, body: { error: 'Deliverable not found' } };
      if (!['in_progress', 'draft_delivered'].includes(deliverable.status)) {
        return { status: 409, body: { error: `A ${deliverable.status} milestone cannot take a draft delivery`, code: 'invalid_transition' } };
      }
      const { rows: [docCount] } = await client.query(
        `SELECT COUNT(*)::int AS count FROM consulting_deliverable_documents
          WHERE deliverable_id = $1 AND deleted_at IS NULL`,
        [deliverable.id],
      );
      if (!note && docCount.count === 0) {
        return { status: 400, body: { error: 'A draft delivery needs a note or an attached document', code: 'draft_empty' } };
      }
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_deliverables
            SET status = 'draft_delivered', draft_note = $1, updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [note || null, deliverable.id],
      );
      return { status: 200, body: { deliverable: updated, session } };
    });
    if (result.status === 200) {
      const { deliverable, session } = result.body;
      await notifyUser({
        userId: session.user_id, type: 'consulting_draft_delivered',
        title: 'A draft is ready for your review',
        body: `Your consultant delivered a draft of "${deliverable.name}". Review it on your milestone board.`,
        data: { sessionId: String(session.id), deliverableId: String(deliverable.id) },
        actionUrl: '/consulting/portal',
      });
      await emailParty(session.email, 'A draft is ready for your review',
        'A draft is ready for your review',
        `Your consultant delivered a draft of "${deliverable.name}". Open your milestone board to review it and leave feedback.`);
      result.body.deliverable = await presentDeliverable(db, deliverable, 'consultant', req.user.id);
      delete result.body.session;
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting deliver draft failed', { sessionId, deliverableId, error: err.message });
    return res.status(500).json({ error: 'Failed to deliver the draft' });
  }
}

// POST .../deliverables/:deliverableId/documents
// Document exchange (527): either party attaches a file to a milestone.
// Visibility mirrors business_launch_attachments; a party cannot create
// files for the other side only, and 'internal' is admin-only.
async function attachDocument(req, res) {
  const { sessionId, deliverableId } = req.params;
  let storageKey = null;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const session = await loadSession(db, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const type = actorForSession(req, session);
    if (!type) return res.status(404).json({ error: 'Session not found' });
    // Slice H (545): an archived engagement takes no new documents.
    // The guard sits before the upload so no file is orphaned in storage.
    if (session.status === 'archived') {
      return res.status(409).json({ error: 'The engagement is archived', code: 'engagement_archived' });
    }
    const deliverable = await loadDeliverable(db, sessionId, deliverableId);
    if (!deliverable) return res.status(404).json({ error: 'Deliverable not found' });
    if (!req.file) return res.status(400).json({ error: 'file is required', code: 'attachment_required' });
    const requested = String(req.body?.visibility || 'shared').trim().toLowerCase();
    if (!DOCUMENT_VISIBILITIES.has(requested)) {
      return res.status(400).json({ error: 'Invalid document visibility', code: 'invalid_visibility' });
    }
    if (type === 'client' && ['consultant_only', 'internal'].includes(requested)) {
      return res.status(403).json({ error: 'Clients cannot create consultant-only files', code: 'visibility_forbidden' });
    }
    if (type === 'consultant' && ['client_only', 'internal'].includes(requested)) {
      return res.status(403).json({ error: 'Consultants cannot create client-only files', code: 'visibility_forbidden' });
    }
    if (type !== 'admin' && requested === 'internal') {
      return res.status(403).json({ error: 'Only administrators can create internal files', code: 'visibility_forbidden' });
    }
    storageKey = await uploadFile(
      req.file.buffer,
      `consulting-deliverables/private/${deliverable.id}`,
      req.file.originalname,
      req.file.mimetype,
    );
    if (!storageKey) return res.status(503).json({ error: 'File storage is not configured', code: 'storage_unavailable' });
    const digest = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const { rows } = await db.query(
      `INSERT INTO consulting_deliverable_documents
         (deliverable_id, uploaded_by, storage_key, original_name, content_type, size_bytes, sha256, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, deliverable_id, uploaded_by, original_name, content_type, size_bytes, visibility, created_at`,
      [deliverable.id, req.user.id, storageKey, String(req.file.originalname || 'file').slice(0, 255),
        req.file.mimetype, req.file.size, digest, requested],
    );
    storageKey = null;
    const row = rows[0];
    return res.status(201).json({
      document: {
        id: String(row.id), deliverableId: String(row.deliverable_id),
        uploadedBy: String(row.uploaded_by), originalName: row.original_name,
        contentType: row.content_type, sizeBytes: Number(row.size_bytes),
        visibility: row.visibility, createdAt: row.created_at,
      },
    });
  } catch (err) {
    if (storageKey) await deleteFile(storageKey).catch(() => {});
    logger.error('Consulting deliverable document upload failed', { sessionId, deliverableId, code: err.code });
    return res.status(500).json({ error: 'Failed to upload the document' });
  }
}

// GET .../deliverables/:deliverableId/documents
async function listDocuments(req, res) {
  const { sessionId, deliverableId } = req.params;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const session = await loadSession(db, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    // Group 10 Slice G (536): participants read documents too.
    const { type } = await resolveSessionActor(db, req, session);
    if (!type) return res.status(403).json({ error: 'Only the session client, consultant, participants, or an administrator can view documents' });
    const deliverable = await loadDeliverable(db, sessionId, deliverableId);
    if (!deliverable) return res.status(404).json({ error: 'Deliverable not found' });
    const documents = await loadDocumentsFor(db, deliverable.id, type, req.user.id);
    return res.json({ documents });
  } catch (err) {
    logger.error('Consulting list deliverable documents failed', { sessionId, deliverableId, error: err.message });
    return res.status(500).json({ error: 'Failed to load documents' });
  }
}

// GET /documents/:documentId/download
// Audience-checked download: the caller must be a party to the session
// and the visibility must allow them. Returns a 900s signed URL, the
// same shape as the business-launch attachment download.
async function downloadDocument(req, res) {
  const documentId = req.params.documentId;
  if (!validRequestId(documentId)) return res.status(400).json({ error: 'Invalid document id' });
  try {
    const { rows: [row] } = await db.query(
      `SELECT d.*, cs.id AS session_id, cs.user_id, cs.consultant_assigned_id
         FROM consulting_deliverable_documents d
         JOIN consulting_deliverables cd ON cd.id = d.deliverable_id
         JOIN consulting_sessions cs ON cs.id = cd.session_id
        WHERE d.id = $1 AND d.deleted_at IS NULL`,
      [documentId],
    );
    if (!row) return res.status(404).json({ error: 'Document not found' });
    const session = {
      id: row.session_id, user_id: row.user_id, consultant_assigned_id: row.consultant_assigned_id,
    };
    // Group 10 Slice G (536, 537, 539): participants download 'shared'
    // documents and 'limited' documents shared with them by name; an
    // expired document is a 410 for everyone, including the uploader
    // (renewal goes through the sharing update, not a download).
    const { type } = await resolveSessionActor(db, req, session);
    if (!type) return res.status(404).json({ error: 'Document not found' });
    let allowed = false;
    if (type === 'admin') allowed = true;
    else if (type === 'client') allowed = ['shared', 'client_only'].includes(row.visibility);
    else if (type === 'consultant') allowed = ['shared', 'consultant_only'].includes(row.visibility);
    else if (type === 'participant' && row.visibility === 'shared') allowed = true;
    else if (type === 'participant' && row.visibility === 'limited') {
      const { rows: [share] } = await db.query(
        `SELECT 1 FROM consulting_document_shares WHERE document_id = $1 AND user_id = $2`,
        [documentId, req.user.id],
      );
      allowed = share !== undefined;
    }
    if (!allowed) return res.status(404).json({ error: 'Document not found' });
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      return res.status(410).json({ error: 'Document expired', code: 'document_expired' });
    }
    const url = await getSignedDownloadUrl(row.storage_key, 900);
    if (!url) return res.status(503).json({ error: 'File download is temporarily unavailable', code: 'storage_unavailable' });
    res.set('Cache-Control', 'private, no-store');
    return res.json({ url });
  } catch (err) {
    logger.error('Consulting deliverable document download failed', { documentId, error: err.message });
    return res.status(500).json({ error: 'Failed to prepare download' });
  }
}

// POST /business-launch/sessions/:sessionId/feedback
// Client feedback (529): the session owner rates the delivered work
// (1-5) with an optional note, naming a milestone or the session as a
// whole. One feedback row per client per session per milestone.
async function submitFeedback(req, res) {
  const sessionId = req.params.sessionId;
  const rating = Number(req.body?.rating);
  const text = String(req.body?.feedback_text || '').trim();
  const deliverableId = req.body?.deliverable_id ? String(req.body.deliverable_id) : null;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'client') return { status: 403, body: { error: 'Only the session client can leave feedback' } };
      let deliverable = null;
      if (deliverableId) {
        deliverable = await loadDeliverable(client, sessionId, deliverableId);
        if (!deliverable) return { status: 404, body: { error: 'Deliverable not found' } };
      }
      const { rows: existing } = await client.query(
        `SELECT id FROM consulting_session_feedback
          WHERE session_id = $1 AND user_id = $2 AND deliverable_id IS NOT DISTINCT FROM $3`,
        [sessionId, req.user.id, deliverable ? deliverable.id : null],
      );
      if (existing.length > 0) {
        return { status: 409, body: { error: 'Feedback has already been submitted', code: 'feedback_exists' } };
      }
      const { rows: [created] } = await client.query(
        `INSERT INTO consulting_session_feedback
           (session_id, user_id, session_quality_rating, feedback_text, deliverable_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [sessionId, req.user.id, rating, text || null, deliverable ? deliverable.id : null],
      );
      return { status: 201, body: { feedback: created, session } };
    });
    if (result.status === 201) {
      const { session } = result.body;
      await notifyUser({
        userId: session.consultant_assigned_id, type: 'consulting_deliverable_feedback',
        title: 'Your client left feedback',
        body: 'Your client left feedback on the delivered work. Open the milestone board to read it.',
        data: { sessionId: String(session.id) },
        actionUrl: '/consulting/contractor-dashboard',
      });
      delete result.body.session;
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting deliverable feedback failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to submit feedback' });
  }
}

// POST /business-launch/sessions/:sessionId/deliverables/:deliverableId/accept
// Milestone acceptance (530): the client accepts a draft-delivered or
// completed milestone. Acceptance is the client's own act (admins read
// but never accept on the client's behalf) and is final; a change after
// acceptance goes through a Slice F change request.
async function acceptDeliverable(req, res) {
  const { sessionId, deliverableId } = req.params;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'client') return { status: 403, body: { error: 'Only the session client can accept a milestone' } };
      // Slice F (535): a paused engagement takes no acceptances.
      if (session.status === 'paused') return { status: 409, body: { error: 'The engagement is paused', code: 'engagement_paused' } };
      // Slice H (545): an archived engagement takes no acceptances.
      if (session.status === 'archived') return { status: 409, body: { error: 'The engagement is archived', code: 'engagement_archived' } };
      const deliverable = await loadDeliverable(client, sessionId, deliverableId);
      if (!deliverable) return { status: 404, body: { error: 'Deliverable not found' } };
      if (!ACCEPTABLE_FROM.has(deliverable.status)) {
        return { status: 409, body: { error: `A ${deliverable.status} milestone cannot be accepted yet`, code: 'invalid_transition' } };
      }
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_deliverables
            SET status = 'accepted', accepted_by = $1, accepted_at = NOW(),
                completed_date = COALESCE(completed_date, NOW()), updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [req.user.id, deliverable.id],
      );
      return { status: 200, body: { deliverable: updated, session } };
    });
    if (result.status === 200) {
      const { deliverable, session } = result.body;
      await notifyUser({
        userId: session.consultant_assigned_id, type: 'consulting_milestone_accepted',
        title: 'A milestone was accepted',
        body: `Your client accepted "${deliverable.name}".`,
        data: { sessionId: String(session.id), deliverableId: String(deliverable.id) },
        actionUrl: '/consulting/contractor-dashboard',
      });
      const { rows: [consultant] } = await db.query(
        'SELECT email FROM users WHERE id = $1', [session.consultant_assigned_id],
      );
      await emailParty(consultant?.email, 'A milestone was accepted',
        'A milestone was accepted',
        `Your client accepted "${deliverable.name}" on the engagement.`);
      result.body.deliverable = await presentDeliverable(db, deliverable, 'client', req.user.id);
      delete result.body.session;
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting accept deliverable failed', { sessionId, deliverableId, error: err.message });
    return res.status(500).json({ error: 'Failed to accept the milestone' });
  }
}

module.exports = {
  startEngagement,
  listMyEngagements,
  getEngagementSession,
  listDeliverables,
  updateDeliverableStatus,
  deliverDraft,
  attachDocument,
  listDocuments,
  downloadDocument,
  submitFeedback,
  acceptDeliverable,
  // Shared by the Slice F change controller (same session actor rules)
  // and the Slice G confidentiality controller (participant-aware reads
  // and document listing for the record export).
  loadSession,
  actorForSession,
  resolveSessionActor,
  loadActiveParticipant,
  loadDocumentsFor,
  isClientOwner,
  notifyUser,
};
