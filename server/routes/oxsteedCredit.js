'use strict';

const router = require('express').Router();
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const { creditMutationLimiter, creditExportLimiter } = require('../middleware/rateLimiter');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { AppError } = require('../middleware/errorHandler');
const {
  EVIDENCE_MAX_FILE_BYTES,
  EVIDENCE_ALLOWED_MIME_TYPES,
} = require('../services/oxsteedCreditDisputeEvidenceService');
const controller = require('../controllers/oxsteedCreditController');
const cardController = require('../controllers/oxsteedCreditCardController');
const topupController = require('../controllers/oxsteedCreditTopupController');
const withdrawalController = require('../controllers/oxsteedCreditWithdrawalController');
const statementController = require('../controllers/creditStatementController');
const checkRestrictions = require('../middleware/checkRestrictions');

function noStoreCreditResponse(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  next();
}

router.use(authenticate, requireRole('customer'), noStoreCreditResponse);

router.get('/account', controller.getMyAccount);
// Review P2-7-F07: money-initiating credit mutations honor admin checkout
// restrictions, like the other checkout surfaces.
router.post('/conversions', creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), controller.convertMyCredit);
router.post('/conversion-quotes', creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), controller.createMyCurrencyQuote);
router.get('/conversion-quotes/:quoteId', controller.getMyCurrencyQuote);
router.get('/limits', controller.getMyCreditLimits);
router.get('/accounts', controller.getMyAccounts);
router.get('/status', controller.getMyCreditStatus);
router.get('/holds', controller.listMyHolds);
router.get('/eligibility', controller.getCustomerEligibility);
router.get('/identity-verification', controller.getMyIdentityVerification);
router.post('/identity-verification', creditMutationLimiter, rejectImpersonated, controller.requestMyIdentityVerification);
router.post('/identity-verification/:id/appeal', creditMutationLimiter, rejectImpersonated, controller.appealMyIdentityVerification);
router.get('/eligible-partners', controller.getEligiblePartners);
router.get('/statement.csv', creditExportLimiter, controller.downloadMyStatement);
router.get('/statement', controller.getMyStatement);
router.get('/statement-periods', controller.getMyStatementPeriods);
router.get('/documents', creditExportLimiter, statementController.handler('oxsteed'));
router.get('/documents.pdf', creditExportLimiter, statementController.handler('oxsteed', 'pdf'));
router.get('/documents.csv', creditExportLimiter, statementController.handler('oxsteed', 'csv'));
router.get('/account-details', controller.getMyAccountDetails);
router.post('/account-details/letter', creditMutationLimiter, rejectImpersonated, controller.downloadMyAccountLetter);
router.get('/transactions', controller.getMyTransactions);
router.get('/transactions/:transactionId', controller.getMyTransaction);
router.post('/holds', creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), controller.createMyHold);
router.post('/holds/:holdId/release', creditMutationLimiter, rejectImpersonated, controller.releaseMyHold);
// Group 13, item 670 (D-367): re-authorize an expired hold — same gates
// as creating a hold, same existing hold-creation path underneath.
router.post('/holds/:holdId/reauthorize', creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), controller.reauthorizeMyHold);
router.post('/transfers', creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), controller.transferMyCredit);
// Recipient name lookup for the transfer review panel. Read-only; the
// router-level authenticate + requireRole('customer') gate applies.
router.get('/transfer-recipients/:customerId', controller.lookupTransferRecipient);
router.post('/transfer-recipients/resolve', creditMutationLimiter, rejectImpersonated, controller.resolveMyTransferRecipient);
router.get('/disputes', controller.listMyDisputes);
router.post('/disputes', creditMutationLimiter, rejectImpersonated, controller.openMyDispute);
// Group 13, item 674 (D-371/D-372/D-373): customer evidence on their own
// open dispute — a note and/or one file. Memory storage: the file is handed
// to the existing storage backend by the service, never written to disk
// here. The file filter rejects disallowed types before the service runs;
// multer's size limit surfaces as 413 via the shared error handler.
const disputeEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EVIDENCE_MAX_FILE_BYTES, files: 1, fields: 10, parts: 12 },
  fileFilter: (_req, file, cb) => {
    if (EVIDENCE_ALLOWED_MIME_TYPES.includes(String(file.mimetype || '').split(';', 1)[0].trim().toLowerCase())) {
      return cb(null, true);
    }
    return cb(new AppError('That file type cannot be attached as dispute evidence', 400, 'credit_dispute_evidence_file_type_invalid'));
  },
});
router.get('/disputes/:disputeId/evidence', controller.listMyDisputeEvidence);
router.get('/disputes/:disputeId/evidence/:evidenceId/download', controller.downloadMyDisputeEvidence);
router.post(
  '/disputes/:disputeId/evidence',
  creditMutationLimiter,
  rejectImpersonated,
  disputeEvidenceUpload.single('file'),
  controller.submitMyDisputeEvidence
);

// Stripe top-ups (fiat money IN): create a top-up intent and read its status.
router.post('/topups', creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), topupController.createTopup);
router.get('/topups', topupController.listMyTopups);
router.get('/topups/:id', topupController.getTopup);
// Group 13, item 680 (D-376): retry a failed top-up from its own record —
// same gates as creating a top-up, same existing creation path underneath.
router.post('/topups/:id/retry', creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), topupController.retryTopup);
// Step-up challenge issuance for large top-ups (Phase 5 compliance).
router.post('/stepup-challenges', creditMutationLimiter, rejectImpersonated, topupController.issueTopupStepupChallenge);

// Fiat money OUT: customer withdrawals to their connected bank account.
router.post('/withdrawals', creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), withdrawalController.requestWithdrawal);
router.get('/withdrawals', withdrawalController.listMyWithdrawals);
router.post('/withdrawals/:id/cancel', creditMutationLimiter, rejectImpersonated, withdrawalController.cancelMyWithdrawal);
// Restaurant credit conversions (Phase 6): OxSteed <-> restaurant food wallet.
router.post('/restaurant-conversions', creditMutationLimiter, rejectImpersonated, checkRestrictions('checkout'), withdrawalController.createRestaurantConversion);
router.get('/restaurant-conversions', withdrawalController.listMyRestaurantConversions);
// Restaurant conversion allowlist: restaurant ids with the from_restaurant
// direction enabled by OxSteed (gated server-side too; to_restaurant is gated
// server-side on an active credit-partner row).
router.get('/restaurant-conversion-eligibility', withdrawalController.getRestaurantConversionEligibility);
// Fee quotes (Phase 6): what a money-out operation will cost, before confirming.
router.get('/fee-quotes', withdrawalController.getFeeQuote);
// Step-up challenge issuance for customer money-out actions (Phase 6).
router.post('/money-out/stepup-challenges', creditMutationLimiter, rejectImpersonated, withdrawalController.issueMoneyOutStepupChallenge);

// OxSteed Credit card ecosystem: issuance, activation, lifecycle, and PIN
// management. Redemption/cash-out happen from device-authenticated kiosk
// routes (see routes/oxsteedCreditKiosk.js), not here.
router.get('/cards', cardController.listMyCards);
router.post('/cards/:cardId/security-challenges', creditMutationLimiter, rejectImpersonated, cardController.issueMyCardSecurityChallenge);
router.get('/cards/:cardId/history', cardController.myCardHistory);
router.post('/cards/:cardId/found', creditMutationLimiter, rejectImpersonated, cardController.markMyCardFound);
router.post('/cards/:cardId/replacement', creditMutationLimiter, rejectImpersonated, cardController.requestMyReplacement);
router.post('/cards/virtual', creditMutationLimiter, rejectImpersonated, cardController.issueMyVirtualCard);
router.post('/cards/physical', creditMutationLimiter, rejectImpersonated, cardController.requestMyPhysicalCard);
router.post('/cards/:cardId/activate', creditMutationLimiter, rejectImpersonated, cardController.activateMyCard);
router.post('/cards/:cardId/freeze', creditMutationLimiter, rejectImpersonated, cardController.freezeMyCard);
router.post('/cards/:cardId/unfreeze', creditMutationLimiter, rejectImpersonated, cardController.unfreezeMyCard);
router.post('/cards/:cardId/report-lost', creditMutationLimiter, rejectImpersonated, cardController.reportMyCardLost);
router.post('/cards/:cardId/pin', creditMutationLimiter, rejectImpersonated, cardController.setMyCardPin);

module.exports = router;
