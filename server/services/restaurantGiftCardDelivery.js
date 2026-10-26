'use strict';

const crypto = require('crypto');
const pool = require('../db');
const email = require('../utils/email');
const fulfillment = require('./restaurantGiftCardFulfillment');

// Resend retains send identities for 24h. Stop automatic retries at 23h;
// uncertain older attempts require operator evidence, never a blind resend.
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
// Retrieval remains available beyond the 24h send-idempotency window.
const STATUS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Cost bound (c94983de): at most this many status polls per accepted email.
// With 15→240 min backoff, 48 polls covers the 7-day retrieval window
// (~4 ramp polls + 6 per day), so the cap bounds cost without cutting
// retrieval short at ~20 hours.
const MAX_STATUS_POLLS = 48;
function statusPollMinutes(polls) { return Math.min(240, 15 * 2 ** Math.min(4, Math.max(0, Number(polls) || 0))); }
async function processGiftCardDelivery({
  db = pool,
  send = email.sendEmail,
  inspect = email.getEmailDeliveryStatus,
  limit = 20,
} = {}) {
  await db.query(`UPDATE restaurant_gift_card_fulfillments SET payload_ciphertext=NULL,
    status=CASE WHEN status IN ('pending','sending','accepted','ready') THEN 'needs_review' ELSE status END,
    lease_token=NULL,lease_expires_at=NULL,last_error='payload_expired',updated_at=NOW()
    WHERE payload_ciphertext IS NOT NULL AND payload_expires_at<=NOW()`);
  if (!fulfillment.enabled() || !email.emailDeliveryAvailable())
    return { skipped: true, reason: 'delivery_disabled_or_unconfigured' };
  const token = crypto.randomUUID();
  const { rows } = await db.query(
    `WITH candidates AS (
    SELECT id FROM restaurant_gift_card_fulfillments
    WHERE kind='e_gift' AND payload_ciphertext IS NOT NULL AND payload_expires_at>NOW()
      AND ((status IN ('pending','accepted') AND next_attempt_at<=NOW()) OR (status='sending' AND lease_expires_at<NOW()))
      AND (lease_expires_at IS NULL OR lease_expires_at<NOW()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1
  ) UPDATE restaurant_gift_card_fulfillments f SET
    status=CASE WHEN f.status='accepted' THEN 'accepted' ELSE 'sending' END,
    first_attempt_at=COALESCE(f.first_attempt_at,NOW()),lease_token=$2,lease_expires_at=NOW()+INTERVAL '5 minutes',
    attempts=CASE WHEN f.status='accepted' THEN f.attempts ELSE f.attempts+1 END,updated_at=NOW()
    FROM candidates c WHERE f.id=c.id RETURNING f.*`,
    [Math.max(1, Math.min(Number(limit) || 20, 50)), token],
  );
  let acknowledged = 0;
  for (const row of rows) {
    let status,
      providerId = row.provider_id,
      event = row.provider_event,
      error = null;
    try {
      if (row.status === 'accepted') {
        if (
          Date.now() - new Date(row.first_attempt_at).getTime() >
          STATUS_WINDOW_MS || Number(row.status_poll_count) >= MAX_STATUS_POLLS
        )
          status = 'needs_review';
        else {
          const result = await inspect(providerId);
          event = result?.success ? result.event || event : event;
          status = ['delivered', 'opened', 'clicked'].includes(event)
            ? 'delivered'
            : [
                  'bounced',
                  'complained',
                  'failed',
                  'suppressed',
                  'canceled',
                ].includes(event)
              ? 'failed'
              : 'accepted';
          if (!result?.success) error = 'provider_status_unavailable';
        }
      } else if (
        Date.now() - new Date(row.first_attempt_at).getTime() >=
          RETRY_WINDOW_MS ||
        Number(row.attempts) > 8
      ) {
        status = 'needs_review';
        error = 'delivery_outcome_unconfirmed';
      } else {
        const payload = fulfillment.readPayload(row),
          rendered = payload.email || fulfillment.render(payload);
        const result = await send({
          to: payload.to,
          from: payload.from,
          fromName: payload.fromName,
          ...rendered,
          idempotencyKey: `restaurant-gift/${row.provider_key}`,
        });
        if (result?.success && /^[a-f0-9-]{36}$/i.test(result.id || '')) {
          status = 'accepted';
          providerId = result.id;
          event = 'sent';
        } else {
          status = Number(row.attempts) >= 8 ? 'needs_review' : 'pending';
          error = 'provider_send_unconfirmed';
        }
      }
    } catch {
      status =
        row.status === 'accepted'
          ? 'accepted'
          : Number(row.attempts) >= 8
            ? 'needs_review'
            : 'pending';
      error = 'provider_request_failed';
    }
    const result = await db.query(
      `UPDATE restaurant_gift_card_fulfillments SET status=$3,provider_id=$4,provider_event=$5,
      last_error=$6,lease_token=NULL,lease_expires_at=NULL,
      payload_ciphertext=CASE WHEN $3='delivered' THEN NULL ELSE payload_ciphertext END,
      next_attempt_at=NOW()+($7::int*INTERVAL '1 minute'),
      status_poll_count=status_poll_count+CASE WHEN $8 THEN 1 ELSE 0 END,updated_at=NOW()
      WHERE id=$1 AND lease_token=$2`,
      [
        row.id,
        token,
        status,
        providerId,
        event,
        error,
        row.status === 'accepted'
          ? statusPollMinutes(row.status_poll_count)
          : Math.min(60, 2 ** Number(row.attempts)),
        row.status === 'accepted',
      ],
    );
    acknowledged += result.rowCount;
  }
  return { claimed: rows.length, acknowledged };
}
module.exports = { processGiftCardDelivery, RETRY_WINDOW_MS, STATUS_WINDOW_MS, statusPollMinutes };
