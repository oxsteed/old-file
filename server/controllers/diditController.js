// server/controllers/diditController.js
// Handles Didit identity verification callbacks and deduplication.

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');

const DIDIT_API_URL = 'https://verification.didit.me/v3/session/';
const DEFAULT_DIDIT_WORKFLOW_ID = '3d74f89a-8a9a-4a0a-a401-1501baaf2b7d';
const { diditAllowUserSkip } = require('../utils/diditGate');

// ── Create a Didit session for a user ────────────────────
// Called by the frontend before launching the Didit SDK.
// Returns a session token and verification URL the SDK needs.
async function createSession(req, res) {
  try {
    const userId = req.user.id;

    // Guard: if Didit is not configured, tell the client so it can offer a skip
    // path instead of showing a generic 502 error.
    const apiKey = process.env.DIDIT_API_KEY;
    const workflowId = process.env.DIDIT_WORKFLOW_ID || DEFAULT_DIDIT_WORKFLOW_ID;
    const callbackUrl = process.env.DIDIT_CALLBACK_URL;

    if (!apiKey) {
      return res.status(503).json({
        error: 'verification_unavailable',
        message: 'Identity verification is not configured on this server.',
      });
    }

    // Call Didit API to create a verification session
    const diditResponse = await fetch(DIDIT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        workflow_id: workflowId,
        vendor_data: String(userId),
        ...(callbackUrl ? { callback: callbackUrl } : {}),
      }),
    });

    if (!diditResponse.ok) {
      const errBody = await diditResponse.text();
      logger.error('Didit API error:', { err: diditResponse.status, errBody });
      return res.status(502).json({ error: 'Failed to create Didit session' });
    }

    const diditData = await diditResponse.json();
    const sessionId = diditData.session_id;

    await pool.query(
      `UPDATE users SET didit_session_id = $1, didit_status = 'pending' WHERE id = $2`,
      [sessionId, userId]
    );

    return res.json({
      sessionId,
      sessionToken: diditData.session_token,
      verificationUrl: diditData.url,
      session_id: sessionId,
      session_token: diditData.session_token,
      verification_url: diditData.url,
    });

  } catch (err) {
    logger.error('Didit createSession error:', { err: err });
    return res.status(500).json({ error: 'Failed to create verification session' });
  }
}

// ── Didit webhook callback ───────────────────────────────
// Didit POSTs here when verification completes (or fails).
// This is the enforcement point for one-person-one-account.
async function handleWebhook(req, res) {
  try {
    const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET;
    if (!webhookSecret) {
      logger.error('DIDIT_WEBHOOK_SECRET is not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'];
    if (!signature) {
      return res.status(401).json({ error: 'Missing webhook signature' });
    }

    const rawBody = req.body; // Buffer from express.raw()
    const expectedSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const incomingBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== incomingBuf.length || !crypto.timingSafeEqual(expectedBuf, incomingBuf)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const {
      session_id,
      status,          // 'approved' | 'declined' | 'review'
      identity_hash,   // unique biometric/document fingerprint from Didit
    } = JSON.parse(rawBody.toString());

    if (!session_id) {
      return res.status(400).json({ error: 'Missing session_id' });
    }

    // Find the user with this session
    const { rows: [user] } = await pool.query(
      `SELECT id, didit_status FROM users WHERE didit_session_id = $1`,
      [session_id]
    );

    if (!user) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verification failed on Didit's side
    if (status !== 'approved') {
      await pool.query(
        `UPDATE users SET didit_status = 'failed' WHERE id = $1`,
        [user.id]
      );
      return res.json({ ok: true, status: 'failed' });
    }

    // ─── ONE PERSON, ONE ACCOUNT CHECK ───────────────────
    // If this identity_hash already exists on a different user,
    // this person already has an account.
    if (identity_hash) {
      const { rows: existing } = await pool.query(
        `SELECT id, email FROM users WHERE didit_identity_hash = $1 AND id != $2`,
        [identity_hash, user.id]
      );

      if (existing.length > 0) {
        await pool.query(
          `UPDATE users SET didit_status = 'duplicate' WHERE id = $1`,
          [user.id]
        );
        return res.json({
          ok: false,
          status: 'duplicate',
          error: 'This identity is already linked to an existing account. Please sign in instead.',
          existing_email_hint: maskEmail(existing[0].email),
        });
      }
    }

    // ─── VERIFICATION APPROVED, IDENTITY IS UNIQUE ───────
    await pool.query(
      `UPDATE users
       SET didit_identity_hash = $1,
           didit_status = 'verified',
           didit_verified_at = NOW(),
           is_verified = TRUE
       WHERE id = $2`,
      [identity_hash, user.id]
    );

    return res.json({ ok: true, status: 'verified' });

  } catch (err) {
    logger.error('Didit webhook error:', { err: err });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// ── Check verification status (polled by frontend) ───────
async function getStatus(req, res) {
  try {
    const userId = req.user.id;
    const { rows: [user] } = await pool.query(
      `SELECT didit_status, didit_verified_at, didit_session_id FROM users WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
            status: user.didit_status,
            hasSession: !!user.didit_session_id,
      verifiedAt: user.didit_verified_at,
    });

  } catch (err) {
    logger.error('Didit getStatus error:', { err: err });
    return res.status(500).json({ error: 'Failed to get verification status' });
  }
}

// ── Skip verification ────────────────────────────────────────────────────────
// Sets didit_status = 'skipped' when allowed (see DIDIT_ALLOW_USER_SKIP).
// Per-user didit_enforcement_required=true blocks skip (admin can clear or user must verify).
async function skipVerification(req, res) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT didit_enforcement_required, didit_status FROM users WHERE id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (row.didit_enforcement_required) {
      return res.status(403).json({
        error: 'Identity verification is required for your account and cannot be skipped.',
        code: 'DIDIT_ENFORCEMENT_ACTIVE',
      });
    }
    if (!diditAllowUserSkip()) {
      return res.status(403).json({
        error: 'Identity verification is required and cannot be skipped.',
        code: 'DIDIT_SKIP_DISABLED',
      });
    }

    await pool.query(
      `UPDATE users SET didit_status = 'skipped', updated_at = NOW() WHERE id = $1`,
      [userId]
    );
    return res.json({ ok: true, status: 'skipped' });
  } catch (err) {
    logger.error('Didit skipVerification error:', { err: err });
    return res.status(500).json({ error: 'Failed to skip verification' });
  }
}

// ── Helpers ──────────────────────────────────────────────
function maskEmail(email) {
  if (!email) return '***';
  const [local, domain] = email.split('@');
  return local.slice(0, 2) + '***@' + domain;
}

module.exports = { createSession, handleWebhook, getStatus, skipVerification };
