'use strict';

/**
 * WP-046: business setup and existing ownership.
 *
 * Private preparation (create a draft, edit setup) stays open to every
 * active account. *Activation* — publishing a business or restaurant — is
 * the reviewed step: under ACCESS_BUSINESS_ENFORCEMENT=enforce the owner
 * needs an effective, *granted* `business.own` (service business) or
 * `restaurant.own` (restaurant) — either for themself or for this exact
 * business. Canonical ownership alone (creating a draft) is not approval.
 * `shadow` logs what enforce would refuse; `off` (default) is legacy.
 */

const flags = require('./flags');
const logger = require('../../utils/logger');
const { loadFacts } = require('./accessService');
const { grantIsEffective, accountActive } = require('./resolver');

function capabilityForKind(kind) {
  return kind === 'restaurant' ? 'restaurant.own' : 'business.own';
}

async function hasPublishApproval(db, userId, businessId, kind) {
  const facts = await loadFacts(userId, db);
  if (!accountActive(facts.user, Date.now())) return false;
  // Mirrors modeGate: a restaurant may be published under either approval.
  const wanted = new Set(kind === 'restaurant' ? ['restaurant.own', 'business.own'] : ['business.own']);
  return (facts.grants || []).some((g) => wanted.has(g.capability)
    && grantIsEffective(g, Date.now())
    && ((g.subject_type || 'self') === 'self'
      || (g.subject_type === 'business' && String(g.subject_id) === String(businessId))));
}

/** @returns {Promise<{allowed:boolean, code?:string, capability?:string}>} */
async function checkPublish(db, { userId, businessId, kind }) {
  const mode = flags.businessEnforcement();
  if (mode === 'off') return { allowed: true };
  const ok = await hasPublishApproval(db, userId, businessId, kind);
  if (ok) return { allowed: true };
  const capability = capabilityForKind(kind);
  if (mode === 'shadow') {
    logger.info('access.shadow_mismatch', { gate: 'business_publish', capability });
    return { allowed: true };
  }
  return { allowed: false, code: 'access_required', capability };
}

module.exports = { checkPublish, hasPublishApproval, capabilityForKind };
