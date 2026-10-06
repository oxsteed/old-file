'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { generalLimiter } = require('../middleware/rateLimiter');
const quoteCtrl = require('../controllers/quoteRequestsController');
const ctrl = require('../controllers/directController');

// Audit finding #4: strict per-IP bucket for Direct asset uploads (20 requests
// per 15 minutes). Mirrors the rateLimiter.js configuration pattern. Uploads
// are now authenticated, so anonymous abuse is blocked at the gate before this
// bucket is even reached.
const directUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many file uploads. Please try again later.',
    retryAfter: '15 minutes',
  },
});

// Audit finding (2026-10-06): holds had no auth and no Bookable gate, so
// anyone could park capacity anonymously. Holds are now authenticated and
// the service layer rejects non-bookable services. This bucket is tight on
// purpose: a hold reserves real capacity for ~4 minutes, so 10 per 15 min
// per IP is generous for legitimate use and painful for abuse.
const directHoldLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many hold requests. Please try again later.',
    retryAfter: '15 minutes',
  },
});
// Audit finding #53: bound the photo attachment array before the quote request
// controller runs, so an oversized metadata payload is rejected early with a
// clear 400. Mirrors the controller's own photoAttachments/photos resolution.
const MAX_DIRECT_PHOTO_ATTACHMENTS = 10;
function limitDirectPhotoAttachments(req, res, next) {
  let metadata = req.body?.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return next();
    }
  }
  const effective = metadata?.photoAttachments ?? metadata?.photos;
  if (Array.isArray(effective) && effective.length > MAX_DIRECT_PHOTO_ATTACHMENTS) {
    return res.status(400).json({
      error: `Too many photo attachments. The maximum is ${MAX_DIRECT_PHOTO_ATTACHMENTS}.`,
    });
  }
  return next();
}

router.get('/profile', optionalAuth, ctrl.getProfile);
router.get('/catalog', generalLimiter, ctrl.getCatalog);
router.get('/catalog/services/:id/slots', generalLimiter, ctrl.getServiceSlots);
router.post('/catalog/services/:id/holds', authenticate, directHoldLimiter, ctrl.createServiceHold);
router.post('/catalog/services/:id/book', generalLimiter, ctrl.bookServiceSlot);
router.get('/service-areas', generalLimiter, ctrl.getServiceAreas);
router.post('/service-availability', generalLimiter, ctrl.checkServiceAvailability);
router.post('/uploads', authenticate, directUploadLimiter, upload.single('image'), validateFileUpload, ctrl.uploadDirectAsset);
router.post('/public/lookup', generalLimiter, ctrl.lookupPublicQuote);
router.post('/public/lookup/send-code', generalLimiter, ctrl.sendPublicLookupCode);
router.post('/public/lookup/verify-code', generalLimiter, ctrl.verifyPublicLookupCode);

router.get('/history', authenticate, ctrl.getHistory);
router.get('/account', authenticate, ctrl.getAccount);
router.post('/account/locations', authenticate, ctrl.saveLocation);
router.patch('/account/locations/:locationId', authenticate, ctrl.saveLocation);
router.delete('/account/locations/:locationId', authenticate, ctrl.deleteLocation);

router.post('/requests', generalLimiter, limitDirectPhotoAttachments, quoteCtrl.createQuoteRequest);
router.get('/requests/:id', authenticate, ctrl.getRequestDetail);
router.get('/requests/:id/messages', authenticate, ctrl.getRequestMessages);
router.post('/requests/:id/messages', authenticate, ctrl.addMessage);
router.post('/requests/:id/accept', authenticate, ctrl.acceptRequest);
router.post('/requests/:id/reject', authenticate, ctrl.rejectRequest);
router.post('/requests/:id/schedule', authenticate, ctrl.scheduleRequest);
router.post('/requests/:id/change', authenticate, ctrl.changeRequest);
router.post('/requests/:id/proof', authenticate, ctrl.submitProof);
router.post('/requests/:id/proof-confirm', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.confirmProof);

router.get('/admin/dashboard', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getAdminDashboard);
router.get('/admin/calendar/export.ics', authenticate, requireAdmin, requirePermission('export_data'), ctrl.exportAdminCalendar);
router.get('/admin/calendar/blocks', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getAdminCalendarBlocks);
router.get('/admin/calendar/assignees', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getAdminDispatchAssignees);
router.post('/admin/calendar/blocks', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.createAdminCalendarBlock);
router.patch('/admin/calendar/blocks/:id', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.updateAdminCalendarBlock);
router.delete('/admin/calendar/blocks/:id', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.deleteAdminCalendarBlock);
router.get('/admin/calendar/audit', authenticate, requireAdmin, requirePermission('view_audit_log'), ctrl.getAdminCalendarAudit);
router.get('/admin/catalog', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getAdminCatalog);
router.post('/admin/catalog/categories', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.createAdminCatalogCategory);
router.patch('/admin/catalog/categories/:id', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.updateAdminCatalogCategory);
router.post('/admin/catalog/services', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.createAdminCatalogService);
router.patch('/admin/catalog/services/:id', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.updateAdminCatalogService);
router.get('/admin/catalog/services/:id/assignees', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getAdminServiceAssigneePool);
router.put('/admin/catalog/services/:id/assignees', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.putAdminServiceAssigneePool);
router.post('/admin/catalog/tools', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.createAdminCatalogTool);
router.patch('/admin/catalog/tools/:id', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.updateAdminCatalogTool);
router.patch('/admin/catalog/:entity/:id/archive', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.archiveAdminCatalogEntity);
router.post('/admin/catalog/bulk-transition', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.bulkTransitionAdminCatalog);
router.post('/admin/catalog/ai/preview', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.previewAdminCatalogAI);
router.post('/admin/catalog/ai/apply', authenticate, requireAdmin, requirePermission('manage_operations'), generalLimiter, ctrl.applyAdminCatalogAI);
router.get('/admin/service-areas', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getAdminServiceAreas);
router.post('/admin/service-areas', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.createAdminServiceArea);
router.patch('/admin/service-areas/:id', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.updateAdminServiceArea);
router.get('/admin/inbox', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getAdminInbox);
router.get('/admin/requests/:id', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getRequestDetail);
router.patch('/admin/requests/:id', authenticate, requireAdmin, requirePermission('manage_operations'), quoteCtrl.updateQuoteRequestAdmin);
router.get('/admin/customers/:userId', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getAdminCustomer);
router.get('/admin/settings', authenticate, requireAdmin, requirePermission('manage_settings'), ctrl.getSettings);
router.put('/admin/settings', authenticate, requireAdmin, requirePermission('manage_settings'), ctrl.updateSettings);
router.get('/admin/reports', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getReports);
router.get('/admin/team', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.getTeam);
router.post('/admin/email-test', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.sendAdminTestEmail);

module.exports = router;
