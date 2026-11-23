'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
const { maskEmail } = require('../utils/directQuote');

// Group 10 Slice B (items 511-515): screen inquiries.
// Fit assessments (512), conflict declarations (513), and inquiry
// response templates + replies (515) for business-launch referrals
// (consulting_requests), the inquiries consultants actually receive.
// D-104/D-105/D-106 in persona-roadmap-decisions.md.

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const FIT_DECISIONS = ['fit', 'no_fit', 'needs_info'];
// Forward-moving referral statuses: blocked while the consultant has an
// open conflict on the referral (D-105). Decline/lost/pause are exits,
// not forward moves.
const FORWARD_STATUSES = new Set([
  'intro_pending', 'intro_sent', 'discovery_scheduled', 'proposal_sent',
  'engaged', 'won', 'completed',
]);

const INQUIRY_TEMPLATES = [
  {
    id: 'acknowledge',
    name: 'Acknowledge inquiry',
    subject: 'Thanks for your consulting inquiry',
    body_plain: 'Thank you for reaching out. I have received your inquiry and will review it within 24 business hours. If I need any more detail before we speak, I will ask here first.',
  },
  {
    id: 'more_info',
    name: 'Ask for more detail',
    subject: 'A few quick questions about your inquiry',
    body_plain: 'Thank you for your inquiry. Before we schedule an intro call, could you share a little more about your current situation, what success looks like for you, and any deadline you are working toward? Once I have that, I will confirm next steps.',
  },
  {
    id: 'propose_intro',
    name: 'Propose an intro call',
    subject: 'Let us book a short intro call',
    body_plain: 'Thank you for your inquiry. Based on what you shared, a short intro call is the best next step. Please reply with two or three times that work for you, or use the booking link on your inquiry, and we will confirm a time.',
  },
  {
    id: 'decline_referral',
    name: 'Polite decline with a next step',
    subject: 'About your consulting inquiry',
    body_plain: 'Thank you for your inquiry. After reviewing it, I do not think I am the right fit for this particular need. OxSteed can route your inquiry to another consultant, or you can submit a general inquiry and our team will match you. Thank you for considering us.',
  },
];

function validScore(value) {
  return value === null || value === undefined
    || (Number.isInteger(value) && value >= 1 && value <= 5);
}

function validRequestId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

async function loadAssignedReferral(client, requestId, consultantId) {
  const { rows: [referral] } = await client.query(
    `SELECT id, email, first_name, last_name, business_name, phone,
            skill_description, target_market, package_selected,
            consultant_assigned_id, consultant_assignment_status
       FROM consulting_requests WHERE id = $1`,
    [requestId],
  );
  if (!referral) return { status: 404, body: { error: 'Referral not found.' } };
  if (String(referral.consultant_assigned_id) !== String(consultantId)) {
    return { status: 404, body: { error: 'Referral not found.' } };
  }
  return { referral };
}

async function hasOpenConflict(client, requestId, consultantId) {
  const { rows: [row] } = await client.query(
    `SELECT 1 FROM consulting_request_conflicts
      WHERE request_id = $1 AND consultant_id = $2 AND has_conflict = TRUE`,
    [requestId, consultantId],
  );
  return Boolean(row);
}

exports.listInquiryTemplates = async (req, res) => {
  return res.json({ templates: INQUIRY_TEMPLATES });
};

exports.getReferralScreen = async (req, res) => {
  const requestId = req.params.requestId;
  if (!validRequestId(requestId)) return res.status(404).json({ error: 'Referral not found.' });
  try {
    const loaded = await loadAssignedReferral(db, requestId, req.user.id);
    if (loaded.status) return res.status(loaded.status).json(loaded.body);
    const { rows: [fit] } = await db.query(
      `SELECT budget_fit, scope_fit, timing_fit, overall_fit, decision, notes, updated_at
         FROM consulting_request_fit_assessments WHERE request_id = $1 AND consultant_id = $2`,
      [requestId, req.user.id],
    );
    const { rows: [conflict] } = await db.query(
      `SELECT has_conflict, description, updated_at
         FROM consulting_request_conflicts WHERE request_id = $1 AND consultant_id = $2`,
      [requestId, req.user.id],
    );
    const { rows: messages } = await db.query(
      `SELECT id, author_role, template_id, subject, message_plain, status, created_at
         FROM consulting_request_messages WHERE request_id = $1 ORDER BY created_at ASC`,
      [requestId],
    );
    return res.json({ referral: loaded.referral, fit: fit || null, conflict: conflict || null, messages });
  } catch (err) {
    logger.error('getReferralScreen error', { err });
    return res.status(500).json({ error: 'Failed to load referral.' });
  }
};

exports.upsertFitAssessment = async (req, res) => {
  const requestId = req.params.requestId;
  if (!validRequestId(requestId)) return res.status(404).json({ error: 'Referral not found.' });
  const { budget_fit, scope_fit, timing_fit, overall_fit, decision, notes } = req.body || {};
  if (!FIT_DECISIONS.includes(decision)) {
    return res.status(400).json({ error: 'Invalid fit decision.' });
  }
  for (const score of [budget_fit, scope_fit, timing_fit, overall_fit]) {
    if (!validScore(score)) return res.status(400).json({ error: 'Fit scores must be 1-5.' });
  }
  if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
    return res.status(400).json({ error: 'Notes must be 2000 characters or fewer.' });
  }
  try {
    const loaded = await loadAssignedReferral(db, requestId, req.user.id);
    if (loaded.status) return res.status(loaded.status).json(loaded.body);
    const { rows: [saved] } = await db.query(
      `INSERT INTO consulting_request_fit_assessments
         (request_id, consultant_id, budget_fit, scope_fit, timing_fit, overall_fit, decision, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (request_id, consultant_id) DO UPDATE SET
         budget_fit = EXCLUDED.budget_fit, scope_fit = EXCLUDED.scope_fit,
         timing_fit = EXCLUDED.timing_fit, overall_fit = EXCLUDED.overall_fit,
         decision = EXCLUDED.decision, notes = EXCLUDED.notes, updated_at = NOW()
       RETURNING budget_fit, scope_fit, timing_fit, overall_fit, decision, notes, updated_at`,
      [requestId, req.user.id, budget_fit ?? null, scope_fit ?? null,
       timing_fit ?? null, overall_fit ?? null, decision, notes?.trim() || null],
    );
    return res.json({ fit: saved });
  } catch (err) {
    logger.error('upsertFitAssessment error', { err });
    return res.status(500).json({ error: 'Failed to save fit assessment.' });
  }
};

exports.upsertConflictDeclaration = async (req, res) => {
  const requestId = req.params.requestId;
  if (!validRequestId(requestId)) return res.status(404).json({ error: 'Referral not found.' });
  const { has_conflict, description } = req.body || {};
  if (typeof has_conflict !== 'boolean') {
    return res.status(400).json({ error: 'has_conflict is required.' });
  }
  if (has_conflict && (typeof description !== 'string' || description.trim().length < 10)) {
    return res.status(400).json({ error: 'A conflict description of at least 10 characters is required.' });
  }
  if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 2000)) {
    return res.status(400).json({ error: 'Description must be 2000 characters or fewer.' });
  }
  try {
    const loaded = await loadAssignedReferral(db, requestId, req.user.id);
    if (loaded.status) return res.status(loaded.status).json(loaded.body);
    const { rows: [saved] } = await db.query(
      `INSERT INTO consulting_request_conflicts
         (request_id, consultant_id, has_conflict, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (request_id, consultant_id) DO UPDATE SET
         has_conflict = EXCLUDED.has_conflict, description = EXCLUDED.description,
         updated_at = NOW()
       RETURNING has_conflict, description, updated_at`,
      [requestId, req.user.id, has_conflict, description?.trim() || null],
    );
    return res.json({ conflict: saved });
  } catch (err) {
    logger.error('upsertConflictDeclaration error', { err });
    return res.status(500).json({ error: 'Failed to save conflict declaration.' });
  }
};

exports.replyToReferral = async (req, res) => {
  const requestId = req.params.requestId;
  if (!validRequestId(requestId)) return res.status(404).json({ error: 'Referral not found.' });
  const { template_id, subject, body_plain } = req.body || {};
  let finalSubject = subject;
  let finalBody = body_plain;
  if (template_id) {
    const template = INQUIRY_TEMPLATES.find((entry) => entry.id === template_id);
    if (!template) return res.status(400).json({ error: 'Unknown template.' });
    finalSubject = subject || template.subject;
    finalBody = body_plain || template.body_plain;
  }
  if (typeof finalSubject !== 'string' || !finalSubject.trim() || finalSubject.trim().length > 255) {
    return res.status(400).json({ error: 'Subject is required (255 characters or fewer).' });
  }
  if (typeof finalBody !== 'string' || !finalBody.trim() || finalBody.trim().length > 5000) {
    return res.status(400).json({ error: 'Message body is required (5000 characters or fewer).' });
  }
  try {
    const loaded = await loadAssignedReferral(db, requestId, req.user.id);
    if (loaded.status) return res.status(loaded.status).json(loaded.body);
    const rendered = renderOxSteedEmail({
      language: 'en',
      preheader: finalSubject.trim(),
      eyebrow: 'OXSTEED CONSULTING',
      title: finalSubject.trim(),
      intro: `A message about your business-launch inquiry (reference ${requestId}).`,
      bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${finalBody.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`,
      bodyText: finalBody.trim(),
      footerText: 'The OxSteed Team',
    });
    const { rows: [saved] } = await db.query(
      `INSERT INTO consulting_request_messages
         (request_id, admin_id, recipient_email, subject, message_html, message_plain, author_role, template_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'consultant', $7)
       RETURNING id, subject, message_plain, status, created_at`,
      [requestId, req.user.id, loaded.referral.email, finalSubject.trim(),
       rendered.html, finalBody.trim(), template_id || null],
    );
    // Fire-and-forget send with the same sent/failed tracking as the
    // admin custom-message path; the reply is already stored.
    try {
      const delivery = await sendEmail({
        to: loaded.referral.email,
        subject: finalSubject.trim(),
        html: rendered.html,
      });
      if (delivery?.success === true) {
        await db.query(
          `UPDATE consulting_request_messages SET status = 'sent', sent_at = NOW() WHERE id = $1`,
          [saved.id],
        );
      } else {
        await db.query(
          `UPDATE consulting_request_messages SET status = 'failed', error_message = $1 WHERE id = $2`,
          [delivery?.error || 'unknown', saved.id],
        );
      }
    } catch (e) {
      await db.query(
        `UPDATE consulting_request_messages SET status = 'failed', error_message = $1 WHERE id = $2`,
        [e.message, saved.id],
      );
      logger.warn('Failed to email referral reply', { requestId, error: e.message });
    }
    return res.status(201).json({ message: saved });
  } catch (err) {
    logger.error('replyToReferral error', { err });
    return res.status(500).json({ error: 'Failed to send reply.' });
  }
};

// Shared by updateMyReferral (D-105): an open conflict blocks forward
// moves on the referral until the consultant clears it or declines.
exports.hasOpenConflict = hasOpenConflict;
exports.FORWARD_STATUSES = FORWARD_STATUSES;
exports.INQUIRY_TEMPLATES = INQUIRY_TEMPLATES;
