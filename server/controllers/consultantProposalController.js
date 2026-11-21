'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
const { sendNotification } = require('../services/notificationService');
const { withTransaction } = require('../utils/transaction');
const { hasOpenConflict } = require('./consultantScreeningController');

// Group 10 Slice D (items 521-525): agree on work.
// Engagement proposals on the business-launch referral
// (consulting_requests), the inquiry the consultant actually receives.
// A proposal is a versioned offer: scope, price, deliverable definitions
// and scope exclusions. Versions are immutable once sent; sending a new
// version supersedes the previous sent one, and only one sent version
// exists per referral. Client approval moves the referral to 'engaged'.
// Decisions D-111..D-118 in persona-roadmap-decisions.md.

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DELIVERABLE_TYPES = [
  'sop', 'contract', 'financial_tracker', 'marketing_plan',
  'team_structure', 'operational_manual', 'other',
];
// Referral states a proposal may be sent from. Closed states (engaged,
// won, lost, completed, paused, declined) take no new proposal.
const PROPOSABLE_STATUSES = new Set([
  'assigned', 'intro_pending', 'intro_sent', 'discovery_scheduled', 'proposal_sent',
]);

function validRequestId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

function isAdmin(req) {
  return req?.user?.role === 'admin' || req?.user?.role === 'super_admin';
}

// The client owner rule, identical to getUserBusinessLaunchRequests: the
// request owner by user_id, or a guest submission recovered by the
// caller's verified email. Admins pass too.
function isClientOwner(req, referral) {
  if (!req?.user || !referral) return false;
  if (isAdmin(req)) return true;
  if (referral.user_id && String(referral.user_id) === String(req.user.id)) return true;
  if (!referral.user_id && req.user.email_verified && referral.email
    && String(referral.email).toLowerCase() === String(req.user.email || '').toLowerCase()) return true;
  return false;
}

function isAssignedConsultant(req, referral) {
  if (!req?.user || !referral) return false;
  if (isAdmin(req)) return true;
  return referral.consultant_assigned_id
    && String(referral.consultant_assigned_id) === String(req.user.id);
}

async function loadReferral(client, requestId) {
  const { rows: [referral] } = await client.query(
    `SELECT id, user_id, email, first_name, last_name, business_name,
            consultant_assigned_id, consultant_assignment_status
       FROM consulting_requests WHERE id = $1`,
    [requestId],
  );
  return referral || null;
}

async function loadProposalWithItems(client, proposalId, requestId) {
  const { rows: [proposal] } = await client.query(
    `SELECT * FROM consulting_engagement_proposals WHERE id = $1 AND request_id = $2`,
    [proposalId, requestId],
  );
  if (!proposal) return null;
  const { rows: deliverables } = await client.query(
    `SELECT id, title, description, deliverable_type, due_date, sort_order
       FROM consulting_proposal_deliverables
      WHERE proposal_id = $1 ORDER BY sort_order, id`,
    [proposalId],
  );
  const { rows: exclusions } = await client.query(
    `SELECT id, exclusion_text, sort_order
       FROM consulting_proposal_exclusions
      WHERE proposal_id = $1 ORDER BY sort_order, id`,
    [proposalId],
  );
  return { ...proposal, deliverables, exclusions };
}

function validateDeliverables(deliverables) {
  if (deliverables === undefined) return { ok: true, value: [] };
  if (!Array.isArray(deliverables) || deliverables.length > 50) {
    return { ok: false, error: 'Deliverables must be a list of at most 50 items.' };
  }
  const cleaned = [];
  for (let i = 0; i < deliverables.length; i += 1) {
    const item = deliverables[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Each deliverable needs a title.' };
    }
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title || title.length > 255) {
      return { ok: false, error: 'Each deliverable needs a title (255 characters or fewer).' };
    }
    const type = item.deliverable_type ?? item.type ?? 'other';
    if (!DELIVERABLE_TYPES.includes(type)) {
      return { ok: false, error: 'Invalid deliverable type.' };
    }
    if (item.due_date !== undefined && item.due_date !== null && !isDateStr(item.due_date)) {
      return { ok: false, error: 'Deliverable due dates must be YYYY-MM-DD.' };
    }
    const description = item.description === undefined || item.description === null
      ? null
      : String(item.description);
    if (description !== null && description.length > 2000) {
      return { ok: false, error: 'Deliverable descriptions must be 2000 characters or fewer.' };
    }
    cleaned.push({
      title,
      description: description?.trim() || null,
      deliverable_type: type,
      due_date: item.due_date || null,
      sort_order: i,
    });
  }
  return { ok: true, value: cleaned };
}

function validateExclusions(exclusions) {
  if (exclusions === undefined) return { ok: true, value: [] };
  if (!Array.isArray(exclusions) || exclusions.length > 50) {
    return { ok: false, error: 'Exclusions must be a list of at most 50 items.' };
  }
  const cleaned = [];
  for (let i = 0; i < exclusions.length; i += 1) {
    const text = typeof exclusions[i] === 'string'
      ? exclusions[i].trim()
      : (typeof exclusions[i]?.exclusion_text === 'string' ? exclusions[i].exclusion_text.trim() : '');
    if (!text || text.length > 500) {
      return { ok: false, error: 'Each exclusion needs text (500 characters or fewer).' };
    }
    cleaned.push({ exclusion_text: text, sort_order: i });
  }
  return { ok: true, value: cleaned };
}

function validatePrice(priceCents) {
  if (priceCents === undefined || priceCents === null) return { ok: true, value: null };
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    return { ok: false, error: 'Price must be a whole number of cents, zero or more.' };
  }
  return { ok: true, value: priceCents };
}

// A notification is best-effort: a delivery failure is logged and never
// fails the proposal write that already happened.
async function notifyProposalParty({ userId, type, data, actionUrl, idempotencyKey }) {
  if (!userId) return;
  try {
    const result = await sendNotification({
      userId, type, data, action_url: actionUrl, idempotencyKey,
    });
    if (result && result.success !== true) {
      logger.warn('Failed to notify consulting proposal party', { type, userId, error: result.error || 'send_failed' });
    }
  } catch (err) {
    logger.warn('Failed to notify consulting proposal party', { type, userId, error: err.message });
  }
}

// The client also hears about a proposal by email at the referral address,
// which is the address the intake itself used. Best-effort, like the
// screening reply path.
async function emailProposalClient(referral, subject, intro, lines) {
  if (!referral?.email) return;
  try {
    const rendered = renderOxSteedEmail({
      language: 'en',
      preheader: subject,
      eyebrow: 'OXSTEED CONSULTING',
      title: subject,
      intro,
      details: lines,
      footerText: 'The OxSteed Team',
    });
    await sendEmail({ to: referral.email, subject, html: rendered.html, text: rendered.text });
  } catch (err) {
    logger.warn('Failed to email consulting proposal notice', { requestId: referral.id, error: err.message });
  }
}

function fmtPriceCents(priceCents, currency) {
  if (priceCents === null || priceCents === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: currency || 'USD',
  }).format(priceCents / 100);
}

function clientActionUrl() {
  return '/business-launch-status';
}

function consultantActionUrl() {
  return '/consulting/contractor-dashboard';
}

// ── Reads ────────────────────────────────────────────────────────────

// List every version of the proposal for one referral, newest first.
// Readable by the assigned consultant, the client owner, and admins.
exports.listProposals = async (req, res) => {
  const requestId = req.params.requestId || req.params.id;
  if (!validRequestId(requestId)) return res.status(404).json({ error: 'Referral not found.' });
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const referral = await loadReferral(db, requestId);
    if (!referral) return res.status(404).json({ error: 'Referral not found.' });
    if (!isAssignedConsultant(req, referral) && !isClientOwner(req, referral)) {
      return res.status(403).json({ error: 'Not authorized for this referral' });
    }
    const { rows } = await db.query(
      `SELECT * FROM consulting_engagement_proposals
        WHERE request_id = $1 ORDER BY version DESC`,
      [requestId],
    );
    const proposals = [];
    for (const proposal of rows) {
      proposals.push(await loadProposalWithItems(db, proposal.id, requestId));
    }
    return res.json({ referral: { id: referral.id, consultant_assignment_status: referral.consultant_assignment_status }, proposals });
  } catch (err) {
    logger.error('listProposals error', { err });
    return res.status(500).json({ error: 'Failed to load proposals.' });
  }
};

exports.getProposal = async (req, res) => {
  const requestId = req.params.requestId || req.params.id;
  const proposalId = Number(req.params.proposalId);
  if (!validRequestId(requestId) || !Number.isInteger(proposalId) || proposalId <= 0) {
    return res.status(404).json({ error: 'Proposal not found.' });
  }
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const referral = await loadReferral(db, requestId);
    if (!referral) return res.status(404).json({ error: 'Referral not found.' });
    if (!isAssignedConsultant(req, referral) && !isClientOwner(req, referral)) {
      return res.status(403).json({ error: 'Not authorized for this referral' });
    }
    const proposal = await loadProposalWithItems(db, proposalId, requestId);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found.' });
    return res.json({ proposal });
  } catch (err) {
    logger.error('getProposal error', { err });
    return res.status(500).json({ error: 'Failed to load proposal.' });
  }
};

// ── 521: create a draft ──────────────────────────────────────────────

// The assigned consultant drafts a new version. A draft is not a forward
// move, so an open conflict does not block drafting (D-105 blocks sends).
exports.createProposal = async (req, res) => {
  const requestId = req.params.requestId;
  if (!validRequestId(requestId)) return res.status(404).json({ error: 'Referral not found.' });
  const { title, scope_summary, price_cents, currency, deliverables, exclusions } = req.body || {};
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  if (!cleanTitle || cleanTitle.length > 255) {
    return res.status(400).json({ error: 'A proposal title is required (255 characters or fewer).' });
  }
  const cleanScope = scope_summary === undefined || scope_summary === null ? null : String(scope_summary);
  if (cleanScope !== null && cleanScope.length > 5000) {
    return res.status(400).json({ error: 'Scope must be 5000 characters or fewer.' });
  }
  const price = validatePrice(price_cents);
  if (!price.ok) return res.status(400).json({ error: price.error });
  const cleanCurrency = currency === undefined || currency === null ? 'USD' : String(currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(cleanCurrency)) {
    return res.status(400).json({ error: 'Currency must be a 3-letter code.' });
  }
  const cleanDeliverables = validateDeliverables(deliverables);
  if (!cleanDeliverables.ok) return res.status(400).json({ error: cleanDeliverables.error });
  const cleanExclusions = validateExclusions(exclusions);
  if (!cleanExclusions.ok) return res.status(400).json({ error: cleanExclusions.error });

  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const referral = await loadReferral(db, requestId);
    if (!referral) return res.status(404).json({ error: 'Referral not found.' });
    if (isAdmin(req) || String(referral.consultant_assigned_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the assigned consultant drafts a proposal.' });
    }
    if (!PROPOSABLE_STATUSES.has(referral.consultant_assignment_status)) {
      return res.status(409).json({ error: 'Referral is closed to new proposals.' });
    }

    const proposal = await withTransaction(db, async (client) => {
      const { rows: [{ max_version }] } = await client.query(
        `SELECT COALESCE(MAX(version), 0) AS max_version
           FROM consulting_engagement_proposals WHERE request_id = $1`,
        [requestId],
      );
      const version = Number(max_version) + 1;
      const { rows: [created] } = await client.query(
        `INSERT INTO consulting_engagement_proposals
           (request_id, consultant_id, version, title, scope_summary, price_cents, currency, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $2)
         RETURNING *`,
        [requestId, req.user.id, version, cleanTitle, cleanScope?.trim() || null, price.value, cleanCurrency],
      );
      for (const item of cleanDeliverables.value) {
        await client.query(
          `INSERT INTO consulting_proposal_deliverables
             (proposal_id, title, description, deliverable_type, due_date, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [created.id, item.title, item.description, item.deliverable_type, item.due_date, item.sort_order],
        );
      }
      for (const item of cleanExclusions.value) {
        await client.query(
          `INSERT INTO consulting_proposal_exclusions (proposal_id, exclusion_text, sort_order)
           VALUES ($1, $2, $3)`,
          [created.id, item.exclusion_text, item.sort_order],
        );
      }
      return created;
    }, 'create_consulting_proposal');

    const full = await loadProposalWithItems(db, proposal.id, requestId);
    return res.status(201).json({ proposal: full });
  } catch (err) {
    logger.error('createProposal error', { err });
    return res.status(500).json({ error: 'Failed to create proposal.' });
  }
};

// Edit a draft in place. A sent version is immutable: a change means a
// new version, so edits to anything but a draft are a 409.
exports.updateProposal = async (req, res) => {
  const requestId = req.params.requestId;
  const proposalId = Number(req.params.proposalId);
  if (!validRequestId(requestId) || !Number.isInteger(proposalId) || proposalId <= 0) {
    return res.status(404).json({ error: 'Proposal not found.' });
  }
  const { title, scope_summary, price_cents, currency, deliverables, exclusions } = req.body || {};
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  if (!cleanTitle || cleanTitle.length > 255) {
    return res.status(400).json({ error: 'A proposal title is required (255 characters or fewer).' });
  }
  const cleanScope = scope_summary === undefined || scope_summary === null ? null : String(scope_summary);
  if (cleanScope !== null && cleanScope.length > 5000) {
    return res.status(400).json({ error: 'Scope must be 5000 characters or fewer.' });
  }
  const price = validatePrice(price_cents);
  if (!price.ok) return res.status(400).json({ error: price.error });
  const cleanCurrency = currency === undefined || currency === null ? 'USD' : String(currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(cleanCurrency)) {
    return res.status(400).json({ error: 'Currency must be a 3-letter code.' });
  }
  const cleanDeliverables = validateDeliverables(deliverables);
  if (!cleanDeliverables.ok) return res.status(400).json({ error: cleanDeliverables.error });
  const cleanExclusions = validateExclusions(exclusions);
  if (!cleanExclusions.ok) return res.status(400).json({ error: cleanExclusions.error });

  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const referral = await loadReferral(db, requestId);
    if (!referral) return res.status(404).json({ error: 'Referral not found.' });
    if (isAdmin(req) || String(referral.consultant_assigned_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the assigned consultant edits a proposal.' });
    }
    const existing = await loadProposalWithItems(db, proposalId, requestId);
    if (!existing) return res.status(404).json({ error: 'Proposal not found.' });
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: 'Only a draft proposal can be edited. Send a new version instead.' });
    }

    await withTransaction(db, async (client) => {
      await client.query(
        `UPDATE consulting_engagement_proposals
            SET title = $1, scope_summary = $2, price_cents = $3, currency = $4, updated_at = NOW()
          WHERE id = $5 AND status = 'draft'`,
        [cleanTitle, cleanScope?.trim() || null, price.value, cleanCurrency, proposalId],
      );
      await client.query(`DELETE FROM consulting_proposal_deliverables WHERE proposal_id = $1`, [proposalId]);
      await client.query(`DELETE FROM consulting_proposal_exclusions WHERE proposal_id = $1`, [proposalId]);
      for (const item of cleanDeliverables.value) {
        await client.query(
          `INSERT INTO consulting_proposal_deliverables
             (proposal_id, title, description, deliverable_type, due_date, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [proposalId, item.title, item.description, item.deliverable_type, item.due_date, item.sort_order],
        );
      }
      for (const item of cleanExclusions.value) {
        await client.query(
          `INSERT INTO consulting_proposal_exclusions (proposal_id, exclusion_text, sort_order)
           VALUES ($1, $2, $3)`,
          [proposalId, item.exclusion_text, item.sort_order],
        );
      }
    }, 'update_consulting_proposal');

    const full = await loadProposalWithItems(db, proposalId, requestId);
    return res.json({ proposal: full });
  } catch (err) {
    logger.error('updateProposal error', { err });
    return res.status(500).json({ error: 'Failed to update proposal.' });
  }
};

// ── 521/524: send ────────────────────────────────────────────────────

// Send a draft to the client. Requires a scope, a price, and at least one
// deliverable, so a sent proposal is always a complete offer. An open
// conflict blocks the send (D-105: a forward move). Sending supersedes
// the previous sent version and moves the referral to 'proposal_sent'.
exports.sendProposal = async (req, res) => {
  const requestId = req.params.requestId;
  const proposalId = Number(req.params.proposalId);
  if (!validRequestId(requestId) || !Number.isInteger(proposalId) || proposalId <= 0) {
    return res.status(404).json({ error: 'Proposal not found.' });
  }
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const referral = await loadReferral(db, requestId);
    if (!referral) return res.status(404).json({ error: 'Referral not found.' });
    if (isAdmin(req) || String(referral.consultant_assigned_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the assigned consultant sends a proposal.' });
    }
    if (!PROPOSABLE_STATUSES.has(referral.consultant_assignment_status)) {
      return res.status(409).json({ error: 'Referral is closed to new proposals.' });
    }
    if (await hasOpenConflict(db, requestId, req.user.id)) {
      return res.status(409).json({ error: 'conflict_declared', message: 'An open conflict blocks sending a proposal until it is cleared or the referral is declined.' });
    }
    const existing = await loadProposalWithItems(db, proposalId, requestId);
    if (!existing) return res.status(404).json({ error: 'Proposal not found.' });
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: 'Only a draft proposal can be sent.' });
    }
    if (!existing.scope_summary || !existing.scope_summary.trim()) {
      return res.status(400).json({ error: 'A scope summary is required before sending.' });
    }
    if (existing.price_cents === null || existing.price_cents === undefined) {
      return res.status(400).json({ error: 'A price is required before sending.' });
    }
    if (!existing.deliverables || existing.deliverables.length === 0) {
      return res.status(400).json({ error: 'At least one deliverable is required before sending.' });
    }

    const sent = await withTransaction(db, async (client) => {
      await client.query(
        `UPDATE consulting_engagement_proposals
            SET status = 'superseded', updated_at = NOW()
          WHERE request_id = $1 AND status = 'sent' AND id <> $2`,
        [requestId, proposalId],
      );
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_engagement_proposals
            SET status = 'sent', updated_at = NOW()
          WHERE id = $1 AND status = 'draft'
          RETURNING *`,
        [proposalId],
      );
      if (!updated) return null;
      await client.query(
        `UPDATE consulting_requests
            SET consultant_assignment_status = 'proposal_sent', updated_at = NOW()
          WHERE id = $1`,
        [requestId],
      );
      return updated;
    }, 'send_consulting_proposal');
    if (!sent) return res.status(409).json({ error: 'Proposal is no longer a draft.' });

    const full = await loadProposalWithItems(db, proposalId, requestId);
    await notifyProposalParty({
      userId: referral.user_id,
      type: 'consulting_proposal_sent',
      data: { request_id: requestId, proposal_id: proposalId, version: full.version },
      actionUrl: clientActionUrl(),
      idempotencyKey: `consulting-proposal-sent:${proposalId}`,
    });
    await emailProposalClient(
      referral,
      'Your engagement proposal is ready to review',
      `Your consultant sent an engagement proposal (version ${full.version}) for your business-launch inquiry. Review the scope, deliverables, and price, then approve it or ask for changes.`,
      [
        { label: 'Proposal', value: full.title },
        { label: 'Price', value: fmtPriceCents(full.price_cents, full.currency) },
        { label: 'Deliverables', value: String(full.deliverables.length) },
      ],
    );
    return res.json({ proposal: full });
  } catch (err) {
    logger.error('sendProposal error', { err });
    return res.status(500).json({ error: 'Failed to send proposal.' });
  }
};

// ── 524: client approval ─────────────────────────────────────────────

// Approve the sent version. The client owner (or an admin acting for
// them) approves; the consultant never approves their own proposal.
// Approval moves the referral to 'engaged': the work is agreed.
exports.approveProposal = async (req, res) => {
  const requestId = req.params.requestId || req.params.id;
  const proposalId = Number(req.params.proposalId);
  if (!validRequestId(requestId) || !Number.isInteger(proposalId) || proposalId <= 0) {
    return res.status(404).json({ error: 'Proposal not found.' });
  }
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const referral = await loadReferral(db, requestId);
    if (!referral) return res.status(404).json({ error: 'Referral not found.' });
    if (!isClientOwner(req, referral)) {
      return res.status(403).json({ error: 'Only the client approves a proposal.' });
    }
    const existing = await loadProposalWithItems(db, proposalId, requestId);
    if (!existing) return res.status(404).json({ error: 'Proposal not found.' });
    if (existing.status !== 'sent') {
      return res.status(409).json({ error: 'Only a sent proposal can be approved.' });
    }

    const approved = await withTransaction(db, async (client) => {
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_engagement_proposals
            SET status = 'approved', decided_by = $1, decided_at = NOW(),
                decision_reason = $2, updated_at = NOW()
          WHERE id = $3 AND status = 'sent'
          RETURNING *`,
        [req.user.id, (req.body?.reason || '').trim() || null, proposalId],
      );
      if (!updated) return null;
      const { rows: moved } = await client.query(
        `UPDATE consulting_requests
            SET consultant_assignment_status = 'engaged', updated_at = NOW()
          WHERE id = $1 AND consultant_assignment_status = 'proposal_sent'
          RETURNING id`,
        [requestId],
      );
      if (moved.length === 0) return { conflict: true };
      return updated;
    }, 'approve_consulting_proposal');
    if (!approved) return res.status(409).json({ error: 'Proposal is no longer open.' });
    if (approved.conflict) return res.status(409).json({ error: 'Referral changed. Please reload.' });

    const full = await loadProposalWithItems(db, proposalId, requestId);
    await notifyProposalParty({
      userId: referral.consultant_assigned_id,
      type: 'consulting_proposal_approved',
      data: { request_id: requestId, proposal_id: proposalId, version: full.version },
      actionUrl: consultantActionUrl(),
      idempotencyKey: `consulting-proposal-approved:${proposalId}`,
    });
    return res.json({ proposal: full });
  } catch (err) {
    logger.error('approveProposal error', { err });
    return res.status(500).json({ error: 'Failed to approve proposal.' });
  }
};

// Reject the sent version. A reason is required so the consultant knows
// what to change; the referral stays 'proposal_sent' so a new version
// can follow without re-opening the whole inquiry.
exports.rejectProposal = async (req, res) => {
  const requestId = req.params.requestId || req.params.id;
  const proposalId = Number(req.params.proposalId);
  if (!validRequestId(requestId) || !Number.isInteger(proposalId) || proposalId <= 0) {
    return res.status(404).json({ error: 'Proposal not found.' });
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 10 || reason.length > 2000) {
    return res.status(400).json({ error: 'A rejection reason of at least 10 characters is required.' });
  }
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const referral = await loadReferral(db, requestId);
    if (!referral) return res.status(404).json({ error: 'Referral not found.' });
    if (!isClientOwner(req, referral)) {
      return res.status(403).json({ error: 'Only the client rejects a proposal.' });
    }
    const existing = await loadProposalWithItems(db, proposalId, requestId);
    if (!existing) return res.status(404).json({ error: 'Proposal not found.' });
    if (existing.status !== 'sent') {
      return res.status(409).json({ error: 'Only a sent proposal can be rejected.' });
    }

    const { rows: [rejected] } = await db.query(
      `UPDATE consulting_engagement_proposals
          SET status = 'rejected', decided_by = $1, decided_at = NOW(),
              decision_reason = $2, updated_at = NOW()
        WHERE id = $3 AND status = 'sent'
        RETURNING *`,
      [req.user.id, reason, proposalId],
    );
    if (!rejected) return res.status(409).json({ error: 'Proposal is no longer open.' });

    const full = await loadProposalWithItems(db, proposalId, requestId);
    await notifyProposalParty({
      userId: referral.consultant_assigned_id,
      type: 'consulting_proposal_rejected',
      data: { request_id: requestId, proposal_id: proposalId, version: full.version },
      actionUrl: consultantActionUrl(),
      idempotencyKey: `consulting-proposal-rejected:${proposalId}`,
    });
    return res.json({ proposal: full });
  } catch (err) {
    logger.error('rejectProposal error', { err });
    return res.status(500).json({ error: 'Failed to reject proposal.' });
  }
};

// Withdraw a sent proposal. The referral falls back to
// 'discovery_scheduled', the stage before a proposal goes out, so the
// consultant can rework and send a new version.
exports.withdrawProposal = async (req, res) => {
  const requestId = req.params.requestId;
  const proposalId = Number(req.params.proposalId);
  if (!validRequestId(requestId) || !Number.isInteger(proposalId) || proposalId <= 0) {
    return res.status(404).json({ error: 'Proposal not found.' });
  }
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const referral = await loadReferral(db, requestId);
    if (!referral) return res.status(404).json({ error: 'Referral not found.' });
    if (isAdmin(req) || String(referral.consultant_assigned_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the assigned consultant withdraws a proposal.' });
    }
    const existing = await loadProposalWithItems(db, proposalId, requestId);
    if (!existing) return res.status(404).json({ error: 'Proposal not found.' });
    if (existing.status !== 'sent') {
      return res.status(409).json({ error: 'Only a sent proposal can be withdrawn.' });
    }

    const withdrawn = await withTransaction(db, async (client) => {
      const { rows: [updated] } = await client.query(
        `UPDATE consulting_engagement_proposals
            SET status = 'withdrawn', decided_by = $1, decided_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND status = 'sent'
          RETURNING *`,
        [req.user.id, proposalId],
      );
      if (!updated) return null;
      await client.query(
        `UPDATE consulting_requests
            SET consultant_assignment_status = 'discovery_scheduled', updated_at = NOW()
          WHERE id = $1 AND consultant_assignment_status = 'proposal_sent'
            AND NOT EXISTS (
              SELECT 1 FROM consulting_engagement_proposals
               WHERE request_id = $1 AND status = 'sent'
            )`,
        [requestId],
      );
      return updated;
    }, 'withdraw_consulting_proposal');
    if (!withdrawn) return res.status(409).json({ error: 'Proposal is no longer open.' });

    const full = await loadProposalWithItems(db, proposalId, requestId);
    await notifyProposalParty({
      userId: referral.user_id,
      type: 'consulting_proposal_withdrawn',
      data: { request_id: requestId, proposal_id: proposalId, version: full.version },
      actionUrl: clientActionUrl(),
      idempotencyKey: `consulting-proposal-withdrawn:${proposalId}`,
    });
    await emailProposalClient(
      referral,
      'Your engagement proposal was withdrawn',
      `Your consultant withdrew engagement proposal version ${full.version}. They may send a revised version, or reach out with next steps.`,
      [{ label: 'Proposal', value: full.title }],
    );
    return res.json({ proposal: full });
  } catch (err) {
    logger.error('withdrawProposal error', { err });
    return res.status(500).json({ error: 'Failed to withdraw proposal.' });
  }
};

exports.DELIVERABLE_TYPES = DELIVERABLE_TYPES;
