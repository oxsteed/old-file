// server/routes/modePlatformApprovals.js
//
// Two routers exported via the registration helper below — mounted in
// server/index.js at:
//   app.use('/api/mode-approvals',   userRouter)
//   app.use('/api/admin',            adminRouter)
//
// WP-104 note: the ModeApprovals admin page is deleted, but these endpoints
// stay. The access review queue does not decide mode approvals yet, the
// consulting gates (requirePlatformApproval, consultantGate) still read
// these policies and approval rows at runtime, PlatformApprovalBanner /
// PlatformApprovalModal still surface them, and ModePolicies is the only
// editor for the policy rows. Deleting the admin queue endpoints before the
// review queue covers mode approvals would strand pending requests with no
// way to decide them, so the whole module stays until that coverage lands.

'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/adminAuth');
const ctrl = require('../controllers/modePlatformApprovalController');

const userRouter = express.Router();

// Public — anyone authenticated. Used by PlatformApprovalBanner /
// PlatformApprovalModal to render "you need approval" prompts and requests.
userRouter.get('/policies', authenticate, ctrl.listPublicPolicies);
userRouter.get('/me',                authenticate, ctrl.listMine);
userRouter.get('/me/:mode',          authenticate, ctrl.getMine);
userRouter.post('/me/:mode/request', authenticate, ctrl.requestMine);

const adminRouter = express.Router();

// Super-admin policy editing
adminRouter.get('/mode-policies',          authenticate, requireSuperAdmin, ctrl.adminListPolicies);
adminRouter.get('/mode-policies/coverage', authenticate, requireSuperAdmin, ctrl.adminListPolicyCoverage);
adminRouter.get('/mode-policies/:mode/revisions', authenticate, requireSuperAdmin, ctrl.adminListPolicyRevisions);
adminRouter.patch('/mode-policies/:mode',  authenticate, requireSuperAdmin, ctrl.adminUpdatePolicy);
adminRouter.post('/mode-policies/:mode/rollback', authenticate, requireSuperAdmin, ctrl.adminRollbackPolicy);

// Super-admin approval queue
adminRouter.get('/mode-approvals',                  authenticate, requireSuperAdmin, ctrl.adminListApprovals);
adminRouter.get('/mode-approvals/:id',              authenticate, requireSuperAdmin, ctrl.adminGetApproval);
adminRouter.post('/mode-approvals/:id/approve',     authenticate, requireSuperAdmin, ctrl.adminDecide('approve'));
adminRouter.post('/mode-approvals/:id/reject',      authenticate, requireSuperAdmin, ctrl.adminDecide('reject'));
adminRouter.post('/mode-approvals/:id/revoke',      authenticate, requireSuperAdmin, ctrl.adminDecide('revoke'));

module.exports = { userRouter, adminRouter };
