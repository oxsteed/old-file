'use strict';

/**
 * Progressive account access routes.
 *   app.use('/api/me', meRouter)                       applicant
 *   app.use('/api/admin/access-requests', adminRouter) reviewers
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const ctrl = require('../controllers/progressiveAccessController');

// Per-user write budget for application mutations.
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => `access-write:${req.user ? req.user.id : req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.', code: 'rate_limited' },
  validate: false,
});

const meRouter = express.Router();
meRouter.get('/access', authenticate, ctrl.requireProjectionFlag, ctrl.getAccess);
meRouter.get('/access-grants', authenticate, ctrl.requireProjectionFlag, ctrl.listMyGrants);
meRouter.get('/access-policies', authenticate, ctrl.requireRequestsFlag, ctrl.listPolicies);
meRouter.get('/access-policies/:capability', authenticate, ctrl.requireRequestsFlag, ctrl.getPolicy);
meRouter.get('/access-requests', authenticate, ctrl.requireRequestsFlag, ctrl.listMine);
meRouter.post('/access-requests', authenticate, ctrl.requireRequestsFlag, rejectImpersonated, writeLimiter, ctrl.create);
meRouter.get('/access-requests/:id', authenticate, ctrl.requireRequestsFlag, ctrl.getMine);
meRouter.patch('/access-requests/:id', authenticate, ctrl.requireRequestsFlag, rejectImpersonated, writeLimiter, ctrl.transition('update'));
meRouter.post('/access-requests/:id/submit', authenticate, ctrl.requireRequestsFlag, rejectImpersonated, writeLimiter, ctrl.transition('submit'));
meRouter.post('/access-requests/:id/resubmit', authenticate, ctrl.requireRequestsFlag, rejectImpersonated, writeLimiter, ctrl.transition('resubmit'));
meRouter.post('/access-requests/:id/withdraw', authenticate, ctrl.requireRequestsFlag, rejectImpersonated, writeLimiter, ctrl.transition('withdraw'));

const adminRouter = express.Router();
adminRouter.use(requireAdmin, ctrl.requireRequestsFlag);
adminRouter.get('/', ctrl.reviewList);
adminRouter.get('/users/:userId/grants', ctrl.userGrants);
adminRouter.post('/grants/:grantId', rejectImpersonated, ctrl.grantChange);
adminRouter.get('/:id', ctrl.reviewGet);
adminRouter.post('/:id/decision', rejectImpersonated, ctrl.reviewDecide);

module.exports = { meRouter, adminRouter };
