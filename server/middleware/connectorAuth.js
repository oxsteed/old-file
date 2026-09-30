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
      'SELECT id, role, email, is_active FROM users WHERE id = $1',
      [customerId]
    );
    const user = rows[0];
    if (!user || !user.is_active || !CONNECTOR_ROLES.has(user.role)) {
      return res.status(403).json({
        error: 'Connector access requires an active admin account.',
        code: 'connector_forbidden',
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

module.exports = connectorAuth;
module.exports.connectorAuth = connectorAuth;
