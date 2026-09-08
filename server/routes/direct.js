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
router.get('/catalog', generalLimiter, ctrl.getCatalog);
router.get('/service-areas', generalLimiter, ctrl.getServiceAreas);
router.post('/service-availability', generalLimiter, ctrl.checkServiceAvailability);
router.post('/uploads', generalLimiter, upload.single('image'), validateFileUpload, ctrl.uploadDirectAsset);
router.post('/public/lookup', generalLimiter, ctrl.lookupPublicQuote);
router.post('/public/lookup/send-code', generalLimiter, ctrl.sendPublicLookupCode);
router.post('/public/lookup/verify-code', generalLimiter, ctrl.verifyPublicLookupCode);

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
router.get('/admin/catalog', authenticate, requireAdmin, ctrl.getAdminCatalog);
router.post('/admin/catalog/categories', authenticate, requireAdmin, generalLimiter, ctrl.createAdminCatalogCategory);
router.patch('/admin/catalog/categories/:id', authenticate, requireAdmin, generalLimiter, ctrl.updateAdminCatalogCategory);
router.post('/admin/catalog/services', authenticate, requireAdmin, generalLimiter, ctrl.createAdminCatalogService);
router.patch('/admin/catalog/services/:id', authenticate, requireAdmin, generalLimiter, ctrl.updateAdminCatalogService);
router.post('/admin/catalog/tools', authenticate, requireAdmin, generalLimiter, ctrl.createAdminCatalogTool);
router.patch('/admin/catalog/tools/:id', authenticate, requireAdmin, generalLimiter, ctrl.updateAdminCatalogTool);
router.patch('/admin/catalog/:entity/:id/archive', authenticate, requireAdmin, generalLimiter, ctrl.archiveAdminCatalogEntity);
router.post('/admin/catalog/ai/preview', authenticate, requireAdmin, generalLimiter, ctrl.previewAdminCatalogAI);
router.post('/admin/catalog/ai/apply', authenticate, requireAdmin, generalLimiter, ctrl.applyAdminCatalogAI);
router.get('/admin/service-areas', authenticate, requireAdmin, ctrl.getAdminServiceAreas);
router.post('/admin/service-areas', authenticate, requireAdmin, ctrl.createAdminServiceArea);
router.patch('/admin/service-areas/:id', authenticate, requireAdmin, ctrl.updateAdminServiceArea);
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
