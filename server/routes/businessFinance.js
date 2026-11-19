const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { requireFinanceRead, requireFinanceWrite } = require('../middleware/requireBusinessFinance');
const expenses = require('../controllers/businessExpensesController');
const quotes = require('../controllers/businessQuotesController');
const recurring = require('../controllers/businessRecurringBillingController');

// G-8: finance reads and writes are gated on the migration-245 permission
// codes, not on the single manager role. Reads admit any active member
// holding a finance read code (invoices.view / payments.view /
// payouts.view, by role default or membership override); writes require
// invoices.create (managers hold it by default; payouts.manage and
// refunds.approve stay owner-or-explicitly-granted and gate their own
// surfaces). Owners hold every code.
const financeMember = requireBusinessAccess({ minRole: 'any' });
const financeRead = requireFinanceRead();
const financeWrite = requireFinanceWrite('invoices.create');

// Expenses
router.get   ('/:businessId/expenses',               requireAuth, financeMember, financeRead, expenses.listExpenses);
router.post  ('/:businessId/expenses',               requireAuth, financeMember, financeWrite, expenses.createExpense);
router.put   ('/:businessId/expenses/:expenseId',    requireAuth, financeMember, financeWrite, expenses.updateExpense);
router.delete('/:businessId/expenses/:expenseId',    requireAuth, financeMember, financeWrite, expenses.deleteExpense);

// Quotes
router.get   ('/:businessId/quotes',                 requireAuth, financeMember, financeRead, quotes.listQuotes);
router.get   ('/:businessId/quotes/:quoteId',        requireAuth, financeMember, financeRead, quotes.getQuote);
router.post  ('/:businessId/quotes',                 requireAuth, financeMember, financeWrite, quotes.createQuote);
router.put   ('/:businessId/quotes/:quoteId',        requireAuth, financeMember, financeWrite, quotes.updateQuote);
router.post  ('/:businessId/quotes/:quoteId/send',   requireAuth, financeMember, financeWrite, quotes.sendQuote);
router.post  ('/:businessId/quotes/:quoteId/convert', requireAuth, financeMember, financeWrite, (req, res, next) => {
  req.params.id = req.params.quoteId;
  return quotes.convertToInvoice(req, res, next);
});
router.delete('/:businessId/quotes/:quoteId',        requireAuth, financeMember, financeWrite, quotes.deleteQuote);
// Public quote response (no auth — client clicks link)
router.get   ('/quotes/view/:token',                                                                              quotes.getQuoteByToken);
router.post  ('/quotes/view/:token/respond',                                                                      quotes.respondToQuote);

// Recurring billing
router.get   ('/:businessId/recurring',              requireAuth, financeMember, financeRead, recurring.listRecurring);
router.post  ('/:businessId/recurring',              requireAuth, financeMember, financeWrite, recurring.createRecurring);
router.put   ('/:businessId/recurring/:id',          requireAuth, financeMember, financeWrite, recurring.updateRecurring);
router.delete('/:businessId/recurring/:id',          requireAuth, financeMember, financeWrite, recurring.deleteRecurring);

module.exports = router;
