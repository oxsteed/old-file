'use strict';

const logger = require('../utils/logger');
const incidentStore = require('../services/incidentStore');

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown worker error');
}

/**
 * Persist a durable alert for a Credit worker failure without allowing the
 * optional incident store to create a second, unhandled worker failure.
 */
async function recordOxsteedCreditJobFailure({ jobName, error, details = {} }) {
  const normalizedJobName = String(jobName || 'unknown').trim().slice(0, 120) || 'unknown';
  const message = errorMessage(error).slice(0, 2000);
  let incident = null;

  try {
    incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_worker_failed',
      severity: 'critical',
      message: `OxSteed Credit worker failed: ${normalizedJobName}`,
      dedupeKey: `oxsteed-credit-worker:${normalizedJobName}:failed`,
      details: {
        ...details,
        jobName: normalizedJobName,
        error: message,
      },
    });
  } catch (incidentError) {
    logger.error('OxSteed Credit worker failure incident could not be persisted', {
      jobName: normalizedJobName,
      error: errorMessage(incidentError).slice(0, 2000),
    });
  }

  logger.error('OxSteed Credit worker failed', {
    jobName: normalizedJobName,
    error: message,
    incidentId: incident?.incident?.id || null,
    incidentPersisted: Boolean(incident?.persisted),
  });

  return incident;
}

module.exports = {
  errorMessage,
  recordOxsteedCreditJobFailure,
};
