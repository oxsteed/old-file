'use strict';

/**
 * In-statement case follow-up for OxSteed Credit disputes (capability 9b).
 *
 * Self-contained router. NOT mounted here; mount with e.g.
 *   app.use('/api', require('./routes/statementDisputeMessages'));
 * which exposes /api/statements/disputes/:disputeId/messages.
 *
 * This router is separate from statementInvestigation.js on purpose: the
 * investigation router's role guard intentionally excludes admins (they
 * investigate through admin tooling), but dispute follow-up must be reachable
 * by the dispute owner OR an admin. Record-level authorization is enforced
 * per dispute below instead of a route-wide role list.
 *
 * Invariants (absolute):
 * - MONEY FAILS CLOSED: these endpoints ONLY insert rows into
 *   oxsteed_credit_dispute_messages (plus one audit event). They NEVER
 *   mutate dispute state, amounts, resolution, journals, holds, or
 *   transactions, and they trigger no financial side effects. The POST
 *   handler performs exactly two writes inside one transaction: the message
 *   row and the audit event. Any future edit to this file must preserve
 *   that invariant.
 * - Record-level authorization on every read and write: the requester must
 *   own the dispute (dispute.customer_id = req.user.id) or be an admin.
 *   Unknown disputes and disputes owned by someone else are
 *   indistinguishable: 404 in both cases so ownership cannot be probed.
 * - PII minimization: author info on reads is id + role only.
 * - evidence_file_url accepts only relative /api/storage/public/ references
 *   or absolute https URLs on the app's media allowlist (shared
 *   normalizeAttachmentReference policy). Signed/presigned bearer URLs are
 *   rejected so private object access cannot be laundered into the thread.
 */

const express = require('express');

const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { disputeMessageLimiter } = require('../middleware/rateLimiter');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { normalizeAttachmentReference } = require('../utils/mediaUrlValidation');

router.use(authenticate);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MESSAGE_MAX_LENGTH = 5000;
const EVIDENCE_TEXT_MAX_LENGTH = 2000;

function notFound() {
  // Tampered, malformed, unknown, or unauthorized dispute ids are
  // indistinguishable from missing ones: 404 with no indication of what
  // exists.
  throw new AppError('Dispute not found', 404, 'statement_dispute_not_found');
}

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, maxLength);
}

function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

// Load the dispute and enforce owner-or-admin standing. 404 for unknown,
// malformed, and unauthorized ids alike.
async function loadDisputeForViewer(disputeId, user) {
  if (!UUID_RE.test(String(disputeId || ''))) notFound();
  const { rows } = await pool.query(
    `SELECT id, customer_id FROM oxsteed_credit_disputes WHERE id = $1`,
    [String(disputeId).toLowerCase()]
  );
  const dispute = rows[0];
  if (!dispute) notFound();
  if (!isAdminRole(user.role) && String(dispute.customer_id) !== String(user.id)) notFound();
  return dispute;
}

// Public API shape (fixed contract with the statement frontend): camelCase
// keys, author info masked to id + role, no PII beyond what is needed.
function messageView(row) {
  return {
    id: row.id,
    disputeId: row.dispute_id,
    authorId: row.author_id,
    authorRole: row.author_role,
    message: row.message,
    evidenceText: row.evidence_text,
    evidenceFileUrl: row.evidence_file_url,
    createdAt: row.created_at,
  };
}

const MESSAGE_COLUMNS = `id, dispute_id, author_id, author_role, message,
  evidence_text, evidence_file_url, created_at`;

async function findByIdempotencyKey(client, disputeId, idempotencyKey) {
  const { rows } = await client.query(
    `SELECT ${MESSAGE_COLUMNS} FROM oxsteed_credit_dispute_messages
      WHERE dispute_id = $1 AND idempotency_key = $2`,
    [disputeId, idempotencyKey]
  );
  return rows[0] || null;
}

function validatePostBody(body) {
  const rawMessage = body?.message;
  if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
    throw new AppError('A message is required', 400, 'statement_dispute_message_required');
  }
  // Validate the raw length explicitly: silently truncating a user's message
  // could lose the point they were making. The 5000-char table CHECK stays
  // as the fails-closed backstop.
  if (rawMessage.length > MESSAGE_MAX_LENGTH) {
    throw new AppError('The message is too long', 400, 'statement_dispute_message_too_long');
  }
  const message = sanitizeText(rawMessage, MESSAGE_MAX_LENGTH);
  if (!message) {
    throw new AppError('A message is required', 400, 'statement_dispute_message_required');
  }

  let evidenceText = null;
  const rawEvidenceText = body?.evidenceText;
  if (rawEvidenceText !== undefined && rawEvidenceText !== null && String(rawEvidenceText).trim() !== '') {
    if (typeof rawEvidenceText !== 'string') {
      throw new AppError('Invalid evidence text', 400, 'statement_dispute_evidence_text_invalid');
    }
    if (rawEvidenceText.length > EVIDENCE_TEXT_MAX_LENGTH) {
      throw new AppError('The evidence text is too long', 400, 'statement_dispute_evidence_text_too_long');
    }
    evidenceText = sanitizeText(rawEvidenceText, EVIDENCE_TEXT_MAX_LENGTH) || null;
  }

  let evidenceFileUrl = null;
  const rawFileUrl = body?.evidenceFileUrl;
  if (rawFileUrl !== undefined && rawFileUrl !== null && String(rawFileUrl).trim() !== '') {
    if (typeof rawFileUrl !== 'string') {
      throw new AppError('Invalid evidence file URL', 400, 'statement_dispute_evidence_url_invalid');
    }
    const normalized = normalizeAttachmentReference(rawFileUrl, null);
    if (normalized.error) {
      throw new AppError(normalized.error, 400, 'statement_dispute_evidence_url_invalid');
    }
    evidenceFileUrl = normalized.url;
  }

  const rawKey = body?.idempotencyKey;
  if (typeof rawKey !== 'string' || !UUID_RE.test(rawKey.trim())) {
    throw new AppError('A valid idempotency key is required', 400, 'statement_dispute_idempotency_key_invalid');
  }

  return { message, evidenceText, evidenceFileUrl, idempotencyKey: rawKey.trim().toLowerCase() };
}

router.get('/statements/disputes/:disputeId/messages', async (req, res, next) => {
  try {
    const dispute = await loadDisputeForViewer(req.params.disputeId, req.user);
    const { rows } = await pool.query(
      `SELECT ${MESSAGE_COLUMNS} FROM oxsteed_credit_dispute_messages
        WHERE dispute_id = $1
        ORDER BY created_at ASC, id ASC`,
      [dispute.id]
    );
    res.json({ messages: rows.map(messageView) });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/statements/disputes/:disputeId/messages',
  disputeMessageLimiter,
  async (req, res, next) => {
    try {
      const dispute = await loadDisputeForViewer(req.params.disputeId, req.user);
      const { message, evidenceText, evidenceFileUrl, idempotencyKey } = validatePostBody(req.body);
      const authorRole = req.user.role === 'super_admin' ? 'admin' : String(req.user.role);

      // Idempotent replay: a retried POST with the same key returns the
      // original message instead of creating a duplicate. A key reused with
      // different details is a 409 (same pattern as openCreditDispute).
      const preexisting = await findByIdempotencyKey(pool, dispute.id, idempotencyKey);
      if (preexisting) {
        if (
          String(preexisting.author_id) !== String(req.user.id)
          || preexisting.message !== message
          || (preexisting.evidence_text || null) !== evidenceText
          || (preexisting.evidence_file_url || null) !== evidenceFileUrl
        ) {
          throw new AppError(
            'Idempotency key was already used for different details',
            409,
            'statement_dispute_idempotency_conflict'
          );
        }
        return res.json({ message: messageView(preexisting), replayed: true });
      }

      // ── MONEY FAILS CLOSED ──────────────────────────────────────────
      // The ONLY writes in this transaction are the message row and its
      // audit event. This endpoint NEVER updates oxsteed_credit_disputes
      // (status, resolution, amounts), journals, holds, or transactions,
      // and it triggers no financial side effects of any kind.
      const result = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO oxsteed_credit_dispute_messages
             (dispute_id, author_id, author_role, message, evidence_text, evidence_file_url, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (dispute_id, idempotency_key) DO NOTHING
           RETURNING ${MESSAGE_COLUMNS}`,
          [dispute.id, req.user.id, authorRole, message, evidenceText, evidenceFileUrl, idempotencyKey]
        );
        let row = rows[0];
        let replayed = false;
        if (!row) {
          // Lost a race with a concurrent insert of the same key: return
          // the winner instead of failing.
          row = await findByIdempotencyKey(client, dispute.id, idempotencyKey);
          if (!row) {
            throw new AppError('Message could not be posted; please try again', 409, 'statement_dispute_message_conflict');
          }
          if (
            String(row.author_id) !== String(req.user.id)
            || row.message !== message
            || (row.evidence_text || null) !== evidenceText
            || (row.evidence_file_url || null) !== evidenceFileUrl
          ) {
            throw new AppError(
              'Idempotency key was already used for different details',
              409,
              'statement_dispute_idempotency_conflict'
            );
          }
          replayed = true;
        } else {
          // Audit event, same pattern as credit.dispute.opened in
          // oxsteedCreditService: who posted a follow-up on which dispute.
          // Read-only observation of the conversation; it changes nothing
          // about the dispute itself.
          await client.query(
            `INSERT INTO oxsteed_credit_audit_events
               (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, request_ip, after_state)
             VALUES ('credit.dispute.message.posted', $1, $2, 'credit_dispute_message', $3, $4, $5, $6::jsonb)`,
            [
              req.user.id,
              dispute.customer_id,
              String(row.id),
              'dispute-followup',
              req.ip || null,
              JSON.stringify({
                disputeId: String(dispute.id),
                authorRole,
                hasEvidenceText: evidenceText !== null,
                hasEvidenceFile: evidenceFileUrl !== null,
              }),
            ]
          );
        }
        return { row, replayed };
      }, 'post_dispute_message');

      res.status(result.replayed ? 200 : 201).json({
        message: messageView(result.row),
        replayed: result.replayed,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
