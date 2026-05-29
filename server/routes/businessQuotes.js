const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessQuotesController');

router.get('/:businessId/quotes', requireAuth, ctrl.listQuotes);
router.post('/:businessId/quotes', requireAuth, ctrl.createQuote);
router.put('/:businessId/quotes/:id', requireAuth, ctrl.updateQuote);
router.post('/:businessId/quotes/:id/send', requireAuth, ctrl.sendQuote);
router.post('/:businessId/quotes/:id/convert', requireAuth, ctrl.convertToInvoice);
router.delete('/:businessId/quotes/:id', requireAuth, ctrl.deleteQuote);

module.exports = router;
