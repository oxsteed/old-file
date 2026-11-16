const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
// WP-052: lead access is permission-scoped (leads.view / leads.create / leads.edit,
// quotes.create); outreach (broadcasts) stays a separate manager capability.
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/businessLeadPipelineController');

// Legacy alias used by older mobile/web clients.
// Keep it protected: the controller is intentionally thin and relies on route-layer tenancy checks.
router.get('/:businessId/lead-pipeline', requireAuth, requireBusinessAccess({ minRole: 'any' }), requirePermission('leads.view'), ctrl.listLeads);
router.patch('/:businessId/lead-pipeline/:id', requireAuth, requireBusinessAccess({ minRole: 'any' }), requirePermission('leads.edit'), ctrl.updateLead);
router.patch('/:businessId/lead-pipeline/:id/notes', requireAuth, requireBusinessAccess({ minRole: 'any' }), requirePermission('leads.edit'), ctrl.addNote);
router.post('/:businessId/lead-pipeline/:id/to-quote', requireAuth, requireBusinessAccess({ minRole: 'any' }), requirePermission(['quotes.create']), ctrl.createLeadQuote);

module.exports = router;
