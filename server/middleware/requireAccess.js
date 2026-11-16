'use strict';

/**
 * Progressive access capability gate for provider writes (WP-026, WP-028).
 *
 *   requireHelperCapability   helper.offer_services on bid/quote writes
 *
 * Behaviour follows ACCESS_HELPER_ENFORCEMENT:
 *   off      no-op (legacy role checks decide, exactly as before)
 *   shadow   evaluate the capability and log any disagreement with the
 *            legacy role decision (`access.shadow_mismatch`), never block
 *   enforce  the capability decides: no effective grant → 403
 *            `access_required`; an effective grant satisfies the downstream
 *            legacy role checks through `req.accessCapabilities` (so a
 *            Credit customer, whose users.role must stay `customer`, can
 *            still be an approved helper).
 *
 * Admins bypass (unchanged legacy behaviour). The decision is re-read from
 * the database on every request; nothing is cached in the token.
 */

const flags = require('../services/access/flags');
const logger = require('../utils/logger');

const LEGACY_HELPER_ROLES = ['helper', 'helper_pro', 'broker'];

function hasCapability(req, capability) {
  return !!(req && req.accessCapabilities && req.accessCapabilities[capability] === true);
}

/** Legacy role check widened by an enforced capability decision. */
function isHelperActor(req) {
  if (!req || !req.user) return false;
  if (hasCapability(req, 'helper.offer_services')) return true;
  if (flags.helperEnforcement() === 'enforce') return false;
  return LEGACY_HELPER_ROLES.includes(req.user.role);
}

function requireCapability(capability, { modeFn, audienceLoader = null, legacyAllowedFn = null } = {}) {
  return async function accessCapabilityGate(req, res, next) {
    const mode = modeFn();
    if (mode === 'off' || !req.user) return next();
    if (['admin', 'super_admin'].includes(req.user.role)) return next();
    let decision;
    try {
      const access = require('../services/access/accessService');
      decision = await access.can(req.user.id, capability);
    } catch (err) {
      if (mode === 'shadow') {
        logger.warn('access.shadow_error', { capability, err: err.message });
        return next();
      }
      return next(err);
    }
    if (mode === 'shadow') {
      const legacy = legacyAllowedFn ? legacyAllowedFn(req) : LEGACY_HELPER_ROLES.includes(req.user.role);
      if (legacy !== decision.allowed) {
        logger.warn('access.shadow_mismatch', {
          capability, legacyAllowed: legacy, capabilityAllowed: decision.allowed,
          reason: decision.reason, route: req.baseUrl + (req.route ? req.route.path : ''),
        });
      }
      return next();
    }
    if (!decision.allowed) {
      return res.status(403).json({
        error: 'This needs approved access. Apply from Settings → Applications.',
        code: 'access_required',
        capability,
        reason: decision.reason === 'account_inactive' ? 'account_inactive' : 'not_granted',
      });
    }
    if (audienceLoader) {
      let audience;
      try {
        audience = await audienceLoader(req.user.id);
      } catch (err) {
        return next(err);
      }
      if (!audience) {
        return res.status(403).json({
          error: 'This needs an approved reporting audience. Apply from Settings → Applications.',
          code: 'investor_audience_required',
          capability,
        });
      }
      req.investorAudience = audience;
    }
    req.accessCapabilities = { ...(req.accessCapabilities || {}), [capability]: true };
    return next();
  };
}

const requireHelperCapability = requireCapability('helper.offer_services', { modeFn: flags.helperEnforcement });
const requireInvestorCapability = requireCapability('investor.reporting', {
  modeFn: flags.investorEnforcement,
  audienceLoader: async (userId) => require('../services/access/accessService').getInvestorAudience(userId),
  legacyAllowedFn: (req) => ['investor', 'admin', 'super_admin'].includes(req.user?.role),
});
const requireFranchiseCapability = requireCapability('franchise.operate', {
  modeFn: flags.franchiseEnforcement,
  legacyAllowedFn: (req) => req.user?.default_mode === 'franchise_applicant',
});

/**
 * Tool-owner writes retain a customer-first draft path. In enforce mode an
 * applicant without an effective grant may create or edit a private draft,
 * but the route marks the request so publication is forced off. Approved
 * actors publish normally; shadow mode only records the policy disagreement.
 */
const toolOwnerCapabilityGate = async function toolOwnerCapabilityGate(req, res, next) {
  const mode = flags.toolOwnerEnforcement();
  if (mode === 'off' || !req.user || ['admin', 'super_admin'].includes(req.user.role)) {
    req.toolOwnerAccessApproved = true;
    return next();
  }
  try {
    const decision = await require('../services/access/accessService').can(req.user.id, 'tool_owner.list_equipment');
    if (mode === 'shadow') {
      if (!decision.allowed) logger.warn('access.shadow_mismatch', {
        capability: 'tool_owner.list_equipment',
        legacyAllowed: true,
        capabilityAllowed: false,
        reason: decision.reason,
        route: req.baseUrl + (req.route ? req.route.path : ''),
      });
      req.toolOwnerAccessApproved = decision.allowed;
      return next();
    }
    req.toolOwnerAccessApproved = decision.allowed;
    req.toolOwnerAccessPending = !decision.allowed;
    return next();
  } catch (err) {
    if (mode === 'shadow') {
      logger.warn('access.shadow_error', { capability: 'tool_owner.list_equipment', err: err.message });
      req.toolOwnerAccessPending = false;
      return next();
    }
    return next(err);
  }
};

module.exports = { requireCapability, requireHelperCapability, requireInvestorCapability, requireFranchiseCapability, toolOwnerCapabilityGate, isHelperActor, hasCapability };
