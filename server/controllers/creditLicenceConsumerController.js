'use strict';

/**
 * Customer- and helper-facing licence-readiness endpoints (review §7, §8,
 * §10): disclosures and their acceptance, wage-payment consent, cash-out
 * "not received" disputes, the unclaimed-property choice before erasure,
 * and the public wind-down status. Mounted under /api/payment-layers.
 */

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const svc = {
  disclosures: () => require('../services/creditCompliance/disclosureService'),
  wage: () => require('../services/creditCompliance/wageConsentService'),
  disputes: () => require('../services/creditCompliance/disputeSlaService'),
  dormancy: () => require('../services/creditCompliance/dormancyService'),
};

function idempotencyKey(req) {
  return String(req.get('Idempotency-Key') || req.body?.idempotency_key || '').trim().slice(0, 160) || null;
}

function language(req) {
  return req.query.lang || req.body?.language || req.user?.preferred_language || req.get('Accept-Language') || 'en';
}

function currency(req) {
  const c = String(req.query.currency || req.body?.currency || req.user?.preferred_currency || 'USD').toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'USD';
}

exports.getDisclosures = wrap(async (req, res) => {
  const d = svc.disclosures();
  const requested = String(req.query.kinds || '').split(',').map((k) => k.trim()).filter(Boolean);
  const kinds = requested.length ? requested.filter((k) => d.KINDS.includes(k)) : d.KINDS;
  const items = await d.getDisclosureSet(language(req), { kinds, currency: currency(req), userId: req.user?.id || null });
  res.json({ disclosures: items, pre_acquisition: d.PRE_ACQUISITION });
});

exports.acceptDisclosures = wrap(async (req, res) => {
  const accepted = await svc.disclosures().acceptDisclosures({
    user: req.user, language: language(req), currency: currency(req), items: req.body?.items,
    context: req.body?.context || 'pre_acquisition', requestIp: req.ip || null, userAgent: req.get('User-Agent') || null,
  });
  res.status(201).json({ accepted });
});

exports.getWageConsent = wrap(async (req, res) => {
  res.json(await svc.wage().getWageConsent({ user: req.user, language: language(req), currency: currency(req) }));
});

exports.grantWageConsent = wrap(async (req, res) => {
  const result = await svc.wage().grantConsent({
    user: req.user, language: language(req), currency: currency(req), termsSha256: req.body?.terms_sha256,
    isImpersonated: Boolean(req.isImpersonated), requestIp: req.ip || null, userAgent: req.get('User-Agent') || null,
  });
  res.status(201).json(result);
});

exports.withdrawWageConsent = wrap(async (req, res) => {
  const result = await svc.wage().withdrawConsent({
    user: req.user, language: language(req), alternativeMethod: req.body?.alternative_method,
    isImpersonated: Boolean(req.isImpersonated), requestIp: req.ip || null, userAgent: req.get('User-Agent') || null,
  });
  res.status(201).json(result);
});

exports.listCashoutDisputes = wrap(async (req, res) => {
  res.json({ disputes: await svc.disputes().listCashoutDisputesForUser(req.user) });
});

exports.openCashoutDispute = wrap(async (req, res) => {
  const dispute = await svc.disputes().openCashoutDispute({
    user: req.user, cashoutId: req.params.id, description: req.body?.description, idempotencyKey: idempotencyKey(req),
    isImpersonated: Boolean(req.isImpersonated), requestIp: req.ip || null,
  });
  res.status(201).json({ dispute });
});

exports.chooseErasureDisposition = wrap(async (req, res) => {
  if (req.body?.choice !== 'unclaimed_property') {
    res.status(400).json({ error: 'Choose unclaimed_property, or cash out your balance first', code: 'validation_failed' });
    return;
  }
  const cases = await svc.dormancy().consentErasureDisposition({ user: req.user, isImpersonated: Boolean(req.isImpersonated), requestIp: req.ip || null });
  res.status(201).json({ cases });
});

exports.getWindDownStatus = wrap(async (req, res) => {
  const pool = require('../db');
  const { rows } = await pool.query(`SELECT redemption_deadline::text AS deadline, started_at FROM credit_wind_down_plans WHERE status = 'active' LIMIT 1`);
  res.json({ active: Boolean(rows[0]), deadline: rows[0]?.deadline || null, started_at: rows[0]?.started_at || null });
});
