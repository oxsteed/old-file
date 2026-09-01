'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { generalLimiter } = require('../middleware/rateLimiter');
const quoteCtrl = require('../controllers/quoteRequestsController');
const ctrl = require('../controllers/directController');

router.get('/profile', optionalAuth, ctrl.getProfile);
router.post('/uploads', generalLimiter, upload.single('image'), validateFileUpload, ctrl.uploadDirectAsset);

router.get('/history', authenticate, ctrl.getHistory);
router.get('/account', authenticate, ctrl.getAccount);
router.post('/account/locations', authenticate, ctrl.saveLocation);
router.patch('/account/locations/:locationId', authenticate, ctrl.saveLocation);
router.delete('/account/locations/:locationId', authenticate, ctrl.deleteLocation);

router.post('/requests', generalLimiter, quoteCtrl.createQuoteRequest);
router.get('/requests/:id', authenticate, ctrl.getRequestDetail);
router.get('/requests/:id/messages', authenticate, ctrl.getRequestMessages);
router.post('/requests/:id/messages', authenticate, ctrl.addMessage);
router.post('/requests/:id/accept', authenticate, ctrl.acceptRequest);
router.post('/requests/:id/reject', authenticate, ctrl.rejectRequest);
router.post('/requests/:id/schedule', authenticate, ctrl.scheduleRequest);
router.post('/requests/:id/change', authenticate, ctrl.changeRequest);
router.post('/requests/:id/proof', authenticate, ctrl.submitProof);
router.post('/requests/:id/proof-confirm', authenticate, ctrl.confirmProof);

router.get('/admin/dashboard', authenticate, requireAdmin, ctrl.getAdminDashboard);
router.get('/admin/inbox', authenticate, requireAdmin, ctrl.getAdminInbox);
router.get('/admin/requests/:id', authenticate, requireAdmin, ctrl.getRequestDetail);
router.patch('/admin/requests/:id', authenticate, requireAdmin, quoteCtrl.updateQuoteRequestAdmin);
router.get('/admin/customers/:userId', authenticate, requireAdmin, ctrl.getAdminCustomer);
router.get('/admin/settings', authenticate, requireAdmin, ctrl.getSettings);
router.put('/admin/settings', authenticate, requireAdmin, ctrl.updateSettings);
router.get('/admin/reports', authenticate, requireAdmin, ctrl.getReports);
router.get('/admin/team', authenticate, requireAdmin, ctrl.getTeam);
router.post('/admin/email-test', authenticate, requireAdmin, ctrl.sendAdminTestEmail);

module.exports = router;
