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

const LIST_SUBJECT_TYPES = Object.freeze(['user', 'business']);
const LIST_CATEGORIES = Object.freeze([
  'affiliate_fraud',
  'collusion',
  'account_takeover',
  'chargeback',
  'abuse_report',
  'other',
]);
const LIST_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
const LIST_STATUSES = Object.freeze(['open', 'investigating', 'resolved', 'dismissed']);

/**
 * List fraud cases with optional filters and pagination.
 * Query layer shared by the admin fraud routes and the connector API.
 *
 * @param {object} args
 * @param {string} [args.category]
 * @param {string} [args.severity]
 * @param {string} [args.status]
 * @param {string} [args.subject_type]
 * @param {string} [args.subject_id]
 * @param {number|string} [args.page]
 * @param {number|string} [args.limit]
 * @returns {Promise<{cases: object[], total: number, page: number, limit: number}>}
 * @throws AppError (400 validation_failed) on an invalid filter value
 */
async function listFraudCases({
  category,
  severity,
  status,
  subject_type,
  subject_id,
  page,
  limit,
} = {}) {
  const { AppError } = require('../middleware/errorHandler');
  const fields = {};
  if (category !== undefined && !LIST_CATEGORIES.includes(category)) {
    fields.category = `Invalid category. Must be one of: ${LIST_CATEGORIES.join(', ')}`;
  }
  if (severity !== undefined && !LIST_SEVERITIES.includes(severity)) {
    fields.severity = `Invalid severity. Must be one of: ${LIST_SEVERITIES.join(', ')}`;
  }
  if (status !== undefined && !LIST_STATUSES.includes(status)) {
    fields.status = `Invalid status. Must be one of: ${LIST_STATUSES.join(', ')}`;
  }
  if (subject_type !== undefined && !LIST_SUBJECT_TYPES.includes(subject_type)) {
    fields.subject_type = `Invalid subject_type. Must be one of: ${LIST_SUBJECT_TYPES.join(', ')}`;
  }
  if (Object.keys(fields).length) {
    throw new AppError('Validation failed', 400, 'validation_failed', fields);
  }

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;

  const conditions = [];
  const params = [];
  const addCondition = (clause, value) => {
    params.push(value);
    conditions.push(`${clause} $${params.length}`);
  };
  if (category !== undefined) addCondition('category =', category);
  if (severity !== undefined) addCondition('severity =', severity);
  if (status !== undefined) addCondition('status =', status);
  if (subject_type !== undefined) addCondition('subject_type =', subject_type);
  if (subject_id !== undefined) addCondition('subject_id =', subject_id);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [{ rows: countRows }, { rows: caseRows }] = await Promise.all([
    defaultPool.query(`SELECT COUNT(*) AS total FROM fraud_cases ${where}`, params),
    defaultPool.query(
      `SELECT * FROM fraud_cases ${where}
        ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, safeLimit, offset]
    ),
  ]);

  return {
    cases: caseRows,
    total: Number(countRows[0]?.total || 0),
    page: safePage,
    limit: safeLimit,
  };
}

module.exports = {
  createFraudCase,
  listFraudCases,
  LIST_SUBJECT_TYPES,
  LIST_CATEGORIES,
  LIST_SEVERITIES,
  LIST_STATUSES,
};
