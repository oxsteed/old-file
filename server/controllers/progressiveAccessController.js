'use strict';

/**
 * HTTP layer for progressive account access. Thin: validation, flags and
 * error mapping; all authority lives in services/access/*.
 */

const logger = require('../utils/logger');
const access = require('../services/access/accessService');
const review = require('../services/access/reviewService');
const registry = require('../services/access/policyRegistry');
const flags = require('../services/access/flags');

function send(res, result) {
  if (result.replay) res.set('Idempotent-Replay', 'true');
  return res.status(result.status).json(result.body);
}

function fail(res, e, ctx) {
  const status = e && (e.statusCode || e.status);
  if (status && status < 500 && e.code) {
    const body = { error: e.message, code: e.code };
    if (e.fields && Object.keys(e.fields).length) body.fields = e.fields;
    if (e.requestId) body.requestId = e.requestId;
    if (e.current) body.current = e.current;
    return res.status(status).json(body);
  }
  logger.error('progressive access request failed', { ctx, error: e && e.message, code: e && e.code });
  return res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal_error' });
}

const idemKey = (req) => req.get('Idempotency-Key') || null;
const wrap = (ctx, fn) => async (req, res) => {
  try { return await fn(req, res); } catch (e) { return fail(res, e, ctx); }
};

function requireRequestsFlag(req, res, next) {
  if (flags.requestsEnabled(req.user && req.user.id)) return next();
  return res.status(503).json({ error: 'Applications are not available yet.', code: 'feature_disabled' });
}

function requireProjectionFlag(req, res, next) {
  if (flags.projectionEnabled(req.user && req.user.id)) return next();
  return res.status(503).json({ error: 'Not available yet.', code: 'feature_disabled' });
}

// ── applicant ──────────────────────────────────────────────────────────────
const getAccess = wrap('me.access', async (req, res) => {
  const projection = await access.getProjection(req.user.id);
  const resume = await require('../services/access/signupIntent').pendingIntent(req.user.id);
  res.set('Cache-Control', 'private, no-store');
  return res.json({ accountId: String(req.user.id), access: { ...projection, signupResume: resume }, flags: flags.clientFlags(req.user.id) });
});

const getPolicy = wrap('me.policy', async (req, res) => {
  const p = registry.publicPolicy(req.params.capability);
  if (!p || !p.applicantMayRequest) return res.status(404).json({ error: 'Not found.', code: 'unknown_capability' });
  return res.json({ policy: p });
});

const listPolicies = wrap('me.policies', async (req, res) => {
  const policies = registry.listCapabilities().filter((c) => c.applicantMayRequest).map((c) => registry.publicPolicy(c.key));
  return res.json({ policies });
});

const listMine = wrap('me.requests.list', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return res.json(await access.listMine(req.user.id, { limit: req.query.limit, before: req.query.before }));
});

const getMine = wrap('me.requests.get', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return res.json(await access.getMine(req.user.id, req.params.id));
});

const create = wrap('me.requests.create', async (req, res) => {
  const b = req.body || {};
  return send(res, await access.createRequest(req.user.id, {
    capability: b.capability, subject: b.subject, answers: b.answers, submit: b.submit === true, source: b.source, returnTo: b.returnTo,
  }, { idemKey: idemKey(req) }));
});

const transition = (action) => wrap(`me.requests.${action}`, async (req, res) => {
  const b = req.body || {};
  return send(res, await access.applicantTransition(req.user.id, req.params.id, action, {
    expectedVersion: b.expectedVersion, answers: b.answers, idemKey: idemKey(req),
  }));
});

// ── reviewer ───────────────────────────────────────────────────────────────
const reviewList = wrap('admin.access.list', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return res.json(await review.listQueue(req.user, { status: req.query.status || 'submitted', capability: req.query.capability || null, limit: req.query.limit, after: req.query.after }));
});

const reviewGet = wrap('admin.access.get', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return res.json(await review.getForReview(req.user, req.params.id));
});

const reviewDecide = wrap('admin.access.decide', async (req, res) => {
  const b = req.body || {};
  return send(res, await review.decide(req.user, req.params.id, {
    action: b.decision, expectedVersion: b.expectedVersion, reasonCode: b.reasonCode || null,
    note: b.note ?? null, informationRequest: b.informationRequest ?? null, evidenceRevision: b.evidenceRevision ?? null,
  }, { idemKey: idemKey(req) }));
});

const grantChange = wrap('admin.access.grant', async (req, res) => {
  const b = req.body || {};
  return send(res, await review.changeGrant(req.user, req.params.grantId, {
    action: b.action, expectedVersion: b.expectedVersion, reasonCode: b.reasonCode,
  }, { idemKey: idemKey(req) }));
});

const userGrants = wrap('admin.access.userGrants', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.userId))) return res.status(404).json({ error: 'Not found.', code: 'not_found' });
  return res.json({ grants: await review.listUserGrants(req.user, req.params.userId) });
});

module.exports = {
  requireRequestsFlag, requireProjectionFlag,
  getAccess, getPolicy, listPolicies, listMine, getMine, create, transition,
  reviewList, reviewGet, reviewDecide, grantChange, userGrants,
};
