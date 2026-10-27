'use strict';

/**
 * Registry of licence-readiness oversight actions (two distinct
 * administrators, run while the Credit rail is off; see
 * oxsteedCreditPendingActionService.registerOversightAction).
 *
 * Each module exports registerOversightActions(register); this file only
 * wires them together so the pending-action service loads one entry point.
 */

const MODULES = [
  '../fx/manualReferenceRate',
  './safeguardingService',
  './sanctionsListService',
  './sarService',
  './kycRequirementsService',
  './disputeSlaService',
  './dormancyService',
  './accessReviewService',
  './windDownService',
];

function registerOversightActions(register) {
  for (const mod of MODULES) {
    let loaded;
    try {
      loaded = require(mod);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && String(error.message).includes(mod.split('/').pop())) continue;
      throw error;
    }
    if (loaded && typeof loaded.registerOversightActions === 'function') loaded.registerOversightActions(register);
  }
}

module.exports = { registerOversightActions, MODULES };
