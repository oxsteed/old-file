'use strict';

/**
 * Super-admin endpoints for OxSteed Credit licence oversight:
 * two-admin oversight actions, sanctions lists, safeguarding, SARs, KYC
 * requirements, limits, the in-house bank payout rail, held cash-outs and
 * official FX reference rates. Mounted at /api/admin/super/credit-licence
 * behind requireSuperAdmin + rejectImpersonated (routes/admin.js).
 *
 * None of these routes is gated by the Credit rail kill switch: oversight
 * must keep working while money movement is suspended.
 */

const express = require('express');
const AppError = require('../utils/appError');

const router = express.Router();
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const uuid = (v, name = 'id') => {
  const s = String(v || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new AppError(`Invalid ${name}`, 400, 'validation_failed');
  return s;
};
const svc = {
  pending: () => require('../services/oxsteedCreditPendingActionService'),
  lists: () => require('../services/creditCompliance/sanctionsListService'),
  safeguarding: () => require('../services/creditCompliance/safeguardingService'),
  sar: () => require('../services/creditCompliance/sarService'),
  kyc: () => require('../services/creditCompliance/kycRequirementsService'),
  limits: () => require('../services/creditCompliance/limitRules'),
  bank: () => require('../services/creditBankPayoutService'),
  cashout: () => require('../services/creditCashoutService'),
};

// ── Two-admin oversight actions ─────────────────────────────────────────
router.get('/oversight-actions/types', h(async (req, res) => {
  res.json({ actionTypes: svc.pending().listOversightActionTypes() });
}));

router.get('/oversight-actions', h(async (req, res) => {
  const pending = svc.pending();
  const pendingActions = await pending.listPendingActions({
    status: req.query.status || null, limit: req.query.limit, offset: req.query.offset,
    actionTypes: pending.listOversightActionTypes(),
  });
  res.json({ pendingActions });
}));

router.post('/oversight-actions', h(async (req, res) => {
  const pending = svc.pending();
  const actionType = String(req.body?.actionType || '').trim();
  if (!pending.isOversightAction(actionType)) throw new AppError('Unknown oversight action', 400, 'credit_pending_action_type_invalid');
  const result = await pending.requestPendingAction({
    actionType,
    payload: req.body?.payload || {},
    requestedBy: req.user.id,
    idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
    requestIp: req.ip || null,
    correlationId: req.correlationId || req.get('X-Request-ID') || null,
  });
  res.status(result.replayed ? 200 : 201).json(result);
}));

router.post('/oversight-actions/:id/decision', h(async (req, res) => {
  const result = await svc.pending().decideOversightAction({
    actionId: uuid(req.params.id),
    decidedBy: req.user.id,
    decision: req.body?.decision,
    reason: req.body?.reason,
    stepupChallengeId: req.body?.stepupChallengeId,
    stepupCode: req.body?.stepupCode,
    requestIp: req.ip || null,
    correlationId: req.correlationId || req.get('X-Request-ID') || null,
  });
  res.json(result);
}));

// ── Sanctions lists ─────────────────────────────────────────────────────
router.get('/sanctions/sources', h(async (req, res) => {
  const sources = await svc.lists().listSources();
  res.json({ sources, staleRequired: await svc.lists().staleRequiredSources() });
}));
router.post('/sanctions/sources/:id/refresh', h(async (req, res) => {
  res.json(await svc.lists().refreshSource(String(req.params.id)));
}));
// Publishers that block automated download: ingest the official file with
// scripts/ingestSanctionsList.js (bodies are too large for the API parser).
router.get('/sanctions/screenings/:id/matches', h(async (req, res) => {
  res.json({ matches: await svc.lists().listScreeningMatches(require('../db'), uuid(req.params.id)) });
}));
router.get('/sanctions/custom', h(async (req, res) => {
  res.json({ entries: await svc.lists().listCustomEntries() });
}));
router.get('/sanctions/search', h(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 200);
  res.json({ matches: await svc.lists().searchName(require('../db'), q, { threshold: 0.8 }) });
}));

// ── Safeguarding ────────────────────────────────────────────────────────
router.get('/safeguarding', h(async (req, res) => res.json(await svc.safeguarding().getStatus())));
router.post('/safeguarding/reconcile', h(async (req, res) => {
  res.json({ results: await svc.safeguarding().runDailyReconciliation({ runDate: req.body?.runDate || undefined }) });
}));
router.get('/safeguarding/export', h(async (req, res) => {
  const from = String(req.query.from || '').slice(0, 10);
  const to = String(req.query.to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError('from and to dates are required', 400, 'validation_failed');
  const out = await svc.safeguarding().exportReconciliations({ from, to });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="safeguarding-${from}-${to}.csv"`);
  res.set('X-Content-SHA256', out.sha256);
  res.send(out.csv);
}));

// ── Suspicious activity reports ─────────────────────────────────────────
router.get('/sar', h(async (req, res) => res.json({ reports: await svc.sar().list({ status: req.query.status || null, limit: req.query.limit }) })));
router.post('/sar', h(async (req, res) => {
  res.status(201).json({ report: await svc.sar().createDraft({ actorUserId: req.user.id, caseIds: req.body?.caseIds, narrative: req.body?.narrative }) });
}));
router.patch('/sar/:id', h(async (req, res) => {
  res.json({ report: await svc.sar().updateDraft({ actorUserId: req.user.id, sarId: uuid(req.params.id), ...(req.body || {}) }) });
}));
router.post('/sar/:id/submit', h(async (req, res) => res.json(await svc.sar().submitForApproval({ actorUserId: req.user.id, sarId: uuid(req.params.id) }))));
router.post('/sar/:id/return', h(async (req, res) => res.json({ report: await svc.sar().returnToDraft({ actorUserId: req.user.id, sarId: uuid(req.params.id) }) })));
router.post('/sar/:id/file', h(async (req, res) => {
  res.json({ report: await svc.sar().markFiled({ actorUserId: req.user.id, sarId: uuid(req.params.id), filingReference: req.body?.filingReference }) });
}));
router.post('/sar/:id/withdraw', h(async (req, res) => {
  res.json({ report: await svc.sar().withdraw({ actorUserId: req.user.id, sarId: uuid(req.params.id), reason: req.body?.reason }) });
}));
router.get('/sar/:id/pack', h(async (req, res) => {
  const pack = await svc.sar().buildFilingPack(uuid(req.params.id));
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="sar-${req.params.id}.json"`);
  res.set('X-Content-SHA256', pack.sha256);
  res.send(pack.json);
}));

// ── KYC requirements, limits ────────────────────────────────────────────
router.get('/kyc/requirements', h(async (req, res) => res.json({ requirements: await svc.kyc().listOpen({ limit: req.query.limit }) })));
router.get('/limits', h(async (req, res) => res.json(await svc.limits().listLimitConfiguration())));

// ── In-house bank payout rail ───────────────────────────────────────────
router.get('/bank-payouts', h(async (req, res) => {
  res.json({ instructions: await svc.bank().listInstructions({ status: req.query.status || null, countryCode: req.query.country || null, limit: req.query.limit }) });
}));
router.post('/bank-payouts/export', h(async (req, res) => {
  const out = await svc.bank().exportBatch({ actorUserId: req.user.id, countryCode: req.body?.countryCode, currencyCode: req.body?.currencyCode, requestIp: req.ip || null });
  res.json(out);
}));
router.post('/bank-payouts/:id/confirm', h(async (req, res) => {
  res.json(await svc.bank().confirmInstruction({
    actorUserId: req.user.id, instructionId: String(req.params.id), outcome: req.body?.outcome,
    bankReference: req.body?.bankReference || null, failureCode: req.body?.failureCode || null, requestIp: req.ip || null,
  }));
}));

// ── Held cash-outs (release = oversight action 'credit_cashout_release') ─
router.get('/cashouts/held', h(async (req, res) => res.json({ cashouts: await svc.cashout().listHeldCashouts({ limit: req.query.limit }) })));
router.post('/cashouts/:id/reject', h(async (req, res) => {
  res.json(await svc.cashout().rejectHeldCashout({ cashoutId: String(req.params.id), actorUserId: req.user.id, reason: req.body?.reason, requestIp: req.ip || null }));
}));

// ── Official FX reference rates ─────────────────────────────────────────
router.get('/fx/reference-rates', h(async (req, res) => {
  const { rows } = await require('../db').query(
    `SELECT id, source, base_currency, quote_currency, units_per_base, rate_date, fetched_at, entered_by, approved_by, note
       FROM credit_fx_reference_rates ORDER BY rate_date DESC, fetched_at DESC LIMIT 60`
  );
  res.json({ rates: rows });
}));
router.post('/fx/refresh', h(async (req, res) => {
  res.json({ rate: await require('../services/fx/brhReferenceRate').refreshBrhReferenceRate(require('../db')) });
}));

module.exports = router;
