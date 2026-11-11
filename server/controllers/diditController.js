const { withTransaction } = require('../utils/transaction');
const { encrypt, decrypt } = require('../utils/encryption');
const { AppError } = require('../middleware/errorHandler');
// server/controllers/diditController.js
// Didit identity verification: session creation, status and skip.

const pool = require('../db');
const logger = require('../utils/logger');

const DIDIT_API_URL = 'https://verification.didit.me/v3/session/';
const DEFAULT_DIDIT_WORKFLOW_ID = '3d74f89a-8a9a-4a0a-a401-1501baaf2b7d';
const { diditAllowUserSkip, isDiditIdentitySatisfied } = require('../utils/diditGate');

// ── Create a Didit session for a user ────────────────────
// Called by the frontend before launching the Didit SDK.
// Returns a session token and verification URL the SDK needs.
//
// Cost audit 2026-11-04 item 9: two changes. (1) The provider call runs
// OUTSIDE any row-lock transaction: the old code held the users row lock
// across a network call to Didit, stalling every concurrent verification
// read for that user. Now a short locked transaction only reads state,
// the provider call runs lock-free, and a second short locked transaction
// stores the result. (2) Fresh mints are capped per user per rolling 24h
// (DIDIT_DAILY_MINT_CAP, default 10); reuses never count, because only a
// stored fresh mint inserts a didit_session_mints row. The store phase
// re-checks verified/reuse/cap under the lock, so a concurrent mint
// cannot double-store or bust the cap; the loser reuses the winner's
// session and its own provider session is simply never stored.
const DIDIT_DAILY_MINT_CAP = () => {
  const raw = Number.parseInt(process.env.DIDIT_DAILY_MINT_CAP, 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 10;
};
const DIDIT_TERMINAL_STATUSES = ['failed', 'declined', 'expired', 'abandoned', 'canceled', 'cancelled', 'duplicate', 'skipped'];
function diditAlreadyVerified(existing) {
  return Boolean(existing && (existing.identity_verified || existing.id_verified || isDiditIdentitySatisfied({
    didit_status: existing.didit_status,
    didit_verified_at: existing.didit_verified_at,
    didit_enforcement_required: true,
  })));
}

function requireDiditPayload(data) {
  const sessionId = typeof data?.session_id === 'string' ? data.session_id.trim() : '';
  const sessionToken = typeof data?.session_token === 'string' ? data.session_token.trim() : '';
  const verificationUrl = typeof data?.url === 'string' ? data.url.trim() : '';
  if (!sessionId || !sessionToken || !/^https:\/\//i.test(verificationUrl)) {
    throw new AppError('Identity verification is temporarily unavailable', 503, 'didit_session_unavailable');
  }
  return { sessionId, sessionToken, verificationUrl };
}
// Reuse an open session only when its saved payload (URL/token) is
// present. Sessions created before migration 99988, or whose payload
// was cleared (e.g. a skipped status), have no URL to hand back; reusing
// them returned an empty session the client could never open, so a
// fresh session is created instead.
function diditReusablePayload(existing) {
  if (!existing?.didit_session_id || !existing.didit_session_payload_ciphertext
    || DIDIT_TERMINAL_STATUSES.includes(String(existing.didit_status).toLowerCase())) return null;
  try {
    const saved = JSON.parse(decrypt(existing.didit_session_payload_ciphertext));
    return (saved && (saved.verificationUrl || saved.verification_url)) ? saved : null;
  } catch {
    return null;
  }
}
function diditReuseBody(existing, saved) {
  return { ...saved, sessionId: existing.didit_session_id, session_id: existing.didit_session_id, reused: true, status: existing.didit_status };
}
async function diditMintsToday(client, userId) {
  const { rows } = await client.query(
    `SELECT COUNT(*) AS count FROM didit_session_mints WHERE user_id = $1 AND minted_at >= now() - INTERVAL '24 hours'`,
    [userId]
  );
  return Number(rows[0]?.count ?? 0);
}
async function createSession(req, res) {
  try {
    const userId = req.user.id;
    // Phase 1: short locked read. Decides verified / reuse / cap, then
    // releases the lock before any network call.
    const phase1 = await withTransaction(pool, async (client) => {
      const { rows: existingRows } = await client.query(
        `SELECT didit_status, didit_verified_at, didit_session_id, didit_session_payload_ciphertext, identity_verified, id_verified
           FROM users WHERE id = $1 FOR UPDATE`, [userId]
      );
      const existing = existingRows[0];
      if (diditAlreadyVerified(existing)) {
        return { statusCode: 409, body: {
          error: 'identity_already_verified',
          message: 'Identity verification is already approved. A new session is not required.',
          status: 'verified',
        } };
      }
      const saved = diditReusablePayload(existing);
      if (saved) return { statusCode: 200, body: diditReuseBody(existing, saved) };
      if ((await diditMintsToday(client, userId)) >= DIDIT_DAILY_MINT_CAP()) {
        return { statusCode: 429, body: {
          error: 'didit_daily_mint_cap',
          message: 'Too many new verification sessions created today. Reuse the pending session or try again tomorrow.',
        } };
      }
      return { mint: true };
    }, 'didit_session_create');
    if (!phase1.mint) return res.status(phase1.statusCode).json(phase1.body);

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

    // Provider call: no row lock held.
    const diditResponse = await fetch(DIDIT_API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
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
      logger.error('Didit API error:', { status: diditResponse.status });
      return res.status(502).json({ error: 'Failed to create Didit session' });
    }
    const diditData = await diditResponse.json();
    const { sessionId, sessionToken, verificationUrl } = requireDiditPayload(diditData);

    // Phase 2: store under the row lock, re-checking everything a
    // concurrent mint may have changed while the provider call ran.
    const result = await withTransaction(pool, async (client) => {
      const { rows: existingRows } = await client.query(
        `SELECT didit_status, didit_verified_at, didit_session_id, didit_session_payload_ciphertext, identity_verified, id_verified
           FROM users WHERE id = $1 FOR UPDATE`, [userId]
      );
      const existing = existingRows[0];
      if (diditAlreadyVerified(existing)) {
        return { statusCode: 409, body: {
          error: 'identity_already_verified',
          message: 'Identity verification is already approved. A new session is not required.',
          status: 'verified',
        } };
      }
      const saved = diditReusablePayload(existing);
      if (saved) return { statusCode: 200, body: diditReuseBody(existing, saved) };
      if ((await diditMintsToday(client, userId)) >= DIDIT_DAILY_MINT_CAP()) {
        return { statusCode: 429, body: {
          error: 'didit_daily_mint_cap',
          message: 'Too many new verification sessions created today. Reuse the pending session or try again tomorrow.',
        } };
      }
      await client.query(
        `UPDATE users SET didit_session_id = $1, didit_status = 'pending', didit_session_payload_ciphertext=$3 WHERE id = $2`,
        [sessionId, userId, encrypt(JSON.stringify({ verificationUrl, verification_url: verificationUrl, sessionToken, session_token: sessionToken }))]
      );
      await client.query(`INSERT INTO didit_session_mints(user_id, session_id) VALUES ($1, $2)`, [userId, sessionId]);
      return { statusCode: 200, body: {
        sessionId,
        sessionToken,
        verificationUrl,
        session_id: sessionId,
        session_token: sessionToken,
        verification_url: verificationUrl,
      } };
    }, 'didit_session_store');
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    logger.error('Didit createSession error:', { err: err });
    if (err instanceof AppError && err.code === 'didit_session_unavailable') {
      return res.status(503).json({ error: 'verification_unavailable', code: err.code });
    }
    return res.status(500).json({ error: 'Failed to create verification session' });
  }
}

// ── Didit webhook callback ───────────────────────────────
// F-09: the legacy unmounted handleWebhook (plain HMAC, no timestamp window,
// no event dedupe) was removed. The only Didit webhook handler is
// webhookController.diditWebhook, mounted at /api/webhooks/didit and the
// /api/didit/webhook alias.

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
// Email-unverified accounts may not skip: verify the email first, then skip
// like any verified account. Without this, an unverified account could set
// 'skipped' and the API gate would treat it as identity-satisfied.
async function skipVerification(req, res) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT didit_enforcement_required, didit_status, email_verified FROM users WHERE id = $1`,
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
    if (!row.email_verified) {
      return res.status(403).json({
        error: 'Verify your email address before choosing to skip identity verification.',
        code: 'DIDIT_EMAIL_UNVERIFIED',
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

module.exports = { createSession, getStatus, skipVerification, requireDiditPayload };
