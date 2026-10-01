'use strict';

/**
 * server/middleware/connectorAuth.js
 *
 * Authentication for the OxSteed connector API (server/routes/connector.js).
 *
 * Runs the standard API-key validator, then resolves the key holder from
 * users by the key's customer_id and requires an active admin or super_admin
 * account. The connector surface is admin-scoped: non-admin key holders get
 * 403 even with a valid key.
 *
 * 2FA hard-block (H4): matches the interactive admin hard-block. An admin
 * key holder without totp_enabled is rejected with code
 * connector_2fa_required and told to enroll 2FA and reissue the key. This
 * applies to existing keys too: a key whose holder never enrolled 2FA stops
 * working (grandfathered keys are rejected, never silently allowed).
 *
 * Attaches req.connectorUser = { id, role, email }.
 */

const db = require('../db');
const logger = require('../utils/logger');
const { validateApiKey } = require('./apiKeyValidator');

const CONNECTOR_ROLES = new Set(['admin', 'super_admin']);

async function loadConnectorUser(req, res, next) {
  try {
    const customerId = req.apiKey && req.apiKey.customerId;
    if (!customerId) {
      return res.status(403).json({
        error: 'Connector access requires an API key bound to a user account.',
        code: 'connector_forbidden',
      });
    }
    const { rows } = await db.query(
      `SELECT id, role, email, is_active, COALESCE(totp_enabled, FALSE) AS totp_enabled
         FROM users WHERE id = $1`,
      [customerId]
    );
    const user = rows[0];
    if (!user || !user.is_active || !CONNECTOR_ROLES.has(user.role)) {
      return res.status(403).json({
        error: 'Connector access requires an active admin account.',
        code: 'connector_forbidden',
      });
    }
    // 2FA hard-block: the connector is an admin surface, so an admin key
    // holder without enrolled 2FA is rejected exactly like the interactive
    // admin login (admin_2fa_required). Existing keys whose holder never
    // enrolled 2FA stop working; re-enroll and reissue.
    if (!user.totp_enabled) {
      return res.status(403).json({
        error: 'Two-factor authentication is required for connector API access. Enroll 2FA at /admin/2fa-setup, then generate a new API key.',
        code: 'connector_2fa_required',
        redirect: '/admin/2fa-setup',
      });
    }
    req.connectorUser = { id: user.id, role: user.role, email: user.email };
    return next();
  } catch (error) {
    logger.error('connectorAuth user lookup failed', { error: error.message });
    return res.status(500).json({ error: 'Connector authentication failed.' });
  }
}

function connectorAuth(req, res, next) {
  validateApiKey(req, res, (err) => {
    if (err) return next(err);
    // validateApiKey responds directly (401/429/500) without calling next()
    // when the key is rejected; only a validated key reaches this point.
    if (res.headersSent || !req.apiKey) return;
    loadConnectorUser(req, res, next).catch(next);
  });
}

/**
 * Per-endpoint grant checks for the connector API (H4).
 *
 * Mirrors the permission-grant semantics of the interactive admin routes
 * (adminAuth.requirePermission, globalOnly = true): super_admins pass
 * unconditionally; regular admins must hold an active (non-expired,
 * non-revoked) global grant whose permissions include the requested scope.
 * Regional grants must not authorize global connector actions, exactly as
 * for the UI equivalents.
 *
 * Usage: router.post('/x', requireConnectorGrant('manage_operations'), ctrl)
 */
function requireConnectorGrant(permission) {
  return async (req, res, next) => {
    const connectorUser = req.connectorUser;
    if (!connectorUser) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (connectorUser.role === 'super_admin') return next();

    try {
      const { rows } = await db.query(
        `SELECT id, region_id FROM admin_permission_grants
          WHERE grantee_id = $1
            AND permissions ? $2
            AND expires_at  > NOW()
            AND revoked_at IS NULL
          ORDER BY (region_id IS NULL) DESC
          LIMIT 1`,
        [connectorUser.id, permission]
      );
      const grant = rows.find((row) => row.region_id == null);
      if (grant) return next();

      if (rows.length) {
        return res.status(403).json({
          error: `Permission '${permission}' is limited to a region and cannot authorize this global connector action.`,
          code: 'global_permission_required',
          required: permission,
        });
      }
      return res.status(403).json({
        error: `Permission '${permission}' required. Contact a super-admin to request access.`,
        code: 'connector_grant_required',
        required: permission,
      });
    } catch (error) {
      logger.error('Connector permission check failed', {
        adminId: connectorUser.id,
        permission,
        error: error.message,
      });
      return res.status(500).json({ error: 'Permission check failed.' });
    }
  };
}

module.exports = connectorAuth;
module.exports.connectorAuth = connectorAuth;
module.exports.loadConnectorUser = loadConnectorUser;
module.exports.requireConnectorGrant = requireConnectorGrant;
