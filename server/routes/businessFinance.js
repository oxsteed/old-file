const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const expenses = require('../controllers/businessExpensesController');
const quotes = require('../controllers/businessQuotesController');
const recurring = require('../controllers/businessRecurringBillingController');

// Expenses
router.get   ('/:businessId/expenses',               requireAuth, requireBusinessAccess({ minRole: 'manager' }), expenses.listExpenses);
router.post  ('/:businessId/expenses',               requireAuth, requireBusinessAccess({ minRole: 'manager' }), expenses.createExpense);
router.put   ('/:businessId/expenses/:expenseId',    requireAuth, requireBusinessAccess({ minRole: 'manager' }), expenses.updateExpense);
router.delete('/:businessId/expenses/:expenseId',    requireAuth, requireBusinessAccess({ minRole: 'manager' }), expenses.deleteExpense);

// Quotes
router.get   ('/:businessId/quotes',                 requireAuth, requireBusinessAccess({ minRole: 'any' }),     quotes.listQuotes);
router.get   ('/:businessId/quotes/:quoteId',        requireAuth, requireBusinessAccess({ minRole: 'any' }),     quotes.getQuote);
router.post  ('/:businessId/quotes',                 requireAuth, requireBusinessAccess({ minRole: 'any' }),     quotes.createQuote);
router.put   ('/:businessId/quotes/:quoteId',        requireAuth, requireBusinessAccess({ minRole: 'any' }),     quotes.updateQuote);
router.post  ('/:businessId/quotes/:quoteId/send',   requireAuth, requireBusinessAccess({ minRole: 'any' }),     quotes.sendQuote);
router.post  ('/:businessId/quotes/:quoteId/convert', requireAuth, requireBusinessAccess({ minRole: 'any' }),    (req, res, next) => {
  req.params.id = req.params.quoteId;
  return quotes.convertToInvoice(req, res, next);
});
router.delete('/:businessId/quotes/:quoteId',        requireAuth, requireBusinessAccess({ minRole: 'any' }),     quotes.deleteQuote);
// Public quote response (no auth — client clicks link)
router.get   ('/quotes/view/:token',                                                                              quotes.getQuoteByToken);
router.post  ('/quotes/view/:token/respond',                                                                      quotes.respondToQuote);

// Recurring billing
router.get   ('/:businessId/recurring',              requireAuth, requireBusinessAccess({ minRole: 'manager' }), recurring.listRecurring);
router.post  ('/:businessId/recurring',              requireAuth, requireBusinessAccess({ minRole: 'manager' }), recurring.createRecurring);
router.put   ('/:businessId/recurring/:id',          requireAuth, requireBusinessAccess({ minRole: 'manager' }), recurring.updateRecurring);
router.delete('/:businessId/recurring/:id',          requireAuth, requireBusinessAccess({ minRole: 'manager' }), recurring.deleteRecurring);

module.exports = router;
