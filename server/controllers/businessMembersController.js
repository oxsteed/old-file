// server/controllers/businessMembersController.js
// Manage representatives and managers for a helper's businesses.

const pool   = require('../db');
const logger = require('../utils/logger');

// ── ownership guard ───────────────────────────────────────────────────────────
async function ownedBusiness(userId, bizId) {
  const { rows } = await pool.query(
    'SELECT id, business_name FROM businesses WHERE id = $1 AND user_id = $2',
    [bizId, userId]
  );
  return rows[0] || null;
}

// ── GET /api/businesses/:id/members ──────────────────────────────────────────
// Owner lists all members (active + pending) for their business.
async function listMembers(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { rows } = await pool.query(
      `SELECT
         bm.id,
         bm.role,
         bm.status,
         bm.invite_email,
         bm.invited_at,
         bm.accepted_at,
         u.id          AS user_id,
         u.first_name,
         u.last_name,
         u.email       AS member_email,
         u.profile_photo_url
       FROM business_members bm
       LEFT JOIN users u ON u.id = bm.member_id
       WHERE bm.business_id = $1
         AND bm.owner_id    = $2
         AND bm.status != 'revoked'
       ORDER BY bm.status, bm.invited_at`,
      [biz.id, req.user.id]
    );

    return res.json({ members: rows });
  } catch (err) {
    logger.error('listMembers error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load members' });
  }
}

// ── POST /api/businesses/:id/members ─────────────────────────────────────────
// Owner invites a user by email + role.
async function inviteMember(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { email, role } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Email is required' });
    if (!['manager', 'representative'].includes(role)) {
      return res.status(400).json({ error: 'Role must be manager or representative' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Can't invite yourself
    if (normalizedEmail === req.user.email?.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot invite yourself' });
    }

    // Look up the invitee
    const userRes = await pool.query(
      `SELECT id, first_name, last_name, email
         FROM users WHERE LOWER(email) = $1 AND is_active = TRUE`,
      [normalizedEmail]
    );
    const invitee = userRes.rows[0] || null;

    // Insert — partial unique index prevents duplicate pending invites
    const { rows: [record] } = await pool.query(
      `INSERT INTO business_members
         (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [biz.id, req.user.id, invitee?.id || null, role, normalizedEmail]
    );

    // Send an in-app notification if the invitee already has an account
    if (invitee) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, message, metadata)
         VALUES ($1, 'business_invite', $2, $3, $4)`,
        [
          invitee.id,
          `Business invitation from ${req.user.first_name || 'someone'}`,
          `You have been invited to join "${biz.business_name}" as a ${role}.`,
          JSON.stringify({ invite_id: record.id, business_id: biz.id, business_name: biz.business_name, role }),
        ]
      );
    }

    return res.status(201).json({ member: record, user_found: !!invitee });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An invite for this email is already pending' });
    }
    logger.error('inviteMember error', { err: err.message });
    return res.status(500).json({ error: 'Failed to send invite' });
  }
}

// ── DELETE /api/businesses/:id/members/:memberId ──────────────────────────────
// Owner revokes a member's access (sets status = 'revoked').
async function revokeMember(req, res) {
  try {
    const biz = await ownedBusiness(req.user.id, req.params.id);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { rowCount } = await pool.query(
      `UPDATE business_members
       SET status = 'revoked'
       WHERE id          = $1
         AND business_id = $2
         AND owner_id    = $3
         AND status != 'revoked'`,
      [req.params.memberId, biz.id, req.user.id]
    );

    if (!rowCount) return res.status(404).json({ error: 'Member not found' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('revokeMember error', { err: err.message });
    return res.status(500).json({ error: 'Failed to revoke member' });
  }
}

// ── GET /api/businesses/invitations ──────────────────────────────────────────
// Returns pending invitations addressed to the logged-in user.
async function listMyInvitations(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT
         bm.id,
         bm.role,
         bm.status,
         bm.invited_at,
         b.id            AS business_id,
         b.business_name,
         b.description   AS business_description,
         b.logo_url,
         u.first_name    AS owner_first_name,
         u.last_name     AS owner_last_name,
         u.profile_photo_url AS owner_photo
       FROM business_members bm
       JOIN businesses b ON b.id = bm.business_id
       JOIN users u      ON u.id = bm.owner_id
       WHERE bm.member_id = $1
         AND bm.status    = 'pending'
       ORDER BY bm.invited_at DESC`,
      [req.user.id]
    );

    return res.json({ invitations: rows });
  } catch (err) {
    logger.error('listMyInvitations error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load invitations' });
  }
}

// ── POST /api/businesses/invitations/:id/accept ───────────────────────────────
async function acceptInvitation(req, res) {
  try {
    const { rows: [record] } = await pool.query(
      `UPDATE business_members
       SET status      = 'active',
           member_id   = $1,
           accepted_at = NOW()
       WHERE id        = $2
         AND (member_id = $1 OR invite_email = $3)
         AND status    = 'pending'
       RETURNING *`,
      [req.user.id, req.params.id, req.user.email?.toLowerCase()]
    );

    if (!record) return res.status(404).json({ error: 'Invitation not found or already handled' });
    return res.json({ ok: true, member: record });
  } catch (err) {
    logger.error('acceptInvitation error', { err: err.message });
    return res.status(500).json({ error: 'Failed to accept invitation' });
  }
}

// ── POST /api/businesses/invitations/:id/decline ──────────────────────────────
async function declineInvitation(req, res) {
  try {
    const { rows: [record] } = await pool.query(
      `UPDATE business_members
       SET status = 'revoked'
       WHERE id       = $1
         AND (member_id = $2 OR invite_email = $3)
         AND status   = 'pending'
       RETURNING id`,
      [req.params.id, req.user.id, req.user.email?.toLowerCase()]
    );

    if (!record) return res.status(404).json({ error: 'Invitation not found or already handled' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('declineInvitation error', { err: err.message });
    return res.status(500).json({ error: 'Failed to decline invitation' });
  }
}

// ── GET /api/businesses/managed ──────────────────────────────────────────────
// Returns businesses the logged-in user is an active member of (but does NOT own).
// Used in the Business Hub so representatives see businesses they manage.
async function listManagedBusinesses(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT
         b.id, b.business_name, b.business_type, b.description,
         b.website, b.phone, b.logo_url, b.is_active,
         bm.role,
         bm.accepted_at,
         u.first_name AS owner_first_name,
         u.last_name  AS owner_last_name
       FROM business_members bm
       JOIN businesses b ON b.id = bm.business_id
       JOIN users u      ON u.id = bm.owner_id
       WHERE bm.member_id = $1
         AND bm.status    = 'active'
       ORDER BY bm.accepted_at DESC`,
      [req.user.id]
    );

    return res.json({ businesses: rows });
  } catch (err) {
    logger.error('listManagedBusinesses error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load managed businesses' });
  }
}

module.exports = {
  listMembers,
  inviteMember,
  revokeMember,
  listMyInvitations,
  acceptInvitation,
  declineInvitation,
  listManagedBusinesses,
};
