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
  auditAttempt,
} = require('../analytics/queryBuilder');
const { parseUtterance, describeQuery } = require('../analytics/nlParser');
const { permittedMetrics, permittedMetricScopes, assertMetricAccess } = require('../analytics/metricAccess');
const { modelTranslationAvailable,translateWithModel }=require('../analytics/nlModelTranslator');

async function getMeta(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const scopes = await permittedMetricScopes(req.user);
    const meta = getBuilderMeta(Object.keys(scopes));
    // scope per metric: 'global' or 'regional' (rows limited to assigned regions).
    meta.metrics = meta.metrics.map(m => ({ ...m, scope: scopes[m.name] }));
    res.json({...meta,nlModelAvailable:modelTranslationAvailable()});
  } catch (err) {
    next(err);
  }
}

async function runQuery(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const opts = {};
    opts.eventType = body.export === true ? 'export' : 'execution';
    opts.evidence = body.evidence === true;
    opts.offset = body.offset;
    if (opts.evidence && body.export !== true) opts.eventType = 'evidence';
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
  const startedAt = Date.now();
  let audit = { userId: req.user?.id, metricName: 'unknown', eventType: 'nl_parse', success: false };
  try {
    res.set('Cache-Control', 'private, no-store');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const utterance = body.utterance;
    if (typeof utterance !== 'string' || utterance.trim() === '') {
      throw new AppError('Invalid utterance: expected a non-empty string', 400, 'invalid_param');
    }
    if (utterance.length > 2000) {
      throw new AppError('Invalid utterance: too long (max 2000 characters)', 400, 'invalid_param');
    }
    audit.rawUtterance = utterance;
    // Wire Track B's parser to Track A's canonical dimension allowlist so
    // the two can never drift.
    let parsed = parseUtterance(utterance, { dimensionAllowlist: BUILDER_DIMENSIONS });
    // Deterministic safety/ambiguity rejections never go to the provider.
    // Only unrecognized phrasing can use the explicitly enabled fallback.
    if(parsed.rejected && parsed.reason==='no metric recognized' && modelTranslationAvailable()){
      const catalog=getBuilderMeta(await permittedMetrics(req.user)).metrics;
      parsed=await translateWithModel(utterance,catalog);
    }
    if (parsed.rejected) {
      await auditAttempt(db, { ...audit, durationMs: Date.now()-startedAt, errorCode: 'parse_rejected' });
      return res.json({ rejected: true, reason: parsed.reason });
    }
    audit = { ...audit, metricName: parsed.metric, dimensions: parsed.dimensions, filters: parsed.filters, period: parsed.period };
    // Defense in depth: the compiled query must pass builder validation
    // even though the parser only emits allowlisted values. Validation
    // failures here are 422 (parser bug, not user error) — never executed.
    try {
      validateBuilderQuery(parsed);
    } catch (validationErr) {
      await auditAttempt(db, { ...audit, durationMs: Date.now()-startedAt, errorCode: 'parse_validation_failed' });
      return res.json({
        rejected: true,
        reason: `compiled query failed validation: ${validationErr.message}`,
      });
    }
    await assertMetricAccess(req.user, parsed.metric);
    await auditAttempt(db, { ...audit, success: true, durationMs: Date.now()-startedAt });
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
    if (err.code !== 'analytics_audit_unavailable') {
      try { await auditAttempt(db, { ...audit, durationMs: Date.now()-startedAt, errorCode: err.code || 'parse_error' }); }
      catch (auditError) { return next(auditError); }
    }
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
      throw new AppError('Invalid history page', 400, 'invalid_param');
    }
    const allowed = await permittedMetrics(req.user);
    // Personal history only, re-filtered using current grants. Never expose
    // another administrator's questions, SQL, or restricted metric names.
    const { rows } = await db.query(`SELECT id,event_type,metric_name,dimensions,filters,period,
        row_count,duration_ms,success,error_code,created_at,COUNT(*) OVER()::INT AS total
      FROM analytics_query_audit WHERE admin_user_id=$1
        AND (metric_name=ANY($2::text[]) OR (event_type='nl_parse' AND metric_name='unknown'))
      ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET $3`, [req.user.id, allowed, offset]);
    res.json({ rows: rows.map(({ total, ...row }) => row), offset, total: rows[0]?.total || 0, hasMore: offset+rows.length < (rows[0]?.total || 0) });
  } catch (error) { next(error); }
}

module.exports = { getMeta, runQuery, parseNl, getHistory };
