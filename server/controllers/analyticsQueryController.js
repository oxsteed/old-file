'use strict';

/**
 * Structured query builder endpoints (analytics platform, Phase 3, Item 11).
 *
 * GET  /api/admin/analytics/query-builder/meta — metric catalog with
 *      dimension allowlists, filter params, periods, and units. Powers the
 *      UI dropdowns (and Track B's NL parser context).
 * POST /api/admin/analytics/query-builder/run  — validates, scopes,
 *      executes, and audit-logs a builder query. Returns
 *      { rows, columns, rowCount, truncated, durationMs }.
 *
 * Both routes sit behind requireAdmin in server/routes/admin.js; the
 * builder itself re-checks the admin role as defense in depth.
 */

const db = require('../db');
const { getBuilderMeta, executeBuilderQuery } = require('../analytics/queryBuilder');

async function getMeta(req, res, next) {
  try {
    res.json(getBuilderMeta());
  } catch (err) {
    next(err);
  }
}

async function runQuery(req, res, next) {
  try {
    const result = await executeBuilderQuery(db, req.user, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { getMeta, runQuery };
