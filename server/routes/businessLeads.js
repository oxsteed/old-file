const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
// WP-052: lead access is permission-scoped (leads.view / leads.create / leads.edit,
// quotes.create); outreach (broadcasts) stays a separate manager capability.
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/businessLeadPipelineController');

router.get   ('/:businessId/leads',                       requireAuth, requireBusinessAccess({ minRole: 'any' }), requirePermission('leads.view'),     ctrl.listLeads);
router.get   ('/:businessId/leads/:leadId',               requireAuth, requireBusinessAccess({ minRole: 'any' }), requirePermission('leads.view'),     ctrl.getLead);
router.post  ('/:businessId/leads',                       requireAuth, requireBusinessAccess({ minRole: 'any' }), requirePermission('leads.create'),     ctrl.createLead);
router.put   ('/:businessId/leads/:leadId',               requireAuth, requireBusinessAccess({ minRole: 'any' }), requirePermission('leads.edit'),     ctrl.updateLead);
router.delete('/:businessId/leads/:leadId',               requireAuth, requireBusinessAccess({ minRole: 'any' }), requirePermission('leads.edit'),     ctrl.deleteLead);
router.post  ('/:businessId/leads/:leadId/quotes',        requireAuth, requireBusinessAccess({ minRole: 'any' }), requirePermission(['quotes.create']),     ctrl.createLeadQuote);

module.exports = router;
