'use strict';

// Shared fraud-case creation service.
// Every ingestion point (Stripe disputes, user fraud reports, affiliate
// anti-fraud flags, manual admin creation) funnels through createFraudCase so
// dedupe rules stay consistent in one place.
//
// Table `fraud_cases` is created by migration 609.

const defaultPool = require('../db');
const logger = require('../utils/logger');

const VALID_SUBJECT_TYPES = ['user', 'business'];
const VALID_CATEGORIES = [
  'affiliate_fraud',
  'collusion',
  'account_takeover',
  'chargeback',
  'abuse_report',
  'other',
];
const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const VALID_SOURCES = ['auto_rule', 'user_report', 'stripe_webhook', 'manual'];

// A case is a duplicate of another when it is still actionable and shares
// either the same (subject, category) or the same source reference.
const OPEN_STATUSES = ['open', 'investigating'];

function assertValid(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${name}: ${JSON.stringify(value)}. Must be one of: ${allowed.join(', ')}`);
  }
}

/**
 * Create a fraud case, returning the existing open/investigating case instead
 * of inserting a duplicate.
 *
 * @param {object} args
 * @param {'user'|'business'} args.subjectType
 * @param {string|number} args.subjectId
 * @param {'affiliate_fraud'|'collusion'|'account_takeover'|'chargeback'|'abuse_report'|'other'} args.category
 * @param {'low'|'medium'|'high'|'critical'} args.severity
 * @param {'auto_rule'|'user_report'|'stripe_webhook'|'manual'} args.source
 * @param {string} [args.sourceRef] stable external reference, e.g. a Stripe dispute id
 * @param {string} [args.summary]
 * @param {object} [args.evidence] stored as JSONB
 * @param {object} [args.db] pg client/pool; defaults to the repo pool
 * @returns {Promise<object>} the created or existing case row
 */
async function createFraudCase({
  subjectType,
  subjectId,
  category,
  severity,
  source,
  sourceRef,
  summary,
  evidence,
  db,
}) {
  assertValid('subjectType', subjectType, VALID_SUBJECT_TYPES);
  assertValid('category', category, VALID_CATEGORIES);
  assertValid('severity', severity, VALID_SEVERITIES);
  assertValid('source', source, VALID_SOURCES);
  if (subjectId === undefined || subjectId === null || subjectId === '') {
    throw new Error('subjectId is required');
  }

  const pool = db || defaultPool;

  // Dedupe 1: same source reference (e.g. Stripe dispute id) on an open case.
  if (sourceRef) {
    const { rows } = await pool.query(
      `SELECT *
         FROM fraud_cases
        WHERE source_ref = $1
          AND status = ANY($2)
        LIMIT 1`,
      [sourceRef, OPEN_STATUSES]
    );
    if (rows[0]) {
      logger.info('Fraud case deduped by source_ref', { sourceRef, caseId: rows[0].id });
      return rows[0];
    }
  }

  // Dedupe 2: same subject and category on an open case.
  {
    const { rows } = await pool.query(
      `SELECT *
         FROM fraud_cases
        WHERE subject_type = $1
          AND subject_id = $2
          AND category = $3
          AND status = ANY($4)
        LIMIT 1`,
      [subjectType, subjectId, category, OPEN_STATUSES]
    );
    if (rows[0]) {
      logger.info('Fraud case deduped by subject+category', {
        subjectType,
        subjectId,
        category,
        caseId: rows[0].id,
      });
      return rows[0];
    }
  }

  const { rows: inserted } = await pool.query(
    `INSERT INTO fraud_cases
       (subject_type, subject_id, category, severity, status, source, source_ref, summary, evidence)
     VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8::jsonb)
     RETURNING *`,
    [
      subjectType,
      subjectId,
      category,
      severity,
      source,
      sourceRef || null,
      summary || null,
      JSON.stringify(evidence || {}),
    ]
  );

  logger.info('Fraud case created', {
    caseId: inserted[0]?.id,
    subjectType,
    subjectId,
    category,
    severity,
    source,
  });
  return inserted[0];
}

module.exports = { createFraudCase };
