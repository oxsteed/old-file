'use strict';

/**
 * Progressive access rollout flags (server-owned; spec "Launch flags and
 * drop-in compatibility"). Every flag defaults OFF. A pilot allowlist lets
 * development/test users use the flows before a cohort switch.
 *
 *   ACCESS_REQUESTS_ENABLED        applicant + reviewer APIs
 *   ACCESS_PROJECTION_ENABLED      GET /api/me/access and boot projection
 *   ACCESS_CUSTOMER_FIRST_SIGNUP   signup creates customer + intent/draft
 *   ACCESS_HELPER_ENFORCEMENT      off | shadow | enforce (helper writes)
 *   ACCESS_LEGACY_SWITCH_RETIRED   switch-role stops changing authority
 *   ACCESS_PILOT_USER_IDS          comma-separated user UUIDs that get
 *                                  REQUESTS/PROJECTION while flags are off
 */

const { envFlagEnabled } = require('../../middleware/featureFlags');

function pilotIds() {
  return new Set(String(process.env.ACCESS_PILOT_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
}

const isPilot = (userId) => !!userId && pilotIds().has(String(userId));

const requestsEnabled = (userId) => envFlagEnabled('ACCESS_REQUESTS_ENABLED', false) || isPilot(userId);
const projectionEnabled = (userId) => envFlagEnabled('ACCESS_PROJECTION_ENABLED', false) || isPilot(userId);
const customerFirstSignup = () => envFlagEnabled('ACCESS_CUSTOMER_FIRST_SIGNUP', false);
const legacySwitchRetired = () => envFlagEnabled('ACCESS_LEGACY_SWITCH_RETIRED', false);

function helperEnforcement() {
  const v = String(process.env.ACCESS_HELPER_ENFORCEMENT || 'off').trim().toLowerCase();
  return ['off', 'shadow', 'enforce'].includes(v) ? v : 'off';
}

/** Client-visible boot flags (never a permission boundary). */
function clientFlags(userId) {
  return {
    accessRequests: requestsEnabled(userId),
    accessProjection: projectionEnabled(userId),
    customerFirstSignup: customerFirstSignup(),
    legacySwitchRetired: legacySwitchRetired(),
  };
}

module.exports = { requestsEnabled, projectionEnabled, customerFirstSignup, legacySwitchRetired, helperEnforcement, clientFlags, isPilot };
