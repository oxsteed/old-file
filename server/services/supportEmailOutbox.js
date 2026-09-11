'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');

const MAX_ATTEMPTS = 8;
const STALE_LOCK_MINUTES = 15;

function normalizePayload(payload) {
  return {
    to: String(payload.to || '').trim().slice(0, 320),
    from: payload.from ? String(payload.from).trim().slice(0, 320) : undefined,
    fromName: payload.fromName ? String(payload.fromName).trim().slice(0, 120) : undefined,
    subject: String(payload.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
    text: String(payload.text || '').slice(0, 20000),
    html: String(payload.html || '').slice(0, 50000),
    idempotencyKey: String(payload.idempotencyKey || '').trim().slice(0, 255),
  };
}

async function enqueueSupportEmail({ conversationId = null, kind, ...payload }) {
  const normalized = normalizePayload(payload);
  if (!normalized.to || !normalized.subject || !normalized.idempotencyKey) {
    throw new Error('Support email outbox payload is incomplete');
  }

  const result = await db.query(
    `INSERT INTO support_email_outbox
       (conversation_id, kind, recipient, subject, payload, idempotency_key)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id, status`,
    [conversationId, String(kind || 'support').slice(0, 40), normalized.to, normalized.subject, JSON.stringify(normalized), normalized.idempotencyKey]
  );
  return result.rows[0] || { id: null, status: 'existing' };
}

async function sendSupportEmail(payload) {
  const normalized = normalizePayload(payload);
  const result = await sendEmail(normalized);
  if (result?.success) return result;

  try {
    await enqueueSupportEmail(payload);
  } catch (error) {
    logger.warn('Failed to enqueue support email retry', {
      conversationId: payload.conversationId || null,
      idempotencyKey: normalized.idempotencyKey,
      error: error.message,
    });
  }
  return result;
}

async function claimSupportEmails(limit = 25) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
  const result = await db.query(
    `WITH candidates AS (
       SELECT id
       FROM support_email_outbox
       WHERE (status = 'pending' AND next_attempt_at <= NOW())
          OR (status = 'sending' AND locked_at < NOW() - ($2::integer * INTERVAL '1 minute'))
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE support_email_outbox outbox
     SET status = 'sending', attempts = outbox.attempts + 1,
         locked_at = NOW(), updated_at = NOW()
     FROM candidates
     WHERE outbox.id = candidates.id
     RETURNING outbox.id, outbox.payload, outbox.attempts`,
    [boundedLimit, STALE_LOCK_MINUTES]
  );
  return result.rows;
}

async function finishSupportEmail(id, attempts, result) {
  const succeeded = Boolean(result?.success);
  const terminal = !succeeded && attempts >= MAX_ATTEMPTS;
  const status = succeeded ? 'sent' : terminal ? 'failed' : 'pending';
  const retryMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  await db.query(
    `UPDATE support_email_outbox
     SET status = $1,
         sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END,
         locked_at = NULL,
         last_error = $2,
         next_attempt_at = CASE WHEN $1 = 'pending' THEN NOW() + ($3::integer * INTERVAL '1 minute') ELSE next_attempt_at END,
         updated_at = NOW()
     WHERE id = $4`,
    [status, succeeded ? null : String(result?.error || 'Email send failed').slice(0, 2000), retryMinutes, id]
  );
  return status;
}

async function processSupportEmailOutbox() {
  const rows = await claimSupportEmails();
  let sent = 0;
  let retried = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      const result = await sendEmail(payload);
      const status = await finishSupportEmail(row.id, Number(row.attempts || 0), result);
      if (status === 'sent') sent += 1;
      else if (status === 'pending') retried += 1;
      else failed += 1;
    } catch (error) {
      const status = await finishSupportEmail(row.id, Number(row.attempts || 0), { success: false, error: error.message });
      if (status === 'pending') retried += 1;
      else failed += 1;
    }
  }
  return { claimed: rows.length, sent, retried, failed };
}

module.exports = {
  MAX_ATTEMPTS,
  enqueueSupportEmail,
  sendSupportEmail,
  processSupportEmailOutbox,
};
