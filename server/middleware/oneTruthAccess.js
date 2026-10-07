'use strict';

/**
 * One Truth P1 (item 11 + 12.2): purpose-trail gate for every One Truth
 * read (list, stats, suspects, detail).
 *
 * Use after requireAdmin (which sets req.user / req.isSuper):
 *
 *   - Super-admins pass by role. Their reads are still audit-logged with
 *     the super_admin_duty purpose.
 *   - Delegated trust/fraud analysts (role 'admin') must hold at least one
 *     active, unexpired, unrevoked investigation grant (scope
 *     'user_investigation' or 'fraud_analyst'). Their reads are scoped to
 *     the union of the grants' scope_user_ids (fail closed: no rows outside
 *     the granted ids are ever returned) and audit-logged per read with
 *     purpose + approver + expiry.
 *   - Admins with no active grant get 403 'investigation_access_required';
 *     the UI turns that code into a "request investigation access" action.
 */

const logger = require('../utils/logger');
const { listActiveGrants, GRANT_SCOPES } = require('../services/investigationAccessService');

async function requireOneTruthGrant(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (req.isSuper) {
      req.oneTruthGrants = [];
      req.oneTruthScopeIds = null; // null = unscoped (super-admin duty)
      return next();
    }
    const grants = await listActiveGrants(req.user.id, { scopes: GRANT_SCOPES });
    if (!grants.length) {
      return res.status(403).json({
        error: 'Investigation access required: request a purpose-limited grant approved by an authorized approver.',
        code: 'investigation_access_required',
      });
    }
    req.oneTruthGrants = grants;
    req.oneTruthScopeIds = [...new Set(grants.flatMap((g) => g.scope_user_ids || []))];
    return next();
  } catch (err) {
    logger.error('oneTruth grant check failed', { adminId: req.user?.id, error: err.message });
    return res.status(500).json({ error: 'Investigation access check failed.' });
  }
}

module.exports = { requireOneTruthGrant };
