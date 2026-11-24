const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { requireFinanceRead, requireFinanceWrite } = require('../middleware/requireBusinessFinance');
const refundRequests = require('../controllers/businessRefundRequestController');
const topupController = require('../controllers/oxsteedCreditTopupController');
const { creditMutationLimiter } = require('../middleware/rateLimiter');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const checkRestrictions = require('../middleware/checkRestrictions');
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
const standards=require('../services/businessQuoteStandards');
const standardHandler=fn=>async(req,res,next)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(error){next(error);}};
router.get('/:businessId/quote-standards',requireAuth,financeMember,financeRead,standardHandler(async(req,res)=>res.json(await standards.read(req.business.id))));
router.put('/:businessId/quote-standards',requireAuth,rejectImpersonated,financeMember,financeWrite,standardHandler(async(req,res)=>res.json({defaults:await standards.save(req.business.id,req.body)})));
router.post('/:businessId/quote-templates',requireAuth,rejectImpersonated,financeMember,financeWrite,standardHandler(async(req,res)=>res.status(201).json({template:await standards.saveTemplate(req.business.id,req.body)})));
router.put('/:businessId/quote-templates/:templateId',requireAuth,rejectImpersonated,financeMember,financeWrite,standardHandler(async(req,res)=>res.json({template:await standards.saveTemplate(req.business.id,req.body,req.params.templateId)})));
router.delete('/:businessId/quote-templates/:templateId',requireAuth,rejectImpersonated,financeMember,financeWrite,standardHandler(async(req,res)=>{await standards.remove(req.business.id,req.params.templateId,req.body.expectedVersion);res.sendStatus(204);}));

// G-20: business-initiated refund requests. Gated on refunds.request
// (managers hold it by default; representatives only by explicit override).
// Requests always queue for platform-admin approval (refunds.approve step in
// the Money Approvals queue); the requester can never execute the refund.
const refundRequestGate = requireFinanceWrite('refunds.request');
router.post  ('/:businessId/jobs/:jobId/refund-request',  requireAuth, financeMember, refundRequestGate, refundRequests.requestRefund);
router.get   ('/:businessId/jobs/:jobId/refund-requests', requireAuth, financeMember, financeRead, refundRequests.listRefundRequests);

// G-22: business-funded Credit. The owner/manager pays with the business
// payment method (their own card via the returned client secret) and the
// named member is credited. The controller enforces the owner/manager
// gate; the self-service /api/oxsteed-credit/topups route is untouched.
router.post  ('/:businessId/credit-topups',          requireAuth, financeMember, creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), topupController.createBusinessTopup);
router.get   ('/:businessId/credit-topups',          requireAuth, financeMember, topupController.listBusinessTopups);
router.get   ('/:businessId/credit-topups/:topupId', requireAuth, financeMember, topupController.getBusinessTopup);
// Group 13, item 680 (D-379): the funder retries a failed business-funded
// top-up from its own record — same gates as funding one.
router.post  ('/:businessId/credit-topups/:topupId/retry', requireAuth, financeMember, creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), topupController.retryBusinessTopup);

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
