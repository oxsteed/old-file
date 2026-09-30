'use strict';

/**
 * reconciliationExceptions service
 *
 * Durable record of reconciliation failures (refund reconciliation runs,
 * credit reconciliation, payout settlement). recordException never throws:
 * recon jobs run on a schedule and must not crash because an exception
 * insert failed.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const DOMAINS = new Set(['credit', 'payment_refund', 'marketplace_refund', 'external_refund', 'payout_settlement']);
const SEVERITIES = new Set(['info', 'warning', 'critical']);

/**
 * Record a reconciliation exception, deduping on open/acknowledged rows with
 * the same (domain, reference_id). Returns the row id, or null on error.
 */
async function recordException({ domain, referenceId, severity = 'warning', summary, details = {}, sourceRunId = null }) {
  try {
    if (!DOMAINS.has(domain)) {
      throw new Error(`Invalid reconciliation exception domain: ${domain}`);
    }
    if (!SEVERITIES.has(severity)) {
      throw new Error(`Invalid reconciliation exception severity: ${severity}`);
    }
    if (!referenceId || !summary) {
      throw new Error('recordException requires referenceId and summary');
    }

    const existing = await pool.query(
      `SELECT id FROM reconciliation_exceptions
        WHERE domain = $1 AND reference_id = $2 AND status IN ('open', 'acknowledged')
        LIMIT 1`,
      [domain, String(referenceId)]
    );
    if (existing.rows.length) {
      return existing.rows[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO reconciliation_exceptions
         (domain, reference_id, severity, summary, details, source_run_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id`,
      [domain, String(referenceId), severity, summary, JSON.stringify(details || {}), sourceRunId || null]
    );
    return rows[0].id;
  } catch (error) {
    // Never let exception bookkeeping crash a reconciliation job.
    logger.warn('recordException failed; swallowing', {
      domain,
      referenceId: referenceId != null ? String(referenceId) : null,
      error: error.message,
    });
    return null;
  }
}

module.exports = {
  DOMAINS: [...DOMAINS],
  SEVERITIES: [...SEVERITIES],
  recordException,
};
