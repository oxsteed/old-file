'use strict';

/**
 * Resend (Svix-signed) delivery webhooks for broadcast email.
 *
 * Signature: Svix scheme. RESEND_WEBHOOK_SECRET is the endpoint secret
 * ("whsec_<base64>"). Signed content is `${svix-id}.${svix-timestamp}.${rawBody}`,
 * HMAC-SHA256 with the base64-decoded secret, compared in constant time against
 * every "v1,<base64>" entry of svix-signature. Timestamps outside +/- 5 minutes
 * are rejected (replay window). No secret configured = 503, nothing processed.
 *
 * Idempotency: webhook_event_receipts(provider 'resend', event_id = svix-id).
 * A processed receipt short-circuits; an unprocessed one (crash, or event that
 * arrived before the send recorded its provider id) is retried.
 */

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');

const TOLERANCE_SECONDS = 5 * 60;
const UNMATCHED_RETRY_WINDOW_MS = 60 * 60 * 1000;
const HANDLED = new Set(['email.delivered', 'email.bounced', 'email.complained', 'email.failed']);

function secretBytes(secret) {
  const raw = String(secret || '').trim();
  if (!raw) return null;
  const b64 = raw.startsWith('whsec_') ? raw.slice(6) : raw;
  const buf = Buffer.from(b64, 'base64');
  return buf.length ? buf : null;
}

function verifySignature({ secret, id, timestamp, signature, body, now = Date.now() }) {
  const key = secretBytes(secret);
  if (!key) return { ok: false, reason: 'not_configured' };
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp' };
  const payload = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest();
  const match = String(signature).split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  return match ? { ok: true } : { ok: false, reason: 'signature' };
}

const HARD_BOUNCE = (bounce) => {
  const type = String(bounce?.type || bounce?.bounceType || '').toLowerCase();
  return type === '' || type === 'permanent' || type === 'hard';
};

async function applyEvent(client, event) {
  const type = event?.type;
  const data = event?.data || {};
  const messageId = data.email_id || data.id;
  if (!HANDLED.has(type) || !messageId) return { outcome: 'ignored' };
  const at = event.created_at && !Number.isNaN(Date.parse(event.created_at)) ? new Date(event.created_at) : new Date();
  const { rows: [delivery] } = await client.query(
    `SELECT d.id, d.broadcast_id, r.business_id, r.email, r.user_id
       FROM business_broadcast_deliveries d
       JOIN business_broadcast_recipients r ON r.id = d.recipient_id
      WHERE d.channel = 'email' AND d.provider_message_id = $1
      FOR UPDATE OF d`,
    [String(messageId)]
  );
  if (!delivery) {
    const gift = await client.query(`UPDATE restaurant_gift_card_fulfillments SET
      status=CASE WHEN $2='delivered' THEN 'delivered' ELSE 'failed' END,
      provider_event=$2,provider_event_at=$3,lease_token=NULL,lease_expires_at=NULL,
      payload_ciphertext=CASE WHEN $2='delivered' THEN NULL ELSE payload_ciphertext END,updated_at=NOW()
      WHERE kind='e_gift' AND provider_id=$1
        AND (provider_event_at IS NULL OR provider_event_at<=$3)
        AND NOT (COALESCE(provider_event,'') IN ('bounced','complained','failed','suppressed','canceled') AND $2='delivered')
      RETURNING id`,[String(messageId),type.slice(6),at]);
    if (gift.rows.length) return {outcome:'applied',giftCardDeliveryId:gift.rows[0].id};
    const notice=await require('../growth/policyNotice').applyProviderEvent(client,event);
    return notice||{ outcome: 'unmatched', at };
  }

  const column = {
    'email.delivered': 'delivered_at',
    'email.bounced': 'bounced_at',
    'email.complained': 'complained_at',
    'email.failed': 'provider_failed_at',
  }[type];
  const bounceType = type === 'email.bounced' ? String(data.bounce?.type || data.bounce?.subType || 'unknown').slice(0, 60) : null;
  await client.query(
    `UPDATE business_broadcast_deliveries
        SET ${column} = COALESCE(${column}, $2),
            bounce_type = COALESCE($3, bounce_type),
            provider_event_at = GREATEST(COALESCE(provider_event_at, $2), $2),
            updated_at = NOW()
      WHERE id = $1`,
    [delivery.id, at, bounceType]
  );
  const suppress = (type === 'email.bounced' && HARD_BOUNCE(data.bounce)) ? 'hard_bounce'
    : type === 'email.complained' ? 'complaint' : null;
  if (suppress && delivery.email) {
    await client.query(
      `INSERT INTO business_broadcast_suppressions (business_id, email, user_id, broadcast_id, source)
       VALUES ($1, $2, NULL, $3, $4)
       ON CONFLICT (business_id, email) WHERE email IS NOT NULL DO NOTHING`,
      [delivery.business_id, delivery.email, delivery.broadcast_id, suppress]
    );
  }
  return { outcome: 'applied', deliveryId: delivery.id };
}

/**
 * Process one verified event. Returns { status, body } for the HTTP response.
 * 200 for processed/duplicate/ignored, 503 for retryable (unmatched recent).
 */
async function handleEvent({ eventId, event, now = Date.now() }, db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [receipt] } = await client.query(
      `INSERT INTO webhook_event_receipts (provider, event_id, event_type, status)
       VALUES ('resend', $1, $2, 'processing')
       ON CONFLICT (provider, event_id) DO UPDATE
         SET attempts = webhook_event_receipts.attempts + 1, last_seen_at = NOW()
       RETURNING status, (xmax = 0) AS inserted`,
      [String(eventId).slice(0, 255), String(event?.type || '').slice(0, 255)]
    );
    if (!receipt.inserted && receipt.status === 'processed') {
      await client.query('COMMIT');
      return { status: 200, body: { received: true, duplicate: true } };
    }
    const result = await applyEvent(client, event);
    if (result.outcome === 'unmatched' && now - result.at.getTime() < UNMATCHED_RETRY_WINDOW_MS) {
      // The send may not have recorded the provider id yet; let Resend retry.
      await client.query(
        `UPDATE webhook_event_receipts SET status = 'pending', last_error = 'unmatched_message' WHERE provider = 'resend' AND event_id = $1`,
        [String(eventId).slice(0, 255)]
      );
      await client.query('COMMIT');
      return { status: 503, body: { received: false, retry: true } };
    }
    await client.query(
      `UPDATE webhook_event_receipts SET status = 'processed', processed_at = NOW(), last_error = $2
        WHERE provider = 'resend' AND event_id = $1`,
      [String(eventId).slice(0, 255), result.outcome === 'applied' ? null : result.outcome]
    );
    await client.query('COMMIT');
    return { status: 200, body: { received: true, outcome: result.outcome } };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function resendWebhook(req, res, next) {
  try {
    const verdict = verifySignature({
      secret: process.env.RESEND_WEBHOOK_SECRET,
      id: req.get('svix-id'),
      timestamp: req.get('svix-timestamp'),
      signature: req.get('svix-signature'),
      body: req.body,
    });
    if (!verdict.ok) {
      if (verdict.reason === 'not_configured') {
        logger.error('[resend-webhook] RESEND_WEBHOOK_SECRET is not set; event refused');
        return res.status(503).json({ error: 'Webhook not configured', code: 'webhook_not_configured' });
      }
      return res.status(401).json({ error: 'Invalid signature', code: 'webhook_signature_invalid' });
    }
    let event;
    try {
      event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body));
    } catch {
      return res.status(400).json({ error: 'Invalid payload', code: 'webhook_payload_invalid' });
    }
    const out = await handleEvent({ eventId: req.get('svix-id'), event });
    return res.status(out.status).json(out.body);
  } catch (err) {
    return next(err);
  }
}

module.exports = { verifySignature, applyEvent, handleEvent, resendWebhook, TOLERANCE_SECONDS };
