const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessRecurringBillingController');

router.get(
  '/:businessId/recurring-billing',
  requireAuth,
  requireBusinessAccess({ minRole: 'manager' }),
  ctrl.listRecurring
);
router.post(
  '/:businessId/recurring-billing',
  requireAuth,
  requireBusinessAccess({ minRole: 'manager' }),
  ctrl.createRecurring
);
router.put(
  '/:businessId/recurring-billing/:id',
  requireAuth,
  requireBusinessAccess({ minRole: 'manager' }),
  ctrl.updateRecurring
);
router.patch(
  '/:businessId/recurring-billing/:id/toggle',
  requireAuth,
  requireBusinessAccess({ minRole: 'manager' }),
  ctrl.toggleStatus
);
router.delete(
  '/:businessId/recurring-billing/:id',
  requireAuth,
  requireBusinessAccess({ minRole: 'manager' }),
  ctrl.deleteRecurring
);
router.post(
  '/:businessId/recurring-billing/:id/generate-invoice',
  requireAuth,
  requireBusinessAccess({ minRole: 'manager' }),
  ctrl.generateInvoice
);

module.exports = router;
