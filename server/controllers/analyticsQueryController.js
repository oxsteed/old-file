'use strict';

/**
 * Structured query builder endpoints (analytics platform, Phase 3, Item 11).
 *
 * GET  /api/admin/analytics/query-builder/meta — metric catalog with
 *      dimension allowlists, filter params, periods, and units. Powers the
 *      UI dropdowns (and Track B's NL parser context).
 * POST /api/admin/analytics/query-builder/run  — validates, scopes,
 *      executes, and audit-logs a builder query. Returns
 *      { rows, columns, rowCount, truncated, durationMs }. Accepts an
 *      optional `raw_utterance` string (Track B confirm flow) which is
 *      recorded in the audit ledger; it is never interpreted server-side.
 * POST /api/admin/analytics/query-builder/nl-parse — Track B: compiles a
 *      plain-English utterance into a builder query via the deterministic
 *      nlParser. Returns { interpretation: { compiled, description } } or
 *      { rejected: true, reason }. NEVER executes. The admin confirms the
 *      interpretation in the UI; only the confirmed builder query goes to
 *      /run (with raw_utterance for the ledger).
 *
 * Both routes sit behind requireAdmin in server/routes/admin.js; the
 * builder itself re-checks the admin role as defense in depth.
 */

const db = require('../db');
const { AppError } = require('../middleware/errorHandler');
const {
  getBuilderMeta,
  validateBuilderQuery,
  executeBuilderQuery,
  BUILDER_DIMENSIONS,
} = require('../analytics/queryBuilder');
const { parseUtterance, describeQuery } = require('../analytics/nlParser');

async function getMeta(req, res, next) {
  try {
    res.json(getBuilderMeta());
  } catch (err) {
    next(err);
  }
}

async function runQuery(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const opts = {};
    if (body.raw_utterance != null) {
      if (typeof body.raw_utterance !== 'string' || body.raw_utterance.length > 2000) {
        throw new AppError('Invalid raw_utterance: expected a string up to 2000 characters', 400, 'invalid_param');
      }
      opts.rawUtterance = body.raw_utterance;
    }
    const result = await executeBuilderQuery(db, req.user, body, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function parseNl(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const utterance = body.utterance;
    if (typeof utterance !== 'string' || utterance.trim() === '') {
      throw new AppError('Invalid utterance: expected a non-empty string', 400, 'invalid_param');
    }
    if (utterance.length > 2000) {
      throw new AppError('Invalid utterance: too long (max 2000 characters)', 400, 'invalid_param');
    }
    // Wire Track B's parser to Track A's canonical dimension allowlist so
    // the two can never drift.
    const parsed = parseUtterance(utterance, { dimensionAllowlist: BUILDER_DIMENSIONS });
    if (parsed.rejected) {
      return res.json({ rejected: true, reason: parsed.reason });
    }
    // Defense in depth: the compiled query must pass builder validation
    // even though the parser only emits allowlisted values. Validation
    // failures here are 422 (parser bug, not user error) — never executed.
    try {
      validateBuilderQuery(parsed);
    } catch (validationErr) {
      return res.json({
        rejected: true,
        reason: `compiled query failed validation: ${validationErr.message}`,
      });
    }
    return res.json({
      rejected: false,
      interpretation: {
        compiled: {
          metric: parsed.metric,
          dimensions: parsed.dimensions,
          filters: parsed.filters,
          period: parsed.period,
        },
        description: describeQuery(parsed),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMeta, runQuery, parseNl };
