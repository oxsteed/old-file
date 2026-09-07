const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireBusinessAccess } = require('../middleware/businessAccess');
const ctrl = require('../controllers/businessQuotesController');

const businessManager = requireBusinessAccess({ minRole: 'manager' });

router.get('/:businessId/quotes', requireAuth, businessManager, ctrl.listQuotes);
router.post('/:businessId/quotes', requireAuth, businessManager, ctrl.createQuote);
router.put('/:businessId/quotes/:id', requireAuth, businessManager, ctrl.updateQuote);
router.post('/:businessId/quotes/:id/send', requireAuth, businessManager, ctrl.sendQuote);
router.post('/:businessId/quotes/:id/convert', requireAuth, businessManager, ctrl.convertToInvoice);
router.delete('/:businessId/quotes/:id', requireAuth, businessManager, ctrl.deleteQuote);

module.exports = router;
