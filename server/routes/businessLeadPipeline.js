const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessLeadPipelineController');

router.get('/:businessId/lead-pipeline', requireAuth, ctrl.listLeads);
router.patch('/:businessId/lead-pipeline/:id', requireAuth, ctrl.updateLeadStatus);
router.patch('/:businessId/lead-pipeline/:id/notes', requireAuth, ctrl.addNote);
router.post('/:businessId/lead-pipeline/:id/to-quote', requireAuth, ctrl.convertToQuote);

module.exports = router;
