'use strict';

/**
 * Signup provisioning requests (PR #804 G-4 / G-23 / G-35).
 *   app.use('/api/me', meRouter)                                applicant
 *   app.use('/api/admin/signup-provisioning-requests', adminRouter) reviewers
 *
 * Thin HTTP layer: validation, flags and error mapping. The service owns
 * authority; a decision here grants nothing by itself.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const logger = require('../utils/logger');
const service = require('../services/signupProvisioningService');

function fail(res, e, ctx) {
  const status = e && (e.statusCode || e.status);
  if (status && status < 500 && e.code) {
    return res.status(status).json({ error: e.message, code: e.code });
  }
  logger.error('signup provisioning request failed', { ctx, error: e && e.message, code: e && e.code });
  return res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal_error' });
}

const wrap = (ctx, fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { return fail(res, e, ctx); }
};

const meRouter = express.Router();

meRouter.get('/signup-provisioning-requests', authenticate, wrap('me.provisioning.list', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return res.json({ requests: await service.listMine(req.user.id) });
}));

// Only the partner invite-only path creates a request from the client: a
// non-helper who picks the partner card asks for partner access. Staff and
// device requests are created by signup itself (signupIntent.finalize), so
// they cannot be re-created from here.
meRouter.post('/signup-provisioning-requests', authenticate, rejectImpersonated, wrap('me.provisioning.create', async (req, res) => {
  const body = req.body || {};
  if (body.kind !== 'partner_application') {
    return res.status(400).json({ error: 'Only a partner application can be requested here.', code: 'validation_failed' });
  }
  const result = await service.createRequest(req.user.id, {
    kind: 'partner_application',
    intent: 'join_partner',
    note: body.note,
  });
  return res.status(result.created ? 201 : 200).json(result);
}));

const adminRouter = express.Router();
adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/', wrap('admin.provisioning.list', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return res.json({ requests: await service.listQueue({ status: req.query.status || 'pending', kind: req.query.kind || null, limit: req.query.limit }) });
}));

adminRouter.post('/:id/approve', rejectImpersonated, wrap('admin.provisioning.approve', async (req, res) => {
  const result = await service.decide({ reviewerId: req.user.id, id: req.params.id, decision: 'approved', note: req.body?.note });
  return res.json(result);
}));

adminRouter.post('/:id/decline', rejectImpersonated, wrap('admin.provisioning.decline', async (req, res) => {
  const result = await service.decide({ reviewerId: req.user.id, id: req.params.id, decision: 'declined', note: req.body?.note });
  return res.json(result);
}));

module.exports = { meRouter, adminRouter };
