const crypto = require('crypto');

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('[FATAL] STRIPE_SECRET_KEY is not set — Stripe webhooks will fail.');
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const { recalculateBadges } = require('./verificationController');

// Stripe webhook handler for subscription events
exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          const subscriptionId = session.subscription;
          const userId = parseInt(session.metadata.userId);
          const planId = parseInt(session.metadata.planId);
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await db.query(
            `INSERT INTO subscriptions (user_id, plan_id, stripe_subscription_id, stripe_customer_id, status, current_period_start, current_period_end)
             VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7))
             ON CONFLICT (stripe_subscription_id) DO UPDATE SET status = $5`,
            [userId, planId, subscriptionId, session.customer, sub.status,
             sub.current_period_start, sub.current_period_end]
          );
          // Get plan tier
          const { rows: plans } = await db.query(
            'SELECT COALESCE(tier, slug) AS tier_slug, slug FROM plans WHERE id = $1', [planId]
          );
          const planSlug = plans[0]?.slug || plans[0]?.tier_slug || 'pro';
          const userTier = planSlug === 'basic' ? 'basic' : planSlug === 'broker' ? 'broker' : 'pro';
          await db.query(
            `UPDATE users SET tier = $1, subscription_status = 'active' WHERE id = $2`,
            [userTier, userId]
          );
          await recalculateBadges(userId);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await db.query(
          `UPDATE subscriptions SET status = $1, current_period_start = to_timestamp($2),
           current_period_end = to_timestamp($3), cancel_at_period_end = $4, updated_at = NOW()
           WHERE stripe_subscription_id = $5`,
          [sub.status, sub.current_period_start, sub.current_period_end,
           sub.cancel_at_period_end, sub.id]
        );
        const { rows } = await db.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [sub.id]
        );
        if (rows.length) {
          await db.query(
            'UPDATE users SET subscription_status = $1 WHERE id = $2',
            [sub.status, rows[0].user_id]
          );
          await recalculateBadges(rows[0].user_id);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await db.query(
          `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [sub.id]
        );
        const { rows } = await db.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [sub.id]
        );
        if (rows.length) {
          await db.query(
            `UPDATE users SET tier = 'free', subscription_status = 'cancelled' WHERE id = $1`,
            [rows[0].user_id]
          );
          // Deactivate subscription-dependent badges
          await db.query(
            `UPDATE badges SET active = FALSE WHERE user_id = $1 AND type IN ('verified', 'pro')`,
            [rows[0].user_id]
          );
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        await db.query(
          `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subId]
        );
        const { rows } = await db.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [subId]
        );
        if (rows.length) {
          await db.query(
            `UPDATE users SET subscription_status = 'past_due' WHERE id = $1`,
            [rows[0].user_id]
          );
        }
        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};

// ── Didit v3 Signature Helpers ──────────────────────────────

// Process floats - convert integer floats to integers (matches Python's shorten_floats)
function shortenFloats(data) {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return data.map(shortenFloats);
  if (typeof data === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = shortenFloats(value);
    }
    return result;
  }
  if (typeof data === 'number' && !Number.isInteger(data) && data === Math.floor(data)) {
    return Math.floor(data);
  }
  return data;
}

// Stringify JSON with sorted keys (matches Python's json.dumps with sort_keys=True)
function stableStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const parts = keys.map(key => JSON.stringify(key) + ':' + stableStringify(obj[key]));
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(obj);
}

function verifySignatureV2(body, receivedSignature, timestamp, secret) {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return false;
  const processedData = shortenFloats(body);
  const encodedData = stableStringify(processedData);
  const expectedSig = crypto.createHmac('sha256', secret)
    .update(encodedData, 'utf-8')
    .digest('hex');
  try {
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(receivedSignature, 'hex');
    return expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch { return false; }
}

function verifySignatureSimple(body, receivedSignature, timestamp, secret) {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return false;
  const canonicalString = [
    String(body.timestamp || ''),
    String(body.session_id || ''),
    String(body.status || ''),
    String(body.webhook_type || ''),
  ].join(':');
  const expectedSig = crypto.createHmac('sha256', secret)
    .update(canonicalString, 'utf-8')
    .digest('hex');
  try {
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(receivedSignature, 'hex');
    return expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch { return false; }
}

function verifySignatureOriginal(rawBody, receivedSignature, timestamp, secret) {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return false;
  const expectedSig = crypto.createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(receivedSignature, 'hex');
    return expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch { return false; }
}

// Didit identity webhook handler (v3 API)
exports.diditWebhook = async (req, res) => {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Didit] DIDIT_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook not configured.' });
  }

  // Parse body from raw Buffer
  let rawBody;
  let body;
  try {
    rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    body = typeof req.body === 'object' && !(req.body instanceof Buffer) ? req.body : JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON.' });
  }

  // Get signature headers (Express lowercases them)
  const signatureV2 = req.headers['x-signature-v2'];
  const signatureSimple = req.headers['x-signature-simple'];
  const signatureOriginal = req.headers['x-signature'];
  const timestamp = body.created_at; // Didit uses body.created_at as timestamp

  // Try verification methods in order: V2 -> Simple -> Original
  let isValid = false;
  let method = null;

  if (signatureV2) {
    isValid = verifySignatureV2(body, signatureV2, timestamp, secret);
    if (isValid) method = 'v2';
  }
  if (!isValid && signatureSimple) {
    isValid = verifySignatureSimple(body, signatureSimple, timestamp, secret);
    if (isValid) method = 'simple';
  }
  if (!isValid && signatureOriginal) {
    isValid = verifySignatureOriginal(rawBody, signatureOriginal, timestamp, secret);
    if (isValid) method = 'original';
  }

  if (!isValid) {
    console.warn('[Didit] Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  console.log(`[Didit] Signature verified via ${method}`);

  // Handle test webhooks from Didit console
  const isTestWebhook = req.headers['x-didit-test-webhook'] === 'true';
  if (isTestWebhook || body.metadata?.test_webhook) {
    console.log('[Didit] Test webhook received - signature valid');
    return res.json({ received: true, test: true });
  }

  // Process verification result
  try {
    const { session_id, status, decision } = body;
    if (!session_id) {
      return res.status(400).json({ error: 'Missing session_id.' });
    }

    // Didit sends capitalized status: "Approved", "Declined"
    const normalizedStatus = (decision?.status || status || '').toLowerCase();
    const idVerification = decision?.id_verifications?.[0] || {};
    const livenessCheck = decision?.liveness_checks?.[0] || {};
    const faceMatch = decision?.face_matches?.[0] || {};

    if (normalizedStatus === 'approved') {
      // Update identity_verifications record
      const { rows } = await db.query(
        `UPDATE identity_verifications
         SET status = 'approved',
             verified_name = $1,
             document_type = $2,
             updated_at = NOW()
         WHERE didit_session_id = $3
         RETURNING user_id`,
        [
          idVerification.full_name || null,
          idVerification.document_type || null,
          session_id,
        ]
      );

      if (rows.length) {
        const userId = rows[0].user_id;

        // Build identity hash from document number + DOB
        const docNumber = idVerification.document_number || '';
        const dob = idVerification.date_of_birth || '';
        let identityHash = null;
        if (docNumber) {
          identityHash = crypto
            .createHash('sha256')
            .update(`${docNumber}:${dob}`.toLowerCase().trim())
            .digest('hex');
        }

        if (!identityHash) {
          console.warn(`[Didit] No document_number for user ${userId} - skipping dedup`);
          await db.query(
            `UPDATE users
             SET identity_verified = TRUE,
                 didit_verified_at = NOW(),
                 didit_status = 'verified'
             WHERE id = $1`,
            [userId]
          );
        } else {
          // Check for duplicate identity
          const { rows: existing } = await db.query(
            `SELECT id, email FROM users
             WHERE didit_identity_hash = $1 AND id != $2`,
            [identityHash, userId]
          );

          if (existing.length > 0) {
            await db.query(
              `UPDATE users SET didit_status = 'duplicate' WHERE id = $1`,
              [userId]
            );
            console.warn(`[Didit] Duplicate identity for user ${userId} - matches user ${existing[0].id}`);
          } else {
            await db.query(
              `UPDATE users
               SET identity_verified = TRUE,
                   didit_identity_hash = $1,
                   didit_verified_at = NOW(),
                   didit_status = 'verified'
               WHERE id = $2`,
              [identityHash, userId]
            );
            // Award identity badge
            await db.query(
              `INSERT INTO badges (user_id, type, label)
               VALUES ($1, 'identity_verified', 'ID Verified')
               ON CONFLICT DO NOTHING`,
              [userId]
            );
            console.log(
              `[Didit] Identity approved for user ${userId} - ${idVerification.full_name}, ` +
              `doc: ${idVerification.document_type}, ` +
              `liveness: ${livenessCheck.liveness_score}, ` +
              `face match: ${faceMatch.face_match_score}`
            );
          }
        }
      } else {
        // No identity_verifications row found - try finding user by didit_session_id on users table
        const { rows: userRows } = await db.query(
          `SELECT id FROM users WHERE didit_session_id = $1`,
          [session_id]
        );
        if (userRows.length) {
          const userId = userRows[0].id;
          await db.query(
            `UPDATE users
             SET identity_verified = TRUE,
                 didit_verified_at = NOW(),
                 didit_status = 'verified'
             WHERE id = $1`,
            [userId]
          );
          console.log(`[Didit] Identity approved for user ${userId} (via users.didit_session_id)`);
        } else {
          console.warn(`[Didit] No user found for session ${session_id}`);
        }
      }
    } else if (normalizedStatus === 'declined') {
      const reason = idVerification.warnings?.join(', ')
        || body.reason
        || 'Verification declined';
      await db.query(
        `UPDATE identity_verifications
         SET status = 'declined', last_error = $1, updated_at = NOW()
         WHERE didit_session_id = $2`,
        [reason, session_id]
      );
      // Find user and mark failed
      const { rows } = await db.query(
        `SELECT user_id FROM identity_verifications WHERE didit_session_id = $1`,
        [session_id]
      );
      if (rows.length) {
        await db.query(
          `UPDATE users SET didit_status = 'failed' WHERE id = $1`,
          [rows[0].user_id]
        );
      } else {
        // Fallback: check users table directly
        await db.query(
          `UPDATE users SET didit_status = 'failed' WHERE didit_session_id = $1`,
          [session_id]
        );
      }
    } else {
      console.log(`[Didit] Unhandled status: ${status}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Didit] Webhook handler error:', err);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};
