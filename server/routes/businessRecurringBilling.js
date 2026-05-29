const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessRecurringBillingController');

router.get('/:businessId/recurring-billing', requireAuth, ctrl.listRecurring);
router.post('/:businessId/recurring-billing', requireAuth, ctrl.createRecurring);
router.put('/:businessId/recurring-billing/:id', requireAuth, ctrl.updateRecurring);
router.patch('/:businessId/recurring-billing/:id/toggle', requireAuth, ctrl.toggleStatus);
router.delete('/:businessId/recurring-billing/:id', requireAuth, ctrl.deleteRecurring);
router.post('/:businessId/recurring-billing/:id/generate-invoice', requireAuth, ctrl.generateInvoice);

module.exports = router;
