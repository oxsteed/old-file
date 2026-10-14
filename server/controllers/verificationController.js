const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');
const db = require('../db');
// Review P3-842: utils/pushNotification never exported sendPush, so every
// completed report crashed the webhook after the DB writes (and Checkr retried).
const { sendNotification } = require('../services/notificationService');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { tNotif } = require('../utils/i18n');

const CHECKR_API = 'https://api.checkr.com/v1';

// === CHECKR BACKGROUND CHECK ===

// Initiate background check
exports.initiateBackgroundCheck = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { rows: users } = await db.query(
      'SELECT email, first_name, last_name, phone, zip_code FROM users WHERE id = $1', [userId]
    );
    const user = users[0];

    // Check for existing pending/in-progress check
    const { rows: existing } = await db.query(
      `SELECT id FROM background_checks WHERE user_id = $1 AND status IN ('pending', 'invited', 'in_progress')`, [userId]
    );
    if (existing.length) throw new AppError('Background check already in progress', 400, 'invalid_state');

    // Create Checkr candidate
    const candidateResponse = await fetch(`${CHECKR_API}/candidates`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.CHECKR_API_KEY || ''}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone: user.phone,
      zipcode: user.zip_code,
      }),
    });
    if (!candidateResponse.ok) {
      const text = await candidateResponse.text();
      throw new AppError(`Checkr candidate creation failed: ${text}`, 502, 'external_service_error');
    }
    const candidateRes = await candidateResponse.json();

    // Create invitation (sends Checkr email to candidate)
    const inviteResponse = await fetch(`${CHECKR_API}/invitations`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.CHECKR_API_KEY || ''}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
      candidate_id: candidateRes.data.id,
      package: 'tasker_standard',
      }),
    });
    if (!inviteResponse.ok) {
      const text = await inviteResponse.text();
      throw new AppError(`Checkr invitation creation failed: ${text}`, 502, 'external_service_error');
    }
    const inviteRes = await inviteResponse.json();

    // Store in DB
    await db.query(
      `INSERT INTO background_checks (user_id, checkr_candidate_id, checkr_invitation_id, status)
       VALUES ($1, $2, $3, 'invited')`,
      [userId, candidateRes.data.id, inviteRes.data.id]
    );

    await db.query(
      `UPDATE users SET background_check_status = 'pending' WHERE id = $1`, [userId]
    );

    await sendEmail({
      to: user.email,
      subject: 'Background check in progress',
      html: '<h2>Your background check is underway</h2><p>Results typically arrive in 1-3 business days. We\'ll notify you when it\'s complete.</p>',
      text: 'Your background check is underway. Results typically arrive in 1-3 business days.'
    });

    res.json({ status: 'invited', message: 'Background check initiated. Check your email.' });
  } catch (err) {
    next(err);
  }
};

// Checkr webhook handler
exports.checkrWebhook = async (req, res, next) => {
  try {
    const secret = process.env.CHECKR_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('CHECKR_WEBHOOK_SECRET is not configured');
      throw new AppError('Webhook secret not configured', 500, 'processing_error');
    }

    const incomingSignature = req.headers['x-checkr-signature'];
    if (!incomingSignature) {
      throw new AppError('Missing signature', 400, 'invalid_format');
    }

    const rawBody = req.body; // Buffer from express.raw()
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const computedBuf = Buffer.from(computed, 'utf8');
    const incomingBuf = Buffer.from(incomingSignature, 'utf8');
    if (computedBuf.length !== incomingBuf.length || !crypto.timingSafeEqual(computedBuf, incomingBuf)) {
      throw new AppError('Invalid signature', 401, 'no_auth');
    }

    const envelope = JSON.parse(rawBody.toString());
    const { type, data } = envelope;
    const report = data?.object || {};
    const eventId = envelope.id || envelope.event_id || report.id;
    const createdRaw = envelope.created_at || envelope.timestamp || report.created_at;
    const createdMs = Number.isFinite(Number(createdRaw))
      ? (Number(createdRaw) > 1e12 ? Number(createdRaw) : Number(createdRaw) * 1000)
      : Date.parse(String(createdRaw || ''));
    if (!eventId || !Number.isFinite(createdMs)) {
      throw new AppError('Webhook event envelope is incomplete', 400, 'invalid_format');
    }
    if (Math.abs(Date.now() - createdMs) > 24 * 60 * 60 * 1000) {
      throw new AppError('Webhook event is stale', 400, 'stale_webhook');
    }
    const receipt = await db.query(
      `INSERT INTO webhook_event_receipts (provider, event_id, event_type, object_type, object_id, event_created, status)
       VALUES ('checkr', $1, $2, 'report', $3, $4, 'processing')
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING id`,
      [String(eventId), String(type || 'unknown'), report.id ? String(report.id) : null, Math.floor(createdMs / 1000)]
    );
    if (!receipt.rows.length) {
      return res.json({ received: true, duplicate: true });
    }

    if (type === 'report.completed') {
      const reportId = report.id;
      const candidateId = report.candidate_id;
      const result = report.adjudication || report.status;

      // Status-transition guard (P3-5-F08): only apply the report when its
      // event is at least as new as the newest report event already applied
      // to this check. Without this, an older/out-of-order report.completed
      // (fresh envelope id, within the 24h window) would regress a newer
      // terminal state and flip users.background_check_status backwards.
      const { rows } = await db.query(
        `UPDATE background_checks
            SET checkr_report_id = $1, status = $2, result = $3, completed_at = NOW(),
                expires_at = NOW() + INTERVAL '1 year',
                last_report_event_created_at = GREATEST(COALESCE(last_report_event_created_at, to_timestamp(0)), $5::timestamptz)
          WHERE checkr_candidate_id = $4
            AND (last_report_event_created_at IS NULL OR last_report_event_created_at <= $5::timestamptz)
          RETURNING user_id`,
        [reportId, 'complete', result === 'clear' ? 'clear' : 'consider', candidateId, new Date(createdMs)]
      );

      if (rows.length) {
        const userId = rows[0].user_id;
        const passed = result === 'clear';

        // P2-7-F11: keep the parallel identity models in sync. Gates read
        // both background_check_status (verificationController badges,
        // helperOnboarding) and the legacy background_check_passed boolean
        // (tierMiddleware), so the Checkr webhook must write both.
        await db.query(
        `UPDATE users SET background_check_status = $1, background_check_passed = $3,
           background_check_passed_at = NOW(),
           background_check_expiry = NOW() + INTERVAL '1 year' WHERE id = $2`,
          [passed ? 'passed' : 'failed', userId, passed]
        );

        if (passed) {
          // Award verified badge
          await db.query(
            `INSERT INTO badges (user_id, type, label, expires_at)
             VALUES ($1, 'background_clear', 'Background Check Cleared', NOW() + INTERVAL '1 year')
             ON CONFLICT DO NOTHING`, [userId]
          );

          const { rows: langRows } = await db.query(
            'SELECT preferred_language FROM users WHERE id = $1',
            [userId]
          );
          const userLang = langRows[0]?.preferred_language || 'en';
          const passedNotif = tNotif('background_check_passed', userLang);
          await sendNotification({
            userId,
            type: 'background_check_passed',
            title: passedNotif.title,
            body: passedNotif.body,
            action_url: '/dashboard/helper',
            idempotencyKey: `checkr-report:${reportId}`,
          });
        } else {
          const { rows: langRows } = await db.query(
            'SELECT preferred_language FROM users WHERE id = $1',
            [userId]
          );
          const userLang = langRows[0]?.preferred_language || 'en';
          const failedNotif = tNotif('background_check_failed', userLang);
          await sendNotification({
            userId,
            type: 'background_check_failed',
            title: failedNotif.title,
            body: failedNotif.body,
            action_url: '/settings',
            idempotencyKey: `checkr-report:${reportId}`,
          });
        }
      }
    }

    await db.query(
      `UPDATE webhook_event_receipts SET status = 'processed', processed_at = NOW(), last_seen_at = NOW()
       WHERE provider = 'checkr' AND event_id = $1`,
      [String(eventId)]
    );

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
};

// Get background check status
exports.getBackgroundCheckStatus = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT status, result, completed_at, expires_at FROM background_checks
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.user.id]
    );
    res.json({ backgroundCheck: rows[0] || null });
  } catch (err) {
    next(err);
  }
};

// === STRIPE IDENTITY VERIFICATION ===

// Create identity verification session
exports.createIdentitySession = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const session = await stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: { userId: userId.toString() },
      options: {
        document: { require_matching_selfie: true },
      },
      return_url: `${process.env.APP_URL}/settings?identity=complete`,
    });

    await db.query(
      `INSERT INTO identity_verifications (user_id, stripe_verification_session_id, status)
       VALUES ($1, $2, 'requires_input')
       ON CONFLICT (stripe_verification_session_id) DO NOTHING`,
      [userId, session.id]
    );

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    logger.error('Stripe identity session creation failed', {
      userId: req.user?.id,
      type: err?.type,
      code: err?.code,
      message: err?.message,
    });

    const rawMessage = `${err?.message || ''} ${err?.raw?.message || ''}`.toLowerCase();
    const missingPermission =
      rawMessage.includes('rak_identity_product_write') ||
      rawMessage.includes('does not have the required permissions') ||
      rawMessage.includes('identity verification');

    if (missingPermission) {
      return next(
        new AppError(
          'Identity verification is temporarily unavailable through this legacy endpoint. Please use the OxSteed verification flow instead.',
          503,
          'verification_unavailable'
        )
      );
    }

    next(err);
  }
};

// Stripe Identity webhook handler
exports.identityWebhook = async (req, res, next) => {
  try {
    const secret = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('STRIPE_IDENTITY_WEBHOOK_SECRET is not configured');
      throw new AppError('Webhook secret not configured', 500, 'processing_error');
    }

    const sig = req.headers['stripe-signature'];
    if (!sig) {
      throw new AppError('Missing signature', 400, 'invalid_format');
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      logger.error('Stripe signature verification failed:', { err: err.message });
      throw new AppError('Webhook signature verification failed', 400, 'invalid_format');
    }

    const { type, data } = event;
    const eventId = event.id ? String(event.id) : null;
    let receiptId = null;
    // Per-session watermark (P3-5-F10): Stripe delivers events per session in
    // no guaranteed order. last_event_created_at records the newest event
    // applied; older events are ignored so an out-of-order requires_input
    // can never overwrite a newer verified state (or vice versa).
    const created = Number.isFinite(Number(event.created)) ? Number(event.created) : null;
    const eventCreatedTs = created ? new Date(created * 1000) : null;
    if (eventId) {
      const receipt = await db.query(
        `INSERT INTO webhook_event_receipts (provider, event_id, event_type, object_type, object_id, event_created, status)
         VALUES ('stripe_identity', $1, $2, 'verification_session', $3, $4, 'processing')
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
        [eventId, String(type || 'unknown'), data?.object?.id ? String(data.object.id) : null, created]
      );
      if (!receipt.rows.length) return res.json({ received: true, duplicate: true });
      receiptId = receipt.rows[0]?.id || null;
    }

    if (type === 'identity.verification_session.verified') {
      const sessionId = data.object.id;
      const verifiedName = data.object.verified_outputs?.first_name + ' ' + data.object.verified_outputs?.last_name;

      const { rows: transitioned } = await db.query(
        `UPDATE identity_verifications
            SET status = 'verified', verified_name = $1, updated_at = NOW(),
                last_event_created_at = CASE WHEN $3::timestamptz IS NULL THEN last_event_created_at
                                            ELSE GREATEST(COALESCE(last_event_created_at, to_timestamp(0)), $3::timestamptz) END
          WHERE stripe_verification_session_id = $2
            AND (last_event_created_at IS NULL OR $3::timestamptz IS NULL OR last_event_created_at <= $3::timestamptz)
          RETURNING user_id`,
        [verifiedName, sessionId, eventCreatedTs]
      );
      if (transitioned.length) {
        // P2-7-F11: Stripe Identity is a real identity verification, so it
        // must satisfy the legacy id_verified gate (tierMiddleware) as well
        // as identity_verified, plus the third model
        // (helper_profiles.is_identity_verified) read by the directory's
        // verified filter.
        await db.query(
          'UPDATE users SET identity_verified = TRUE, id_verified = TRUE WHERE id = $1', [transitioned[0].user_id]
        );
        try {
          await db.query(
            'UPDATE helper_profiles SET is_identity_verified = TRUE, updated_at = NOW() WHERE user_id = $1',
            [transitioned[0].user_id]
          );
        } catch (badgeErr) {
          logger.error('[StripeIdentity] helper identity badge update failed (best-effort)', {
            userId: transitioned[0].user_id, err: badgeErr.message,
          });
        }
      }
    }

    if (type === 'identity.verification_session.requires_input') {
      const sessionId = data.object.id;
      const lastError = data.object.last_error?.reason || 'Verification requires additional input';
      await db.query(
        `UPDATE identity_verifications
            SET status = 'requires_input', last_error = $1, updated_at = NOW(),
                last_event_created_at = CASE WHEN $3::timestamptz IS NULL THEN last_event_created_at
                                            ELSE GREATEST(COALESCE(last_event_created_at, to_timestamp(0)), $3::timestamptz) END
          WHERE stripe_verification_session_id = $2
            AND (last_event_created_at IS NULL OR $3::timestamptz IS NULL OR last_event_created_at <= $3::timestamptz)`,
        [lastError, sessionId, eventCreatedTs]
      );
    }

    if (receiptId) {
      await db.query(
        `UPDATE webhook_event_receipts SET status = 'processed', processed_at = NOW(), last_seen_at = NOW()
         WHERE id = $1`,
        [receiptId]
      );
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
};

// Get identity verification status
exports.getIdentityStatus = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT status, verified_name, last_error, created_at FROM identity_verifications
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.user.id]
    );
    res.json({ identity: rows[0] || null });
  } catch (err) {
    next(err);
  }
};

// === BADGE SYSTEM ===

exports.getUserBadges = async (req, res, next) => {
  try {
    const userId = req.params.userId || req.user.id;
    const { rows } = await db.query(
      `SELECT type, label, earned_at, expires_at FROM badges
       WHERE user_id = $1 AND active = TRUE AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
    res.json({ badges: rows });
  } catch (err) {
    next(err);
  }
};

// Recalculate and award badges based on user stats
exports.recalculateBadges = async (userId) => {
  const { rows: users } = await db.query(
    `SELECT
       referrals_count AS jobs_completed,
       community_score,
       subscription_status,
       background_check_status,
       identity_verified,
       COALESCE(tier, membership_tier, 'free') AS tier
     FROM users
     WHERE id = $1`,
    [userId]
  );
  if (!users.length) return;
  const user = users[0];

  // Verified badge: active subscription + background check passed
  if (user.subscription_status === 'active' && user.background_check_status === 'passed') {
    await db.query(
      `INSERT INTO badges (user_id, type, label) VALUES ($1, 'verified', 'Verified Helper')
       ON CONFLICT DO NOTHING`, [userId]
    );
  }

  // Pro badge: tier2_pro subscription
  if (user.tier === 'tier2_pro') {
    await db.query(
      `INSERT INTO badges (user_id, type, label) VALUES ($1, 'pro', 'Pro Helper')
       ON CONFLICT DO NOTHING`, [userId]
    );
  }

  // Reliable badge: 10+ jobs, 4.0+ score
  if (user.jobs_completed >= 10 && parseFloat(user.community_score) >= 4.0) {
    await db.query(
      `INSERT INTO badges (user_id, type, label) VALUES ($1, 'reliable', 'Reliable')
       ON CONFLICT DO NOTHING`, [userId]
    );
  }

  // Top Helper badge: 25+ jobs, 4.5+ score
  if (user.jobs_completed >= 25 && parseFloat(user.community_score) >= 4.5) {
    await db.query(
      `INSERT INTO badges (user_id, type, label) VALUES ($1, 'top_helper', 'Top Helper')
       ON CONFLICT DO NOTHING`, [userId]
    );
  }
};
