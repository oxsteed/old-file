// server/controllers/vortexController.js
// Vortex token system: helpers generate single-use 64-char tokens so
// representatives can self-onboard to a business without email invite.

const crypto = require('crypto');
const pool   = require('../db');
const logger = require('../utils/logger');

// ── ownership guard ───────────────────────────────────────────────────────────
async function ownedBusiness(userId, bizId) {
  const { rows } = await pool.query(
    'SELECT id, business_name, user_id FROM businesses WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
    [bizId, userId]
  );
  return rows[0] || null;
}

// ── ownership OR manager guard ───────────────────────────────────────────────
// Returns the business row; b.user_id is always the real business owner.
async function ownedOrManagedBusiness(userId, bizId) {
  const owned = await ownedBusiness(userId, bizId);
  if (owned) return owned;
  const { rows } = await pool.query(
    `SELECT b.id, b.business_name, b.user_id FROM businesses b
     JOIN business_members bm ON bm.business_id = b.id
     WHERE b.id = $1 AND b.is_active = TRUE
       AND bm.member_id = $2 AND bm.role = 'manager' AND bm.status = 'active'`,
    [bizId, userId]
  );
  return rows[0] || null;
}

// ── helper: check if user is business rep/manager ─────────────────────────────
async function isBusinessMember(userId, bizId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM business_members WHERE business_id = $1 AND member_id = $2 AND status = $3',
    [bizId, userId, 'active']
  );
  return rows.length > 0;
}

// ── POST /api/businesses/:id/vortex-tokens ────────────────────────────────────
// Owner or manager generates a new single-use Vortex token.
// Privilege restriction: only the real business owner may issue manager-role
// tokens. A manager is silently capped to 'representative' regardless of the
// role value they supply — preventing privilege self-replication.
async function generateToken(req, res) {
  try {
    const biz = await ownedOrManagedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const isOwner = biz.user_id === req.user.id;

    const { role: requestedRole = 'representative', expires_in = '7d' } = req.body;

    if (!['manager', 'representative'].includes(requestedRole)) {
      return res.status(400).json({ error: 'Role must be manager or representative' });
    }

    // Managers may only issue representative-level tokens.
    // If a manager passes role:'manager', cap it to 'representative'.
    const role = (!isOwner && requestedRole === 'manager') ? 'representative' : requestedRole;

    const EXPIRY_MAP = { '24h': 24, '7d': 168, '30d': 720, '60d': 1440 };
    const hours = EXPIRY_MAP[expires_in];
    if (!hours) {
      return res.status(400).json({ error: 'expires_in must be 24h, 7d, 30d, or 60d' });
    }
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const token = crypto.randomBytes(32).toString('hex'); // 64-char hex

    // owner_id      = real business owner (biz.user_id) — for redemption guard & notifications
    // created_by_id = actual requester (may be a manager) — for listTokens visibility
    const { rows: [record] } = await pool.query(
      `INSERT INTO business_invite_tokens
         (business_id, owner_id, created_by_id, token, role, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, token, role, expires_at, created_at, created_by_id`,
      [biz.id, biz.user_id, req.user.id, token, role, expiresAt]
    );

    return res.status(201).json({ token: record });
  } catch (err) {
    logger.error('generateToken error', { err: err.message });
    return res.status(500).json({ error: 'Failed to generate token' });
  }
}

// ── GET /api/businesses/:id/vortex-tokens ─────────────────────────────────────
// Owner or manager lists tokens for a business.
//
// Token-string visibility rules for ACTIVE tokens:
//   • Owner   → sees all plaintext token strings
//   • Manager → sees only the token string for active tokens they created
//               (created_by_id = req.user.id); other active tokens listed
//               but the secret column is NULL
//
// Used / revoked / expired tokens are always fully visible (they are inert).
async function listTokens(req, res) {
  try {
    const biz = await ownedOrManagedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const isOwner = biz.user_id === req.user.id;

    const { rows } = await pool.query(
      `SELECT
         t.id,
         CASE
           WHEN t.used_at IS NOT NULL OR t.is_revoked OR t.expires_at < NOW() THEN t.token
           WHEN $3                                                              THEN t.token
           WHEN t.created_by_id = $2                                           THEN t.token
           ELSE NULL
         END AS token,
         t.role,
         t.expires_at,
         t.used_at,
         t.is_revoked,
         t.created_at,
         t.created_by_id,
         creator.first_name AS created_by_first,
         creator.last_name  AS created_by_last,
         u.first_name AS used_by_first,
         u.last_name  AS used_by_last,
         u.email      AS used_by_email,
         CASE
           WHEN t.is_revoked         THEN 'revoked'
           WHEN t.used_at IS NOT NULL THEN 'used'
           WHEN t.expires_at < NOW()  THEN 'expired'
           ELSE                            'active'
         END AS status
       FROM business_invite_tokens t
       LEFT JOIN users u       ON u.id = t.used_by_id
       LEFT JOIN users creator ON creator.id = t.created_by_id
       WHERE t.business_id = $1
       ORDER BY t.created_at DESC`,
      [biz.id, req.user.id, isOwner]
    );

    return res.json({ tokens: rows });
  } catch (err) {
    logger.error('listTokens error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load tokens' });
  }
}

// ── DELETE /api/businesses/:id/vortex-tokens/:tokenId ─────────────────────────
// Owner or manager revokes a token before it has been used.
async function revokeToken(req, res) {
  try {
    const biz = await ownedOrManagedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { rowCount } = await pool.query(
      `UPDATE business_invite_tokens
       SET is_revoked = TRUE
       WHERE id          = $1
         AND business_id = $2
         AND used_at IS NULL
         AND is_revoked  = FALSE`,
      [req.params.tokenId, biz.id]
    );

    if (!rowCount) return res.status(404).json({ error: 'Token not found or already used/revoked' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('revokeToken error', { err: err.message });
    return res.status(500).json({ error: 'Failed to revoke token' });
  }
}

// ── POST /api/businesses/vortex/redeem ────────────────────────────────────────
// Any authenticated user enters a 64-char token to join a business as a rep.
// Token is single-use: marked used_at + used_by_id immediately on success.
async function redeemToken(req, res) {
  const client = await pool.connect();
  try {
    const { token } = req.body;
    if (!token || token.length !== 64) {
      return res.status(400).json({ error: 'Invalid token format — must be exactly 64 characters' });
    }

    const { rows: [record] } = await client.query(
      `SELECT t.id, t.business_id, t.owner_id, t.role, t.expires_at,
              b.business_name, b.is_active
       FROM business_invite_tokens t
       JOIN businesses b ON b.id = t.business_id
       WHERE t.token       = $1
         AND t.used_at    IS NULL
         AND t.is_revoked  = FALSE
       LIMIT 1`,
      [token.trim()]
    );

    if (!record) {
      return res.status(400).json({ error: 'Token is invalid, already used, or has been revoked' });
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Token has expired — ask the business owner for a new one' });
    }

    if (!record.is_active) {
      return res.status(400).json({ error: 'This business is no longer active' });
    }

    if (record.owner_id === req.user.id) {
      return res.status(400).json({ error: 'You cannot redeem your own token' });
    }

    const alreadyMember = await isBusinessMember(req.user.id, record.business_id);
    if (alreadyMember) {
      return res.status(409).json({ error: `You are already an active member of "${record.business_name}"` });
    }

    // ── Begin atomic transaction ──────────────────────────────────────────────
    await client.query('BEGIN');

    // 1. Mark the token consumed (prevents concurrent redemption)
    const { rowCount } = await client.query(
      `UPDATE business_invite_tokens
       SET used_at = NOW(), used_by_id = $1
       WHERE id = $2 AND used_at IS NULL AND is_revoked = FALSE`,
      [req.user.id, record.id]
    );

    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Token was just used by someone else' });
    }

    // 2. DELETE stale pending invite BEFORE inserting the active membership.
    //    If a pending row exists for the same (business_id, invite_email) unique
    //    constraint, the INSERT below would silently do nothing (ON CONFLICT DO
    //    NOTHING), and a subsequent DELETE would remove the only row — leaving
    //    the user with no membership while the token is already consumed.
    if (req.user.email) {
      await client.query(
        `DELETE FROM business_members
         WHERE business_id = $1
           AND LOWER(invite_email) = LOWER($2)
           AND status = 'pending'`,
        [record.business_id, req.user.email]
      );
    }

    // 3. Insert the active membership — pending row is already gone so the
    //    unique constraint will not block this insert.
    await client.query(
      `INSERT INTO business_members
         (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW())
       ON CONFLICT DO NOTHING`,
      [record.business_id, record.owner_id, req.user.id, record.role, req.user.email || '']
    );

    // 4. Notify the business owner
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, metadata)
       VALUES ($1, 'vortex_redeemed', $2, $3, $4)`,
      [
        record.owner_id,
        `${req.user.first_name || 'Someone'} joined "${record.business_name}"`,
        `${req.user.first_name || 'A new member'} ${req.user.last_name || ''} has joined "${record.business_name}" as a ${record.role} via Vortex.`,
        JSON.stringify({
          business_id: record.business_id,
          business_name: record.business_name,
          member_id: req.user.id,
          role: record.role,
        }),
      ]
    );

    await client.query('COMMIT');
    // ── End transaction ───────────────────────────────────────────────────────

    return res.json({
      ok: true,
      business_id: record.business_id,
      business_name: record.business_name,
      role: record.role,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('redeemToken error', { err: err.message });
    return res.status(500).json({ error: 'Failed to redeem token' });
  } finally {
    client.release();
  }
}

module.exports = { generateToken, listTokens, revokeToken, redeemToken };
