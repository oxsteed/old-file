'use strict';

/**
 * OxSteed Invest feature flags (server-owned).
 *
 *   INVEST_ENABLED              master gate for the whole participation
 *                               surface; default off.
 *   INVEST_COMMITMENTS_ENABLED  separate pilot gate for commitment
 *                               creation; default off.
 *   INVEST_PILOT_USER_IDS       comma-separated user UUIDs that may use
 *                               the surface while the flags are off
 *                               (mirrors ACCESS_PILOT_USER_IDS).
 *
 * Live activity stays DISABLED by design until counsel and partner
 * approval; all three ship off. These flags are checked server-side on
 * every participation write path, never only in UI gating.
 *
 * ACCESS_INVESTOR_ENFORCEMENT governs investor.reporting only. It is
 * never read as a participation gate and never appears in this file.
 */

const { envFlagEnabled } = require('../../middleware/featureFlags');
const AppError = require('../../utils/appError');

function investPilotIds() {
  return new Set(String(process.env.INVEST_PILOT_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
}

const isInvestPilot = (userId) => !!userId && investPilotIds().has(String(userId));

const investEnabled = (userId) => envFlagEnabled('INVEST_ENABLED', false) || isInvestPilot(userId);

const investCommitmentsEnabled = (userId) => investEnabled(userId)
  && (envFlagEnabled('INVEST_COMMITMENTS_ENABLED', false) || isInvestPilot(userId));

function requireInvestEnabled(userId) {
  if (!investEnabled(userId)) {
    throw new AppError('OxSteed Invest is not available.', 503, 'invest_disabled');
  }
}

function requireInvestCommitmentsEnabled(userId) {
  if (!investCommitmentsEnabled(userId)) {
    throw new AppError('Investment commitments are not available.', 503, 'invest_commitments_disabled');
  }
}

/** Client-visible boot flags (never a permission boundary). */
function clientFlags(userId) {
  return {
    investEnabled: investEnabled(userId),
    investCommitmentsEnabled: investCommitmentsEnabled(userId),
    investPilot: isInvestPilot(userId),
  };
}

module.exports = {
  investPilotIds,
  isInvestPilot,
  investEnabled,
  investCommitmentsEnabled,
  requireInvestEnabled,
  requireInvestCommitmentsEnabled,
  clientFlags,
};
