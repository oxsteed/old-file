// server/controllers/diditController.js
// Handles Didit identity verification callbacks and deduplication.

const pool = require('../db');

// ── Create a Didit session for a user ────────────────────
// Called by the frontend before launching the Didit SDK.
// Returns a session token the SDK needs to initialize.
async function createSession(req, res) {
  try {
    const userId = req.user.id;

    // TODO: Call Didit API to create a verification session
    // const diditResponse = await diditAPI.createSession({ userId, ... });
    // const sessionId = diditResponse.session_id;

    // Placeholder until Didit SDK is integrated:
    const sessionId = `didit_${userId}_${Date.now()}`;

    await pool.query(
      `UPDATE users SET didit_session_id = $1, didit_status = 'pending' WHERE id = $2`,
      [sessionId, userId]
    );

    return res.json({ sessionId });
  } catch (err) {
    console.error('Didit createSession error:', err);
    return res.status(500).json({ error: 'Failed to create verification session' });
  }
}

// ── Didit webhook callback ───────────────────────────────
// Didit POSTs here when verification completes (or fails).
// This is the enforcement point for one-person-one-account.
async function handleWebhook(req, res) {
  try {
    const {
      session_id,
      status,           // 'approved' | 'declined' | 'review'
      identity_hash,    // unique biometric/document fingerprint from Didit
    } = req.body;

    // TODO: Verify webhook signature from Didit
    // if (!verifyDiditSignature(req)) return res.status(401).json({ error: 'Invalid signature' });

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
    console.error('Didit webhook error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// ── Check verification status (polled by frontend) ───────
async function getStatus(req, res) {
  try {
    const userId = req.user.id;
    const { rows: [user] } = await pool.query(
      `SELECT didit_status, didit_verified_at FROM users WHERE id = $1`,
      [userId]
    );

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      status: user.didit_status,            // 'pending' | 'verified' | 'failed' | 'duplicate'
      verified_at: user.didit_verified_at,
      is_verified: user.didit_status === 'verified',
    });
  } catch (err) {
    console.error('Didit getStatus error:', err);
    return res.status(500).json({ error: 'Failed to check status' });
  }
}

// ── Helper: mask email for duplicate hint ────────────────
function maskEmail(email) {
  if (!email) return '***';
  const [local, domain] = email.split('@');
  return local.slice(0, 2) + '***@' + domain;
}

module.exports = { createSession, handleWebhook, getStatus };
