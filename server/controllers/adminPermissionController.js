'use strict';
const db = require('../db');
const { logAdminAction } = require('../services/auditService');

// ── Permission scopes catalogue ───────────────────────────────────────────────
const PERMISSION_SCOPES = {
  view_financials:       'View revenue, payouts, and financial data',
  export_data:           'Export platform data (users, jobs, revenue)',
  manage_settings:       'Update platform settings and feature flags',
  view_audit_log:        'View the full admin audit log',
  issue_refunds:         'Issue manual job refunds',
  verify_users:          'Mark users as identity-verified',
  delete_users:          'Hard-delete user accounts',
  delete_jobs:           'Hard-delete job posts',
  view_search_logs:      'View admin search audit log',
  manage_admin_accounts: 'Create and enable/disable admin accounts',
  message_users:         'Send direct admin-to-user messages',
};

const VALID_PERMISSIONS = Object.keys(PERMISSION_SCOPES);

// ── List active grants (super-admin sees all; admin sees their own) ───────────

exports.listGrants = async (req, res) => {
  try {
    const { grantee_id, include_expired } = req.query;

    const conditions = [];
    const params = [];

    if (!req.isSuper) {
      // Regular admins can only see their own grants
      params.push(req.user.id);
      conditions.push(`g.grantee_id = $${params.length}`);
    } else if (grantee_id) {
      params.push(grantee_id);
      conditions.push(`g.grantee_id = $${params.length}`);
    }

    if (!include_expired || include_expired === 'false') {
      conditions.push(`g.revoked_at IS NULL`);
      conditions.push(`g.expires_at > NOW()`);
    }

    const { rows } = await db.query(`
      SELECT
        g.id,
        g.permissions,
        g.expires_at,
        g.notes,
        g.created_at,
        g.revoked_at,
        grantor.first_name || ' ' || grantor.last_name AS grantor_name,
        grantor.email AS grantor_email,
        grantee.id AS grantee_id,
        grantee.first_name || ' ' || grantee.last_name AS grantee_name,
        grantee.email AS grantee_email,
        grantee.role AS grantee_role
      FROM admin_permission_grants g
      JOIN users grantor ON grantor.id = g.grantor_id
      JOIN users grantee ON grantee.id = g.grantee_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY g.created_at DESC
      LIMIT 200
    `, params);

    res.json({ grants: rows });
  } catch (err) {
    console.error('listGrants error:', err);
    res.status(500).json({ error: 'Failed to fetch grants.' });
  }
};

// ── Create a grant (super-admin only) ────────────────────────────────────────

exports.createGrant = async (req, res) => {
  try {
    const grantorId = req.user.id;
    const { grantee_id, permissions, expires_at, notes } = req.body;

    if (!grantee_id)           return res.status(400).json({ error: 'grantee_id is required.' });
    if (!permissions?.length)  return res.status(400).json({ error: 'At least one permission is required.' });
    if (!expires_at)           return res.status(400).json({ error: 'expires_at is required.' });

    // Validate permissions
    const invalid = permissions.filter(p => !VALID_PERMISSIONS.includes(p));
    if (invalid.length) {
      return res.status(400).json({
        error: `Unknown permission(s): ${invalid.join(', ')}. Valid: ${VALID_PERMISSIONS.join(', ')}`,
      });
    }

    // Validate expiry (must be in the future, max 1 year)
    const expiresAt = new Date(expires_at);
    const now = new Date();
    const oneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    if (isNaN(expiresAt.getTime()) || expiresAt <= now) {
      return res.status(400).json({ error: 'expires_at must be a future date/time.' });
    }
    if (expiresAt > oneYear) {
      return res.status(400).json({ error: 'Grant duration cannot exceed 1 year.' });
    }

    // Verify grantee is an admin (not super_admin, not regular user)
    const { rows: granteeRows } = await db.query(
      `SELECT id, role, first_name, last_name, email FROM users WHERE id = $1 AND is_active = true`,
      [grantee_id]
    );
    if (!granteeRows.length) {
      return res.status(404).json({ error: 'Admin user not found.' });
    }
    if (granteeRows[0].role !== 'admin') {
      return res.status(400).json({ error: 'Grants can only be issued to regular admins.' });
    }

    const { rows } = await db.query(`
      INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, expires_at, notes)
      VALUES ($1, $2, $3::jsonb, $4, $5)
      RETURNING *
    `, [grantorId, grantee_id, JSON.stringify(permissions), expiresAt, notes || null]);

    // Audit log
    await logAdminAction({
      adminId: req.user.id,
      action: 'permission_grant_create',
      targetType: 'admin_permission_grant',
      targetId: grantee_id,
      description: `Granted [${permissions.join(', ')}] to ${granteeRows[0].email} until ${expiresAt.toISOString()}`,
      after: { grant_id: rows[0].id, permissions, expires_at: expiresAt },
      req,
    });

    res.status(201).json({ grant: rows[0] });
  } catch (err) {
    console.error('createGrant error:', err);
    res.status(500).json({ error: 'Failed to create grant.' });
  }
};

// ── Revoke a grant (super-admin only) ────────────────────────────────────────

exports.revokeGrant = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: existing } = await db.query(
      `SELECT g.*, u.email AS grantee_email
       FROM admin_permission_grants g
       JOIN users u ON u.id = g.grantee_id
       WHERE g.id = $1`,
      [id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Grant not found.' });
    if (existing[0].revoked_at) return res.status(400).json({ error: 'Grant already revoked.' });

    await db.query(
      `UPDATE admin_permission_grants
       SET revoked_at = NOW(), revoked_by = $2
       WHERE id = $1`,
      [id, req.user.id]
    );

    await logAdminAction({
      adminId: req.user.id,
      action: 'permission_grant_revoke',
      targetType: 'admin_permission_grant',
      targetId: existing[0].grantee_id,
      description: `Revoked grant #${id} from ${existing[0].grantee_email}`,
      before: { permissions: existing[0].permissions, expires_at: existing[0].expires_at },
      req,
    });

    res.json({ message: 'Grant revoked.' });
  } catch (err) {
    console.error('revokeGrant error:', err);
    res.status(500).json({ error: 'Failed to revoke grant.' });
  }
};

// ── Get permission scopes catalogue ──────────────────────────────────────────

exports.getScopes = (req, res) => {
  const scopes = Object.entries(PERMISSION_SCOPES).map(([key, description]) => ({
    key,
    description,
  }));
  res.json({ scopes });
};

