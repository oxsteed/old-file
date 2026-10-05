'use strict';

/**
 * statementIssuance routes — operator control plane for automatic monthly
 * statement issuance (workstream 1).
 *
 * Self-contained router; NOT mounted here. The coordinator wires it in
 * server/index.js with:
 *   const statementIssuanceRoutes = require('./routes/statementIssuance');
 *   app.use('/api/statement-issuance', statementIssuanceRoutes);
 *
 * Every write is admin-authed (requireAdmin + manage_operations grant),
 * validated, and idempotent:
 * - POST /runs returns the existing run for a repeated (product, period)
 *   instead of duplicating it;
 * - pause/resume on an already-paused/resumed run return the run unchanged;
 * - catch-up re-runs the idempotent discovery pass (missed accounts only).
 */

const express = require('express');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { AppError } = require('../middleware/errorHandler');
const jobs = require('../services/statementJobService');
const scheduler = require('../jobs/statementIssuanceScheduler');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRODUCTS = ['oxsteed', 'restaurant'];
const MAX_PERIOD_DAYS = 366;

router.use(requireAdmin, requirePermission('manage_operations'));

function checkRunId(value) {
  if (!UUID_RE.test(String(value || ''))) {
    throw new AppError('Invalid run id', 400, 'statement_run_invalid_id');
  }
  return String(value);
}

function checkClosedPeriod(periodFrom, periodTo) {
  for (const [name, value] of [['periodFrom', periodFrom], ['periodTo', periodTo]]) {
    if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
      throw new AppError(`Invalid ${name}; expected YYYY-MM-DD`, 400, 'statement_run_invalid_period');
    }
  }
  if (periodTo < periodFrom) throw new AppError('periodTo must be on or after periodFrom', 400, 'statement_run_invalid_period');
  const days = (Date.parse(periodTo) - Date.parse(periodFrom)) / 86400000 + 1;
  if (days > MAX_PERIOD_DAYS) throw new AppError('Period is too long', 400, 'statement_run_invalid_period');
  const today = new Date().toISOString().slice(0, 10);
  if (periodTo >= today) {
    throw new AppError('Only closed periods can be issued (periodTo must be before today, UTC)', 400, 'statement_run_period_not_closed');
  }
  return { periodFrom, periodTo };
}

async function loadRunOr404(runId) {
  const { rows: [run] } = await require('../db').query(
    'SELECT * FROM statement_issuance_runs WHERE id = $1', [runId]);
  if (!run) throw new AppError('Statement issuance run not found', 404, 'statement_run_not_found');
  return run;
}

function shapeRun(run, idempotent = false) {
  return {
    id: run.id,
    product: run.product,
    periodFrom: run.period_from instanceof Date ? run.period_from.toISOString().slice(0, 10) : String(run.period_from),
    periodTo: run.period_to instanceof Date ? run.period_to.toISOString().slice(0, 10) : String(run.period_to),
    state: run.state,
    discoveredCount: Number(run.discovered_count),
    issuedCount: Number(run.issued_count),
    failedCount: Number(run.failed_count),
    createdAt: new Date(run.created_at).toISOString(),
    updatedAt: new Date(run.updated_at).toISOString(),
    completedAt: run.completed_at ? new Date(run.completed_at).toISOString() : null,
    ...(idempotent ? { idempotent: true } : {}),
  };
}

// Create a run for a closed month. Idempotent on the natural key
// (product, period): a repeated call returns the existing run.
router.post('/runs', async (req, res, next) => {
  try {
    const product = String(req.body?.product || '');
    if (!PRODUCTS.includes(product)) {
      throw new AppError('Unknown statement product', 400, 'statement_run_invalid_product');
    }
    const { periodFrom, periodTo } = checkClosedPeriod(req.body?.periodFrom, req.body?.periodTo);
    const existing = await scheduler.findOpenRun(product, periodFrom, periodTo);
    if (existing) return res.status(200).json({ run: shapeRun(existing, true) });
    const run = await jobs.createRun({ product, periodFrom, periodTo });
    return res.status(201).json({ run: shapeRun(run) });
  } catch (error) {
    return next(error);
  }
});

router.post('/runs/:id/pause', async (req, res, next) => {
  try {
    const runId = checkRunId(req.params.id);
    try {
      const run = await jobs.pauseRun(runId);
      return res.json({ run: shapeRun(run) });
    } catch (error) {
      if (error && error.code === 'statement_run_state') {
        const run = await loadRunOr404(runId);
        if (run.state === 'paused') return res.json({ run: shapeRun(run, true) });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

router.post('/runs/:id/resume', async (req, res, next) => {
  try {
    const runId = checkRunId(req.params.id);
    try {
      const run = await jobs.resumeRun(runId);
      return res.json({ run: shapeRun(run) });
    } catch (error) {
      if (error && error.code === 'statement_run_state') {
        const run = await loadRunOr404(runId);
        if (['discovering', 'running'].includes(run.state)) return res.json({ run: shapeRun(run, true) });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

// Re-discover missed accounts for a run (accounts created mid-cycle,
// reactivated after a recorded skip). The discovery pass is idempotent:
// already-discovered jobs and recorded skips are no-ops on re-scan.
router.post('/runs/:id/catch-up', async (req, res, next) => {
  try {
    const runId = checkRunId(req.params.id);
    const run = await loadRunOr404(runId);
    if (run.state === 'failed') {
      throw new AppError('Cannot catch up a failed run', 409, 'statement_run_state');
    }
    const pass = await scheduler.runDiscoveryPass(run);
    const refreshed = await loadRunOr404(runId);
    return res.json({ run: shapeRun(refreshed), ...pass });
  } catch (error) {
    return next(error);
  }
});

router.get('/runs/:id/stats', async (req, res, next) => {
  try {
    const runId = checkRunId(req.params.id);
    await loadRunOr404(runId);
    const stats = await jobs.getRunStats(runId);
    return res.json({ runId, stats });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
