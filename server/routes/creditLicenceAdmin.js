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
  disputes: () => require('../services/creditCompliance/disputeSlaService'),
  disclosures: () => require('../services/creditCompliance/disclosureService'),
  wage: () => require('../services/creditCompliance/wageConsentService'),
  dormancy: () => require('../services/creditCompliance/dormancyService'),
  access: () => require('../services/creditCompliance/accessReviewService'),
  reports: () => require('../services/creditCompliance/reportPackService'),
  anchors: () => require('../services/creditCompliance/auditAnchorService'),
  windDown: () => require('../services/creditCompliance/windDownService'),
};
/**
 * Sensitive reads are audited before anything is sent (gap fill 4). The
 * audit insert throws on failure, so a read that cannot be recorded is not
 * served (same rule as report pack downloads).
 */
async function auditRead(req, { actionType, resourceType, resourceId, reason = null, customerId = null, metadata = {} }) {
  const { insertComplianceAudit } = require('../services/creditCompliance/audit');
  await insertComplianceAudit(require('../db'), {
    actionType, actorUserId: req.user.id, customerId, resourceType, resourceId: String(resourceId), reason,
    requestIp: req.ip || null, correlationId: req.correlationId || req.get?.('X-Request-ID') || null, metadata,
  });
}
const sha256 = (value) => require('crypto').createHash('sha256').update(String(value)).digest('hex');

const digits = (v, name = 'id') => {
  const s = String(v || '');
  if (!/^\d{1,18}$/.test(s)) throw new AppError(`Invalid ${name}`, 400, 'validation_failed');
  return s;
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
  const id = uuid(req.params.id);
  const details = await svc.lists().getScreeningMatchDetails(require('../db'), id);
  await auditRead(req, {
    actionType: 'credit.sanctions.matches_viewed', resourceType: 'credit_sanctions_screening', resourceId: id,
    customerId: details.screening.subject_type === 'customer' ? details.screening.subject_id : null,
    metadata: { matches: details.matches.length, subjectType: details.screening.subject_type },
  });
  res.json(details);
}));
router.get('/sanctions/custom', h(async (req, res) => {
  res.json({ entries: await svc.lists().listCustomEntries() });
}));
router.get('/sanctions/search', h(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 200);
  const matches = await svc.lists().searchName(require('../db'), q, { threshold: 0.8 });
  // The searched name is personal data: the audit keeps its hash and length,
  // enough to prove what was searched without copying the name around.
  await auditRead(req, {
    actionType: 'credit.sanctions.name_searched', resourceType: 'credit_sanctions_search', resourceId: sha256(q.trim().toLowerCase()).slice(0, 32),
    metadata: { querySha256: sha256(q.trim().toLowerCase()), queryLength: q.trim().length, results: matches.length },
  });
  res.json({ matches });
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
  await auditRead(req, {
    actionType: 'credit.safeguarding.exported', resourceType: 'credit_safeguarding_export', resourceId: `${from}..${to}`,
    metadata: { from, to, sha256: out.sha256 },
  });
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
  const id = uuid(req.params.id);
  const pack = await svc.sar().buildFilingPack(id);
  await auditRead(req, {
    actionType: 'credit.sar.pack_downloaded', resourceType: 'credit_sar', resourceId: id, metadata: { sha256: pack.sha256 },
  });
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

// ── Consumer protection (§7) ────────────────────────────────────────────
router.get('/disputes/clocks', h(async (req, res) => res.json({ disputes: await svc.disputes().listDisputeClocks({ limit: req.query.limit }) })));
router.post('/disputes/sweep', h(async (req, res) => res.json(await svc.disputes().runSlaSweep())));
router.get('/cashout-disputes', h(async (req, res) => {
  res.json({ disputes: await svc.disputes().listCashoutDisputes({ status: req.query.status || null, limit: req.query.limit }) });
}));
router.get('/business-holidays', h(async (req, res) => {
  res.json({ holidays: await svc.disputes().listHolidays({ countryCode: /^[A-Z]{2}$/.test(String(req.query.country || '')) ? req.query.country : null }) });
}));
router.get('/disclosures', h(async (req, res) => {
  const lang = svc.disclosures().normalizeLang(req.query.lang || 'en');
  res.json({
    current: await svc.disclosures().getDisclosureSet(lang, { currency: String(req.query.currency || 'USD').toUpperCase() }),
    versions: await svc.disclosures().listVersions({ kind: req.query.kind || null }),
  });
}));
router.get('/wage-consent/summary', h(async (req, res) => res.json(await svc.wage().summary())));

// ── Dormancy and escheat (§8) ───────────────────────────────────────────
router.get('/dormancy', h(async (req, res) => {
  res.json({
    summary: await svc.dormancy().summary(),
    policies: await svc.dormancy().listPolicies(),
    cases: await svc.dormancy().listCases({ status: req.query.status || null, limit: req.query.limit }),
  });
}));
router.post('/dormancy/sweep', h(async (req, res) => res.json(await svc.dormancy().runDormancySweep())));

// ── Access reviews, report packs, audit anchors (§9) ────────────────────
router.get('/access-reviews', h(async (req, res) => res.json({ reviews: await svc.access().listReviews() })));
router.post('/access-reviews/ensure', h(async (req, res) => res.json(await svc.access().ensureCurrentReview())));
router.get('/access-reviews/:id', h(async (req, res) => res.json(await svc.access().getReview(digits(req.params.id)))));
router.post('/access-reviews/:id/items/:itemId/decision', h(async (req, res) => {
  res.json({ item: await svc.access().decideItem({
    reviewId: digits(req.params.id), itemId: digits(req.params.itemId, 'item'), decision: req.body?.decision,
    note: req.body?.note || null, actorUserId: req.user.id, requestIp: req.ip || null,
  }) });
}));
router.get('/report-packs', h(async (req, res) => {
  res.json({ types: svc.reports().PACK_TYPES, packs: await svc.reports().listPacks({ packType: req.query.type || null, limit: req.query.limit }) });
}));
router.post('/report-packs', h(async (req, res) => {
  res.status(201).json({ pack: await svc.reports().generatePack({
    packType: req.body?.packType, from: req.body?.from, to: req.body?.to, actorUserId: req.user.id, requestIp: req.ip || null,
  }) });
}));
router.get('/report-packs/:id/files/:name', h(async (req, res) => {
  const name = String(req.params.name || '');
  if (!/^[a-z_]{1,60}\.csv$/.test(name)) throw new AppError('Invalid file', 400, 'validation_failed');
  const file = await svc.reports().getPackFile({ packId: digits(req.params.id), fileName: name, actorUserId: req.user.id, requestIp: req.ip || null });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.set('X-Pack-SHA256', file.sha256);
  res.send(file.content);
}));
router.get('/audit-anchors', h(async (req, res) => res.json({ anchors: await svc.anchors().listAnchors({ limit: req.query.limit }) })));
router.post('/audit-anchors/run', h(async (req, res) => res.json(await svc.anchors().anchorAuditChains())));
router.post('/audit-anchors/verify', h(async (req, res) => res.json({ results: await svc.anchors().verifyAnchors({ limit: req.body?.limit || 30 }) })));
router.get('/audit-anchors/:date', h(async (req, res) => {
  const date = String(req.params.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('Invalid date', 400, 'validation_failed');
  const anchor = await svc.anchors().getAnchor(date);
  if (!anchor) throw new AppError('Anchor not found', 404, 'credit_audit_anchor_not_found');
  await auditRead(req, {
    actionType: 'credit.audit_anchor.viewed', resourceType: 'credit_audit_anchor', resourceId: date, metadata: { sha256: anchor.payload_sha256 },
  });
  res.json(anchor);
}));

// ── Wind-down (§10) ─────────────────────────────────────────────────────
router.get('/wind-down', h(async (req, res) => res.json(await svc.windDown().getStatus())));
router.get('/wind-down/:id/holders', h(async (req, res) => {
  const planId = digits(req.params.id);
  const status = req.query.status ? String(req.query.status).slice(0, 20) : null;
  const holders = await svc.windDown().listHolders({ planId, status, limit: req.query.limit, afterId: req.query.after_id || null });
  await auditRead(req, {
    actionType: 'credit.wind_down.holders_viewed', resourceType: 'credit_wind_down_plan', resourceId: planId,
    metadata: { status, afterId: req.query.after_id || null, rows: holders.length },
  });
  res.json({ holders });
}));
router.post('/wind-down/:id/notify', h(async (req, res) => {
  res.json(await svc.windDown().notifyHolders({ planId: digits(req.params.id), actorUserId: req.user.id, limit: req.body?.limit }));
}));

module.exports = router;
