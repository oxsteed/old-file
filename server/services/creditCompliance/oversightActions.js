'use strict';

/**
 * Registry of licence-readiness oversight actions (two distinct
 * administrators, run while the Credit rail is off; see
 * oxsteedCreditPendingActionService.registerOversightAction).
 *
 * Each module exports registerOversightActions(register); this file only
 * wires them together so the pending-action service loads one entry point.
 */

const logger = require('../../utils/logger');

const MODULES = [
  '../fx/manualReferenceRate',
  './safeguardingService',
  './sanctionsListService',
  './sarService',
  './kycRequirementsService',
  './disputeSlaService',
  './disclosureService',
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
      // Notifications audit item 7 follow-up: the skip used to be silent,
      // so a deleted or renamed module left its oversight actions
      // unregistered behind a green startup. Warn so the hole cannot
      // silently reopen.
      if (error.code === 'MODULE_NOT_FOUND' && String(error.message).includes(mod.split('/').pop())) {
        logger.warn('credit_oversight.module_missing', { module: mod, error: error.message });
        continue;
      }
      throw error;
    }
    if (loaded && typeof loaded.registerOversightActions === 'function') loaded.registerOversightActions(register);
  }
}

module.exports = { registerOversightActions, MODULES };
