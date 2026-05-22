// server/routes/modePlatformApprovals.js
//
// Two routers exported via the registration helper below — mounted in
// server/index.js at:
//   app.use('/api/mode-approvals',   userRouter)
//   app.use('/api/admin',            adminRouter)

'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/adminAuth');
const ctrl = require('../controllers/modePlatformApprovalController');

const userRouter = express.Router();

// Public — anyone authenticated. Used by the navbar Mode Switcher + the
// Settings → Account Type panel to render "you need approval" prompts.
userRouter.get('/policies', authenticate, ctrl.listPublicPolicies);
userRouter.get('/me',                authenticate, ctrl.listMine);
userRouter.get('/me/:mode',          authenticate, ctrl.getMine);
userRouter.post('/me/:mode/request', authenticate, ctrl.requestMine);

const adminRouter = express.Router();

// Super-admin policy editing
adminRouter.get('/mode-policies',          authenticate, requireSuperAdmin, ctrl.adminListPolicies);
adminRouter.patch('/mode-policies/:mode',  authenticate, requireSuperAdmin, ctrl.adminUpdatePolicy);

// Super-admin approval queue
adminRouter.get('/mode-approvals',                  authenticate, requireSuperAdmin, ctrl.adminListApprovals);
adminRouter.post('/mode-approvals/:id/approve',     authenticate, requireSuperAdmin, ctrl.adminDecide('approve'));
adminRouter.post('/mode-approvals/:id/reject',      authenticate, requireSuperAdmin, ctrl.adminDecide('reject'));
adminRouter.post('/mode-approvals/:id/revoke',      authenticate, requireSuperAdmin, ctrl.adminDecide('revoke'));

module.exports = { userRouter, adminRouter };
