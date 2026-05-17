const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessRecurringBillingController');

router.get('/:businessId/recurring-billing', requireAuth, ctrl.list);
router.post('/:businessId/recurring-billing', requireAuth, ctrl.create);
router.put('/:businessId/recurring-billing/:id', requireAuth, ctrl.update);
router.patch('/:businessId/recurring-billing/:id/toggle', requireAuth, ctrl.toggleStatus);
router.delete('/:businessId/recurring-billing/:id', requireAuth, ctrl.remove);
router.post('/:businessId/recurring-billing/:id/generate-invoice', requireAuth, ctrl.generateInvoice);

module.exports = router;
