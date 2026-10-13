'use strict';

/**
 * Review P3-891: operator recovery for failed inbound webhook receipts.
 *
 * - list: failed (or long-stuck processing) receipts across providers.
 * - replay (Stripe): re-fetch the event from the Stripe API (never trust a
 *   stored payload) and run it through the same verified-event handler the
 *   endpoint uses. The receipt/watermark machinery keeps it idempotent.
 * - resolve: an operator closes a receipt that needs no replay (handled out
 *   of band), with a required note. Audited.
 */
const db = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('./auditService');

function getStripe() {
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

async function listFailedReceipts({ provider = null, limit = 100 } = {}) {
  const bounded = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows } = await db.query(
    `SELECT id, provider, event_id, event_type, status, attempts, account_id,
            object_type, object_id, first_seen_at, last_seen_at, last_error
       FROM webhook_event_receipts
      WHERE (status = 'failed'
             OR (status = 'processing' AND last_seen_at < NOW() - INTERVAL '15 minutes'))
        AND ($1::text IS NULL OR provider = $1)
      ORDER BY last_seen_at DESC
      LIMIT $2`,
    [provider, bounded]
  );
  return rows;
}

function captureResponse() {
  const out = { statusCode: 200, body: null, error: null };
  const res = {
    status(code) { out.statusCode = code; return res; },
    set() { return res; },
    json(body) { out.body = body; return res; },
  };
  const next = (err) => { out.error = err || null; };
  return { out, res, next };
}

async function replayStripeReceipt(receiptId, { adminId, req, stripe = null } = {}) {
  const { rows: [receipt] } = await db.query('SELECT * FROM webhook_event_receipts WHERE id = $1', [receiptId]);
  if (!receipt) return { ok: false, status: 404, code: 'not_found' };
  if (receipt.provider !== 'stripe') return { ok: false, status: 400, code: 'replay_unsupported_provider' };
  if (receipt.status === 'processed') return { ok: false, status: 409, code: 'already_processed' };

  const client = stripe || getStripe();
  const event = await client.events.retrieve(
    receipt.event_id,
    receipt.account_id ? { stripeAccount: receipt.account_id } : undefined
  );
  if (!event?.id || event.id !== receipt.event_id) {
    return { ok: false, status: 502, code: 'event_mismatch' };
  }
  if (receipt.account_id && !event.account) event.account = receipt.account_id;

  // Lazy require: webhookController requires many services.
  const { handleVerifiedStripeEvent } = require('../controllers/webhookController');
  const { out, res, next } = captureResponse();
  await handleVerifiedStripeEvent(event, event.account ? 'connect' : 'platform', res, next);
  const ok = !out.error && out.statusCode < 400;

  await logAdminAction({
    adminId,
    action: 'webhook_receipt_replay',
    targetType: 'webhook_event_receipt',
    targetId: String(receiptId),
    description: `Replayed ${receipt.event_type} ${receipt.event_id}`,
    before: { status: receipt.status, last_error: receipt.last_error },
    after: { ok, statusCode: out.error?.statusCode || out.statusCode, error: out.error?.message || null },
    req,
    throwOnError: true,
  });
  if (!ok) logger.warn('Webhook receipt replay failed', { receiptId, error: out.error?.message });
  return { ok, status: ok ? 200 : 502, code: ok ? 'replayed' : 'replay_failed', result: out.body, error: out.error?.message || null };
}

async function resolveReceipt(receiptId, { adminId, note, req }) {
  const text = String(note || '').trim().slice(0, 1000);
  if (!text) return { ok: false, status: 400, code: 'note_required' };
  const { rows: [updated] } = await db.query(
    `UPDATE webhook_event_receipts
        SET status = 'processed', processed_at = NOW(), last_seen_at = NOW(),
            resolved_by = $2, resolution_note = $3
      WHERE id = $1 AND status IN ('failed', 'processing')
      RETURNING id, provider, event_id, event_type, status`,
    [receiptId, adminId, text]
  );
  if (!updated) return { ok: false, status: 409, code: 'not_resolvable' };
  await logAdminAction({
    adminId,
    action: 'webhook_receipt_resolved',
    targetType: 'webhook_event_receipt',
    targetId: String(receiptId),
    description: text,
    after: { status: 'processed', manual: true },
    req,
    throwOnError: true,
  });
  return { ok: true, status: 200, code: 'resolved', receipt: updated };
}

module.exports = { listFailedReceipts, replayStripeReceipt, resolveReceipt };
