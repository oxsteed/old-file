const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');
const db = require('../db');
const { sendPush } = require('../utils/pushNotification');
const { sendEmail } = require('../utils/email');

const CHECKR_API = 'https://api.checkr.com/v1';

// === CHECKR BACKGROUND CHECK ===

// Initiate background check
exports.initiateBackgroundCheck = async (req, res) => {
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
    if (existing.length) return res.status(400).json({ error: 'Background check already in progress.' });

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
      throw new Error(`Checkr candidate create failed: ${text}`);
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
      throw new Error(`Checkr invitation create failed: ${text}`);
    }
    const inviteRes = await inviteResponse.json();

    // Store in DB
    await db.query(
      `INSERT INTO background_checks (user_id, checkr_candidate_id, checkr_invitation_id, status)
       VALUES ($1, $2, $3, 'invited')`,
      [userId, candidateRes.id, inviteRes.id]
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
    console.error('Background check error:', err.response?.data || err);
    res.status(500).json({ error: 'Failed to initiate background check.' });
  }
};

// Checkr webhook handler
exports.checkrWebhook = async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'report.completed') {
      const reportId = data.object.id;
      const candidateId = data.object.candidate_id;
      const result = data.object.adjudication || data.object.status;

      const { rows } = await db.query(
        'UPDATE background_checks SET checkr_report_id = $1, status = $2, result = $3, completed_at = NOW(), expires_at = NOW() + INTERVAL \'1 year\' WHERE checkr_candidate_id = $4 RETURNING user_id',
        [reportId, 'complete', result === 'clear' ? 'clear' : 'consider', candidateId]
      );

      if (rows.length) {
        const userId = rows[0].user_id;
        const passed = result === 'clear';

        await db.query(
        `UPDATE users SET background_check_status = $1, background_check_passed_at = NOW(),
           background_check_expiry = NOW() + INTERVAL '1 year' WHERE id = $2`,
          [passed ? 'passed' : 'failed', userId]
        );

        if (passed) {
          // Award verified badge
          await db.query(
            `INSERT INTO badges (user_id, type, label, expires_at)
             VALUES ($1, 'background_clear', 'Background Check Cleared', NOW() + INTERVAL '1 year')
             ON CONFLICT DO NOTHING`, [userId]
          );

          await sendPush(userId, {
            title: 'Background check passed!',
            body: 'Your Verified badge is now live on your profile.',
            link: '/dashboard/helper',
          });
        } else {
          await sendPush(userId, {
            title: 'Background check update',
            body: 'Action required on your account. Please check your email.',
            link: '/settings',
          });
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Checkr webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};

// Get background check status
exports.getBackgroundCheckStatus = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT status, result, completed_at, expires_at FROM background_checks
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.user.id]
    );
    res.json({ backgroundCheck: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch background check status.' });
  }
};

// === STRIPE IDENTITY VERIFICATION ===

// Create identity verification session
exports.createIdentitySession = async (req, res) => {
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
    console.error('Identity session error:', err);
    res.status(500).json({ error: 'Failed to create identity verification session.' });
  }
};

// Stripe Identity webhook handler
exports.identityWebhook = async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'identity.verification_session.verified') {
      const sessionId = data.object.id;
      const verifiedName = data.object.verified_outputs?.first_name + ' ' + data.object.verified_outputs?.last_name;

      await db.query(
        `UPDATE identity_verifications SET status = 'verified', verified_name = $1, updated_at = NOW()
         WHERE stripe_verification_session_id = $2`,
        [verifiedName, sessionId]
      );

      const { rows } = await db.query(
        'SELECT user_id FROM identity_verifications WHERE stripe_verification_session_id = $1', [sessionId]
      );
      if (rows.length) {
        await db.query(
          'UPDATE users SET identity_verified = TRUE WHERE id = $1', [rows[0].user_id]
        );
      }
    }

    if (type === 'identity.verification_session.requires_input') {
      const sessionId = data.object.id;
      const lastError = data.object.last_error?.reason || 'Verification requires additional input';
      await db.query(
        `UPDATE identity_verifications SET status = 'requires_input', last_error = $1, updated_at = NOW()
         WHERE stripe_verification_session_id = $2`,
        [lastError, sessionId]
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Identity webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};

// Get identity verification status
exports.getIdentityStatus = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT status, verified_name, last_error, created_at FROM identity_verifications
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.user.id]
    );
    res.json({ identity: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch identity status.' });
  }
};

// === BADGE SYSTEM ===

exports.getUserBadges = async (req, res) => {
  try {
    const userId = req.params.userId || req.user.id;
    const { rows } = await db.query(
      `SELECT type, label, earned_at, expires_at FROM badges
       WHERE user_id = $1 AND active = TRUE AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
    res.json({ badges: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch badges.' });
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
