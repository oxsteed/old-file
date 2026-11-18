'use strict';

/**
 * Progressive access rollout flags (server-owned; spec "Launch flags and
 * drop-in compatibility"). The progressive path is enabled by default; each
 * flag can be explicitly disabled for rollback. A pilot allowlist still lets
 * development/test users use the flows before a cohort switch.
 *
 * Enforcement defaults (2026-11-18): progressive-access navigation and
 * server-side enforcement ship on by default for every catalog family. An
 * explicit environment value can still select shadow/off for rollback, but a
 * missing value must never silently restore legacy role authority. The one
 * deliberate exception is live investment commitments, which remain disabled
 * in the separate investment feature flags module.
 *
 *   ACCESS_REQUESTS_ENABLED        applicant + reviewer APIs
 *   ACCESS_PROJECTION_ENABLED      GET /api/me/access and boot projection
 *   ACCESS_CUSTOMER_FIRST_SIGNUP   signup creates customer + intent/draft
 *   ACCESS_HELPER_ENFORCEMENT      off | shadow | enforce (helper writes;
 *                                  default enforce since the Domain 6 B1
 *                                  fix: an approved helper must be able to
 *                                  bid/work, and the gate records the live
 *                                  decision for downstream legacy checks)
 *   ACCESS_LEGACY_SWITCH_RETIRED   switch-role stops changing authority
 *   ACCESS_BUSINESS_ENFORCEMENT    off | shadow | enforce (publishing a new
 *                                  business/restaurant needs an approved
 *                                  business.own / restaurant.own application)
 *   ACCESS_CONSULTANT_ENFORCEMENT  off | shadow | enforce (paying clients)
 *   ACCESS_INVESTOR_ENFORCEMENT    off | shadow | enforce (investor reporting)
 *   ACCESS_FRANCHISE_ENFORCEMENT   off | shadow | enforce (territory operations)
 *   ACCESS_PILOT_USER_IDS          comma-separated user UUIDs that get
 *                                  REQUESTS/PROJECTION while flags are off
 */

const { envFlagEnabled } = require('../../middleware/featureFlags');

function pilotIds() {
  return new Set(String(process.env.ACCESS_PILOT_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
}

const isPilot = (userId) => !!userId && pilotIds().has(String(userId));

const requestsEnabled = (userId) => envFlagEnabled('ACCESS_REQUESTS_ENABLED', true) || isPilot(userId);
const projectionEnabled = (userId) => envFlagEnabled('ACCESS_PROJECTION_ENABLED', true) || isPilot(userId);
const customerFirstSignup = () => envFlagEnabled('ACCESS_CUSTOMER_FIRST_SIGNUP', true);
const legacySwitchRetired = () => envFlagEnabled('ACCESS_LEGACY_SWITCH_RETIRED', true);

function helperEnforcement() {
  const v = String(process.env.ACCESS_HELPER_ENFORCEMENT || 'enforce').trim().toLowerCase();
  return ['off', 'shadow', 'enforce'].includes(v) ? v : 'enforce';
}

function businessEnforcement() {
  const v = String(process.env.ACCESS_BUSINESS_ENFORCEMENT || 'enforce').trim().toLowerCase();
  return ['off', 'shadow', 'enforce'].includes(v) ? v : 'enforce';
}

function consultantEnforcement() {
  const v = String(process.env.ACCESS_CONSULTANT_ENFORCEMENT || 'enforce').trim().toLowerCase();
  return ['off', 'shadow', 'enforce'].includes(v) ? v : 'enforce';
}

function investorEnforcement() {
  const v = String(process.env.ACCESS_INVESTOR_ENFORCEMENT || 'enforce').trim().toLowerCase();
  return ['off', 'shadow', 'enforce'].includes(v) ? v : 'enforce';
}

function franchiseEnforcement() {
  const v = String(process.env.ACCESS_FRANCHISE_ENFORCEMENT || 'enforce').trim().toLowerCase();
  return ['off', 'shadow', 'enforce'].includes(v) ? v : 'enforce';
}

function toolOwnerEnforcement() {
  const v = String(process.env.ACCESS_TOOL_OWNER_ENFORCEMENT || 'enforce').trim().toLowerCase();
  return ['off', 'shadow', 'enforce'].includes(v) ? v : 'enforce';
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

module.exports = { requestsEnabled, projectionEnabled, customerFirstSignup, legacySwitchRetired, helperEnforcement, businessEnforcement, consultantEnforcement, investorEnforcement, franchiseEnforcement, toolOwnerEnforcement, clientFlags, isPilot };
