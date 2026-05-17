const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessLeadPipelineController');

router.get   ('/:businessId/leads',                       requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listLeads);
router.get   ('/:businessId/leads/:leadId',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.getLead);
router.post  ('/:businessId/leads',                       requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.createLead);
router.put   ('/:businessId/leads/:leadId',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.updateLead);
router.delete('/:businessId/leads/:leadId',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.deleteLead);
router.post  ('/:businessId/leads/:leadId/quotes',        requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.createLeadQuote);

module.exports = router;
