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
const snapshots = require('../analytics/metricSnapshots');
const { logAdminAction } = require('../services/auditService');
const logger = require('../utils/logger');
const { governedKpis, parseMetricList } = require('../analytics/governedKpis');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/analytics/governed-kpis?metrics=a,b&period=30d[&customerId=]
// Card values for dashboards, computed exactly like the builder (see
// analytics/governedKpis.js). Ungranted metrics come back permitted:false.
async function getGovernedKpis(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const metrics = parseMetricList(req.query.metrics);
    const period = req.query.period ? String(req.query.period) : '30d';
    const filters = {};
    if (req.query.customerId != null) {
      if (!UUID_RE.test(String(req.query.customerId))) throw new AppError('Invalid customerId', 400, 'invalid_param');
      filters.customerId = String(req.query.customerId);
    }
    res.json({ period, kpis: await governedKpis(db, req.user, metrics, { period, filters }) });
  } catch (err) {
    next(err);
  }
}

async function getMeta(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const scopes = await permittedMetricScopes(req.user);
    const meta = getBuilderMeta(Object.keys(scopes));
    // scope per metric: 'global' or 'regional' (rows limited to assigned regions).
    meta.metrics = meta.metrics.map(m => ({ ...m, scope: scopes[m.name], trend: snapshots.isSnapshotMetric(m.name) }));
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

const TREND_DAYS = Object.freeze([30, 90, 180, 365]);

// Governed trend series from the nightly snapshot store. Scoped exactly like
// live reads (global grant or the caller's own regional territory) and
// audited before disclosure (fail closed).
async function getTrend(req, res, next) {
  const startedAt = Date.now();
  const metric = String(req.query.metric || '');
  const audit = { userId: req.user?.id, metricName: metric || 'unknown', eventType: 'trend', success: false };
  try {
    res.set('Cache-Control', 'private, no-store');
    if (!snapshots.isSnapshotMetric(metric)) throw new AppError('This metric has no trend series', 400, 'invalid_metric');
    const days = Number(req.query.days || 90);
    if (!TREND_DAYS.includes(days)) throw new AppError(`Invalid days: expected one of ${TREND_DAYS.join(', ')}`, 400, 'invalid_param');
    const currency = String(req.query.currency || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new AppError('Invalid currency', 400, 'invalid_param');
    const scope = await assertMetricAccess(req.user, metric);
    audit.scope = scope;
    audit.period = `${days}d`;
    audit.filters = { currency };
    const trend = await snapshots.readTrend(db, scope, { metric, days, currency });
    await auditAttempt(db, { ...audit, success: true, rowCount: trend.points.length, durationMs: Date.now() - startedAt });
    res.json(trend);
  } catch (err) {
    if (err.code !== 'analytics_audit_unavailable') {
      try { await auditAttempt(db, { ...audit, durationMs: Date.now() - startedAt, errorCode: err.code || 'trend_error' }); }
      catch (auditError) { return next(auditError); }
    }
    next(err);
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Super admin: queue a backfill (optionally recomputing existing rows). The
// action is audited before it starts; the run itself is fenced and reported
// through listSnapshotRuns.
async function startSnapshotBackfill(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const from = String(body.from || ''), to = String(body.to || '');
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) throw new AppError('Invalid range: from/to must be YYYY-MM-DD', 400, 'invalid_param');
    const yesterday = snapshots.addDays(snapshots.utcDay(new Date()), -1);
    if (from > to || to > yesterday || snapshots.dayRange(from, to).length > 400) {
      throw new AppError('Invalid range: closed UTC days only, at most 400 days', 400, 'invalid_param');
    }
    const recompute = body.recompute === true;
    await logAdminAction({ adminId: req.user.id, action: 'analytics_snapshot_backfill', targetType: 'metric_snapshots',
      targetKey: `${from}..${to}`, after: { from, to, recompute }, req, throwOnError: true });
    const { runMetricSnapshots } = require('../jobs/metricSnapshots');
    runMetricSnapshots({ kind: 'backfill', from, to, recompute, requestedBy: req.user.id })
      .catch(error => logger.warn('Metric snapshot backfill failed', { code: error.code }));
    res.status(202).json({ accepted: true, from, to, recompute });
  } catch (err) { next(err); }
}

async function listSnapshotRuns(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const { rows } = await db.query(`SELECT id, kind, to_char(from_date,'YYYY-MM-DD') AS from_date,
        to_char(to_date,'YYYY-MM-DD') AS to_date, status, recompute, rows_written, error_code, started_at, finished_at
      FROM metric_snapshot_runs ORDER BY id DESC LIMIT 30`);
    res.json({ runs: rows });
  } catch (err) { next(err); }
}

module.exports = {
  getGovernedKpis, getMeta, runQuery, parseNl, getHistory, getTrend, startSnapshotBackfill, listSnapshotRuns };
