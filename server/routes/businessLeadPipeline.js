const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessLeadPipelineController');

// Legacy alias used by older mobile/web clients.
// Keep it protected: the controller is intentionally thin and relies on route-layer tenancy checks.
router.get('/:businessId/lead-pipeline', requireAuth, requireBusinessAccess({ minRole: 'any' }), ctrl.listLeads);
router.patch('/:businessId/lead-pipeline/:id', requireAuth, requireBusinessAccess({ minRole: 'any' }), ctrl.updateLeadStatus);
router.patch('/:businessId/lead-pipeline/:id/notes', requireAuth, requireBusinessAccess({ minRole: 'any' }), ctrl.addNote);
router.post('/:businessId/lead-pipeline/:id/to-quote', requireAuth, requireBusinessAccess({ minRole: 'any' }), ctrl.convertToQuote);

module.exports = router;
