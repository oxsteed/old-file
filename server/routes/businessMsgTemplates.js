const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessMessageTemplatesController');

router.get   ('/:businessId/message-templates',                     requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listTemplates);
router.post  ('/:businessId/message-templates',                     requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createTemplate);
router.put   ('/:businessId/message-templates/:templateId',         requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.updateTemplate);
router.delete('/:businessId/message-templates/:templateId',         requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deleteTemplate);
router.post  ('/:businessId/message-templates/:templateId/use',     requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.incrementUsage);

module.exports = router;
