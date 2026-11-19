'use strict';

/**
 * Progressive access capability gate for provider writes (WP-026, WP-028).
 *
 *   requireHelperCapability   helper.offer_services on bid/quote writes
 *
 * Behaviour follows ACCESS_HELPER_ENFORCEMENT:
 *   off      no-op (legacy role checks decide, exactly as before)
 *   shadow   evaluate the capability and log any disagreement with the
 *            legacy role decision (`access.shadow_mismatch`), never block;
 *            an allowed decision is still recorded on
 *            `req.accessCapabilities` so downstream legacy checks see the
 *            same grant the resolver just approved (B1: shadow promises
 *            not to block, not to hide the decision)
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

function requireCapability(capability, { modeFn, audienceLoader = null, legacyAllowedFn = null, subject = null, allowActivationIncomplete = false } = {}) {
  return async function accessCapabilityGate(req, res, next) {
    const mode = modeFn();
    if (mode === 'off' || !req.user) return next();
    if (['admin', 'super_admin'].includes(req.user.role)) return next();
    let decision;
    try {
      const access = require('../services/access/accessService');
      // G-26: most capabilities evaluate against the self subject; the
      // franchise gate passes { type: 'any' } because franchise.operate
      // is granted per territory and any active territory suffices.
      const resolvedSubject = typeof subject === 'function' ? subject(req) : subject;
      decision = await access.can(req.user.id, capability, resolvedSubject || undefined);
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
      // B1: shadow never blocks, but an allowed decision is still recorded
      // so downstream legacy checks (isHelperActor, requireRole widening,
      // helper onboarding gates) see the grant the resolver just approved.
      // A denied decision records nothing: nothing downstream may treat a
      // shadow evaluation as permission.
      if (decision.allowed) {
        req.accessCapabilities = { ...(req.accessCapabilities || {}), [capability]: true };
      }
      return next();
    }
    // Setup routes may require an approved grant while deliberately helping
    // the user complete activation (for example, creating the payout account
    // that satisfies payout_setup). The resolver reports this reason only
    // when an effective grant exists; missing/revoked grants still fail shut.
    if (allowActivationIncomplete && decision.reason === 'activation_incomplete') {
      req.accessCapabilities = { ...(req.accessCapabilities || {}), [capability]: true };
      return next();
    }
    if (!decision.allowed) {
      // G-1: an approved-but-incomplete capability is not a missing grant.
      // Name the missing setup steps so the client can send the user to
      // Settings → Applications instead of showing a bare 403.
      if (decision.reason === 'activation_incomplete') {
        return res.status(403).json({
          error: 'This access is approved but setup is not finished. Complete the remaining steps in Settings → Applications.',
          code: 'activation_incomplete',
          capability,
          missing: decision.missing || [],
        });
      }
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

/**
 * Gate a route that is available to one of several promoted capabilities.
 * Each entry owns its rollout mode and legacy compatibility predicate. An
 * entry in `off` or `shadow` mode keeps the legacy path available; an entry in
 * `enforce` mode requires a current grant unless another entry still has an
 * explicitly compatible legacy path. This lets a single customer-first
 * surface (for example Learn authoring) serve helpers or consultants without
 * treating either role as a permanent account type. As with the single
 * capability gate, an allowed decision is recorded on
 * `req.accessCapabilities` in shadow mode as well as enforce, so downstream
 * legacy checks see the grant; a denied decision records nothing.
 */
function requireAnyCapability(entries = []) {
  return async function anyCapabilityGate(req, res, next) {
    if (!req.user || ['admin', 'super_admin'].includes(req.user.role)) return next();
    const configured = entries.map((entry) => ({ ...entry, mode: entry.modeFn() }));
    const active = configured.filter((entry) => entry.mode !== 'off');
    if (!active.length) return next();

    const access = require('../services/access/accessService');
    const decisions = [];
    for (const entry of active) {
      try {
        decisions.push({ entry, decision: await access.can(req.user.id, entry.capability) });
      } catch (err) {
        if (entry.mode === 'shadow') {
          logger.warn('access.shadow_error', { capability: entry.capability, err: err.message });
          decisions.push({ entry, decision: { allowed: false, reason: 'lookup_failed' } });
          continue;
        }
        return next(err);
      }
    }

    for (const { entry, decision } of decisions) {
      if (entry.mode === 'shadow') {
        const legacy = entry.legacyAllowedFn ? entry.legacyAllowedFn(req) : false;
        if (legacy !== decision.allowed) {
          logger.warn('access.shadow_mismatch', {
            capability: entry.capability,
            legacyAllowed: legacy,
            capabilityAllowed: decision.allowed,
            reason: decision.reason,
            route: req.baseUrl + (req.route ? req.route.path : ''),
          });
        }
      }
    }

    const granted = decisions.some(({ entry, decision }) => entry.mode === 'enforce' && decision.allowed);
    const legacyCompatible = decisions.some(({ entry }) =>
      entry.mode !== 'enforce' && entry.legacyAllowedFn && entry.legacyAllowedFn(req)
    );
    if (granted || legacyCompatible || !decisions.some(({ entry }) => entry.mode === 'enforce')) {
      // B1: record every allowed decision, shadow as well as enforce, so a
      // downstream legacy check sees the grant the resolver just approved.
      // Denied decisions record nothing. Recording happens only on the
      // pass path: a 403 below records nothing.
      for (const { entry, decision } of decisions) {
        if (decision.allowed) {
          req.accessCapabilities = { ...(req.accessCapabilities || {}), [entry.capability]: true };
        }
      }
      return next();
    }

    return res.status(403).json({
      error: 'This needs approved access. Apply from Settings → Applications.',
      code: 'access_required',
      capability: entries.map((entry) => entry.capability),
      reason: decisions.some(({ decision }) => decision.reason === 'account_inactive')
        ? 'account_inactive' : 'not_granted',
    });
  };
}

const requireHelperCapability = requireCapability('helper.offer_services', { modeFn: flags.helperEnforcement });
const requireHelperSetupCapability = requireCapability('helper.offer_services', {
  modeFn: flags.helperEnforcement,
  allowActivationIncomplete: true,
});
const requireInvestorCapability = requireCapability('investor.reporting', {
  modeFn: flags.investorEnforcement,
  audienceLoader: async (userId) => require('../services/access/accessService').getInvestorAudience(userId),
  legacyAllowedFn: (req) => ['investor', 'admin', 'super_admin'].includes(req.user?.role),
});
const requireFranchiseCapability = requireCapability('franchise.operate', {
  modeFn: flags.franchiseEnforcement,
  // G-26: franchise.operate is granted per territory; holding any active
  // territory grant opens the workspace. Per-territory data stays scoped
  // by the application id in the URL, resolved by the controller.
  subject: { type: 'any' },
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

module.exports = { requireCapability, requireAnyCapability, requireHelperCapability, requireHelperSetupCapability, requireInvestorCapability, requireFranchiseCapability, toolOwnerCapabilityGate, isHelperActor, hasCapability };
