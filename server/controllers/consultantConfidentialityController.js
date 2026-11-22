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
  resolveSessionActor,
  loadDocumentsFor,
  notifyUser,
} = require('./consultantDeliverableController');

// Group 10 Slice G (items 536-540): maintain confidentiality.
// The participant list (536) names the people beyond the two core
// parties (the client owner and the assigned consultant, who are
// implicit and never rows here): a site_contact (the booking's contact
// person, scoped read per G-6/G-7) or an observer (read-only). Both
// read the board and the documents shared with them, and neither can
// file, decide, move, accept, upload, or pause. Limited file sharing
// (537) adds a 'limited' visibility with named shares plus a PATCH
// that changes a document's visibility, expiry, or share list; only
// the uploader or an admin may change sharing. The confidentiality
// acknowledgment (538) is one row per party, stamped with the terms
// version in force; acknowledging never gates work (D-136). File
// access expiry (539) is an expires_at on the document, enforced at
// list time (hidden from everyone but the uploader and admins) and at
// download time (410); NULL means the document never expires (D-135).
// The engagement record export (540) is a JSON download of the whole
// record, filtered to the caller's visibility, with every export
// written to the engagement history. Audit findings G10-21, G10-32,
// and G10-36 overlap this slice; none is claimed closed here — they
// stay open pending re-verification against the new head. Decisions
// D-132..D-137 in persona-roadmap-decisions.md.

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const BIGINT_RE = /^\d+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TERMS_VERSION = '2026-11-22-v1';
const PARTICIPANT_ROLES = new Set(['site_contact', 'observer']);
const DOCUMENT_VISIBILITIES = new Set(['shared', 'client_only', 'consultant_only', 'internal', 'limited']);

function validSessionId(value) {
  return typeof value === 'string' && BIGINT_RE.test(value);
}

function validUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isAdmin(req) {
  return req?.user?.role === 'admin' || req?.user?.role === 'super_admin';
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
    logger.warn('Consulting confidentiality email failed', { email, subject, error: err.message });
  }
}

function presentParticipant(row) {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    userId: String(row.user_id),
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    role: row.role,
    note: row.note,
    addedBy: row.added_by ? String(row.added_by) : null,
    addedAt: row.added_at,
    removedAt: row.removed_at,
    removedBy: row.removed_by ? String(row.removed_by) : null,
    active: row.removed_at == null,
  };
}

async function loadParticipantRow(client, participantId) {
  const { rows: [row] } = await client.query(
    `SELECT p.*, u.first_name, u.last_name, u.email
       FROM consulting_session_participants p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = $1`,
    [participantId],
  );
  return row || null;
}

function presentDocument(row, sharedWith) {
  return {
    id: String(row.id),
    deliverableId: String(row.deliverable_id),
    uploadedBy: String(row.uploaded_by),
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    visibility: row.visibility,
    expiresAt: row.expires_at,
    expired: row.expires_at != null && new Date(row.expires_at) <= new Date(),
    sharedWith: sharedWith || [],
    createdAt: row.created_at,
  };
}

async function loadDocumentShares(client, documentId) {
  const { rows } = await client.query(
    `SELECT user_id FROM consulting_document_shares WHERE document_id = $1 ORDER BY created_at ASC`,
    [documentId],
  );
  return rows.map((row) => String(row.user_id));
}

// GET /sessions/:sessionId/participants
// The core parties plus the added participants, removed rows included
// so the history shows who was involved. Any party or admin may read.
async function listParticipants(req, res) {
  const sessionId = req.params.sessionId;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const session = await loadSession(db, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const { type } = await resolveSessionActor(db, req, session);
    if (!type) return res.status(403).json({ error: 'Only the session client, consultant, participants, or an administrator can view participants' });
    const { rows } = await db.query(
      `SELECT p.*, u.first_name, u.last_name, u.email
         FROM consulting_session_participants p
         JOIN users u ON u.id = p.user_id
        WHERE p.session_id = $1
        ORDER BY p.removed_at NULLS FIRST, p.added_at ASC`,
      [sessionId],
    );
    const coreIds = [session.user_id, session.consultant_assigned_id].filter(Boolean);
    const { rows: coreRows } = await db.query(
      `SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1)`,
      [coreIds],
    );
    const coreById = new Map(coreRows.map((user) => [String(user.id), user]));
    const core = [];
    const coreUser = coreById.get(String(session.user_id));
    if (coreUser) {
      core.push({ userId: String(coreUser.id), firstName: coreUser.first_name, lastName: coreUser.last_name, email: coreUser.email, role: 'client', implicit: true });
    }
    const coreConsultant = coreById.get(String(session.consultant_assigned_id));
    if (coreConsultant) {
      core.push({ userId: String(coreConsultant.id), firstName: coreConsultant.first_name, lastName: coreConsultant.last_name, email: coreConsultant.email, role: 'consultant', implicit: true });
    }
    return res.json({ core, participants: rows.map(presentParticipant) });
  } catch (err) {
    logger.error('Consulting list participants failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to load participants' });
  }
}

// POST /sessions/:sessionId/participants
// The assigned consultant or an admin adds a participant by email.
// The person must already have an active OxSteed account (D-132);
// the client and the consultant are implicit and cannot be added.
async function addParticipant(req, res) {
  const sessionId = req.params.sessionId;
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = String(req.body?.role || '').trim();
  const note = String(req.body?.note || '').trim() || null;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required', code: 'invalid_email' });
  if (!PARTICIPANT_ROLES.has(role)) return res.status(400).json({ error: 'Role must be site_contact or observer', code: 'invalid_role' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'consultant' && type !== 'admin') {
        return { status: 403, body: { error: 'Only the assigned consultant or an administrator can add participants' } };
      }
      const { rows: [user] } = await client.query(
        `SELECT id, first_name, last_name, email FROM users
          WHERE LOWER(email) = $1 AND is_active = TRUE AND deleted_at IS NULL`,
        [email],
      );
      if (!user) return { status: 404, body: { error: 'No active OxSteed account with that email', code: 'user_not_found' } };
      if (String(user.id) === String(session.user_id)
        || String(user.id) === String(session.consultant_assigned_id)) {
        return { status: 409, body: { error: 'The client and the consultant are already participants', code: 'core_party' } };
      }
      try {
        const { rows: [created] } = await client.query(
          `INSERT INTO consulting_session_participants (session_id, user_id, role, added_by, note)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [sessionId, user.id, role, req.user.id, note],
        );
        await recordEvent(client, {
          sessionId,
          eventType: 'participant_added',
          actorId: req.user.id,
          actorRole: type,
          summary: `A ${role.replace('_', ' ')} joined the engagement.`,
          metadata: { participantId: String(created.id), userId: String(user.id), role },
        });
        return { status: 201, body: { participantId: created.id, user, session } };
      } catch (err) {
        if (err.code === '23505') {
          return { status: 409, body: { error: 'That person is already a participant', code: 'participant_exists' } };
        }
        throw err;
      }
    });
    if (result.status === 201) {
      const { participantId, user, session } = result.body;
      await notifyUser(user.id, 'consulting_participant_added',
        'You were added to an engagement',
        `You were added as a ${role.replace('_', ' ')} on a consulting engagement. Open the consulting portal to review it.`,
        { sessionId: String(session.id) });
      await emailParty(user.email, 'You were added to a consulting engagement',
        'You were added to a consulting engagement',
        `You were added as a ${role.replace('_', ' ')} on a consulting engagement. Open the consulting portal to review the engagement and acknowledge confidentiality.`);
      const full = await loadParticipantRow(db, participantId);
      return res.status(201).json({ participant: presentParticipant(full) });
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting add participant failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to add the participant' });
  }
}

// DELETE /sessions/:sessionId/participants/:participantId
// Soft removal by the assigned consultant or an admin. The row stays
// so the history keeps who was involved; a removed participant loses
// board and document access at once, and any named shares stay on
// file but stop matching (they revive if the person is re-added).
async function removeParticipant(req, res) {
  const sessionId = req.params.sessionId;
  const participantId = req.params.participantId;
  if (!validSessionId(sessionId) || !validUuid(participantId)) {
    return res.status(400).json({ error: 'Invalid session or participant id' });
  }
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const type = actorForSession(req, session);
      if (type !== 'consultant' && type !== 'admin') {
        return { status: 403, body: { error: 'Only the assigned consultant or an administrator can remove participants' } };
      }
      const { rows: [row] } = await client.query(
        `SELECT * FROM consulting_session_participants
          WHERE id = $1 AND session_id = $2 AND removed_at IS NULL`,
        [participantId, sessionId],
      );
      if (!row) return { status: 404, body: { error: 'Participant not found' } };
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_session_participants
            SET removed_at = NOW(), removed_by = $1 WHERE id = $2 RETURNING *`,
        [req.user.id, participantId],
      );
      await recordEvent(client, {
        sessionId,
        eventType: 'participant_removed',
        actorId: req.user.id,
        actorRole: type,
        summary: `A ${row.role.replace('_', ' ')} left the engagement.`,
        metadata: { participantId: String(updated.id), userId: String(row.user_id), role: row.role },
      });
      return { status: 200, body: { participantId: updated.id } };
    });
    if (result.status === 200) {
      const full = await loadParticipantRow(db, result.body.participantId);
      return res.json({ participant: presentParticipant(full) });
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting remove participant failed', { sessionId, participantId, error: err.message });
    return res.status(500).json({ error: 'Failed to remove the participant' });
  }
}

// GET /sessions/:sessionId/confidentiality
// Who has acknowledged confidentiality and who has not. Any party
// or admin may read; the terms version in force is reported with it.
async function getAcknowledgmentStatus(req, res) {
  const sessionId = req.params.sessionId;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const session = await loadSession(db, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const { type } = await resolveSessionActor(db, req, session);
    if (!type) return res.status(403).json({ error: 'Only the session client, consultant, participants, or an administrator can view confidentiality status' });
    const parties = [];
    if (session.user_id) parties.push({ userId: String(session.user_id), role: 'client' });
    if (session.consultant_assigned_id) parties.push({ userId: String(session.consultant_assigned_id), role: 'consultant' });
    const { rows: participantRows } = await db.query(
      `SELECT user_id, role FROM consulting_session_participants
        WHERE session_id = $1 AND removed_at IS NULL ORDER BY added_at ASC`,
      [sessionId],
    );
    for (const row of participantRows) parties.push({ userId: String(row.user_id), role: row.role });
    const { rows: users } = await db.query(
      `SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1)`,
      [parties.map((party) => party.userId)],
    );
    const usersById = new Map(users.map((user) => [String(user.id), user]));
    const { rows: acks } = await db.query(
      `SELECT * FROM consulting_confidentiality_acknowledgments WHERE session_id = $1`,
      [sessionId],
    );
    const ackByUser = new Map(acks.map((ack) => [String(ack.user_id), ack]));
    return res.json({
      termsVersion: TERMS_VERSION,
      parties: parties.map((party) => {
        const user = usersById.get(party.userId);
        const ack = ackByUser.get(party.userId);
        return {
          userId: party.userId,
          firstName: user?.first_name || null,
          lastName: user?.last_name || null,
          email: user?.email || null,
          role: party.role,
          acknowledgedAt: ack?.acknowledged_at || null,
          termsVersion: ack?.terms_version || null,
        };
      }),
    });
  } catch (err) {
    logger.error('Consulting confidentiality status failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to load confidentiality status' });
  }
}

// POST /sessions/:sessionId/confidentiality/acknowledge
// Each party acknowledges for themselves, once, stamped with the
// terms version in force. An admin is not a party and cannot
// acknowledge; acknowledging never gates work (D-136).
async function acknowledgeConfidentiality(req, res) {
  const sessionId = req.params.sessionId;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const { type, participantRole } = await resolveSessionActor(client, req, session);
      if (!type || type === 'admin') {
        return { status: 403, body: { error: 'Only a party to the engagement can acknowledge confidentiality' } };
      }
      const role = type === 'participant' ? participantRole : type;
      try {
        const { rows: [created] } = await client.query(
          `INSERT INTO consulting_confidentiality_acknowledgments
             (session_id, user_id, role, terms_version)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [sessionId, req.user.id, role, TERMS_VERSION],
        );
        await recordEvent(client, {
          sessionId,
          eventType: 'confidentiality_acknowledged',
          actorId: req.user.id,
          actorRole: role,
          summary: `The ${role.replace('_', ' ')} acknowledged confidentiality.`,
          metadata: { userId: String(req.user.id), role, termsVersion: TERMS_VERSION },
        });
        return { status: 201, body: { acknowledgment: created, session, role } };
      } catch (err) {
        if (err.code === '23505') {
          return { status: 409, body: { error: 'Confidentiality already acknowledged', code: 'already_acknowledged' } };
        }
        throw err;
      }
    });
    if (result.status === 201) {
      const { acknowledgment, session, role } = result.body;
      // Tell the other core party the acknowledgment landed.
      const otherId = role === 'client' ? session.consultant_assigned_id : session.user_id;
      if (otherId && String(otherId) !== String(req.user.id)) {
        await notifyUser(otherId, 'consulting_confidentiality_acknowledged',
          'Confidentiality acknowledged',
          `The ${role.replace('_', ' ')} on your engagement acknowledged confidentiality.`,
          { sessionId: String(session.id) });
      }
      return res.status(201).json({
        acknowledgment: {
          id: String(acknowledgment.id),
          sessionId: String(acknowledgment.session_id),
          userId: String(acknowledgment.user_id),
          role: acknowledgment.role,
          termsVersion: acknowledgment.terms_version,
          acknowledgedAt: acknowledgment.acknowledged_at,
        },
      });
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('Consulting acknowledge confidentiality failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to record the acknowledgment' });
  }
}

// PATCH /sessions/:sessionId/deliverables/:deliverableId/documents/:documentId
// Change a document's sharing: visibility, expiry, and (for 'limited')
// the named share list. Only the uploader or an admin may change
// sharing, and the uploader's party type decides which visibilities
// they may set (the Slice E upload rules, applied again here).
async function updateDocumentSharing(req, res) {
  const sessionId = req.params.sessionId;
  const deliverableId = req.params.deliverableId;
  const documentId = req.params.documentId;
  if (!validSessionId(sessionId) || !BIGINT_RE.test(String(deliverableId)) || !validUuid(documentId)) {
    return res.status(400).json({ error: 'Invalid session, deliverable, or document id' });
  }
  const body = req.body || {};
  const hasVisibility = body.visibility !== undefined;
  const hasExpires = Object.prototype.hasOwnProperty.call(body, 'expires_at');
  const hasShares = body.shared_with !== undefined;
  if (!hasVisibility && !hasExpires && !hasShares) {
    return res.status(400).json({ error: 'Nothing to update', code: 'nothing_to_update' });
  }
  try {
    const result = await withTransaction(db, async (client) => {
      const session = await loadSession(client, sessionId);
      if (!session) return { status: 404, body: { error: 'Session not found' } };
      const { rows: [doc] } = await client.query(
        `SELECT d.* FROM consulting_deliverable_documents d
           JOIN consulting_deliverables cd ON cd.id = d.deliverable_id
          WHERE d.id = $1 AND cd.id = $2 AND cd.session_id = $3 AND d.deleted_at IS NULL`,
        [documentId, deliverableId, sessionId],
      );
      if (!doc) return { status: 404, body: { error: 'Document not found' } };
      const type = actorForSession(req, session);
      const isUploader = String(doc.uploaded_by) === String(req.user?.id);
      if (type !== 'admin' && !isUploader) {
        return { status: 403, body: { error: 'Only the uploader or an administrator can change document sharing' } };
      }
      let visibility = doc.visibility;
      if (hasVisibility) {
        const requested = String(body.visibility).trim().toLowerCase();
        if (!DOCUMENT_VISIBILITIES.has(requested)) {
          return { status: 400, body: { error: 'Invalid document visibility', code: 'invalid_visibility' } };
        }
        if (type === 'client' && ['consultant_only', 'internal'].includes(requested)) {
          return { status: 403, body: { error: 'Clients cannot set consultant-only or internal visibility', code: 'visibility_forbidden' } };
        }
        if (type === 'consultant' && ['client_only', 'internal'].includes(requested)) {
          return { status: 403, body: { error: 'Consultants cannot set client-only or internal visibility', code: 'visibility_forbidden' } };
        }
        if (type !== 'admin' && requested === 'internal') {
          return { status: 403, body: { error: 'Only administrators can set internal visibility', code: 'visibility_forbidden' } };
        }
        visibility = requested;
      }
      let expiresAt = doc.expires_at;
      if (hasExpires) {
        if (body.expires_at === null) {
          expiresAt = null;
        } else {
          const parsed = new Date(body.expires_at);
          if (Number.isNaN(parsed.getTime())) {
            return { status: 400, body: { error: 'expires_at must be an ISO date', code: 'invalid_expiry' } };
          }
          if (parsed <= new Date()) {
            return { status: 400, body: { error: 'Expiry must be in the future', code: 'expiry_in_past' } };
          }
          expiresAt = parsed;
        }
      }
      let sharedWith = null;
      if (hasShares) {
        if (visibility !== 'limited') {
          return { status: 409, body: { error: 'Named shares need limited visibility', code: 'shares_require_limited' } };
        }
        if (!Array.isArray(body.shared_with)) {
          return { status: 400, body: { error: 'shared_with must be a list of user ids', code: 'invalid_shares' } };
        }
        const ids = [...new Set(body.shared_with.map((value) => String(value)))];
        const { rows: partyRows } = await client.query(
          `SELECT user_id FROM consulting_session_participants
            WHERE session_id = $1 AND removed_at IS NULL`,
          [sessionId],
        );
        const allowed = new Set([
          String(session.user_id),
          String(session.consultant_assigned_id),
          ...partyRows.map((row) => String(row.user_id)),
        ]);
        for (const id of ids) {
          if (!validUuid(id) || !allowed.has(id)) {
            return { status: 400, body: { error: 'shared_with names only parties to the engagement', code: 'invalid_share_user' } };
          }
        }
        sharedWith = ids;
      }
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_deliverable_documents
            SET visibility = $1, expires_at = $2 WHERE id = $3 RETURNING *`,
        [visibility, expiresAt, documentId],
      );
      if (sharedWith !== null) {
        await client.query(`DELETE FROM consulting_document_shares WHERE document_id = $1`, [documentId]);
        for (const id of sharedWith) {
          await client.query(
            `INSERT INTO consulting_document_shares (document_id, user_id, shared_by)
             VALUES ($1, $2, $3)`,
            [documentId, id, req.user.id],
          );
        }
      }
      await recordEvent(client, {
        sessionId,
        eventType: 'document_sharing_updated',
        actorId: req.user.id,
        actorRole: type,
        summary: `Document sharing changed on "${doc.original_name}".`,
        metadata: {
          documentId,
          deliverableId: String(deliverableId),
          visibility,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          sharedWith,
        },
      });
      return { status: 200, body: { document: updated, sharedWith } };
    });
    if (result.status !== 200) return res.status(result.status).json(result.body);
    const { document, sharedWith } = result.body;
    const shares = sharedWith !== null ? sharedWith : await loadDocumentShares(db, document.id);
    return res.json({ document: presentDocument(document, shares) });
  } catch (err) {
    logger.error('Consulting update document sharing failed', { sessionId, documentId, error: err.message });
    return res.status(500).json({ error: 'Failed to update document sharing' });
  }
}

// GET /sessions/participating
// The engagements the caller participates in (not as client or
// consultant): the portal's "participating" list, with the caller's
// role and the two core parties named.
async function listParticipatingSessions(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT cs.*, p.role AS participant_role,
              u.first_name AS client_first_name, u.last_name AS client_last_name,
              c.first_name AS consultant_first_name, c.last_name AS consultant_last_name
         FROM consulting_session_participants p
         JOIN consulting_sessions cs ON cs.id = p.session_id
         LEFT JOIN users u ON u.id = cs.user_id
         LEFT JOIN users c ON c.id = cs.consultant_assigned_id
        WHERE p.user_id = $1 AND p.removed_at IS NULL
        ORDER BY cs.created_at DESC LIMIT 50`,
      [req.user.id],
    );
    return res.json({
      engagements: rows.map((row) => ({
        id: String(row.id),
        status: row.status,
        firstName: row.client_first_name,
        lastName: row.client_last_name,
        businessName: row.business_name,
        description: row.description,
        consultantFirstName: row.consultant_first_name,
        consultantLastName: row.consultant_last_name,
        participantRole: row.participant_role,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (err) {
    logger.error('Consulting list participating sessions failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to load participating engagements' });
  }
}

// GET /sessions/:sessionId/export
// The engagement record as a JSON download: session, participants,
// acknowledgments, deliverables with document metadata (no file
// bytes), feedback, change requests, history, the approved proposal
// summary, and draft fee invoices. Documents are filtered to the
// caller's visibility; invoices are money records, so participants
// get no invoice section. Every export writes a record_exported
// event, so the history shows who took the record and when.
async function exportEngagementRecord(req, res) {
  const sessionId = req.params.sessionId;
  if (!validSessionId(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    const session = await loadSession(db, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const { type } = await resolveSessionActor(db, req, session);
    if (!type) return res.status(403).json({ error: 'Only the session client, consultant, participants, or an administrator can export the record' });

    const { rows: deliverableRows } = await db.query(
      `SELECT * FROM consulting_deliverables WHERE session_id = $1 ORDER BY due_date ASC NULLS LAST, id ASC`,
      [sessionId],
    );
    const deliverables = [];
    for (const row of deliverableRows) {
      const documents = await loadDocumentsFor(db, row.id, type, req.user.id);
      deliverables.push({
        id: String(row.id),
        name: row.name,
        description: row.description,
        deliverableType: row.deliverable_type,
        status: row.status,
        dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
        completedDate: row.completed_date,
        acceptedBy: row.accepted_by ? String(row.accepted_by) : null,
        acceptedAt: row.accepted_at,
        draftNote: row.draft_note,
        documents,
      });
    }
    const { rows: participantRows } = await db.query(
      `SELECT p.*, u.first_name, u.last_name, u.email
         FROM consulting_session_participants p
         JOIN users u ON u.id = p.user_id
        WHERE p.session_id = $1 ORDER BY p.added_at ASC`,
      [sessionId],
    );
    const { rows: ackRows } = await db.query(
      `SELECT user_id, role, terms_version, acknowledged_at
         FROM consulting_confidentiality_acknowledgments WHERE session_id = $1 ORDER BY acknowledged_at ASC`,
      [sessionId],
    );
    const { rows: feedbackRows } = await db.query(
      `SELECT id, user_id, session_quality_rating, feedback_text, deliverable_id, created_at
         FROM consulting_session_feedback WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    const { rows: changeRows } = await db.query(
      `SELECT * FROM consulting_change_requests WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    const { rows: eventRows } = await db.query(
      `SELECT * FROM consulting_engagement_events WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    let proposal = null;
    if (session.referral_id) {
      const { rows: [approved] } = await db.query(
        `SELECT version, title, scope_summary, price_cents, currency, status, decided_by, decided_at, decision_reason
           FROM consulting_engagement_proposals
          WHERE request_id = $1 AND status = 'approved' ORDER BY version DESC LIMIT 1`,
        [session.referral_id],
      );
      if (approved) {
        proposal = {
          version: approved.version,
          title: approved.title,
          scopeSummary: approved.scope_summary,
          priceCents: approved.price_cents,
          currency: approved.currency,
          status: approved.status,
          decidedBy: approved.decided_by ? String(approved.decided_by) : null,
          decidedAt: approved.decided_at,
          decisionReason: approved.decision_reason,
        };
      }
    }
    let invoices = null;
    if (type !== 'participant') {
      const { rows: invoiceRows } = await db.query(
        `SELECT i.* FROM consulting_invoices i
           JOIN consulting_change_requests cr ON cr.invoice_id = i.id
          WHERE cr.session_id = $1 ORDER BY i.created_at ASC`,
        [sessionId],
      );
      invoices = invoiceRows.map((row) => ({
        id: String(row.id),
        invoiceNumber: row.invoice_number,
        amountCents: row.amount_cents,
        status: row.status,
        issuedDate: row.issued_date ? String(row.issued_date).slice(0, 10) : null,
        dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
        createdAt: row.created_at,
      }));
    }

    const record = {
      exportedAt: new Date().toISOString(),
      exportedBy: String(req.user.id),
      session: {
        id: String(session.id),
        clientId: session.user_id ? String(session.user_id) : null,
        clientName: [session.first_name, session.last_name].filter(Boolean).join(' ') || null,
        clientEmail: session.email,
        businessName: session.business_name,
        consultantId: session.consultant_assigned_id ? String(session.consultant_assigned_id) : null,
        status: session.status,
        description: session.description,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      },
      participants: participantRows.map(presentParticipant),
      confidentiality: {
        termsVersion: TERMS_VERSION,
        acknowledgments: ackRows.map((row) => ({
          userId: String(row.user_id),
          role: row.role,
          termsVersion: row.terms_version,
          acknowledgedAt: row.acknowledged_at,
        })),
      },
      approvedProposal: proposal,
      deliverables,
      feedback: feedbackRows.map((row) => ({
        id: String(row.id),
        userId: String(row.user_id),
        rating: row.session_quality_rating,
        text: row.feedback_text,
        deliverableId: row.deliverable_id == null ? null : String(row.deliverable_id),
        createdAt: row.created_at,
      })),
      changeRequests: changeRows.map((row) => ({
        id: String(row.id),
        requestType: row.request_type,
        status: row.status,
        title: row.title,
        reason: row.reason,
        newTitle: row.new_title,
        newDescription: row.new_description,
        newDueDate: row.new_due_date ? String(row.new_due_date).slice(0, 10) : null,
        amountCents: row.amount_cents,
        currency: row.currency,
        decidedBy: row.decided_by ? String(row.decided_by) : null,
        decidedAt: row.decided_at,
        decisionReason: row.decision_reason,
        createdAt: row.created_at,
      })),
      history: eventRows.map((row) => ({
        id: String(row.id),
        eventType: row.event_type,
        actorId: row.actor_id ? String(row.actor_id) : null,
        actorRole: row.actor_role,
        summary: row.summary,
        metadata: row.metadata || {},
        createdAt: row.created_at,
      })),
      invoices,
    };

    try {
      await recordEvent(db, {
        sessionId,
        eventType: 'record_exported',
        actorId: req.user.id,
        actorRole: type,
        summary: `The engagement record was exported by the ${type === 'participant' ? 'participant' : type}.`,
        metadata: { exportedBy: String(req.user.id) },
      });
    } catch (err) {
      logger.warn('Consulting record export event failed', { sessionId, error: err.message });
    }

    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="engagement-${sessionId}-record.json"`);
    res.set('Cache-Control', 'private, no-store');
    return res.json(record);
  } catch (err) {
    logger.error('Consulting export engagement record failed', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to export the engagement record' });
  }
}

module.exports = {
  listParticipants,
  addParticipant,
  removeParticipant,
  getAcknowledgmentStatus,
  acknowledgeConfidentiality,
  updateDocumentSharing,
  listParticipatingSessions,
  exportEngagementRecord,
  TERMS_VERSION,
};
